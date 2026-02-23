const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Render's proxy
app.set('trust proxy', 1);

// ═══ ANTHROPIC CLIENT ═══
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ═══ SYSTEM PROMPT ═══
const systemPrompt = fs.readFileSync(path.join(__dirname, 'system-prompt.md'), 'utf-8');

// ═══ MIDDLEWARE ═══
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: [
    'https://heybori.com',
    'https://www.heybori.com',
    'https://bori-spanish-english.onrender.com',
    'http://localhost:3000',
  ],
  methods: ['GET', 'POST'],
}));
app.use(express.json({ limit: '50kb' }));

// ═══ RATE LIMITER ═══
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many messages. Take a breath and try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ═══ STATIC FILES ═══
app.use(express.static(path.join(__dirname, 'public')));

// ═══ CHAT API (STREAMING SSE) ═══
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const { message, history = [], lang = 'en' } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message too long. Keep it under 2000 characters.' });
    }

    const messages = [];
    const recentHistory = Array.isArray(history) ? history.slice(-20) : [];
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content.slice(0, 2000) : '',
        });
      }
    }

    messages.push({ role: 'user', content: message.trim() });

    const langContext = lang === 'es'
      ? '\n\n[CRITICAL LANGUAGE INSTRUCTION: The user has selected ESPAÑOL mode. You MUST respond in Spanish. ALL of your responses must be primarily in Puerto Rican Spanish. Only use English words when teaching English vocabulary. Your conversational language, greetings, explanations, and questions must ALL be in Spanish. Do NOT default to English. You are speaking Spanish right now.]'
      : '\n\n[LANGUAGE CONTEXT: The user is using the English interface. They may be learning Spanish. Respond primarily in English, introducing Spanish naturally. Be encouraging and patient.]';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt + langContext,
      messages: messages,
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('end', () => {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      console.error('[Hey Bori Stream Error]', err.message || err);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Something went wrong. Try again.' })}\n\n`);
        res.end();
      }
    });

    req.on('close', () => {
      try { stream.abort(); } catch(e) {}
    });

  } catch (err) {
    console.error('[Hey Bori Error]', err.message || err);
    if (err.status === 429) return res.status(429).json({ error: 'Too many requests. Try again in a few seconds.' });
    if (err.status === 401) return res.status(500).json({ error: 'API configuration error.' });
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});

// ═══ CHAT PAGE ═══
app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// ═══ CATCH-ALL ═══
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ═══ START ═══
app.listen(PORT, () => {
  console.log(`[Hey Bori] Live on port ${PORT}`);
  console.log(`[Hey Bori] Language learning companion ready`);
});
