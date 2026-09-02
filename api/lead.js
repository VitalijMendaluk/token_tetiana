// Vercel Serverless Function — приймає заявку і надсилає її в Telegram.
// Токен і chat_id читаються з Environment Variables (додайте їх у Vercel і зробіть Redeploy).

export default async function handler(req, res) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  // Health-check: відкрий /api/lead у браузері (GET) — покаже, чи Vercel бачить змінні.
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      env: {
        TELEGRAM_BOT_TOKEN: TOKEN ? 'set ✅' : 'MISSING ❌',
        TELEGRAM_CHAT_ID: CHAT_ID ? ('set ✅ (' + CHAT_ID + ')') : 'MISSING ❌'
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

    const { name = '', phone = '', country = '', q1 = '—', q2 = '—', q3 = '—', page = '' } = body || {};

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

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('lead.js error:', err);
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
