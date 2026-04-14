import { query } from '../db/pool.js';

/**
 * Get active secondary emails for a user (CC recipients).
 * Returns [] if the table doesn't exist yet (created in commit 11).
 */
export async function getSecondaryEmails(userId) {
  if (!userId) return [];
  try {
    const { rows } = await query(
      `SELECT email FROM users_email_secondarie WHERE user_id=$1 AND attiva=true`,
      [userId]
    );
    return rows.map(r => r.email).filter(Boolean);
  } catch (err) {
    if (err.code === '42P01') return []; // table doesn't exist yet
    throw err;
  }
}
