const ALLOWED_ORIGINS = [
  "https://huyhoang2001.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

const NVIDIA_API_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const DEFAULT_MODELS = [
  "meta/llama-3.3-70b-instruct",
];

const MIN_WORDS = 500;
const MAX_CHARS = 30000;
const MODEL_TIMEOUT_MS = 55000;
const RETRIES_PER_MODEL = 2;
const MAX_OUTPUT_TOKENS = 4200;

const RUBRIC = [
  {
    name: "Mở bài và xác định vấn đề",
    maxScore: 1.0,
  },
  {
    name: "Giải thích bản chất vấn đề",
    maxScore: 1.0,
  },
  {
    name: "Phân tích và lập luận",
    maxScore: 2.5,
  },
  {
    name: "Dẫn chứng và chứng minh",
    maxScore: 1.5,
  },
  {
    name: "Phản đề và mở rộng",
    maxScore: 1.0,
  },
  {
    name: "Liên hệ bản thân và trách nhiệm",
    maxScore: 1.5,
  },
  {
    name: "Diễn đạt, chính tả và liên kết",
    maxScore: 1.5,
  },
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
          provider: "NVIDIA NIM",
          nvidiaConfigured: Boolean(env.NVIDIA_API_KEY),
          models: getNvidiaModels(env),
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

    if (!env.NVIDIA_API_KEY) {
      return jsonResponse(
        {
          error:
            "Cloudflare Worker chưa được cấu hình NVIDIA_API_KEY.",
        },
        500,
        origin,
      );
    }

    const contentType = request.headers.get("Content-Type") || "";

    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse(
        {
          error: "Content-Type phải là application/json.",
        },
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
          {
            error: "Dữ liệu gửi lên không phải JSON hợp lệ.",
          },
          400,
          origin,
        );
      }

      const studentAnswer = normalizeText(body?.studentAnswer);
      const wordCount = countWords(studentAnswer);

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

      const models = getNvidiaModels(env);

      const aiResponse = await callNvidiaWithFallback({
        apiKey: env.NVIDIA_API_KEY,
        models,
        studentAnswer,
        wordCount,
      });

      let parsedResult;

      try {
        parsedResult = JSON.parse(aiResponse.text);
      } catch {
        console.error(
          "NVIDIA trả JSON không hợp lệ:",
          aiResponse.text,
        );

        return jsonResponse(
          {
            error:
              "AI trả về dữ liệu không đúng định dạng JSON. " +
              "Vui lòng thử lại.",
          },
          502,
          origin,
        );
      }

      const sanitizedResult = sanitizeResult(
        parsedResult,
        wordCount,
      );

      return jsonResponse(
        {
          ...sanitizedResult,
          provider: "NVIDIA NIM",
          model: aiResponse.model,
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

function getNvidiaModels(env) {
  const configured = String(env.NVIDIA_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return configured.length > 0
    ? [...new Set(configured)]
    : DEFAULT_MODELS;
}

async function callNvidiaWithFallback({
  apiKey,
  models,
  studentAnswer,
  wordCount,
}) {
  const failures = [];

  for (const model of models) {
    for (
      let attempt = 1;
      attempt <= RETRIES_PER_MODEL;
      attempt += 1
    ) {
      try {
        console.log(
          `Calling NVIDIA model ${model}, attempt ${attempt}/${RETRIES_PER_MODEL}`,
        );

        const text = await callSingleNvidiaModel({
          apiKey,
          model,
          studentAnswer,
          wordCount,
        });

        console.log(`NVIDIA model succeeded: ${model}`);

        return {
          text,
          model,
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
          `NVIDIA model failed: ${model}`,
          failure.status,
          failure.message,
        );

        if (failure.status === 401) {
          throw new Error(
            "NVIDIA_API_KEY không hợp lệ hoặc đã hết hiệu lực.",
          );
        }

        if (
          failure.status === 400 ||
          failure.status === 403 ||
          failure.status === 404
        ) {
          break;
        }

        const retryable =
          failure.status === 0 ||
          failure.status === 408 ||
          failure.status === 429 ||
          failure.status === 500 ||
          failure.status === 502 ||
          failure.status === 503 ||
          failure.status === 504;

        if (
          !retryable ||
          attempt === RETRIES_PER_MODEL
        ) {
          break;
        }

        const waitMs =
          1200 * 2 ** (attempt - 1) +
          Math.floor(Math.random() * 700);

        console.warn(
          `Retrying ${model} after ${waitMs} ms`,
        );

        await sleep(waitMs);
      }
    }

    console.warn(
      `Switching to next NVIDIA model after failure: ${model}`,
    );
  }

  console.error(
    "All NVIDIA models failed:",
    failures,
  );

  const summary = failures
    .map(
      (item) =>
        `${item.model} (HTTP ${item.status || "?"}): ${item.message}`,
    )
    .join(" | ");

  throw new Error(
    "Các model AI hiện đều đang bận hoặc không khả dụng. " +
      summary,
  );
}

async function callSingleNvidiaModel({
  apiKey,
  model,
  studentAnswer,
  wordCount,
}) {
  const controller = new AbortController();

  const timeoutId = setTimeout(
    () => controller.abort(),
    MODEL_TIMEOUT_MS,
  );

  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(),
          },
          {
            role: "user",
            content: buildUserPrompt(
              studentAnswer,
              wordCount,
            ),
          },
        ],
        temperature: 0.15,
        top_p: 0.85,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: false,
      }),
    });

    const rawText = await response.text();

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      data = {
        rawText,
      };
    }

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.detail ||
        data?.message ||
        data?.rawText ||
        `HTTP ${response.status}`;

      throw createProviderError(
        response.status,
        String(message),
      );
    }

    const content =
      data?.choices?.[0]?.message?.content;

    const generatedText = Array.isArray(content)
      ? content
          .map((part) =>
            typeof part === "string"
              ? part
              : part?.text || part?.content || "",
          )
          .join("")
          .trim()
      : String(content || "").trim();

    if (!generatedText) {
      throw createProviderError(
        502,
        `Model ${model} không trả về nội dung.`,
      );
    }

    return extractJsonObject(generatedText);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createProviderError(
        408,
        `Model ${model} xử lý quá ${MODEL_TIMEOUT_MS / 1000} giây.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
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

KHUNG LẬP LUẬN 5 BƯỚC BẮT BUỘC PHẢI ĐÁNH GIÁ:

1. MỞ BÀI TRỰC DIỆN
- Dẫn dắt từ bối cảnh thời đại hoặc thực tiễn phù hợp.
- Nêu đúng và rõ vấn đề nghị luận.
- Khẳng định tầm quan trọng của vấn đề đối với xã hội, đất nước hoặc lực lượng.
- Có thể dùng châm ngôn hoặc trích dẫn chính thống khi phù hợp, nhưng không bắt buộc.
- Tránh mở bài dài dòng, sáo rỗng hoặc xa chủ đề.

2. GIẢI THÍCH BẢN CHẤT
- Giải thích từ khóa trung tâm.
- Làm rõ nghĩa trực tiếp, nghĩa hàm ẩn hoặc bản chất của câu nói/hiện tượng.
- Giải thích ngắn gọn, súc tích, tránh lan man.
- Không chỉ lặp lại đề bài bằng từ ngữ khác.

3. PHÂN TÍCH VÀ CHỨNG MINH
- Phân tích biểu hiện, nguyên nhân, vai trò, ý nghĩa, tác động hoặc hậu quả.
- Có hệ thống luận điểm rõ ràng.
- Mỗi luận điểm phải có lý lẽ.
- Dẫn chứng phải có thật, phù hợp và gắn trực tiếp với luận điểm.
- Ưu tiên dẫn chứng có chiều sâu lịch sử, xã hội, quốc gia, quốc tế hoặc liên quan nhiệm vụ bảo vệ an ninh, trật tự khi phù hợp.
- Không bắt buộc phải dùng dẫn chứng ngành Công an; dẫn chứng phổ thông vẫn được chấp nhận nếu chính xác và được phân tích tốt.
- Không cộng điểm cho việc liệt kê dẫn chứng mà không phân tích.

4. PHẢN ĐỀ VÀ MỞ RỘNG
- Nhìn nhận vấn đề từ góc độ ngược lại.
- Chỉ ra biểu hiện lệch lạc, thờ ơ, cực đoan, phiến diện hoặc lợi dụng vấn đề khi phù hợp.
- Phân biệt bản chất đúng với biểu hiện sai.
- Thể hiện tư duy biện chứng, không quy chụp.
- Tránh phản đề hình thức chỉ có một câu phê phán chung chung.

5. LIÊN HỆ VÀ KẾT BÀI
- Rút ra bài học nhận thức.
- Nêu hành động cụ thể của bản thân.
- Có thể liên hệ theo ba lớp:
  a) Trách nhiệm của thế hệ trẻ đối với đất nước.
  b) Trách nhiệm của người chiến sĩ Công an tương lai khi phù hợp.
  c) Việc làm thực tế ngay hôm nay: học tập, rèn luyện đạo đức, kỷ luật, chấp hành pháp luật, nâng cao tri thức và tinh thần phục vụ nhân dân.
- Kết bài khẳng định lại giá trị của vấn đề và thể hiện quyết tâm.
- Không bắt buộc dùng công thức liên hệ cứng nhắc nếu đề không phù hợp.

PHÂN LOẠI DẠNG ĐỀ:
- Dạng tư tưởng, đạo lý: tập trung phẩm chất, trách nhiệm, hy sinh, dũng cảm, kỷ luật, ý chí, lòng yêu nước, tinh thần phục vụ.
- Dạng hiện tượng đời sống: tập trung xu hướng, vấn đề thời sự, không gian mạng, tội phạm công nghệ, lối sống thực dụng, thiên tai, đoàn kết quốc gia hoặc vấn đề xã hội.
- Hãy xác định đúng dạng đề dựa trên bài viết, không được tự đặt đề mới.

YÊU CẦU ĐẶC THÙ ĐỐI VỚI BÀI VB2 CÔNG AN:
- Đánh giá tính logic, tinh thần trách nhiệm, ý thức pháp luật, thái độ phục vụ nhân dân và khả năng liên hệ thực tiễn.
- Không được tự kết luận học sinh có hay không có lòng trung thành.
- Không bắt buộc học sinh phải nhắc đến Đảng, Nhà nước hoặc lực lượng Công an trong mọi đề.
- Khi học sinh có liên hệ ngành Công an, phải đánh giá xem liên hệ có tự nhiên, cụ thể và gắn với vấn đề hay chỉ mang tính khẩu hiệu.
- Mọi nhận xét về chính trị, pháp luật và nghiệp vụ phải giữ tính khách quan, đúng mực, không cực đoan.

RUBRIC CỐ ĐỊNH, TỔNG 10 ĐIỂM:
${rubricText}

CÁCH XẾP LOẠI:
- Dưới 5,0: Chưa đạt
- Từ 5,0 đến dưới 6,5: Trung bình
- Từ 6,5 đến dưới 8,0: Khá
- Từ 8,0 đến dưới 9,0: Giỏi
- Từ 9,0 đến 10: Xuất sắc

QUY TẮC CHẤM:
- Có đúng 7 tiêu chí và đúng thứ tự rubric.
- Điểm không vượt điểm tối đa.
- evidence phải là câu hoặc cụm từ thực sự có trong bài.
- Nếu không có bằng chứng, để evidence là chuỗi rỗng.
- nextStep phải hướng dẫn cụ thể cách nâng điểm.
- Tổng điểm cuối cùng do hệ thống tính lại từ 7 tiêu chí.
- Không tự cho điểm độ dài; bài dưới 500 chữ đã bị hệ thống chặn trước khi chấm.

YÊU CẦU ĐÁNH GIÁ DẪN CHỨNG:
- Xác định từng dẫn chứng quan trọng.
- Đánh giá độ chính xác, mức độ phù hợp và cách phân tích.
- Không xác nhận một sự kiện là đúng nếu không đủ căn cứ từ bài.
- Nếu dẫn chứng có vẻ mơ hồ, hãy ghi "cần kiểm chứng" thay vì khẳng định sai.
- Không hạ thấp dẫn chứng phổ thông chỉ vì quen thuộc.
- Chỉ đánh giá dẫn chứng cao khi nó được giải thích rõ và phục vụ trực tiếp cho luận điểm.

YÊU CẦU paragraphFeedback:
Đánh giá lần lượt:
1. Mở bài
2. Giải thích
3. Phân tích và chứng minh
4. Phản đề và mở rộng
5. Liên hệ và kết bài
6. Bố cục và liên kết toàn bài

status chỉ nhận:
- good
- warning
- bad

YÊU CẦU PHÁT HIỆN VÀ SỬA LỖI:
- Tối đa 12 lỗi đáng sửa nhất.
- Không bịa lỗi.
- original phải chép đúng câu hoặc cụm từ trong bài.
- correction phải là câu sửa hoàn chỉnh.
- explanation phải giải thích cụ thể.
- Có thể phát hiện:
  + chính tả;
  + dùng từ;
  + ngữ pháp;
  + câu quá dài;
  + câu tối nghĩa;
  + lặp từ;
  + lặp ý;
  + chuyển đoạn yếu;
  + lập luận nhảy cóc;
  + mâu thuẫn;
  + dẫn chứng không gắn luận điểm;
  + khẳng định thiếu căn cứ;
  + khẩu hiệu hóa;
  + liên hệ bản thân quá chung chung.

YÊU CẦU BỔ SUNG Ý:
- Đề xuất từ 2 đến 6 ý sát chủ đề.
- Không bịa số liệu hoặc sự kiện.
- insertionPoint phải nói rõ nên thêm vào phần nào.
- sampleSentence chỉ là câu mẫu gợi ý để học sinh tự phát triển.

YÊU CẦU DÀN Ý:
- improvedOutline có từ 5 đến 8 ý.
- Bám sát bài hiện tại.
- Tập trung sửa phần còn yếu hoặc thiếu.
- Không thay đổi hoàn toàn quan điểm của học sinh.

YÊU CẦU revisedPassage:
- Chỉ viết lại từ 1 đến 3 đoạn yếu nhất.
- Dài khoảng 180 đến 300 chữ.
- Giữ chủ đề và quan điểm chính.
- Sửa lỗi, tăng tính logic và bổ sung ý còn thiếu.
- Không viết lại toàn bộ bài.
- Không đưa thông tin thực tế chưa được kiểm chứng.

CHỈ TRẢ VỀ MỘT ĐỐI TƯỢNG JSON HỢP LỆ.
KHÔNG DÙNG MARKDOWN.
KHÔNG ĐẶT JSON TRONG DẤU BA DẤU NHÁY.
KHÔNG VIẾT BẤT KỲ NỘI DUNG NÀO TRƯỚC HOẶC SAU JSON.

JSON PHẢI CÓ CẤU TRÚC:
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

function buildUserPrompt(
  studentAnswer,
  wordCount,
) {
  return `
Hãy chấm, phát hiện lỗi và hướng dẫn sửa bài nghị luận xã hội dưới đây.

SỐ CHỮ DO HỆ THỐNG ĐẾM:
${wordCount} chữ

BÀI LÀM:
--------------------
${studentAnswer}
--------------------

NHIỆM VỤ BẮT BUỘC:

1. Xác định bài thuộc dạng:
- tư tưởng, đạo lý; hoặc
- hiện tượng đời sống.

2. Xác định vấn đề trung tâm học sinh đang nghị luận.

3. Chấm đủ 7 tiêu chí theo rubric cố định.

4. Với mỗi tiêu chí:
- cho điểm;
- nhận xét cụ thể;
- trích dẫn bằng chứng ngắn từ bài khi có;
- nêu cách nâng điểm.

5. Đánh giá đủ khung 5 bước:
- mở bài trực diện;
- giải thích bản chất;
- phân tích và chứng minh;
- phản đề và mở rộng;
- liên hệ và kết bài.

6. Đánh giá riêng các dẫn chứng quan trọng:
- mức độ phù hợp;
- độ chính xác hoặc lưu ý cần kiểm chứng;
- chất lượng phân tích;
- cách cải thiện.

7. Phát hiện lỗi:
- chính tả;
- dùng từ;
- ngữ pháp;
- câu dài;
- câu tối nghĩa;
- lặp từ;
- lặp ý;
- liên kết;
- lập luận;
- dẫn chứng;
- khẩu hiệu hóa;
- liên hệ chung chung.

8. Với mỗi lỗi:
- chép đúng câu hoặc cụm từ gốc;
- đưa câu sửa;
- giải thích lý do.

9. Đề xuất các ý còn thiếu:
- ý cần thêm;
- tác dụng;
- vị trí chèn;
- một câu mẫu.

10. Tạo dàn ý nâng điểm dựa trên chính bài hiện tại.

11. Viết lại từ 1 đến 3 đoạn yếu nhất.

12. Không bịa chi tiết mà học sinh chưa viết.
`.trim();
}

function sanitizeResult(result, wordCount) {
  const receivedCriteria = Array.isArray(
    result?.criteria,
  )
    ? result.criteria
    : [];

  const criteria = RUBRIC.map(
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
          600,
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
      (sum, item) => sum + item.score,
      0,
    ),
  );

  return {
    essayType: limitString(
      result?.essayType || "",
      120,
    ),
    centralIssue: limitString(
      result?.centralIssue || "",
      800,
    ),
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
    evidenceReview:
      sanitizeEvidenceReview(
        result?.evidenceReview,
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
    const allowed = ["good", "warning", "bad"];

    const status = allowed.includes(item?.status)
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

function sanitizeEvidenceReview(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 8).map((item) => ({
    evidence: limitString(
      item?.evidence || "",
      700,
    ),
    relevance: limitString(
      item?.relevance || "",
      700,
    ),
    accuracyNote: limitString(
      item?.accuracyNote || "",
      700,
    ),
    analysisQuality: limitString(
      item?.analysisQuality || "",
      900,
    ),
    improvement: limitString(
      item?.improvement || "",
      900,
    ),
  }));
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
      1000,
    ),
    correction: limitString(
      item?.correction || "",
      1500,
    ),
    explanation: limitString(
      item?.explanation || "",
      1500,
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
      1000,
    ),
    why: limitString(
      item?.why || "",
      1500,
    ),
    insertionPoint: limitString(
      item?.insertionPoint || "",
      700,
    ),
    sampleSentence: limitString(
      item?.sampleSentence || "",
      1800,
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
    Vary: "Origin",
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
        Vary: "Origin",
      },
    },
  );
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
    // Continue searching for a JSON object.
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

  for (
    let index = start;
    index < cleaned.length;
    index += 1
  ) {
    const character = cleaned[index];

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

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms),
  );
}

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
  if (status === "good") {
    return "Đạt tốt";
  }

  if (status === "bad") {
    return "Cần sửa";
  }

  return "Chưa đầy đủ";
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
