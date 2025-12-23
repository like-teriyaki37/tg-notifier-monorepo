# TG Notifier

A self-hosted notification bridge that delivers Jira issue updates to Telegram. When issues are assigned in Jira, assignees receive instant Telegram messages — after linking their email via a secure OTP verification flow.

## How It Works

1. **Jira Webhook** → Ingest API validates HMAC signature and queues notification jobs
2. **Worker** → Processes queue, resolves email to Telegram chat, delivers message
3. **Telegram Bot** → Guides users through email-to-Telegram linking via OTP

## Architecture

```
packages/
├── common/           # Shared types and utilities
├── ingest-api/       # Jira webhook receiver (Fastify)
├── link-api/         # OTP request/verify API (Fastify)
├── notifier-worker/  # Job processor (BullMQ)
└── tg-bot/           # Telegram onboarding bot (Telegraf)
```

**Stack:** Node.js 20, TypeScript, PostgreSQL, Redis, Docker Compose, Nginx

## Setup

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for migrations)
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- SMTP credentials for OTP emails

### Quick Start

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your Telegram token, SMTP, and domain

# 2. Start Docker stack (PostgreSQL, Redis, all services)
npm run dev

# 3. Run database migrations
npm run migrate
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather |
| `JIRA_HMAC_SECRET` | Secret for webhook signature verification |
| `MAIL_SMTP_*` | SMTP host, port, user, pass for OTP delivery |
| `POSTGRES_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |

See `.env.example` for full configuration.

## Usage

### Link Email to Telegram

1. Start a chat with your bot and send `/start`
2. Enter your Jira email address
3. Enter the 6-digit OTP code received via email

### Configure Jira Webhook

Point your Jira webhook to `https://your.domain/webhook` with:
- Events: Issue assigned/updated
- Secret: Match your `JIRA_HMAC_SECRET`

## Development

```bash
npm install        # Install dependencies
npm run build      # Build all packages
npm run dev        # Start Docker stack
npm run down       # Stop Docker stack
```
