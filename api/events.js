// api/events.js — 最小テスト版（常にOKを返す）
module.exports = (req, res) => {
  try {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, msg: 'events handler is alive' }));
  } catch (e) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
};
