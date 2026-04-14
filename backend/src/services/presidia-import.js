/**
 * Presidia Import Service
 *
 * Logica di import bandi da Presidia riutilizzabile:
 * - Chiamata manuale da route POST /api/presidia/import
 * - Chiamata automatica da presidia-scheduler.js
 */

import { query } from '../db/pool.js';
import {
  PresidiaClient, normalizePresidiaBando, downloadAllegato, DEFAULT_ENDPOINT
} from './presidia-soap.js';

let _client = null;
function getClient() {
  if (!_client) _client = new PresidiaClient(process.env.PRESIDIA_SOAP_URL || DEFAULT_ENDPOINT);
  return _client;
}

/**
 * Esegue l'import bandi da Presidia.
 * Gestisce sia nuovi bandi che rettifiche (bandi già esistenti con dati cambiati).
 */
export async function runImportPresidia({ dataDal, dataAl, tipo = 'scheduled', createdBy = 'system', fastify, maxResults = 500 }) {
  const client = getClient();
  const rawBandi = await client.recuperaBandiAttivi(dataDal, dataAl);

  const stats = {
    imported: 0, updated: 0, skipped: 0, errors: 0,
    total_presidia: rawBandi?.length || 0,
    error_details: [], imported_list: []
  };
  if (!rawBandi || rawBandi.length === 0) return stats;

  const limit = Math.min(rawBandi.length, maxResults);

  for (let i = 0; i < limit; i++) {
    const raw = rawBandi[i];
    try {
      const bando = normalizePresidiaBando(raw);
      if (!bando.external_code) { stats.errors++; continue; }

      const existing = await query(
        'SELECT id, titolo, data_offerta, importo_so FROM bandi WHERE external_code = $1 AND provenienza = $2',
        [String(bando.external_code), 'Presidia']
      );

      if (existing.rows.length > 0) {
        // ============ RETTIFICA ============
        const existingBando = existing.rows[0];
        const diff = computeDiff(existingBando, bando);

        if (Object.keys(diff).length === 0) {
          stats.skipped++;
          continue;
        }

        // UPDATE campi volatili + flag rettificato
        await query(
          `UPDATE bandi SET
             titolo = $1, data_offerta = $2, data_apertura = $3,
             data_sop_start = $4, data_sop_end = $5,
             importo_so = $6, importo_co = $7, stazione_nome = $8,
             rettificato = true,
             data_rettifica = NOW(),
             numero_rettifiche = COALESCE(numero_rettifiche, 0) + 1,
             updated_at = NOW()
           WHERE id = $9`,
          [bando.titolo, bando.data_offerta, bando.data_apertura,
           bando.data_sop_start, bando.data_sop_end,
           bando.importo_so, bando.importo_co, bando.stazione?.nome || null,
           existingBando.id]
        );

        // INSERT in bandimodifiche (audit log per pagina "Rettificati")
        const diffText = Object.entries(diff).map(([k, v]) => `${k}: "${v.old}" → "${v.new}"`).join('; ');
        await query(
          `INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data)
           VALUES ($1, 'presidia-scheduler', $2, NOW())`,
          [existingBando.id, `rettifica Presidia: ${diffText.slice(0, 500)}`]
        );

        stats.updated++;
      } else {
        // ============ NUOVO BANDO ============
        const id_stazione = await findOrCreateStazione(bando.stazione);
        const id_soa = await findSoa(bando.soa_codice);
        const provinceIds = await resolveProvince(bando.province);

        const ins = await query(
          `INSERT INTO bandi (
            titolo, id_stazione, stazione_nome,
            data_pubblicazione, data_offerta, data_apertura, data_sop_start, data_sop_end,
            codice_cig, codice_cup, id_soa, soa_val, categoria_presunta,
            importo_so, importo_co,
            provenienza, external_code, fonte_dati,
            inserito_da, note, ai_extracted_data,
            created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW())
          RETURNING id`,
          [
            bando.titolo, id_stazione, bando.stazione?.nome || null,
            bando.data_pubblicazione, bando.data_offerta, bando.data_apertura,
            bando.data_sop_start, bando.data_sop_end,
            bando.codice_cig, bando.codice_cup, id_soa, bando.soa_codice ? 1 : 0, bando.categoria_presunta || false,
            bando.importo_so, bando.importo_co,
            'Presidia', String(bando.external_code), bando.fonte_dati || null,
            createdBy, `Import ${tipo} Presidia ${new Date().toISOString().split('T')[0]}`,
            JSON.stringify({ presidia_raw: raw, mapped: bando })
          ]
        );

        const newId = ins.rows[0].id;

        // Province + SOA secondarie
        for (const pid of provinceIds) {
          await query(`INSERT INTO bandi_province (id_bando, id_provincia) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [newId, pid]);
        }
        for (const sec of bando.soa_secondarie) {
          const sid = await findSoa(sec.codice_mappato);
          if (sid) {
            const table = sec.tipo === 'alternativa' ? 'bandi_soa_alt' : 'bandi_soa_sec';
            await query(`INSERT INTO ${table} (id_bando, id_soa) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [newId, sid]);
          }
        }

        // Download allegato in background
        downloadAllegatoForBando(newId, bando.external_code, fastify).catch(err => {
          fastify?.log?.warn({ err: err.message, bando_id: newId }, 'Download allegato fallito');
        });

        stats.imported++;
        stats.imported_list.push({ id: newId, codice: bando.external_code, titolo: bando.titolo?.substring(0, 60) });
      }
    } catch (err) {
      stats.errors++;
      stats.error_details.push({
        codice: raw.Appalto || raw.Codice || 'N/A',
        error: err.message
      });
    }
  }

  return stats;
}

// ============================================================
// HELPER FUNCTIONS (moved from routes/presidia.js)
// ============================================================

function computeDiff(existing, nuovo) {
  const diff = {};
  if (existing.titolo !== nuovo.titolo && nuovo.titolo) diff.titolo = { old: existing.titolo, new: nuovo.titolo };
  if (!datesEqual(existing.data_offerta, nuovo.data_offerta)) diff.data_offerta = { old: existing.data_offerta, new: nuovo.data_offerta };
  if (Number(existing.importo_so) !== Number(nuovo.importo_so) && nuovo.importo_so) diff.importo_so = { old: existing.importo_so, new: nuovo.importo_so };
  return diff;
}

function datesEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

export async function findOrCreateStazione(stazioneData) {
  if (!stazioneData || !stazioneData.nome) return null;

  if (stazioneData.id_presidia) {
    const byPresidia = await query(
      `SELECT id FROM stazioni WHERE id_presidia = $1 LIMIT 1`,
      [stazioneData.id_presidia]
    );
    if (byPresidia.rows.length > 0) return byPresidia.rows[0].id;
  }

  const byName = await query(
    `SELECT id FROM stazioni WHERE nome ILIKE $1 LIMIT 1`,
    [stazioneData.nome]
  );
  if (byName.rows.length > 0) return byName.rows[0].id;

  const result = await query(
    `INSERT INTO stazioni (nome, citta, indirizzo, cap, id_presidia, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
    [
      stazioneData.nome,
      stazioneData.citta || null,
      stazioneData.indirizzo || null,
      stazioneData.cap || null,
      stazioneData.id_presidia || null
    ]
  );
  return result.rows[0].id;
}

export async function findSoa(codice) {
  if (!codice) return null;
  const result = await query(
    `SELECT id FROM soa WHERE cod = $1 OR cod ILIKE $1 LIMIT 1`,
    [codice]
  );
  return result.rows.length > 0 ? result.rows[0].id : null;
}

export async function resolveProvince(sigle) {
  if (!sigle || sigle.length === 0) return [];
  const ids = [];
  for (const sigla of sigle) {
    const result = await query(
      `SELECT id FROM province WHERE sigla ILIKE $1 LIMIT 1`,
      [sigla]
    );
    if (result.rows.length > 0) ids.push(result.rows[0].id);
  }
  return ids;
}

async function downloadAllegatoForBando(bandoId, externalCode, fastify) {
  if (!externalCode) return;
  const allegato = await downloadAllegato(externalCode);
  if (allegato && allegato.length > 0) {
    await query(
      `INSERT INTO allegati_bando (id_bando, nome_file, tipo, dimensione, dati, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT DO NOTHING`,
      [bandoId, 'Bando.zip', 'application/zip', allegato.length, allegato]
    );
  }
}
