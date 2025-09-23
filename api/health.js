// api/health.mjs
export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    hasKey: !!process.env.GEMINI_API_KEY
  }));
}
