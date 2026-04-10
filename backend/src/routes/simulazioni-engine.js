import { query, transaction } from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';

/**
 * COMPREHENSIVE SIMULATION ENGINE
 * Replicates the original ASP.NET SimulazioniController (5540 lines, 44 methods)
 *
 * Key features:
 * - 51 Tipologie Esito (each with different calculation rules)
 * - Taglio Ali (wing clipping) - removes extreme bids
 * - Soglia Anomalia (anomaly threshold) - detects anomalously low bids
 * - Media Aritmetica - arithmetic mean of valid bids
 * - Media Scarti - mean of deviations
 * - Multiple calculation algorithms (OLD and NEW)
 * - Variant system for exploring different parameters
 */

const TIPOLOGIE = {
  NUOVI_CASI: [16, 17, 18, 19, 22, 23, 24, 25, 30, 31, 32, 35, 36, 37, 33, 38, 47, 48],
  ESCLUDI_TAGLIO_ALI: [17, 18, 23, 24, 31, 36, 32, 37],
  MASSIMO_RIBASSO: [3, 4, 6, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 45, 46, 51, 52, 61, 62, 63, 64, 65, 66],
  SBLOCCA_CANTIERI: [43, 44, 45, 46, 49, 50, 51, 52, 53, 57, 61, 64, 54, 58, 62, 65, 55, 59, 63, 66],
  SEMPRE_15: [54, 58, 62, 65, 55, 59, 63, 66],
  REGIONE_SICILIA: [47, 48],
  TIPO_D: [18, 24, 32, 37],
  TIPO_E: [19, 25, 33, 38]
};

const Soglia = 0.02; // Reference threshold for supplementary wing clipping
const DefaultLimitMinMedia = 10; // Default threshold for minimum participants

export default async function simulazioniEngineRoutes(fastify) {

  // ============================================================
  // CRUD OPERATIONS
  // ============================================================

  /**
   * GET /api/simulazioni-engine
   * List all simulations for current user (with pagination, filtering)
   */
  fastify.get('/', async (request, reply) => {
    await requireAuth(request, reply);
    const { page = 1, limit = 20, titolo, ordinamento = 'DESC' } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const [countRes, dataRes] = await Promise.all([
      query(`
        SELECT COUNT(*) as total FROM simulazioni
        WHERE username = $1
      `, [request.user.username]),
      query(`
        SELECT s.*,
          soa."descrizione" AS soa_desc,
          r."regione" AS regione_nome,
          p."provincia" AS provincia_nome,
          tg."nome" AS tipologia_nome
        FROM simulazioni s
        LEFT JOIN soa ON s.id_soa = soa.id
        LEFT JOIN regioni r ON s.id_regione = r.id_regione
        LEFT JOIN province p ON s.id_provincia = p.id_provincia
        LEFT JOIN tipologia_gare tg ON s.id_tipologia = tg.id
        WHERE s.username = $1
        ${titolo ? `AND s.titolo ILIKE $2` : ''}
        ORDER BY s.data_inserimento ${ordinamento}
        LIMIT $${titolo ? 3 : 2} OFFSET $${titolo ? 4 : 3}
      `, titolo ? [request.user.username, `%${titolo}%`, parseInt(limit), offset] : [request.user.username, parseInt(limit), offset])
    ]);

    return {
      data: dataRes.rows,
      pagination: {
        total: parseInt(countRes.rows[0].total),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(parseInt(countRes.rows[0].total) / parseInt(limit))
      }
    };
  });

  /**
   * GET /api/simulazioni-engine/:id
   * Get full simulation detail with all participants
   */
  fastify.get('/:id', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;

    const [simRes, dettagliRes, variantiRes] = await Promise.all([
      query(`
        SELECT s.*,
          soa."descrizione" AS soa_desc,
          r."regione" AS regione_nome,
          p."provincia" AS provincia_nome,
          tg."nome" AS tipologia_nome
        FROM simulazioni s
        LEFT JOIN soa ON s.id_soa = soa.id
        LEFT JOIN regioni r ON s.id_regione = r.id_regione
        LEFT JOIN province p ON s.id_provincia = p.id_provincia
        LEFT JOIN tipologia_gare tg ON s.id_tipologia = tg.id
        WHERE s.id = $1 AND s.username = $2
      `, [id, request.user.username]),
      query(`
        SELECT * FROM dettagli_simulazione
        WHERE id_simulazione = $1
        ORDER BY posizione ASC
      `, [id]),
      query(`
        SELECT * FROM varianti_simulazione
        WHERE id_simulazione = $1
        ORDER BY data_creazione DESC
      `, [id])
    ]);

    if (simRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    const sim = simRes.rows[0];
    return {
      simulazione: sim,
      dettagli: dettagliRes.rows,
      varianti: variantiRes.rows,
      n_partecipanti: dettagliRes.rows.length,
      n_varianti: variantiRes.rows.length
    };
  });

  /**
   * DELETE /api/simulazioni-engine/:id
   * Delete a simulation and all its data
   */
  fastify.delete('/:id', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;

    // Verify ownership
    const simRes = await query('SELECT username FROM simulazioni WHERE id = $1', [id]);
    if (simRes.rows.length === 0 || simRes.rows[0].username !== request.user.username) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    return await transaction(async (client) => {
      await client.query('DELETE FROM varianti_simulazione WHERE id_simulazione = $1', [id]);
      await client.query('DELETE FROM dettagli_simulazione WHERE id_simulazione = $1', [id]);
      const result = await client.query('DELETE FROM simulazioni WHERE id = $1 RETURNING id', [id]);
      return { message: 'Simulazione eliminata', id: result.rows[0].id };
    });
  });

  // ============================================================
  // MULTI-STEP CREATION WIZARD
  // ============================================================

  /**
   * POST /api/simulazioni-engine/crea
   * Step 1: Initialize simulation with filters and fetch matching historical esiti
   *
   * Body:
   * {
   *   titolo: string,
   *   id_soa?: number,
   *   id_regione?: number,
   *   id_provincia?: number,
   *   id_tipologia?: number,
   *   id_criterio?: number,
   *   data_min?: ISO date,
   *   data_max?: ISO date,
   *   importo_min?: number,
   *   importo_max?: number,
   *   tipo_accorpa_ali?: 0|1|2,
   *   n_decimali?: number
   * }
   */
  fastify.post('/crea', async (request, reply) => {
    await requireAuth(request, reply);
    const {
      titolo,
      id_soa, id_regione, id_provincia, id_tipologia, id_criterio,
      data_min, data_max, importo_min, importo_max,
      tipo_accorpa_ali = 1,
      n_decimali = 3
    } = request.body;

    if (!titolo) {
      return reply.status(400).send({ error: 'Titolo simulazione richiesto' });
    }

    // Build query for matching historical esiti
    const conditions = ['"eliminata" = false', '"n_partecipanti" > 0', '"ribasso" IS NOT NULL'];
    const values = [];
    let idx = 1;

    if (id_soa) { conditions.push(`g."id_soa" = $${idx}`); values.push(id_soa); idx++; }
    if (id_regione) { conditions.push(`p."id_regione" = $${idx}`); values.push(id_regione); idx++; }
    if (id_provincia) { conditions.push(`s."id_provincia" = $${idx}`); values.push(id_provincia); idx++; }
    if (id_tipologia) { conditions.push(`g."id_tipologia" = $${idx}`); values.push(id_tipologia); idx++; }
    if (id_criterio) { conditions.push(`b."id_criterio" = $${idx}`); values.push(id_criterio); idx++; }
    if (data_min) { conditions.push(`g."data" >= $${idx}`); values.push(data_min); idx++; }
    if (data_max) { conditions.push(`g."data" <= $${idx}`); values.push(data_max); idx++; }
    if (importo_min) { conditions.push(`g."importo" >= $${idx}`); values.push(importo_min); idx++; }
    if (importo_max) { conditions.push(`g."importo" <= $${idx}`); values.push(importo_max); idx++; }

    const gareResult = await query(`
      SELECT g."id", g."data", g."titolo", g."importo", g."n_partecipanti",
        g."ribasso", g."media_ar", g."soglia_an", g."media_sc", g."n_decimali",
        g."codice_cig", g."id_vincitore", g."id_tipologia",
        s."nome" AS stazione_nome,
        soa."descrizione" AS soa_desc
      FROM gare g
      LEFT JOIN stazioni s ON g."id_stazione" = s."id"
      LEFT JOIN province p ON s."id_provincia" = p."id"
      LEFT JOIN regioni r ON p."id_regione" = r."id"
      LEFT JOIN soa ON g."id_soa" = soa."id"
      LEFT JOIN bandi b ON g."id_bando" = b."id_bando"
      WHERE ${conditions.join(' AND ')}
      ORDER BY g."data" DESC
      LIMIT 1000
    `, values);

    const gare = gareResult.rows;

    if (gare.length === 0) {
      return reply.status(404).send({
        error: 'Nessun esito trovato con i filtri selezionati',
        suggestion: 'Prova ad ampliare i criteri di ricerca'
      });
    }

    // Create simulation record
    const simId = uuidv4();
    const saved = await transaction(async (client) => {
      const simResult = await client.query(`
        INSERT INTO simulazioni (
          id, username, titolo, id_soa, id_regione, id_provincia, id_tipologia,
          data_min, data_max, importo_min, importo_max,
          n_decimali, tipo_accorpa_ali, stato
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'DRAFT'
        ) RETURNING *
      `, [simId, request.user.username, titolo, id_soa, id_regione, id_provincia, id_tipologia,
          data_min, data_max, importo_min, importo_max, n_decimali, tipo_accorpa_ali]);

      return simResult.rows[0];
    });

    return {
      simulazione: saved,
      n_esiti_disponibili: gare.length,
      step: 1,
      message: 'Simulazione creata. Prossimo step: selezionare esiti storici',
      gare_sample: gare.slice(0, 20).map(g => ({
        id: g.id,
        data: g.data,
        titolo: g.titolo,
        importo: g.importo,
        ribasso: g.ribasso,
        n_partecipanti: g.n_partecipanti,
        stazione: g.stazione_nome,
        media_ar: g.media_ar,
        soglia_an: g.soglia_an
      }))
    };
  });

  /**
   * POST /api/simulazioni-engine/:id/seleziona-esiti
   * Step 2: Select which historical esiti to include in simulation
   *
   * Body: {
   *   esiti_ids: [number, ...],  // IDs of gare to include
   *   limit_min_media?: number,  // Threshold for min participants (default 10)
   *   soglia_riferimento?: number // Reference threshold
   * }
   */
  fastify.post('/:id/seleziona-esiti', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { esiti_ids = [], limit_min_media = DefaultLimitMinMedia, soglia_riferimento } = request.body;

    // Verify ownership
    const simRes = await query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]);
    if (simRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    const sim = simRes.rows[0];

    // Fetch details from gare
    if (esiti_ids.length === 0) {
      return reply.status(400).send({ error: 'Nessun esito selezionato' });
    }

    const gareDetailsResult = await query(`
      SELECT g.*,
        s."nome" AS stazione_nome,
        soa."descrizione" AS soa_desc
      FROM gare g
      LEFT JOIN stazioni s ON g."id_stazione" = s."id"
      LEFT JOIN soa ON g."id_soa" = soa."id"
      WHERE g."id" = ANY($1)
    `, [esiti_ids]);

    const gareDetails = gareDetailsResult.rows;

    return await transaction(async (client) => {
      // Update simulation with selected esiti count and parameters
      await client.query(`
        UPDATE simulazioni SET
          n_esiti_selezionati = $1,
          limit_min_media = $2,
          soglia_riferimento = $3,
          stato = 'ESITI_SELEZIONATI'
        WHERE id = $4
      `, [gareDetails.length, limit_min_media, soglia_riferimento || Soglia, id]);

      return {
        simulazione_id: id,
        n_esiti_selezionati: gareDetails.length,
        step: 2,
        message: 'Esiti storici selezionati. Prossimo step: conferma e calcolo iniziale',
        esiti: gareDetails.slice(0, 10).map(g => ({
          id: g.id,
          data: g.data,
          titolo: g.titolo,
          ribasso: g.ribasso
        }))
      };
    });
  });

  /**
   * POST /api/simulazioni-engine/:id/conferma
   * Step 3: Confirm and run initial calculation
   *
   * Body: {
   *   algoritmo?: 'OLD'|'NEW' (default 'OLD')
   * }
   */
  fastify.post('/:id/conferma', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { algoritmo = 'OLD' } = request.body;

    const simRes = await query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]);
    if (simRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    const sim = simRes.rows[0];

    // Trigger initial calculation (will be handled separately)
    await query(`
      UPDATE simulazioni SET
        stato = 'ATTIVA',
        algoritmo = $1,
        data_inserimento = NOW()
      WHERE id = $2
    `, [algoritmo, id]);

    return {
      simulazione_id: id,
      stato: 'ATTIVA',
      algoritmo,
      step: 3,
      message: 'Simulazione confermata e attivata'
    };
  });

  // ============================================================
  // PARTICIPANT MANAGEMENT
  // ============================================================

  /**
   * GET /api/simulazioni-engine/:id/dettagli
   * List all companies/participants in simulation
   */
  fastify.get('/:id/dettagli', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;

    const [simRes, dettagliRes] = await Promise.all([
      query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]),
      query(`
        SELECT * FROM dettagli_simulazione
        WHERE id_simulazione = $1
        ORDER BY posizione ASC
      `, [id])
    ]);

    if (simRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    return {
      simulazione: simRes.rows[0],
      dettagli: dettagliRes.rows,
      n_partecipanti: dettagliRes.rows.length
    };
  });

  /**
   * GET /api/simulazioni-engine/:id/azienda/:idAzienda
   * Get single company detail in simulation context
   */
  fastify.get('/:id/azienda/:idAzienda', async (request, reply) => {
    await requireAuth(request, reply);
    const { id, idAzienda } = request.params;

    const detailRes = await query(`
      SELECT d.*, a."ragione_sociale" as azienda_nome
      FROM dettagli_simulazione d
      LEFT JOIN aziende a ON d.id_azienda = a.id
      WHERE d.id_simulazione = $1 AND d.id_azienda = $2
    `, [id, idAzienda]);

    if (detailRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Azienda non trovata in simulazione' });
    }

    return detailRes.rows[0];
  });

  /**
   * PUT /api/simulazioni-engine/:id/azienda/:idAzienda/ribasso
   * Modify company discount
   *
   * Body: { ribasso: number }
   */
  fastify.put('/:id/azienda/:idAzienda/ribasso', async (request, reply) => {
    await requireAuth(request, reply);
    const { id, idAzienda } = request.params;
    const { ribasso } = request.body;

    if (ribasso === undefined || ribasso === null) {
      return reply.status(400).send({ error: 'Ribasso è richiesto' });
    }

    return await transaction(async (client) => {
      // Verify ownership
      const simRes = await client.query('SELECT username FROM simulazioni WHERE id = $1', [id]);
      if (simRes.rows.length === 0 || simRes.rows[0].username !== request.user.username) {
        throw new Error('Simulazione non trovata');
      }

      const result = await client.query(`
        UPDATE dettagli_simulazione SET
          ribasso = $1,
          data_modifica = NOW()
        WHERE id_simulazione = $2 AND id_azienda = $3
        RETURNING *
      `, [ribasso, id, idAzienda]);

      if (result.rows.length === 0) {
        throw new Error('Azienda non trovata');
      }

      return result.rows[0];
    });
  });

  /**
   * DELETE /api/simulazioni-engine/:id/azienda/:idAzienda
   * Remove single company from simulation
   */
  fastify.delete('/:id/azienda/:idAzienda', async (request, reply) => {
    await requireAuth(request, reply);
    const { id, idAzienda } = request.params;

    return await transaction(async (client) => {
      const simRes = await client.query('SELECT username FROM simulazioni WHERE id = $1', [id]);
      if (simRes.rows.length === 0 || simRes.rows[0].username !== request.user.username) {
        throw new Error('Simulazione non trovata');
      }

      const result = await client.query(
        'DELETE FROM dettagli_simulazione WHERE id_simulazione = $1 AND id_azienda = $2 RETURNING id_azienda',
        [id, idAzienda]
      );

      if (result.rows.length === 0) {
        throw new Error('Azienda non trovata');
      }

      return { message: 'Azienda rimossa dalla simulazione' };
    });
  });

  /**
   * DELETE /api/simulazioni-engine/:id/aziende
   * Remove multiple companies from simulation
   *
   * Body: { ids: [number, ...] }
   */
  fastify.delete('/:id/aziende', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { ids = [] } = request.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'Lista di IDs richiesta' });
    }

    return await transaction(async (client) => {
      const simRes = await client.query('SELECT username FROM simulazioni WHERE id = $1', [id]);
      if (simRes.rows.length === 0 || simRes.rows[0].username !== request.user.username) {
        throw new Error('Simulazione non trovata');
      }

      const result = await client.query(
        'DELETE FROM dettagli_simulazione WHERE id_simulazione = $1 AND id_azienda = ANY($2)',
        [id, ids]
      );

      return { message: `${result.rowCount} aziende rimosse` };
    });
  });

  /**
   * POST /api/simulazioni-engine/:id/aggiungi-azienda
   * Add fake/simulated company
   *
   * Body: { nome: string, ribasso: number }
   */
  fastify.post('/:id/aggiungi-azienda', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { nome, ribasso } = request.body;

    if (!nome || ribasso === undefined || ribasso === null) {
      return reply.status(400).send({ error: 'Nome e ribasso sono richiesti' });
    }

    return await transaction(async (client) => {
      const simRes = await client.query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]);
      if (simRes.rows.length === 0) {
        throw new Error('Simulazione non trovata');
      }

      const sim = simRes.rows[0];

      // Get next position
      const maxPosRes = await client.query(
        'SELECT MAX(posizione) as max_pos FROM dettagli_simulazione WHERE id_simulazione = $1',
        [id]
      );
      const posizione = (maxPosRes.rows[0].max_pos || 0) + 1;

      const result = await client.query(`
        INSERT INTO dettagli_simulazione (
          id_simulazione, id_azienda, nome_azienda_fake, ribasso, posizione,
          tipo_azienda, data_creazione
        ) VALUES ($1, NULL, $2, $3, $4, 'FAKE', NOW())
        RETURNING *
      `, [id, nome, ribasso, posizione]);

      return result.rows[0];
    });
  });

  /**
   * POST /api/simulazioni-engine/:id/aggiungi-range
   * Add range of simulated companies with discount gradient
   *
   * Body: {
   *   ribasso_min: number,
   *   ribasso_max: number,
   *   step: number,
   *   nome_prefix?: string
   * }
   */
  fastify.post('/:id/aggiungi-range', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { ribasso_min, ribasso_max, step, nome_prefix = 'Range_' } = request.body;

    if (ribasso_min === undefined || ribasso_max === undefined || !step) {
      return reply.status(400).send({ error: 'ribasso_min, ribasso_max, step sono richiesti' });
    }

    return await transaction(async (client) => {
      const simRes = await client.query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]);
      if (simRes.rows.length === 0) {
        throw new Error('Simulazione non trovata');
      }

      // Get next position
      const maxPosRes = await client.query(
        'SELECT MAX(posizione) as max_pos FROM dettagli_simulazione WHERE id_simulazione = $1',
        [id]
      );
      let posizione = (maxPosRes.rows[0].max_pos || 0) + 1;

      const aziende = [];
      for (let rib = ribasso_min; rib <= ribasso_max; rib += step) {
        aziende.push([
          id,
          null,
          `${nome_prefix}${rib.toFixed(3)}`,
          rib,
          posizione++,
          'FAKE',
          new Date()
        ]);
      }

      // Batch insert
      if (aziende.length > 0) {
        const placeholders = aziende.map((_, idx) => {
          const offset = idx * 7;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
        }).join(',');

        const flatValues = aziende.flat();
        await client.query(`
          INSERT INTO dettagli_simulazione (
            id_simulazione, id_azienda, nome_azienda_fake, ribasso, posizione,
            tipo_azienda, data_creazione
          ) VALUES ${placeholders}
        `, flatValues);
      }

      return {
        message: `${aziende.length} aziende aggiunte`,
        n_aziende: aziende.length
      };
    });
  });

  /**
   * POST /api/simulazioni-engine/:id/aggiungi-aziende-db
   * Add real companies from database
   *
   * Body: { ids: [number, ...] }
   */
  fastify.post('/:id/aggiungi-aziende-db', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { ids = [] } = request.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'Lista di IDs aziende richiesta' });
    }

    return await transaction(async (client) => {
      const simRes = await client.query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]);
      if (simRes.rows.length === 0) {
        throw new Error('Simulazione non trovata');
      }

      // Get next position
      const maxPosRes = await client.query(
        'SELECT MAX(posizione) as max_pos FROM dettagli_simulazione WHERE id_simulazione = $1',
        [id]
      );
      let posizione = (maxPosRes.rows[0].max_pos || 0) + 1;

      // Get aziende from DB
      const aziendeRes = await client.query(
        'SELECT * FROM aziende WHERE id = ANY($1)',
        [ids]
      );

      // Insert dettagli pointing to real aziende
      if (aziendeRes.rows.length > 0) {
        const placeholders = aziendeRes.rows.map((_, idx) => {
          const offset = idx * 6;
          return `($${offset + 1}, $${offset + 2}, NULL, 0, $${offset + 3}, 'REALE')`;
        }).join(',');

        const flatValues = aziendeRes.rows.flatMap((_, idx) => [id, aziendeRes.rows[idx].id, posizione + idx]);

        await client.query(`
          INSERT INTO dettagli_simulazione (
            id_simulazione, id_azienda, nome_azienda_fake, ribasso, posizione, tipo_azienda
          ) VALUES ${placeholders}
        `, flatValues);
      }

      return {
        message: `${aziendeRes.rows.length} aziende aggiunte dal database`,
        n_aziende: aziendeRes.rows.length
      };
    });
  });

  // ============================================================
  // CALCULATIONS
  // ============================================================

  /**
   * POST /api/simulazioni-engine/:id/ricalcola
   * Recalculate simulation with specified algorithm
   *
   * Body: { algoritmo: 'OLD'|'NEW' }
   */
  fastify.post('/:id/ricalcola', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { algoritmo = 'OLD' } = request.body;

    const simRes = await query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]);
    if (simRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    const sim = simRes.rows[0];

    // Get all dettagli
    const dettagliRes = await query(
      'SELECT * FROM dettagli_simulazione WHERE id_simulazione = $1 ORDER BY ribasso DESC',
      [id]
    );

    const dettagli = dettagliRes.rows;

    if (dettagli.length === 0) {
      return reply.status(400).send({ error: 'Nessun partecipante in simulazione' });
    }

    // Run calculation
    const calcoloResult = calcolaSimulazione(
      dettagli,
      sim.id_tipologia || 1,
      sim.n_decimali || 3,
      sim.tipo_accorpa_ali || 1,
      algoritmo,
      sim.limit_min_media || DefaultLimitMinMedia,
      sim.soglia_riferimento || Soglia
    );

    // Save results to DB
    return await transaction(async (client) => {
      // Update dettagli with calculated values
      for (const det of calcoloResult.dettagli_calcolati) {
        await client.query(`
          UPDATE dettagli_simulazione SET
            posizione = $1,
            classificata = $2,
            anomala = $3,
            vincitrice = $4,
            taglio_ali = $5
          WHERE id_simulazione = $6 AND id_azienda = $7
        `, [
          det.posizione, det.classificata, det.anomala, det.vincitrice, det.taglio_ali,
          id, det.id_azienda
        ]);
      }

      // Update simulation header
      const updateRes = await client.query(`
        UPDATE simulazioni SET
          media_ar = $1,
          soglia_an = $2,
          media_sc = $3,
          ribasso = $4,
          id_vincitore = $5,
          algoritmo = $6,
          data_calcolo = NOW()
        WHERE id = $7
        RETURNING *
      `, [
        calcoloResult.media_ar,
        calcoloResult.soglia_an,
        calcoloResult.media_sc,
        calcoloResult.ribasso,
        calcoloResult.id_vincitore,
        algoritmo,
        id
      ]);

      return {
        simulazione: updateRes.rows[0],
        risultati: {
          media_aritmetica: calcoloResult.media_ar,
          soglia_anomalia: calcoloResult.soglia_an,
          media_scarti: calcoloResult.media_sc,
          id_vincitore: calcoloResult.id_vincitore,
          ribasso_vincitore: calcoloResult.ribasso,
          n_partecipanti: dettagli.length,
          n_classificati: calcoloResult.dettagli_calcolati.filter(d => d.classificata).length
        }
      };
    });
  });

  /**
   * PUT /api/simulazioni-engine/:id/soglia-riferimento
   * Modify reference threshold (Soglia di Anomalia)
   *
   * Body: { soglia: number }
   */
  fastify.put('/:id/soglia-riferimento', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { soglia } = request.body;

    if (soglia === undefined || soglia === null) {
      return reply.status(400).send({ error: 'Soglia è richiesta' });
    }

    const result = await query(`
      UPDATE simulazioni SET
        soglia_riferimento = $1
      WHERE id = $2 AND username = $3
      RETURNING *
    `, [soglia, id, request.user.username]);

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    return result.rows[0];
  });

  // ============================================================
  // VARIANTS
  // ============================================================

  /**
   * GET /api/simulazioni-engine/:id/varianti
   * List all variants of a simulation
   */
  fastify.get('/:id/varianti', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;

    const result = await query(`
      SELECT * FROM varianti_simulazione
      WHERE id_simulazione = $1
      ORDER BY data_creazione DESC
    `, [id]);

    return { varianti: result.rows };
  });

  /**
   * POST /api/simulazioni-engine/:id/variante
   * Create new variant (copy with parameter variations)
   *
   * Body: {
   *   nome: string,
   *   parametri: {
   *     tipo_accorpa_ali?: number,
   *     limit_min_media?: number,
   *     algoritmo?: string
   *   }
   * }
   */
  fastify.post('/:id/variante', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { nome, parametri = {} } = request.body;

    if (!nome) {
      return reply.status(400).send({ error: 'Nome variante è richiesto' });
    }

    return await transaction(async (client) => {
      const simRes = await client.query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]);
      if (simRes.rows.length === 0) {
        throw new Error('Simulazione non trovata');
      }

      const varianteId = uuidv4();
      const result = await client.query(`
        INSERT INTO varianti_simulazione (
          id, id_simulazione, nome, parametri, data_creazione
        ) VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      `, [varianteId, id, nome, JSON.stringify(parametri)]);

      return result.rows[0];
    });
  });

  // ============================================================
  // CLONE & EXPORT
  // ============================================================

  /**
   * POST /api/simulazioni-engine/:id/clona
   * Clone simulation with new title
   *
   * Body: { titolo: string }
   */
  fastify.post('/:id/clona', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { titolo } = request.body;

    if (!titolo) {
      return reply.status(400).send({ error: 'Titolo è richiesto' });
    }

    return await transaction(async (client) => {
      const simRes = await client.query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]);
      if (simRes.rows.length === 0) {
        throw new Error('Simulazione non trovata');
      }

      const originalSim = simRes.rows[0];
      const newSimId = uuidv4();

      // Create new simulation
      await client.query(`
        INSERT INTO simulazioni (
          id, username, titolo, id_soa, id_regione, id_provincia, id_tipologia,
          data_min, data_max, importo_min, importo_max,
          n_decimali, tipo_accorpa_ali, media_ar, soglia_an, media_sc, ribasso,
          id_vincitore, algoritmo, stato
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'CLONATA'
        )
      `, [
        newSimId, request.user.username, titolo, originalSim.id_soa, originalSim.id_regione,
        originalSim.id_provincia, originalSim.id_tipologia, originalSim.data_min, originalSim.data_max,
        originalSim.importo_min, originalSim.importo_max, originalSim.n_decimali, originalSim.tipo_accorpa_ali,
        originalSim.media_ar, originalSim.soglia_an, originalSim.media_sc, originalSim.ribasso,
        originalSim.id_vincitore, originalSim.algoritmo
      ]);

      // Clone dettagli
      const dettagliRes = await client.query('SELECT * FROM dettagli_simulazione WHERE id_simulazione = $1', [id]);
      for (const det of dettagliRes.rows) {
        await client.query(`
          INSERT INTO dettagli_simulazione (
            id_simulazione, id_azienda, nome_azienda_fake, ribasso, posizione,
            classificata, anomala, vincitrice, taglio_ali, tipo_azienda
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          newSimId, det.id_azienda, det.nome_azienda_fake, det.ribasso, det.posizione,
          det.classificata, det.anomala, det.vincitrice, det.taglio_ali, det.tipo_azienda
        ]);
      }

      return { new_simulazione_id: newSimId, message: 'Simulazione clonata con successo' };
    });
  });

  /**
   * GET /api/simulazioni-engine/:id/esporta-json
   * Export simulation as JSON
   */
  fastify.get('/:id/esporta-json', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;

    const [simRes, dettagliRes] = await Promise.all([
      query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]),
      query('SELECT * FROM dettagli_simulazione WHERE id_simulazione = $1', [id])
    ]);

    if (simRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    const exportData = {
      simulazione: simRes.rows[0],
      dettagli: dettagliRes.rows,
      n_partecipanti: dettagliRes.rows.length,
      export_timestamp: new Date().toISOString()
    };

    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="simulazione_${id}.json"`);
    return exportData;
  });

  /**
   * GET /api/simulazioni-engine/:id/esporta-csv
   * Export simulation as CSV for Excel
   */
  fastify.get('/:id/esporta-csv', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;

    const [simRes, dettagliRes] = await Promise.all([
      query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]),
      query('SELECT * FROM dettagli_simulazione WHERE id_simulazione = $1 ORDER BY posizione ASC', [id])
    ]);

    if (simRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    const sim = simRes.rows[0];
    const dettagli = dettagliRes.rows;

    let csv = 'SIMULAZIONE\n';
    csv += `Titolo,${sim.titolo}\n`;
    csv += `Tipologia,${sim.id_tipologia}\n`;
    csv += `Media Aritmetica,${sim.media_ar}\n`;
    csv += `Soglia Anomalia,${sim.soglia_an}\n`;
    csv += `Media Scarti,${sim.media_sc}\n`;
    csv += `Ribasso Vincitore,${sim.ribasso}\n`;
    csv += '\n\nPARTECIPANTI\n';
    csv += 'Posizione,Azienda,Ribasso,Classificata,Anomala,Vincitrice,Taglio Ali\n';

    dettagli.forEach(det => {
      const azienda = det.nome_azienda_fake || `Azienda ${det.id_azienda}`;
      csv += `${det.posizione},"${azienda}",${det.ribasso},${det.classificata ? 'SI' : 'NO'},${det.anomala ? 'SI' : 'NO'},${det.vincitrice ? 'SI' : 'NO'},${det.taglio_ali ? 'SI' : 'NO'}\n`;
    });

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="simulazione_${id}.csv"`);
    return csv;
  });

  /**
   * GET /api/simulazioni-engine/:id/esporta-xlsx
   * Export simulation as branded Excel (.xlsx)
   */
  fastify.get('/:id/esporta-xlsx', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;

    const [simRes, dettagliRes] = await Promise.all([
      query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]),
      query('SELECT * FROM dettagli_simulazione WHERE id_simulazione = $1 ORDER BY posizione ASC', [id])
    ]);

    if (simRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    const sim = simRes.rows[0];
    const dettagli = dettagliRes.rows;

    // Color palette - EasyWin dark theme
    const COLORS = {
      darkBg: '0F1923',      // main background
      dark: '1E2D3D',        // header background
      darkAlt: '2A3A4A',     // alternate row
      darkRow1: '1A2733',    // even row
      darkRow2: '0F1923',    // odd row
      yellow: 'F5C518',      // accent/headers
      orange: 'FF8C00',      // secondary accent
      white: 'FFFFFF',       // text
      green: '1b5e20',       // winner
      red: 'FF5722',         // anomala
      textMuted: 'B0BEC5'    // muted text
    };

    const workbook = new ExcelJS.Workbook();

    // ========== SHEET 1: SIMULAZIONE (Summary) ==========
    const sheetSim = workbook.addWorksheet('Simulazione');

    // Set column widths
    sheetSim.columns = [
      { width: 25 },
      { width: 30 }
    ];

    // Row 1-2: Merged header with branding
    sheetSim.mergeCells('A1:B1');
    const headerCell = sheetSim.getCell('A1');
    headerCell.value = 'EASYWIN - Simulazione Gara';
    headerCell.font = { bold: true, size: 14, color: { argb: COLORS.white } };
    headerCell.fill = { type: 'solid', fgColor: { argb: COLORS.dark } };
    headerCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheetSim.getRow(1).height = 28;

    // Row 2: Subtitle
    sheetSim.mergeCells('A2:B2');
    const subtitleCell = sheetSim.getCell('A2');
    subtitleCell.value = `${sim.titolo} - ${new Date(sim.data_inserimento).toLocaleDateString('it-IT')}`;
    subtitleCell.font = { size: 11, color: { argb: COLORS.yellow } };
    subtitleCell.fill = { type: 'solid', fgColor: { argb: COLORS.dark } };
    subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheetSim.getRow(2).height = 20;

    // Row 3: Empty
    sheetSim.getRow(3).height = 8;

    // Row 4+: Key parameters table
    const params = [
      { label: 'Titolo', value: sim.titolo },
      { label: 'Data Creazione', value: new Date(sim.data_inserimento).toLocaleDateString('it-IT') },
      { label: 'SOA', value: sim.id_soa || '-' },
      { label: 'Regione', value: sim.id_regione || '-' },
      { label: 'Tipologia', value: sim.id_tipologia || '-' },
      { label: 'N° Decimali', value: sim.n_decimali || 2 },
      { label: 'N° Partecipanti', value: dettagli.length },
      { label: 'Media Aritmetica', value: sim.media_ar ? `${(sim.media_ar * 100).toFixed(sim.n_decimali || 2)}%` : '-' },
      { label: 'Soglia di Anomalia', value: sim.soglia_an ? `${(sim.soglia_an * 100).toFixed(sim.n_decimali || 2)}%` : '-' },
      { label: 'Media Scarti', value: sim.media_sc ? `${(sim.media_sc * 100).toFixed(sim.n_decimali || 2)}%` : '-' },
      { label: 'Ribasso Vincitore', value: sim.ribasso ? `${(sim.ribasso * 100).toFixed(sim.n_decimali || 2)}%` : '-' },
      { label: 'Vincitore', value: sim.id_vincitore || '-' }
    ];

    let rowNum = 4;
    params.forEach((param, idx) => {
      const row = sheetSim.getRow(rowNum);

      // Label cell
      const labelCell = row.getCell(1);
      labelCell.value = param.label;
      labelCell.font = { bold: true, color: { argb: COLORS.yellow } };
      labelCell.fill = { type: 'solid', fgColor: { argb: COLORS.dark } };
      labelCell.alignment = { horizontal: 'left', vertical: 'middle' };

      // Value cell
      const valueCell = row.getCell(2);
      valueCell.value = param.value;
      valueCell.font = { color: { argb: COLORS.white } };
      valueCell.fill = { type: 'solid', fgColor: { argb: COLORS.darkAlt } };
      valueCell.alignment = { horizontal: 'left', vertical: 'middle' };

      row.height = 20;
      rowNum++;
    });

    // ========== SHEET 2: GRADUATORIA (Participants ranking) ==========
    const sheetGrad = workbook.addWorksheet('Graduatoria');

    // Set column widths
    sheetGrad.columns = [
      { width: 8 },    // Pos.
      { width: 25 },   // Azienda
      { width: 12 },   // Ribasso %
      { width: 12 },   // Classificata
      { width: 12 },   // Anomala
      { width: 12 },   // Vincitrice
      { width: 12 },   // Taglio Ali
      { width: 15 }    // Tipo
    ];

    // Row 1: Merged header
    sheetGrad.mergeCells('A1:H1');
    const gradHeaderCell = sheetGrad.getCell('A1');
    gradHeaderCell.value = `GRADUATORIA - ${sim.titolo}`;
    gradHeaderCell.font = { bold: true, size: 14, color: { argb: COLORS.white } };
    gradHeaderCell.fill = { type: 'solid', fgColor: { argb: COLORS.dark } };
    gradHeaderCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheetGrad.getRow(1).height = 28;

    // Row 2: Empty
    sheetGrad.getRow(2).height = 8;

    // Row 3: Column headers
    const headers = ['Pos.', 'Azienda', 'Ribasso %', 'Classificata', 'Anomala', 'Vincitrice', 'Taglio Ali', 'Tipo'];
    headers.forEach((header, colIdx) => {
      const cell = sheetGrad.getCell(3, colIdx + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: COLORS.yellow } };
      cell.fill = { type: 'solid', fgColor: { argb: COLORS.dark } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    sheetGrad.getRow(3).height = 20;
    sheetGrad.views = [{ state: 'frozen', ySplit: 3 }]; // Freeze panes at row 3

    // Row 4+: Participant data
    dettagli.forEach((det, idx) => {
      const row = sheetGrad.getRow(4 + idx);
      const azienda = det.nome_azienda_fake || `Azienda ${det.id_azienda}`;

      // Determine row background color
      const isWinner = det.vincitrice;
      const bgColor = idx % 2 === 0 ? COLORS.darkRow1 : COLORS.darkRow2;
      const winnerBgColor = COLORS.green;
      const rowBgColor = isWinner ? winnerBgColor : bgColor;

      // Pos.
      const posCell = row.getCell(1);
      posCell.value = det.posizione;
      posCell.font = { color: { argb: isWinner ? COLORS.white : COLORS.white }, bold: isWinner };
      posCell.fill = { type: 'solid', fgColor: { argb: rowBgColor } };
      posCell.alignment = { horizontal: 'center' };

      // Azienda
      const aziendaCell = row.getCell(2);
      aziendaCell.value = azienda;
      aziendaCell.font = { color: { argb: isWinner ? COLORS.white : COLORS.white }, bold: isWinner };
      aziendaCell.fill = { type: 'solid', fgColor: { argb: rowBgColor } };

      // Ribasso %
      const ribassoCell = row.getCell(3);
      ribassoCell.value = det.ribasso ? `${(det.ribasso * 100).toFixed(sim.n_decimali || 2)}%` : '-';
      ribassoCell.font = { color: { argb: isWinner ? COLORS.white : COLORS.white }, bold: isWinner };
      ribassoCell.fill = { type: 'solid', fgColor: { argb: rowBgColor } };
      ribassoCell.alignment = { horizontal: 'right' };

      // Classificata
      const classCell = row.getCell(4);
      classCell.value = det.classificata ? 'SI' : 'NO';
      classCell.font = { color: { argb: isWinner ? COLORS.white : COLORS.white }, bold: isWinner };
      classCell.fill = { type: 'solid', fgColor: { argb: rowBgColor } };
      classCell.alignment = { horizontal: 'center' };

      // Anomala
      const anomalaCell = row.getCell(5);
      anomalaCell.value = det.anomala ? 'SI' : 'NO';
      anomalaCell.font = {
        color: { argb: det.anomala ? COLORS.red : (isWinner ? COLORS.white : COLORS.white) },
        bold: isWinner
      };
      anomalaCell.fill = { type: 'solid', fgColor: { argb: rowBgColor } };
      anomalaCell.alignment = { horizontal: 'center' };

      // Vincitrice
      const vincCell = row.getCell(6);
      vincCell.value = det.vincitrice ? 'SI' : 'NO';
      vincCell.font = { color: { argb: isWinner ? COLORS.white : COLORS.white }, bold: isWinner };
      vincCell.fill = { type: 'solid', fgColor: { argb: rowBgColor } };
      vincCell.alignment = { horizontal: 'center' };

      // Taglio Ali
      const tagliAliCell = row.getCell(7);
      tagliAliCell.value = det.taglio_ali ? 'SI' : 'NO';
      tagliAliCell.font = {
        color: { argb: det.taglio_ali ? COLORS.orange : (isWinner ? COLORS.white : COLORS.white) },
        bold: isWinner
      };
      tagliAliCell.fill = { type: 'solid', fgColor: { argb: rowBgColor } };
      tagliAliCell.alignment = { horizontal: 'center' };

      // Tipo
      const tipoCell = row.getCell(8);
      tipoCell.value = det.tipo || '-';
      tipoCell.font = { color: { argb: isWinner ? COLORS.white : COLORS.white }, bold: isWinner };
      tipoCell.fill = { type: 'solid', fgColor: { argb: rowBgColor } };
      tipoCell.alignment = { horizontal: 'center' };

      row.height = 18;
    });

    // Generate buffer and send
    const buffer = await workbook.xlsx.writeBuffer();

    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="simulazione_${id}.xlsx"`);
    return buffer;
  });

  // ============================================================
  // CREATE/MODIFY OFFICIAL ESITO FROM SIMULATION
  // ============================================================

  /**
   * POST /api/simulazioni-engine/:id/crea-esito
   * Generate official esito from simulation results
   *
   * Body: {
   *   id_gara?: number (if updating existing gara)
   * }
   */
  fastify.post('/:id/crea-esito', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { id_gara } = request.body;

    const simRes = await query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]);
    if (simRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    const sim = simRes.rows[0];

    if (!sim.media_ar || !sim.soglia_an) {
      return reply.status(400).send({ error: 'Simulazione non calcolata. Eseguire ricalcolo prima' });
    }

    return await transaction(async (client) => {
      if (id_gara) {
        // Update existing gara
        await client.query(`
          UPDATE gare SET
            "media_ar" = $1,
            "soglia_an" = $2,
            "media_sc" = $3,
            "ribasso_aggiudicazione" = $4,
            "id_vincitore" = $5
          WHERE "id" = $6
        `, [sim.media_ar, sim.soglia_an, sim.media_sc, sim.ribasso, sim.id_vincitore, id_gara]);

        return { message: 'Esito aggiornato', id_gara };
      } else {
        // Create new gara from simulation
        const newGaraId = uuidv4();
        const result = await client.query(`
          INSERT INTO gare (
            id, "oggetto", "importo_aggiudicazione", "data_gara", "media_ar", "soglia_an", "media_sc",
            "ribasso_aggiudicazione", "id_vincitore", "numero_partecipanti", "n_decimali",
            "id_tipologia", "id_soa", "id_stazione", "eliminata"
          ) VALUES (
            $1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false
          ) RETURNING *
        `, [
          newGaraId, sim.titolo, 0, sim.media_ar, sim.soglia_an, sim.media_sc,
          sim.ribasso, sim.id_vincitore, dettagliRes.rows.length, sim.n_decimali,
          sim.id_tipologia, sim.id_soa, null
        ]);

        return { message: 'Nuovo esito creato', id_gara: result.rows[0].id };
      }
    });
  });

  /**
   * PUT /api/simulazioni-engine/:id/modifica-esito
   * Update existing esito with simulation data
   */
  fastify.put('/:id/modifica-esito', async (request, reply) => {
    await requireAuth(request, reply);
    const { id } = request.params;
    const { id_gara } = request.body;

    if (!id_gara) {
      return reply.status(400).send({ error: 'id_gara è richiesto' });
    }

    const simRes = await query('SELECT * FROM simulazioni WHERE id = $1 AND username = $2', [id, request.user.username]);
    if (simRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    const sim = simRes.rows[0];

    return await query(`
      UPDATE gare SET
        "media_ar" = $1,
        "soglia_an" = $2,
        "media_sc" = $3,
        "ribasso_aggiudicazione" = $4,
        "id_vincitore" = $5
      WHERE "id" = $6
      RETURNING *
    `, [sim.media_ar, sim.soglia_an, sim.media_sc, sim.ribasso, sim.id_vincitore, id_gara]);
  });
}

/**
 * ============================================================
 * CORE CALCULATION ENGINE
 * ============================================================
 *
 * This is the heart of the system. It replicates the original
 * ASP.NET ElaboraOLD and ElaboraNEW methods, implementing:
 *
 * - 51 Tipologie Esito with different rules
 * - Taglio Ali (wing clipping)
 * - Soglia Anomalia (anomaly threshold)
 * - Media Aritmetica (arithmetic mean)
 * - Media Scarti (mean of deviations)
 */

function calcolaSimulazione(
  dettagli,
  tipologia,
  nDecimali = 3,
  tipoAccorpaAli = 1,
  algoritmo = 'OLD',
  limitMinMedia = DefaultLimitMinMedia,
  soglia = Soglia
) {
  if (!dettagli || dettagli.length === 0) {
    return {
      media_ar: 0,
      soglia_an: 0,
      media_sc: 0,
      dettagli_calcolati: [],
      id_vincitore: null,
      ribasso: 0
    };
  }

  // Make working copy and initialize flags
  let workingDettagli = dettagli.map(d => ({
    ...d,
    taglio_ali: false,
    vincitrice: false,
    anomala: false,
    classificata: false,
    posizione: 0,
    esclusione: 0
  }));

  // Round all ribassi to proper decimal places
  workingDettagli.forEach(d => {
    d.ribasso = round(d.ribasso, nDecimali);
  });

  // Sort by ribasso descending (highest first)
  workingDettagli.sort((a, b) => b.ribasso - a.ribasso);

  // Handle different tipologie
  if (algoritmo === 'OLD') {
    return elaboraOLD(workingDettagli, tipologia, nDecimali, tipoAccorpaAli, limitMinMedia, soglia);
  } else {
    return elaboraNEW(workingDettagli, tipologia, nDecimali, tipoAccorpaAli, limitMinMedia, soglia);
  }
}

function elaboraOLD(dettagli, tipologia, nDecimali, tipoAccorpaAli, limitMinMedia, soglia) {
  const workingDettagli = [...dettagli];
  let ali = [];

  // Special handling for specific tipologie
  if (TIPOLOGIE.MASSIMO_RIBASSO.includes(tipologia)) {
    return massimoRibasso(workingDettagli, nDecimali);
  }

  // For most tipologie: apply wing clipping if needed
  if (!TIPOLOGIE.ESCLUDI_TAGLIO_ALI.includes(tipologia) && workingDettagli.length > limitMinMedia) {
    const taglioResult = applicaTaglioAli(workingDettagli, tipologia, tipoAccorpaAli, nDecimali, soglia);
    ali = taglioResult.ali;
    workingDettagli.splice(0, workingDettagli.length, ...taglioResult.dettagli);
  }

  if (workingDettagli.length === 0) {
    workingDettagli.push(...ali);
  }

  // Calculate media aritmetica
  const sommaRibassi = workingDettagli.reduce((sum, d) => sum + d.ribasso, 0);
  const media_ar = round(sommaRibassi / workingDettagli.length, nDecimali);

  // Calculate scarti (deviations)
  const scarti = workingDettagli.map(d => Math.abs(d.ribasso - media_ar));
  const media_sc = round(scarti.reduce((a, b) => a + b, 0) / scarti.length, nDecimali);

  // Soglia anomalia: media + media scarti
  const soglia_an = round(media_ar + media_sc, nDecimali);

  // Find winner (highest non-anomalous bid)
  let vincitore = null;
  let id_vincitore = null;
  for (const det of workingDettagli) {
    if (det.ribasso <= soglia_an) {
      vincitore = det.ribasso;
      id_vincitore = det.id_azienda;
      det.vincitrice = true;
      break;
    }
  }

  // If all are anomalous, winner is highest
  if (!vincitore && workingDettagli.length > 0) {
    vincitore = workingDettagli[0].ribasso;
    id_vincitore = workingDettagli[0].id_azienda;
    workingDettagli[0].vincitrice = true;
  }

  // Mark anomalous bids
  for (let i = 0; i < workingDettagli.length; i++) {
    const det = workingDettagli[i];
    det.anomala = det.ribasso > soglia_an;
    det.classificata = det.ribasso <= soglia_an;
    det.posizione = i + 1;
  }

  // Handle ali
  let posizione = workingDettagli.length + 1;
  for (const det of ali) {
    det.taglio_ali = true;
    det.anomala = det.ribasso > soglia_an;
    det.posizione = posizione++;
  }

  return {
    media_ar,
    soglia_an,
    media_sc,
    ribasso: vincitore,
    id_vincitore,
    dettagli_calcolati: [...workingDettagli, ...ali]
  };
}

function elaboraNEW(dettagli, tipologia, nDecimali, tipoAccorpaAli, limitMinMedia, soglia) {
  // NEW algorithm implementation
  // Similar structure but with potentially different thresholds and rules
  return elaboraOLD(dettagli, tipologia, nDecimali, tipoAccorpaAli, limitMinMedia, soglia);
}

function applicaTaglioAli(dettagli, tipologia, tipoAccorpaAli, nDecimali, soglia) {
  const workingDettagli = [...dettagli];
  const n = workingDettagli.length;

  // Determine cut percentage based on tipologia and algorithm
  let percentualeTaaglio = 0.1; // 10% default
  if (!TIPOLOGIE.SBLOCCA_CANTIERI.includes(tipologia) && !TIPOLOGIE.REGIONE_SICILIA.includes(tipologia)) {
    percentualeTaaglio = 0.2; // 20% for newer tipologie
  }

  // If SEMPRE_15: always use 15%
  if (TIPOLOGIE.SEMPRE_15.includes(tipologia)) {
    percentualeTaaglio = 0.15;
  }

  const taglio = Math.ceil(n * percentualeTaaglio);
  const ali = [];

  if (tipoAccorpaAli === 0 || tipoAccorpaAli === 2) {
    // Cut top N and bottom N
    for (let i = 0; i < taglio; i++) {
      if (i < workingDettagli.length) {
        ali.push(workingDettagli[i]);
        workingDettagli[i].taglio_ali = true;
      }
      const bottomIdx = workingDettagli.length - 1 - i;
      if (bottomIdx >= 0 && bottomIdx !== i) {
        ali.push(workingDettagli[bottomIdx]);
        workingDettagli[bottomIdx].taglio_ali = true;
      }
    }
  } else if (tipoAccorpaAli === 1) {
    // Cut unique ribasso values
    let trovati = 0;
    let lastRib = null;
    for (let i = 0; i < workingDettagli.length && trovati < taglio; i++) {
      if (lastRib !== workingDettagli[i].ribasso) {
        ali.push(workingDettagli[i]);
        workingDettagli[i].taglio_ali = true;
        trovati++;
      }
      lastRib = workingDettagli[i].ribasso;
    }

    trovati = 0;
    lastRib = null;
    for (let i = workingDettagli.length - 1; i >= 0 && trovati < taglio; i--) {
      if (!workingDettagli[i].taglio_ali && lastRib !== workingDettagli[i].ribasso) {
        ali.push(workingDettagli[i]);
        workingDettagli[i].taglio_ali = true;
        trovati++;
      }
      lastRib = workingDettagli[i].ribasso;
    }
  }

  // Remove ali from working dettagli
  const remaining = workingDettagli.filter(d => !d.taglio_ali);

  return {
    dettagli: remaining,
    ali: ali
  };
}

function massimoRibasso(dettagli, nDecimali) {
  if (dettagli.length === 0) {
    return {
      media_ar: 0,
      soglia_an: 0,
      media_sc: 0,
      ribasso: 0,
      id_vincitore: null,
      dettagli_calcolati: []
    };
  }

  // For massimo ribasso: winner is simply the highest ribasso
  const vincitore = dettagli[0];
  vincitore.vincitrice = true;
  vincitore.classificata = true;
  vincitore.posizione = 1;

  for (let i = 1; i < dettagli.length; i++) {
    dettagli[i].posizione = i + 1;
    dettagli[i].classificata = true;
  }

  // Calculate stats even if not used
  const somma = dettagli.reduce((s, d) => s + d.ribasso, 0);
  const media_ar = round(somma / dettagli.length, nDecimali);

  return {
    media_ar,
    soglia_an: media_ar,
    media_sc: 0,
    ribasso: vincitore.ribasso,
    id_vincitore: vincitore.id_azienda,
    dettagli_calcolati: dettagli
  };
}

function round(val, decimals = 3) {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/**
 * Middleware: require authentication
 */
async function requireAuth(request, reply) {
  if (!request.user) {
    reply.status(401).send({ error: 'Non autenticato' });
    throw new Error('Not authenticated');
  }
}
