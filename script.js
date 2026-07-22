(function () {
  // ============ BIẾN TOÀN CỤC ============
  let allQuestions = [];
  let quizQuestions = [];
  let userAnswers = [];
  let quizMode = "challenge";
  let questionCount = 20;
  let currentSingleIndex = 0;
  let isListView = true;
  let timerInterval = null;
  let timeRemaining = 3600;
  let quizStartedAt = 0;
  let quizSubmitted = false;
  let markedQuestions = new Set();
  let selectedDeck = 0;
  let selectedSpeed = "normal";
  let availableDecks = [];
  let usedQuestionIndices = new Set();

  const $ = (sel) => document.querySelector(sel);
  const setupScreen = $("#setupScreen");
  const quizScreen = $("#quizScreen");
  const resultScreen = $("#resultScreen");
  const reviewScreen = $("#reviewScreen");
  const importArea = $("#importArea");
  const fileInput = $("#fileInput");
  const fileInfo = $("#fileInfo");
  const btnStart = $("#btnStart");
  const statusText = $("#statusText");
  const questionCountSelect = $("#questionCount");
  const quizModeSelect = $("#quizMode");
  const challengeOptions = $("#challengeOptions");
  const deckGrid = $("#deckGrid");
  const speedGrid = $("#speedGrid");
  const btnRefreshDecks = $("#btnRefreshDecks");
  const modeBadge = $("#modeBadge");
  const timerBox = $("#timerBox");
  const timerDisplay = $("#timerDisplay");
  const btnToggleView = $("#btnToggleView");
  const toggleViewText = $("#toggleViewText");
  const btnSubmitQuiz = $("#btnSubmitQuiz");
  const questionsListContainer = $("#questionsListContainer");
  const paletteDots = $("#paletteDots");
  const singleNav = $("#singleNav");
  const singleNavInfo = $("#singleNavInfo");
  const btnPrev = $("#btnPrev");
  const btnNext = $("#btnNext");
  const resultScore = $("#resultScore");
  const correctCount = $("#correctCount");
  const wrongCount = $("#wrongCount");
  const resultDots = $("#resultDots");
  const resultPercent = $("#resultPercent");
  const btnBackToSetup = $("#btnBackToSetup");
  const btnReview = $("#btnReview");
  const btnRetake = $("#btnRetake");
  const reviewContainer = $("#reviewContainer");
  const btnBackToResult = $("#btnBackToResult");
  const themeToggle = $("#themeToggle");
  const speedChartValue = $("#speedChartValue");
  const speedChartBar = $("#speedChartBar");
  const elapsedTime = $("#elapsedTime");
  const speedNote = $("#speedNote");

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.setAttribute("aria-label", isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối");
    themeToggle.querySelector(".theme-icon").textContent = isDark ? "☀" : "☾";
    themeToggle.querySelector(".theme-text").textContent = isDark ? "Sáng" : "Tối";
    document.querySelector('meta[name="theme-color"]').content = isDark ? "#10101e" : "#eef2ff";
  }

  const savedTheme = localStorage.getItem("quiz-theme");
  applyTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("quiz-theme", nextTheme);
    applyTheme(nextTheme);
  });

  function showScreen(screen) {
    [setupScreen, quizScreen, resultScreen, reviewScreen].forEach((s) =>
      s.classList.remove("active"),
    );
    screen.classList.add("active");
    const heading = screen.querySelector("h1, h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ============ IMPORT FILE ============
  importArea.addEventListener("click", () => fileInput.click());
  importArea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", handleFileSelect);
  importArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    importArea.classList.add("dragover");
  });
  importArea.addEventListener("dragleave", () => {
    importArea.classList.remove("dragover");
  });
  importArea.addEventListener("drop", (e) => {
    e.preventDefault();
    importArea.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file) processExcelFile(file);
  });

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) processExcelFile(file);
  }

  function detectHeader(row) {
    if (!row || row.length < 6) return false;
    return (
      row[0]?.toString().trim().toLowerCase() === "text" &&
      row[1]?.toString().trim().toLowerCase() === "option_0"
    );
  }

  function parseCorrectValue(raw) {
    raw = raw.toString().trim();
    if (/^\d+$/.test(raw)) {
      const num = parseInt(raw);
      return num >= 0 && num <= 3 ? num : -1;
    }
    const upper = raw.toUpperCase();
    return ["A", "B", "C", "D"].includes(upper) ? upper.charCodeAt(0) - 65 : -1;
  }

  function processExcelFile(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        if (rows.length < 2) throw new Error("File trống");

        let questions = [];
        let errors = [];
        let usingHeader = detectHeader(rows[0]);
        let startRow = usingHeader ? 1 : 0;

        for (let i = startRow; i < rows.length; i++) {
          const row = rows[i];
          const text = row[0]?.toString().trim();
          const opts = [
            row[1]?.toString().trim(),
            row[2]?.toString().trim(),
            row[3]?.toString().trim(),
            row[4]?.toString().trim(),
          ];
          const correctRaw = row[5]?.toString().trim();

          if (!text) {
            errors.push(`Dòng ${i + 1}: Thiếu câu hỏi`);
            continue;
          }
          const correctIdx = parseCorrectValue(correctRaw);
          if (correctIdx === -1) {
            errors.push(`Dòng ${i + 1}: Đáp án đúng không hợp lệ`);
            continue;
          }

          const validOpts = [];
          const idxMap = [];
          opts.forEach((opt, idx) => {
            if (opt !== "") {
              validOpts.push(opt);
              idxMap.push(idx);
            }
          });
          if (validOpts.length < 2) {
            errors.push(`Dòng ${i + 1}: Cần ít nhất 2 đáp án`);
            continue;
          }
          const newCorrect = idxMap.indexOf(correctIdx);
          if (newCorrect === -1) {
            errors.push(`Dòng ${i + 1}: Đáp án đúng trùng ô trống`);
            continue;
          }

          questions.push({
            question: text,
            options: validOpts,
            correctIndex: newCorrect,
          });
        }

        allQuestions = questions;
        fileInfo.style.display = "block";
        fileInfo.textContent = `✅ Import thành công ${questions.length} câu hỏi`;
        fileInfo.className = "file-info success";
        if (errors.length > 0) {
          fileInfo.textContent += ` (${errors.length} lỗi)`;
          console.warn("Import errors:", errors);
        }
        updateStartButton();
        generateDecks();
      } catch (err) {
        fileInfo.style.display = "block";
        fileInfo.textContent = "❌ Lỗi: " + err.message;
        fileInfo.className = "file-info error";
        allQuestions = [];
        updateStartButton();
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function updateStartButton() {
    btnStart.disabled = allQuestions.length === 0;
    statusText.textContent =
      allQuestions.length > 0
        ? `Sẵn sàng với ${allQuestions.length} câu hỏi`
        : "⚠️ Vui lòng import file Excel hợp lệ";
  }

  // ============ TẠO ĐỀ BÀI & TỐC ĐỘ ============
  function getQuestionCount() {
    const val = questionCountSelect.value;
    return val === "all"
      ? allQuestions.length
      : Math.min(parseInt(val), allQuestions.length);
  }

  function generateDecks() {
    if (allQuestions.length === 0) return;
    availableDecks = [];
    usedQuestionIndices = new Set();
    for (let i = 0; i < 5; i++) {
      const deck = generateUniqueDeck();
      availableDecks.push(deck);
    }
    renderDecks();
    renderSpeeds();
    selectedDeck = 0;
    updateDeckSelection();
  }

  function generateUniqueDeck() {
    const count = getQuestionCount();
    const available = allQuestions
      .map((_, i) => i)
      .filter((i) => !usedQuestionIndices.has(i));
    if (available.length < count) {
      usedQuestionIndices = new Set();
      return generateUniqueDeck();
    }
    const shuffled = shuffleArray([...available]);
    const selected = shuffled.slice(0, count);
    selected.forEach((i) => usedQuestionIndices.add(i));
    return {
      id: Date.now() + Math.random(),
      questionIndices: selected,
      label: `Đề ${availableDecks.length + 1}`,
    };
  }

  function refreshAllDecks() {
    usedQuestionIndices = new Set();
    availableDecks = [];
    for (let i = 0; i < 5; i++) {
      availableDecks.push(generateUniqueDeck());
    }
    selectedDeck = 0;
    renderDecks();
    updateDeckSelection();
  }

  function renderDecks() {
    const count = getQuestionCount();
    deckGrid.innerHTML = availableDecks
      .map(
        (deck, i) => `
                    <button type="button" class="deck-card ${i === selectedDeck ? "selected" : ""}" data-deck-index="${i}" aria-pressed="${i === selectedDeck}">
                        <div class="deck-number">#${i + 1}</div>
                        <div class="deck-label">${deck.label}</div>
                        <div style="color:#64748b;font-size:0.85rem;">${count} câu hỏi</div>
                        ${i === selectedDeck ? '<div class="deck-badge">Đã chọn</div>' : ""}
                    </button>
                `,
      )
      .join("");

    deckGrid.querySelectorAll(".deck-card").forEach((card) => {
      card.addEventListener("click", function () {
        selectedDeck = parseInt(this.dataset.deckIndex);
        updateDeckSelection();
      });
    });
  }

  function updateDeckSelection() {
    deckGrid.querySelectorAll(".deck-card").forEach((card, i) => {
      card.classList.toggle("selected", i === selectedDeck);
      card.setAttribute("aria-pressed", String(i === selectedDeck));
      const badge = card.querySelector(".deck-badge");
      if (i === selectedDeck && !badge) {
        const div = document.createElement("div");
        div.className = "deck-badge";
        div.textContent = "Đã chọn";
        card.appendChild(div);
      } else if (i !== selectedDeck && badge) {
        badge.remove();
      }
    });
  }

  function renderSpeeds() {
    const speeds = [
      {
        id: "normal",
        icon: "60",
        label: "Bình thường",
        time: "60 phút",
        minutes: 60,
      },
      {
        id: "medium",
        icon: "45",
        label: "Trung bình",
        time: "45 phút",
        minutes: 45,
      },
      { id: "hard", icon: "30", label: "Khó", time: "30 phút", minutes: 30 },
    ];
    speedGrid.innerHTML = speeds
      .map(
        (s) => `
                    <button type="button" class="speed-option ${selectedSpeed === s.id ? "selected" : ""}" data-speed="${s.id}" aria-pressed="${selectedSpeed === s.id}">
                        <div class="speed-icon">${s.icon}</div>
                        <div class="speed-time">${s.time}</div>
                        <div style="color:#64748b;font-size:0.85rem;">${s.label}</div>
                    </button>
                `,
      )
      .join("");
    speedGrid.querySelectorAll(".speed-option").forEach((opt) => {
      opt.addEventListener("click", function () {
        selectedSpeed = this.dataset.speed;
        speedGrid
          .querySelectorAll(".speed-option")
          .forEach((o) => {
            o.classList.remove("selected");
            o.setAttribute("aria-pressed", "false");
          });
        this.classList.add("selected");
        this.setAttribute("aria-pressed", "true");
      });
    });
  }

  btnRefreshDecks.addEventListener("click", refreshAllDecks);

  // Khi thay đổi số lượng câu, cập nhật lại đề (nếu đang ở thử thách)
  questionCountSelect.addEventListener("change", function () {
    if (allQuestions.length > 0) {
      generateDecks();
    }
  });

  quizModeSelect.addEventListener("change", function () {
    quizMode = this.value;
    challengeOptions.style.display =
      quizMode === "challenge" ? "block" : "none";
    updateStartButton();
  });

  // Khởi tạo
  challengeOptions.style.display = "block";
  generateDecks();
  renderSpeeds();

  // ============ BẮT ĐẦU LÀM BÀI ============
  btnStart.addEventListener("click", startQuiz);

  function startQuiz() {
    if (allQuestions.length === 0) {
      alert("Vui lòng import file câu hỏi trước!");
      return;
    }
    quizMode = quizModeSelect.value;
    questionCount = getQuestionCount();

    if (quizMode === "challenge") {
      if (!availableDecks[selectedDeck]) {
        alert("Vui lòng chọn đề bài hợp lệ!");
        return;
      }
      const deck = availableDecks[selectedDeck];
      quizQuestions = deck.questionIndices.map((i) => allQuestions[i]);
      const speeds = { normal: 3600, medium: 2700, hard: 1800 };
      timeRemaining = speeds[selectedSpeed] || 3600;
    } else {
      let pool = [...allQuestions];
      if (quizMode === "review") {
        pool = pool.slice(0, questionCount);
      } else {
        pool = pool.slice(0, questionCount);
      }
      quizQuestions = pool;
      timeRemaining = 999999;
    }

    userAnswers = new Array(quizQuestions.length).fill(null);
    markedQuestions = new Set();
    currentSingleIndex = 0;
    isListView = true;
    quizSubmitted = false;
    quizStartedAt = Date.now();

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;

    updateModeBadge();
    updateTimerVisibility();
    updateToggleButtonText();
    singleNav.style.display = "none";
    questionsListContainer.style.display = "block";

    renderAllQuestions();
    renderPalette();
    updatePaletteHighlight();

    showScreen(quizScreen);
    if (quizMode === "challenge") {
      startTimer();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function updateModeBadge() {
    switch (quizMode) {
      case "review":
        modeBadge.textContent = "📖 Ôn tập";
        break;
      case "challenge":
        const speeds = {
          normal: "Bình thường",
          medium: "Trung bình",
          hard: "Khó",
        };
        modeBadge.textContent = `⚡ Thử thách - ${speeds[selectedSpeed]}`;
        break;
      case "cram":
        modeBadge.textContent = "📚 Học đề cương";
        break;
    }
  }

  function updateTimerVisibility() {
    timerBox.style.display = quizMode === "challenge" ? "inline-flex" : "none";
    updateTimerDisplay();
  }

  function updateToggleButtonText() {
    toggleViewText.textContent = isListView ? "Xem từng câu" : "Xem danh sách";
  }

  function startTimer() {
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      timeRemaining--;
      updateTimerDisplay();
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        alert("⏰ Hết giờ! Bài làm sẽ được tự động nộp.");
        submitQuiz();
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    timerDisplay.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    if (timeRemaining <= 300) timerBox.classList.add("warning");
    else timerBox.classList.remove("warning");
  }

  // ============ RENDER CÂU HỎI ============
  function renderAllQuestions() {
    if (isListView) {
      questionsListContainer.style.display = "block";
      singleNav.style.display = "none";
      questionsListContainer.innerHTML = quizQuestions
        .map((q, i) => renderQuestionCard(q, i, true))
        .join("");
      attachQuestionEvents();
    } else {
      questionsListContainer.style.display = "block";
      singleNav.style.display = "flex";
      singleNav.style.justifyContent = "center";
      singleNav.style.alignItems = "center";
      renderSingleQuestion();
    }
    updateSingleNavInfo();
  }

  function renderQuestionCard(q, index, showAll = true) {
    const isMarked = markedQuestions.has(index);
    const displayStyle =
      !showAll && index !== currentSingleIndex ? 'style="display:none;"' : "";
    const labels = ["A", "B", "C", "D"];
    const optionsHtml = q.options
      .map((opt, oi) => {
        let cls = "option-item";
        if (quizMode === "cram" && oi === q.correctIndex)
          cls += " correct-answer";
        else if (userAnswers[index] === oi) cls += " selected";
        const checked = userAnswers[index] === oi ? "checked" : "";
        const disabled = quizMode === "cram" ? "disabled" : "";
        return `
                        <li class="${cls}" data-q="${index}" data-o="${oi}">
                            <input type="radio" name="q${index}" value="${oi}" ${checked} ${disabled}>
                            <span><strong>${labels[oi]}.</strong> ${opt}</span>
                        </li>`;
      })
      .join("");

    return `
                    <div class="question-card" id="qc${index}" data-index="${index}" ${displayStyle}>
                        <div class="question-number">
                            <span>Câu ${index + 1}/${quizQuestions.length}</span>
                            <button class="btn btn-sm ${isMarked ? "btn-warning" : "btn-outline"}" 
                                    style="position:absolute;top:12px;right:16px;padding:4px 10px;"
                                    type="button" aria-label="${isMarked ? "Bỏ đánh dấu" : "Đánh dấu"} câu ${index + 1}" aria-pressed="${isMarked}"
                                    data-mark="${index}">${isMarked ? "★" : "☆"}</button>
                        </div>
                        <div class="question-text">${q.question}</div>
                        <ul class="options-list">${optionsHtml}</ul>
                    </div>`;
  }

  function renderSingleQuestion() {
    questionsListContainer.innerHTML = quizQuestions
      .map((q, i) => renderQuestionCard(q, i, false))
      .join("");
    attachQuestionEvents();
    updateSingleQuestionVisibility();
  }

  function updateSingleQuestionVisibility() {
    questionsListContainer
      .querySelectorAll(".question-card")
      .forEach((card, i) => {
        card.style.display = i === currentSingleIndex ? "block" : "none";
        card.classList.toggle("current", i === currentSingleIndex);
      });
    updateSingleNavInfo();
    updatePaletteHighlight();
    const current = $("#qc" + currentSingleIndex);
    if (current)
      current.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function updateSingleNavInfo() {
    if (!isListView)
      singleNavInfo.textContent = `Câu ${currentSingleIndex + 1}/${quizQuestions.length}`;
  }

  function attachQuestionEvents() {
    questionsListContainer.querySelectorAll(".option-item").forEach((item) => {
      item.addEventListener("click", function () {
        if (quizMode === "cram" || quizSubmitted) return;
        const q = parseInt(this.dataset.q);
        const o = parseInt(this.dataset.o);
        userAnswers[q] = o;
        const radio = this.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        updateOptionStyles(q);
        renderPalette();
      });
    });
    questionsListContainer.querySelectorAll("[data-mark]").forEach((btn) => {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const idx = parseInt(this.dataset.mark);
        markedQuestions.has(idx)
          ? markedQuestions.delete(idx)
          : markedQuestions.add(idx);
        const scrollY = window.scrollY;
        if (isListView) renderAllQuestions();
        else renderSingleQuestion();
        renderPalette();
        window.scrollTo({ top: scrollY, behavior: "instant" });
      });
    });
  }

  function updateOptionStyles(qIndex) {
    const card = $("#qc" + qIndex);
    if (!card) return;
    card.querySelectorAll(".option-item").forEach((opt) => {
      opt.classList.remove("selected");
      if (opt.querySelector('input[type="radio"]')?.checked)
        opt.classList.add("selected");
    });
  }

  // ============ PALETTE ============
  function renderPalette() {
    paletteDots.classList.toggle("scrollable", quizQuestions.length > 20);
    paletteDots.innerHTML = quizQuestions
      .map((_, i) => {
        let cls = "palette-dot";
        if (markedQuestions.has(i)) cls += " marked-dot";
        else if (userAnswers[i] !== null) cls += " answered";
        else cls += " unanswered";
        if (!isListView && i === currentSingleIndex) cls += " current-dot";
        return `<button type="button" class="${cls}" data-pi="${i}" aria-label="Đến câu ${i + 1}" title="Câu ${i + 1}">${i + 1}</button>`;
      })
      .join("");
    paletteDots.querySelectorAll(".palette-dot").forEach((dot) => {
      dot.addEventListener("click", function () {
        const idx = parseInt(this.dataset.pi);
        if (isListView) {
          const card = $("#qc" + idx);
          if (card)
            card.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          currentSingleIndex = idx;
          updateSingleQuestionVisibility();
        }
      });
    });
  }

  function updatePaletteHighlight() {
    paletteDots.querySelectorAll(".palette-dot").forEach((d) => {
      d.classList.toggle(
        "current-dot",
        !isListView && parseInt(d.dataset.pi) === currentSingleIndex,
      );
    });
  }

  // ============ CHUYỂN ĐỔI CHẾ ĐỘ XEM ============
  btnToggleView.addEventListener("click", () => {
    isListView = !isListView;
    updateToggleButtonText();
    singleNav.style.display = isListView ? "none" : "flex";
    if (!isListView) currentSingleIndex = 0;
    renderAllQuestions();
    renderPalette();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  btnPrev.addEventListener("click", () => {
    if (currentSingleIndex > 0) {
      currentSingleIndex--;
      updateSingleQuestionVisibility();
    }
  });
  btnNext.addEventListener("click", () => {
    if (currentSingleIndex < quizQuestions.length - 1) {
      currentSingleIndex++;
      updateSingleQuestionVisibility();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (!quizScreen.classList.contains("active") || quizSubmitted || isListView)
      return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      btnPrev.click();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      btnNext.click();
    }
  });

  // ============ NỘP BÀI ============
  btnSubmitQuiz.addEventListener("click", () => {
    if (quizSubmitted) return;
    const unanswered = userAnswers.filter((a) => a === null).length;
    if (quizMode !== "cram" && unanswered > 0) {
      if (!confirm(`Còn ${unanswered} câu chưa trả lời. Nộp bài?`)) return;
    }
    submitQuiz();
  });

  function submitQuiz() {
    if (quizSubmitted) return;
    quizSubmitted = true;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    showResults();
  }

  // ============ KẾT QUẢ ============
  function showResults() {
    let correctTotal = 0;
    const results = quizQuestions.map((q, i) => {
      const ua = userAnswers[i];
      const correct = quizMode === "cram" ? true : ua === q.correctIndex;
      if (correct) correctTotal++;
      return {
        index: i,
        correct,
        userAnswer: ua,
        correctAnswer: q.correctIndex,
      };
    });
    const total = quizQuestions.length;
    resultScore.textContent = `${correctTotal}/${total}`;
    correctCount.textContent = correctTotal;
    wrongCount.textContent = total - correctTotal;
    resultPercent.textContent = `Tỷ lệ: ${Math.round((correctTotal / total) * 100)}%`;
    resultDots.innerHTML = results
      .map((r, i) => `<span class="result-dot ${r.correct ? "correct" : "wrong"}" title="Câu ${i + 1}: ${r.correct ? "Đúng" : "Sai"}"></span>`)
      .join("");
    resultDots.setAttribute("aria-label", `${correctTotal} câu đúng, ${total - correctTotal} câu sai trên tổng số ${total} câu`);

    const elapsedSeconds = Math.max(1, Math.round((Date.now() - quizStartedAt) / 1000));
    const averageSeconds = elapsedSeconds / Math.max(total, 1);
    const targetSeconds = quizMode === "challenge" ? (({ normal: 3600, medium: 2700, hard: 1800 }[selectedSpeed] || 3600) / Math.max(total, 1)) : 120;
    const speedPercent = Math.min(100, Math.round((targetSeconds / Math.max(averageSeconds, 1)) * 70));
    elapsedTime.textContent = formatDuration(elapsedSeconds);
    speedChartValue.textContent = averageSeconds < 60 ? `${Math.round(averageSeconds)} giây/câu` : `${(averageSeconds / 60).toFixed(1)} phút/câu`;
    speedNote.textContent = averageSeconds <= targetSeconds ? "Nhanh hơn nhịp mục tiêu" : "Chậm hơn nhịp mục tiêu";
    speedChartBar.style.width = "0%";
    requestAnimationFrame(() => { speedChartBar.style.width = `${speedPercent}%`; });
    window._lastResults = results;
    window._lastQuizQuestions = quizQuestions;
    window._lastUserAnswers = userAnswers;
    window._lastQuizMode = quizMode;
    showScreen(resultScreen);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  // ============ XEM LẠI ============
  btnReview.addEventListener("click", () => {
    const results = window._lastResults;
    const questions = window._lastQuizQuestions;
    const ua = window._lastUserAnswers;
    if (!results || !questions) return;
    const labels = ["A", "B", "C", "D"];
    reviewContainer.innerHTML = questions
      .map((q, i) => {
        const r = results[i];
        const cardClass = r.correct ? "correct-review" : "wrong-review";
        const optsHtml = q.options
          .map((opt, oi) => {
            let ocls = "option-item";
            if (oi === q.correctIndex) ocls += " correct-answer";
            if (!r.correct && ua[i] === oi && oi !== q.correctIndex)
              ocls += " wrong-choice";
            const icon = oi === q.correctIndex ? " ✅" : "";
            const uicon = !r.correct && ua[i] === oi ? " ❌ (Bạn chọn)" : "";
            return `<li class="${ocls}"><span><strong>${labels[oi]}.</strong> ${opt}${icon}${uicon}</span></li>`;
          })
          .join("");
        return `
                        <div class="question-card ${cardClass}">
                            <div class="question-number">Câu ${i + 1} - ${r.correct ? "🔵 Đúng" : "🔴 Sai"}</div>
                            <div class="question-text">${q.question}</div>
                            <ul class="options-list">${optsHtml}</ul>
                        </div>`;
      })
      .join("");
    showScreen(reviewScreen);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  btnRetake.addEventListener("click", () => {
    if (!quizQuestions.length) return;
    userAnswers = new Array(quizQuestions.length).fill(null);
    markedQuestions = new Set();
    currentSingleIndex = 0;
    isListView = true;
    quizSubmitted = false;
    quizStartedAt = Date.now();
    window._lastResults = null;

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    if (quizMode === "challenge") {
      timeRemaining = { normal: 3600, medium: 2700, hard: 1800 }[selectedSpeed] || 3600;
    } else {
      timeRemaining = 999999;
    }

    updateModeBadge();
    updateTimerVisibility();
    updateToggleButtonText();
    singleNav.style.display = "none";
    questionsListContainer.style.display = "block";
    renderAllQuestions();
    renderPalette();
    updatePaletteHighlight();
    showScreen(quizScreen);
    if (quizMode === "challenge") startTimer();
  });

  btnBackToSetup.addEventListener("click", () => {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    quizSubmitted = false;
    quizQuestions = [];
    userAnswers = [];
    markedQuestions = new Set();
    showScreen(setupScreen);
    if (allQuestions.length > 0) generateDecks();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  btnBackToResult.addEventListener("click", () => {
    showScreen(resultScreen);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  updateStartButton();
  updateToggleButtonText();
  quizModeSelect.dispatchEvent(new Event("change"));
})();
