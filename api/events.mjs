// api/events.mjs  — 最小テスト（ESM）
export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, msg: 'events handler is alive (esm)' }));
}

