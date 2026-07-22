
const ALLOWED_ORIGINS = [
  "https://huyhoang2001.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

const NVIDIA_API_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const DEFAULT_MODEL =
  "meta/llama-3.3-70b-instruct";

const MIN_WORDS = 500;
const MAX_CHARS = 30000;
const TIMEOUT_MS = 120000;

const RUBRIC = [
  {
    name: "Cấu trúc bài nghị luận",
    maxScore: 2,
  },
  {
    name: "Giải thích, phân tích và lập luận",
    maxScore: 2.5,
  },
  {
    name: "Dẫn chứng thực tiễn",
    maxScore: 1.5,
  },
  {
    name: "Phản đề và mở rộng",
    maxScore: 1,
  },
  {
    name: "Nhận thức xã hội, pháp luật và trách nhiệm",
    maxScore: 1,
  },
  {
    name: "Liên hệ bản thân và hành động",
    maxScore: 1,
  },
  {
    name: "Diễn đạt, chính tả và liên kết",
    maxScore: 1,
  },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin =
      request.headers.get("Origin") || "";

    // Xử lý CORS preflight.
    if (request.method === "OPTIONS") {
      return handleOptions(request, origin);
    }

    // Kiểm tra hoạt động của Worker.
    if (url.pathname === "/health") {
      if (request.method !== "GET") {
        return jsonResponse(
          {
            ok: false,
            error: "Method not allowed",
          },
          405,
          origin,
        );
      }

      return jsonResponse(
        {
          ok: true,
          service: "essay-grader-api",
          provider: "NVIDIA NIM",
          nvidiaConfigured: Boolean(
            env.NVIDIA_API_KEY,
          ),
          model:
            env.NVIDIA_MODEL ||
            DEFAULT_MODEL,
          timestamp: new Date().toISOString(),
        },
        200,
        origin,
      );
    }

    // Endpoint không tồn tại.
    if (url.pathname !== "/grade") {
      return jsonResponse(
        {
          error: "Không tìm thấy endpoint.",
        },
        404,
        origin,
      );
    }

    // /grade chỉ nhận POST.
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

    // Kiểm tra website gọi API.
    if (!isOriginAllowed(origin)) {
      return new Response(
        JSON.stringify({
          error:
            "Website này không được phép gọi API.",
          receivedOrigin:
            origin || "Không có Origin",
        }),
        {
          status: 403,
          headers: {
            "Content-Type":
              "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            Vary: "Origin",
          },
        },
      );
    }

    // Kiểm tra NVIDIA API key.
    if (!env.NVIDIA_API_KEY) {
      return jsonResponse(
        {
          error:
            "Worker chưa được cấu hình NVIDIA_API_KEY.",
        },
        500,
        origin,
      );
    }

    const contentType =
      request.headers.get("Content-Type") ||
      "";

    if (
      !contentType
        .toLowerCase()
        .includes("application/json")
    ) {
      return jsonResponse(
        {
          error:
            "Content-Type phải là application/json.",
        },
        415,
        origin,
      );
    }

    try {
      let requestBody;

      try {
        requestBody =
          await request.json();
      } catch {
        return jsonResponse(
          {
            error:
              "Dữ liệu gửi lên không phải JSON hợp lệ.",
          },
          400,
          origin,
        );
      }

      const studentAnswer =
        normalizeText(
          requestBody?.studentAnswer,
        );

      const wordCount =
        countWords(studentAnswer);

      if (!studentAnswer) {
        return jsonResponse(
          {
            error:
              "Bạn chưa nhập nội dung bài làm.",
          },
          400,
          origin,
        );
      }

      if (wordCount < MIN_WORDS) {
        return jsonResponse(
          {
            error:
              `Bài làm cần tối thiểu ${MIN_WORDS} chữ. ` +
              `Hiện tại bài có ${wordCount} chữ.`,
            wordCount,
            minimumWords: MIN_WORDS,
          },
          400,
          origin,
        );
      }

      if (
        studentAnswer.length >
        MAX_CHARS
      ) {
        return jsonResponse(
          {
            error:
              `Bài làm không được vượt quá ` +
              `${MAX_CHARS.toLocaleString(
                "vi-VN",
              )} ký tự.`,
          },
          400,
          origin,
        );
      }

      const model =
        String(
          env.NVIDIA_MODEL ||
            DEFAULT_MODEL,
        ).trim();

      const aiText =
        await callNvidia({
          apiKey:
            env.NVIDIA_API_KEY,
          model,
          studentAnswer,
          wordCount,
        });

      let parsed;

      try {
        parsed =
          JSON.parse(aiText);
      } catch (error) {
        console.error(
          "JSON parse error:",
          error,
        );

        console.error(
          "NVIDIA raw response:",
          aiText,
        );

        return jsonResponse(
          {
            error:
              "AI trả về kết quả không đúng định dạng JSON. " +
              "Vui lòng thử nộp lại bài.",
          },
          502,
          origin,
        );
      }

      const result =
        sanitizeResult(
          parsed,
          wordCount,
        );

      return jsonResponse(
        result,
        200,
        origin,
      );
    } catch (error) {
      console.error(
        "Worker error:",
        error,
      );

      if (
        error?.name ===
        "AbortError"
      ) {
        return jsonResponse(
          {
            error:
              "NVIDIA xử lý quá lâu. Vui lòng thử lại.",
          },
          504,
          origin,
        );
      }

      return jsonResponse(
        {
          error:
            error instanceof Error
              ? error.message
              : "Không thể chấm bài.",
        },
        500,
        origin,
      );
    }
  },
};

/**
 * Gọi NVIDIA NIM API.
 */
async function callNvidia({
  apiKey,
  model,
  studentAnswer,
  wordCount,
}) {
  const controller =
    new AbortController();

  const timeoutId = setTimeout(
    () => controller.abort(),
    TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      NVIDIA_API_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Accept:
            "application/json",

          Authorization:
            `Bearer ${apiKey}`,
        },

        signal:
          controller.signal,

        body: JSON.stringify({
          model,

          messages: [
            {
              role: "system",
              content:
                buildSystemPrompt(),
            },

            {
              role: "user",
              content:
                buildUserPrompt(
                  studentAnswer,
                  wordCount,
                ),
            },
          ],

          temperature: 0.15,
          top_p: 0.85,
          max_tokens: 7000,
          stream: false,
        }),
      },
    );

    const responseText =
      await response.text();

    let data;

    try {
      data =
        JSON.parse(responseText);
    } catch {
      data = {
        rawText:
          responseText,
      };
    }

    if (!response.ok) {
      console.error(
        "NVIDIA API error:",
        response.status,
        data,
      );

      const apiMessage =
        data?.error?.message ||
        data?.detail ||
        data?.message ||
        data?.rawText ||
        `NVIDIA API lỗi ${response.status}`;

      if (
        response.status === 400
      ) {
        throw new Error(
          `NVIDIA không chấp nhận yêu cầu: ${apiMessage}`,
        );
      }

      if (
        response.status === 401
      ) {
        throw new Error(
          "NVIDIA API key không hợp lệ hoặc đã hết hiệu lực.",
        );
      }

      if (
        response.status === 403
      ) {
        throw new Error(
          "API key không có quyền sử dụng model NVIDIA này.",
        );
      }

      if (
        response.status === 404
      ) {
        throw new Error(
          `Không tìm thấy model "${model}". ` +
            "Hãy kiểm tra NVIDIA_MODEL trong wrangler.toml.",
        );
      }

      if (
        response.status === 429
      ) {
        throw new Error(
          "NVIDIA API đã vượt giới hạn miễn phí. " +
            "Vui lòng chờ rồi thử lại.",
        );
      }

      if (
        response.status >= 500
      ) {
        throw new Error(
          "Máy chủ NVIDIA đang bận hoặc tạm thời gặp lỗi.",
        );
      }

      throw new Error(
        String(apiMessage),
      );
    }

    const content =
      data?.choices?.[0]
        ?.message?.content;

    let generatedText = "";

    if (
      typeof content ===
      "string"
    ) {
      generatedText =
        content.trim();
    } else if (
      Array.isArray(content)
    ) {
      generatedText =
        content
          .map((part) => {
            if (
              typeof part ===
              "string"
            ) {
              return part;
            }

            return (
              part?.text ||
              part?.content ||
              ""
            );
          })
          .join("")
          .trim();
    }

    if (!generatedText) {
      console.error(
        "NVIDIA response:",
        data,
      );

      throw new Error(
        "NVIDIA không trả về nội dung chấm bài.",
      );
    }

    return extractJson(
      generatedText,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Prompt quy định cách AI chấm.
 */
function buildSystemPrompt() {
  const rubricText =
    RUBRIC.map(
      (item, index) =>
        `${index + 1}. ` +
        `${item.name}: ` +
        `${item.maxScore} điểm`,
    ).join("\n");

  return `
Bạn là giáo viên chấm bài nghị luận xã hội bằng tiếng Việt.

Nhiệm vụ của bạn:
- Chấm bài khách quan.
- Phát hiện lỗi cụ thể.
- Sửa từng lỗi.
- Bổ sung ý học sinh còn thiếu.
- Hướng dẫn học sinh nâng điểm.
- Không nhận xét chung chung.
- Không bịa nội dung không có trong bài.

KHUNG BÀI CẦN ĐÁNH GIÁ:

1. MỞ BÀI
- Dẫn dắt đúng chủ đề.
- Nêu vấn đề nghị luận.
- Khẳng định ý nghĩa của vấn đề.
- Không lan man.

2. GIẢI THÍCH
- Giải thích khái niệm trung tâm.
- Làm rõ bản chất vấn đề.
- Không chỉ lặp lại đề bài.

3. PHÂN TÍCH VÀ CHỨNG MINH
- Phân tích biểu hiện.
- Phân tích nguyên nhân.
- Phân tích vai trò, ý nghĩa hoặc hậu quả.
- Có lập luận logic.
- Có dẫn chứng phù hợp.
- Dẫn chứng phải gắn với luận điểm.

4. PHẢN ĐỀ VÀ MỞ RỘNG
- Nhìn nhận mặt trái.
- Phê phán biểu hiện sai lệch khi phù hợp.
- Không lập luận một chiều.
- Không cực đoan.

5. LIÊN HỆ VÀ KẾT BÀI
- Rút ra bài học nhận thức.
- Đề xuất hành động cụ thể.
- Có thể liên hệ trách nhiệm của thế hệ trẻ hoặc người chiến sĩ Công an tương lai khi phù hợp.
- Kết bài khẳng định lại vấn đề.

NGUYÊN TẮC:
- Chỉ chấm những gì thực sự có trong bài.
- Không suy diễn phẩm chất hoặc tư tưởng của học sinh.
- Không tự bịa sự kiện, số liệu hoặc nhân vật.
- Không cộng điểm chỉ vì bài nhắc đến lực lượng Công an.
- Không trừ điểm vì dẫn chứng phổ thông nếu dẫn chứng hợp lý.
- Điểm phải phản ánh đúng chất lượng bài.

RUBRIC TỔNG 10 ĐIỂM:

${rubricText}

XẾP LOẠI:
- Dưới 5,0: Chưa đạt
- 5,0 đến dưới 6,5: Trung bình
- 6,5 đến dưới 8,0: Khá
- 8,0 đến dưới 9,0: Giỏi
- 9,0 đến 10: Xuất sắc

YÊU CẦU PHÁT HIỆN LỖI:
- Tối đa 12 lỗi quan trọng nhất.
- original phải chép đúng câu hoặc cụm từ của học sinh.
- correction là câu đã sửa hoàn chỉnh.
- explanation giải thích cụ thể.
- Kiểm tra chính tả, dùng từ, ngữ pháp, câu dài, câu tối nghĩa, lặp ý, liên kết, lập luận và dẫn chứng.

YÊU CẦU THÊM Ý:
- Đề xuất từ 2 đến 6 ý.
- Nêu vị trí nên chèn.
- Giải thích tác dụng.
- Viết một câu mẫu.
- Không bịa thông tin thực tế.

YÊU CẦU VIẾT LẠI:
- Chỉ viết lại 1 đến 3 đoạn yếu nhất.
- Dài khoảng 180 đến 300 chữ.
- Không viết lại toàn bộ bài.
- Giữ quan điểm chính của học sinh.

CHỈ TRẢ VỀ MỘT ĐỐI TƯỢNG JSON HỢP LỆ.

KHÔNG dùng Markdown.
KHÔNG dùng dấu ba dấu nháy.
KHÔNG thêm lời giới thiệu.
KHÔNG thêm nội dung trước hoặc sau JSON.

CẤU TRÚC JSON BẮT BUỘC:

{
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

/**
 * Prompt chứa bài làm của học sinh.
 */
function buildUserPrompt(
  studentAnswer,
  wordCount,
) {
  return `
Hãy chấm, phát hiện lỗi và hướng dẫn sửa bài nghị luận dưới đây.

SỐ CHỮ HỆ THỐNG ĐẾM:
${wordCount}

BÀI LÀM:
--------------------
${studentAnswer}
--------------------

Hãy thực hiện đầy đủ:

1. Xác định chủ đề trung tâm.

2. Chấm đúng 7 tiêu chí.

3. Mỗi tiêu chí cần có:
- điểm;
- nhận xét;
- bằng chứng ngắn từ bài;
- hướng nâng điểm.

4. Đánh giá:
- mở bài;
- giải thích;
- phân tích và chứng minh;
- phản đề;
- liên hệ và kết bài.

5. Chỉ ra lỗi:
- chính tả;
- dùng từ;
- ngữ pháp;
- câu dài;
- câu khó hiểu;
- lặp từ;
- lặp ý;
- liên kết;
- lập luận;
- dẫn chứng.

6. Với mỗi lỗi:
- chép đúng câu gốc;
- viết câu sửa;
- giải thích lý do.

7. Đề xuất các ý còn thiếu:
- ý cần thêm;
- vì sao cần thêm;
- vị trí chèn;
- câu mẫu.

8. Tạo dàn ý để nâng điểm.

9. Viết lại từ 1 đến 3 đoạn yếu nhất.

10. Không bịa thông tin.
`.trim();
}

/**
 * Chuẩn hóa kết quả trước khi trả frontend.
 */
function sanitizeResult(
  result,
  wordCount,
) {
  const receivedCriteria =
    Array.isArray(
      result?.criteria,
    )
      ? result.criteria
      : [];

  const criteria =
    RUBRIC.map(
      (expected, index) => {
        const received =
          receivedCriteria[index] ||
          {};

        return {
          name:
            expected.name,

          score:
            roundOneDecimal(
              clamp(
                Number(
                  received.score,
                ),
                0,
                expected.maxScore,
              ),
            ),

          maxScore:
            expected.maxScore,

          comment:
            limitText(
              received.comment ||
                "Chưa có nhận xét.",
              1800,
            ),

          evidence:
            limitText(
              received.evidence ||
                "",
              600,
            ),

          nextStep:
            limitText(
              received.nextStep ||
                "",
              1200,
            ),
        };
      },
    );

  const totalScore =
    roundOneDecimal(
      criteria.reduce(
        (sum, item) =>
          sum + item.score,
        0,
      ),
    );

  return {
    totalScore,
    wordCount,
    level:
      getLevel(totalScore),

    overallComment:
      limitText(
        result?.overallComment ||
          "Chưa có nhận xét tổng quát.",
        2500,
      ),

    criteria,

    strengths:
      sanitizeStringArray(
        result?.strengths,
        8,
      ),

    weaknesses:
      sanitizeStringArray(
        result?.weaknesses,
        8,
      ),

    paragraphFeedback:
      sanitizeParagraphFeedback(
        result?.paragraphFeedback,
      ),

    errors:
      sanitizeErrors(
        result?.errors,
      ),

    addedIdeas:
      sanitizeAddedIdeas(
        result?.addedIdeas,
      ),

    improvedOutline:
      sanitizeStringArray(
        result?.improvedOutline,
        8,
      ),

    revisedPassage:
      limitText(
        result?.revisedPassage ||
          "",
        7000,
      ),
  };
}

function sanitizeParagraphFeedback(
  value,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 6)
    .map((item) => {
      const allowed = [
        "good",
        "warning",
        "bad",
      ];

      const status =
        allowed.includes(
          item?.status,
        )
          ? item.status
          : "warning";

      return {
        section:
          limitText(
            item?.section ||
              "Phần bài viết",
            150,
          ),

        status,

        statusLabel:
          limitText(
            item?.statusLabel ||
              getStatusLabel(
                status,
              ),
            100,
          ),

        comment:
          limitText(
            item?.comment ||
              "",
            1500,
          ),

        suggestion:
          limitText(
            item?.suggestion ||
              "",
            1500,
          ),
      };
    });
}

function sanitizeErrors(
  value,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 12)
    .map((item) => ({
      type:
        limitText(
          item?.type ||
            "Diễn đạt",
          120,
        ),

      original:
        limitText(
          item?.original ||
            "",
          1000,
        ),

      correction:
        limitText(
          item?.correction ||
            "",
          1500,
        ),

      explanation:
        limitText(
          item?.explanation ||
            "",
          1500,
        ),
    }));
}

function sanitizeAddedIdeas(
  value,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 6)
    .map((item) => ({
      idea:
        limitText(
          item?.idea || "",
          1000,
        ),

      why:
        limitText(
          item?.why || "",
          1500,
        ),

      insertionPoint:
        limitText(
          item?.insertionPoint ||
            "",
          700,
        ),

      sampleSentence:
        limitText(
          item?.sampleSentence ||
            "",
          1800,
        ),
    }));
}

/**
 * Tách JSON khỏi câu trả lời AI.
 */
function extractJson(text) {
  let cleaned =
    String(text || "")
      .replace(
        /^```(?:json)?\s*/i,
        "",
      )
      .replace(
        /\s*```$/i,
        "",
      )
      .trim();

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Tiếp tục tìm JSON.
  }

  const start =
    cleaned.indexOf("{");

  if (start === -1) {
    throw new Error(
      "AI không trả về JSON.",
    );
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (
    let index = start;
    index < cleaned.length;
    index += 1
  ) {
    const character =
      cleaned[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (
      character === "\\" &&
      inString
    ) {
      escaped = true;
      continue;
    }

    if (
      character === '"'
    ) {
      inString =
        !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (
      character === "{"
    ) {
      depth += 1;
    }

    if (
      character === "}"
    ) {
      depth -= 1;
    }

    if (depth === 0) {
      const candidate =
        cleaned.slice(
          start,
          index + 1,
        );

      try {
        JSON.parse(
          candidate,
        );

        return candidate;
      } catch {
        break;
      }
    }
  }

  throw new Error(
    "AI trả kết quả JSON không hợp lệ.",
  );
}

/**
 * CORS.
 */
function handleOptions(
  request,
  origin,
) {
  if (
    !isOriginAllowed(origin)
  ) {
    return new Response(
      null,
      {
        status: 403,
        headers: {
          "Cache-Control":
            "no-store",
          Vary: "Origin",
        },
      },
    );
  }

  const requestedHeaders =
    request.headers.get(
      "Access-Control-Request-Headers",
    ) || "Content-Type";

  return new Response(
    null,
    {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin":
          origin,

        "Access-Control-Allow-Methods":
          "GET, POST, OPTIONS",

        "Access-Control-Allow-Headers":
          requestedHeaders,

        "Access-Control-Max-Age":
          "86400",

        Vary: "Origin",
      },
    },
  );
}

function isOriginAllowed(
  origin,
) {
  return ALLOWED_ORIGINS.includes(
    origin,
  );
}

function jsonResponse(
  data,
  status,
  origin,
) {
  const headers = {
    "Content-Type":
      "application/json; charset=utf-8",

    "Cache-Control":
      "no-store, no-cache, must-revalidate",

    "X-Content-Type-Options":
      "nosniff",

    Vary:
      "Origin",
  };

  if (
    isOriginAllowed(origin)
  ) {
    headers[
      "Access-Control-Allow-Origin"
    ] = origin;

    headers[
      "Access-Control-Allow-Methods"
    ] =
      "GET, POST, OPTIONS";

    headers[
      "Access-Control-Allow-Headers"
    ] =
      "Content-Type";
  }

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers,
    },
  );
}

/**
 * Hàm tiện ích.
 */
function normalizeText(
  value,
) {
  return String(value || "")
    .replace(
      /[\u200B-\u200D\uFEFF]/g,
      "",
    )
    .replace(
      /\r\n/g,
      "\n",
    )
    .trim();
}

function countWords(
  text,
) {
  if (!text) {
    return 0;
  }

  return text
    .split(/\s+/u)
    .filter(Boolean)
    .length;
}

function sanitizeStringArray(
  value,
  maximumItems,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(
      0,
      maximumItems,
    )
    .map((item) =>
      limitText(
        item,
        1200,
      ),
    )
    .filter(Boolean);
}

function getLevel(score) {
  if (score < 5) {
    return "Chưa đạt";
  }

  if (score < 6.5) {
    return "Trung bình";
  }

  if (score < 8) {
    return "Khá";
  }

  if (score < 9) {
    return "Giỏi";
  }

  return "Xuất sắc";
}

function getStatusLabel(
  status,
) {
  if (
    status === "good"
  ) {
    return "Đạt tốt";
  }

  if (
    status === "bad"
  ) {
    return "Cần sửa";
  }

  return "Chưa đầy đủ";
}

function clamp(
  value,
  minimum,
  maximum,
) {
  if (
    !Number.isFinite(value)
  ) {
    return minimum;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}

function roundOneDecimal(
  value,
) {
  return (
    Math.round(
      (value +
        Number.EPSILON) *
        10,
    ) / 10
  );
}

function limitText(
  value,
  maximumLength,
) {
  return String(value || "")
    .trim()
    .slice(
      0,
      maximumLength,
    );
}