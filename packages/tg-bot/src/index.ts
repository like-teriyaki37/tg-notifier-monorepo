import { Telegraf, Context } from 'telegraf';

type ChatState = {
  stage: 'awaiting_email' | 'awaiting_code';
  email?: string;
};

const state = new Map<number, ChatState>();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  // eslint-disable-next-line no-console
  console.error('Missing TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const base = (process.env.LINK_API_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://nginx').replace(/\/$/, '');
const linkApi = `${base}/api/link`;

function isEmail(s: string): boolean {
  return /.+@.+\..+/.test(s);
}

const bot = new Telegraf(token);

bot.start(async (ctx: Context) => {
  if (!ctx.chat) return;
  state.set((ctx.chat as any).id as number, { stage: 'awaiting_email' });
  await ctx.reply('Welcome! Please send your work email to link your Telegram.');
});

bot.command('cancel', async (ctx: Context) => {
  if (!ctx.chat) return;
  state.delete((ctx.chat as any).id as number);
  await ctx.reply('Canceled. Send /start to begin again.');
});

bot.on('text', async (ctx: Context) => {
  if (!ctx.chat || !ctx.message) return;
  const chatId = (ctx.chat as any).id as number;
  const text = ((ctx.message as any).text || '').toString().trim();
  const s = state.get(chatId);

  if (!s) {
    await ctx.reply('Send /start to begin linking your email.');
    return;
  }

  if (s.stage === 'awaiting_email') {
    if (!isEmail(text)) {
      await ctx.reply('That does not look like an email. Please send a valid email like user@example.com');
      return;
    }
    // request OTP
    try {
      const res = await fetch(`${linkApi}/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: text, chat_id: chatId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        state.set(chatId, { stage: 'awaiting_code', email: text });
        await ctx.reply(`A 6-digit code was sent to ${text}. Please reply with the code.`);
      } else {
        await ctx.reply(`Failed to send code: ${data.error || res.statusText}`);
      }
    } catch (err: any) {
      await ctx.reply(`Error: ${(err && err.message) || 'unknown error'}`);
    }
    return;
  }

  if (s.stage === 'awaiting_code') {
    if (!/^\d{6}$/.test(text)) {
      await ctx.reply('Please send the 6-digit code from your email.');
      return;
    }
    try {
      const res = await fetch(`${linkApi}/verify-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: s.email, chat_id: chatId, code: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        state.delete(chatId);
        await ctx.reply('Success! Your email is now linked to this chat.');
      } else {
        await ctx.reply(`Verification failed: ${data.error || res.statusText}`);
      }
    } catch (err: any) {
      await ctx.reply(`Error: ${(err && err.message) || 'unknown error'}`);
    }
  }
});

bot.launch().then(() => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', msg: 'tg-bot started' }));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
