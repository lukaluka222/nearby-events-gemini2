// api/events.js
// 1) SOURCESからHTML取得 → 2) Geminiでイベント抽出（任意）→ 3) ダメならリンクfallback（q必須）
// 4) 正規化・デデュープ・半径フィルタ・スコア → JSON

let model = null;
async function getModel() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (model) return model;
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  return model;
}

// 当たりやすい一覧直URLにするほど良い
const SOURCES = [
  "https://www.city.sagamihara.kanagawa.jp/event_calendar.html",
  "https://sagamiharacitymuseum.jp/event/",
  "https://sagamiharacitymuseum.jp/eventnews/",
  "https://sagamigawa-fureai.com/",
  "https://fujino-art.jp/workshop/",
  "https://www.e-sagamihara.com/event/"
];

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const q   = url.searchParams.get('q') || '';
  const lat = Number(url.searchParams.get('lat') || '35.5710');
  const lon = Number(url.searchParams.get('lon') || '139.3707');
  const radius = Math.min(Number(url.searchParams.get('radius') || '8'), 30);
  const debug = url.searchParams.get('debug') === '1';
  const fresh = url.searchParams.get('fresh') === '1';
  const mode  = url.searchParams.get('mode') || '';

  const errors = [];

  try {
    // --- 開発用モック（qで変わるかの確認） ---
    if (mode === 'mock') {
      const MOCK_LINKS = [
        { url:"https://example.com/koke1", label:"苔の観察ワークショップ（相模原市内）", host:"example.com" },
        { url:"https://example.com/koke2", label:"川辺でコケ観察ミッション", host:"example.com" },
        { url:"https://example.com/tegei1", label:"手芸（刺し子）はじめて教室", host:"example.com" },
        { url:"https://example.com/ami1",  label:"編み物ミニワークショップ", host:"example.com" },
        { url:"https://example.com/mokko", label:"木工フリーワーク", host:"example.com" },
        { url:"https://example.com/hanaya",label:"花屋のミニブーケづくり体験", host:"example.com" },
      ];
      const items = fallbackFromLinks(MOCK_LINKS, q);
      if (debug) return res.status(200).json({ ok:true, from:"mock", q, count:items.length, sample:items.slice(0,5) });
      return res.status(200).json(items);
    }

    // 1) 収集
    let allText = '';
    let allLinks = [];
    for (const src of SOURCES) {
      try {
        const r = await fetch(src, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept-Language': 'ja-JP,ja;q=0.9'
          }
        });
        const html = await r.text();

        // aリンク収集
        const linkMatches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)];
        for (const m of linkMatches) {
          const href = m[1];
          const label = m[2].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
          if (!label || label.length < 4) continue;
          let abs = href;
          try { abs = new URL(href, src).toString(); } catch {}
          let host = '';
          try { host = new URL(abs).host.replace(/^www\./,''); } catch {}
          allLinks.push({ url: abs, label, host });
        }

        // プレーンテキスト化
        const text = html
          .replace(/<script[^>]*>.*?<\/script>/gis, ' ')
          .replace(/<style[^>]*>.*?<\/style>/gis, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .slice(0, 18000);
        allText += '\n\n' + text
