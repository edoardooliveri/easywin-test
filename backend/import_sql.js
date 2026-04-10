import fs from 'fs';
import { query } from './src/db/pool.js';

async function run() {
  try {
    const sql = fs.readFileSync('../import_dati_riferimento.sql', 'utf8');
    console.log('Eseguendo lo script SQL...');
    const result = await query(sql);
    console.log('Script eseguito con successo!');
  } catch (err) {
    console.error('Errore durante l\'esecuzione:', err);
  } finally {
    process.exit(0);
  }
}
run();
