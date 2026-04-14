import { query } from '../db/pool.js';

/**
 * Check if a scheduled task can run today.
 * Returns false if it already ran successfully today (DB-backed idempotency).
 */
export async function canRunToday(taskTipo, targetHour) {
  const today = new Date().toISOString().split('T')[0];

  try {
    const { rows } = await query(
      'SELECT data_ultima_esecuzione, stato_ultima_esecuzione FROM tasks WHERE tipo = $1',
      [taskTipo]
    );

    if (!rows[0] || !rows[0].data_ultima_esecuzione) return true;

    const lastDay = rows[0].data_ultima_esecuzione.toISOString().split('T')[0];
    if (lastDay === today && rows[0].stato_ultima_esecuzione === 'successo') return false;
  } catch (err) {
    // tasks table may not exist — allow run
  }

  return new Date().getHours() >= targetHour;
}

/**
 * Record task execution result in DB.
 */
export async function markTaskRun(taskTipo, status, message, nextRunTimestamp) {
  try {
    // Upsert: update if exists, insert if not
    const { rowCount } = await query(
      `UPDATE tasks SET data_ultima_esecuzione=NOW(),
         stato_ultima_esecuzione=$2,
         messaggio_ultima_esecuzione=$3,
         prossima_esecuzione=$4,
         updated_at=NOW()
       WHERE tipo=$1`,
      [taskTipo, status, message, nextRunTimestamp]
    );

    if (rowCount === 0) {
      await query(
        `INSERT INTO tasks (tipo, nome, attivo, data_ultima_esecuzione, stato_ultima_esecuzione, messaggio_ultima_esecuzione, prossima_esecuzione)
         VALUES ($1, $1, true, NOW(), $2, $3, $4)`,
        [taskTipo, status, message, nextRunTimestamp]
      );
    }
  } catch (err) {
    console.error(`scheduler-helpers: markTaskRun failed for ${taskTipo}:`, err.message);
  }
}
