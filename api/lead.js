// Vercel Serverless Function — приймає заявку, шле в Telegram і дублює подію Lead у Meta (Conversions API).
// Env-змінні (Vercel → Settings → Environment Variables, потім Redeploy):
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  — для заявок у Telegram
//   META_PIXEL_ID       = 2065001050789881 (набір даних)
//   META_CAPI_TOKEN     = токен доступу з Events Manager → Налаштування → Conversions API
//   META_TEST_EVENT_CODE (необов'язково) — код із «Тестування подій» для перевірки

import crypto from 'crypto';

export default async function handler(req, res) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const PIXEL_ID = process.env.META_PIXEL_ID;
  const CAPI_TOKEN = process.env.META_CAPI_TOKEN;
  const TEST_CODE = process.env.META_TEST_EVENT_CODE;

  // Health-check: відкрий /api/lead у браузері (GET) — покаже, чи Vercel бачить змінні.
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      env: {
        TELEGRAM_BOT_TOKEN: TOKEN ? 'set ✅' : 'MISSING ❌',
        TELEGRAM_CHAT_ID: CHAT_ID ? ('set ✅ (' + CHAT_ID + ')') : 'MISSING ❌',
        META_PIXEL_ID: PIXEL_ID ? ('set ✅ (' + PIXEL_ID + ')') : 'MISSING ❌',
        META_CAPI_TOKEN: CAPI_TOKEN ? 'set ✅' : 'MISSING ❌',
        META_TEST_EVENT_CODE: TEST_CODE ? ('set ✅ (' + TEST_CODE + ')') : 'not set'
      },
      hint: 'Якщо MISSING — додайте змінні у Vercel → Settings → Environment Variables і зробіть Redeploy.'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!TOKEN || !CHAT_ID) {
    return res.status(500).json({ ok: false, error: 'Telegram env vars are not set. Додайте їх у Vercel і зробіть Redeploy.' });
  }

  try {
    // Тіло: розпарсене об'єктом (Vercel), рядком, або читаємо потік вручну
    let body = req.body;
    if (!body || typeof body === 'string') {
      let raw = typeof body === 'string' ? body : '';
      if (!raw) {
        raw = await new Promise((resolve) => {
          let d = '';
          req.on('data', (c) => (d += c));
          req.on('end', () => resolve(d));
          req.on('error', () => resolve(''));
        });
      }
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
    }

    const {
      name = '', phone = '', country = '', q1 = '—', q2 = '—', q3 = '—', page = '',
      eventId = '', fbp = '', fbc = ''
    } = body || {};

    const text =
      '🏢 <b>Нова заявка · Квіз «Нерухомість»</b>\n\n' +
      '👤 <b>Ім\'я:</b> ' + esc(name) + '\n' +
      '📞 <b>Телефон:</b> ' + esc(phone) + '\n' +
      '🌍 <b>Країна:</b> ' + esc(country) + '\n\n' +
      '1️⃣ <b>Цікавить:</b> ' + esc(q1) + '\n' +
      '2️⃣ <b>Досвід:</b> ' + esc(q2) + '\n' +
      '3️⃣ <b>Готовність:</b> ' + esc(q3) + '\n\n' +
      '🔗 ' + esc(page);

    const tgRes = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const data = await tgRes.json();
    if (!data.ok) {
      console.error('Telegram error:', data);
      return res.status(502).json({ ok: false, error: 'Telegram error', detail: data });
    }

    // ===== Meta Conversions API (не блокує заявку у разі помилки) =====
    let capi = 'skipped';
    if (PIXEL_ID && CAPI_TOKEN) {
      try {
        capi = await sendCapiLead({
          PIXEL_ID, CAPI_TOKEN, TEST_CODE,
          name, phone, page, eventId, fbp, fbc, req
        });
      } catch (e) {
        capi = 'error';
        console.error('CAPI error:', e);
      }
    }

    return res.status(200).json({ ok: true, capi });
  } catch (err) {
    console.error('lead.js error:', err);
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
}

async function sendCapiLead({ PIXEL_ID, CAPI_TOKEN, TEST_CODE, name, phone, page, eventId, fbp, fbc, req }) {
  const ipRaw = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = req.headers['user-agent'] || '';

  const user_data = {
    client_user_agent: ua
  };
  if (ipRaw) user_data.client_ip_address = ipRaw;
  const phoneNorm = String(phone).replace(/[^\d]/g, '');
  if (phoneNorm) user_data.ph = [sha256(phoneNorm)];
  const nameNorm = String(name).trim().toLowerCase();
  if (nameNorm) user_data.fn = [sha256(nameNorm)];
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;

  const payload = {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId || undefined,           // дедуплікація з браузерним pixel Lead
      action_source: 'website',
      event_source_url: page || undefined,
      user_data
    }]
  };
  if (TEST_CODE) payload.test_event_code = TEST_CODE;

  const url = 'https://graph.facebook.com/v21.0/' + PIXEL_ID + '/events?access_token=' + encodeURIComponent(CAPI_TOKEN);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!r.ok || j.error) {
    console.error('CAPI response:', j);
    return 'error';
  }
  return 'sent';
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
