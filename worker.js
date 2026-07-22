const ALLOWED_ORIGINS = [
  "https://huyhoang2001.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

const MIN_WORDS = 500;
const MAX_CHARS = 30000;
const GEMINI_TIMEOUT_MS = 90000;

const CRITERIA = [
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

/**
 * Schema JSON Gemini bắt buộc phải trả về.
 * Frontend essay-grader.js đang đọc đúng các trường này.
 */
const JSON_SCHEMA = {
  type: "object",
  required: [
    "totalScore",
    "wordCount",
    "level",
    "overallComment",
    "criteria",
    "strengths",
    "weaknesses",
    "paragraphFeedback",
    "errors",
    "addedIdeas",
    "improvedOutline",
    "revisedPassage",
  ],
  properties: {
    totalScore: {
      type: "number",
      minimum: 0,
      maximum: 10,
    },

    wordCount: {
      type: "integer",
      minimum: 0,
    },

    level: {
      type: "string",
      enum: [
        "Chưa đạt",
        "Trung bình",
        "Khá",
        "Giỏi",
        "Xuất sắc",
      ],
    },

    overallComment: {
      type: "string",
    },

    criteria: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: {
        type: "object",
        required: [
          "name",
          "score",
          "maxScore",
          "comment",
          "evidence",
          "nextStep",
        ],
        properties: {
          name: {
            type: "string",
          },
          score: {
            type: "number",
            minimum: 0,
            maximum: 2.5,
          },
          maxScore: {
            type: "number",
          },
          comment: {
            type: "string",
          },
          evidence: {
            type: "string",
          },
          nextStep: {
            type: "string",
          },
        },
      },
    },

    strengths: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "string",
      },
    },

    weaknesses: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "string",
      },
    },

    paragraphFeedback: {
      type: "array",
      minItems: 5,
      maxItems: 6,
      items: {
        type: "object",
        required: [
          "section",
          "status",
          "statusLabel",
          "comment",
          "suggestion",
        ],
        properties: {
          section: {
            type: "string",
          },
          status: {
            type: "string",
            enum: [
              "good",
              "warning",
              "bad",
            ],
          },
          statusLabel: {
            type: "string",
          },
          comment: {
            type: "string",
          },
          suggestion: {
            type: "string",
          },
        },
      },
    },

    errors: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        required: [
          "type",
          "original",
          "correction",
          "explanation",
        ],
        properties: {
          type: {
            type: "string",
          },
          original: {
            type: "string",
          },
          correction: {
            type: "string",
          },
          explanation: {
            type: "string",
          },
        },
      },
    },

    addedIdeas: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: {
        type: "object",
        required: [
          "idea",
          "why",
          "insertionPoint",
          "sampleSentence",
        ],
        properties: {
          idea: {
            type: "string",
          },
          why: {
            type: "string",
          },
          insertionPoint: {
            type: "string",
          },
          sampleSentence: {
            type: "string",
          },
        },
      },
    },

    improvedOutline: {
      type: "array",
      minItems: 5,
      maxItems: 8,
      items: {
        type: "string",
      },
    },

    revisedPassage: {
      type: "string",
    },
  },
};

export default {
  /**
   * @param {Request} request
   * @param {{ GEMINI_API_KEY: string, GEMINI_MODEL?: string }} env
   */
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    /*
     * CORS PREFLIGHT
     *
     * Quan trọng:
     * Không trả Access-Control-Allow-Origin: null.
     * Chỉ trả đúng origin nếu origin nằm trong danh sách cho phép.
     */
    if (request.method === "OPTIONS") {
      if (!isOriginAllowed(origin)) {
        return new Response(null, {
          status: 403,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Vary": "Origin",
          },
        });
      }

      return new Response(null, {
        status: 204,
        headers: createCorsHeaders(origin, request),
      });
    }

    /*
     * HEALTH CHECK
     */
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
          geminiConfigured: Boolean(env.GEMINI_API_KEY),
          timestamp: new Date().toISOString(),
        },
        200,
        origin,
      );
    }

    /*
     * CHỈ CHẤP NHẬN POST /grade
     */
    if (url.pathname !== "/grade") {
      return jsonResponse(
        {
          error: "Không tìm thấy endpoint.",
        },
        404,
        origin,
      );
    }

    if (request.method !== "POST") {
      return jsonResponse(
        {
          error: "Endpoint /grade chỉ chấp nhận phương thức POST.",
        },
        405,
        origin,
      );
    }

    /*
     * KIỂM TRA ORIGIN
     */
    if (!isOriginAllowed(origin)) {
      return jsonResponseWithoutCors(
        {
          error: "Origin không được phép truy cập API.",
          receivedOrigin: origin || "Không có Origin",
        },
        403,
      );
    }

    /*
     * KIỂM TRA API KEY
     */
    if (!env.GEMINI_API_KEY) {
      return jsonResponse(
        {
          error:
            "Cloudflare Worker chưa được cấu hình GEMINI_API_KEY.",
        },
        500,
        origin,
      );
    }

    /*
     * KIỂM TRA CONTENT-TYPE
     */
    const contentType =
      request.headers.get("Content-Type") || "";

    if (!contentType.toLowerCase().includes("application/json")) {
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
      /*
       * ĐỌC JSON REQUEST
       */
      let body;

      try {
        body = await request.json();
      } catch {
        return jsonResponse(
          {
            error: "Dữ liệu gửi lên không phải JSON hợp lệ.",
          },
          400,
          origin,
        );
      }

      const studentAnswer = normalizeText(
        body?.studentAnswer,
      );

      const wordCount = countWords(studentAnswer);

      /*
       * KIỂM TRA BÀI LÀM
       */
      if (!studentAnswer) {
        return jsonResponse(
          {
            error: "Bài làm đang để trống.",
          },
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

      /*
       * GỌI GEMINI
       */
      const model =
        normalizeModelName(env.GEMINI_MODEL) ||
        "gemini-2.5-flash";

      const geminiResult = await callGemini({
        apiKey: env.GEMINI_API_KEY,
        model,
        studentAnswer,
        wordCount,
      });

      /*
       * KIỂM TRA JSON GEMINI
       */
      let parsedResult;

      try {
        parsedResult = JSON.parse(geminiResult);
      } catch (error) {
        console.error(
          "Gemini trả JSON không hợp lệ:",
          geminiResult,
        );

        return jsonResponse(
          {
            error:
              "Gemini trả về dữ liệu không đúng định dạng JSON.",
          },
          502,
          origin,
        );
      }

      /*
       * LÀM SẠCH VÀ TÍNH LẠI TỔNG ĐIỂM
       */
      const sanitizedResult = sanitizeResult(
        parsedResult,
        wordCount,
      );

      return jsonResponse(
        sanitizedResult,
        200,
        origin,
      );
    } catch (error) {
      console.error("Worker error:", error);

      if (error?.name === "AbortError") {
        return jsonResponse(
          {
            error:
              "Gemini xử lý quá lâu. Vui lòng thử lại.",
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
              : "Không thể xử lý yêu cầu chấm bài.",
        },
        500,
        origin,
      );
    }
  },
};

/**
 * Gọi Gemini API.
 */
async function callGemini({
  apiKey,
  model,
  studentAnswer,
  wordCount,
}) {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, GEMINI_TIMEOUT_MS);

  const apiUrl =
    `https://generativelanguage.googleapis.com/` +
    `v1beta/models/${encodeURIComponent(model)}` +
    `:generateContent`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },

      signal: controller.signal,

      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: buildSystemPrompt(),
            },
          ],
        },

        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildUserPrompt(
                  studentAnswer,
                  wordCount,
                ),
              },
            ],
          },
        ],

        generationConfig: {
          temperature: 0.15,
          topP: 0.85,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseJsonSchema: JSON_SCHEMA,
        },
      }),
    });

    const rawText = await response.text();

    let rawData;

    try {
      rawData = JSON.parse(rawText);
    } catch {
      rawData = {
        rawText,
      };
    }

    if (!response.ok) {
      console.error(
        "Gemini API error:",
        response.status,
        rawData,
      );

      const message =
        rawData?.error?.message ||
        `Gemini API trả về lỗi ${response.status}.`;

      if (response.status === 429) {
        throw new Error(
          "Gemini đã vượt giới hạn sử dụng. " +
            "Vui lòng chờ một lúc rồi thử lại.",
        );
      }

      if (
        response.status === 401 ||
        response.status === 403
      ) {
        throw new Error(
          "Gemini API key không hợp lệ hoặc chưa được cấp quyền.",
        );
      }

      if (response.status === 404) {
        throw new Error(
          `Không tìm thấy model "${model}". ` +
            "Hãy kiểm tra GEMINI_MODEL trong wrangler.toml.",
        );
      }

      throw new Error(message);
    }

    const finishReason =
      rawData?.candidates?.[0]?.finishReason || "";

    if (
      finishReason &&
      !["STOP", "MAX_TOKENS"].includes(finishReason)
    ) {
      console.warn(
        "Gemini finish reason:",
        finishReason,
      );
    }

    const responseText =
      rawData?.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text || "")
        .join("")
        .trim() || "";

    if (!responseText) {
      const blockReason =
        rawData?.promptFeedback?.blockReason;

      if (blockReason) {
        throw new Error(
          `Gemini từ chối xử lý nội dung: ${blockReason}.`,
        );
      }

      throw new Error(
        "Gemini không trả về nội dung chấm bài.",
      );
    }

    return removeMarkdownCodeFence(responseText);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Prompt hệ thống quy định cách chấm.
 */
function buildSystemPrompt() {
  const rubricText = CRITERIA.map(
    (criterion, index) =>
      `${index + 1}. ${criterion.name}: ` +
      `${criterion.maxScore} điểm`,
  ).join("\n");

  return `
Bạn là giảng viên chấm bài nghị luận xã hội và giáo viên hướng dẫn học sinh sửa bài.

MỤC TIÊU:
- Chấm bài khách quan theo khung lập luận đã quy định.
- Chỉ ra lỗi cụ thể trong bài.
- Sửa trực tiếp lỗi diễn đạt, chính tả, ngữ pháp và lập luận.
- Đề xuất ý còn thiếu để học sinh tự bổ sung.
- Không viết nhận xét chung chung.
- Không tự bịa nội dung học sinh chưa viết.

KHUNG BÀI NGHỊ LUẬN CẦN ĐÁNH GIÁ:

1. MỞ BÀI TRỰC DIỆN
- Có dẫn dắt phù hợp.
- Nêu đúng vấn đề nghị luận.
- Khẳng định ý nghĩa hoặc tầm quan trọng của vấn đề.
- Không mở bài quá dài hoặc xa chủ đề.

2. GIẢI THÍCH BẢN CHẤT
- Giải thích từ khóa hoặc khái niệm trung tâm.
- Làm rõ nội hàm của vấn đề.
- Trình bày ngắn gọn, rõ ràng.
- Không chỉ lặp lại đề bài.

3. PHÂN TÍCH VÀ CHỨNG MINH
- Phân tích biểu hiện, nguyên nhân, vai trò, ý nghĩa hoặc hậu quả.
- Các luận điểm phải logic và liên kết.
- Mỗi nhận định quan trọng cần có lý lẽ hoặc dẫn chứng.
- Dẫn chứng phải phù hợp và có liên hệ với luận điểm.
- Không được tự tạo sự kiện, con số, nhân vật hoặc trích dẫn không có căn cứ.

4. PHẢN ĐỀ VÀ MỞ RỘNG
- Xem xét mặt trái hoặc quan điểm đối lập.
- Phê phán hành vi lệch lạc, thờ ơ hoặc cực đoan khi phù hợp.
- Phân biệt đúng bản chất vấn đề.
- Tránh lập luận một chiều.

5. LIÊN HỆ VÀ KẾT BÀI
- Rút ra bài học nhận thức.
- Nêu hành động cụ thể của bản thân.
- Khi phù hợp, liên hệ trách nhiệm của thế hệ trẻ hoặc người chiến sĩ Công an tương lai.
- Kết bài phải khẳng định lại vấn đề và thể hiện quyết tâm.

NGUYÊN TẮC CHẤM:
- Chỉ chấm nội dung thực sự xuất hiện trong bài.
- Không suy diễn tư tưởng, nhân cách, phẩm chất hoặc lòng trung thành của học sinh.
- Không yêu cầu học sinh phải dùng câu chữ khẩu hiệu.
- Ưu tiên lập luận có căn cứ, phù hợp pháp luật, có trách nhiệm xã hội và không cực đoan.
- Không cộng điểm vì bài chỉ nhắc đến lực lượng Công an mà không có phân tích.
- Không trừ điểm chỉ vì học sinh dùng dẫn chứng phổ thông nếu dẫn chứng đó hợp lý.
- Phải chỉ rõ vì sao cộng hoặc trừ điểm.
- Điểm có thể cao nếu bài thực sự tốt.
- Không cố tình giữ điểm ở mức trung bình.

RUBRIC CỐ ĐỊNH, TỔNG 10 ĐIỂM:
${rubricText}

CÁCH XẾP LOẠI:
- Dưới 5,0: Chưa đạt
- Từ 5,0 đến dưới 6,5: Trung bình
- Từ 6,5 đến dưới 8,0: Khá
- Từ 8,0 đến dưới 9,0: Giỏi
- Từ 9,0 đến 10: Xuất sắc

YÊU CẦU CHO criteria:
- Phải có đúng 7 tiêu chí.
- Phải theo đúng thứ tự trong rubric.
- Tên tiêu chí phải giữ nguyên.
- Điểm không được vượt quá điểm tối đa.
- evidence phải là một đoạn ngắn có thật trong bài.
- Nếu bài không có dẫn chứng phù hợp thì evidence là chuỗi rỗng.
- nextStep phải hướng dẫn cụ thể cách nâng điểm.

YÊU CẦU CHO paragraphFeedback:
Đánh giá lần lượt:
1. Mở bài
2. Giải thích
3. Phân tích & chứng minh
4. Phản đề & mở rộng
5. Liên hệ & kết bài

Có thể thêm mục thứ 6 là "Bố cục toàn bài".

Giá trị status:
- good: đạt tốt
- warning: có nhưng chưa đầy đủ
- bad: thiếu hoặc có lỗi nghiêm trọng

YÊU CẦU PHÁT HIỆN VÀ SỬA LỖI:
- Chỉ ra tối đa 12 lỗi đáng sửa nhất.
- Không bịa lỗi.
- original phải chép đúng cụm từ hoặc câu trong bài.
- correction phải đưa ra bản sửa hoàn chỉnh.
- explanation phải giải thích lỗi cụ thể.
- Có thể phát hiện:
  + chính tả;
  + dùng từ;
  + ngữ pháp;
  + câu quá dài;
  + câu tối nghĩa;
  + lặp từ;
  + lặp ý;
  + chuyển đoạn yếu;
  + mâu thuẫn trong lập luận;
  + dẫn chứng không gắn với luận điểm;
  + khẳng định thiếu căn cứ.

YÊU CẦU BỔ SUNG Ý:
- Đề xuất từ 2 đến 6 ý.
- Các ý phải sát với chủ đề học sinh đang viết.
- Không bịa số liệu, sự kiện hoặc nhân vật.
- insertionPoint phải nói rõ nên thêm ở phần nào.
- sampleSentence chỉ là câu gợi ý để học sinh tự phát triển.
- Không viết thay toàn bộ bài.

YÊU CẦU DÀN Ý:
- improvedOutline có từ 5 đến 8 ý.
- Dàn ý phải bám sát bài hiện tại.
- Tập trung sửa những phần còn yếu hoặc bị thiếu.

YÊU CẦU revisedPassage:
- Chỉ viết lại từ 1 đến 3 đoạn yếu nhất.
- Dài khoảng 180 đến 300 chữ.
- Giữ chủ đề và quan điểm chính của học sinh.
- Làm rõ lập luận, sửa lỗi và thêm ý cần thiết.
- Không viết lại toàn bộ bài.
- Không đưa thông tin thực tế chưa được kiểm chứng.

Chỉ trả về JSON hợp lệ theo schema.
Không dùng Markdown.
Không đặt JSON trong dấu ba dấu nháy.
`.trim();
}

/**
 * Prompt chứa bài làm.
 */
function buildUserPrompt(
  studentAnswer,
  wordCount,
) {
  return `
Hãy chấm và sửa bài nghị luận xã hội sau đây.

SỐ CHỮ DO HỆ THỐNG ĐẾM:
${wordCount} chữ

BÀI LÀM:
--------------------
${studentAnswer}
--------------------

NHIỆM VỤ BẮT BUỘC:

1. Xác định vấn đề trung tâm mà học sinh đang nghị luận.

2. Chấm đủ 7 tiêu chí theo rubric cố định.

3. Trích dẫn bằng chứng ngắn từ bài cho từng tiêu chí khi có.

4. Chỉ ra những phần còn thiếu hoặc còn nông theo khung:
- Mở bài
- Giải thích
- Phân tích và chứng minh
- Phản đề và mở rộng
- Liên hệ và kết bài

5. Phát hiện lỗi:
- chính tả;
- dùng từ;
- ngữ pháp;
- câu dài;
- câu tối nghĩa;
- lặp ý;
- liên kết;
- lập luận;
- dẫn chứng.

6. Với mỗi lỗi:
- chép đúng câu hoặc cụm từ gốc;
- đưa cách sửa;
- giải thích vì sao cần sửa.

7. Đề xuất ý còn thiếu:
- nêu ý cần thêm;
- giải thích tác dụng;
- chỉ rõ vị trí nên thêm;
- cung cấp một câu mẫu.

8. Tạo dàn ý nâng điểm dựa trên chính bài hiện tại.

9. Viết lại từ 1 đến 3 đoạn yếu nhất để minh họa cách sửa.

10. Không bịa chi tiết mà học sinh không viết.
`.trim();
}

/**
 * Chuẩn hóa kết quả.
 * Worker tự tính lại tổng điểm thay vì tin totalScore từ AI.
 */
function sanitizeResult(result, wordCount) {
  const receivedCriteria = Array.isArray(
    result?.criteria,
  )
    ? result.criteria
    : [];

  const criteria = CRITERIA.map(
    (expected, index) => {
      const received =
        receivedCriteria[index] || {};

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
          received.comment ||
            "Chưa có nhận xét.",
          1800,
        ),

        evidence: limitString(
          received.evidence || "",
          500,
        ),

        nextStep: limitString(
          received.nextStep || "",
          1200,
        ),
      };
    },
  );

  const totalScore = roundToTenth(
    criteria.reduce(
      (sum, criterion) =>
        sum + criterion.score,
      0,
    ),
  );

  return {
    totalScore,
    wordCount,
    level: levelFromScore(totalScore),

    overallComment: limitString(
      result?.overallComment ||
        "AI chưa cung cấp nhận xét tổng quát.",
      2500,
    ),

    criteria,

    strengths: sanitizeStringArray(
      result?.strengths,
      8,
    ),

    weaknesses: sanitizeStringArray(
      result?.weaknesses,
      8,
    ),

    paragraphFeedback:
      sanitizeParagraphFeedback(
        result?.paragraphFeedback,
      ),

    errors: sanitizeErrors(result?.errors),

    addedIdeas: sanitizeAddedIdeas(
      result?.addedIdeas,
    ),

    improvedOutline: sanitizeStringArray(
      result?.improvedOutline,
      8,
    ),

    revisedPassage: limitString(
      result?.revisedPassage || "",
      7000,
    ),
  };
}

function sanitizeParagraphFeedback(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 6).map((item) => {
    const allowedStatuses = [
      "good",
      "warning",
      "bad",
    ];

    const status = allowedStatuses.includes(
      item?.status,
    )
      ? item.status
      : "warning";

    return {
      section: limitString(
        item?.section || "Phần bài viết",
        150,
      ),

      status,

      statusLabel: limitString(
        item?.statusLabel ||
          statusLabelFromStatus(status),
        100,
      ),

      comment: limitString(
        item?.comment || "",
        1500,
      ),

      suggestion: limitString(
        item?.suggestion || "",
        1500,
      ),
    };
  });
}

function sanitizeErrors(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 12).map((item) => ({
    type: limitString(
      item?.type || "Diễn đạt",
      120,
    ),

    original: limitString(
      item?.original || "",
      800,
    ),

    correction: limitString(
      item?.correction || "",
      1200,
    ),

    explanation: limitString(
      item?.explanation || "",
      1200,
    ),
  }));
}

function sanitizeAddedIdeas(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 6).map((item) => ({
    idea: limitString(
      item?.idea || "",
      800,
    ),

    why: limitString(
      item?.why || "",
      1200,
    ),

    insertionPoint: limitString(
      item?.insertionPoint || "",
      500,
    ),

    sampleSentence: limitString(
      item?.sampleSentence || "",
      1600,
    ),
  }));
}

/**
 * CORS
 */
function isOriginAllowed(origin) {
  return ALLOWED_ORIGINS.includes(origin);
}

function createCorsHeaders(origin, request) {
  const requestedHeaders =
    request?.headers?.get(
      "Access-Control-Request-Headers",
    ) || "Content-Type";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      requestedHeaders,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

/**
 * JSON response có CORS.
 */
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

    "X-Content-Type-Options": "nosniff",

    "Vary": "Origin",
  };

  if (isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] =
      origin;

    headers["Access-Control-Allow-Methods"] =
      "GET, POST, OPTIONS";

    headers["Access-Control-Allow-Headers"] =
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
 * JSON response không có CORS.
 * Dùng khi origin bị từ chối.
 */
function jsonResponseWithoutCors(
  data,
  status,
) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control": "no-store",

        "X-Content-Type-Options":
          "nosniff",

        "Vary": "Origin",
      },
    },
  );
}

/**
 * Tiện ích.
 */
function normalizeText(value) {
  return String(value || "")
    .replace(
      /[\u200B-\u200D\uFEFF]/g,
      "",
    )
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

function normalizeModelName(value) {
  return String(value || "")
    .replace(/^models\//, "")
    .trim();
}

function sanitizeStringArray(
  value,
  maxItems,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, maxItems)
    .map((item) =>
      limitString(item, 1200),
    )
    .filter(Boolean);
}

function levelFromScore(score) {
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

function statusLabelFromStatus(status) {
  switch (status) {
    case "good":
      return "Đạt tốt";

    case "bad":
      return "Cần sửa";

    default:
      return "Chưa đầy đủ";
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(
    max,
    Math.max(min, value),
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

function removeMarkdownCodeFence(text) {
  return String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}