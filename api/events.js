// api/events.js — 安全版（最小の依存: なし。Geminiはある場合のみ）
// 1) HTML -> テキスト  2) Geminiで抽出  3) 距離で並べる
// 失敗しても 200 + 空配列を返す。?debug=1 で内部エラーを見られる。

let model = null;
async function getModel() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (model) return model;
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  return model;
}

// まずは “情報が載ってる固定URL” に絞る（増やすのは後でOK）
const SOURCES = [
  "https://www.city.sagamihara.kanagawa.jp/event_calendar.html",
  "https://sagamiharacitymuseum.jp/event/",
  "https://sagamiharacitymuseum.jp/eventnews/",
  "https://sagamiharacitymuseum.jp/event/exhibition/",
  "https://sagamigawa-fureai.com/",
  "https://www.city.sagamihara.kanagawa.jp/kankou/1026674/hayabusa2/1033156.html"
];

const prompt =
`あなたはイベント抽出アシスタントです。以下の本文から、
「相模原市および近隣で、中学生も参加できそうな小規模の体験・ワークショップ・観察・展示」
に該当する候補を最大10件、JSON配列のみで返してください。
スキーマ:
[{"title":"...","description":"...","place":"...","lat":null,"lon":null,"price":null,"when":"...","tags":["..."],"url":"..."}]
不明は null/空文字。憶測で住所や価格を入れない。
同一または類似イベントは1件に統合し、同一タイトルでも日時・場所が同じなら1件のみ。
可能なら「when」に具体的な日付・期間（YYYY-MM-DD 〜）を入れてください。
キーワード: ${q}
本文: ${allText}`;



export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const q   = url.searchParams.get('q') || '';
  const lat = Number(url.searchParams.get('lat') || '35.5710');
  const lon = Number(url.searchParams.get('lon') || '139.3707');
  const radius = Math.min(Number(url.searchParams.get('radius') || '8'), 30);
  const debug = url.searchParams.get('debug') === '1';

  const errors = [];

  try {
    // 1) 収集：本文テキストをざっくり抽出（fetch は Node18+ で標準）
    let allText = '';
    for (const src of SOURCES) {
      try {
        const r = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await r.text();
        // 超簡易テキスト化（cheerio無し）：タグを削って空白整理
        const text = html
          .replace(/<script[^>]*>.*?<\/script>/gis, ' ')
          .replace(/<style[^>]*>.*?<\/style>/gis, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .slice(0, 18000); // 18KBまでに縮める
        allText += '\n\n' + text;
      } catch (e) {
        errors.push(`fetch fail: ${src} :: ${e.message}`);
      }
    }

    // 2) GeminiでJSON抽出（キーが無ければ空配列）
    let events = [];
    try {
      const m = await getModel();
      if (m && allText.trim()) {
        const prompt =
`あなたはイベント抽出アシスタントです。以下の本文から、
「相模原市および近隣で、中学生も参加できそうな小規模の体験・ワークショップ・観察・展示」
に該当する候補を最大10件、JSON配列のみで返してください。
スキーマ:
[{"title":"...","description":"...","place":"...","lat":null,"lon":null,"price":null,"when":"...","tags":["..."],"url":"..."}]
不明は null/空文字。憶測で住所や価格を入れない。
キーワード: ${q}
本文: ${allText}`;

        const out = await m.generateContent(prompt);
        const txt = out.response.text();
        // JSONだけを切り出してパース
        const s = txt.indexOf('['), e = txt.lastIndexOf(']') + 1;
        if (s >= 0 && e > s) {
          events = JSON.parse(txt.slice(s, e));
        } else {
          errors.push('gemini: no JSON block');
        }
      } else {
        errors.push('gemini: no key or empty text');
      }
    } catch (e) {
      errors.push('gemini parse: ' + e.message);
      // 失敗しても落とさない
    }

    // 3) 正規化・スコアリング・半径フィルタ
    const norm = events.map(normalize);
    const filtered = norm.filter(it =>
      (it.lat!=null && it.lon!=null) ? km({lat,lon},{lat:it.lat,lon:it.lon}) <= radius : true
    );
    const ranked = rerank(filtered, q, { lat, lon });

    // デバッグ要求があれば内部状態も返す（本番ではdebug=1を付けた時だけ）
    if (debug) {
      return res.status(200).json({ ok: true, count: ranked.length, errors, sample: ranked.slice(0,3) });
    }
    return res.status(200).json(ranked);

  } catch (e) {
    // ここまで来ても 500 は出さず 200 + 空配列で返すとUIは生きる
    if (debug) {
      return res.status(200).json({ ok: false, errors: [`fatal: ${e.message}`] });
    }
    return res.status(200).json([]);
  }
}

// ===== ユーティリティ =====
function normalize(e) {
  return {
    title: e?.title?.toString().trim() || '',
    description: e?.description?.toString().trim() || '',
    place: e?.place?.toString().trim() || '',
    lat: (typeof e?.lat === 'number') ? e.lat : null,
    lon: (typeof e?.lon === 'number') ? e.lon : null,
    price: (typeof e?.price === 'number') ? e.price : null,
    when: e?.when?.toString().trim() || '',
    tags: Array.isArray(e?.tags) ? e.tags.slice(0,8).map(t=>t.toString()) : [],
    url: e?.url?.toString() || ''
  };
}
function km(a, b) {
  const R = 6371, toRad = d => d*Math.PI/180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const la = toRad(a.lat), lb = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(la)*Math.cos(lb)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}
function rerank(items, q, origin) {
  return items.map(it => {
    const hasPos = (it.lat!=null && it.lon!=null);
    const d = hasPos ? km(origin, { lat: it.lat, lon: it.lon }) : 99;
    let s = 0;
    if (d <= 3) s += 15; else if (d <= 5) s += 10; else if (d <= 10) s += 6; else s += 2;
    if (q) {
      const hit = (it.title + ' ' + (it.tags||[]).join(' ') + ' ' + (it.description||'')).includes(q);
      if (hit) s += 12;
    }
    return { ...it, score: s, distance_km: hasPos ? Number(d.toFixed(1)) : null };
  }).sort((a,b) => (b.score||0)-(a.score||0)).slice(0, 20);
}


function canonicalTitle(s=''){
  return s.toString()
    .replace(/[【】「」『』［］（）()［］]/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
}
function canonicalWhen(s=''){
  return s.toString().replace(/\s+/g,' ').trim().toLowerCase();
}
function hostOf(u=''){
  try{ return new URL(u).host.replace(/^www\./,''); }catch{ return ''; }
}

// 似たものをまとめるキー：タイトル + 場所 + 期間
function makeKey(e){
  return [
    canonicalTitle(e.title||''),
    (e.place||'').trim().toLowerCase(),
    canonicalWhen(e.when||'')
  ].join('@');
}

// デデュープ＋ドメイン上限（例：各ドメイン最大3件）
function dedupeAndCap(items, perDomainCap=3){
  const byKey = new Map();
  for(const it of items){
    const key = makeKey(it);
    if(!byKey.has(key)) byKey.set(key, it);
  }
  const deduped = [...byKey.values()];
  const domainCount = {};
  const kept = [];
  for(const it of deduped){
    const h = hostOf(it.url||'');
    domainCount[h] = (domainCount[h]||0) + 1;
    if(!h || domainCount[h] <= perDomainCap) kept.push(it);
  }
  return kept;
}


