const ALLOWED_ORIGINS = [
  "https://huyhoang2001.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODELS = ["google/gemma-4-31b-it:free"];
const APP_REFERER = "https://huyhoang2001.github.io/quizz_example.github.io/";
const APP_TITLE = "AI Chấm Bài Tự Luận VB2 Công An";

const MIN_WORDS = 500;
const MAX_CHARS = 30000;
const DEFAULT_MODEL_TIMEOUT_MS = 60000;
const DEFAULT_MAX_OUTPUT_TOKENS = 3600;

const RUBRIC = [
  { name: "Mở bài và xác định vấn đề", maxScore: 1.0 },
  { name: "Giải thích bản chất vấn đề", maxScore: 1.0 },
  { name: "Phân tích và lập luận", maxScore: 2.5 },
  { name: "Dẫn chứng và chứng minh", maxScore: 1.5 },
  { name: "Phản đề và mở rộng", maxScore: 1.0 },
  { name: "Liên hệ bản thân và trách nhiệm", maxScore: 1.5 },
  { name: "Diễn đạt, chính tả và liên kết", maxScore: 1.5 },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return handlePreflight(request, origin);
    }

    if (url.pathname === "/health") {
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, error: "Method not allowed" }, 405, origin);
      }

      return jsonResponse(
        {
          ok: true,
          service: "essay-grader-api",
          provider: "OpenRouter",
          openrouterConfigured: Boolean(env.OPENROUTER_API_KEY),
          models: getOpenRouterModels(env),
          modelTimeoutMs: getModelTimeoutMs(env),
          maxOutputTokens: getMaxOutputTokens(env),
          minimumWords: MIN_WORDS,
          timestamp: new Date().toISOString(),
        },
        200,
        origin,
      );
    }

    if (url.pathname !== "/grade") {
      return jsonResponse({ error: "Không tìm thấy endpoint." }, 404, origin);
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Endpoint /grade chỉ chấp nhận phương thức POST." },
        405,
        origin,
      );
    }

    if (!isOriginAllowed(origin)) {
      return jsonResponseWithoutCors(
        {
          error: "Origin không được phép truy cập API.",
          receivedOrigin: origin || "Không có Origin",
        },
        403,
      );
    }

    if (!env.OPENROUTER_API_KEY) {
      return jsonResponse(
        { error: "Cloudflare Worker chưa được cấu hình OPENROUTER_API_KEY." },
        500,
        origin,
      );
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse(
        { error: "Content-Type phải là application/json." },
        415,
        origin,
      );
    }

    try {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse(
          { error: "Dữ liệu gửi lên không phải JSON hợp lệ." },
          400,
          origin,
        );
      }

      const studentAnswer = normalizeText(body?.studentAnswer);
      const wordCount = countWords(studentAnswer);

      if (!studentAnswer) {
        return jsonResponse({ error: "Bài làm đang để trống." }, 400, origin);
      }

      if (wordCount < MIN_WORDS) {
        return jsonResponse(
          {
            error: `Bài làm cần tối thiểu ${MIN_WORDS} chữ; hiện có ${wordCount} chữ.`,
            wordCount,
            minimumWords: MIN_WORDS,
          },
          400,
          origin,
        );
      }

      if (studentAnswer.length > MAX_CHARS) {
        return jsonResponse(
          {
            error: `Bài làm vượt quá ${MAX_CHARS.toLocaleString("vi-VN")} ký tự.`,
          },
          400,
          origin,
        );
      }

      const models = getOpenRouterModels(env);
      const modelTimeoutMs = getModelTimeoutMs(env);
      const maxOutputTokens = getMaxOutputTokens(env);

      const aiResponse = await callOpenRouterWithFallback({
        apiKey: env.OPENROUTER_API_KEY,
        models,
        studentAnswer,
        wordCount,
        modelTimeoutMs,
        maxOutputTokens,
      });

      let parsedResult;
      try {
        parsedResult = JSON.parse(aiResponse.text);
      } catch {
        return jsonResponse(
          { error: "AI trả về dữ liệu không đúng định dạng JSON. Vui lòng thử lại." },
          502,
          origin,
        );
      }

      const sanitizedResult = sanitizeResult(parsedResult, wordCount);

      return jsonResponse(
        {
          ...sanitizedResult,
          provider: "OpenRouter",
          model: aiResponse.model,
          requestedModel: aiResponse.requestedModel,
        },
        200,
        origin,
      );
    } catch (error) {
      console.error("Worker error:", error);
      return jsonResponse(
        {
          error:
            error instanceof Error
              ? error.message
              : "Không thể xử lý yêu cầu chấm bài.",
        },
        500,
        origin,
      );
    }
  },
};

function getOpenRouterModels(env) {
  const configured = String(env.OPENROUTER_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return configured.length > 0 ? [...new Set(configured)] : DEFAULT_MODELS;
}

function getModelTimeoutMs(env) {
  return clampInteger(
    Number(env.OPENROUTER_MODEL_TIMEOUT_MS),
    15000,
    120000,
    DEFAULT_MODEL_TIMEOUT_MS,
  );
}

function getMaxOutputTokens(env) {
  return clampInteger(
    Number(env.OPENROUTER_MAX_OUTPUT_TOKENS),
    1200,
    6000,
    DEFAULT_MAX_OUTPUT_TOKENS,
  );
}

async function callOpenRouterWithFallback({
  apiKey,
  models,
  studentAnswer,
  wordCount,
  modelTimeoutMs,
  maxOutputTokens,
}) {
  const failures = [];

  for (let index = 0; index < models.length; index += 1) {
    const requestedModel = models[index];

    try {
      console.log(
        `Calling OpenRouter model ${requestedModel} (${index + 1}/${models.length})`,
      );

      const response = await callSingleOpenRouterModel({
        apiKey,
        model: requestedModel,
        studentAnswer,
        wordCount,
        modelTimeoutMs,
        maxOutputTokens,
      });

      console.log(`OpenRouter model succeeded: ${response.model}`);

      return {
        text: response.text,
        model: response.model,
        requestedModel,
      };
    } catch (error) {
      const failure = normalizeProviderError(error);
      failures.push({
        model: requestedModel,
        status: failure.status,
        message: failure.message,
      });

      console.warn(
        `OpenRouter model failed: ${requestedModel}`,
        failure.status,
        failure.message,
      );

      if (failure.status === 401) {
        throw new Error("OPENROUTER_API_KEY không hợp lệ hoặc đã hết hiệu lực.");
      }

      if (index < models.length - 1) {
        console.warn(`Switching to next OpenRouter model: ${requestedModel}`);
      }
    }
  }

  console.error("All OpenRouter models failed:", failures);

  const summary = failures
    .map(
      (item) =>
        `${item.model} (HTTP ${item.status || "?"}): ${item.message}`,
    )
    .join(" | ");

  throw new Error(
    "Các model AI hiện đều đang bận hoặc không khả dụng. " + summary,
  );
}

async function callSingleOpenRouterModel({
  apiKey,
  model,
  studentAnswer,
  wordCount,
  modelTimeoutMs,
  maxOutputTokens,
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), modelTimeoutMs);

  try {
    const payload = {
      model,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: buildUserPrompt(studentAnswer, wordCount),
        },
      ],
      temperature: 0.1,
      top_p: 0.8,
      max_tokens: maxOutputTokens,
      stream: false,
      response_format: { type: "json_object" },
    };

    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": APP_REFERER,
        "X-OpenRouter-Title": APP_TITLE,
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      data = { rawText };
    }

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.error?.metadata?.raw ||
        data?.message ||
        data?.detail ||
        data?.rawText ||
        `HTTP ${response.status}`;

      throw createProviderError(response.status, String(message));
    }

    const choice = data?.choices?.[0];
    const message = choice?.message || {};
    const content =
      message.content || message.reasoning_content || message.reasoning || "";

    const generatedText = extractMessageText(content);

    if (!generatedText) {
      throw createProviderError(502, `Model ${model} không trả về nội dung.`);
    }

    const jsonText = extractJsonObject(generatedText);

    try {
      JSON.parse(jsonText);
    } catch {
      throw createProviderError(502, `Model ${model} trả JSON không hợp lệ.`);
    }

    return {
      text: jsonText,
      model: String(data?.model || model),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createProviderError(
        408,
        `Model ${model} xử lý quá ${Math.round(modelTimeoutMs / 1000)} giây.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractMessageText(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.content || "";
      })
      .join("")
      .trim();
  }

  if (content && typeof content === "object") {
    return String(content.text || content.content || "").trim();
  }

  return "";
}

function buildSystemPrompt() {
  const rubricText = RUBRIC.map(
    (item, index) => `${index + 1}. ${item.name}: ${item.maxScore} điểm`,
  ).join("\n");

  return `
Bạn là giảng viên chấm bài nghị luận xã hội bằng tiếng Việt, định hướng ôn thi Văn bằng 2 Công an nhân dân.

MỤC TIÊU:
- Chấm bài khách quan, có căn cứ.
- Chỉ ra lỗi cụ thể, sửa lỗi và giải thích.
- Bổ sung ý còn thiếu để học sinh tự hoàn thiện.
- Không bịa thông tin, sự kiện, số liệu hoặc câu chữ mà học sinh chưa viết.
- Không suy diễn phẩm chất, tư tưởng hoặc lòng trung thành của học sinh.
- Không chấm theo khẩu hiệu; phải dựa vào chất lượng lập luận thực tế.

KHUNG LẬP LUẬN 5 BƯỚC BẮT BUỘC PHẢI ĐÁNH GIÁ:

1. MỞ BÀI TRỰC DIỆN
- Dẫn dắt từ bối cảnh thời đại hoặc thực tiễn phù hợp.
- Nêu đúng và rõ vấn đề nghị luận.
- Khẳng định tầm quan trọng của vấn đề đối với xã hội, đất nước hoặc lực lượng.
- Tránh dài dòng, sáo rỗng hoặc xa chủ đề.

2. GIẢI THÍCH BẢN CHẤT
- Giải thích từ khóa trung tâm.
- Làm rõ nghĩa trực tiếp, nghĩa hàm ẩn hoặc bản chất của câu nói/hiện tượng.
- Giải thích ngắn gọn, súc tích, tránh lan man.
- Không chỉ lặp lại đề bài bằng từ ngữ khác.

3. PHÂN TÍCH VÀ CHỨNG MINH
- Phân tích biểu hiện, nguyên nhân, vai trò, ý nghĩa, tác động hoặc hậu quả.
- Có hệ thống luận điểm rõ ràng.
- Mỗi luận điểm phải có lý lẽ.
- Dẫn chứng phải phù hợp và gắn trực tiếp với luận điểm.
- Không cộng điểm cho việc chỉ liệt kê dẫn chứng mà không phân tích.

4. PHẢN ĐỀ VÀ MỞ RỘNG
- Nhìn nhận vấn đề từ góc độ ngược lại.
- Chỉ ra biểu hiện lệch lạc, thờ ơ, cực đoan, phiến diện hoặc lợi dụng vấn đề khi phù hợp.
- Phân biệt bản chất đúng với biểu hiện sai.
- Thể hiện tư duy biện chứng, không quy chụp.

5. LIÊN HỆ VÀ KẾT BÀI
- Rút ra bài học nhận thức.
- Nêu hành động cụ thể của bản thân.
- Có thể liên hệ trách nhiệm thế hệ trẻ và người chiến sĩ Công an tương lai khi phù hợp.
- Kết bài khẳng định lại giá trị vấn đề và thể hiện quyết tâm.

PHÂN LOẠI DẠNG ĐỀ:
- Tư tưởng, đạo lý.
- Hiện tượng đời sống.
- Xác định dựa trên bài viết, không tự đặt đề mới.

YÊU CẦU ĐẶC THÙ VB2 CÔNG AN:
- Đánh giá tính logic, tinh thần trách nhiệm, ý thức pháp luật, thái độ phục vụ nhân dân và khả năng liên hệ thực tiễn.
- Không tự kết luận học sinh có hay không có lòng trung thành.
- Không bắt buộc học sinh phải nhắc đến Đảng, Nhà nước hoặc lực lượng Công an trong mọi đề.
- Khi có liên hệ ngành Công an, đánh giá xem liên hệ có tự nhiên, cụ thể và gắn với vấn đề hay chỉ mang tính khẩu hiệu.

RUBRIC CỐ ĐỊNH, TỔNG 10 ĐIỂM:
${rubricText}

CÁCH XẾP LOẠI:
- Dưới 5,0: Chưa đạt
- 5,0 đến dưới 6,5: Trung bình
- 6,5 đến dưới 8,0: Khá
- 8,0 đến dưới 9,0: Giỏi
- 9,0 đến 10: Xuất sắc

QUY TẮC CHẤM:
- Có đúng 7 tiêu chí và đúng thứ tự rubric.
- Điểm không vượt điểm tối đa.
- evidence phải là câu hoặc cụm từ thực sự có trong bài.
- Nếu không có bằng chứng, để evidence là chuỗi rỗng.
- nextStep hướng dẫn cụ thể cách nâng điểm.
- Tổng điểm cuối cùng do hệ thống tính lại từ 7 tiêu chí.

YÊU CẦU ĐÁNH GIÁ DẪN CHỨNG:
- Xác định dẫn chứng quan trọng.
- Đánh giá mức độ phù hợp và cách phân tích.
- Nếu dẫn chứng mơ hồ, ghi "cần kiểm chứng".
- Không hạ thấp dẫn chứng phổ thông chỉ vì quen thuộc.

YÊU CẦU paragraphFeedback:
1. Mở bài
2. Giải thích
3. Phân tích và chứng minh
4. Phản đề và mở rộng
5. Liên hệ và kết bài
6. Bố cục và liên kết toàn bài

status chỉ nhận: good, warning, bad.

YÊU CẦU PHÁT HIỆN VÀ SỬA LỖI:
- Tối đa 6 lỗi quan trọng nhất.
- original chép đúng câu hoặc cụm từ trong bài.
- correction là câu sửa hoàn chỉnh.
- explanation giải thích cụ thể.
- Có thể phát hiện chính tả, dùng từ, ngữ pháp, câu dài, câu tối nghĩa, lặp ý, liên kết, lập luận, dẫn chứng, khẩu hiệu hóa và liên hệ chung chung.

YÊU CẦU BỔ SUNG Ý:
- Từ 2 đến 4 ý sát chủ đề.
- Không bịa số liệu hoặc sự kiện.
- Nêu vị trí nên chèn và câu mẫu.

YÊU CẦU DÀN Ý:
- Từ 5 đến 8 ý.
- Bám sát bài hiện tại.

YÊU CẦU revisedPassage:
- Viết lại 1 đến 3 đoạn yếu nhất.
- Dài khoảng 120 đến 200 chữ.
- Không viết lại toàn bộ bài.

CHỈ TRẢ VỀ MỘT ĐỐI TƯỢNG JSON HỢP LỆ.
KHÔNG DÙNG MARKDOWN.
KHÔNG VIẾT NỘI DUNG TRƯỚC HOẶC SAU JSON.

CẤU TRÚC JSON:
{
  "essayType": "",
  "centralIssue": "",
  "totalScore": 0,
  "wordCount": 0,
  "level": "",
  "overallComment": "",
  "criteria": [
    {
      "name": "",
      "score": 0,
      "maxScore": 0,
      "comment": "",
      "evidence": "",
      "nextStep": ""
    }
  ],
  "strengths": [""],
  "weaknesses": [""],
  "paragraphFeedback": [
    {
      "section": "",
      "status": "good",
      "statusLabel": "",
      "comment": "",
      "suggestion": ""
    }
  ],
  "evidenceReview": [
    {
      "evidence": "",
      "relevance": "",
      "accuracyNote": "",
      "analysisQuality": "",
      "improvement": ""
    }
  ],
  "errors": [
    {
      "type": "",
      "original": "",
      "correction": "",
      "explanation": ""
    }
  ],
  "addedIdeas": [
    {
      "idea": "",
      "why": "",
      "insertionPoint": "",
      "sampleSentence": ""
    }
  ],
  "improvedOutline": [""],
  "revisedPassage": ""
}
`.trim();
}

function buildUserPrompt(studentAnswer, wordCount) {
  return `
Hãy chấm, phát hiện lỗi và hướng dẫn sửa bài nghị luận xã hội dưới đây.

SỐ CHỮ DO HỆ THỐNG ĐẾM:
${wordCount} chữ

BÀI LÀM:
--------------------
${studentAnswer}
--------------------

NHIỆM VỤ BẮT BUỘC:
1. Xác định dạng bài và vấn đề trung tâm.
2. Chấm đủ 7 tiêu chí.
3. Mỗi tiêu chí có điểm, nhận xét, bằng chứng và hướng nâng điểm.
4. Đánh giá đủ khung 5 bước.
5. Đánh giá riêng dẫn chứng quan trọng.
6. Chỉ ra tối đa 6 lỗi, sửa lỗi và giải thích.
7. Đề xuất 2 đến 4 ý còn thiếu, vị trí chèn và câu mẫu.
8. Tạo dàn ý nâng điểm.
9. Viết lại 1 đến 3 đoạn yếu nhất.
10. Không bịa chi tiết mà học sinh chưa viết.
`.trim();
}

function sanitizeResult(result, wordCount) {
  const receivedCriteria = Array.isArray(result?.criteria)
    ? result.criteria
    : [];

  const criteria = RUBRIC.map((expected, index) => {
    const received = receivedCriteria[index] || {};

    return {
      name: expected.name,
      score: roundToTenth(
        clamp(Number(received.score), 0, expected.maxScore),
      ),
      maxScore: expected.maxScore,
      comment: limitString(received.comment || "Chưa có nhận xét.", 1800),
      evidence: limitString(received.evidence || "", 600),
      nextStep: limitString(received.nextStep || "", 1200),
    };
  });

  const totalScore = roundToTenth(
    criteria.reduce((sum, item) => sum + item.score, 0),
  );

  return {
    essayType: limitString(result?.essayType || "", 120),
    centralIssue: limitString(result?.centralIssue || "", 800),
    totalScore,
    wordCount,
    level: levelFromScore(totalScore),
    overallComment: limitString(
      result?.overallComment || "AI chưa cung cấp nhận xét tổng quát.",
      2500,
    ),
    criteria,
    strengths: sanitizeStringArray(result?.strengths, 8),
    weaknesses: sanitizeStringArray(result?.weaknesses, 8),
    paragraphFeedback: sanitizeParagraphFeedback(result?.paragraphFeedback),
    evidenceReview: sanitizeEvidenceReview(result?.evidenceReview),
    errors: sanitizeErrors(result?.errors),
    addedIdeas: sanitizeAddedIdeas(result?.addedIdeas),
    improvedOutline: sanitizeStringArray(result?.improvedOutline, 8),
    revisedPassage: limitString(result?.revisedPassage || "", 5000),
  };
}

function sanitizeParagraphFeedback(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 6).map((item) => {
    const allowed = ["good", "warning", "bad"];
    const status = allowed.includes(item?.status) ? item.status : "warning";

    return {
      section: limitString(item?.section || "Phần bài viết", 150),
      status,
      statusLabel: limitString(
        item?.statusLabel || statusLabelFromStatus(status),
        100,
      ),
      comment: limitString(item?.comment || "", 1500),
      suggestion: limitString(item?.suggestion || "", 1500),
    };
  });
}

function sanitizeEvidenceReview(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 6).map((item) => ({
    evidence: limitString(item?.evidence || "", 700),
    relevance: limitString(item?.relevance || "", 700),
    accuracyNote: limitString(item?.accuracyNote || "", 700),
    analysisQuality: limitString(item?.analysisQuality || "", 900),
    improvement: limitString(item?.improvement || "", 900),
  }));
}

function sanitizeErrors(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 6).map((item) => ({
    type: limitString(item?.type || "Diễn đạt", 120),
    original: limitString(item?.original || "", 1000),
    correction: limitString(item?.correction || "", 1500),
    explanation: limitString(item?.explanation || "", 1500),
  }));
}

function sanitizeAddedIdeas(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 4).map((item) => ({
    idea: limitString(item?.idea || "", 1000),
    why: limitString(item?.why || "", 1500),
    insertionPoint: limitString(item?.insertionPoint || "", 700),
    sampleSentence: limitString(item?.sampleSentence || "", 1800),
  }));
}

function handlePreflight(request, origin) {
  if (!isOriginAllowed(origin)) {
    return new Response(null, {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        Vary: "Origin",
      },
    });
  }

  const requestedHeaders =
    request.headers.get("Access-Control-Request-Headers") || "Content-Type";

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": requestedHeaders,
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

function isOriginAllowed(origin) {
  return ALLOWED_ORIGINS.includes(origin);
}

function jsonResponse(data, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };

  if (isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }

  return new Response(JSON.stringify(data), { status, headers });
}

function jsonResponseWithoutCors(data, status) {
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

function extractJsonObject(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Tiếp tục tìm JSON.
  }

  const start = cleaned.indexOf("{");
  if (start === -1) {
    throw createProviderError(502, "AI không trả về đối tượng JSON.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < cleaned.length; index += 1) {
    const character = cleaned[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;

    if (depth === 0) {
      const candidate = cleaned.slice(start, index + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        break;
      }
    }
  }

  throw createProviderError(502, "AI trả kết quả JSON không hợp lệ.");
}

function createProviderError(status, message) {
  const error = new Error(String(message));
  error.status = Number(status) || 0;
  return error;
}

function normalizeProviderError(error) {
  return {
    status:
      Number(error?.status) || (error?.name === "AbortError" ? 408 : 0),
    message: error instanceof Error ? error.message : String(error),
  };
}

function normalizeText(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function countWords(text) {
  if (!text) return 0;
  return text.split(/\s+/u).filter(Boolean).length;
}

function sanitizeStringArray(value, maxItems) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => limitString(item, 1200))
    .filter(Boolean);
}

function levelFromScore(score) {
  if (score < 5) return "Chưa đạt";
  if (score < 6.5) return "Trung bình";
  if (score < 8) return "Khá";
  if (score < 9) return "Giỏi";
  return "Xuất sắc";
}

function statusLabelFromStatus(status) {
  if (status === "good") return "Đạt tốt";
  if (status === "bad") return "Cần sửa";
  return "Chưa đầy đủ";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.round(Math.min(max, Math.max(min, value)));
}

function roundToTenth(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function limitString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}
