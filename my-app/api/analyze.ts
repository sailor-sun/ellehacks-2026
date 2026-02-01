const handler = async (req: any, res: any) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        // JSON 강제는 가끔 깨질 수 있어서 테스트 단계에선 빼도 됨
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    const result = await model.generateContent("Say hello in JSON");
    const text = result.response.text();

    // 일단 raw 확인
    return res.status(200).json({ ok: true, raw: text });
  } catch (err: any) {
    return res.status(500).json({
      error: "Analysis failed",
      detail: String(err?.message || err),
    });
  }
};

module.exports = handler;
