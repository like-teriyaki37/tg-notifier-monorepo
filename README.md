# Notifier Monorepo (Ubuntu Docker Compose)

This monorepo contains the non-serverless implementation of the notifier system.

## Structure

```
/notifier-monorepo
├─ docker-compose.yml
├─ nginx/
│  └─ default.conf
├─ packages/
│  ├─ common/
│  ├─ ingest-api/
│  ├─ notifier-worker/
│  ├─ link-api/
│  └─ tg-bot/
├─ scripts/
│  └─ migrate.ts
├─ .env.example
├─ package.json (workspaces)
└─ README.md
```

## Development

- Node.js 20+
- NPM workspaces
- TypeScript base config at `tsconfig.base.json`

Commands:
- `npm run dev` — will run `docker compose up -d` (services are defined in Step 2)
- `npm run build` — builds all workspaces (each package has its own `build` script)
- `npm run migrate` — runs database migrations (implemented in Step 3)

## Quick start (local)

1) Copy environment

```
cp .env.example .env
```

2) Start the stack

```
npm run dev
```

3) Run DB migrations (from host)

```
npm run migrate
```

4) Verify services

```
curl -s https://your.domain/webhook -XPOST -H 'content-type: application/json' -d '{}' | jq .
curl -s https://your.domain/api/link/request -XPOST -H 'content-type: application/json' -d '{"email":"you@example.com","chat_id":123456789}' | jq .
```

5) Email delivery uses your configured SMTP provider (see .env). There is no Mailpit in production.

## Smoke tests (end-to-end)

1) OTP flow via Telegram bot endpoints

- Request a code (in non-production, `dev_code` may be returned in JSON to ease testing):

```
curl -s https://your.domain/api/link/request -XPOST \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","chat_id":123456789}'
```

- Verify the code:

```
curl -s https://your.domain/api/link/verify-code -XPOST \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","chat_id":123456789,"code":"123456"}'
```

2) Webhook ingestion with HMAC

```
payload='{"issue":{"key":"PROJ-1","fields":{"summary":"Assigned to you","assignee":{"emailAddress":"you@example.com"}}}}'
secret='change-me'
sig=$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "$secret" | sed 's/^.* //')
curl -i https://your.domain/webhook \
  -H 'content-type: application/json' \
  -H "x-hub-signature-256: sha256=$sig" \
  -d "$payload"
```

If the email is linked and verified, the job will be enqueued for delivery by the worker and sent via Telegram.

## Environment

The repository ships `.env.example` with sensible defaults for Docker Compose:

- `POSTGRES_URL=postgres://postgres:postgres@postgres:5432/notify`
- `POSTGRES_URL_LOCAL=postgres://postgres:postgres@localhost:5432/notify` (used by the host-run migration script)
- `REDIS_URL=redis://redis:6379`
- `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_SMTP_USER`, `MAIL_SMTP_PASS`, `MAIL_SMTP_SECURE`
- `MAIL_FROM="Notify <no-reply@yourdomain.com>"`
- `TELEGRAM_BOT_TOKEN=...` (set a real token to deliver messages)
- `LINK_API_BASE_URL=http://nginx` (used by `tg-bot` inside the Docker network)
- `JIRA_HMAC_SECRET=change-me`
- `QUEUE_NOTIFY_NAME=notify`
- `PORT_INGEST=3000`, `PORT_LINK=3001`
- `PUBLIC_BASE_URL=https://your.domain`

Notes:

- For real email delivery, configure a real SMTP provider in `.env` (AUTH + TLS as required by your provider).
- For Telegram delivery, set `TELEGRAM_BOT_TOKEN` to your bot token and use your real `chat_id`.
- `tg-bot` uses Telegraf to guide onboarding: `/start` prompts for an email, then a 6-digit code.
- Logs are written to stdout as JSON.

## Status

- Ingest API: Fastify + HMAC verification + BullMQ enqueue to `notify` queue.
- Notifier worker: BullMQ consumer, Postgres email→chat resolution, Telegram send with retry/backoff.
- Link API: Fastify OTP request/verify, Postgres + Nodemailer.
- Telegram bot: Telegraf onboarding flow.
