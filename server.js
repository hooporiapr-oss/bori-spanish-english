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

// ═══ ELEVENLABS CONFIG ═══
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'zwDSHuqO0tEVwNUuHmR1';
const ELEVENLABS_MODEL_TTS = 'eleven_flash_v2_5';
const ELEVENLABS_MODEL_STT = 'scribe_v2';

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

// ═══ ELEVENLABS: TEXT-TO-SPEECH ═══
app.post('/api/voice/tts', async (req, res) => {
  try {
    const { text, lang } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required.' });
    }

    // Limit text length to control costs
    const trimmedText = text.slice(0, 1000);

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: trimmedText,
        model_id: ELEVENLABS_MODEL_TTS,
        language_code: lang === 'es' ? 'es' : 'en',
        voice_settings: {
          stability: 0.6,
          similarity_boost: 0.85,
          style: 0.4,
          use_speaker_boost: true,
        },
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error('[ElevenLabs TTS Error]', ttsRes.status, errText);
      return res.status(500).json({ error: 'Voice generation failed.' });
    }

    // Stream audio back as mp3
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');

    const arrayBuffer = await ttsRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('[ElevenLabs TTS Error]', err.message);
    res.status(500).json({ error: 'Voice generation failed.' });
  }
});

// ═══ ELEVENLABS: SPEECH-TO-TEXT ═══
app.post('/api/voice/stt', async (req, res) => {
  try {
    // Receive raw audio as binary
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const audioBuffer = Buffer.concat(chunks);

        if (audioBuffer.length < 100) {
          return res.status(400).json({ error: 'Audio too short.' });
        }

        console.log('[ElevenLabs STT] Received audio:', audioBuffer.length, 'bytes, content-type:', req.headers['content-type']);

        // Create form data for ElevenLabs STT
        const boundary = '----ElevenLabsBoundary' + Date.now();
        const rawContentType = (req.headers['content-type'] || '').split(';')[0].trim();

        // Map content type to proper file extension for ElevenLabs
        const extMap = {
          'audio/mp4': 'm4a',
          'audio/m4a': 'm4a',
          'audio/aac': 'aac',
          'audio/mpeg': 'mp3',
          'audio/webm': 'webm',
          'audio/ogg': 'ogg',
          'audio/wav': 'wav',
          'audio/x-m4a': 'm4a',
        };
        const ext = extMap[rawContentType] || 'm4a';

        // Use a clean content type for the multipart form
        const cleanContentType = rawContentType || 'audio/mp4';

        console.log('[ElevenLabs STT] Detected format:', cleanContentType, '-> extension:', ext);

        // Build multipart form data manually
        const formParts = [];

        // File part
        formParts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="audio.${ext}"\r\n` +
          `Content-Type: ${cleanContentType}\r\n\r\n`
        ));
        formParts.push(audioBuffer);
        formParts.push(Buffer.from('\r\n'));

        // Model part
        formParts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="model_id"\r\n\r\n` +
          `${ELEVENLABS_MODEL_STT}\r\n`
        ));

        // Language code part
        const lang = req.headers['x-lang'] || '';
        if (lang === 'es' || lang === 'en') {
          formParts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="language_code"\r\n\r\n` +
            `${lang}\r\n`
          ));
        }

        // Close boundary
        formParts.push(Buffer.from(`--${boundary}--\r\n`));

        const formBody = Buffer.concat(formParts);

        const sttRes = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body: formBody,
        });

        if (!sttRes.ok) {
          const errText = await sttRes.text();
          console.error('[ElevenLabs STT Error]', sttRes.status, errText);
          return res.status(500).json({ error: 'Transcription failed.' });
        }

        const data = await sttRes.json();
        console.log('[ElevenLabs STT] Transcribed:', data.text?.substring(0, 100));
        res.json({
          text: data.text || '',
          language: data.language_code || '',
        });
      } catch (innerErr) {
        console.error('[ElevenLabs STT Inner Error]', innerErr.message);
        res.status(500).json({ error: 'Transcription failed.' });
      }
    });
  } catch (err) {
    console.error('[ElevenLabs STT Error]', err.message);
    res.status(500).json({ error: 'Transcription failed.' });
  }
});

// ═══ STRIPE: CREATE CHECKOUT SESSION ═══
app.post('/api/stripe/checkout', async (req, res) => {
  try {
    const { email, lang } = req.body;

    // Look up the price for our product
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

    // If email provided, pre-fill it
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

    // Admin bypass — full access, no Stripe check
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
      ? 'Dame una fortuna positiva, corta y motivacional en español boricua (1-2 oraciones). Solo la fortuna, nada más. Estilo: como un coco sabio de Puerto Rico.'
      : 'Give me a short, positive, motivational fortune in English (1-2 sentences). Just the fortune, nothing else. Style: like a wise coconut from Puerto Rico.';

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
  console.log(`[Hey Bori] Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Connected' : 'NOT configured'}`);
  console.log(`[Hey Bori] ElevenLabs: ${ELEVENLABS_API_KEY ? 'Connected' : 'NOT configured'}`);
  console.log(`[Hey Bori] Language learning companion ready`);
});
