(() => {
  "use strict";

  // Thay bằng URL Worker sau khi chạy: npx wrangler deploy
  const WORKER_URL = "https://essay-grader-api.nhokcup7.workers.dev";
  const MIN_WORDS = 500;
  const DRAFT_KEY = "vb2-cand-essay-draft";

  const $ = (selector) => document.querySelector(selector);
  const setupScreen = $("#setupScreen");
  const essayResultScreen = $("#essayResultScreen");
  const btnQuizMode = $("#btnQuizMode");
  const btnEssayMode = $("#btnEssayMode");
  const essaySetup = $("#essaySetup");
  const quizOnly = [...document.querySelectorAll(".quiz-only")];
  const studentEssay = $("#studentEssay");
  const btnGradeEssay = $("#btnGradeEssay");
  const btnBackToEssay = $("#btnBackToEssay");
  const btnGradeAgain = $("#btnGradeAgain");
  const essayStatus = $("#essayStatus");
  const essayWordCount = $("#essayWordCount");
  const essayWordProgress = $("#essayWordProgress");
  const essaySaveState = $("#essaySaveState");
  const resultContainer = $("#essayResultContainer");

  let saveTimer = null;

  function setAppMode(mode) {
    const isEssay = mode === "essay";
    quizOnly.forEach((element) => { element.hidden = isEssay; });
    essaySetup.hidden = !isEssay;
    btnQuizMode.classList.toggle("active", !isEssay);
    btnEssayMode.classList.toggle("active", isEssay);
    btnQuizMode.setAttribute("aria-pressed", String(!isEssay));
    btnEssayMode.setAttribute("aria-pressed", String(isEssay));
    localStorage.setItem("learning-app-mode", mode);
    if (isEssay) updateEssayState();
  }

  function showScreen(screen) {
    document.querySelectorAll(".screen").forEach((item) => item.classList.remove("active"));
    screen.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function countWords(text) {
    const normalized = String(text || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();
    return normalized ? normalized.split(/\s+/u).filter(Boolean).length : 0;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderList(items, emptyText = "Không có nhận xét.") {
    if (!Array.isArray(items) || items.length === 0) return `<p>${escapeHtml(emptyText)}</p>`;
    return `<ul class="feedback-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function updateEssayState() {
    const wordCount = countWords(studentEssay.value);
    const remaining = Math.max(0, MIN_WORDS - wordCount);
    const progress = Math.min(100, Math.round((wordCount / MIN_WORDS) * 100));
    const ready = wordCount >= MIN_WORDS;

    essayWordCount.textContent = `${wordCount.toLocaleString("vi-VN")} / ${MIN_WORDS} chữ`;
    essayWordCount.classList.toggle("ready", ready);
    essayWordProgress.style.width = `${progress}%`;
    btnGradeEssay.disabled = !ready;
    essayStatus.classList.remove("text-danger");
    essayStatus.textContent = ready
      ? "Bài đã đủ độ dài. Bạn có thể nộp để AI chấm."
      : `Cần thêm ${remaining.toLocaleString("vi-VN")} chữ để có thể nộp bài.`;
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, studentEssay.value);
      essaySaveState.textContent = "Đã lưu bản nháp trên trình duyệt.";
    } catch {
      essaySaveState.textContent = "Không thể lưu bản nháp.";
    }
  }

  function validateInput() {
    const answer = studentEssay.value.trim();
    const wordCount = countWords(answer);
    if (wordCount < MIN_WORDS) return `Bài làm cần tối thiểu ${MIN_WORDS} chữ; hiện có ${wordCount} chữ.`;
    if (answer.length > 30000) return "Bài làm vượt quá 30.000 ký tự.";
    return "";
  }

  async function gradeEssay() {
    const validationError = validateInput();
    if (validationError) {
      essayStatus.textContent = validationError;
      essayStatus.classList.add("text-danger");
      return;
    }
    if (WORKER_URL.includes("YOUR-WORKER")) {
      essayStatus.textContent = "Bạn chưa thay WORKER_URL trong essay-grader.js.";
      essayStatus.classList.add("text-danger");
      return;
    }

    btnGradeEssay.disabled = true;
    btnGradeAgain.disabled = true;
    essayStatus.classList.remove("text-danger");
    essayStatus.textContent = "Gemini đang phân tích cấu trúc, lập luận, lỗi diễn đạt và ý còn thiếu...";
    btnGradeEssay.textContent = "Đang chấm bài...";

    try {
      const response = await fetch(`${WORKER_URL}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentAnswer: studentEssay.value.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Máy chủ trả về lỗi ${response.status}.`);
      renderResult(data);
      showScreen(essayResultScreen);
    } catch (error) {
      essayStatus.textContent = `Không thể chấm bài: ${error.message}`;
      essayStatus.classList.add("text-danger");
    } finally {
      btnGradeAgain.disabled = false;
      btnGradeEssay.innerHTML = 'Nộp bài và chấm điểm <span aria-hidden="true">→</span>';
      updateEssayState();
    }
  }

  function renderResult(data) {
    const criteria = Array.isArray(data.criteria) ? data.criteria : [];
    const errors = Array.isArray(data.errors) ? data.errors : [];
    const addedIdeas = Array.isArray(data.addedIdeas) ? data.addedIdeas : [];
    const paragraphFeedback = Array.isArray(data.paragraphFeedback) ? data.paragraphFeedback : [];

    resultContainer.innerHTML = `
      <section class="essay-score-card">
        <div class="essay-score">${escapeHtml(data.totalScore)}<span>/10</span></div>
        <div class="score-meta"><span>${escapeHtml(data.wordCount)} chữ</span><span>Mức đánh giá: ${escapeHtml(data.level)}</span></div>
        <p class="essay-summary">${escapeHtml(data.overallComment)}</p>
      </section>

      <section class="essay-result-section">
        <h3>Điểm theo khung VB2 Công an</h3>
        <div class="criteria-grid">${criteria.map((item) => `
          <article class="criterion-card">
            <div class="criterion-title"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.score)}/${escapeHtml(item.maxScore)}</span></div>
            <p>${escapeHtml(item.comment)}</p>
            ${item.evidence ? `<small>Dẫn chứng trong bài: “${escapeHtml(item.evidence)}”</small>` : ""}
            ${item.nextStep ? `<p class="next-step"><strong>Cách nâng điểm:</strong> ${escapeHtml(item.nextStep)}</p>` : ""}
          </article>`).join("")}
        </div>
      </section>

      <section class="essay-result-section two-column-feedback">
        <div><h3>Điểm mạnh</h3>${renderList(data.strengths)}</div>
        <div><h3>Điểm cần cải thiện</h3>${renderList(data.weaknesses)}</div>
      </section>

      <section class="essay-result-section">
        <h3>Nhận xét theo từng phần bài viết</h3>
        ${paragraphFeedback.length ? `<div class="paragraph-feedback">${paragraphFeedback.map((item) => `
          <article>
            <div><strong>${escapeHtml(item.section)}</strong><span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(item.statusLabel)}</span></div>
            <p>${escapeHtml(item.comment)}</p>
            ${item.suggestion ? `<p><strong>Nên sửa:</strong> ${escapeHtml(item.suggestion)}</p>` : ""}
          </article>`).join("")}</div>` : "<p>Không có dữ liệu.</p>"}
      </section>

      <section class="essay-result-section">
        <h3>Lỗi được phát hiện và cách sửa</h3>
        ${errors.length ? `<div class="language-errors">${errors.map((item) => `
          <div>
            <span class="error-type">${escapeHtml(item.type)}</span>
            <p><del>${escapeHtml(item.original)}</del></p>
            <p class="correction-line"><span>→</span> <ins>${escapeHtml(item.correction)}</ins></p>
            <p>${escapeHtml(item.explanation)}</p>
          </div>`).join("")}</div>` : "<p>Không phát hiện lỗi nổi bật cần sửa.</p>"}
      </section>

      <section class="essay-result-section">
        <h3>Ý nên bổ sung để bài sâu hơn</h3>
        ${addedIdeas.length ? `<div class="added-ideas">${addedIdeas.map((item, index) => `
          <article>
            <span class="idea-number">${index + 1}</span>
            <div>
              <strong>${escapeHtml(item.idea)}</strong>
              <p>${escapeHtml(item.why)}</p>
              <p><strong>Vị trí nên thêm:</strong> ${escapeHtml(item.insertionPoint)}</p>
              <blockquote>${escapeHtml(item.sampleSentence)}</blockquote>
            </div>
          </article>`).join("")}</div>` : "<p>Bài đã bao quát khá đầy đủ các ý chính.</p>"}
      </section>

      <section class="essay-result-section">
        <h3>Dàn ý nâng điểm do AI đề xuất</h3>
        ${renderList(data.improvedOutline, "Không có dàn ý đề xuất.")}
      </section>

      <section class="essay-result-section">
        <h3>Đoạn văn mẫu đã chỉnh sửa</h3>
        <p class="improved-answer">${escapeHtml(data.revisedPassage || "Không có đoạn mẫu.")}</p>
        <p class="helper-text">Đoạn mẫu dùng để tham khảo cách lập luận và diễn đạt; không nên chép nguyên văn.</p>
      </section>`;
  }

  btnQuizMode.addEventListener("click", () => setAppMode("quiz"));
  btnEssayMode.addEventListener("click", () => setAppMode("essay"));
  studentEssay.addEventListener("input", () => {
    updateEssayState();
    essaySaveState.textContent = "Đang lưu bản nháp...";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 400);
  });
  btnGradeEssay.addEventListener("click", gradeEssay);
  btnGradeAgain.addEventListener("click", gradeEssay);
  btnBackToEssay.addEventListener("click", () => { showScreen(setupScreen); setAppMode("essay"); });

  const savedDraft = localStorage.getItem(DRAFT_KEY);
  if (savedDraft) studentEssay.value = savedDraft;
  updateEssayState();
  setAppMode(localStorage.getItem("learning-app-mode") === "essay" ? "essay" : "quiz");
})();
