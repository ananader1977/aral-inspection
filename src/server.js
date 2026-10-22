import { loadConfig, validateConfig } from './config.js';
import { createContext, createWebApp } from './app.js';

const config = loadConfig();
const problems = validateConfig(config);
if (problems.length) {
  console.error('Configuration problems:\n - ' + problems.join('\n - '));
  process.exit(1);
}
const ctx = createContext({ config });
const server = createWebApp(ctx).server();

if (ctx.seeded) console.log('[setup] Service catalogue, prices, picklists, checklists and draft report wording loaded.');
if (ctx.createdUsers.length) {
  console.log('\n=== Accounts created ===');
  for (const u of ctx.createdUsers) console.log(`  ${u.role.padEnd(12)} ${u.email}   password: ${u.password || '(from environment)'}`);
  console.log('Generated passwords are shown once. Change them after signing in.\n');
}
if (config.paymentProvider === 'mock') console.warn('[info] PAYMENT_PROVIDER=mock: card payments use the DEMO checkout (no real money).');
if (!config.smtp.host) console.warn('[info] SMTP not configured: emails are only logged (Settings > Messages).');
if (config.ai.apiKey) console.log(`[info] AI photo suggestions: ${ctx.ai.label()}, model ${ctx.ai.model()}.`);
if (!config.require2fa) console.warn('[warn] REQUIRE_2FA=false: two-step sign-in is not enforced. Use only for testing.');

// hourly: expire old quotations, send overdue-invoice reminders
const tick = () => ctx.finance.tick().then((r) => { if (r.expired || r.reminded) console.log(`[tick] quotes expired: ${r.expired}, reminders sent: ${r.reminded}`); }).catch((e) => console.error('[tick]', e.message));
setTimeout(tick, 30000).unref();
setInterval(tick, 60 * 60 * 1000).unref();

server.listen(config.port, () => console.log(`ARAL inspection app running at ${config.baseUrl} (port ${config.port})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
