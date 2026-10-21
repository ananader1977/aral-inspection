// Online card payments: a built-in DEMO checkout (default, test card 4242 4242 4242 4242) or Stripe Checkout (AED).
// Switch with PAYMENT_PROVIDER=stripe + STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET. Same pattern as the Dar Al Bunyan app.
// A checkout pays either a quotation (advance before the inspection) or an invoice (balance / credit clients).
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { safeEqual } from './auth.js';

const STRIPE_API = 'https://api.stripe.com/v1';

export function createPayments(ctx) {
  return ctx.config.paymentProvider === 'stripe' ? stripeProvider(ctx) : mockProvider(ctx);
}
const insertSession = (ctx, id, t, provider) =>
  ctx.db.prepare('INSERT INTO payment_sessions(id,quotation_id,invoice_id,provider,status,amount,return_url,initiated_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, t.kind === 'quote' ? t.id : null, t.kind === 'invoice' ? t.id : null, provider, 'open', t.amount, t.returnUrl || null, t.userId || null, ctx.now());

function mockProvider(ctx) {
  const { db, config } = ctx;
  return {
    name: 'mock',
    /** t = {kind:'quote'|'invoice', id, number, amount, email, back} → {id, url} */
    async createCheckout(t) {
      const id = `demo_${crypto.randomBytes(9).toString('hex')}`;
      insertSession(ctx, id, t, 'mock');
      return { id, url: `${config.baseUrl}/pay-demo.html?s=${id}` };
    },
    async retrieve(sessionId) {
      const s = db.prepare('SELECT * FROM payment_sessions WHERE id=?').get(sessionId);
      return s ? { paid: s.status === 'paid', paymentRef: s.payment_ref } : { paid: false };
    },
    session: (sessionId) => db.prepare('SELECT * FROM payment_sessions WHERE id=? AND provider=?').get(sessionId, 'mock'),
    /** Demo only: the payer presses "Pay" on the demo checkout page with a test card. */
    completeMock(sessionId, card) {
      const s = db.prepare('SELECT * FROM payment_sessions WHERE id=?').get(sessionId);
      if (!s || s.provider !== 'mock') throw new HttpError(404, 'Payment session not found');
      const digits = String(card || '').replace(/\D/g, '');
      if (digits === '4000000000000002') throw new HttpError(402, 'The card was declined (demo decline card).');
      if (!/^4242(4242){3}$/.test(digits)) throw new HttpError(400, 'Demo mode: use the test card 4242 4242 4242 4242.');
      const ref = s.payment_ref || `demo_pi_${crypto.randomBytes(8).toString('hex')}`;
      db.prepare("UPDATE payment_sessions SET status='paid', payment_ref=? WHERE id=?").run(ref, sessionId);
      return { ...s, payment_ref: ref, already: s.status === 'paid' };
    },
  };
}

function stripeProvider(ctx) {
  const { db, config } = ctx;
  const call = async (method, path, params) => {
    const res = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.stripe.secretKey}`, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: params ? new URLSearchParams(params).toString() : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, `Stripe: ${data?.error?.message || res.status}`);
    return data;
  };
  return {
    name: 'stripe',
    async createCheckout(t) {
      const data = await call('POST', '/checkout/sessions', {
        mode: 'payment', 'payment_method_types[0]': 'card',
        success_url: `${t.back}${t.back.includes('?') ? '&' : '?'}done=1&s={CHECKOUT_SESSION_ID}`, cancel_url: t.returnUrl || t.back,
        ...(t.email ? { customer_email: t.email } : {}),
        client_reference_id: `${t.kind}:${t.id}`, 'metadata[kind]': t.kind, 'metadata[id]': String(t.id), 'metadata[number]': t.number,
        'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'aed',
        'line_items[0][price_data][unit_amount]': String(Math.round(t.amount * 100)),
        'line_items[0][price_data][product_data][name]': `${t.kind === 'quote' ? 'Inspection booking' : 'Invoice'} ${t.number}`,
      });
      insertSession(ctx, data.id, t, 'stripe');
      return { id: data.id, url: data.url };
    },
    async retrieve(sessionId) {
      const s = await call('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
      return { paid: s.payment_status === 'paid', paymentRef: s.payment_intent || s.id };
    },
    session: (sessionId) => db.prepare('SELECT * FROM payment_sessions WHERE id=?').get(sessionId),
    verifyWebhook(rawBody, header) {
      const secret = config.stripe.webhookSecret;
      if (!secret) throw new HttpError(400, 'Webhook secret not configured');
      const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')));
      if (!parts.t || !parts.v1) throw new HttpError(400, 'Bad signature header');
      const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody.toString('utf8')}`).digest('hex');
      if (!safeEqual(expected, parts.v1)) throw new HttpError(400, 'Invalid signature');
      if (Math.abs(ctx.now() / 1000 - Number(parts.t)) > 300) throw new HttpError(400, 'Signature timestamp too old');
      return JSON.parse(rawBody.toString('utf8'));
    },
  };
}
