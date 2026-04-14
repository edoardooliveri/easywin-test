/**
 * Presidia Import Scheduler
 *
 * Schedula import automatici da Presidia agli orari:
 * - 11:00, 12:00, 13:00, 14:00, 15:00, 16:00
 * - 16:45, 17:15, 17:45, 18:15, 18:45, 19:15
 * - 04:00 (riepilogo notturno, finestra ieri-oggi)
 *
 * Dopo le 04:00 triggera il newsletter scheduler (già attivo a 04:30).
 */

import { query } from '../db/pool.js';
import { runImportPresidia } from './presidia-import.js';
import { sendEmail } from './email-service.js';
import { DEFAULT_ENDPOINT } from './presidia-soap.js';

// Slot giornalieri: array di [hour, minute]
const SLOTS_GIORNALIERI = [
  [11, 0], [12, 0], [13, 0], [14, 0], [15, 0], [16, 0],
  [16, 45], [17, 15], [17, 45], [18, 15], [18, 45], [19, 15],
];
const SLOT_RIEPILOGO = [4, 0];

const CHECK_INTERVAL_MS = 60 * 1000;       // check ogni 1 minuto
const SLOT_TOLERANCE_MIN = 4;              // entro 4 min dallo slot previsto
const RETRY_BACKOFF_MS = [30_000, 120_000, 300_000]; // 30s, 2min, 5min
const CONSECUTIVE_FAIL_ALERT = 3;          // email admin dopo 3 fail di fila

let _interval = null;
let _consecutiveFails = 0;

export function startPresidiaScheduler(fastify) {
  if (process.env.PRESIDIA_AUTO !== 'true') {
    console.log('Presidia scheduler disabilitato (set PRESIDIA_AUTO=true per attivare)');
    return;
  }

  console.log('Presidia scheduler avviato');
  console.log(`   Slot: ${SLOTS_GIORNALIERI.map(s => s.map(n => String(n).padStart(2, '0')).join(':')).join(', ')}`);
  console.log(`   Riepilogo notturno: ${SLOT_RIEPILOGO.map(n => String(n).padStart(2, '0')).join(':')}`);

  _interval = setInterval(() => checkAndRun(fastify), CHECK_INTERVAL_MS);
}

export function stopPresidiaScheduler() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

async function checkAndRun(fastify) {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const today = now.toISOString().split('T')[0];

  // Trova slot matching
  const allSlots = [
    ...SLOTS_GIORNALIERI.map(s => ({ h: s[0], m: s[1], tipo: 'scheduled' })),
    { h: SLOT_RIEPILOGO[0], m: SLOT_RIEPILOGO[1], tipo: 'riepilogo' }
  ];

  for (const slot of allSlots) {
    if (h === slot.h && Math.abs(m - slot.m) <= SLOT_TOLERANCE_MIN) {
      const slotKey = `${today}_${String(slot.h).padStart(2, '0')}:${String(slot.m).padStart(2, '0')}_${slot.tipo}`;

      // Idempotenza: già eseguito?
      try {
        const check = await query(
          'SELECT id FROM presidia_import_runs WHERE slot_key = $1',
          [slotKey]
        );
        if (check.rows.length > 0) return; // già fatto
      } catch (err) {
        fastify.log.error({ err: err.message }, 'Presidia scheduler: errore check idempotenza');
        return;
      }

      // Esegui run (con retry)
      await runImportWithRetry(fastify, slot, slotKey, today);
      return; // solo un run per tick
    }
  }
}

async function runImportWithRetry(fastify, slot, slotKey, today) {
  const startMs = Date.now();
  let lastError = null;
  let attempt = 0;

  // Data range: riepilogo = ieri-oggi, altrimenti solo oggi
  const dataDal = slot.tipo === 'riepilogo'
    ? new Date(Date.now() - 86400_000).toISOString().split('T')[0]
    : today;
  const dataAl = today;

  for (attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retry ${attempt} per ${slotKey} dopo ${RETRY_BACKOFF_MS[attempt - 1]}ms`);
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1]));
      }
      const stats = await runImportPresidia({ dataDal, dataAl, tipo: slot.tipo, createdBy: 'system', fastify });

      // Success → log + reset counter
      await query(
        `INSERT INTO presidia_import_runs
         (slot_key, tipo, data_dal, data_al, total_presidia, imported, updated, skipped, errors,
          duration_ms, success, retry_count, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, 'system')
         ON CONFLICT (slot_key) DO NOTHING`,
        [slotKey, slot.tipo, dataDal, dataAl,
         stats.total_presidia, stats.imported, stats.updated || 0, stats.skipped, stats.errors,
         Date.now() - startMs, attempt]
      );

      _consecutiveFails = 0;
      console.log(`Presidia ${slotKey}: imported=${stats.imported}, updated=${stats.updated || 0}, skipped=${stats.skipped}, errors=${stats.errors}`);

      // Se è il riepilogo 04:00, triggera newsletter (già schedulato a 04:30, solo log)
      if (slot.tipo === 'riepilogo') {
        console.log('Newsletter scheduler partira alle 04:30');
      }
      return;
    } catch (err) {
      lastError = err;
      fastify.log.warn({ err: err.message, attempt, slotKey }, 'Presidia import tentativo fallito');
    }
  }

  // Tutti i retry falliti → log failure
  try {
    await query(
      `INSERT INTO presidia_import_runs
       (slot_key, tipo, data_dal, data_al, duration_ms, success, retry_count, error_detail, created_by)
       VALUES ($1, $2, $3, $4, $5, false, $6, $7, 'system')
       ON CONFLICT (slot_key) DO NOTHING`,
      [slotKey, slot.tipo, dataDal, dataAl, Date.now() - startMs, attempt,
       JSON.stringify({ message: lastError?.message, stack: lastError?.stack?.slice(0, 1000) })]
    );
  } catch (e) {
    fastify.log.error({ err: e.message }, 'Presidia scheduler: errore log failure');
  }

  _consecutiveFails++;
  console.error(`Presidia ${slotKey} fallito dopo ${attempt} retry: ${lastError?.message}`);

  if (_consecutiveFails >= CONSECUTIVE_FAIL_ALERT) {
    await sendFailureAlert(_consecutiveFails, lastError);
  }
}

async function sendFailureAlert(count, err) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  try {
    await sendEmail(
      adminEmail,
      `Presidia scheduler: ${count} run consecutivi falliti`,
      `<p>Presidia SOAP risulta irraggiungibile da ${count} run consecutivi.</p>
       <p><b>Ultimo errore:</b> ${err?.message || 'unknown'}</p>
       <p>Verifica connessione a <code>${process.env.PRESIDIA_SOAP_URL || DEFAULT_ENDPOINT}</code></p>`
    );
  } catch (e) {
    console.error('Invio alert admin fallito:', e.message);
  }
}
