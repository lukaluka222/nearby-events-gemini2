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
  "https://www.city.sagamihara.kanagawa.jp/event_calendar.html",               // 市公式カレンダー（横断） :contentReference[oaicite:0]{index=0}
  "https://sagamiharacitymuseum.jp/event/",                                   // 市立博物館：イベント一覧 :contentReference[oaicite:1]{index=1}
  "https://sagamiharacitymuseum.jp/eventnews/",                               // 市立博物館：イベントニュース :contentReference[oaicite:2]{index=2}
  "https://sagamigawa-fureai.com/",                                           // 相模川ふれあい科学館（解説・WS） :contentReference[oaicite:3]{index=3}
  "https://fujino-art.jp/workshop/",                                          // 藤野芸術の家：工房体験＆WS（通年/予約可） :contentReference[oaicite:4]{index=4}
  "https://www.e-sagamihara.com/event/"                                       // 観光協会：おすすめイベント（季節） :contentReference[oaicite:5]{index=5}
];



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
    let allText = '';
    let allLinks = [];

    for (const src of SOURCES) {
      try {
        const r = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await r.text();
        // 超簡易テキスト化（cheerio無し）：タグを削って空白整理
        const text = html

          // aタグ（リンク）からタイトルらしきテキストを収集
const linkMatches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)];
for (const m of linkMatches) {
  const href = m[1];
  const label = m[2].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  if (label && label.length >= 4) {
    let abs = href;
    try { abs = new URL(href, src).toString(); } catch {}
    allLinks.push({ url: abs, label, host: new URL(abs).host.replace(/^www\./,'') });
  }
}
        const r = await fetch(src, {
  headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja-JP,ja;q=0.9' }
});


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
同一または類似イベントは1件に統合し、同一タイトルでも日時・場所が同じなら1件のみ。
可能なら「when」に具体的な日付・期間（YYYY-MM-DD 〜）を入れてください。
キーワード: ${q}
本文: ${allText}`;

    const out = await m.generateContent(prompt);
    const txt = out.response.text();
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
}

    if (!events.length && allLinks.length) {
  const fb = fallbackFromLinks(allLinks, q);
  if (fb.length) {
    events = fb;
    errors.push(`fallback: links -> ${fb.length}`);
  }
}

    // 似た候補が多いときのバラけ対策（軽いシャッフル）
uniq.sort(() => Math.random() - 0.5);


    // 3) 正規化 → デデュープ → ドメイン上限 → 半径フィルタ → スコア
const norm = events.map(normalize);

// ★ここが追加
const uniq = dedupeAndCap(norm, 3); // 各ドメイン最大3件（必要なら2に）

const filtered = uniq.filter(it =>
  (it.lat!=null && it.lon!=null) ? km({lat,lon},{lat:it.lat,lon:it.lon}) <= radius : true
);
const ranked = rerank(filtered, q, { lat, lon });

    
// ranked を作った直後（debug返却の前）に追加
if (!ranked.length) {
  return res.status(200).json([{
    title: "（APIフォールバック）相模川 こけ観察ミッション",
    description: "石の裏や日陰で観察。写真と観察ノートに残そう。",
    place: "新磯〜高田橋の河原",
    lat: 35.5416, lon: 139.3608,
    price: 0, when: "晴れの日の午後30〜60分",
    tags: ["苔","自然観察","屋外","短時間OK"],
    url: "https://www.google.com/search?q=%E7%9B%B8%E6%A8%A1%E5%8E%9F%20%E8%8B%94%20%E8%A6%B3%E5%AF%9F"],
    score: 20, distance_km: 3.2
  }]);
}

    
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


function fallbackFromLinks(links, q) {
  // 優先ワード（qがあれば最優先）
  const KEY = q ? [q, "イベント","体験","ワークショップ","講座","展","観望","工作","教室"]
                : ["イベント","体験","ワークショップ","講座","展","観望","工作","教室"];

  // ドメインごとに上限（偏り防止）
  const perDomainCap = 2;
  const domainCount = {};

  const out = [];
  for (const L of links) {
    const label = L.label;
    // ラベルに優先ワードが1つでも含まれる
    if (!KEY.some(k => label.includes(k))) continue;

    // ドメイン上限
    domainCount[L.host] = (domainCount[L.host] || 0) + 1;
    if (domainCount[L.host] > perDomainCap) continue;

    out.push({
      title: label.slice(0, 80),
      description: "",
      place: "",
      lat: null, lon: null,
      price: null,
      when: "",
      tags: [],
      url: L.url
    });
    if (out.length >= 8) break;
  }
  return out;
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


