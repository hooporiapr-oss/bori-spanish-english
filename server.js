const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Render's proxy
app.set('trust proxy', 1);

// ═══ ANTHROPIC CLIENT ═══
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ═══ STRIPE CLIENT ═══
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const STRIPE_VOICE_PRICE_ID = 'price_1T52eCKBiHyt2NsQNXIipi73';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const BASE_URL = process.env.BASE_URL || 'https://heybori.com';

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

// ═══ VOICE ACCESS GATING ═══
app.post('/api/voice/access', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.json({ access: false, reason: 'no_email' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Admin bypass — always free
    if (ADMIN_EMAILS.includes(cleanEmail)) {
      console.log(`[Voice Access] ADMIN: ${cleanEmail}`);
      return res.json({ access: true, reason: 'admin', plan: 'admin' });
    }

    // 2. Check Stripe for active subscription OR active trial
    const customers = await stripe.customers.list({ email: cleanEmail, limit: 1 });
    if (customers.data.length > 0) {
      const customer = customers.data[0];
      const subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        limit: 5,
      });

      for (const sub of subscriptions.data) {
        // Active paid subscription
        if (sub.status === 'active') {
          console.log(`[Voice Access] SUBSCRIBER: ${cleanEmail}`);
          return res.json({
            access: true,
            reason: 'subscriber',
            plan: 'bori-voice',
            customerId: customer.id,
          });
        }
        // Active trial (Stripe status = 'trialing')
        if (sub.status === 'trialing') {
          const trialEnd = new Date(sub.trial_end * 1000);
          const daysLeft = Math.max(0, Math.ceil((trialEnd - Date.now()) / (1000 * 60 * 60 * 24)));
          console.log(`[Voice Access] TRIAL: ${cleanEmail} (${daysLeft} days left)`);
          return res.json({
            access: true,
            reason: 'trial',
            plan: 'bori-voice-trial',
            trialDaysLeft: daysLeft,
            trialEnd: trialEnd.toISOString(),
          });
        }
      }
    }

    // 3. No access
    console.log(`[Voice Access] DENIED: ${cleanEmail}`);
    return res.json({ access: false, reason: 'no_subscription' });

  } catch (err) {
    console.error('[Voice Access Error]', err.message);
    return res.json({ access: false, reason: 'error' });
  }
});

// ═══ STRIPE: CREATE CHECKOUT SESSION (VOICE — WITH 7-DAY TRIAL) ═══
app.post('/api/stripe/checkout', async (req, res) => {
  try {
    const { email, lang } = req.body;

    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: STRIPE_VOICE_PRICE_ID, quantity: 1 }],
      subscription_data: { trial_period_days: 7 },
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
      limit: 5,
    });

    const activeSub = subscriptions.data.find(s => s.status === 'active' || s.status === 'trialing');
    const isSubscribed = !!activeSub;
    res.json({
      subscribed: isSubscribed,
      customerId: customer.id,
      plan: isSubscribed ? (activeSub.status === 'trialing' ? 'bori-voice-trial' : 'bori-voice') : 'libre',
    });
  } catch (err) {
    console.error('[Stripe Status Error]', err.message);
    res.json({ subscribed: false });
  }
});

// ═══ STRIPE: CUSTOMER PORTAL ═══
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

    // Retry logic for Anthropic overload
    let stream = null;
    const models = ['claude-sonnet-4-20250514', 'claude-sonnet-4-20250514', 'claude-sonnet-4-5-20250929'];
    const delays = [0, 1000, 2000];

    for (let attempt = 0; attempt < models.length; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, delays[attempt]));
      try {
        const testStream = anthropic.messages.stream({
          model: models[attempt],
          max_tokens: 1024,
          system: systemPrompt + langContext,
          messages: messages,
        });

        await new Promise((resolve, reject) => {
          let resolved = false;
          testStream.on('text', () => { if (!resolved) { resolved = true; resolve(); } });
          testStream.on('error', (err) => { if (!resolved) { resolved = true; reject(err); } });
          setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 5000);
        });

        stream = testStream;
        break;
      } catch (err) {
        console.error(`[Hey Bori] Attempt ${attempt + 1} failed (${models[attempt]}):`, err.message || err);
      }
    }

    if (!stream) {
      try { res.write(`data: ${JSON.stringify({ type: 'error', error: 'Service temporarily busy. Try again.' })}\n\n`); } catch(e) {}
      try { res.end(); } catch(e) {}
      return;
    }

    stream.on('text', (text) => {
      try { res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`); } catch(e) {}
    });

    stream.on('end', () => {
      try { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); } catch(e) {}
      try { res.end(); } catch(e) {}
    });

    stream.on('error', (err) => {
      console.error('[Hey Bori Stream Error]', err.message || err);
      if (!res.writableEnded) {
        try { res.write(`data: ${JSON.stringify({ type: 'error', error: 'Something went wrong. Try again.' })}\n\n`); } catch(e) {}
        try { res.end(); } catch(e) {}
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
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`[Hey Bori] Live on port ${PORT}`);
  console.log(`[Hey Bori] Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Connected' : 'NOT configured'}`);
  console.log(`[Hey Bori] Voice Price: ${STRIPE_VOICE_PRICE_ID}`);
  console.log(`[Hey Bori] Voice gating: admin bypass + Stripe subscription/trial`);
  console.log(`[Hey Bori] ElevenLabs voice — powered by Claude`);
});
