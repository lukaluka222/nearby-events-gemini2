// api/events.mjs — links モード改良：q未ヒットなら汎用イベント語でフォールバック + debug出力
function send(res, obj) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

// まずは “一覧ページ直” を中心に（リンク抽出が効きやすい）
const SOURCES = [
  'https://www.city.sagamihara.kanagawa.jp/event_calendar.html', // 市公式カレンダー
  'https://sagamiharacitymuseum.jp/event/',                      // 市立博物館：イベント一覧
  'https://sagamiharacitymuseum.jp/eventnews/',                  // 市立博物館：イベントニュース
  'https://sagamigawa-fureai.com/',                              // ふれあい科学館
  'https://fujino-art.jp/workshop/',                             // 藤野芸術の家：工房体験
  'https://www.e-sagamihara.com/event/'                          // 観光協会
];

// 「苔/コケ/こけ」等のゆらぎ吸収 + 全角半角/小文字化
function norm(s=''){
  return s
    .toString()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/こけ|ｺｹ/g, '苔'); // ひら/半角ｶﾅを苔に寄せる（簡易）
}

const GENERIC_WORDS = ['イベント','体験','ワークショップ','講座','教室','観察','自然','展示','工作','工房','ミッション'];

export default async function handler(req, res) {
  let url;
  try { url = new URL(req.url, `https://${req.headers.host || 'example.com'}`); }
  catch { return send(res, { ok: true, note: 'URL parse failed', items: [] }); }

  const mode  = url.searchParams.get('mode') || '';
  const qRaw  = url.searchParams.get('q') || '';
  const q     = norm(qRaw);
  const debug = url.searchParams.get('debug') === '1';

  // --- 既存のモックは残す ---
  if (mode === 'mock') {
    const LINKS = [
      { url: 'https://example.com/koke1', label: '苔の観察ワークショップ（相模原）' },
      { url: 'https://example.com/koke2', label: '川辺でコケ観察ミッション' },
      { url: 'https://example.com/tegei1', label: '手芸（刺し子）はじめて教室' },
      { url: 'https://example.com/ami1',  label: '編み物ミニワークショップ' },
      { url: 'https://example.com/mokko', label: '木工フリーワーク' },
      { url: 'https://example.com/hanaya',label: '花屋のミニブーケづくり体験' }
    ];
    const hit = q ? LINKS.filter(x => norm(x.label).includes(q)) : LINKS;
    return send(res, { ok:true, from:'mock', q:qRaw, count:hit.length, sample:hit.slice(0,8) });
  }

  // --- 実サイトからリンク抽出 ---
  const links = [];
  for (const src of SOURCES) {
    try {
      const r = await fetch(src, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja-JP,ja;q=0.9' }
      });
      const html = await r.text();
      const ms = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)];
      for (const m of ms) {
        const href  = m[1];
        const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!label || label.length < 3) continue;
        let abs = href;
        try { abs = new URL(href, src).toString(); } catch {}
        links.push({ url: abs, label, labelN: norm(label) });
      }
    } catch (e) {
      // 1サイト失敗しても続行
    }
  }

  // 1) まずは q に一致
  let filtered = q ? links.filter(L => L.labelN.includes(q)) : [];

  // 2) q がなくて0件、または q があっても0件 → 汎用イベント語で拾う
  if (filtered.length === 0) {
    filtered = links.filter(L => GENERIC_WORDS.some(w => L.label.includes(w)));
  }

  // 3) 取りすぎ回避：同一ドメイン上限 & 重複簡易除去
  const byUrl = new Map();
  const perDomainCap = 4;
  const domainCount = {};
  const out = [];
  for (const L of filtered) {
    if (byUrl.has(L.url)) continue;
    byUrl.set(L.url, true);
    let host = '';
    try { host = new URL(L.url).host.replace(/^www\./,''); } catch {}
    domainCount[host] = (domainCount[host] || 0) + 1;
    if (host && domainCount[host] > perDomainCap) continue;
    out.push({ url: L.url, label: L.label });
    if (out.length >= 20) break;
  }

  if (mode === 'links') {
    if (debug) {
      // デバッグ用に、最初に拾えた生リンクも少し見せる
      return send(res, { ok:true, q:qRaw, total_links:links.length, count:out.length, sample:out.slice(0,12) });
    }
    return send(res, { ok:true, count: out.length, sample: out.slice(0,12) });
  }

  // 通常モード：とりあえずイベント配列の形に整形して返す（まだラベルとURLのみ）
  const events = out.map(L => ({
    title: L.label,
    description: '',
    place: '',
    lat: null,
    lon: null,
    price: null,
    when: '',
    tags: qRaw ? [qRaw] : [],
    url: L.url
  }));

  if (debug) return send(res, { ok:true, count: events.length, sample: events.slice(0,8) });
  return send(res, events);
}
