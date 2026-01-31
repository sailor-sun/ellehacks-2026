import type { VercelRequest, VercelResponse } from "@vercel/node";

function arrayBufferToBase64(buf: ArrayBuffer) {
  return Buffer.from(buf).toString("base64");
}

function safeJsonExtract(text: string) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clampConfidence(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeResponse(obj: any) {
  if (!obj || typeof obj !== "object") return obj;
  if (typeof obj.confidence !== "undefined") obj.confidence = clampConfidence(obj.confidence);
  if (!Array.isArray(obj.red_flags)) obj.red_flags = [];
  if (!Array.isArray(obj.inconsistencies)) obj.inconsistencies = [];
  if (!Array.isArray(obj.next_steps)) obj.next_steps = [];
  if (!Array.isArray(obj.safety_notes)) obj.safety_notes = [];
  return obj;
}

async function fetchImageAsInlineData(imageUrl: string) {
  const resp = await fetch(imageUrl);
  if (!resp.ok) return { error: `Failed to fetch image_url`, status: resp.status };

  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) return { error: `image_url is not an image`, contentType };

  const len = resp.headers.get("content-length");
  if (len && Number(len) > 5 * 1024 * 1024) {
    return { error: "Image too large", contentLength: Number(len) };
  }

  const buf = await resp.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);

  return {
    inlineData: {
      mimeType: contentType || "image/jpeg",
      data: b64,
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let image_url = "";

  try {
    // ✅ dynamic import (import 단계 크래시 방지)
    const [{ GoogleGenerativeAI }, { del }] = await Promise.all([
      import("@google/generative-ai"),
      import("@vercel/blob"),
    ]);

    const body = (req.body || {}) as {
      messages_text?: string;
      user_context?: string;
      link_url?: string;
      extra_notes?: string;
      image_url?: string;
    };

    const messages_text = body.messages_text || "";
    const user_context = body.user_context || "";
    const link_url = body.link_url || "";
    const extra_notes = body.extra_notes || "";
    image_url = (body.image_url || "").trim();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    const prompt = `
You are a digital safety risk analysis assistant in Canada-focused scenarios.
...
Additional notes:
${extra_notes}
`.trim();

    const parts: any[] = [{ text: prompt }];

    if (image_url) {
      const inlineOrError = await fetchImageAsInlineData(image_url);
      if ("error" in inlineOrError) {
        parts[0].text += `\n\nIMAGE_FETCH_NOTE: ${inlineOrError.error}`;
      } else {
        parts.push(inlineOrError);
      }
    }

    const result = await model.generateContent(parts);
    const text = result.response.text();

    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = safeJsonExtract(text);
    }

    if (!parsed) {
      return res.status(500).json({ error: "Invalid AI response (not JSON)", raw: text });
    }

    parsed = normalizeResponse(parsed);

    // ✅ delete best-effort (blob url일 때만)
    if (image_url.includes("blob.vercel-storage.com")) {
      try {
        await del(image_url);
      } catch {}
    }

    return res.status(200).json(parsed);
  } catch (err: any) {
    return res.status(500).json({
      error: "Analysis failed",
      detail: String(err?.message || err),
    });
  }
}
