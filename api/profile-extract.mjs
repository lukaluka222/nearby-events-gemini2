// api/profile-extract.mjs
import { GoogleGenerativeAI } from "@google/generative-ai";

// （Edgeが既定のプロジェクトなら安定のため明示）
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }

    const bodyText = await readBody(req);
    const { transcript, childId, displayName, age } = JSON.parse(bodyText || "{}");

    if (!process.env.GEMINI_API_KEY) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "GEMINI_API_KEY is not set" }));
      return;
    }
    if (!transcript || !childId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "transcript and childId are required" }));
      return;
    }
    
// api/profile-extract.mjs
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash"; // ← ここ
const model = genAI.getGenerativeModel({
  model: MODEL,
  generationConfig: { responseMimeType: "application/json" }
});


    const prompt = [
      "あなたは保護者インタビューから児童のプロフィールを作るアシスタントです。",
      "出力はJSONのみ。未知はnull/空で。推測しない。",
      "",
      `childId: ${childId}`,
      displayName ? `displayName: ${displayName}` : "",
      (age || age === 0) ? `age: ${age}` : "",
      "",
      "----- transcript start -----",
      transcript,
      "----- transcript end -----"
    ].filter(Boolean).join("\n");

// api/profile-extract.mjs の try 内で generateContent の直前/後に
try {
  const result = await model.generateContent(prompt);
  // ...（今の処理そのまま）
} catch (e) {
  const msg = String(e?.message || e);
  if (msg.includes("429") || msg.toLowerCase().includes("too many requests") || msg.includes("Quota")) {
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      error: "Geminiのクォータ制限に達しました。モデル/キー/入力サイズを見直してください。",
      hint: "GEMINI_MODEL=gemini-1.5-flash を試すか、課金を有効化してください。"
    }));
    return;
  }
  throw e; // それ以外は既存の500処理へ
}

    
    const result = await model.generateContent(prompt);
    let jsonText = result?.response?.text?.() || "";
    jsonText = jsonText.replace(/```json|```/g, ""); // フェンス除去
    const profile = JSON.parse(jsonText);
    profile.lastUpdated = new Date().toISOString();

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(profile));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    try {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

