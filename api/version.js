// api/version.js
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    build: "ver-2025-09-24-01:45 JST (version.js alive)"
  });
}

