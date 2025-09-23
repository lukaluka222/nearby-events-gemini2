// api/events.mjs — リンク抽出 → イベント配列（簡易 when 抽出つき）
// ESM 版（export default）。fetch は Node18+ で標準。

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

// ひら/カナのゆらぎ軽減
function norm(s=''){
  return s.toString().normalize('NFKC').toLowerCase().replace(/こけ|ｺｹ/g,'苔');
}

// タイトルから日付らしき文字列を抜く（超簡易）
function extractWhen(label) {
  const s = label.replace(/\s+/g,' ');
  const re1 = /(?:20\d{2}年)?\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*[（(][^）)]+[）)])?/g; // 2025年9月24日（火） 等
  const re2 = /\d{1,2}\/\d{1,2}(?:\s*[-〜～]\s*\d{1,2}\/\d{1,2})?/g;                     // 9/24〜9/28 等
  const re3 = /\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?(?:\s*[-〜～]\s*\d{1,2}\s*月?\s*\d{0,2}\s*日?)?/g; // 9月 or 9月24日〜10月1日
  let m = s.match(re1); if (m && m.join('').trim()) return m.join(' / ');
  m = s.match(re2); if (m && m.join('').trim()) return m.join(' / ');
  m = s.match(re3); if (m && m.join('').trim()) return m.join(' / ');
  return '';
}

// ラベル整形
function cleanTitle(label=''){
  return label
    .replace(/[【】「」『』［］\[\]（）()]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export default async function handler(req, res) {
  let url; try { url = new URL(req.url, `https://${req.headers.host || 'example.com'}`); }
  catch { return send(res, { ok:true, note:'URL parse failed', items:[] }); }

  const mode  = url.searchParams.get('mode') || '';
  const qRaw  = url.searchParams.get('q') || '';
  const q     = norm(qRaw);
  const debug = url.searchParams.get('debug') === '1';

  // --- モック（動作確認用） ---
  if (mode === 'mock') {
    const LINKS = [
      { url:'https://example.com/koke1', label:'苔の観察ワークショップ（相模原）' },
      { url:'https://example.com/koke2', label:'川辺でコケ観察ミッション' },
      { url:'https://example.com/tegei1', label:'手芸（刺し子）はじめて教室' },
      { url:'https://example.com/ami1',  label:'編み物ミニワークショップ' },
      { url:'https://example.com/mokko', label:'木工フリーワーク' },
      { url:'https://example.com/hanaya',label:'花屋のミニブーケづくり体験' }
    ];
    const hit = q ? LINKS.filter(x => norm(x.label).includes(q)) : LINKS;
    return send(res, { ok:true, from:'mock', q:qRaw, count:hit.length, sample:hit.slice(0,8) });
  }

  // --- 実サイトからリンク収集 ---
  const links = [];
  for (const src of SOURCES) {
    try {
      const r = await fetch(src, {
        headers: { 'User-Agent':'Mozilla/5.0', 'Accept-Language':'ja-JP,ja;q=0.9' }
      });
      const html = await r.text();
      const ms = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)];
      for (const m of ms) {
        const href  = m[1];
        const label = m[2].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
        if (!label || label.length < 3) continue;
        let abs = href; try { abs = new URL(href, src).toString(); } catch {}
        links.push({ url:abs, label, labelN:norm(label) });
      }
    } catch {}
  }

  const GENERIC = /(イベント|体験|ワークショップ|講座|教室|観察|自然|展示|工作|工房|ミッション)/;

  // --- mode=links（デバッグ用：生リンクを確認） ---
  if (mode === 'links') {
    const filtered = q
      ? links.filter(L => L.labelN.includes(q))
      : links.filter(L => GENERIC.test(L.label));
    const sample = filtered.slice(0, 12).map(L => ({ url:L.url, label:L.label }));
    return send(res, { ok:true, q:qRaw, total_links:links.length, count:sample.length, sample });
  }

  // --- 通常モード：リンク → イベント配列に整形して返す ---
  // 1) q に一致 or 汎用語ヒット
  let picked = q ? links.filter(L => L.labelN.includes(q)) : links.filter(L => GENERIC.test(L.label));

  // 2) ドメイン上限 & 重複除去
  const perDomainCap = 4;
  const domainCount = {};
  const byUrl = new Map();
  const kept = [];
  for (const L of picked) {
    if (byUrl.has(L.url)) continue;
    byUrl.set(L.url, true);
    let host=''; try { host = new URL(L.url).host.replace(/^www\./,''); } catch {}
    domainCount[host] = (domainCount[host] || 0) + 1;
    if (host && domainCount[host] > perDomainCap) continue;
    kept.push(L);
    if (kept.length >= 20) break;
  }

  // 3) イベント形へ
  const events = kept.map(L => ({
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

  if (debug) return send(res, { ok:true, count:events.length, sample:events.slice(0,8) });
  return send(res, events);
}

