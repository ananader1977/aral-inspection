import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getSettings } from './db.js';
import { createApp, createRateLimiter } from './http.js';
import { createAuth, ensureSuperAdmin } from './auth.js';
import { createAdmin } from './admin.js';
import { createMailer } from './mailer.js';
import { seedReference, seedDemo, upgradeChecklists, upgradeLookups } from './seed.js';
import { createPricing } from './pricing.js';
import { createLeads } from './leads.js';
import { registerRoutes } from './routes.js';
import { createStorage } from './storage.js';
import { createJobs } from './jobs.js';
import { createReports } from './reports.js';
import { createFinance } from './finance.js';
import { createDocs } from './docs.js';
import { createPayments } from './payments.js';
import { createAi } from './ai.js';
import { createBackup } from './backup.js';
import { createPush } from './push.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Builds all services around one SQLite database. `now` is injectable so tests can control time. */
export function createContext({ config, now = () => Date.now() }) {
  const db = openDb(config.dbPath);
  const ctx = { config, db, now };
  ctx.settings = () => getSettings(db);
  ctx.limit = createRateLimiter(() => now());
  ctx.mailer = createMailer(ctx);
  ctx.admin = createAdmin(ctx);
  ctx.auth = createAuth(ctx);
  ctx.pricing = createPricing(ctx);
  ctx.leads = createLeads(ctx);
  ctx.push = createPush(ctx);
  ctx.storage = createStorage(ctx);
  ctx.jobs = createJobs(ctx);
  ctx.reports = createReports(ctx);
  ctx.finance = createFinance(ctx);
  ctx.docs = createDocs(ctx);
  ctx.payments = createPayments(ctx);
  ctx.ai = createAi(ctx);
  ctx.backup = createBackup(ctx);
  ctx.seeded = seedReference(db, now);
  if (upgradeLookups(db)) console.log('[setup] Lost reasons updated: High Price, Customer Not Interested.');
  if (upgradeChecklists(db, now)) console.log('[setup] Checklist upgraded: proper items for Air Conditioning, Electrical and Water Heater.');
  ctx.createdUsers = ensureSuperAdmin(ctx);
  if (config.seedDemo) ctx.createdUsers.push(...seedDemo(db, now, config.demoPassword));
  return ctx;
}

export function createWebApp(ctx) {
  const app = createApp({ publicDir: path.join(here, '..', 'public') });
  registerRoutes(app, ctx);
  return app;
}
