// api/events.mjs — links モード追加（ESM）
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

export default async function handler(req, res) {
  let url;
  try { url = new URL(req.url, `https://${req.headers.host || 'example.com'}`); }
  catch { return send(res, { ok: true, note: 'URL parse failed', items: [] }); }

  const mode = url.searchParams.get('mode') || '';
  const q = (url.searchParams.get('q') || '').toLowerCase();

  // ① まずは既に動いた “モック” も残す
  if (mode === 'mock') {
    const LINKS = [
      { url: 'https://example.com/koke1', label: '苔の観察ワークショップ（相模原）' },
      { url: 'https://example.com/koke2', label: '川辺でコケ観察ミッション' },
      { url: 'https://example.com/tegei1', label: '手芸（刺し子）はじめて教室' },
      { url: 'https://example.com/ami1',  label: '編み物ミニワークショップ' },
      { url: 'https://example.com/mokko', label: '木工フリーワーク' },
      { url: 'https://example.com/hanaya',label: '花屋のミニブーケづくり体験' }
    ];
    const hit = q ? LINKS.filter(x => x.label.toLowerCase().includes(q)) : LINKS;
    return send(res, { ok: true, from: 'mock', q, count: hit.length, sample: hit.slice(0, 5) });
  }

  // ② 新規：実サイトからリンク抽出
  if (mode === 'links') {
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
          if (!label || label.length < 4) continue;
          let abs = href;
          try { abs = new URL(href, src).toString(); } catch {}
          links.push({ url: abs, label });
        }
      } catch (e) {
        // 取れないサイトがあっても続行
      }
    }
    const filtered = q ? links.filter(L => L.label.toLowerCase().includes(q)) : links;
    // まずは確認しやすいように sample を返す
    return send(res, { ok: true, count: filtered.length, sample: filtered.slice(0, 12) });
  }

  // ③ 通常（まだ空）→ 次のステップで中身を実装
  return send(res, { ok: true, note: 'normal mode (links/mock available)', items: [] });
}
