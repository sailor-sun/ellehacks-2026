// my-app/api/analyze.ts
// CommonJS 스타일로 작성 (import 금지)

const handler = async (req: any, res: any) => {
  // ---- CORS 필요하면 사용 ----
  // res.setHeader("Access-Control-Allow-Origin", "*");
  // res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  // res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  let image_url = "";

  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const { del } = require("@vercel/blob");

    const body = req.body || {};
    const messages_text = String(body.messages_text || "");
    const user_context = String(body.user_context || "");
    const link_url = String(body.link_url || "");
    const extra_notes = String(body.extra_notes || "");
    image_url = String(body.image_url || "").trim();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    const prompt = `
You are a digital safety and scam-risk analysis assistant.

Return ONLY a valid JSON object.
Do not include markdown, comments, or explanations.

Schema:
{
  "summary": string,
  "risk_level": "low" | "medium" | "high",
  "confidence": number,
  "red_flags": string[],
  "inconsistencies": string[],
  "next_steps": string[]
}

messages_text:
${messages_text}

user_context:
${user_context}

link_url:
${link_url}

extra_notes:
${extra_notes}
`.trim();

    const genAI = new GoogleGenerativeAI(apiKey);

    // ✅ 모델명 수정
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const parts: any[] = [{ text: prompt }];

    // ---- image_url 있으면 이미지도 같이 보냄 ----
    if (image_url) {
      try {
        const resp = await fetch(image_url);
        if (resp.ok) {
          const contentType = resp.headers.get("content-type") || "";
          const len = resp.headers.get("content-length");
          const size = len ? Number(len) : NaN;

          // 안전장치: 5MB 제한
          if (!Number.isNaN(size) && size > 5 * 1024 * 1024) {
            parts[0].text += `\n\nIMAGE_NOTE: Image too large to fetch (${size} bytes).`;
          } else if (!contentType.startsWith("image/")) {
            parts[0].text += `\n\nIMAGE_NOTE: image_url content-type is not image: ${contentType}`;
          } else {
            const buf = await resp.arrayBuffer();
            const b64 = Buffer.from(buf).toString("base64");
            parts.push({
              inlineData: {
                mimeType: contentType || "image/jpeg",
                data: b64,
              },
            });
          }
        } else {
          parts[0].text += `\n\nIMAGE_NOTE: Failed to fetch image_url. status=${resp.status}`;
        }
      } catch (e: any) {
        parts[0].text += `\n\nIMAGE_NOTE: Exception fetching image_url: ${String(
          e?.message || e
        )}`;
      }
    }

    const result = await model.generateContent(parts);
    const text = result?.response?.text?.() ?? "";

    // ---- JSON 파싱 (실패하면 raw 포함해서 반환) ----
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        try {
          parsed = JSON.parse(text.slice(start, end + 1));
        } catch {
          parsed = null;
        }
      }
    }

    // 기본 정규화
    if (parsed && typeof parsed === "object") {
      const n = Number(parsed.confidence);
      parsed.confidence = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;

      if (!Array.isArray(parsed.red_flags)) parsed.red_flags = [];
      if (!Array.isArray(parsed.inconsistencies)) parsed.inconsistencies = [];
      if (!Array.isArray(parsed.next_steps)) parsed.next_steps = [];

      if (typeof parsed.summary !== "string") parsed.summary = String(parsed.summary || "");
      if (!["low", "medium", "high"].includes(parsed.risk_level)) {
        parsed.risk_level = "medium";
      }
    }

    // Blob cleanup (best effort)
    if (image_url && image_url.includes("blob.vercel-storage.com")) {
      try {
        await del(image_url);
      } catch {}
    }

    if (!parsed) {
      return res.status(200).json({
        ok: true,
        warning: "Model did not return valid JSON",
        raw: text,
      });
    }

    return res.status(200).json(parsed);
  } catch (err: any) {
    return res.status(500).json({
      error: "Analysis failed",
      detail: String(err?.message || err),
    });
  }
};

module.exports = handler;
