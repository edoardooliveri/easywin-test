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
import esitiAiRoutes from './routes/esiti-ai.js';
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
import pubblicoRoutes from './routes/pubblico.js';
import apiPubblicaRoutes from './routes/api-pubblica.js';
import sistemaRoutes from './routes/sistema.js';
import newsletterRoutes from './routes/newsletter.js';
import bandiImportRoutes from './routes/bandi-import.js';
import tasksManagerRoutes from './routes/tasks-manager.js';
import calendarioRoutes from './routes/calendario.js';
import provinceGestioneRoutes from './routes/province-gestione.js';
import seedRoutes from './routes/seed.js';

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

// Public routes (no auth)
await fastify.register(pubblicoRoutes, { prefix: '/api/pubblico' });

// Public API v1 (API key auth)
await fastify.register(apiPubblicaRoutes, { prefix: '/api/v1' });

// Admin routes
await fastify.register(adminDashboardRoutes, { prefix: '/api/admin' });
await fastify.register(adminGestionaleRoutes, { prefix: '/api/admin/gestionale' });
await fastify.register(adminAziendeRoutes, { prefix: '/api/admin/aziende' });
await fastify.register(adminStazioniRoutes, { prefix: '/api/admin/stazioni' });
await fastify.register(adminUtentiRoutes, { prefix: '/api/admin' });
await fastify.register(sistemaRoutes, { prefix: '/api/admin' });
await fastify.register(newsletterRoutes, { prefix: '/api/admin/newsletter' });
await fastify.register(bandiImportRoutes, { prefix: '/api/admin/bandi-import' });
await fastify.register(tasksManagerRoutes, { prefix: '/api/admin/tasks' });

// Calendar/Agenda
await fastify.register(calendarioRoutes, { prefix: '/api/calendario' });

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
fastify.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api')) {
    reply.code(404).send({ error: 'Endpoint API non trovato' });
  } else {
    reply.sendFile('index.html');
  }
});

// Start
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001');
    const host = process.env.HOST || '0.0.0.0';
    await fastify.listen({ port, host });
    console.log(`
  ╔══════════════════════════════════════════╗
  ║     easyWin API Server v3.0.0           ║
  ║     Running on ${host}:${port}             ║
  ╚══════════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
