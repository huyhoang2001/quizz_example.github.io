/**
 * worker.js
 * Cloudflare Worker chấm bài tự luận bằng OpenRouter.
 *
 * Model chính mặc định:
 *   google/gemma-4-31b-it:free
 *
 * Có fallback tự động giữa nhiều model khi:
 *   - timeout;
 *   - 429 / rate limit;
 *   - 5xx / provider quá tải;
 *   - model không tồn tại hoặc đã ngừng;
 *   - model không trả nội dung;
 *   - đầu ra JSON không hợp lệ.
 *
 * Endpoint:
 *   GET  /health
 *   POST /grade
 *
 * Request body:
 *   { "studentAnswer": "Nội dung bài làm..." }
 *
 * Secret:
 *   OPENROUTER_API_KEY
 */

const ALLOWED_ORIGINS = [
  "https://huyhoang2001.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_MODELS = [
  "google/gemma-4-31b-it:free",
  "openrouter/free",
];

const APP_REFERER =
  "https://huyhoang2001.github.io/quizz_example.github.io/";

const APP_TITLE = "AI Essay Grader VB2 CAND";

const MIN_WORDS = 500;
const MAX_CHARS = 30000;
const DEFAULT_TIMEOUT_MS = 100000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2800;
const DEFAULT_RETRIES_PER_MODEL = 1;

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
        return jsonResponse(
          { ok: false, error: "Method not allowed" },
          405,
          origin,
        );
      }

      return jsonResponse(
        {
          ok: true,
          service: "essay-grader-api",
          provider: "OpenRouter",
          openrouterConfigured: Boolean(env.OPENROUTER_API_KEY),
          models: getModels(env),
          modelTimeoutMs: getTimeoutMs(env),
          maxOutputTokens: getMaxOutputTokens(env),
          retriesPerModel: getRetriesPerModel(env),
          minimumWords: MIN_WORDS,
          timestamp: new Date().toISOString(),
        },
        200,
        origin,
      );
    }

    if (url.pathname !== "/grade") {
      return jsonResponse(
        { error: "Không tìm thấy endpoint." },
        404,
        origin,
      );
    }

    if (request.method !== "POST") {
      return jsonResponse(
        {
          error:
            "Endpoint /grade chỉ chấp nhận phương thức POST.",
        },
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
        {
          error:
            "Worker chưa được cấu hình OPENROUTER_API_KEY.",
        },
        500,
        origin,
      );
    }

    const contentType =
      request.headers.get("Content-Type") || "";

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
        return jsonResponse(
          { error: "Bài làm đang để trống." },
          400,
          origin,
        );
      }

      if (wordCount < MIN_WORDS) {
        return jsonResponse(
          {
            error:
              `Bài làm cần tối thiểu ${MIN_WORDS} chữ; ` +
              `hiện có ${wordCount} chữ.`,
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
            error:
              `Bài làm vượt quá ${MAX_CHARS.toLocaleString(
                "vi-VN",
              )} ký tự.`,
          },
          400,
          origin,
        );
      }

      const aiResult = await callWithFallback({
        apiKey: env.OPENROUTER_API_KEY,
        models: getModels(env),
        studentAnswer,
        wordCount,
        timeoutMs: getTimeoutMs(env),
        maxOutputTokens: getMaxOutputTokens(env),
        retriesPerModel: getRetriesPerModel(env),
      });

      let parsed;

      try {
        parsed = JSON.parse(aiResult.text);
      } catch {
        console.error("Final JSON parse failed:", aiResult.text);

        return jsonResponse(
          {
            error:
              "AI trả về dữ liệu không đúng định dạng JSON.",
          },
          502,
          origin,
        );
      }

      const result = sanitizeResult(parsed, wordCount);

      return jsonResponse(
        {
          ...result,
          provider: "OpenRouter",
          requestedModel: aiResult.requestedModel,
          model: aiResult.actualModel,
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

function getModels(env) {
  const configured = String(env.OPENROUTER_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return configured.length
    ? [...new Set(configured)]
    : DEFAULT_MODELS;
}

function getTimeoutMs(env) {
  return clampInteger(
    Number(env.OPENROUTER_MODEL_TIMEOUT_MS),
    15000,
    120000,
    DEFAULT_TIMEOUT_MS,
  );
}

function getMaxOutputTokens(env) {
  return clampInteger(
    Number(env.OPENROUTER_MAX_OUTPUT_TOKENS),
    1200,
    5000,
    DEFAULT_MAX_OUTPUT_TOKENS,
  );
}

function getRetriesPerModel(env) {
  return clampInteger(
    Number(env.OPENROUTER_RETRIES_PER_MODEL),
    1,
    2,
    DEFAULT_RETRIES_PER_MODEL,
  );
}

async function callWithFallback({
  apiKey,
  models,
  studentAnswer,
  wordCount,
  timeoutMs,
  maxOutputTokens,
  retriesPerModel,
}) {
  const failures = [];

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];

    for (
      let attempt = 1;
      attempt <= retriesPerModel;
      attempt += 1
    ) {
      try {
        console.log(
          `Calling OpenRouter model ${model} ` +
            `(${modelIndex + 1}/${models.length}), ` +
            `attempt ${attempt}/${retriesPerModel}`,
        );

        const response = await callOneModel({
          apiKey,
          model,
          studentAnswer,
          wordCount,
          timeoutMs,
          maxOutputTokens,
        });

        console.log(
          `OpenRouter model succeeded: ${response.actualModel}`,
        );

        return {
          ...response,
          requestedModel: model,
        };
      } catch (error) {
        const failure = normalizeProviderError(error);

        failures.push({
          model,
          attempt,
          status: failure.status,
          message: failure.message,
        });

        console.warn(
          `OpenRouter model failed: ${model}`,
          failure.status,
          failure.message,
        );

        if (failure.status === 401) {
          throw new Error(
            "OPENROUTER_API_KEY không hợp lệ hoặc đã hết hiệu lực.",
          );
        }

        const retryable = [
          0,
          408,
          429,
          500,
          502,
          503,
          504,
        ].includes(failure.status);

        if (retryable && attempt < retriesPerModel) {
          const waitMs =
            2500 * attempt +
            Math.floor(Math.random() * 1200);

          console.warn(`Retrying ${model} after ${waitMs} ms`);
          await sleep(waitMs);
          continue;
        }

        break;
      }
    }

    if (modelIndex < models.length - 1) {
      console.warn(`Switching to next OpenRouter model: ${model}`);
    }
  }

  console.error("All OpenRouter models failed:", failures);

  const summary = failures
    .map(
      (item) =>
        `${item.model} (HTTP ${item.status || "?"}): ` +
        item.message,
    )
    .join(" | ");

  throw new Error(
    "Các model AI hiện đều đang bận hoặc không khả dụng. " +
      summary,
  );
}

async function callOneModel({
  apiKey,
  model,
  studentAnswer,
  wordCount,
  timeoutMs,
  maxOutputTokens,
}) {
  /*
   * Lần đầu thử JSON mode.
   * Nếu model/provider trả 400 vì không hỗ trợ response_format,
   * gọi lại một lần không có JSON mode.
   */
  let response = await sendOpenRouterRequest({
    apiKey,
    model,
    studentAnswer,
    wordCount,
    timeoutMs,
    maxOutputTokens,
    useJsonMode: true,
  });

  if (
    response.status === 400 &&
    isUnsupportedJsonModeError(response.data)
  ) {
    console.warn(
      `${model} không hỗ trợ JSON mode; gọi lại bằng prompt JSON.`,
    );

    response = await sendOpenRouterRequest({
      apiKey,
      model,
      studentAnswer,
      wordCount,
      timeoutMs,
      maxOutputTokens,
      useJsonMode: false,
    });
  }

  if (!response.ok) {
    const message =
      response.data?.error?.message ||
      response.data?.error?.metadata?.raw ||
      response.data?.message ||
      response.data?.detail ||
      response.data?.rawText ||
      `HTTP ${response.status}`;

    throw createProviderError(
      response.status,
      String(message),
    );
  }

  const choice = response.data?.choices?.[0];
  const message = choice?.message || {};

  const content =
    message.content ||
    message.reasoning_content ||
    message.reasoning ||
    "";

  const generatedText = extractMessageText(content);

  if (!generatedText) {
    console.error(
      "OpenRouter empty response:",
      JSON.stringify(response.data),
    );

    throw createProviderError(
      502,
      `Model ${model} không trả về nội dung.`,
    );
  }

  const jsonText = extractJsonObject(generatedText);

  try {
    JSON.parse(jsonText);
  } catch {
    throw createProviderError(
      502,
      `Model ${model} trả JSON không hợp lệ.`,
    );
  }

  return {
    text: jsonText,
    actualModel: String(response.data?.model || model),
  };
}

async function sendOpenRouterRequest({
  apiKey,
  model,
  studentAnswer,
  wordCount,
  timeoutMs,
  maxOutputTokens,
  useJsonMode,
}) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  const payload = {
    model,

    messages: [
      {
        role: "system",
        content: buildSystemPrompt(),
      },
      {
        role: "user",
        content: buildUserPrompt(studentAnswer, wordCount),
      },
    ],

    temperature: 0.1,
    top_p: 0.8,
    max_tokens: maxOutputTokens,
    stream: false,
  };

  if (useJsonMode) {
    payload.response_format = {
      type: "json_object",
    };
  }

  try {
    const httpResponse = await fetch(OPENROUTER_URL, {
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

    const rawText = await httpResponse.text();

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      data = { rawText };
    }

    return {
      ok: httpResponse.ok,
      status: httpResponse.status,
      data,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createProviderError(
        408,
        `Model ${model} xử lý quá ` +
          `${Math.round(timeoutMs / 1000)} giây.`,
      );
    }

    throw createProviderError(
      0,
      error instanceof Error
        ? error.message
        : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

function isUnsupportedJsonModeError(data) {
  const message = String(
    data?.error?.message ||
      data?.error?.metadata?.raw ||
      data?.message ||
      data?.detail ||
      data?.rawText ||
      "",
  ).toLowerCase();

  return (
    message.includes("response_format") ||
    message.includes("json mode") ||
    message.includes("structured output") ||
    message.includes("unsupported") ||
    message.includes("invalid argument")
  );
}

function extractMessageText(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        return part?.text || part?.content || "";
      })
      .join("")
      .trim();
  }

  if (content && typeof content === "object") {
    return String(
      content.text || content.content || "",
    ).trim();
  }

  return "";
}

function buildSystemPrompt() {
  const rubricText = RUBRIC.map(
    (item, index) =>
      `${index + 1}. ${item.name}: ${item.maxScore} điểm`,
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

KHUNG LẬP LUẬN 5 BƯỚC:

1. MỞ BÀI TRỰC DIỆN
- Dẫn dắt phù hợp với bối cảnh hoặc thực tiễn.
- Nêu đúng vấn đề nghị luận.
- Khẳng định ý nghĩa hoặc tầm quan trọng.
- Tránh dài dòng, sáo rỗng, xa chủ đề.

2. GIẢI THÍCH BẢN CHẤT
- Giải thích từ khóa trung tâm.
- Làm rõ nghĩa trực tiếp, hàm ẩn hoặc bản chất.
- Ngắn gọn, rõ ràng, không chỉ lặp lại đề.

3. PHÂN TÍCH VÀ CHỨNG MINH
- Phân tích biểu hiện, nguyên nhân, vai trò, ý nghĩa, tác động hoặc hậu quả.
- Có hệ thống luận điểm và lý lẽ.
- Dẫn chứng phù hợp, gắn trực tiếp luận điểm.
- Không cộng điểm cho việc liệt kê mà không phân tích.
- Không bắt buộc dẫn chứng ngành Công an nếu đề không phù hợp.

4. PHẢN ĐỀ VÀ MỞ RỘNG
- Nhìn vấn đề từ góc độ ngược lại.
- Chỉ ra biểu hiện lệch lạc, thờ ơ, cực đoan hoặc phiến diện khi phù hợp.
- Phân biệt bản chất đúng với biểu hiện sai.
- Không quy chụp; tránh phản đề hình thức.

5. LIÊN HỆ VÀ KẾT BÀI
- Rút ra bài học nhận thức.
- Nêu hành động cụ thể.
- Khi phù hợp, liên hệ trách nhiệm của thế hệ trẻ hoặc chiến sĩ Công an tương lai.
- Việc làm có thể gồm học tập, rèn luyện đạo đức, kỷ luật, chấp hành pháp luật, nâng cao tri thức và phục vụ nhân dân.
- Kết bài khẳng định lại vấn đề và thể hiện quyết tâm.

PHÂN LOẠI DẠNG ĐỀ:
- Tư tưởng, đạo lý.
- Hiện tượng đời sống.
Hãy xác định dựa trên bài viết, không tự đặt đề mới.

YÊU CẦU ĐẶC THÙ:
- Đánh giá logic, trách nhiệm, ý thức pháp luật, thái độ phục vụ nhân dân và liên hệ thực tiễn.
- Không tự kết luận học sinh có hay không có lòng trung thành.
- Không bắt buộc nhắc đến Đảng, Nhà nước hoặc Công an trong mọi đề.
- Liên hệ ngành Công an chỉ được đánh giá cao khi tự nhiên, cụ thể và đúng vấn đề.
- Nhận xét chính trị, pháp luật phải khách quan, đúng mực, không cực đoan.

RUBRIC TỔNG 10 ĐIỂM:
${rubricText}

XẾP LOẠI:
- Dưới 5,0: Chưa đạt
- 5,0 đến dưới 6,5: Trung bình
- 6,5 đến dưới 8,0: Khá
- 8,0 đến dưới 9,0: Giỏi
- 9,0 đến 10: Xuất sắc

QUY TẮC CHẤM:
- Đúng 7 tiêu chí và đúng thứ tự rubric.
- Điểm không vượt mức tối đa.
- evidence phải là câu/cụm từ thực sự có trong bài.
- Nếu không có bằng chứng, evidence là chuỗi rỗng.
- nextStep phải hướng dẫn cụ thể.
- Hệ thống sẽ tự tính lại tổng điểm từ 7 tiêu chí.

ĐÁNH GIÁ DẪN CHỨNG:
- Chọn tối đa 3 dẫn chứng quan trọng.
- Đánh giá mức phù hợp, chất lượng phân tích và lưu ý cần kiểm chứng.
- Không khẳng định một sự kiện là đúng nếu thiếu căn cứ.
- Không hạ thấp dẫn chứng phổ thông chỉ vì quen thuộc.

paragraphFeedback gồm:
1. Mở bài
2. Giải thích
3. Phân tích và chứng minh
4. Phản đề và mở rộng
5. Liên hệ và kết bài
6. Bố cục và liên kết toàn bài

status chỉ nhận: good, warning hoặc bad.

SỬA LỖI:
- Chọn tối đa 5 lỗi quan trọng nhất.
- original chép đúng câu/cụm từ trong bài.
- correction là câu sửa hoàn chỉnh.
- explanation giải thích cụ thể.
- Có thể kiểm tra chính tả, dùng từ, ngữ pháp, câu dài, tối nghĩa, lặp ý, liên kết, lập luận, dẫn chứng, khẩu hiệu hóa và liên hệ chung chung.

BỔ SUNG Ý:
- Đề xuất từ 2 đến 3 ý sát chủ đề.
- Không bịa số liệu hoặc sự kiện.
- Nêu vị trí chèn và câu mẫu.

DÀN Ý:
- Từ 5 đến 6 ý.
- Bám sát bài hiện tại và sửa phần yếu.

ĐOẠN VIẾT LẠI:
- Viết lại 1 đến 2 đoạn yếu nhất.
- Tổng độ dài khoảng 100 đến 150 chữ.
- Giữ quan điểm chính.
- Không viết lại toàn bài.
- Không thêm thông tin chưa kiểm chứng.

CHỈ TRẢ VỀ MỘT ĐỐI TƯỢNG JSON HỢP LỆ.
KHÔNG DÙNG MARKDOWN.
KHÔNG ĐẶT JSON TRONG DẤU BA DẤU NHÁY.
KHÔNG THÊM NỘI DUNG TRƯỚC HOẶC SAU JSON.

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

NHIỆM VỤ:
1. Xác định dạng bài và vấn đề trung tâm.
2. Chấm đủ 7 tiêu chí.
3. Mỗi tiêu chí có điểm, nhận xét, bằng chứng và cách nâng điểm.
4. Đánh giá đủ khung 5 bước.
5. Đánh giá tối đa 3 dẫn chứng quan trọng.
6. Chỉ ra tối đa 5 lỗi; có câu gốc, câu sửa và lý do.
7. Đề xuất 2–3 ý còn thiếu, vị trí chèn và câu mẫu.
8. Tạo dàn ý 5–6 ý.
9. Viết lại 1–2 đoạn yếu nhất, tổng 100–150 chữ.
10. Không bịa thông tin học sinh chưa viết.
`.trim();
}

function sanitizeResult(result, wordCount) {
  const sourceCriteria = Array.isArray(result?.criteria)
    ? result.criteria
    : [];

  const criteria = RUBRIC.map((expected, index) => {
    const received = sourceCriteria[index] || {};

    return {
      name: expected.name,
      score: roundToTenth(
        clamp(
          Number(received.score),
          0,
          expected.maxScore,
        ),
      ),
      maxScore: expected.maxScore,
      comment: limitString(
        received.comment || "Chưa có nhận xét.",
        1500,
      ),
      evidence: limitString(
        received.evidence || "",
        500,
      ),
      nextStep: limitString(
        received.nextStep || "",
        1000,
      ),
    };
  });

  const totalScore = roundToTenth(
    criteria.reduce(
      (sum, criterion) => sum + criterion.score,
      0,
    ),
  );

  return {
    essayType: limitString(result?.essayType || "", 120),
    centralIssue: limitString(
      result?.centralIssue || "",
      700,
    ),
    totalScore,
    wordCount,
    level: levelFromScore(totalScore),
    overallComment: limitString(
      result?.overallComment ||
        "AI chưa cung cấp nhận xét tổng quát.",
      2200,
    ),
    criteria,
    strengths: sanitizeStringArray(result?.strengths, 6),
    weaknesses: sanitizeStringArray(result?.weaknesses, 6),
    paragraphFeedback: sanitizeParagraphFeedback(
      result?.paragraphFeedback,
    ),
    evidenceReview: sanitizeEvidenceReview(
      result?.evidenceReview,
    ),
    errors: sanitizeErrors(result?.errors),
    addedIdeas: sanitizeAddedIdeas(result?.addedIdeas),
    improvedOutline: sanitizeStringArray(
      result?.improvedOutline,
      6,
    ),
    revisedPassage: limitString(
      result?.revisedPassage || "",
      4000,
    ),
  };
}

function sanitizeParagraphFeedback(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 6).map((item) => {
    const statuses = ["good", "warning", "bad"];

    const status = statuses.includes(item?.status)
      ? item.status
      : "warning";

    return {
      section: limitString(
        item?.section || "Phần bài viết",
        120,
      ),
      status,
      statusLabel: limitString(
        item?.statusLabel ||
          statusLabelFromStatus(status),
        80,
      ),
      comment: limitString(item?.comment || "", 1200),
      suggestion: limitString(
        item?.suggestion || "",
        1200,
      ),
    };
  });
}

function sanitizeEvidenceReview(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 3).map((item) => ({
    evidence: limitString(item?.evidence || "", 600),
    relevance: limitString(item?.relevance || "", 600),
    accuracyNote: limitString(
      item?.accuracyNote || "",
      600,
    ),
    analysisQuality: limitString(
      item?.analysisQuality || "",
      700,
    ),
    improvement: limitString(
      item?.improvement || "",
      700,
    ),
  }));
}

function sanitizeErrors(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 5).map((item) => ({
    type: limitString(item?.type || "Diễn đạt", 100),
    original: limitString(item?.original || "", 800),
    correction: limitString(
      item?.correction || "",
      1100,
    ),
    explanation: limitString(
      item?.explanation || "",
      1100,
    ),
  }));
}

function sanitizeAddedIdeas(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 3).map((item) => ({
    idea: limitString(item?.idea || "", 800),
    why: limitString(item?.why || "", 1000),
    insertionPoint: limitString(
      item?.insertionPoint || "",
      500,
    ),
    sampleSentence: limitString(
      item?.sampleSentence || "",
      1200,
    ),
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
    request.headers.get(
      "Access-Control-Request-Headers",
    ) || "Content-Type";

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods":
        "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        requestedHeaders,
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
    "Content-Type":
      "application/json; charset=utf-8",
    "Cache-Control":
      "no-store, no-cache, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };

  if (isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] =
      "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type";
  }

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function jsonResponseWithoutCors(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":
        "application/json; charset=utf-8",
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
    // Tiếp tục tìm JSON trong văn bản.
  }

  const start = cleaned.indexOf("{");

  if (start === -1) {
    throw createProviderError(
      502,
      "AI không trả về đối tượng JSON.",
    );
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

    if (inString) {
      continue;
    }

    if (character === "{") {
      depth += 1;
    }

    if (character === "}") {
      depth -= 1;
    }

    if (depth === 0) {
      const candidate = cleaned.slice(
        start,
        index + 1,
      );

      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        break;
      }
    }
  }

  throw createProviderError(
    502,
    "AI trả kết quả JSON không hợp lệ.",
  );
}

function createProviderError(status, message) {
  const error = new Error(String(message));
  error.status = Number(status) || 0;
  return error;
}

function normalizeProviderError(error) {
  return {
    status:
      Number(error?.status) ||
      (error?.name === "AbortError" ? 408 : 0),
    message:
      error instanceof Error
        ? error.message
        : String(error),
  };
}

function normalizeText(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function countWords(text) {
  if (!text) {
    return 0;
  }

  return text
    .split(/\s+/u)
    .filter(Boolean)
    .length;
}

function sanitizeStringArray(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, maxItems)
    .map((item) => limitString(item, 1000))
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
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function clampInteger(
  value,
  min,
  max,
  fallback,
) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.round(
    Math.min(max, Math.max(min, value)),
  );
}

function roundToTenth(value) {
  return (
    Math.round(
      (value + Number.EPSILON) * 10,
    ) / 10
  );
}

function limitString(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
