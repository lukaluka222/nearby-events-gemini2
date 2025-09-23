function send(res, obj) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

export default function handler(req, res) {
  let url;
  try {
    url = new URL(req.url, `https://${req.headers.host || 'example.com'}`);
  } catch {
    return send(res, { ok: true, note: 'URL parse failed', items: [] });
  }
  const mode = url.searchParams.get('mode') || '';
  const q = (url.searchParams.get('q') || '').toLowerCase();

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

  return send(res, { ok: true, note: 'normal mode (mock only build)', items: [] });
}
