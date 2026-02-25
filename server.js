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

// ═══ STRIPE CLIENT ═══
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const STRIPE_PRODUCT_ID = 'prod_U2NT53dHR4yPPJ';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const BASE_URL = process.env.BASE_URL || 'https://heybori.com';

// ═══ DEEPGRAM CONFIG ═══
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
// Javier: male Spanish bilingual code-switcher (Aura-2)
const DEEPGRAM_TTS_MODEL = 'aura-2-javier-es';

// ═══ ADMIN BYPASS ═══
const ADMIN_EMAILS = [
  'gostardigital@gmail.com',
];

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

// ═══ STRIPE WEBHOOK (must be before express.json) ═══
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).send('Webhook signature verification failed.');
  }

  const { type, data } = event;
  console.log(`[Stripe Webhook] ${type}`);

  switch (type) {
    case 'checkout.session.completed': {
      const session = data.object;
      console.log(`[Stripe] Checkout completed — customer: ${session.customer}, email: ${session.customer_email}`);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = data.object;
      console.log(`[Stripe] Subscription ${sub.status} — customer: ${sub.customer}`);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = data.object;
      console.log(`[Stripe] Subscription canceled — customer: ${sub.customer}`);
      break;
    }
    case 'invoice.payment_succeeded': {
      const invoice = data.object;
      console.log(`[Stripe] Payment succeeded — customer: ${invoice.customer}, amount: $${(invoice.amount_paid / 100).toFixed(2)}`);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = data.object;
      console.log(`[Stripe] Payment failed — customer: ${invoice.customer}`);
      break;
    }
  }

  res.json({ received: true });
});

// JSON parser (after webhook route)
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

// ═══ DEEPGRAM: TEXT-TO-SPEECH ═══
app.post('/api/voice/tts', async (req, res) => {
  try {
    const { text, lang } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required.' });
    }

    // Limit text length to control costs
    const trimmedText = text.slice(0, 2000);

    // Deepgram Aura-2 REST TTS
    // Javier is a bilingual code-switcher — handles both es and en
    const ttsRes = await fetch(`https://api.deepgram.com/v1/speak?model=${DEEPGRAM_TTS_MODEL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: trimmedText,
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error('[Deepgram TTS Error]', ttsRes.status, errText);
      return res.status(500).json({ error: 'Voice generation failed.' });
    }

    // Stream audio back as mp3 (Deepgram defaults to mp3)
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');

    const arrayBuffer = await ttsRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('[Deepgram TTS Error]', err.message);
    res.status(500).json({ error: 'Voice generation failed.' });
  }
});

// ═══ DEEPGRAM: REALTIME STT TOKEN ═══
// Generates a temporary JWT (120s TTL) for client-side WebSocket STT
// Token only needs to be valid at connection time — WebSocket stays open after
// API key never exposed to client
app.get('/api/voice/deepgram-token', async (req, res) => {
  try {
    if (!DEEPGRAM_API_KEY) {
      return res.status(500).json({ error: 'Voice not configured.' });
    }

    const tokenRes = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ttl_seconds: 120,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[Deepgram Token Error]', tokenRes.status, errText);
      return res.status(500).json({ error: 'Could not generate voice token.' });
    }

    const data = await tokenRes.json();
    console.log('[Deepgram] STT token generated (expires in', data.expires_in, 's)');
    res.json({ token: data.access_token });
  } catch (err) {
    console.error('[Deepgram Token Error]', err.message);
    res.status(500).json({ error: 'Could not generate voice token.' });
  }
});

// ═══ STRIPE: CREATE CHECKOUT SESSION ═══
app.post('/api/stripe/checkout', async (req, res) => {
  try {
    const { email, lang } = req.body;

    const prices = await stripe.prices.list({
      product: STRIPE_PRODUCT_ID,
      active: true,
      type: 'recurring',
      limit: 1,
    });

    if (!prices.data.length) {
      return res.status(500).json({ error: 'No active price found for Bori Plus.' });
    }

    const priceId = prices.data[0].id;

    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${BASE_URL}/chat?upgraded=true`,
      cancel_url: `${BASE_URL}/?canceled=true`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      metadata: { source: 'heybori', lang: lang || 'en' },
    };

    if (email && typeof email === 'string') {
      sessionParams.customer_email = email.trim();
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[Stripe Checkout Error]', err.message);
    res.status(500).json({ error: 'Could not create checkout session.' });
  }
});

// ═══ STRIPE: CHECK SUBSCRIPTION STATUS BY EMAIL ═══
app.post('/api/stripe/status', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ subscribed: false });

    if (ADMIN_EMAILS.includes(email.trim().toLowerCase())) {
      return res.json({ subscribed: true, customerId: 'admin', plan: 'admin' });
    }

    const customers = await stripe.customers.list({ email: email.trim(), limit: 1 });
    if (!customers.data.length) return res.json({ subscribed: false });

    const customer = customers.data[0];
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 1,
    });

    const isSubscribed = subscriptions.data.length > 0;
    res.json({
      subscribed: isSubscribed,
      customerId: customer.id,
      plan: isSubscribed ? 'bori-plus' : 'libre',
    });
  } catch (err) {
    console.error('[Stripe Status Error]', err.message);
    res.json({ subscribed: false });
  }
});

// ═══ STRIPE: CUSTOMER PORTAL (manage subscription) ═══
app.post('/api/stripe/portal', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });

    const customers = await stripe.customers.list({ email: email.trim(), limit: 1 });
    if (!customers.data.length) return res.status(404).json({ error: 'No account found.' });

    const session = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: `${BASE_URL}/chat`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[Stripe Portal Error]', err.message);
    res.status(500).json({ error: 'Could not open billing portal.' });
  }
});

// ═══ FORTUNE COCO API ═══
app.get('/api/fortune', async (req, res) => {
  try {
    const lang = req.query.lang || 'en';
    const prompt = lang === 'es'
      ? 'Dame una fortuna positiva, corta y motivacional en español boricua (1-2 oraciones). Solo la fortuna, nada más. Estilo: como un coco sabio de Puerto Rico. NUNCA uses "mi amor", "cariño", "corazón", "mi vida", "mi cielo", "mi reina", "mi rey", "nena", "nene" ni ningún término romántico o íntimo. Habla como un amigo sabio.'
      : 'Give me a short, positive, motivational fortune in English (1-2 sentences). Just the fortune, nothing else. Style: like a wise coconut from Puerto Rico. NEVER use "my love", "sweetheart", "honey", "darling", "babe", "dear" or any romantic/intimate terms. Speak like a wise friend.';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    const fortune = response.content[0]?.text || (lang === 'es' ? 'Hoy es tu día. Créelo.' : 'Today is your day. Believe it.');
    res.json({ fortune });
  } catch (err) {
    console.error('[Fortune Error]', err.message);
    const lang = req.query.lang || 'en';
    res.json({ fortune: lang === 'es' ? 'El coco dice: hoy brillas. 🥥✨' : 'The coco says: today you shine. 🥥✨' });
  }
});

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

    // Retry logic for overloaded errors
    const models = [
      'claude-sonnet-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-sonnet-4-5-20250929',
    ];

    let succeeded = false;

    for (let attempt = 0; attempt < models.length; attempt++) {
      if (res.writableEnded) break;

      const model = models[attempt];
      if (attempt > 0) {
        console.log(`[Hey Bori] Retry attempt ${attempt + 1} with ${model}`);
        await new Promise(r => setTimeout(r, attempt * 1000));
      }

      try {
        const stream = anthropic.messages.stream({
          model: model,
          max_tokens: 1024,
          system: systemPrompt + langContext,
          messages: messages,
        });

        await new Promise((resolve, reject) => {
          let gotText = false;

          stream.on('text', (text) => {
            gotText = true;
            if (!res.writableEnded) {
              try { res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`); } catch(e) {}
            }
          });

          stream.on('end', () => {
            if (!res.writableEnded) {
              try { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); res.end(); } catch(e) {}
            }
            succeeded = true;
            resolve();
          });

          stream.on('error', (err) => {
            const errMsg = typeof err === 'object' ? JSON.stringify(err) : String(err);
            console.error('[Hey Bori Stream Error]', errMsg);

            if (gotText) {
              if (!res.writableEnded) {
                try { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); res.end(); } catch(e) {}
              }
              succeeded = true;
              resolve();
              return;
            }

            const isOverloaded = errMsg.includes('overloaded') || errMsg.includes('529');
            if (isOverloaded && attempt < models.length - 1) {
              reject(new Error('overloaded'));
              return;
            }

            if (!res.writableEnded) {
              try {
                res.write(`data: ${JSON.stringify({ type: 'error', error: 'Something went wrong. Try again.' })}\n\n`);
                res.end();
              } catch(e) {}
            }
            succeeded = true;
            resolve();
          });

          req.on('close', () => {
            try { stream.abort(); } catch(e) {}
            resolve();
          });
        });

        if (succeeded) break;

      } catch (retryErr) {
        console.log(`[Hey Bori] Attempt ${attempt + 1} overloaded, retrying...`);
        continue;
      }
    }

    if (!succeeded && !res.writableEnded) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Bori is taking a quick break. Try again in a moment!' })}\n\n`);
        res.end();
      } catch(e) {}
    }

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
  console.log(`[Hey Bori] Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Connected' : 'NOT configured'}`);
  console.log(`[Hey Bori] Deepgram: ${DEEPGRAM_API_KEY ? 'Connected' : 'NOT configured'}`);
  console.log(`[Hey Bori] TTS Voice: ${DEEPGRAM_TTS_MODEL} (Javier — bilingual code-switcher)`);
  console.log(`[Hey Bori] Realtime STT: Ready (GET /api/voice/deepgram-token)`);
  console.log(`[Hey Bori] Language learning companion ready`);
});
