
// ---------- DỮ LIỆU MẶC ĐỊNH ----------
let masterQuestions = [   // lưu bộ câu hỏi gốc (chưa shuffle)
    { text: "Thủ đô của Việt Nam là?", options: ["Đà Nẵng", "Hồ Chí Minh", "Hà Nội", "Hải Phòng"], correct: 2 },
    { text: "Ngôn ngữ lập trình nào được dùng nhiều cho web?", options: ["Python", "Java", "C++", "JavaScript"], correct: 3 },
    { text: "Mặt trời mọc hướng nào?", options: ["Tây", "Nam", "Bắc", "Đông"], correct: 3 },
    { text: "2 + 3 × 4 bằng bao nhiêu?", options: ["20", "14", "24", "12"], correct: 1 },
    { text: "Ai là tác giả của 'Truyện Kiều'?", options: ["Nguyễn Du", "Hồ Xuân Hương", "Nguyễn Đình Chiểu", "Tố Hữu"], correct: 0 }
];

// Biến toàn cục cho quiz hiện tại (đã shuffle)
let currentQuestions = [];   // mảng câu hỏi sau khi shuffle (cả câu và đáp án)
let TOTAL_QS = 0;

// State
let currentMode = "normal";       // 'normal' hoặc 'challenge'
let currentIndex = 0;
let userAnswers = [];              // { selected: number|null, isCorrect: boolean }
let timerInterval = null;
let canAnswer = true;
let feedbackTimeout = null;

// DOM elements
const homePage = document.getElementById('homePage');
const quizPage = document.getElementById('quizPage');
const resultsPage = document.getElementById('resultsPage');
const questionTextEl = document.getElementById('questionText');
const optionsContainer = document.getElementById('optionsContainer');
const timerDisplay = document.getElementById('timerDisplay');
const quizHint = document.getElementById('quizHint');
const exitQuizBtn = document.getElementById('exitQuizBtn');
const homeFromResults = document.getElementById('homeFromResults');
const fileInput = document.getElementById('fileInput');
const importStatus = document.getElementById('importStatus');

// Helper: shuffle mảng (Fisher-Yates)
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Hàm xáo trộn đáp án trong một câu hỏi, trả về câu hỏi mới với options đã đảo và correct được cập nhật
function shuffleOptions(question) {
    const originalOptions = [...question.options];
    const originalCorrect = question.correct;
    // Tạo mảng các chỉ số 0..3
    let indices = [0, 1, 2, 3];
    indices = shuffleArray(indices);
    const newOptions = indices.map(i => originalOptions[i]);
    // Tìm vị trí mới của đáp án đúng
    const newCorrect = indices.indexOf(originalCorrect);
    return {
        text: question.text,
        options: newOptions,
        correct: newCorrect
    };
}

// Hàm chuẩn bị bộ câu hỏi đã xáo trộn (câu và đáp án)
function prepareShuffledQuestions(originalQuestions) {
    // 1. Shuffle thứ tự câu hỏi
    let shuffledQuestions = shuffleArray([...originalQuestions]);
    // 2. Với mỗi câu, shuffle đáp án
    shuffledQuestions = shuffledQuestions.map(q => shuffleOptions(q));
    return shuffledQuestions;
}

// Reset về home (giữ nguyên masterQuestions)
function resetToHome() {
    if (timerInterval) clearInterval(timerInterval);
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    timerInterval = null;
    feedbackTimeout = null;
    canAnswer = true;
    currentIndex = 0;
    userAnswers = [];
    quizPage.style.display = 'none';
    resultsPage.style.display = 'none';
    homePage.style.display = 'block';
    timerDisplay.style.display = 'none';
}

// Hiển thị kết quả (vòng tròn)
function showResults() {
    if (timerInterval) clearInterval(timerInterval);
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    quizPage.style.display = 'none';
    resultsPage.style.display = 'block';
    const container = document.getElementById('circlesContainer');
    container.innerHTML = '';
    for (let i = 0; i < TOTAL_QS; i++) {
        const circle = document.createElement('div');
        circle.classList.add('result-circle');
        const isCorrect = userAnswers[i]?.isCorrect === true;
        circle.classList.add(isCorrect ? 'circle-correct' : 'circle-wrong');
        circle.innerText = i + 1;
        container.appendChild(circle);
    }
}

// Chuyển sang câu tiếp theo
function moveToNextQuestion() {
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    feedbackTimeout = null;
    currentIndex++;
    if (currentIndex < TOTAL_QS) {
        renderCurrentQuestion();
    } else {
        showResults();
    }
}

// Chế độ bình thường: hiển thị feedback (tô màu, tick/x) và chuyển sau 1s
function showFeedbackAndNext(selectedIdx, correctIdx, isUserCorrect) {
    canAnswer = false;
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    const optionDivs = document.querySelectorAll('.option');
    optionDivs.forEach(opt => {
        let m = opt.querySelector('.marker');
        if (m) m.innerHTML = '';
    });
    if (isUserCorrect) {
        optionDivs[selectedIdx].classList.add('correct-highlight');
        let marker = optionDivs[selectedIdx].querySelector('.marker');
        if (marker) marker.innerHTML = '✓';
    } else {
        optionDivs[selectedIdx].classList.add('wrong-highlight');
        let wrongMarker = optionDivs[selectedIdx].querySelector('.marker');
        if (wrongMarker) wrongMarker.innerHTML = '✗';
        optionDivs[correctIdx].classList.add('correct-highlight');
        let correctMarker = optionDivs[correctIdx].querySelector('.marker');
        if (correctMarker) correctMarker.innerHTML = '✓';
    }
    feedbackTimeout = setTimeout(() => {
        moveToNextQuestion();
    }, 1000);
}

// Xử lý khi người dùng chọn đáp án (phân biệt theo mode)
function handleAnswer(selectedIndex) {
    if (!canAnswer) return;
    const q = currentQuestions[currentIndex];
    const correctIdx = q.correct;
    const isCorrect = (selectedIndex === correctIdx);
    userAnswers[currentIndex] = { selected: selectedIndex, isCorrect: isCorrect };

    if (currentMode === 'normal') {
        showFeedbackAndNext(selectedIndex, correctIdx, isCorrect);
    } else {
        // Chế độ thử thách: không feedback, chuyển câu ngay
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        canAnswer = false;
        moveToNextQuestion();
    }
}

// Timer cho chế độ thử thách
function startChallengeTimer() {
    if (timerInterval) clearInterval(timerInterval);
    let timeLeft = 10;
    timerDisplay.innerText = `⏱️ ${timeLeft}s`;
    timerInterval = setInterval(() => {
        if (!canAnswer) return;
        timeLeft--;
        timerDisplay.innerText = `⏱️ ${timeLeft}s`;
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            if (canAnswer) {
                canAnswer = false;
                userAnswers[currentIndex] = { selected: null, isCorrect: false };
                quizHint.innerText = "⏰ Hết giờ! Chuyển câu...";
                setTimeout(() => {
                    moveToNextQuestion();
                }, 300);
            }
        }
    }, 1000);
}

// Render câu hiện tại (dùng currentQuestions)
function renderCurrentQuestion() {
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    feedbackTimeout = null;
    canAnswer = true;
    const q = currentQuestions[currentIndex];
    questionTextEl.innerText = q.text;
    optionsContainer.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];
    q.options.forEach((opt, idx) => {
        const div = document.createElement('div');
        div.className = 'option';
        div.innerHTML = `
                <span class="option-prefix">${letters[idx]}.</span>
                <span class="option-text">${escapeHtml(opt)}</span>
                <span class="marker"></span>
            `;
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            if (canAnswer) handleAnswer(idx);
        });
        optionsContainer.appendChild(div);
    });
    if (currentMode === 'normal') {
        timerDisplay.style.display = 'none';
        if (timerInterval) clearInterval(timerInterval);
        quizHint.innerText = '✅ Chọn đáp án → hiện đúng/sai → tự động sang câu mới';
    } else {
        timerDisplay.style.display = 'flex';
        startChallengeTimer();
        quizHint.innerText = '⚡ 10 giây cho mỗi câu. Chọn ngay để chuyển câu (không hiển thị đúng/sai tức thì).';
    }
}

// Khởi động quiz (tạo bộ câu hỏi đã shuffle)
function startQuiz(mode) {
    if (timerInterval) clearInterval(timerInterval);
    if (feedbackTimeout) clearTimeout(feedbackTimeout);

    // Tạo bộ câu hỏi đã xáo trộn từ masterQuestions
    currentQuestions = prepareShuffledQuestions(masterQuestions);
    TOTAL_QS = currentQuestions.length;
    if (TOTAL_QS === 0) {
        alert("Không có câu hỏi nào. Hãy import file trước.");
        resetToHome();
        return;
    }

    currentMode = mode;
    currentIndex = 0;
    userAnswers = [];
    for (let i = 0; i < TOTAL_QS; i++) {
        userAnswers.push({ selected: null, isCorrect: false });
    }
    canAnswer = true;
    homePage.style.display = 'none';
    resultsPage.style.display = 'none';
    quizPage.style.display = 'block';
    renderCurrentQuestion();
}

// ----- IMPORT DỮ LIỆU -----
function setNewQuestions(newQuestions) {
    if (!Array.isArray(newQuestions) || newQuestions.length === 0) {
        importStatus.innerText = '❌ File không hợp lệ hoặc không có câu hỏi.';
        return false;
    }
    // Validate mỗi câu hỏi
    for (let q of newQuestions) {
        if (!q.text || !Array.isArray(q.options) || q.options.length !== 4 || typeof q.correct !== 'number' || q.correct < 0 || q.correct > 3) {
            importStatus.innerText = '❌ Dữ liệu sai định dạng. Mỗi câu cần text, options (4 mục), correct (0-3).';
            return false;
        }
    }
    masterQuestions = newQuestions;
    importStatus.innerText = `✅ Đã import thành công ${masterQuestions.length} câu hỏi! (sẽ được đảo khi bắt đầu quiz)`;
    resetToHome();
    return true;
}

// Đọc file JSON
function handleJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            setNewQuestions(data);
        } catch (err) {
            importStatus.innerText = '❌ Lỗi đọc JSON: ' + err.message;
        }
    };
    reader.readAsText(file);
}

// Đọc file Excel
function handleExcel(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet);
        if (!rows.length) {
            importStatus.innerText = '❌ Excel không có dữ liệu.';
            return;
        }
        const questions = [];
        for (let row of rows) {
            if (row.text && row.option_0 !== undefined && row.option_1 !== undefined && row.option_2 !== undefined && row.option_3 !== undefined && row.correct !== undefined) {
                questions.push({
                    text: row.text,
                    options: [row.option_0, row.option_1, row.option_2, row.option_3],
                    correct: Number(row.correct)
                });
            } else {
                importStatus.innerText = '❌ Excel thiếu cột. Cần: text, option_0, option_1, option_2, option_3, correct';
                return;
            }
        }
        setNewQuestions(questions);
    };
    reader.readAsArrayBuffer(file);
}

// Đọc file TXT
function handleTXT(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
        const questions = [];
        for (let line of lines) {
            const parts = line.split('|');
            if (parts.length !== 6) {
                importStatus.innerText = `❌ Dòng không đúng định dạng (cần 6 phần tử cách nhau |): ${line.substring(0, 50)}`;
                return;
            }
            const text = parts[0].trim();
            const options = parts.slice(1, 5).map(s => s.trim());
            const correct = parseInt(parts[5].trim(), 10);
            if (isNaN(correct) || correct < 0 || correct > 3) {
                importStatus.innerText = `❌ Giá trị correct phải từ 0-3: ${line}`;
                return;
            }
            questions.push({ text, options, correct });
        }
        setNewQuestions(questions);
    };
    reader.readAsText(file);
}

fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    importStatus.innerText = 'Đang đọc file...';
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'json') {
        handleJSON(file);
    } else if (ext === 'xlsx') {
        handleExcel(file);
    } else if (ext === 'txt') {
        handleTXT(file);
    } else {
        importStatus.innerText = '❌ Chỉ hỗ trợ .json, .xlsx, .txt';
    }
    fileInput.value = '';
});

function escapeHtml(str) {
    return str.replace(/[&<>]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Sự kiện nút
exitQuizBtn.addEventListener('click', () => {
    if (confirm('Về trang chủ? Tiến trình sẽ mất.')) resetToHome();
});
homeFromResults.addEventListener('click', () => resetToHome());
document.getElementById('btnNormal').addEventListener('click', () => startQuiz('normal'));
document.getElementById('btnChallenge').addEventListener('click', () => startQuiz('challenge'));

resetToHome();