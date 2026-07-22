const ALLOWED_ORIGINS = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://github.com/huyhoang2001/quizz_example.github.io",
];

const MIN_WORDS = 500;
const MAX_CHARS = 30000;

const CRITERIA = [
  { name: "Cấu trúc 5 bước", maxScore: 2.0 },
  { name: "Giải thích, phân tích và lập luận", maxScore: 2.5 },
  { name: "Dẫn chứng thực tiễn", maxScore: 1.5 },
  { name: "Phản đề và mở rộng", maxScore: 1.0 },
  { name: "Định hướng chính trị - nghiệp vụ", maxScore: 1.0 },
  { name: "Liên hệ bản thân và hành động", maxScore: 1.0 },
  { name: "Diễn đạt, chính tả và liên kết", maxScore: 1.0 },
];

const JSON_SCHEMA = {
  type: "object",
  required: [
    "totalScore", "wordCount", "level", "overallComment", "criteria",
    "strengths", "weaknesses", "paragraphFeedback", "errors",
    "addedIdeas", "improvedOutline", "revisedPassage"
  ],
  properties: {
    totalScore: { type: "number" },
    wordCount: { type: "integer" },
    level: { type: "string", enum: ["Chưa đạt", "Trung bình", "Khá", "Giỏi", "Xuất sắc"] },
    overallComment: { type: "string" },
    criteria: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: {
        type: "object",
        required: ["name", "score", "maxScore", "comment", "evidence", "nextStep"],
        properties: {
          name: { type: "string" },
          score: { type: "number" },
          maxScore: { type: "number" },
          comment: { type: "string" },
          evidence: { type: "string" },
          nextStep: { type: "string" },
        },
      },
    },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    paragraphFeedback: {
      type: "array",
      minItems: 5,
      maxItems: 6,
      items: {
        type: "object",
        required: ["section", "status", "statusLabel", "comment", "suggestion"],
        properties: {
          section: { type: "string" },
          status: { type: "string", enum: ["good", "warning", "missing"] },
          statusLabel: { type: "string" },
          comment: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
    errors: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        required: ["type", "original", "correction", "explanation"],
        properties: {
          type: { type: "string" },
          original: { type: "string" },
          correction: { type: "string" },
          explanation: { type: "string" },
        },
      },
    },
    addedIdeas: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: {
        type: "object",
        required: ["idea", "why", "insertionPoint", "sampleSentence"],
        properties: {
          idea: { type: "string" },
          why: { type: "string" },
          insertionPoint: { type: "string" },
          sampleSentence: { type: "string" },
        },
      },
    },
    improvedOutline: { type: "array", minItems: 5, maxItems: 8, items: { type: "string" } },
    revisedPassage: { type: "string" },
  },
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true }, 200, cors);
    if (url.pathname !== "/grade" || request.method !== "POST") return json({ error: "Not found" }, 404, cors);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "Origin không được phép." }, 403, cors);
    if (!env.GEMINI_API_KEY) return json({ error: "Server chưa cấu hình GEMINI_API_KEY." }, 500, cors);

    try {
      const body = await request.json();
      const studentAnswer = normalizeText(body?.studentAnswer);
      const wordCount = countWords(studentAnswer);

      if (wordCount < MIN_WORDS) {
        return json({ error: `Bài làm cần tối thiểu ${MIN_WORDS} chữ; hiện có ${wordCount} chữ.` }, 400, cors);
      }
      if (studentAnswer.length > MAX_CHARS) {
        return json({ error: `Bài làm vượt quá ${MAX_CHARS.toLocaleString("vi-VN")} ký tự.` }, 400, cors);
      }

      const model = env.GEMINI_MODEL || "gemini-2.5-flash";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const geminiResponse = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
          contents: [{ role: "user", parts: [{ text: buildUserPrompt(studentAnswer, wordCount) }] }],
          generationConfig: {
            temperature: 0.12,
            responseMimeType: "application/json",
            responseJsonSchema: JSON_SCHEMA,
          },
        }),
      });

      const raw = await geminiResponse.json();
      if (!geminiResponse.ok) {
        console.error("Gemini error", raw);
        return json({ error: raw?.error?.message || "Gemini API báo lỗi." }, geminiResponse.status, cors);
      }

      const text = raw?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
      if (!text) return json({ error: "Gemini không trả về nội dung." }, 502, cors);

      const result = JSON.parse(text);
      const sanitized = sanitizeResult(result, wordCount);
      return json(sanitized, 200, cors);
    } catch (error) {
      console.error(error);
      return json({ error: "Không thể xử lý yêu cầu chấm bài." }, 500, cors);
    }
  },
};

function buildSystemPrompt() {
  const rubricText = CRITERIA.map((item) => `- ${item.name}: ${item.maxScore} điểm`).join("\n");
  return `Bạn là giám khảo và giáo viên luyện viết nghị luận xã hội dành cho kỳ thi Văn bằng 2 lực lượng Công an nhân dân.

BẠN PHẢI CHẤM DỰA TRÊN KHUNG TÀI LIỆU SAU, KHÔNG CHẤM THEO CẢM TÍNH:
1. Mở bài trực diện: dẫn dắt từ bối cảnh thời đại, nêu vấn đề nghị luận, khẳng định tầm quan trọng đối với xã hội hoặc lực lượng. Có thể dùng châm ngôn hoặc trích dẫn phù hợp nhưng không bắt buộc.
2. Giải thích bản chất: định nghĩa từ khóa, làm rõ nghĩa tường minh và hàm ý; ngắn gọn, súc tích, tránh lan man.
3. Phân tích và chứng minh: làm rõ nguyên nhân, biểu hiện, vai trò, hệ quả, mặt đúng/sai; lập luận logic; sử dụng dẫn chứng thực tiễn có thật và phù hợp. Ưu tiên dẫn chứng lịch sử, lực lượng vũ trang, chiến sĩ Công an, phòng cháy chữa cháy, phòng chống tội phạm, gìn giữ hòa bình, phục vụ nhân dân trong thiên tai và dịch bệnh. Không tự động trừ điểm chỉ vì học sinh dùng dẫn chứng phổ thông, nhưng phải nhận xét mức độ phù hợp và sức thuyết phục.
4. Phản đề và mở rộng: xem xét góc độ ngược lại, phê phán biểu hiện lệch lạc, tránh tư duy phiến diện; thể hiện khả năng biện chứng.
5. Liên hệ và kết bài: rút ra bài học nhận thức và hành động; liên hệ theo ba lớp khi phù hợp: thế hệ trẻ quốc gia, người chiến sĩ Công an tương lai, hành động thực tế ngay hôm nay; kết luận khẳng định ý chí, trách nhiệm và quyết tâm.

YÊU CẦU ĐẶC THÙ:
- Đánh giá tính logic, trách nhiệm xã hội, nhận thức pháp luật, tinh thần phụng sự nhân dân và định hướng nghề nghiệp Công an khi bài viết thực sự đề cập.
- Không suy diễn quan điểm mà học sinh không viết.
- Không đánh giá hay quy kết lòng trung thành, phẩm chất chính trị hoặc nhân cách của học sinh. Chỉ nhận xét nội dung thể hiện trên văn bản.
- Không yêu cầu câu chữ khẩu hiệu. Ưu tiên lập luận có căn cứ, đúng pháp luật, không cực đoan và không phiến diện.
- Mọi dẫn chứng trích từ bài phải là đoạn ngắn có thật trong bài. Nếu không có dẫn chứng phù hợp, để evidence là chuỗi rỗng.
- Chỉ ra tối đa 12 lỗi đáng sửa nhất. Không bịa lỗi. Với mỗi lỗi, chép đúng cụm/câu gốc, đưa bản sửa và giải thích cụ thể.
- Đề xuất 2-6 ý bổ sung sát chủ đề được suy ra từ chính bài viết. Không bịa số liệu, sự kiện hoặc tên nhân vật. Câu mẫu phải là gợi ý diễn đạt, không phải thông tin chưa được kiểm chứng.
- revisedPassage chỉ viết lại 1-3 đoạn yếu nhất, khoảng 180-300 chữ; không viết lại toàn bộ bài.
- Điểm phải có thể đạt cao nếu bài thực sự tốt; không cố tình ép điểm thấp.

RUBRIC CỐ ĐỊNH, TỔNG 10 ĐIỂM:
${rubricText}

CÁCH XẾP LOẠI:
- dưới 5.0: Chưa đạt
- 5.0 đến dưới 6.5: Trung bình
- 6.5 đến dưới 8.0: Khá
- 8.0 đến dưới 9.0: Giỏi
- từ 9.0: Xuất sắc

criteria phải có đúng 7 mục, đúng tên và đúng điểm tối đa theo rubric. paragraphFeedback phải lần lượt đánh giá: Mở bài; Giải thích; Phân tích & chứng minh; Phản đề & mở rộng; Liên hệ & kết bài. Có thể thêm mục Bố cục toàn bài. Chỉ trả về JSON đúng schema.`;
}

function buildUserPrompt(studentAnswer, wordCount) {
  return `Hãy chấm bài nghị luận xã hội dưới đây theo rubric cố định.

SỐ CHỮ DO HỆ THỐNG ĐẾM: ${wordCount}

BÀI LÀM:
---
${studentAnswer}
---

Nhiệm vụ bắt buộc:
1. Xác định vấn đề trung tâm mà bài đang nghị luận.
2. Chấm đủ 7 tiêu chí, tổng điểm chính xác trên 10.
3. Nêu bằng chứng ngắn từ bài cho từng tiêu chí khi có.
4. Chỉ ra phần còn thiếu hoặc còn nông theo khung 5 bước.
5. Tìm lỗi dùng từ, chính tả, ngữ pháp, câu dài, lặp ý, liên kết hoặc lập luận; sửa trực tiếp từng lỗi.
6. Đề xuất các ý nên thêm, vị trí thêm và một câu mẫu để học sinh tự phát triển.
7. Đưa dàn ý nâng điểm bám sát nội dung bài hiện tại.
8. Viết lại 1-3 đoạn yếu nhất để minh họa cách sửa; không thay thế toàn bộ bài.`;
}

function sanitizeResult(result, wordCount) {
  const criteria = CRITERIA.map((expected, index) => {
    const received = Array.isArray(result?.criteria) ? result.criteria[index] || {} : {};
    return {
      name: expected.name,
      score: roundToTenth(clamp(Number(received.score), 0, expected.maxScore)),
      maxScore: expected.maxScore,
      comment: String(received.comment || "Chưa có nhận xét."),
      evidence: String(received.evidence || "").slice(0, 500),
      nextStep: String(received.nextStep || "").slice(0, 1000),
    };
  });

  const totalScore = roundToTenth(criteria.reduce((sum, item) => sum + item.score, 0));
  return {
    totalScore,
    wordCount,
    level: levelFromScore(totalScore),
    overallComment: String(result?.overallComment || "").slice(0, 2000),
    criteria,
    strengths: stringArray(result?.strengths, 8),
    weaknesses: stringArray(result?.weaknesses, 8),
    paragraphFeedback: Array.isArray(result?.paragraphFeedback) ? result.paragraphFeedback.slice(0, 6) : [],
    errors: Array.isArray(result?.errors) ? result.errors.slice(0, 12) : [],
    addedIdeas: Array.isArray(result?.addedIdeas) ? result.addedIdeas.slice(0, 6) : [],
    improvedOutline: stringArray(result?.improvedOutline, 8),
    revisedPassage: String(result?.revisedPassage || "").slice(0, 6000),
  };
}

function normalizeText(value) {
  return String(value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}
function countWords(text) {
  return text ? text.split(/\s+/u).filter(Boolean).length : 0;
}
function stringArray(value, maxItems) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => String(item)) : [];
}
function levelFromScore(score) {
  if (score < 5) return "Chưa đạt";
  if (score < 6.5) return "Trung bình";
  if (score < 8) return "Khá";
  if (score < 9) return "Giỏi";
  return "Xuất sắc";
}
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
function clamp(value, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
function roundToTenth(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}
