// api/events.mjs — 診断版（各段階の件数を返す & 最終フォールバックあり）

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

const GENERIC = ['イベント','体験','ワークショップ','講座','教室','観察','自然','展示','工作','工房','ミッション'];

const UA_HEADERS = { 'User-Agent':'Mozilla/5.0', 'Accept-Language':'ja-JP,ja;q=0.9' };

const norm = (s='') => s.toString().normalize('NFKC').toLowerCase();

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
  if(q.includes('編み') || q.includes('あみ') || q.includes('ﾆｯﾄ') || q.includes('ニット')){
    ['編み物','かぎ編み','棒針編み','ニット','マフラー','アミグルミ'].forEach(t=>terms.add(norm(t)));
  }
  if(q.includes('木工') || q.includes('木')){
    ['木工','木の工作','DIY','クラフト','木材','工房体験'].forEach(t=>terms.add(norm(t)));
  }
  if(q.includes('花') || q.includes('ﾌﾗﾜｰ') || q.includes('フラワー')){
    ['花屋','フラワー','ブーケ','アレンジメント','生け花','ドライフラワー'].forEach(t=>terms.add(norm(t)));
  }
  if(q.includes('科学') || q.includes('科学館')){
    ['科学','科学館','工作','実験','観察','天体観望','星空','プラネタ','プラネタリウム'].forEach(t=>terms.add(norm(t)));
  }
  return [...terms];
}

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

const cleanTitle = (label='') =>
  label.replace(/[【】「」『』［］\[\]（）()]/g,' ').replace(/\s+/g,' ').trim();

const urlLooksEvent = (u='') => /(event|events|workshop|ws|calendar|katsudou|news|exhibition)/.test(u.toLowerCase());

export default async function handler(req, res) {
  let url;
  try { url = new URL(req.url, `https://${req.headers.host || 'example.com'}`); }
  catch { return send(res, { ok:true, note:'URL parse failed', items:[] }); }

  const mode  = url.searchParams.get('mode') || '';
  const qRaw  = url.searchParams.get('q') || '';
  const qNorm = norm(qRaw);
  const debug = url.searchParams.get('debug') === '1';

  // ---- モック（確認用） ----
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

  // ---- 実サイトからリンク収集 ----
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
    } catch {
      // サイト1つ失敗しても続行
    }
  }

  // ---- 段階フィルタ（途中の件数を全部計測） ----
  const diags = {
    q: qRaw,
    total_links: links.length,
    counts: {}
  };

  const terms = expandTerms(qRaw);
  let step1 = [];
  if (terms.length) step1 = links.filter(L => terms.some(t => L.labelN.includes(t)));
  diags.counts.match_terms = step1.length;

  let step2 = step1.length ? step1 : (qNorm ? links.filter(L => L.labelN.includes(qNorm)) : []);
  diags.counts.match_q = step2.length;

  const genN = GENERIC.map(norm);
  let step3 = step2.length ? step2 : links.filter(L => genN.some(g => L.labelN.includes(g)) || urlLooksEvent(L.url));
  diags.counts.generic_or_url = step3.length;

  let finalList = step3.length ? step3 : links.slice(0, 50); // それでも0なら素の先頭50件
  diags.counts.finalList = finalList.length;

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
  diags.counts.capped = capped.length;

  // ---- mode=links（診断表示） ----
  if (mode === 'links') {
    const sample = capped.slice(0,12).map(L => ({ url:L.url, label:L.label }));
    return send(res, { ok:true, ...diags, sample });
  }

  // ---- 通常モード：イベント配列に整形 ----
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

  if (debug) return send(res, { ok:true, ...diags, sample: events.slice(0,8) });
  return send(res, events);
}
