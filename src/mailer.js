// Sends email through Gmail (SMTP app password) and logs every message in the outbox (Settings > Messages).
// Without SMTP settings the message is only logged, with status "logged".
import { sendMail } from './smtp.js';

export function createMailer(ctx) {
  const { db, config } = ctx;
  const log = (m, status, error = '') =>
    db.prepare('INSERT INTO outbox(ts,to_addr,cc,subject,body,template_code,job_id,attachments,status,error,attempts) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(ctx.now(), [].concat(m.to).join(', '), [].concat(m.cc || []).join(', '), m.subject, m.text || '', m.template || '', m.jobId || null,
        JSON.stringify((m.attachments || []).map((a) => a.filename)), status, error, status === 'logged' ? 0 : 1);

  async function send(m) {
    if (!config.smtp.host) { log(m, 'logged', 'Email not configured (SMTP_HOST)'); return { status: 'logged' }; }
    try {
      const s = ctx.settings();
      const from = config.smtp.from || `${s.company_name} <${config.smtp.user}>`;
      await sendMail({ ...config.smtp, from, to: [].concat(m.to, m.cc || []), subject: m.subject, text: m.text, html: m.html, attachments: m.attachments || [] });
      log(m, 'sent');
      return { status: 'sent' };
    } catch (e) {
      log(m, 'failed', String(e.message || e).slice(0, 300));
      return { status: 'failed', error: e.message };
    }
  }
  return { send, enabled: () => !!config.smtp.host };
}
