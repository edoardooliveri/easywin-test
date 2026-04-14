import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fastifyStatic from '@fastify/static';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import bandiRoutes from './routes/bandi.js';
import presidiaRoutes from './routes/presidia.js';
import bandiAiRoutes from './routes/bandi-ai.js';
import esitiRoutes from './routes/esiti.js';
import esitiExportRoutes from './routes/esiti-export.js';
import esitiAiRoutes from './routes/esiti-ai.js';
import esitiToggleRoutes from './routes/esiti-toggle.js';
import esitiActionsRoutes from './routes/esiti-actions.js';
import simulazioniRoutes from './routes/simulazioni.js';
import rangeStatisticoRoutes from './routes/range-statistico.js';
import sopralluoghiMapRoutes from './routes/sopralluoghi-map.js';
import albiFornitoRoutes from './routes/albi-fornitori.js';
import authRoutes from './routes/auth.js';
import lookupRoutes from './routes/lookups.js';
import clientiRoutes from './routes/clienti.js';
import adminDashboardRoutes from './routes/admin-dashboard.js';
import adminGestionaleRoutes from './routes/admin-gestionale.js';
import adminAziendeRoutes from './routes/admin-aziende.js';
import adminStazioniRoutes from './routes/admin-stazioni.js';
import adminUtentiRoutes from './routes/admin-utenti.js';
import bandiServiziRoutes from './routes/bandi-servizi.js';
import concorrentiRoutes from './routes/concorrenti.js';
import intermediariRoutes from './routes/intermediari.js';
import esecutoriEsterniRoutes from './routes/esecutori-esterni.js';
import simulazioniEngineRoutes from './routes/simulazioni-engine.js';
import fontiWebRoutes from './routes/fonti-web.js';
import piattaformeRoutes from './routes/piattaforme.js';
import ricercaDoppiaRoutes from './routes/ricerca-doppia.js';
import soaRoutes from './routes/soa.js';
import avvalimentiRoutes from './routes/avvalimenti.js';
import abbonamentiRoutes from './routes/abbonamenti.js';
import syncUrlRoutes from './routes/sync-url.js';
import pubblicoRoutes from './routes/pubblico.js';
import apiPubblicaRoutes from './routes/api-pubblica.js';
import sistemaRoutes from './routes/sistema.js';
import newsletterRoutes from './routes/newsletter.js';
import bandiImportRoutes from './routes/bandi-import.js';
import bandiAllegatiRoutes from './routes/bandi-allegati.js';
import bandiExportRoutes from './routes/bandi-export.js';
import calendarioRoutes from './routes/calendario.js';
import appuntamentiRoutes from './routes/appuntamenti.js';
import provinceGestioneRoutes from './routes/province-gestione.js';
import seedRoutes from './routes/seed.js';
import { startNewsletterScheduler } from './services/newsletter-scheduler.js';
import { startAbbonamentoScheduler } from './services/abbonamenti-scheduler.js';
import { startFontiWebScheduler } from './services/fonti-web-scheduler.js';
import { startPresidiaScheduler } from './services/presidia-scheduler.js';
import rssRoutes from './routes/rss.js';

dotenv.config();

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty',
      options: { colorize: true }
    } : undefined
  }
});

// Plugins
await fastify.register(cors, {
  origin: process.env.NODE_ENV === 'production'
    ? ['https://www.easywin.it', 'https://easywin-test.onrender.com', 'https://console.neon.tech']
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'http://localhost:8080', 'http://localhost:8081', 'http://127.0.0.1:8080', 'http://127.0.0.1:8081'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
});

await fastify.register(multipart, {
  limits: {
    fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024,
    files: 10
  }
});

await fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'dev-secret-change-me'
});

// Auth decorator
fastify.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Non autorizzato' });
  }
});

// Admin check decorator
fastify.decorate('requireAdmin', async function (request, reply) {
  const role = request.user?.ruolo || request.user?.role;
  if (role !== 'admin' && role !== 'superadmin') {
    reply.status(403).send({ error: 'Accesso riservato agli amministratori' });
  }
});

// Health check
fastify.get('/api/health', async () => ({
  status: 'ok',
  service: 'easyWin API',
  version: '3.0.0',
  timestamp: new Date().toISOString()
}));

// Register routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(bandiRoutes, { prefix: '/api/bandi' });
await fastify.register(presidiaRoutes, { prefix: '/api/presidia' });
await fastify.register(bandiAiRoutes, { prefix: '/api/bandi-ai' });
await fastify.register(esitiRoutes, { prefix: '/api/esiti' });
await fastify.register(esitiExportRoutes, { prefix: '/api/esiti' });
await fastify.register(esitiToggleRoutes, { prefix: '/api/esiti' });
await fastify.register(esitiActionsRoutes, { prefix: '/api/esiti-actions' });
await fastify.register(esitiAiRoutes, { prefix: '/api/esiti-ai' });
await fastify.register(simulazioniRoutes, { prefix: '/api/simulazioni' });
await fastify.register(rangeStatisticoRoutes, { prefix: '/api/range-statistico' });
await fastify.register(sopralluoghiMapRoutes, { prefix: '/api/sopralluoghi-map' });
await fastify.register(albiFornitoRoutes, { prefix: '/api/albi-fornitori' });
await fastify.register(lookupRoutes, { prefix: '/api/lookups' });

// Client Portal routes
await fastify.register(clientiRoutes, { prefix: '/api/clienti' });

// Bandi Services (aperture, scritture, sopralluoghi, elaborati)
await fastify.register(bandiServiziRoutes, { prefix: '/api/bandi' });

// Bandi Allegati (upload, download, delete, list)
await fastify.register(bandiAllegatiRoutes, { prefix: '/api/bandi' });

// Bandi Export (PDF, XLSX)
await fastify.register(bandiExportRoutes, { prefix: '/api/bandi' });

// Entity management
await fastify.register(concorrentiRoutes, { prefix: '/api/concorrenti' });
await fastify.register(intermediariRoutes, { prefix: '/api/intermediari' });
await fastify.register(esecutoriEsterniRoutes, { prefix: '/api/esecutori-esterni' });

// Simulation engine (full 51-tipologie calculation)
await fastify.register(simulazioniEngineRoutes, { prefix: '/api/simulazioni-engine' });

// Fonti Web, Piattaforme, Ricerca Doppia
await fastify.register(fontiWebRoutes, { prefix: '/api/admin/fonti-web' });
await fastify.register(piattaformeRoutes, { prefix: '/api/piattaforme' });
await fastify.register(ricercaDoppiaRoutes, { prefix: '/api/ricerca-doppia' });

// Moduli portati dal vecchio sito (Abbonamenti area)
await fastify.register(soaRoutes, { prefix: '/api/soa' });
await fastify.register(avvalimentiRoutes, { prefix: '/api/avvalimenti' });
await fastify.register(abbonamentiRoutes, { prefix: '/api/abbonamenti' });
await fastify.register(syncUrlRoutes, { prefix: '/api/sync-url' });

// Public routes (no auth)
await fastify.register(pubblicoRoutes, { prefix: '/api/pubblico' });

// RSS Feeds (public, no auth)
await fastify.register(rssRoutes, { prefix: '/api/rss' });

// Public API v1 (API key auth)
await fastify.register(apiPubblicaRoutes, { prefix: '/api/v1' });

// Admin routes — wrapped in a scoped plugin so jwtVerify runs for every /api/admin/* request
await fastify.register(async function adminScope(instance) {
  // Automatically verify JWT for ALL admin routes
  instance.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'Non autorizzato' });
    }
    // Publisher role: block access to admin panels (utenti, aziende, dashboard, gestionale)
    const ruolo = request.user?.ruolo;
    if (ruolo === 'publisher') {
      const url = request.url;
      const blocked = ['/api/admin/utenti', '/api/admin/aziende', '/api/admin/dashboard', '/api/admin/gestionale', '/api/admin/stazioni'];
      if (blocked.some(prefix => url.startsWith(prefix))) {
        return reply.status(403).send({ error: 'Accesso non consentito per il ruolo publisher' });
      }
    }
  });

  await instance.register(adminDashboardRoutes);
  await instance.register(adminGestionaleRoutes, { prefix: '/gestionale' });
  await instance.register(adminAziendeRoutes, { prefix: '/aziende' });
  await instance.register(adminStazioniRoutes, { prefix: '/stazioni' });
  await instance.register(adminUtentiRoutes);
  await instance.register(sistemaRoutes);
  await instance.register(newsletterRoutes, { prefix: '/newsletter' });
  await instance.register(bandiImportRoutes, { prefix: '/bandi-import' });
}, { prefix: '/api/admin' });

// Calendar/Agenda
await fastify.register(calendarioRoutes, { prefix: '/api/calendario' });
await fastify.register(appuntamentiRoutes, { prefix: '/api/appuntamenti' });

// Province/Regioni/Comuni + File Downloads
await fastify.register(provinceGestioneRoutes, { prefix: '/api' });

// Temporary seed route for data import
await fastify.register(seedRoutes, { prefix: '/api/admin/seed' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  reply.status(error.statusCode || 500).send({
    error: error.message || 'Errore interno del server',
    statusCode: error.statusCode || 500
  });
});

// Security hook to prevent serving sensitive files statically
fastify.addHook('onRequest', (request, reply, done) => {
  const url = request.url;
  if (!url.startsWith('/api') && (url.includes('/backend') || url.includes('.env') || url.includes('.git'))) {
    reply.code(403).send({ error: 'Forbidden' });
    return;
  }
  done();
});


// Serve frontend static files from the parent directory
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, '../../'),
  prefix: '/', 
  index: 'index.html',
});

// Fallback for frontend client-side routing
// Step 5: /admin/* (senza estensione file) → serve admin/index.html (SPA con History API)
fastify.setNotFoundHandler((request, reply) => {
  const url = (request.url || '').split('?')[0];
  if (url.startsWith('/api')) {
    reply.code(404).send({ error: 'Endpoint API non trovato' });
    return;
  }
  // SPA admin: qualsiasi /admin/<qualcosa> che non corrisponde a un file statico
  // viene servito come admin/index.html (il client-side router fa il dispatch)
  if (url.startsWith('/admin/') || url === '/admin') {
    // Escludi comunque percorsi con estensione (asset mancanti → 404 normale)
    const last = url.split('/').pop();
    if (last && last.includes('.')) {
      reply.code(404).send({ error: 'Asset non trovato' });
      return;
    }
    reply.sendFile('admin/index.html');
    return;
  }
  reply.sendFile('index.html');
});

// Auto-migration: esegue migrazioni pending-only all'avvio (idempotente)
// Elenco delle migration da auto-applicare. Sono tutte scritte con IF NOT EXISTS
// quindi sicure da eseguire ripetutamente.
const AUTO_MIGRATIONS = [
  '014_utenti_abbonamento_complete.sql',
  '015_utenti_selezioni.sql',
  '016_utenti_filtri_bandi.sql',
  '017_bandi_privato_livelli.sql',
  '018_user_documents_doppie_login.sql',
  '019_fonti_web_scraper.sql',
  '020_tasks_newsletter.sql',
  '021_bandi_links.sql',
  '022_utenti_completo.sql',
  '023_sopralluoghi_align_schema.sql',
  '024_presidia_import_runs.sql',
];

async function runAutoMigrations() {
  const { default: pool } = await import('./db/pool.js');
  const { readFileSync } = await import('fs');
  for (const name of AUTO_MIGRATIONS) {
    const sqlPath = path.join(__dirname, 'db/migrations', name);
    try {
      const sql = readFileSync(sqlPath, 'utf8');
      await pool.query(sql);
      console.log(`✓ auto-migration ${name} applicata`);
    } catch (err) {
      console.error(`✗ auto-migration ${name} fallita:`, err.message);
    }
  }
}

// Start
const start = async () => {
  try {
    await runAutoMigrations();
    const port = parseInt(process.env.PORT || '3001');
    const host = process.env.HOST || '0.0.0.0';
    await fastify.listen({ port, host });

    // Avvia schedulers automatici
    startNewsletterScheduler(fastify);    // Newsletter personalizzata ore 4:00
    startAbbonamentoScheduler(fastify);   // Gestione abbonamenti ore 6:00
    startFontiWebScheduler(fastify);      // Sync fonti web ogni 10 min
    startPresidiaScheduler(fastify);       // Import automatico Presidia (13 slot/giorno + riepilogo 04:00)

    const presidiaStatus = process.env.PRESIDIA_AUTO === 'true' ? 'attivo (13 slot+riepilogo)' : 'disabilitato';
    console.log(`
  ╔══════════════════════════════════════════════╗
  ║     easyWin API Server v3.0.0               ║
  ║     Running on ${host}:${port}                 ║
  ║     Newsletter scheduler: attivo (4:30)     ║
  ║     Abbonamenti scheduler: attivo (6:00)    ║
  ║     Fonti Web scheduler: attivo (10min)     ║
  ║     Presidia scheduler: ${presidiaStatus.padEnd(20)}║
  ║     RSS feeds: /api/rss/bandi & esiti       ║
  ╚══════════════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
