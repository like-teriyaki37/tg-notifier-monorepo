import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import rawBody from 'fastify-raw-body';
import { Queue } from 'bullmq';
import { normalizeJiraIssue, getSignatureFromHeaders, verifySignature, requireEnv, NotifyJob } from '@notifier/common';

const port = parseInt(process.env.PORT || '3000', 10);
const app = Fastify({ logger: true });

// Ensure we can access raw bytes for JSON bodies (needed for HMAC)
app.register(rawBody, { field: 'rawBody', global: true, encoding: false, runFirst: true });

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
    // Fallback to default local redis
    return { host: 'localhost', port: 6379 } as any;
  }
}

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const QUEUE_NOTIFY_NAME = process.env.QUEUE_NOTIFY_NAME || 'notify';
const queue = new Queue(QUEUE_NOTIFY_NAME, { connection: parseRedisConnection(REDIS_URL) });

app.get('/healthz', async () => ({ ok: true, service: 'ingest-api' }));

app.post('/webhook', { config: { rawBody: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const ct = (request.headers['content-type'] || '').toString().toLowerCase();
    if (!ct.includes('application/json')) {
      return reply.code(415).send({ ok: false, error: 'unsupported content-type' });
    }

    const raw = (request as any).rawBody as Buffer | undefined;
    const hasRaw = raw && Buffer.isBuffer(raw) && raw.length > 0;

    const signatureHeader = getSignatureFromHeaders(request.headers as Record<string, string>);
    const secret = requireEnv('JIRA_HMAC_SECRET');
    const bodyString = hasRaw ? raw!.toString('utf8') : JSON.stringify(request.body ?? {});
    const { valid } = verifySignature({ rawBody: bodyString, secret, headerSignature: signatureHeader });
    if (!valid) {
      return reply.code(401).send({ ok: false, error: 'invalid signature' });
    }

    const body: any = hasRaw ? JSON.parse(raw!.toString('utf8')) : request.body;
    // For now we only support Jira issue events
    const jobs: NotifyJob[] = normalizeJiraIssue(body);
    if (!jobs.length) {
      return reply.code(202).send({ accepted: true, count: 0 });
    }

    // Fan-out: one job per recipient
    await Promise.all(
      jobs.map((data) =>
        queue.add('notify', data, {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: false,
        })
      )
    );

    return reply.code(202).send({ accepted: true, count: jobs.length });
  } catch (err) {
    request.log.error({ err }, 'webhook error');
    return reply.code(500).send({ ok: false, error: 'internal' });
  }
});

app.addHook('onClose', async () => {
  await queue.close();
});

app
  .listen({ host: '0.0.0.0', port })
  .then(() => app.log.info({ msg: 'ingest-api listening', port }))
  .catch((err) => {
    app.log.error(err, 'failed to start');
    process.exit(1);
  });
