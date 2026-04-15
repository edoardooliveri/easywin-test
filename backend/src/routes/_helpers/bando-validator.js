/**
 * Validation helpers for bandi POST / PUT payloads.
 *
 * - coerceBool: normalises truthy/falsy/string values to strict boolean or null
 * - validateBandoPayload: mutates payload in-place (coercion) and returns
 *   { ok, errors[] } with FK and range checks
 */

const BOOL_FIELDS = [
  'sped_posta', 'sped_corriere', 'sped_mano', 'sped_pec', 'sped_telematica',
  'annullato', 'rettificato', 'categoria_presunta', 'accorpa_ali',
];

/**
 * Coerce a value to strict boolean.
 * Accepts: true/false, "true"/"false", "on"/"off", 1/0, "1"/"0", null, undefined.
 * Returns: true | false | null  (null when value is null/undefined/empty-string)
 * Throws on unrecognised input.
 */
export function coerceBool(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (value === true || value === 'true' || value === 'on' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 'off' || value === 0 || value === '0') return false;
  throw new Error(`Campo '${fieldName}': valore booleano non valido (${JSON.stringify(value)})`);
}

/**
 * Validate and coerce a bando payload before INSERT / UPDATE.
 *
 * @param {object} payload - request body (mutated in-place for coercion)
 * @param {Function} queryFn - async (sql, params) => { rows }
 * @returns {{ ok: boolean, errors: string[] }}
 */
export async function validateBandoPayload(payload, queryFn) {
  const errors = [];

  // ── Boolean coercion ──
  for (const f of BOOL_FIELDS) {
    if (payload[f] !== undefined) {
      try {
        payload[f] = coerceBool(payload[f], f);
      } catch (e) {
        errors.push(e.message);
      }
    }
  }

  // ── n_decimali: integer 0-4 ──
  if (payload.n_decimali !== undefined && payload.n_decimali !== null) {
    const n = Number(payload.n_decimali);
    if (!Number.isInteger(n) || n < 0 || n > 4) {
      errors.push("Campo 'n_decimali': deve essere un intero tra 0 e 4");
    } else {
      payload.n_decimali = n;
    }
  }

  // ── max_invitati_negoziate: integer >= 0 ──
  if (payload.max_invitati_negoziate !== undefined && payload.max_invitati_negoziate !== null) {
    const n = Number(payload.max_invitati_negoziate);
    if (!Number.isInteger(n) || n < 0) {
      errors.push("Campo 'max_invitati_negoziate': deve essere un intero >= 0");
    } else {
      payload.max_invitati_negoziate = n;
    }
  }

  // ── id_azienda_dedicata: FK check ──
  if (payload.id_azienda_dedicata !== undefined && payload.id_azienda_dedicata !== null) {
    const id = Number(payload.id_azienda_dedicata);
    if (!Number.isInteger(id) || id <= 0) {
      errors.push("Campo 'id_azienda_dedicata': deve essere un intero positivo");
    } else {
      payload.id_azienda_dedicata = id;
      const res = await queryFn('SELECT 1 FROM aziende WHERE id = $1', [id]);
      if (res.rows.length === 0) {
        errors.push(`Campo 'id_azienda_dedicata': azienda con id ${id} non trovata`);
      }
    }
  }

  // ── id_tipo_sopralluogo: FK check ──
  if (payload.id_tipo_sopralluogo !== undefined && payload.id_tipo_sopralluogo !== null) {
    const id = Number(payload.id_tipo_sopralluogo);
    if (!Number.isInteger(id) || id < 0) {
      errors.push("Campo 'id_tipo_sopralluogo': deve essere un intero >= 0");
    } else {
      payload.id_tipo_sopralluogo = id;
      const res = await queryFn('SELECT 1 FROM tipo_sopralluogo WHERE id = $1', [id]);
      if (res.rows.length === 0) {
        errors.push(`Campo 'id_tipo_sopralluogo': valore ${id} non valido`);
      }
    }
  }

  // ── privato: integer 0, 1, 2 ──
  if (payload.privato !== undefined && payload.privato !== null) {
    const n = Number(payload.privato);
    if (![0, 1, 2].includes(n)) {
      errors.push("Campo 'privato': deve essere 0 (Pubblico), 1 (Privato) o 2 (Azienda)");
    } else {
      payload.privato = n;
    }
  }

  return { ok: errors.length === 0, errors };
}
