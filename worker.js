const ALLOWED_ORIGINS = [
  "https://huyhoang2001.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

const DEFAULT_GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

const DEFAULT_MODELS = ["gemini-3-flash-preview"];
const MIN_WORDS = 500;
const MAX_CHARS = 30000;
const DEFAULT_TIMEOUT_MS = 100000;
const DEFAULT_MAX_OUTPUT_TOKENS = 3600;
const DEFAULT_RETRIES_PER_MODEL = 2;

const RUBRIC = [
  { name: "Mở bài và xác định vấn đề", maxScore: 1.0 },
  { name: "Giải thích bản chất vấn đề", maxScore: 1.0 },
  { name: "Phân tích và lập luận", maxScore: 2.5 },
  { name: "Dẫn chứng và chứng minh", maxScore: 1.5 },
  { name: "Phản đề và mở rộng", maxScore: 1.0 },
  { name: "Liên hệ bản thân và trách nhiệm", maxScore: 1.5 },
  { name: "Diễn đạt, chính tả và liên kết", maxScore: 1.5 },
];

const GRADE_RESPONSE_SCHEMA = {
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
      minItems: 7,
      maxItems: 7,
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
        required: [
          "name",
          "score",
          "maxScore",
          "comment",
          "evidence",
          "nextStep",
        ],
        additionalProperties: false,
      },
    },
    strengths: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    weaknesses: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    paragraphFeedback: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          section: { type: "string" },
          status: {
            type: "string",
            enum: ["good", "warning", "bad"],
          },
          statusLabel: { type: "string" },
          comment: { type: "string" },
          suggestion: { type: "string" },
        },
        required: [
          "section",
          "status",
          "statusLabel",
          "comment",
          "suggestion",
        ],
        additionalProperties: false,
      },
    },
    evidenceReview: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          evidence: { type: "string" },
          relevance: { type: "string" },
          accuracyNote: { type: "string" },
          analysisQuality: { type: "string" },
          improvement: { type: "string" },
        },
        required: [
          "evidence",
          "relevance",
          "accuracyNote",
          "analysisQuality",
          "improvement",
        ],
        additionalProperties: false,
      },
    },
    errors: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          original: { type: "string" },
          correction: { type: "string" },
          explanation: { type: "string" },
        },
        required: [
          "type",
          "original",
          "correction",
          "explanation",
        ],
        additionalProperties: false,
      },
    },
    addedIdeas: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          idea: { type: "string" },
          why: { type: "string" },
          insertionPoint: { type: "string" },
          sampleSentence: { type: "string" },
        },
        required: [
          "idea",
          "why",
          "insertionPoint",
          "sampleSentence",
        ],
        additionalProperties: false,
      },
    },
    improvedOutline: {
      type: "array",
      items: { type: "string" },
      minItems: 5,
      maxItems: 6,
    },
    revisedPassage: { type: "string" },
  },
  required: [
    "essayType",
    "centralIssue",
    "totalScore",
    "wordCount",
    "level",
    "overallComment",
    "criteria",
    "strengths",
    "weaknesses",
    "paragraphFeedback",
    "evidenceReview",
    "errors",
    "addedIdeas",
    "improvedOutline",
    "revisedPassage",
  ],
  additionalProperties: false,
};

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
          provider: "Google Gemini",
          geminiConfigured: Boolean(env.GEMINI_API_KEY),
          models: getModels(env),
          modelTimeoutMs: getTimeoutMs(env),
          maxOutputTokens: getMaxOutputTokens(env),
          retriesPerModel: getRetriesPerModel(env),
          thinkingLevel: getThinkingLevel(env),
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

    if (!env.GEMINI_API_KEY) {
      return jsonResponse(
        { error: "Worker chưa được cấu hình GEMINI_API_KEY." },
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
              `Bài làm vượt quá ` +
              `${MAX_CHARS.toLocaleString("vi-VN")} ký tự.`,
          },
          400,
          origin,
        );
      }

      const aiResult = await callGeminiWithFallback({
        apiKey: env.GEMINI_API_KEY,
        apiBaseUrl:
          String(env.GEMINI_API_BASE_URL || DEFAULT_GEMINI_API_BASE)
            .trim()
            .replace(/\/+$/, ""),
        relaySecret: String(env.GEMINI_RELAY_SECRET || ""),
        models: getModels(env),
        studentAnswer,
        wordCount,
        timeoutMs: getTimeoutMs(env),
        maxOutputTokens: getMaxOutputTokens(env),
        retriesPerModel: getRetriesPerModel(env),
        thinkingLevel: getThinkingLevel(env),
      });

      let parsed;

      try {
        parsed = JSON.parse(aiResult.text);
      } catch {
        console.error("Final Gemini JSON parse failed:", aiResult.text);

        return jsonResponse(
          { error: "Gemini trả về dữ liệu không đúng định dạng JSON." },
          502,
          origin,
        );
      }

      const result = sanitizeResult(parsed, wordCount);

      return jsonResponse(
        {
          ...result,
          provider: "Google Gemini",
          model: aiResult.model,
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
        mapErrorToHttpStatus(error),
        origin,
      );
    }
  },
};

function getModels(env) {
  const configured = String(env.GEMINI_MODELS || "")
    .split(",")
    .map(normalizeModelName)
    .filter(Boolean);

  return configured.length
    ? [...new Set(configured)]
    : DEFAULT_MODELS;
}

function getTimeoutMs(env) {
  return clampInteger(
    Number(env.GEMINI_MODEL_TIMEOUT_MS),
    15000,
    120000,
    DEFAULT_TIMEOUT_MS,
  );
}

function getMaxOutputTokens(env) {
  return clampInteger(
    Number(env.GEMINI_MAX_OUTPUT_TOKENS),
    1200,
    8000,
    DEFAULT_MAX_OUTPUT_TOKENS,
  );
}

function getRetriesPerModel(env) {
  return clampInteger(
    Number(env.GEMINI_RETRIES_PER_MODEL),
    1,
    3,
    DEFAULT_RETRIES_PER_MODEL,
  );
}

function getThinkingLevel(env) {
  const allowed = ["minimal", "low", "medium", "high"];
  const value = String(env.GEMINI_THINKING_LEVEL || "low")
    .trim()
    .toLowerCase();

  return allowed.includes(value) ? value : "low";
}

async function callGeminiWithFallback({
  apiKey,
  apiBaseUrl,
  relaySecret,
  models,
  studentAnswer,
  wordCount,
  timeoutMs,
  maxOutputTokens,
  retriesPerModel,
  thinkingLevel,
}) {
  const failures = [];

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];

    for (let attempt = 1; attempt <= retriesPerModel; attempt += 1) {
      try {
        console.log(
          `Calling Gemini model ${model} ` +
            `(${modelIndex + 1}/${models.length}), ` +
            `attempt ${attempt}/${retriesPerModel}`,
        );

        const text = await callSingleGeminiModel({
          apiKey,
          apiBaseUrl,
          relaySecret,
          model,
          studentAnswer,
          wordCount,
          timeoutMs,
          maxOutputTokens,
          thinkingLevel,
        });

        console.log(`Gemini model succeeded: ${model}`);

        return { text, model };
      } catch (error) {
        const failure = normalizeProviderError(error);

        failures.push({
          model,
          attempt,
          status: failure.status,
          message: failure.message,
        });

        console.warn(
          `Gemini model failed: ${model}`,
          failure.status,
          failure.message,
        );

        if (failure.status === 401) {
          throw createProviderError(
            401,
            "GEMINI_API_KEY không hợp lệ hoặc đã hết hiệu lực.",
          );
        }

        if (
          failure.status === 403 &&
          failure.message.toLowerCase().includes("location")
        ) {
          throw createProviderError(403, failure.message);
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
            1800 * 2 ** (attempt - 1) +
            Math.floor(Math.random() * 900);

          console.warn(`Retrying ${model} after ${waitMs} ms`);
          await sleep(waitMs);
          continue;
        }

        break;
      }
    }

    if (modelIndex < models.length - 1) {
      console.warn(`Switching to next Gemini model: ${model}`);
    }
  }

  console.error("All Gemini models failed:", failures);

  const summary = failures
    .map(
      (item) =>
        `${item.model} (HTTP ${item.status || "?"}): ${item.message}`,
    )
    .join(" | ");

  throw createProviderError(
    503,
    "Các model Gemini hiện đều đang bận hoặc không khả dụng. " +
      summary,
  );
}

async function callSingleGeminiModel({
  apiKey,
  apiBaseUrl,
  relaySecret,
  model,
  studentAnswer,
  wordCount,
  timeoutMs,
  maxOutputTokens,
  thinkingLevel,
}) {
  const result = await sendGeminiRequest({
    apiKey,
    apiBaseUrl,
    relaySecret,
    model,
    studentAnswer,
    wordCount,
    timeoutMs,
    maxOutputTokens,
    thinkingLevel,
  });

  if (!result.ok) {
    console.error("Gemini API error:", result.status, result.data);

    const message =
      result.data?.error?.message ||
      result.data?.message ||
      result.data?.rawText ||
      `HTTP ${result.status}`;

    const lowered = String(message).toLowerCase();

    if (lowered.includes("user location is not supported")) {
      throw createProviderError(
        403,
        "Gemini từ chối vị trí mạng của Cloudflare Worker: " +
          "User location is not supported for the API use.",
      );
    }

    throw createProviderError(result.status, String(message));
  }

  const candidate = result.data?.candidates?.[0];
  const finishReason = candidate?.finishReason || "";

  if (
    finishReason &&
    !["STOP", "MAX_TOKENS"].includes(finishReason)
  ) {
    console.warn(`Gemini finishReason: ${finishReason}`);
  }

  const text =
    candidate?.content?.parts
      ?.map((part) => part?.text || "")
      .join("")
      .trim() || "";

  if (!text) {
    const blockReason = result.data?.promptFeedback?.blockReason;

    throw createProviderError(
      502,
      blockReason
        ? `Gemini từ chối nội dung: ${blockReason}.`
        : `Model ${model} không trả về nội dung.`,
    );
  }

  const jsonText = extractJsonObject(text);

  try {
    JSON.parse(jsonText);
  } catch {
    throw createProviderError(
      502,
      `Model ${model} trả JSON không hợp lệ.`,
    );
  }

  return jsonText;
}

async function sendGeminiRequest({
  apiKey,
  apiBaseUrl,
  relaySecret,
  model,
  studentAnswer,
  wordCount,
  timeoutMs,
  maxOutputTokens,
  thinkingLevel,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const generationConfig = {
    maxOutputTokens,
    thinkingConfig: {
      thinkingLevel,
    },
    responseMimeType: "application/json",
    responseJsonSchema: GRADE_RESPONSE_SCHEMA,
  };

  const payload = {
    systemInstruction: {
      parts: [{ text: buildSystemPrompt() }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: buildUserPrompt(studentAnswer, wordCount),
          },
        ],
      },
    ],
    generationConfig,
  };

  const endpoint =
    `${apiBaseUrl}/${encodeURIComponent(model)}` +
    ":generateContent";

  try {
    const headers = {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    };

    if (apiBaseUrl !== DEFAULT_GEMINI_API_BASE && relaySecret) {
      headers["x-relay-secret"] = relaySecret;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
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

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createProviderError(
        408,
        `Model ${model} xử lý quá ${Math.round(timeoutMs / 1000)} giây.`,
      );
    }

    throw createProviderError(
      0,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

function buildSystemPrompt() {
  const rubricText = RUBRIC.map(
    (item, index) =>
      `${index + 1}. ${item.name}: ${item.maxScore} điểm`,
  ).join("\n");

  return `
Bạn là giám khảo khó tính, công bằng và nhất quán, chuyên chấm bài nghị luận xã hội tiếng Việt theo định hướng thi Văn bằng 2 Công an nhân dân.

MỤC TIÊU CHẤM:
- Đánh giá đúng năng lực thể hiện trong bài, không chấm theo thiện cảm, độ dài, khẩu hiệu hoặc ý định được suy đoán.
- Chỉ rõ điểm mạnh, điểm yếu, lỗi cụ thể và cách sửa có thể áp dụng ngay.
- Mở rộng tư duy cho người viết nhưng không làm thay, không đổi lập trường chính và không bịa dữ kiện.
- Phân biệt rõ: “có nhắc tới” khác với “đã giải thích/phân tích/chứng minh thuyết phục”.
- Mọi điểm số phải có căn cứ từ chính bài làm. Không có bằng chứng thì không cho điểm ở mức cao.

QUY TRÌNH ĐỌC VÀ KIỂM TRA:
1. Xác định dạng đề từ nội dung bài: tư tưởng, đạo lý; hiện tượng đời sống; hoặc dạng giao thoa. Không tự đặt đề mới.
2. Nêu chính xác vấn đề trung tâm, phạm vi và thái độ/lập trường chính của người viết.
3. Lập bản đồ luận điểm ngầm: mỗi đoạn đang làm nhiệm vụ gì, có phục vụ vấn đề trung tâm không, các bước có cân đối không.
4. Kiểm tra từng khẳng định theo chuỗi: luận điểm → lý lẽ → dẫn chứng → phân tích dẫn chứng → kết luận. Mắt xích thiếu phải được nêu rõ.
5. Kiểm tra phản đề, chiều sâu mở rộng, liên hệ bản thân và tính khả thi của hành động.
6. Kiểm tra diễn đạt, chính tả, dùng từ, câu, liên kết, lặp ý và tính nhất quán.
7. Chấm độc lập từng tiêu chí rồi tự đối chiếu tổng thể trước khi trả kết quả.

KHUNG LẬP LUẬN 5 BƯỚC:

1. MỞ BÀI TRỰC DIỆN
- Dẫn vào bằng bối cảnh hoặc nhận định liên quan trực tiếp; không bắt buộc trích dẫn.
- Gọi đúng vấn đề nghị luận, giới hạn phạm vi và thể hiện định hướng bàn luận.
- Khẳng định ngắn gọn ý nghĩa/tính cấp thiết.
- Trừ điểm khi mở bài chung chung có thể dùng cho mọi đề, dẫn dài, sai trọng tâm hoặc nêu vấn đề mơ hồ.

2. GIẢI THÍCH BẢN CHẤT
- Giải nghĩa từ khóa, khái niệm, nghĩa trực tiếp/hàm ẩn và nội hàm của vấn đề.
- Chốt lại bản chất bằng lời của người viết, không chỉ chép hoặc đảo từ đề bài.
- Với tư tưởng đạo lý: làm rõ phẩm chất, biểu hiện và giới hạn đúng.
- Với hiện tượng đời sống: làm rõ hiện trạng, chủ thể, phạm vi và tính chất.
- Giải thích phải đủ để làm nền cho phần phân tích, nhưng gọn và không biến thành kể lể.

3. PHÂN TÍCH VÀ CHỨNG MINH
- Tổ chức thành các luận điểm khác nhau, có thứ tự hợp lý; không tách nhiều đoạn nhưng lặp cùng một ý.
- Tùy đề, phân tích các bình diện: biểu hiện; nguyên nhân chủ quan/khách quan; vai trò/ý nghĩa; tác động/hậu quả; điều kiện thực hiện; giải pháp.
- Mỗi luận điểm cần lý lẽ giải thích “vì sao/như thế nào”, không chỉ khẳng định.
- Dẫn chứng phải có thật hoặc được trình bày thận trọng, đúng trọng tâm, đủ cụ thể và tiêu biểu.
- Sau dẫn chứng phải phân tích chi tiết nào chứng minh luận điểm và rút ra ý nghĩa; liệt kê tên người/sự kiện không được xem là chứng minh.
- Ưu tiên dẫn chứng lịch sử, xã hội, quốc gia/quốc tế hoặc gắn nhiệm vụ bảo vệ an ninh, trật tự khi thật sự phù hợp.
- Không mặc nhiên coi dẫn chứng quen thuộc là yếu; đánh giá cách khai thác. Không xác nhận dữ kiện chưa chắc chắn.

4. PHẢN ĐỀ VÀ MỞ RỘNG
- Xem xét mặt đối lập, biểu hiện lệch lạc, cực đoan, thờ ơ, lợi dụng hoặc giới hạn áp dụng của vấn đề.
- Phân biệt đúng/sai, tích cực/tiêu cực và điều kiện để một quan niệm đúng không bị tuyệt đối hóa.
- Có lý giải và hướng điều chỉnh; một câu phê phán khuôn mẫu chưa được tính là tư duy phản biện.
- Không quy chụp cá nhân, nhóm người; không biến phản đề thành phủ định vấn đề chính.

5. LIÊN HỆ VÀ KẾT BÀI
- Rút ra bài học nhận thức, thái độ và hành động; hành động phải cụ thể, khả thi và gắn đúng vấn đề.
- Khi phù hợp, triển khai ba lớp: trách nhiệm của thế hệ trẻ; trách nhiệm của chiến sĩ Công an tương lai; việc làm ngay hôm nay.
- Liên hệ ngành Công an phải tự nhiên, thể hiện ý thức pháp luật, kỷ luật, trách nhiệm, tinh thần phục vụ nhân dân; không cộng điểm cho khẩu hiệu.
- Kết bài khái quát giá trị vấn đề, khép lại mạch lập luận và thể hiện cam kết hợp lý; tránh lặp nguyên mở bài.

YÊU CẦU ĐẶC THÙ VB2 CÔNG AN:
- Đánh giá tư duy logic, phán đoán chính trị thận trọng, ý thức pháp luật, tinh thần trách nhiệm và khả năng liên hệ thực tiễn.
- Không suy diễn phẩm chất, tư tưởng hay lòng trung thành của thí sinh.
- Không bắt buộc nhắc Đảng, Nhà nước hoặc lực lượng Công an nếu đề không phù hợp.
- Nhận xét chính trị, pháp luật, nghiệp vụ phải khách quan; nội dung đáng ngờ ghi “cần kiểm chứng”, không tự sửa bằng dữ kiện bịa đặt.

RUBRIC CỐ ĐỊNH, TỔNG 10 ĐIỂM:
${rubricText}

CHUẨN CHẤM KHẮT KHE:
- Chấm theo chất lượng thực tế, không mặc định bài đủ 500 chữ là đạt khá.
- Một tiêu chí chỉ đạt từ 70% điểm tối đa khi nội dung đúng, khá đầy đủ, có bằng chứng và ít nhất một phần phân tích rõ.
- Chỉ đạt từ 80% điểm tối đa khi triển khai sâu, mạch lạc, có lựa chọn và phân tích dẫn chứng tốt, ít lỗi đáng kể.
- Chỉ đạt từ 90% điểm tối đa khi nổi bật, toàn diện, sắc sảo, nhất quán và gần như không có lỗi quan trọng. Điểm 9+ là hiếm.
- Bài đúng bố cục nhưng chủ yếu nêu ý, khẩu hiệu, công thức hoặc thiếu phân tích không vượt 6,5.
- Bài thiếu phản đề/mở rộng thực chất không vượt 8,0.
- Bài có dẫn chứng nhưng phần lớn kể hoặc liệt kê, thiếu phân tích không vượt 7,5.
- Bài lạc hoặc hiểu sai vấn đề trung tâm không vượt 4,5; lạc một phần phải trừ trực tiếp ở các tiêu chí liên quan.
- Bài có lỗi dữ kiện nghiêm trọng làm nền cho lập luận không vượt 7,0; nếu chưa chắc, ghi “cần kiểm chứng” và chấm thận trọng.
- Bài diễn đạt nhiều câu tối nghĩa, lỗi liên kết hoặc lỗi chính tả lặp lại không vượt 7,0.
- Không áp dụng trần điểm máy móc nếu điều kiện không xảy ra; khi có nhiều trần, dùng trần thấp nhất.
- Không bù điểm tiêu chí yếu bằng tiêu chí khác. Điểm mỗi tiêu chí làm tròn đến 0,1.

XẾP LOẠI:
- Dưới 5,0: Chưa đạt
- 5,0 đến dưới 6,5: Trung bình
- 6,5 đến dưới 8,0: Khá
- 8,0 đến dưới 9,0: Giỏi
- 9,0 đến 10: Xuất sắc

YÊU CẦU CHO TỪNG TRƯỜNG KẾT QUẢ:
- criteria: đúng 7 tiêu chí, đúng thứ tự rubric. comment phải nêu mức đạt, phần thiếu và tác động đến điểm. evidence chỉ trích nguyên văn câu/cụm từ thực sự có trong bài; không có thì để chuỗi rỗng. nextStep phải là thao tác sửa cụ thể.
- overallComment: tổng hợp mức độ đáp ứng vấn đề, độ sâu lập luận, dẫn chứng, bố cục và diễn đạt; giải thích ngắn gọn vì sao bài ở mức điểm đó.
- strengths/weaknesses: ưu tiên nhận xét cụ thể, không dùng lời khen/chê chung chung.
- paragraphFeedback: đúng thứ tự 6 mục: Mở bài; Giải thích; Phân tích và chứng minh; Phản đề và mở rộng; Liên hệ và kết bài; Bố cục và liên kết toàn bài. status chỉ là good, warning hoặc bad. suggestion phải hướng dẫn bổ sung/sắp xếp/viết lại cụ thể.
- evidenceReview: chọn tối đa 3 dẫn chứng có ảnh hưởng lớn nhất. Tách riêng độ liên quan, độ tin cậy, chất lượng phân tích và cách cải thiện. Không chắc tính đúng sai thì ghi “cần kiểm chứng”.
- errors: chọn tối đa 5 lỗi có ảnh hưởng lớn nhất, bao quát cả lỗi tư duy/lập luận và ngôn ngữ. original phải chép đúng văn bản bài làm; correction là bản sửa hoàn chỉnh; explanation nêu quy tắc hoặc lý do.
- addedIdeas: đề xuất 2–3 ý mới sát chủ đề, ưu tiên ý giúp lấp mắt xích lập luận còn thiếu. Mỗi ý phải có lý do, vị trí chèn chính xác và câu mẫu phù hợp giọng bài. Không bịa số liệu/sự kiện.
- improvedOutline: tạo 5–6 mục theo đúng tiến trình bài hoàn chỉnh. Mỗi mục phải ghi: mục đích đoạn; luận điểm chính; 2–3 ý triển khai; loại dẫn chứng phù hợp; câu chuyển hoặc kết luận cần có. Dàn ý phải cá nhân hóa theo bài, ưu tiên sửa phần yếu, không chỉ lặp tên 5 bước.
- revisedPassage: viết lại 1–2 đoạn yếu nhất, tổng 100–150 chữ; giữ quan điểm chính, nâng logic và diễn đạt; không viết lại toàn bài, không thêm dữ kiện chưa kiểm chứng.

NGUYÊN TẮC CHỐNG BỊA VÀ TỰ KIỂM:
- Không đưa câu do bạn viết vào evidence hoặc original.
- Không khẳng định độ chính xác của dữ kiện ngoài bài khi không đủ căn cứ.
- Trước khi trả lời, kiểm tra: đủ 7 tiêu chí; đúng maxScore; tổng điểm hợp lý với nhận xét và trần điểm; mọi trích dẫn có trong bài; dàn ý và đoạn sửa bám đúng vấn đề.
- Tổng điểm cuối sẽ được hệ thống tính lại từ 7 tiêu chí.

Chỉ trả về JSON đúng schema hệ thống yêu cầu.
Toàn bộ nội dung phải bằng tiếng Việt, không dùng Markdown và không thêm văn bản ngoài JSON.
`.trim();
}

function buildLegacySystemPrompt() {
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
- Dẫn dắt từ bối cảnh thời đại hoặc thực tiễn phù hợp.
- Nêu đúng, rõ vấn đề nghị luận.
- Khẳng định ý nghĩa hoặc tầm quan trọng của vấn đề.
- Có thể dùng châm ngôn hoặc trích dẫn chính thống khi phù hợp, nhưng không bắt buộc.
- Tránh dài dòng, sáo rỗng hoặc xa chủ đề.

2. GIẢI THÍCH BẢN CHẤT
- Giải thích từ khóa trung tâm.
- Làm rõ nghĩa trực tiếp, nghĩa hàm ẩn hoặc bản chất của câu nói/hiện tượng.
- Ngắn gọn, súc tích, tránh lan man.
- Không chỉ lặp lại đề bài.

3. PHÂN TÍCH VÀ CHỨNG MINH
- Phân tích biểu hiện, nguyên nhân, vai trò, ý nghĩa, tác động hoặc hậu quả.
- Có hệ thống luận điểm rõ ràng và lý lẽ hợp lý.
- Dẫn chứng phải phù hợp, có thật và gắn trực tiếp với luận điểm.
- Ưu tiên dẫn chứng lịch sử, xã hội, quốc gia, quốc tế hoặc liên quan nhiệm vụ bảo vệ an ninh, trật tự khi phù hợp.
- Không bắt buộc dẫn chứng ngành Công an nếu đề không phù hợp.
- Không cộng điểm cho việc liệt kê dẫn chứng mà không phân tích.

4. PHẢN ĐỀ VÀ MỞ RỘNG
- Nhìn vấn đề từ góc độ ngược lại.
- Chỉ ra biểu hiện lệch lạc, thờ ơ, cực đoan, phiến diện hoặc lợi dụng vấn đề khi phù hợp.
- Phân biệt bản chất đúng với biểu hiện sai.
- Thể hiện tư duy biện chứng, không quy chụp.
- Tránh phản đề hình thức chỉ có một câu phê phán chung chung.

5. LIÊN HỆ VÀ KẾT BÀI
- Rút ra bài học nhận thức.
- Nêu hành động cụ thể của bản thân.
- Khi phù hợp, liên hệ theo ba lớp:
  a) Trách nhiệm của thế hệ trẻ đối với đất nước.
  b) Trách nhiệm của người chiến sĩ Công an tương lai.
  c) Việc làm thực tế ngay hôm nay: học tập, rèn luyện đạo đức, kỷ luật, chấp hành pháp luật, nâng cao tri thức và tinh thần phục vụ nhân dân.
- Kết bài khẳng định lại giá trị của vấn đề và thể hiện quyết tâm.
- Không bắt buộc dùng công thức liên hệ cứng nhắc nếu đề không phù hợp.

PHÂN LOẠI DẠNG ĐỀ:
- Dạng tư tưởng, đạo lý.
- Dạng hiện tượng đời sống.
Hãy xác định đúng dạng đề dựa trên bài viết, không tự đặt đề mới.

YÊU CẦU ĐẶC THÙ ĐỐI VỚI BÀI VB2 CÔNG AN:
- Đánh giá tính logic, tinh thần trách nhiệm, ý thức pháp luật, thái độ phục vụ nhân dân và khả năng liên hệ thực tiễn.
- Không được tự kết luận học sinh có hay không có lòng trung thành.
- Không bắt buộc học sinh phải nhắc đến Đảng, Nhà nước hoặc lực lượng Công an trong mọi đề.
- Khi học sinh liên hệ ngành Công an, đánh giá xem liên hệ có tự nhiên, cụ thể và gắn với vấn đề hay chỉ mang tính khẩu hiệu.
- Mọi nhận xét về chính trị, pháp luật và nghiệp vụ phải khách quan, đúng mực, không cực đoan.

RUBRIC CỐ ĐỊNH, TỔNG 10 ĐIỂM:
${rubricText}

XẾP LOẠI:
- Dưới 5,0: Chưa đạt
- Từ 5,0 đến dưới 6,5: Trung bình
- Từ 6,5 đến dưới 8,0: Khá
- Từ 8,0 đến dưới 9,0: Giỏi
- Từ 9,0 đến 10: Xuất sắc

QUY TẮC CHẤM:
- Có đúng 7 tiêu chí và đúng thứ tự rubric.
- Điểm không vượt điểm tối đa.
- evidence phải là câu hoặc cụm từ thực sự có trong bài.
- Nếu không có bằng chứng, evidence là chuỗi rỗng.
- nextStep phải hướng dẫn cụ thể cách nâng điểm.
- Tổng điểm cuối do hệ thống tự tính lại từ 7 tiêu chí.

ĐÁNH GIÁ DẪN CHỨNG:
- Chọn tối đa 3 dẫn chứng quan trọng.
- Đánh giá mức độ phù hợp và chất lượng phân tích.
- Không xác nhận một sự kiện là đúng nếu không đủ căn cứ.
- Nếu dẫn chứng mơ hồ, ghi “cần kiểm chứng”.
- Không hạ thấp dẫn chứng phổ thông chỉ vì quen thuộc.

paragraphFeedback gồm lần lượt:
1. Mở bài
2. Giải thích
3. Phân tích và chứng minh
4. Phản đề và mở rộng
5. Liên hệ và kết bài
6. Bố cục và liên kết toàn bài

status chỉ nhận: good, warning hoặc bad.

SỬA LỖI:
- Chọn tối đa 5 lỗi quan trọng nhất.
- original phải chép đúng câu hoặc cụm từ trong bài.
- correction là câu sửa hoàn chỉnh.
- explanation giải thích cụ thể.
- Có thể kiểm tra chính tả, dùng từ, ngữ pháp, câu dài, câu tối nghĩa, lặp từ, lặp ý, chuyển đoạn yếu, lập luận nhảy cóc, mâu thuẫn, dẫn chứng không gắn luận điểm, khẳng định thiếu căn cứ, khẩu hiệu hóa và liên hệ chung chung.

BỔ SUNG Ý:
- Đề xuất từ 2 đến 3 ý sát chủ đề.
- Không bịa số liệu hoặc sự kiện.
- Nêu vị trí chèn và một câu mẫu.

DÀN Ý:
- Từ 5 đến 6 ý.
- Bám sát bài hiện tại và tập trung sửa phần yếu.

ĐOẠN VIẾT LẠI:
- Viết lại 1 đến 2 đoạn yếu nhất.
- Tổng độ dài khoảng 100 đến 150 chữ.
- Giữ quan điểm chính của học sinh.
- Không viết lại toàn bài.
- Không thêm thông tin chưa kiểm chứng.

Chỉ trả về JSON đúng schema hệ thống yêu cầu.
Không dùng Markdown.
Không thêm nội dung trước hoặc sau JSON.
`.trim();
}

function buildUserPrompt(studentAnswer, wordCount) {
  return `
Hãy chấm nghiêm, phát hiện lỗi và hướng dẫn nâng cấp bài nghị luận xã hội dưới đây.

SỐ CHỮ DO HỆ THỐNG ĐẾM:
${wordCount} chữ

BÀI LÀM:
--------------------
${studentAnswer}
--------------------

NHIỆM VỤ:
1. Xác định dạng bài, vấn đề trung tâm, phạm vi và lập trường thực sự thể hiện trong bài.
2. Chấm độc lập đủ 7 tiêu chí; dẫn nguyên văn bằng chứng cho từng tiêu chí khi có.
3. Áp dụng đúng chuẩn chấm khắt khe và trần điểm; không nâng điểm vì bài dài, đủ bố cục hoặc có nhiều khẩu hiệu.
4. Đánh giá đủ 5 bước, chỉ rõ bước thiếu, bước có nhưng hời hợt và mắt xích lập luận bị đứt.
5. Kiểm tra tối đa 3 dẫn chứng quan trọng về độ liên quan, độ tin cậy và mức phân tích.
6. Chọn tối đa 5 lỗi ảnh hưởng lớn nhất; ưu tiên lỗi sai vấn đề, logic, dẫn chứng, câu tối nghĩa rồi mới đến lỗi nhỏ.
7. Đề xuất 2–3 ý mở rộng sát bài, nêu chính xác vị trí chèn, tác dụng và câu mẫu.
8. Tạo dàn ý cá nhân hóa 5–6 mục; mỗi mục phải đủ mục đích, luận điểm, ý triển khai, loại dẫn chứng và cách chuyển ý.
9. Viết lại 1–2 đoạn yếu nhất, tổng 100–150 chữ, giữ quan điểm của người viết.
10. Đối chiếu điểm với nhận xét lần cuối; không bịa câu chữ, sự kiện, số liệu hoặc năng lực/phẩm chất của người viết.
`.trim();
}

function buildLegacyUserPrompt(studentAnswer, wordCount) {
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
        clamp(Number(received.score), 0, expected.maxScore),
      ),
      maxScore: expected.maxScore,
      comment: limitString(
        received.comment || "Chưa có nhận xét.",
        1500,
      ),
      evidence: limitString(received.evidence || "", 500),
      nextStep: limitString(received.nextStep || "", 1000),
    };
  });

  const totalScore = roundToTenth(
    criteria.reduce((sum, criterion) => sum + criterion.score, 0),
  );

  return {
    essayType: limitString(result?.essayType || "", 120),
    centralIssue: limitString(result?.centralIssue || "", 700),
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
    evidenceReview: sanitizeEvidenceReview(result?.evidenceReview),
    errors: sanitizeErrors(result?.errors),
    addedIdeas: sanitizeAddedIdeas(result?.addedIdeas),
    improvedOutline: sanitizeStringArray(result?.improvedOutline, 6),
    revisedPassage: limitString(result?.revisedPassage || "", 4000),
  };
}

function sanitizeParagraphFeedback(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 6).map((item) => {
    const statuses = ["good", "warning", "bad"];
    const status = statuses.includes(item?.status)
      ? item.status
      : "warning";

    return {
      section: limitString(item?.section || "Phần bài viết", 120),
      status,
      statusLabel: limitString(
        item?.statusLabel || statusLabelFromStatus(status),
        80,
      ),
      comment: limitString(item?.comment || "", 1200),
      suggestion: limitString(item?.suggestion || "", 1200),
    };
  });
}

function sanitizeEvidenceReview(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 3).map((item) => ({
    evidence: limitString(item?.evidence || "", 600),
    relevance: limitString(item?.relevance || "", 600),
    accuracyNote: limitString(item?.accuracyNote || "", 600),
    analysisQuality: limitString(item?.analysisQuality || "", 700),
    improvement: limitString(item?.improvement || "", 700),
  }));
}

function sanitizeErrors(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 5).map((item) => ({
    type: limitString(item?.type || "Diễn đạt", 100),
    original: limitString(item?.original || "", 800),
    correction: limitString(item?.correction || "", 1100),
    explanation: limitString(item?.explanation || "", 1100),
  }));
}

function sanitizeAddedIdeas(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 3).map((item) => ({
    idea: limitString(item?.idea || "", 800),
    why: limitString(item?.why || "", 1000),
    insertionPoint: limitString(item?.insertionPoint || "", 500),
    sampleSentence: limitString(item?.sampleSentence || "", 1200),
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
    request.headers.get("Access-Control-Request-Headers") ||
    "Content-Type";

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

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
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
    // Tiếp tục tìm JSON trong phần trả lời.
  }

  const start = cleaned.indexOf("{");

  if (start === -1) {
    throw createProviderError(
      502,
      "Gemini không trả về đối tượng JSON.",
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

  throw createProviderError(
    502,
    "Gemini trả kết quả JSON không hợp lệ.",
  );
}

function normalizeModelName(value) {
  return String(value || "")
    .replace(/^models\//, "")
    .trim();
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
      error instanceof Error ? error.message : String(error),
  };
}

function mapErrorToHttpStatus(error) {
  const status = Number(error?.status);

  if (
    [
      400,
      401,
      403,
      404,
      408,
      429,
      500,
      502,
      503,
      504,
    ].includes(status)
  ) {
    return status;
  }

  return 500;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function countWords(text) {
  if (!text) return 0;

  return text
    .split(/\s+/u)
    .filter(Boolean)
    .length;
}

function sanitizeStringArray(value, maxItems) {
  if (!Array.isArray(value)) return [];

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
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
