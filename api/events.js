import cheerio from 'cheerio';
import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// まずは少数の「中身が濃い固定URL」に絞るのがコツ（必要に応じて差し替え）
const SOURCES = [
  // 相模原市のイベント詳細・施設イベント一覧などに置き換えてください
  'https://www.google.com/search?q=%E7%9B%B8%E6%A8%A1%E5%8E%9F+%E5%85%AC%E6%B0%91%E9%A4%A8+%E3%83%AF%E3%83%BC%E3%82%AF%E3%82%B7%E3%83%A7%E3%83%83%E3%83%97',
  'https://www.google.com/search?q=%E7%9B%B8%E6%A8%A1%E5%B7%9D%E3%81%B5%E3%82%8C%E3%81%82%E3%81%84%E7%A7%91%E5%AD%A6%E9%A4%A8+%E3%82%A4%E3%83%99%E3%83%B3%E3%83%88',
  'https://www.youtube.com/results?search_query=' + encodeURIComponent('相模原 自発 体験 手芸 苔')
];

let CACHE = { time: 0, items: [] };
const TTL_MS = 1000 * 60 * 60 * 6; // 6時間

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const q   = url.searchParams.get('q') || '';
    const lat = Number(url.searchParams.get('lat') || '35.5710');
    const lon = Number(url.searchParams.get('lon') || '139.3707');
    const radius = Math.min(Number(url.searchParams.get('radius') || '8'), 30);

    // キャッシュが新鮮ならそれを返す
    const now = Date.now();
    if (now - CACHE.time < TTL_MS && CACHE.items.length) {
      const filtered = filterByRadius(CACHE.items, lat, lon, radius);
      return res.status(200).json(rerank(filtered, q, { lat, lon }));
    }

    // 収集：各URLの本文テキストをまとめる
    let allText = '';
    for (const src of SOURCES) {
      const t = await fetchText(src);
      allText += '\n\n' + t;
    }

    // Geminiでイベント抽出
    const events = await extractEvents(allText, q);

    // 正規化＆重複排除
    const map = new Map();
    for (const e of events) {
      const key = `${e.title || ''}@${e.place || ''}`;
      if (!map.has(key)) map.set(key, normalize(e));
    }
    const items = [...map.values()];
    CACHE = { time: now, items };

    const filtered = filterByRadius(items, lat, lon, radius);
    return res.status(200).json(rerank(filtered, q, { lat, lon }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error', message: e.message });
  }
}

// ============ ユーティリティ ============

async function fetchText(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();
    const $ = cheerio.load(html);
    return $('body').text().replace(/\s+/g, ' ').slice(0, 20000);
  } catch (e) {
    console.warn('fetch fail', url, e.message);
    return '';
  }
}

async function extractEvents(rawText, query) {
  if (!rawText) return [];
  const prompt =
`あなたはイベント抽出のアシスタントです。以下の本文から、
「相模原市および近隣で、中学生も参加できそうな小規模の体験・ワークショップ・観察・展示」
に該当する候補を最大10件、JSON配列で返してください。
出力は必ず次のスキーマのみ:
[{"title":"...","description":"...","place":"...","lat":null,"lon":null,"price":null,"when":"...","tags":["..."],"url":"..."}]
不明は null/空文字で返す。憶測で住所や価格を入れない。
キーワード: ${query || ''}
本文: ${rawText}`;
  const out = await model.generateContent(prompt);
  const txt = out.response.text();
  try {
    const s = txt.indexOf('['), e = txt.lastIndexOf(']') + 1;
    const arr = JSON.parse(txt.slice(s, e));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('parse fail', e.message, txt.slice(0,200));
    return [];
  }
}

function normalize(e) {
  return {
    title: e.title?.trim() || '',
    description: e.description?.trim() || '',
    place: e.place?.trim() || '',
    lat: typeof e.lat === 'number' ? e.lat : null,
    lon: typeof e.lon === 'number' ? e.lon : null,
    price: typeof e.price === 'number' ? e.price : null,
    when: e.when?.trim() || '',
    tags: Array.isArray(e.tags) ? e.tags.slice(0, 8) : [],
    url: e.url || ''
  };
}

function km(a, b) {
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const la = toRad(a.lat), lb = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(la)*Math.cos(lb)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

function filterByRadius(items, lat, lon, radius) {
  return items.filter(it =>
    (it.lat != null && it.lon != null) ? km({lat,lon},{lat:it.lat,lon:it.lon}) <= radius : true
  );
}

function rerank(items, q, origin) {
  return items.map(it => {
    const hasPos = (it.lat != null && it.lon != null);
    const d = hasPos ? km(origin, { lat: it.lat, lon: it.lon }) : 99;
    let s = 0;
    if (d <= 3) s += 15; else if (d <= 5) s += 10; else if (d <= 10) s += 6; else s += 2;
    if (q) {
      const hit = (it.title + ' ' + (it.tags||[]).join(' ') + ' ' + (it.description||'')).includes(q);
      if (hit) s += 12;
    }
    return { ...it, score: s, distance_km: hasPos ? Number(d.toFixed(1)) : null };
  }).sort((a,b) => (b.score||0) - (a.score||0)).slice(0, 20);
}

