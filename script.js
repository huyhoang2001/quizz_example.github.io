// ========== DỮ LIỆU MẶC ĐỊNH ==========
let masterQuestions = [
    { text: "Thủ đô của Việt Nam là?", options: ["Đà Nẵng", "Hồ Chí Minh", "Hà Nội", "Hải Phòng"], correct: 2 },
    { text: "Ngôn ngữ lập trình nào được dùng nhiều cho web?", options: ["Python", "Java", "C++", "JavaScript"], correct: 3 },
    { text: "Mặt trời mọc hướng nào?", options: ["Tây", "Nam", "Bắc", "Đông"], correct: 3 },
    { text: "2 + 3 × 4 bằng bao nhiêu?", options: ["20", "14", "24", "12"], correct: 1 },
    { text: "Ai là tác giả của 'Truyện Kiều'?", options: ["Nguyễn Du", "Hồ Xuân Hương", "Nguyễn Đình Chiểu", "Tố Hữu"], correct: 0 }
];

// ========== STATE ==========
let selectedQuantity = 50;       // số câu mỗi mã đề
let examCodes = [];              // danh sách mã đề: [{code, seed, questions[]}]
let activeExamIndex = 0;        // mã đề đang chọn
let NUM_EXAM_CODES = 5;         // số mã đề mặc định

let currentQuestions = [];
let TOTAL_QS = 0;
let currentMode = "normal";
let currentIndex = 0;
let userAnswers = [];
let timerInterval = null;
let canAnswer = true;
let feedbackTimeout = null;
let activeExamCode = null;      // mã đề hiện tại khi quiz

// ========== DOM ==========
const homePage = document.getElementById('homePage');
const quizPage = document.getElementById('quizPage');
const resultsPage = document.getElementById('resultsPage');
const questionTextEl = document.getElementById('questionText');
const optionsContainer = document.getElementById('optionsContainer');
const timerDisplay = document.getElementById('timerDisplay');
const quizHint = document.getElementById('quizHint');
const exitQuizBtn = document.getElementById('exitQuizBtn');
const homeFromResults = document.getElementById('homeFromResults');
const retryBtn = document.getElementById('retryBtn');
const fileInput = document.getElementById('fileInput');
const importStatus = document.getElementById('importStatus');
const quantitySelectorDiv = document.getElementById('quantitySelector');
const selectedInfoSpan = document.getElementById('selectedInfo');
const examSection = document.getElementById('examSection');
const examGrid = document.getElementById('examGrid');
const examPreview = document.getElementById('examPreview');
const previewCode = document.getElementById('previewCode');
const previewInfo = document.getElementById('previewInfo');
const progressBar = document.getElementById('progressBar');
const quizProgress = document.getElementById('quizProgress');
const homeDivider = document.getElementById('homeDivider');

// ========== HELPERS ==========
function shuffleArray(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Seeded RNG (mulberry32)
function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
        s += 0x6D2B79F5;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffleOptions(question, rng) {
    const origOptions = [...question.options];
    const origCorrect = question.correct;
    let indices = shuffleArray(origOptions.map((_, i) => i), rng);
    return {
        text: question.text,
        options: indices.map(i => origOptions[i]),
        correct: indices.indexOf(origCorrect)
    };
}

function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

function getActualQuantity() {
    if (selectedQuantity === -1 || selectedQuantity >= masterQuestions.length) {
        return masterQuestions.length;
    }
    return selectedQuantity;
}

// Tạo câu hỏi cho mã đề từ seed
function buildExamQuestions(seed) {
    const rng = makeRng(seed);
    const qty = getActualQuantity();
    // Lấy ngẫu nhiên qty câu từ master dựa trên seed
    let indices = Array.from({ length: masterQuestions.length }, (_, i) => i);
    indices = shuffleArray(indices, rng);
    indices = indices.slice(0, Math.min(qty, masterQuestions.length));
    // Lấy câu, shuffle thứ tự câu
    let picked = indices.map(i => masterQuestions[i]);
    picked = shuffleArray(picked, rng);
    // Shuffle đáp án từng câu
    return picked.map(q => shuffleOptions(q, rng));
}

// ========== EXAM CODE MANAGEMENT ==========
function generateExamCode(index, totalCount) {
    // Tạo mã đề dạng 3 chữ số: 101, 102, ... hoặc ngẫu nhiên 3 chữ số
    // Sử dụng số ngẫu nhiên không trùng
    return 100 + index + 1;
}

function generateAllExamCodes(count) {
    // Tạo seeds ngẫu nhiên cho từng mã đề
    const used = new Set();
    const codes = [];
    for (let i = 0; i < count; i++) {
        let seed;
        do { seed = Math.floor(Math.random() * 900000) + 100000; } while (used.has(seed));
        used.add(seed);
        codes.push({
            code: 100 + i + 1,   // Mã hiển thị: 101, 102, ...
            seed: seed,
            questions: null      // lazy build khi cần
        });
    }
    return codes;
}

function addOneExamCode() {
    const newIdx = examCodes.length;
    let seed;
    const usedSeeds = new Set(examCodes.map(e => e.seed));
    do { seed = Math.floor(Math.random() * 900000) + 100000; } while (usedSeeds.has(seed));
    examCodes.push({
        code: 100 + newIdx + 1,
        seed: seed,
        questions: null
    });
    NUM_EXAM_CODES = examCodes.length;
    renderExamGrid();
}

function getExamQuestions(examIndex) {
    const exam = examCodes[examIndex];
    if (!exam.questions) {
        exam.questions = buildExamQuestions(exam.seed);
    }
    return exam.questions;
}

function renderExamGrid() {
    examGrid.innerHTML = '';
    examCodes.forEach((exam, i) => {
        const card = document.createElement('div');
        card.className = 'exam-card' + (i === activeExamIndex ? ' active' : '');
        card.innerHTML = `<div class="code-num">${exam.code}</div><div class="code-label">Mã đề</div>`;
        card.addEventListener('click', () => selectExam(i));
        examGrid.appendChild(card);
    });
    document.getElementById('examCountBadge').textContent = examCodes.length + ' mã đề';
    updateExamPreview();
}

function selectExam(index) {
    activeExamIndex = index;
    examCodes.forEach(e => e.questions = null); // reset lazy cache khi chọn mới
    document.querySelectorAll('.exam-card').forEach((c, i) => {
        c.classList.toggle('active', i === index);
    });
    updateExamPreview();
}

function updateExamPreview() {
    if (!examCodes.length) { examPreview.style.display = 'none'; return; }
    const exam = examCodes[activeExamIndex];
    const qty = getActualQuantity();
    previewCode.textContent = 'Mã đề ' + exam.code;
    previewInfo.textContent = qty + ' câu hỏi • seed: ' + exam.seed;
    examPreview.style.display = 'block';
}

function showExamSection() {
    examSection.style.display = 'block';
    homeDivider.style.display = 'block';
    if (examCodes.length === 0) {
        examCodes = generateAllExamCodes(NUM_EXAM_CODES);
        activeExamIndex = 0;
    }
    renderExamGrid();
}

// ========== QUANTITY SELECTOR ==========
function updateSelectedInfo() {
    const qty = getActualQuantity();
    const total = masterQuestions.length;
    if (selectedQuantity === -1 || selectedQuantity >= total) {
        selectedInfoSpan.textContent = `Tất cả ${total} câu`;
    } else {
        selectedInfoSpan.textContent = `${qty} / ${total} câu mỗi mã đề`;
    }
    document.getElementById('noteQCount').textContent = qty;
    // Reset exam questions cache
    examCodes.forEach(e => e.questions = null);
    updateExamPreview();
}

// ========== QUIZ LOGIC ==========
function resetToHome() {
    if (timerInterval) clearInterval(timerInterval);
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    timerInterval = null; feedbackTimeout = null;
    canAnswer = true; currentIndex = 0; userAnswers = [];
    quizPage.style.display = 'none';
    resultsPage.style.display = 'none';
    homePage.style.display = 'block';
    timerDisplay.style.display = 'none';
}

function startQuiz(mode) {
    if (timerInterval) clearInterval(timerInterval);
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    if (!masterQuestions.length) { alert("Chưa có câu hỏi. Hãy import file trước."); return; }
    if (!examCodes.length) { alert("Chưa có mã đề. Hãy import câu hỏi trước."); return; }

    activeExamCode = examCodes[activeExamIndex].code;
    currentQuestions = getExamQuestions(activeExamIndex);
    TOTAL_QS = currentQuestions.length;
    currentMode = mode;
    currentIndex = 0;
    userAnswers = Array(TOTAL_QS).fill(null).map(() => ({ selected: null, isCorrect: false }));
    canAnswer = true;

    homePage.style.display = 'none';
    resultsPage.style.display = 'none';
    quizPage.style.display = 'block';

    document.getElementById('quizCodeBadge').textContent = 'Mã đề ' + activeExamCode;
    renderCurrentQuestion();
}

function renderCurrentQuestion() {
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    feedbackTimeout = null;
    canAnswer = true;

    const pct = Math.round((currentIndex / TOTAL_QS) * 100);
    progressBar.style.width = pct + '%';
    quizProgress.textContent = (currentIndex + 1) + ' / ' + TOTAL_QS;

    const q = currentQuestions[currentIndex];
    questionTextEl.textContent = q.text;
    optionsContainer.innerHTML = '';

    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    q.options.forEach((opt, idx) => {
        const div = document.createElement('div');
        div.className = 'option';
        div.innerHTML = `<span class="option-prefix">${letters[idx]}.</span><span class="option-text">${escapeHtml(opt)}</span><span class="marker"></span>`;
        div.addEventListener('click', e => { e.stopPropagation(); if (canAnswer) handleAnswer(idx); });
        optionsContainer.appendChild(div);
    });

    if (currentMode === 'normal') {
        timerDisplay.style.display = 'none';
        if (timerInterval) clearInterval(timerInterval);
        quizHint.textContent = '✅ Chọn đáp án → hiện đúng/sai → tự động sang câu mới';
    } else {
        timerDisplay.style.display = 'flex';
        startChallengeTimer();
        quizHint.textContent = '⚡ 10 giây mỗi câu. Chọn ngay để chuyển câu.';
    }
}

function handleAnswer(selectedIndex) {
    if (!canAnswer) return;
    const q = currentQuestions[currentIndex];
    const isCorrect = selectedIndex === q.correct;
    userAnswers[currentIndex] = { selected: selectedIndex, isCorrect };
    if (currentMode === 'normal') {
        showFeedbackAndNext(selectedIndex, q.correct, isCorrect);
    } else {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        canAnswer = false;
        moveToNextQuestion();
    }
}

function showFeedbackAndNext(selectedIdx, correctIdx, isUserCorrect) {
    canAnswer = false;
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    const optionDivs = document.querySelectorAll('.option');
    optionDivs.forEach(o => { const m = o.querySelector('.marker'); if (m) m.innerHTML = ''; });
    if (isUserCorrect) {
        optionDivs[selectedIdx].classList.add('correct-highlight');
        optionDivs[selectedIdx].querySelector('.marker').innerHTML = '✓';
    } else {
        optionDivs[selectedIdx].classList.add('wrong-highlight');
        optionDivs[selectedIdx].querySelector('.marker').innerHTML = '✗';
        optionDivs[correctIdx].classList.add('correct-highlight');
        optionDivs[correctIdx].querySelector('.marker').innerHTML = '✓';
    }
    feedbackTimeout = setTimeout(moveToNextQuestion, 1000);
}

function moveToNextQuestion() {
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    feedbackTimeout = null;
    currentIndex++;
    if (currentIndex < TOTAL_QS) renderCurrentQuestion();
    else showResults();
}

function startChallengeTimer() {
    if (timerInterval) clearInterval(timerInterval);
    let timeLeft = 10;
    timerDisplay.textContent = '⏱ ' + timeLeft + 's';
    timerDisplay.classList.remove('warning');
    timerInterval = setInterval(() => {
        if (!canAnswer) return;
        timeLeft--;
        timerDisplay.textContent = '⏱ ' + timeLeft + 's';
        if (timeLeft <= 3) timerDisplay.classList.add('warning');
        if (timeLeft <= 0) {
            clearInterval(timerInterval); timerInterval = null;
            if (canAnswer) {
                canAnswer = false;
                userAnswers[currentIndex] = { selected: null, isCorrect: false };
                quizHint.textContent = '⏰ Hết giờ! Chuyển câu tiếp...';
                setTimeout(moveToNextQuestion, 400);
            }
        }
    }, 1000);
}

function showResults() {
    if (timerInterval) clearInterval(timerInterval);
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    quizPage.style.display = 'none';
    resultsPage.style.display = 'block';

    const correctCount = userAnswers.filter(a => a.isCorrect).length;
    const wrongCount = TOTAL_QS - correctCount;
    document.getElementById('sumCorrect').textContent = correctCount;
    document.getElementById('sumWrong').textContent = wrongCount;
    document.getElementById('sumTotal').textContent = TOTAL_QS;
    document.getElementById('resultsExamBadge').innerHTML = `Mã đề <strong>${activeExamCode}</strong> • ${currentMode === 'normal' ? 'Bình thường' : 'Thử thách'}`;

    const container = document.getElementById('circlesContainer');
    container.innerHTML = '';
    for (let i = 0; i < TOTAL_QS; i++) {
        const circle = document.createElement('div');
        circle.className = 'result-circle ' + (userAnswers[i]?.isCorrect ? 'circle-correct' : 'circle-wrong');
        circle.textContent = i + 1;
        container.appendChild(circle);
    }
}

// ========== IMPORT ==========
function afterImportSuccessful() {
    const total = masterQuestions.length;
    // Chỉ ghi đè status nếu import hoàn toàn sạch (không có lỗi dòng nào)
    if (!importStatus.innerHTML.includes('❌')) {
        importStatus.textContent = `✅ Đã import thành công ${total} câu hỏi!`;
    } else {
        // Có lỗi một số dòng — thêm dòng tóm tắt vào cuối
        importStatus.innerHTML += `<br><span style="color:#16a34a;font-weight:600">✅ Đã import ${total} câu hợp lệ</span>`;
    }
    quantitySelectorDiv.style.display = 'block';
    if (selectedQuantity !== -1 && selectedQuantity > total) {
        selectedQuantity = total;
        document.querySelectorAll('.quantity-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-q') === 'all');
        });
    }
    // Tạo mới danh sách mã đề
    examCodes = generateAllExamCodes(NUM_EXAM_CODES);
    activeExamIndex = 0;
    showExamSection();
    updateSelectedInfo();
    resetToHome();
}

function setNewQuestions(qs) {
    if (!Array.isArray(qs) || !qs.length) { importStatus.textContent = '❌ File không hợp lệ hoặc rỗng.'; return false; }
    const errors = [];
    const valid = [];
    qs.forEach((q, i) => {
        const rowNum = i + 1;
        const issues = [];
        if (!q.text || String(q.text).trim() === '') issues.push('thiếu câu hỏi (text)');
        if (!Array.isArray(q.options) || q.options.length < 2) {
            issues.push(`cần ít nhất 2 đáp án (hiện có ${Array.isArray(q.options) ? q.options.length : 0})`);
        } else {
            // Lọc bỏ đáp án trống
            q.options = q.options.map(o => String(o).trim()).filter(o => o !== '');
            if (q.options.length < 2) issues.push('cần ít nhất 2 đáp án không rỗng');
        }
        if (typeof q.correct !== 'number' || isNaN(q.correct)) {
            issues.push('correct không phải số');
        } else if (Array.isArray(q.options) && (q.correct < 0 || q.correct >= q.options.length)) {
            issues.push(`correct=${q.correct} vượt ngoài số đáp án (0–${q.options.length - 1})`);
        }
        if (issues.length) {
            errors.push(`Dòng ${rowNum}: ${issues.join(', ')}`);
        } else {
            valid.push(q);
        }
    });

    if (errors.length) {
        const preview = errors.slice(0, 5).join('\n');
        const more = errors.length > 5 ? `\n... và ${errors.length - 5} lỗi khác` : '';
        importStatus.innerHTML = `❌ Có ${errors.length} dòng lỗi (đã bỏ qua), import ${valid.length} câu hợp lệ:<br><pre style="font-size:0.72rem;text-align:left;background:#fff3f3;padding:8px;border-radius:6px;margin-top:6px;white-space:pre-wrap;color:#b91c1c">${escapeHtml(preview + more)}</pre>`;
        if (!valid.length) return false;
        masterQuestions = valid;
    } else {
        masterQuestions = valid;
    }
    afterImportSuccessful();
    return true;
}

function handleJSON(file) {
    const r = new FileReader();
    r.onload = e => { try { setNewQuestions(JSON.parse(e.target.result)); } catch (err) { importStatus.textContent = '❌ Lỗi JSON: ' + err.message; } };
    r.readAsText(file);
}

function handleExcel(file) {
    const r = new FileReader();
    r.onload = e => {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        if (!rows.length) { importStatus.textContent = '❌ Excel không có dữ liệu.'; return; }

        // Kiểm tra cột bắt buộc dựa trên header thực tế
        const firstRow = rows[0];
        const allKeys = Object.keys(firstRow);
        const missing = [];
        if (!allKeys.includes('text')) missing.push('text');
        if (!allKeys.includes('correct')) missing.push('correct');
        // Kiểm tra có ít nhất option_0, option_1
        if (!allKeys.includes('option_0')) missing.push('option_0');
        if (!allKeys.includes('option_1')) missing.push('option_1');
        if (missing.length) {
            importStatus.innerHTML = `❌ File thiếu cột bắt buộc: <b>${missing.join(', ')}</b><br><span style="font-size:0.75rem;color:#6b7280">Cột hiện có: ${allKeys.join(', ')}</span>`;
            return;
        }

        const qs = [];
        rows.forEach((row, i) => {
            // Gom các option_0..option_5, bỏ qua ô rỗng
            const opts = ['option_0', 'option_1', 'option_2', 'option_3', 'option_4', 'option_5']
                .filter(k => allKeys.includes(k))
                .map(k => String(row[k] ?? '').trim())
                .filter(v => v !== '');
            qs.push({
                text: String(row.text ?? '').trim(),
                options: opts,
                correct: Number(row.correct)
            });
        });
        setNewQuestions(qs);
    };
    r.readAsArrayBuffer(file);
}

function handleTXT(file) {
    const r = new FileReader();
    r.onload = e => {
        const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
        const qs = [];
        const errors = [];
        lines.forEach((line, i) => {
            const lineNum = i + 1;
            const parts = line.split('|').map(s => s.trim());
            // Định dạng: câu hỏi | đáp án 1 | đáp án 2 [| đáp án 3] [| đáp án 4] | correct
            // Tối thiểu: text | opt0 | opt1 | correct → 4 phần
            if (parts.length < 4) {
                errors.push(`Dòng ${lineNum}: cần ít nhất 4 phần (text|opt0|opt1|correct), hiện có ${parts.length}`);
                return;
            }
            const correct = parseInt(parts[parts.length - 1], 10);
            const opts = parts.slice(1, parts.length - 1).filter(o => o !== '');
            if (isNaN(correct) || correct < 0 || correct >= opts.length) {
                errors.push(`Dòng ${lineNum}: correct=${parts[parts.length - 1]} không hợp lệ (phải 0–${opts.length - 1})`);
                return;
            }
            if (!parts[0]) { errors.push(`Dòng ${lineNum}: câu hỏi rỗng`); return; }
            qs.push({ text: parts[0], options: opts, correct });
        });

        if (errors.length) {
            const preview = errors.slice(0, 5).join('\n');
            const more = errors.length > 5 ? `\n... và ${errors.length - 5} lỗi khác` : '';
            importStatus.innerHTML = `❌ ${errors.length} dòng lỗi:<br><pre style="font-size:0.72rem;text-align:left;background:#fff3f3;padding:8px;border-radius:6px;margin-top:6px;white-space:pre-wrap;color:#b91c1c">${escapeHtml(preview + more)}</pre>`;
            if (!qs.length) return;
        }
        setNewQuestions(qs);
    };
    r.readAsText(file);
}

fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    importStatus.textContent = 'Đang đọc file...';
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'json') handleJSON(file);
    else if (ext === 'xlsx') handleExcel(file);
    else if (ext === 'txt') handleTXT(file);
    else importStatus.textContent = '❌ Chỉ hỗ trợ .json, .xlsx, .txt';
    fileInput.value = '';
});

// Quantity buttons
document.querySelectorAll('.quantity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const qv = btn.getAttribute('data-q');
        selectedQuantity = qv === 'all' ? -1 : parseInt(qv, 10);
        if (selectedQuantity !== -1 && selectedQuantity > masterQuestions.length) selectedQuantity = masterQuestions.length;
        document.querySelectorAll('.quantity-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Reset exam cache
        examCodes.forEach(e => e.questions = null);
        updateSelectedInfo();
    });
});

// Exam code buttons
document.getElementById('btnGenExams').addEventListener('click', () => {
    examCodes = generateAllExamCodes(NUM_EXAM_CODES);
    activeExamIndex = 0;
    renderExamGrid();
});

document.getElementById('btnAddExam').addEventListener('click', () => {
    if (examCodes.length >= 20) { alert('Tối đa 20 mã đề.'); return; }
    addOneExamCode();
});

// Quiz start
document.getElementById('btnNormal').addEventListener('click', () => startQuiz('normal'));
document.getElementById('btnChallenge').addEventListener('click', () => startQuiz('challenge'));

// Exit / home
exitQuizBtn.addEventListener('click', () => { if (confirm('Về trang chủ? Tiến trình sẽ mất.')) resetToHome(); });
homeFromResults.addEventListener('click', resetToHome);
retryBtn.addEventListener('click', () => {
    // Làm lại cùng mã đề (reset questions cache để tạo lại từ seed)
    examCodes[activeExamIndex].questions = null;
    startQuiz(currentMode);
});

// ========== INIT ==========
if (masterQuestions.length) {
    quantitySelectorDiv.style.display = 'block';
    examCodes = generateAllExamCodes(NUM_EXAM_CODES);
    activeExamIndex = 0;
    showExamSection();
    updateSelectedInfo();
}
resetToHome();
