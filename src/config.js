// Runtime configuration, read from environment variables (see .env.example).
export function loadConfig(env = process.env) {
  const port = Number(env.PORT) || 3000;
  const baseUrl = (env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
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

export function validateConfig(cfg) {
  const problems = [];
  if (!['mock', 'stripe'].includes(cfg.paymentProvider)) problems.push(`PAYMENT_PROVIDER must be "mock" or "stripe" (got "${cfg.paymentProvider}")`);
  if (cfg.paymentProvider === 'stripe' && !cfg.stripe.secretKey) problems.push('STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(cfg.superAdmin.email)) problems.push('SUPERADMIN_EMAIL is not a valid email address');
  return problems;
}
