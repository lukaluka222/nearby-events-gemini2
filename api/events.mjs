// api/events.mjs — 緩めフィルタ + 最終フォールバック（空を返さない）

function send(res, obj) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

const SOURCES = [
  'https://www.city.sagamihara.kanagawa.jp/event_calendar.html',
  'https://sagamiharacitymuseum.jp/event/',
  'https://sagamiharacitymuseum.jp/eventnews/',
  'https://sagamigawa-fureai.com/',
  'https://fujino-art.jp/workshop/',
  'https://www.e-sagamihara.com/event/'
];

// 正規化
function norm(s=''){ return s.toString().normalize('NFKC').toLowerCase(); }

// 同義語展開（緩め）
function expandTerms(qRaw=''){
  const q = norm(qRaw);
  const terms = new Set();
  if(!q) return [];
  terms.add(q);

  if(q.includes('苔') || q.includes('こけ') || q.includes('ｺｹ')){
    ['苔','こけ','コケ','苔玉','テラリウム','苔観察','苔の観察','苔庭'].forEach(t=>terms.add(norm(t)));
  }
  if(q.includes('手芸')){
    ['手芸','ハンドメイド','クラフト','刺し子','刺繍','裁縫','ミシン','ビーズ','フェルト','羊毛フェルト','布小物'].forEach(t=>terms.add(norm(t)));
  }
  if(q.includes('編み') || q.includes('あみ') || q.includes('ニット')){
    ['編み物','かぎ編み','棒針編み','ニット','マフラー','アミグルミ'].forEach(t=>terms.add(norm(t)));
  }
  if(q.includes('木工') || q.includes('木')){
    ['木工','木の工作','DIY','クラフト','木材','工房体験'].forEach(t=>terms.add(norm(t)));
  }
  if(q.includes('花') || q.includes('フラワー')){
    ['花屋','フラワー','ブーケ','アレンジメント','生け花','ドライフラワー'].forEach(t=>terms.add(norm(t)));
  }
  if(q.includes('科学') || q.includes('科学館')){
    ['科学','科学館','工作','実験','観察','天体観望','星空','プラネタ','プラネタリウム'].forEach(t=>terms.add(norm(t)));
  }
  return [...terms];
}

const GENERIC = ['イベント','体験','ワークショップ','講座','教室','観察','自然','展示','工作','工房','ミッション'];

// 日付抽出（簡易）
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

// タイトル整形
function cleanTitle(label=''){
  return label.replace(/[【】「」『』［］\[\]（）()]/g,' ').replace(/\s+/g,' ').trim();
}

// 「イベントっぽい」URL判定（緩め）
function urlLooksEvent(u=''){
  const s = u.toLowerCase();
  return /(event|events|workshop|ws|calendar|katsudou|news|exhibition)/.test(s);
}

export default async function handler(req, res) {
  let url;
  try { url = new URL(req.url, `https://${req.headers.host || 'example.com'}`); }
  catch { return send(res, { ok:true, note:'URL parse failed', items:[] }); }

  const mode  = url.searchParams.get('mode') || '';
  const qRaw  = url.searchParams.get('q') || '';
  const qNorm = norm(qRaw);
  const debug = url.searchParams.get('debug') === '1';

  // --- モック（残す） ---
  if (mode === 'mock') {
    const LINKS = [
      { url:'https://example.com/koke1', label:'苔の観察ワークショップ（相模原）' },
      { url:'https://example.com/koke2', label:'川辺でコケ観察ミッション' },
      { url:'https://example.com/tegei1', label:'手芸（刺し子）はじめて教室' },
      { url:'https://example.com/ami1',  label:'編み物ミニワークショップ' },
      { url:'https://example.com/mokko', label:'木工フリーワーク' },
      { url:'https://example.com/hanaya',label:'花屋のミニブーケづくり体験' }
    ];
    const terms = expandTerms(qRaw);
    const hit = terms.length
      ? LINKS.filter(x => terms.some(t => norm(x.label).includes(t)))
      : (qNorm ? LINKS.filter(x => norm(x.label).includes(qNorm)) : LINKS);
    return send(res, { ok:true, from:'mock', q:qRaw, count:hit.length, sample:hit.slice(0,8) });
  }

  // --- 実サイトからリンク収集 ---
  const links = [];
  for (const src of SOURCES) {
    try {
      const r = await fetch(src, { headers: { 'User-Agent':'Mozilla/5.0', 'Accept-Language':'ja-JP,ja;q=0.9' }});
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

  // --- フィルタ（段階的に緩める） ---
  const terms = expandTerms(qRaw);

  // 1) 同義語 or 元のq（ラベル）
  let filtered = [];
  if (terms.length) filtered = links.filter(L => terms.some(t => L.labelN.includes(t)));
  if (!filtered.length && qNorm) filtered = links.filter(L => L.labelN.includes(qNorm));

  // 2) まだ0なら「イベントっぽい」ラベル or URL
  if (!filtered.length) {
    const genN = GENERIC.map(norm);
    filtered = links.filter(L =>
      genN.some(g => L.labelN.includes(g)) || urlLooksEvent(L.url)
    );
  }

  // 3) それでも0なら「全部の中から URL がイベントっぽいもの」を上位20件
  if (!filtered.length) {
    filtered = links.filter(L => urlLooksEvent(L.url));
  }

  // 4) 最終フォールバック：本当に0なら「先頭から12件だけ」見せてデバッグ
  const finalList = filtered.length ? filtered : links.slice(0, 12);

  // 重複 & ドメイン上限
  const byUrl = new Map();
  const perDomainCap = 4;
  const domainCount = {};
  const capped = [];
  for (const L of finalList) {
    if (byUrl.has(L.url)) continue;
    byUrl.set(L.url, true);
    let host=''; try { host = new URL(L.url).host.replace(/^www\./,''); } catch {}
    domainCount[host] = (domainCount[host] || 0) + 1;
    if (host && domainCount[host] > perDomainCap) continue;
    capped.push(L);
    if (capped.length >= 20) break;
  }

  // --- mode=links（デバッグ） ---
  if (mode === 'links') {
    const sample = capped.slice(0,12).map(L => ({ url:L.url, label:L.label }));
    if (debug) return send(res, { ok:true, q:qRaw, total_links:links.length, count:sample.length, sample });
    return send(res, { ok:true, count:sample.length, sample });
  }

  // --- 通常モード：イベント配列に整形 ---
  const events = capped.map(L => ({
    title: cleanTitle(L.label),
    description: '',
    place: '',
    lat: null,
    lon: null,
    price: null,
    when: extractWhen(L.label),
    tags: qRaw ? [qRaw] : [],
    url: L.url
  }));

  if (debug) return send(res, { ok:true, q:qRaw, count:events.length, sample:events.slice(0,8) });
  return send(res, events);
}
