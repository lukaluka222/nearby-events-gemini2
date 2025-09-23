app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasKey: !!process.env.GEMINI_API_KEY });
});
