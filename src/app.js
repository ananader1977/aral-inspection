import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getSettings } from './db.js';
import { createApp, createRateLimiter } from './http.js';
import { createAuth, ensureSuperAdmin } from './auth.js';
import { createAdmin } from './admin.js';
import { createMailer } from './mailer.js';
import { seedReference, seedDemo } from './seed.js';
import { createPricing } from './pricing.js';
import { createLeads } from './leads.js';
import { registerRoutes } from './routes.js';

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
  ctx.seeded = seedReference(db, now);
  ctx.createdUsers = ensureSuperAdmin(ctx);
  if (config.seedDemo) ctx.createdUsers.push(...seedDemo(db, now, config.demoPassword));
  return ctx;
}

export function createWebApp(ctx) {
  const app = createApp({ publicDir: path.join(here, '..', 'public') });
  registerRoutes(app, ctx);
  return app;
}
