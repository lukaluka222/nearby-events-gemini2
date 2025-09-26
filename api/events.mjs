// api/events.js — 相模原向けおすすめ強化版（軽量スクレイプ→リンク抽出→フィルタ＆スコア）
// ※ express 等は不要。vercel の Serverless Function としてそのまま動きます。

const BUILD = 'events.js recsys-light v2 (bright UI)';

function send(res, obj) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ build: BUILD, ...obj }));
}

// — 対象サイト（必要に応じて足してOK）
const SOURCES = [
  'https://www.city.sagamihara.kanagawa.jp/event_calendar.html',
  'https://sagamiharacitymuseum.jp/event/',
  'https://sagamiharacitymuseum.jp/eventnews/',
  'https://sagamigawa-fureai.com/',
  'https://fujino-art.jp/workshop/',
  'https://www.e-sagamihara.com/event/'
];

// — 相模原/近隣の優先ドメイン
const PRIORITY_DOMAINS = [
  'city.sagamihara.kanagawa.jp',
  'sagamiharacitymuseum.jp',
  'sagamigawa-fureai.com',
  'fujino-art.jp',
  'e-sagamihara.com',
  'pref.kanagawa.jp',
  'kanagawa-park.or.jp',
  'jalps.org', // 県立相模原公園などがぶら下がる場合に備え（必要なら変更）
];

// — 地名キーワード
const LOCATION_WORDS = [
  '相模原','緑区','中央区','南区','橋本','淵野辺','相模大野','相模湖',
  '城山','藤野','愛川','座間','町田','八王子','高尾','厚木'
];

// — イベントっぽい語
const EVENTISH = [
  'イベント','体験','ワークショップ','講座','教室','展示','観察','見学',
  '工作','工房','フェア','マルシェ','まつり','祭','ハンズオン','セミナー',
  '天体観望','星空','プラネタリウム','自然観察','ガイドツアー','クラフト'
];

// — ノイズ（お知らせ・入札・採用等）除外
const TITLE_BLACKLIST = [
  '入札','落札','公告','指名停止','募集要項','公募型','交通規制',
  '税','納付','確定申告','防災','注意喚起','詐欺','選挙','議会',
  '採用','人事','求人','条例','告示','コロナ','新型'
];

const UA_HEADERS = { 'User-Agent':'Mozilla/5.0', 'Accept-Language':'ja-JP,ja;q=0.9' };
const norm = (s='') => s.toString().normalize('NFKC').toLowerCase();

const cleanTitle = (label='') =>
  label.replace(/[【】「」『』［］\[\]（）()]/g,' ').replace(/\s+/g,' ').trim();

const urlLooksEvent = (u='') =>
  /(event|events|workshop|ws|calendar|katsudou|exhibition|eventnews)/.test((u||'').toLowerCase());

function hasAny(s, words){ const n = norm(s); return words.some(w => n.includes(norm(w))); }

function extractWhen(label='') {
  const s = label.replace(/\s+/g,' ');
  const re1 = /(?:20\d{2}年)?\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*[（(][^）)]+[）)])?/g;
  const re2 = /\d{1,2}\/\d{1,2}(?:\s*[-〜～]\s*\d{1,2}\/\d{1,2})?/g;
  const re3 = /\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?(?:\s*[-〜～]\s*\d{1,2}\s*月?\s*\d{0,2}\s*日?)?/g;
  let m = s.match(re1); if (m && m.join('').trim()) return m.join(' / ');
  m = s.match(re2); if (m && m.join('').trim()) return m.join(' / ');
  m = s.match(re3); if (m && m.join('').trim()) return m.join(' / ');
  return '';
}

function expandTerms(qRaw=''){
  const q = norm(qRaw);
  const t = new Set();
  if(!q) return [];
  t.add(q);
  if (q.includes('苔')||q.includes('こけ')||q.includes('ｺｹ')) {
    ['苔','こけ','コケ','苔玉','テラリウム','苔観察','苔庭'].forEach(x=>t.add(norm(x)));
  }
  if (q.includes('手芸')||q.includes('クラフト')||q.includes('ハンドメイド')) {
    ['手芸','ハンドメイド','クラフト','刺繍','裁縫','ビーズ','フェルト','羊毛フェルト'].forEach(x=>t.add(norm(x)));
  }
  if (q.includes('編み')||q.includes('ニット')) {
    ['編み物','かぎ編み','棒針編み','ニット','アミグルミ'].forEach(x=>t.add(norm(x)));
  }
  if (q.includes('木工')||q.includes('木')) {
    ['木工','木の工作','DIY','工房体験'].forEach(x=>t.add(norm(x)));
  }
  if (q.includes('花')||q.includes('フラワー')) {
    ['花屋','ブーケ','フラワーアレンジメント','生け花','ドライフラワー'].forEach(x=>t.add(norm(x)));
  }
  if (q.includes('科学')||q.includes('科学館')||q.includes('天体')) {
    ['科学','科学館','工作','実験','観察','天体観望','星空','プラネタリウム'].forEach(x=>t.add(norm(x)));
  }
  return [...t];
}

export default async function handler(req, res) {
  let url; try { url = new URL(req.url, `https://${req.headers.host || 'example.com'}`); }
  catch { return send(res, { ok:true, note:'URL parse failed', items:[] }); }

  const mode  = url.searchParams.get('mode') || '';
  const qRaw  = url.searchParams.get('q') || '';
  const qNorm = norm(qRaw);
  const debug = url.searchParams.get('debug') === '1';

  // --- mock（動作確認用） ---
  if (mode === 'mock') {
    const LINKS = [
      { url:'https://example.com/koke1', label:'苔の観察ワークショップ（相模原）' },
      { url:'https://example.com/ami1',  label:'編み物ミニワークショップ in 橋本' },
      { url:'https://example.com/hanaya',label:'花屋のミニブーケづくり体験（相模大野）' }
    ];
    const terms = expandTerms(qRaw);
    const hit = terms.length
      ? LINKS.filter(x => terms.some(t => norm(x.label).includes(t)))
      : (qNorm ? LINKS.filter(x => norm(x.label).includes(qNorm)) : LINKS);
    return send(res, { ok:true, mode:'mock', q:qRaw, count:hit.length, sample:hit.slice(0,8) });
  }

  // --- 収集 ---
  const links = [];
  for (const src of SOURCES) {
    try {
      const r = await fetch(src, { headers: UA_HEADERS });
      const html = await r.text();
      const ms = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)];
      for (const m of ms) {
        const href  = m[1];
        const label = m[2].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
        if (!label || label.length < 2) continue;
        let abs = href; try { abs = new URL(href, src).toString(); } catch {}
        links.push({ url:abs, label, labelN:norm(label) });
      }
    } catch {}
  }

  // --- 前処理（スコアリング） ---
  const terms = expandTerms(qRaw);
  const scored = links.map(L => {
    let score = 0;
    // ノイズ除外（タイトル）
    if (hasAny(L.label, TITLE_BLACKLIST)) score -= 100;

    // イベントらしさ
    if (urlLooksEvent(L.url)) score += 4;
    if (hasAny(L.label, EVENTISH)) score += 6;

    // 地名加点
    if (hasAny(L.label, LOCATION_WORDS)) score += 6;

    // ドメイン加点
    try {
      const host = new URL(L.url).host.replace(/^www\./,'');
      if (PRIORITY_DOMAINS.includes(host)) score += 8;
    } catch {}

    // クエリ一致（おすすめ＝q空の時は 0）
    if (terms.length && terms.some(t => L.labelN.includes(t))) score += 10;
    else if (!terms.length && qNorm && L.labelN.includes(qNorm)) score += 6;

    return { ...L, score };
  });

  // 負スコア（ノイズ）を除外
  let cand = scored.filter(x => x.score >= (qNorm ? 6 : 8));

  // それでも少ない時は緩める
  if (cand.length < 6) cand = scored.filter(x => x.score >= (qNorm ? 4 : 6));
  if (cand.length < 6) cand = scored.slice(); // 最終的にゼロは避ける

  // 重複とドメイン上限（広め）
  const byUrl = new Map();
  const domainCount = {};
  const perDomainCap = 6;
  const kept = [];
  for (const c of cand.sort((a,b)=> (b.score - a.score))) {
    if (byUrl.has(c.url)) continue;
    byUrl.set(c.url, true);
    let host=''; try { host = new URL(c.url).host.replace(/^www\./,''); } catch {}
    domainCount[host] = (domainCount[host]||0) + 1;
    if (host && domainCount[host] > perDomainCap) continue;
    kept.push(c);
    if (kept.length >= 20) break;
  }

  // 診断モード
  if (mode === 'links') {
    const sample = kept.slice(0,12).map(L => ({ url:L.url, label:L.label, score:L.score }));
    return send(res, { ok:true, mode:'links', q:qRaw, total_links:links.length, kept:kept.length, sample });
  }

  // イベント配列へ整形（簡易）
  const events = kept.map(L => ({
    title: cleanTitle(L.label),
    description: '',
    place: hasAny(L.label, LOCATION_WORDS) ? '相模原・近隣' : '',
    lat: null, lon: null, price: null,
    when: extractWhen(L.label),
    tags: qRaw ? [qRaw] : [],
    url: L.url,
    score: L.score
  }));

  if (debug) return send(res, { ok:true, mode:'normal', q:qRaw, sample: events.slice(0,8) });
  return send(res, events);
}
