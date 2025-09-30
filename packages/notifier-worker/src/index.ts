import { Worker, QueueEvents } from 'bullmq';
import { Client } from 'pg';
import { NotifyJob } from '@notifier/common';

function parseRedisConnection(urlStr: string) {
  try {
    const u = new URL(urlStr);
    const isTLS = u.protocol === 'rediss:';
    return {
      host: u.hostname,
      port: u.port ? parseInt(u.port, 10) : 6379,
      username: u.username || undefined,
      password: u.password || undefined,
      tls: isTLS ? {} : undefined,
    } as any;
  } catch {
    return { host: 'localhost', port: 6379 } as any;
  }
}

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const QUEUE_NOTIFY_NAME = process.env.QUEUE_NOTIFY_NAME || 'notify';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const POSTGRES_URL = process.env.POSTGRES_URL || process.env.POSTGRES_URL_LOCAL || 'postgres://postgres:postgres@postgres:5432/notify';

const pg = new Client({ connectionString: POSTGRES_URL });

async function ensurePg() {
  if ((pg as any)._connected) return;
  await pg.connect();
  (pg as any)._connected = true;
}

async function resolveChatId(email: string): Promise<bigint | null> {
  await ensurePg();
  const res = await pg.query('SELECT chat_id FROM users WHERE lower(email)=lower($1) AND verified=true', [email]);
  if (res.rows.length && res.rows[0].chat_id != null) {
    // chat_id can exceed JS number range; keep as bigint if provided by driver
    const v = res.rows[0].chat_id;
    return typeof v === 'bigint' ? v : BigInt(v);
  }
  return null;
}

async function sendTelegramMessage(chatId: bigint, text: string): Promise<Response> {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('NON_RETRYABLE: missing TELEGRAM_BOT_TOKEN');
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId.toString(), text }),
  });
  return res;
}

console.log(JSON.stringify({ level: 'info', msg: 'notifier-worker starting' }));

const worker = new Worker<NotifyJob>(
  QUEUE_NOTIFY_NAME,
  async (job) => {
    const { email, message } = job.data;

    if (!email || !message) {
      await job.discard();
      throw new Error('NON_RETRYABLE: missing email/message');
    }

    const chatId = await resolveChatId(email);
    if (!chatId) {
      await job.discard();
      throw new Error('NON_RETRYABLE: no linked chat_id for email');
    }

    const res = await sendTelegramMessage(chatId, message);
    if (res.ok) {
      console.log(JSON.stringify({ level: 'info', msg: 'sent telegram', jobId: job.id, email, chatId: chatId.toString() }));
      return { ok: true };
    }

    if (res.status === 429) {
      // Retryable: let BullMQ handle exponential backoff
      throw new Error('RETRYABLE: 429 rate limited');
    }

    if (res.status === 400 || res.status === 403) {
      // Non-retryable: user blocked bot or invalid chat
      const body = await res.text().catch(() => '');
      await job.discard();
      throw new Error(`NON_RETRYABLE: ${res.status} ${body}`);
    }

    // Other errors: retry
    const body = await res.text().catch(() => '');
    throw new Error(`RETRYABLE: ${res.status} ${body}`);
  },
  {
    connection: parseRedisConnection(REDIS_URL),
  }
);

const events = new QueueEvents(QUEUE_NOTIFY_NAME, { connection: parseRedisConnection(REDIS_URL) });
events.on('failed', ({ jobId, failedReason }) => {
  console.log(JSON.stringify({ level: 'error', msg: 'job failed', jobId, failedReason }));
});
events.on('completed', ({ jobId }) => {
  console.log(JSON.stringify({ level: 'info', msg: 'job completed', jobId }));
});

async function shutdown() {
  await worker.close();
  await events.close();
  await pg.end().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
