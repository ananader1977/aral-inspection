import { pushConfig } from './push.js';

// Runtime configuration, read from environment variables (see .env.example).
export function loadConfig(env = process.env) {
  const port = Number(env.PORT) || 3000;
  const baseUrl = resolveBaseUrl(env, port);
  return {
    nodeEnv: env.NODE_ENV || 'development',
    port,
    baseUrl,
    secureCookies: baseUrl.startsWith('https://'),
    dbPath: env.DB_PATH || './data/app.db',
    // The owner account. If SUPERADMIN_PASSWORD is empty on first start, a password is generated and printed once.
    superAdmin: {
      email: (env.SUPERADMIN_EMAIL || 'ananader1@gmail.com').trim().toLowerCase(),
      name: env.SUPERADMIN_NAME || 'Anas',
      password: env.SUPERADMIN_PASSWORD || '',
    },
    // 2FA (authenticator app) for Super Admin, Admin, Reviewer and Accountant. Set REQUIRE_2FA=false only for local testing.
    require2fa: env.REQUIRE_2FA !== 'false',
    // Adds demo users, inspectors, equipment and a valuation partner so every screen has something to show.
    seedDemo: env.SEED_DEMO === 'true',
    demoPassword: env.DEMO_PASSWORD || '',
    paymentProvider: (env.PAYMENT_PROVIDER || 'mock').toLowerCase(),
    // AI photo suggestions (Claude). Leave ANTHROPIC_API_KEY empty to hide the feature.
    ai: aiConfig(env),
    // Nightly database backup (Google Drive when set up). BACKUP_KEY encrypts the copies; keep it safe, it is needed to restore.
    backup: { key: env.BACKUP_KEY || '', keep: Number(env.BACKUP_KEEP) || 30 },
    // Phone notifications for the mobile app (Android: FCM_SERVICE_ACCOUNT, iPhone: APNS_*). Optional.
    push: pushConfig(env),
    stripe: { secretKey: env.STRIPE_SECRET_KEY || '', webhookSecret: env.STRIPE_WEBHOOK_SECRET || '' },
    smtp: {
      host: (env.SMTP_HOST || '').trim(),
      port: Number(env.SMTP_PORT) || 587,
      secure: env.SMTP_SECURE === 'true',
      user: (env.SMTP_USER || '').trim(),
      pass: (env.SMTP_PASS || '').replace(/\s+/g, ''), // Gmail app passwords are shown with spaces
      from: env.SMTP_FROM || '',
      rejectUnauthorized: env.SMTP_REJECT_UNAUTHORIZED !== 'false',
    },
    drive: {
      clientId: (env.GOOGLE_CLIENT_ID || '').trim(),
      clientSecret: (env.GOOGLE_CLIENT_SECRET || '').trim(),
      refreshToken: (env.GOOGLE_REFRESH_TOKEN || '').trim(),
      folderId: (env.GOOGLE_DRIVE_FOLDER_ID || '').trim(),
    },
    uploadDir: env.UPLOAD_DIR || '',
    disableRateLimit: env.DISABLE_RATE_LIMIT === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
  };
}

/**
 * The public address used in every link we email (quotation, signing, payment, report).
 * - Only the origin is kept: "https://x.onrender.com/app/" becomes "https://x.onrender.com".
 * - Render sets RENDER_EXTERNAL_URL itself. It is used when BASE_URL is empty, and also when BASE_URL names a
 *   different *.onrender.com address (a typo or the example from the README), which would open Render's 404 page.
 *   A custom domain in BASE_URL (e.g. https://app.aral.ae) is always kept.
 */
/** AI_PROVIDER = gemini | claude. When it is not set, the provider whose key is present is used (Gemini first). */
export function aiConfig(env) {
  const gem = (env.GEMINI_API_KEY || '').trim(), cla = (env.ANTHROPIC_API_KEY || '').trim();
  const want = (env.AI_PROVIDER || '').trim().toLowerCase();
  const provider = want === 'gemini' || want === 'claude' ? want : gem ? 'gemini' : 'claude';
  // a model name from the other provider (e.g. AI_MODEL=claude-… while AI_PROVIDER=gemini) is ignored
  let model = (env.AI_MODEL || '').trim();
  if (model && !model.toLowerCase().startsWith(provider === 'gemini' ? 'gemini' : 'claude')) {
    console.warn(`[config] AI_MODEL "${model}" is not a ${provider} model; using the default ${provider} model. Clear AI_MODEL on Render.`);
    model = '';
  }
  return { provider, apiKey: provider === 'gemini' ? gem : cla, model, baseUrl: (env.AI_BASE_URL || '').trim(), paidTier: env.GEMINI_PAID_TIER === 'true' };
}

export function resolveBaseUrl(env, port) {
  const origin = (u) => { try { return new URL(String(u).trim()).origin; } catch { return ''; } };
  let set = origin(env.BASE_URL || '');
  const render = origin(env.RENDER_EXTERNAL_URL || '');
  // a code-hosting address (e.g. the GitHub repository link) is never where the app runs
  if (set && /(^|\.)(github\.com|githubusercontent\.com|gitlab\.com|bitbucket\.org|render\.com)$/i.test(new URL(set).hostname) && !/\.onrender\.com$/i.test(new URL(set).hostname)) {
    console.warn(`[config] BASE_URL (${env.BASE_URL}) is a code or dashboard address, not the app. ${render ? `Using ${render} for links.` : 'Set BASE_URL to the app address.'}`);
    set = '';
  }
  if (render && (!set || (/\.onrender\.com$/i.test(new URL(set).hostname) && set !== render))) {
    if (set) console.warn(`[config] BASE_URL (${set}) is not this service's address; using ${render} for links. Update BASE_URL on Render.`);
    return render;
  }
  return set || `http://localhost:${port}`;
}

export function validateConfig(cfg) {
  const problems = [];
  if (!['mock', 'stripe'].includes(cfg.paymentProvider)) problems.push(`PAYMENT_PROVIDER must be "mock" or "stripe" (got "${cfg.paymentProvider}")`);
  if (cfg.paymentProvider === 'stripe' && !cfg.stripe.secretKey) problems.push('STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(cfg.superAdmin.email)) problems.push('SUPERADMIN_EMAIL is not a valid email address');
  return problems;
}
