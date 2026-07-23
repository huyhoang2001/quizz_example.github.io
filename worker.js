
const ALLOWED_ORIGINS = [
  "https://huyhoang2001.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODELS = ["gemini-3-flash-preview"];
const MIN_WORDS = 500;
const MAX_CHARS = 30000;
const DEFAULT_TIMEOUT_MS = 100000;
const DEFAULT_MAX_OUTPUT_TOKENS = 3600;
const DEFAULT_RETRIES = 2;

const RUBRIC = [
  { name: "Mở bài và xác định vấn đề", maxScore: 1.0 },
  { name: "Giải thích bản chất vấn đề", maxScore: 1.0 },
  { name: "Phân tích và lập luận", maxScore: 2.5 },
  { name: "Dẫn chứng và chứng minh", maxScore: 1.5 },
  { name: "Phản đề và mở rộng", maxScore: 1.0 },
  { name: "Liên hệ bản thân và trách nhiệm", maxScore: 1.5 },
  { name: "Diễn đạt, chính tả và liên kết", maxScore: 1.5 },
];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    essayType: { type: "string" },
    centralIssue: { type: "string" },
    totalScore: { type: "number" },
    wordCount: { type: "integer" },
    level: { type: "string" },
    overallComment: { type: "string" },
    criteria: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          score: { type: "number" },
          maxScore: { type: "number" },
          comment: { type: "string" },
          evidence: { type: "string" },
          nextStep: { type: "string" },
        },
        required: ["name","score","maxScore","comment","evidence","nextStep"],
      },
    },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    paragraphFeedback: {
      type: "array",
      items: {
        type: "object",
        properties: {
          section: { type: "string" },
          status: { type: "string", enum: ["good","warning","bad"] },
          statusLabel: { type: "string" },
          comment: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["section","status","statusLabel","comment","suggestion"],
      },
    },
    evidenceReview: {
      type: "array",
      items: {
        type: "object",
        properties: {
          evidence: { type: "string" },
          relevance: { type: "string" },
          accuracyNote: { type: "string" },
          analysisQuality: { type: "string" },
          improvement: { type: "string" },
        },
        required: ["evidence","relevance","accuracyNote","analysisQuality","improvement"],
      },
    },
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          original: { type: "string" },
          correction: { type: "string" },
          explanation: { type: "string" },
        },
        required: ["type","original","correction","explanation"],
      },
    },
    addedIdeas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idea: { type: "string" },
          why: { type: "string" },
          insertionPoint: { type: "string" },
          sampleSentence: { type: "string" },
        },
        required: ["idea","why","insertionPoint","sampleSentence"],
      },
    },
    improvedOutline: { type: "array", items: { type: "string" } },
    revisedPassage: { type: "string" },
  },
  required: [
    "essayType","centralIssue","totalScore","wordCount","level","overallComment",
    "criteria","strengths","weaknesses","paragraphFeedback","evidenceReview",
    "errors","addedIdeas","improvedOutline","revisedPassage"
  ],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") return preflight(request, origin);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "essay-grader-api",
        provider: "Google Gemini",
        geminiConfigured: Boolean(env.GEMINI_API_KEY),
        models: modelsFromEnv(env),
        timeoutMs: intEnv(env.GEMINI_MODEL_TIMEOUT_MS, 15000, 120000, DEFAULT_TIMEOUT_MS),
        maxOutputTokens: intEnv(env.GEMINI_MAX_OUTPUT_TOKENS, 1200, 8000, DEFAULT_MAX_OUTPUT_TOKENS),
        retriesPerModel: intEnv(env.GEMINI_RETRIES_PER_MODEL, 1, 3, DEFAULT_RETRIES),
        thinkingLevel: thinkingLevel(env),
        minimumWords: MIN_WORDS,
        timestamp: new Date().toISOString(),
      }, 200, origin);
    }

    if (url.pathname !== "/grade") return json({ error: "Không tìm thấy endpoint." }, 404, origin);
    if (request.method !== "POST") return json({ error: "Endpoint /grade chỉ chấp nhận POST." }, 405, origin);
    if (!allowed(origin)) return jsonNoCors({ error: "Origin không được phép.", receivedOrigin: origin || "Không có Origin" }, 403);
    if (!env.GEMINI_API_KEY) return json({ error: "Chưa cấu hình GEMINI_API_KEY." }, 500, origin);

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return json({ error: "Content-Type phải là application/json." }, 415, origin);
    }

    try {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: "JSON gửi lên không hợp lệ." }, 400, origin); }

      const studentAnswer = normalize(body?.studentAnswer);
      const wordCount = countWords(studentAnswer);

      if (!studentAnswer) return json({ error: "Bài làm đang để trống." }, 400, origin);
      if (wordCount < MIN_WORDS) {
        return json({
          error: `Bài làm cần tối thiểu ${MIN_WORDS} chữ; hiện có ${wordCount} chữ.`,
          wordCount,
          minimumWords: MIN_WORDS,
        }, 400, origin);
      }
      if (studentAnswer.length > MAX_CHARS) {
        return json({ error: `Bài làm vượt quá ${MAX_CHARS.toLocaleString("vi-VN")} ký tự.` }, 400, origin);
      }

      const ai = await callWithFallback({
        apiKey: env.GEMINI_API_KEY,
        models: modelsFromEnv(env),
        answer: studentAnswer,
        wordCount,
        timeoutMs: intEnv(env.GEMINI_MODEL_TIMEOUT_MS, 15000, 120000, DEFAULT_TIMEOUT_MS),
        maxOutputTokens: intEnv(env.GEMINI_MAX_OUTPUT_TOKENS, 1200, 8000, DEFAULT_MAX_OUTPUT_TOKENS),
        retries: intEnv(env.GEMINI_RETRIES_PER_MODEL, 1, 3, DEFAULT_RETRIES),
        thinking: thinkingLevel(env),
      });

      const parsed = JSON.parse(ai.text);
      return json({
        ...sanitize(parsed, wordCount),
        provider: "Google Gemini",
        model: ai.model,
      }, 200, origin);
    } catch (error) {
      console.error("Worker error:", error);
      return json(
        { error: error instanceof Error ? error.message : "Không thể chấm bài." },
        httpStatus(error),
        origin,
      );
    }
  },
};

function modelsFromEnv(env) {
  const list = String(env.GEMINI_MODELS || "")
    .split(",")
    .map((x) => x.replace(/^models\//, "").trim())
    .filter(Boolean);
  return list.length ? [...new Set(list)] : DEFAULT_MODELS;
}

function thinkingLevel(env) {
  const v = String(env.GEMINI_THINKING_LEVEL || "LOW").trim().toUpperCase();
  return ["MINIMAL","LOW","MEDIUM","HIGH"].includes(v) ? v : "LOW";
}

async function callWithFallback({ apiKey, models, answer, wordCount, timeoutMs, maxOutputTokens, retries, thinking }) {
  const failures = [];

  for (const model of models) {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        console.log(`Calling Gemini ${model}, attempt ${attempt}/${retries}`);
        const text = await callOne({ apiKey, model, answer, wordCount, timeoutMs, maxOutputTokens, thinking });
        console.log(`Gemini succeeded: ${model}`);
        return { text, model };
      } catch (error) {
        const f = providerError(error);
        failures.push({ model, attempt, ...f });
        console.warn(`Gemini failed: ${model}`, f.status, f.message);

        if ([401,403].includes(f.status)) throw error;
        const retryable = [0,408,429,500,502,503,504].includes(f.status);
        if (retryable && attempt < retries) {
          const wait = 1800 * 2 ** (attempt - 1) + Math.floor(Math.random() * 900);
          await sleep(wait);
          continue;
        }
        break;
      }
    }
  }

  throw createError(
    503,
    "Các model Gemini đều không khả dụng. " +
      failures.map((x) => `${x.model} (HTTP ${x.status || "?"}): ${x.message}`).join(" | "),
  );
}

async function callOne({ apiKey, model, answer, wordCount, timeoutMs, maxOutputTokens, thinking }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${API_BASE}/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt() }],
          },
          contents: [{
            role: "user",
            parts: [{ text: userPrompt(answer, wordCount) }],
          }],
          generationConfig: {
            maxOutputTokens,
            thinkingConfig: { thinkingLevel: thinking },
            responseFormat: {
              text: {
                mimeType: "application/json",
                schema: RESPONSE_SCHEMA,
              },
            },
          },
        }),
      },
    );

    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { rawText: raw }; }

    if (!response.ok) {
      const message = data?.error?.message || data?.message || data?.rawText || `HTTP ${response.status}`;
      if (String(message).toLowerCase().includes("user location is not supported")) {
        throw createError(403, "Gemini từ chối vị trí mạng của Cloudflare Worker: User location is not supported for the API use.");
      }
      throw createError(response.status, String(message));
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("")
      .trim() || "";

    if (!text) {
      const block = data?.promptFeedback?.blockReason;
      throw createError(502, block ? `Gemini từ chối nội dung: ${block}.` : `Model ${model} không trả về nội dung.`);
    }

    const jsonText = extractJson(text);
    JSON.parse(jsonText);
    return jsonText;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createError(408, `Model ${model} xử lý quá ${Math.round(timeoutMs / 1000)} giây.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function systemPrompt() {
  const rubric = RUBRIC.map((x, i) => `${i + 1}. ${x.name}: ${x.maxScore} điểm`).join("\n");

  return `
Bạn là giảng viên chấm bài nghị luận xã hội bằng tiếng Việt, định hướng ôn thi Văn bằng 2 Công an nhân dân.

MỤC TIÊU:
- Chấm khách quan, có căn cứ.
- Chỉ ra lỗi cụ thể, sửa lỗi và giải thích.
- Bổ sung ý còn thiếu.
- Không bịa thông tin, sự kiện, số liệu hoặc câu chữ học sinh chưa viết.
- Không suy diễn phẩm chất, tư tưởng hoặc lòng trung thành.
- Không chấm theo khẩu hiệu.

KHUNG 5 BƯỚC:
1. Mở bài trực diện: dẫn dắt phù hợp, nêu đúng vấn đề, khẳng định ý nghĩa, tránh lan man.
2. Giải thích bản chất: giải thích từ khóa và nội hàm, ngắn gọn, không lặp đề.
3. Phân tích và chứng minh: có luận điểm, lý lẽ, biểu hiện, nguyên nhân, ý nghĩa hoặc hậu quả; dẫn chứng phải gắn luận điểm; không cộng điểm cho liệt kê.
4. Phản đề và mở rộng: xem xét góc ngược, phân biệt đúng-sai, tránh quy chụp và phản đề hình thức.
5. Liên hệ và kết bài: bài học nhận thức, hành động cụ thể; khi phù hợp liên hệ thế hệ trẻ hoặc chiến sĩ Công an tương lai; kết bài khẳng định vấn đề.

YÊU CẦU ĐẶC THÙ:
- Đánh giá logic, trách nhiệm, ý thức pháp luật, thái độ phục vụ nhân dân và liên hệ thực tiễn.
- Không bắt buộc nhắc đến Đảng, Nhà nước hoặc Công an trong mọi đề.
- Liên hệ Công an chỉ được đánh giá cao khi tự nhiên, cụ thể và đúng vấn đề.
- Nhận xét chính trị, pháp luật phải khách quan, đúng mực, không cực đoan.

RUBRIC TỔNG 10 ĐIỂM:
${rubric}

XẾP LOẠI:
- Dưới 5,0: Chưa đạt
- 5,0 đến dưới 6,5: Trung bình
- 6,5 đến dưới 8,0: Khá
- 8,0 đến dưới 9,0: Giỏi
- 9,0 đến 10: Xuất sắc

QUY TẮC:
- Đúng 7 tiêu chí và đúng thứ tự.
- evidence phải là câu/cụm từ thật trong bài; không có thì để chuỗi rỗng.
- nextStep phải cụ thể.
- Chọn tối đa 3 dẫn chứng quan trọng.
- Chọn tối đa 5 lỗi quan trọng; mỗi lỗi có original, correction, explanation.
- Đề xuất 2–3 ý bổ sung.
- Dàn ý 5–6 ý.
- Viết lại 1–2 đoạn yếu nhất, tổng 100–150 chữ.
- Chỉ trả JSON đúng schema; không Markdown; không thêm nội dung ngoài JSON.
`.trim();
}

function userPrompt(answer, wordCount) {
  return `
SỐ CHỮ HỆ THỐNG ĐẾM: ${wordCount}

BÀI LÀM:
--------------------
${answer}
--------------------

Hãy:
1. Xác định dạng bài và vấn đề trung tâm.
2. Chấm đủ 7 tiêu chí.
3. Đánh giá đủ 5 bước.
4. Đánh giá tối đa 3 dẫn chứng.
5. Chỉ ra tối đa 5 lỗi và sửa.
6. Đề xuất 2–3 ý còn thiếu.
7. Tạo dàn ý 5–6 ý.
8. Viết lại 1–2 đoạn yếu nhất, tổng 100–150 chữ.
9. Không bịa thông tin.
`.trim();
}

function sanitize(result, wordCount) {
  const input = Array.isArray(result?.criteria) ? result.criteria : [];

  const criteria = RUBRIC.map((expected, index) => {
    const got = input[index] || {};
    return {
      name: expected.name,
      score: round1(clamp(Number(got.score), 0, expected.maxScore)),
      maxScore: expected.maxScore,
      comment: limit(got.comment || "Chưa có nhận xét.", 1500),
      evidence: limit(got.evidence || "", 500),
      nextStep: limit(got.nextStep || "", 1000),
    };
  });

  const totalScore = round1(criteria.reduce((sum, x) => sum + x.score, 0));

  return {
    essayType: limit(result?.essayType || "", 120),
    centralIssue: limit(result?.centralIssue || "", 700),
    totalScore,
    wordCount,
    level: level(totalScore),
    overallComment: limit(result?.overallComment || "Chưa có nhận xét tổng quát.", 2200),
    criteria,
    strengths: strings(result?.strengths, 6),
    weaknesses: strings(result?.weaknesses, 6),
    paragraphFeedback: Array.isArray(result?.paragraphFeedback)
      ? result.paragraphFeedback.slice(0, 6).map((x) => {
          const status = ["good","warning","bad"].includes(x?.status) ? x.status : "warning";
          return {
            section: limit(x?.section || "Phần bài viết", 120),
            status,
            statusLabel: limit(x?.statusLabel || statusLabel(status), 80),
            comment: limit(x?.comment || "", 1200),
            suggestion: limit(x?.suggestion || "", 1200),
          };
        })
      : [],
    evidenceReview: Array.isArray(result?.evidenceReview)
      ? result.evidenceReview.slice(0, 3).map((x) => ({
          evidence: limit(x?.evidence || "", 600),
          relevance: limit(x?.relevance || "", 600),
          accuracyNote: limit(x?.accuracyNote || "", 600),
          analysisQuality: limit(x?.analysisQuality || "", 700),
          improvement: limit(x?.improvement || "", 700),
        }))
      : [],
    errors: Array.isArray(result?.errors)
      ? result.errors.slice(0, 5).map((x) => ({
          type: limit(x?.type || "Diễn đạt", 100),
          original: limit(x?.original || "", 800),
          correction: limit(x?.correction || "", 1100),
          explanation: limit(x?.explanation || "", 1100),
        }))
      : [],
    addedIdeas: Array.isArray(result?.addedIdeas)
      ? result.addedIdeas.slice(0, 3).map((x) => ({
          idea: limit(x?.idea || "", 800),
          why: limit(x?.why || "", 1000),
          insertionPoint: limit(x?.insertionPoint || "", 500),
          sampleSentence: limit(x?.sampleSentence || "", 1200),
        }))
      : [],
    improvedOutline: strings(result?.improvedOutline, 6),
    revisedPassage: limit(result?.revisedPassage || "", 4000),
  };
}

function preflight(request, origin) {
  if (!allowed(origin)) {
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store", Vary: "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        request.headers.get("Access-Control-Request-Headers") || "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

function allowed(origin) {
  return ALLOWED_ORIGINS.includes(origin);
}

function json(data, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
  if (allowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function jsonNoCors(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    },
  });
}

function extractJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {}

  const start = cleaned.indexOf("{");
  if (start < 0) throw createError(502, "Gemini không trả về JSON.");

  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) {
      const candidate = cleaned.slice(start, i + 1);
      JSON.parse(candidate);
      return candidate;
    }
  }
  throw createError(502, "Gemini trả JSON không hợp lệ.");
}

function createError(status, message) {
  const e = new Error(String(message));
  e.status = Number(status) || 0;
  return e;
}

function providerError(error) {
  return {
    status: Number(error?.status) || (error?.name === "AbortError" ? 408 : 0),
    message: error instanceof Error ? error.message : String(error),
  };
}

function httpStatus(error) {
  const s = Number(error?.status);
  return [400,401,403,404,408,429,500,502,503,504].includes(s) ? s : 500;
}

function intEnv(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : fallback;
}

function normalize(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function countWords(text) {
  return text ? text.split(/\s+/u).filter(Boolean).length : 0;
}

function strings(value, max) {
  return Array.isArray(value)
    ? value.slice(0, max).map((x) => limit(x, 1000)).filter(Boolean)
    : [];
}

function level(score) {
  if (score < 5) return "Chưa đạt";
  if (score < 6.5) return "Trung bình";
  if (score < 8) return "Khá";
  if (score < 9) return "Giỏi";
  return "Xuất sắc";
}

function statusLabel(status) {
  if (status === "good") return "Đạt tốt";
  if (status === "bad") return "Cần sửa";
  return "Chưa đầy đủ";
}

function clamp(value, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function round1(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function limit(value, max) {
  return String(value || "").trim().slice(0, max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
