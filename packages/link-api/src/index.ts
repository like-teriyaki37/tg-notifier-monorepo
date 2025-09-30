import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { Client } from 'pg';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

const port = parseInt(process.env.PORT || '3001', 10);
const app = Fastify({ logger: true });

function pickPostgresUrl(): string {
  return process.env.POSTGRES_URL || process.env.POSTGRES_URL_LOCAL || 'postgres://postgres:postgres@postgres:5432/notify';
}

const pg = new Client({ connectionString: pickPostgresUrl() });
async function ensurePg() {
  if ((pg as any)._connected) return;
  await pg.connect();
  (pg as any)._connected = true;
}

function isValidEmail(email: string): boolean {
  return /.+@.+\..+/.test(email);
}

function genOtp(): string {
  // 6-digit numeric code
  return (Math.floor(100000 + Math.random() * 900000)).toString();
}

function hashOtp(code: string, salt: string): string {
  return crypto.createHash('sha256').update(code + salt, 'utf8').digest('hex');
}

function nowPlusMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

function mailTransport() {
  const host = process.env.MAIL_SMTP_HOST;
  const port = process.env.MAIL_SMTP_PORT && parseInt(process.env.MAIL_SMTP_PORT, 10);
  const user = process.env.MAIL_SMTP_USER;
  const pass = process.env.MAIL_SMTP_PASS;
  const secureEnv = (process.env.MAIL_SMTP_SECURE || '').toLowerCase();
  const secure = secureEnv === 'true' || port === 465;

  if (!host || !port) {
    throw new Error('SMTP not configured: set MAIL_SMTP_HOST and MAIL_SMTP_PORT');
  }

  const base: any = { host, port, secure };
  if (user && pass) {
    base.auth = { user, pass };
  }
  return nodemailer.createTransport(base);
}

app.get('/healthz', async () => ({ ok: true, service: 'link-api' }));

type LinkRequestBody = { email?: string; chat_id?: number | string };
app.post('/api/link/request', async (request: FastifyRequest<{ Body: LinkRequestBody }>, reply: FastifyReply) => {
  try {
    await ensurePg();
    const { email, chat_id } = request.body || {};
    const emailStr = (email || '').toString().trim();
    const chatIdStr = (chat_id as any)?.toString();
    const chatId = chatIdStr && /^\d+$/.test(chatIdStr) ? BigInt(chatIdStr) : null;
    if (!isValidEmail(emailStr) || !chatId) {
      return reply.code(400).send({ ok: false, error: 'invalid email/chat_id' });
    }

    const code = genOtp();
    const salt = crypto.randomBytes(8).toString('hex');
    const otp_hash = hashOtp(code, salt);
    const expires_at = nowPlusMinutes(10);

    await pg.query(
      `INSERT INTO pending_links(email, chat_id, otp_hash, salt, expires_at, state)
       VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
      [emailStr.toLowerCase(), chatId.toString(), otp_hash, salt, expires_at]
    );

    const from = process.env.MAIL_FROM || 'Notify <no-reply@example.com>';
    const transporter = mailTransport();
    await transporter.sendMail({
      from,
      to: emailStr,
      subject: 'Your verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    });

    // Log in dev for convenience
    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd) {
      request.log.info({ email: emailStr, chatId: chatId.toString(), dev_code: code }, 'sent dev code');
    }

    return reply.code(200).send({ ok: true });
  } catch (err) {
    request.log.error({ err }, 'link request error');
    return reply.code(500).send({ ok: false, error: 'internal' });
  }
});

type VerifyBody = { email?: string; chat_id?: number | string; code?: string };
app.post('/api/link/verify-code', async (request: FastifyRequest<{ Body: VerifyBody }>, reply: FastifyReply) => {
  const client = pg;
  try {
    await ensurePg();
    const { email, chat_id, code } = request.body || {};
    const emailStr = (email || '').toString().trim();
    const chatIdStr = (chat_id as any)?.toString();
    const codeStr = (code || '').toString().trim();
    if (!isValidEmail(emailStr) || !/^\d{6}$/.test(codeStr) || !chatIdStr || !/^\d+$/.test(chatIdStr)) {
      return reply.code(400).send({ ok: false, error: 'invalid input' });
    }

    // Fetch latest pending link
    const q = await client.query(
      `SELECT * FROM pending_links
       WHERE lower(email)=lower($1) AND chat_id=$2 AND state='PENDING'
       ORDER BY id DESC LIMIT 1`,
      [emailStr, chatIdStr]
    );

    if (!q.rows.length) return reply.code(400).send({ ok: false, error: 'no pending request' });
    const pending = q.rows[0];

    // Check expiration
    const now = new Date();
    if (pending.expires_at && new Date(pending.expires_at) < now) {
      await client.query('UPDATE pending_links SET state=$1 WHERE id=$2', ['EXPIRED', pending.id]);
      return reply.code(400).send({ ok: false, error: 'expired' });
    }

    // Check attempts
    const attempts = Number(pending.attempts || 0);
    const maxAttempts = Number(pending.max_attempts || 5);
    if (attempts >= maxAttempts) {
      await client.query('UPDATE pending_links SET state=$1 WHERE id=$2', ['LOCKED', pending.id]);
      return reply.code(400).send({ ok: false, error: 'locked' });
    }

    const computedHash = hashOtp(codeStr, pending.salt);
    if (computedHash !== pending.otp_hash) {
      // increment attempts
      const newAttempts = attempts + 1;
      const newState = newAttempts >= maxAttempts ? 'LOCKED' : 'PENDING';
      await client.query('UPDATE pending_links SET attempts=$1, state=$2 WHERE id=$3', [newAttempts, newState, pending.id]);
      return reply.code(400).send({ ok: false, error: 'invalid code' });
    }

    // Success: upsert user and mark USED within a transaction
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users(email, verified, chat_id)
       VALUES($1, true, $2)
       ON CONFLICT (email) DO UPDATE SET verified=true, chat_id=EXCLUDED.chat_id`,
      [emailStr.toLowerCase(), chatIdStr]
    );
    await client.query('UPDATE pending_links SET state=$1 WHERE id=$2', ['USED', pending.id]);
    await client.query('COMMIT');

    return reply.code(200).send({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    request.log.error({ err }, 'verify error');
    return reply.code(500).send({ ok: false, error: 'internal' });
  }
});

app
  .listen({ host: '0.0.0.0', port })
  .then(() => app.log.info({ msg: 'link-api listening', port }))
  .catch((err) => {
    app.log.error(err, 'failed to start');
    process.exit(1);
  });
