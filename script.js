
// ---------- DỮ LIỆU MẶC ĐỊNH ----------
let masterQuestions = [   // bộ câu hỏi gốc (chưa shuffle, chưa cắt)
    { text: "Thủ đô của Việt Nam là?", options: ["Đà Nẵng", "Hồ Chí Minh", "Hà Nội", "Hải Phòng"], correct: 2 },
    { text: "Ngôn ngữ lập trình nào được dùng nhiều cho web?", options: ["Python", "Java", "C++", "JavaScript"], correct: 3 },
    { text: "Mặt trời mọc hướng nào?", options: ["Tây", "Nam", "Bắc", "Đông"], correct: 3 },
    { text: "2 + 3 × 4 bằng bao nhiêu?", options: ["20", "14", "24", "12"], correct: 1 },
    { text: "Ai là tác giả của 'Truyện Kiều'?", options: ["Nguyễn Du", "Hồ Xuân Hương", "Nguyễn Đình Chiểu", "Tố Hữu"], correct: 0 }
];

let selectedQuantity = 20;     // số câu muốn lấy (mặc định 20)
let totalMasterCount = masterQuestions.length;

// Biến cho quiz hiện tại (sau khi lấy ngẫu nhiên và shuffle)
let currentQuestions = [];
let TOTAL_QS = 0;

// State
let currentMode = "normal";
let currentIndex = 0;
let userAnswers = [];
let timerInterval = null;
let canAnswer = true;
let feedbackTimeout = null;

// DOM
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
const quantitySelectorDiv = document.getElementById('quantitySelector');
const selectedInfoSpan = document.getElementById('selectedInfo');

// Helper: shuffle mảng
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Shuffle đáp án của một câu, trả về câu mới
function shuffleOptions(question) {
    const originalOptions = [...question.options];
    const originalCorrect = question.correct;
    let indices = [0, 1, 2, 3];
    indices = shuffleArray(indices);
    const newOptions = indices.map(i => originalOptions[i]);
    const newCorrect = indices.indexOf(originalCorrect);
    return {
        text: question.text,
        options: newOptions,
        correct: newCorrect
    };
}

// Lấy ngẫu nhiên N câu từ masterQuestions (không trùng)
function getRandomQuestions(n) {
    if (n >= masterQuestions.length) {
        return [...masterQuestions]; // lấy toàn bộ
    }
    // shuffle bản sao của master và lấy n phần tử đầu
    const shuffledMaster = shuffleArray([...masterQuestions]);
    return shuffledMaster.slice(0, n);
}

// Chuẩn bị bộ câu hỏi cho quiz: lấy ngẫu nhiên selectedQuantity câu, rồi shuffle đáp án từng câu
function prepareQuizQuestions() {
    let rawQuestions = getRandomQuestions(selectedQuantity);
    // Shuffle đáp án trong từng câu
    rawQuestions = rawQuestions.map(q => shuffleOptions(q));
    // Shuffle thứ tự câu hỏi lần nữa (tạo sự ngẫu nhiên)
    rawQuestions = shuffleArray(rawQuestions);
    return rawQuestions;
}

// Cập nhật giao diện hiển thị số câu đã chọn
function updateSelectedInfo() {
    if (quantitySelectorDiv.style.display === 'block') {
        let displayText = `Đã chọn `;
        if (selectedQuantity === -1 || selectedQuantity >= masterQuestions.length) {
            displayText += `TẤT CẢ (${masterQuestions.length} câu)`;
        } else {
            displayText += `${selectedQuantity} / ${masterQuestions.length} câu`;
        }
        selectedInfoSpan.innerText = displayText;
    }
}

// Khi import thành công, hiển thị quantitySelector và cập nhật mặc định
function afterImportSuccessful() {
    totalMasterCount = masterQuestions.length;
    importStatus.innerText = `✅ Đã import thành công ${totalMasterCount} câu hỏi!`;
    quantitySelectorDiv.style.display = 'block';
    // Đảm bảo selectedQuantity không vượt quá tổng số câu
    if (selectedQuantity > totalMasterCount && selectedQuantity !== -1) {
        selectedQuantity = totalMasterCount;
        // Cập nhật active button
        document.querySelectorAll('.quantity-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-q') === 'all' || (btn.getAttribute('data-q') == totalMasterCount)) {
                btn.classList.add('active');
            }
        });
    }
    updateSelectedInfo();
    resetToHome(); // về home để hiển thị lựa chọn mới
}

// Hàm reset về home (giữ masterQuestions và selectedQuantity)
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

// Chế độ bình thường: hiển thị feedback
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

function handleAnswer(selectedIndex) {
    if (!canAnswer) return;
    const q = currentQuestions[currentIndex];
    const correctIdx = q.correct;
    const isCorrect = (selectedIndex === correctIdx);
    userAnswers[currentIndex] = { selected: selectedIndex, isCorrect: isCorrect };

    if (currentMode === 'normal') {
        showFeedbackAndNext(selectedIndex, correctIdx, isCorrect);
    } else {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        canAnswer = false;
        moveToNextQuestion();
    }
}

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

// Bắt đầu quiz: lấy câu hỏi dựa trên selectedQuantity và masterQuestions
function startQuiz(mode) {
    if (timerInterval) clearInterval(timerInterval);
    if (feedbackTimeout) clearTimeout(feedbackTimeout);

    if (!masterQuestions.length) {
        alert("Chưa có câu hỏi nào. Hãy import file trước.");
        resetToHome();
        return;
    }
    // Tính số câu thực tế sẽ lấy
    let takeCount = selectedQuantity;
    if (takeCount === -1 || takeCount > masterQuestions.length) {
        takeCount = masterQuestions.length;
    }
    if (takeCount === 0) {
        alert("Không có câu hỏi để làm quiz.");
        resetToHome();
        return;
    }

    currentQuestions = prepareQuizQuestions(); // đã lấy ngẫu nhiên takeCount câu và shuffle
    TOTAL_QS = currentQuestions.length;
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
    for (let q of newQuestions) {
        if (!q.text || !Array.isArray(q.options) || q.options.length !== 4 || typeof q.correct !== 'number' || q.correct < 0 || q.correct > 3) {
            importStatus.innerText = '❌ Dữ liệu sai định dạng. Mỗi câu cần text, options (4 mục), correct (0-3).';
            return false;
        }
    }
    masterQuestions = newQuestions;
    totalMasterCount = masterQuestions.length;
    // Điều chỉnh selectedQuantity nếu cần
    if (selectedQuantity === -1 || selectedQuantity > totalMasterCount) {
        selectedQuantity = totalMasterCount;
        // Kích hoạt nút "Tất cả" trong UI
        document.querySelectorAll('.quantity-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-q') === 'all') btn.classList.add('active');
        });
    } else if (selectedQuantity > totalMasterCount) {
        selectedQuantity = totalMasterCount;
    }
    afterImportSuccessful();
    return true;
}

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

// Sự kiện cho các nút chọn số câu
document.querySelectorAll('.quantity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const qVal = btn.getAttribute('data-q');
        if (qVal === 'all') {
            selectedQuantity = -1;  // -1 đại diện cho "Tất cả"
        } else {
            selectedQuantity = parseInt(qVal, 10);
        }
        // Cập nhật active class
        document.querySelectorAll('.quantity-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Nếu tổng số câu đã import ít hơn số lượng chọn, tự động chuyển thành "Tất cả"
        if (selectedQuantity !== -1 && selectedQuantity > masterQuestions.length) {
            selectedQuantity = masterQuestions.length;
            // Tìm nút "Tất cả" và active
            document.querySelectorAll('.quantity-btn').forEach(b => b.classList.remove('active'));
            const allBtn = document.querySelector('.quantity-btn[data-q="all"]');
            if (allBtn) allBtn.classList.add('active');
        }
        updateSelectedInfo();
        resetToHome();
    });
});

function escapeHtml(str) {
    return str.replace(/[&<>]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

exitQuizBtn.addEventListener('click', () => {
    if (confirm('Về trang chủ? Tiến trình sẽ mất.')) resetToHome();
});
homeFromResults.addEventListener('click', () => resetToHome());
document.getElementById('btnNormal').addEventListener('click', () => startQuiz('normal'));
document.getElementById('btnChallenge').addEventListener('click', () => startQuiz('challenge'));

// Khởi tạo ban đầu (hiển thị home, nếu có dữ liệu mặc định thì show quantitySelector)
if (masterQuestions.length) {
    quantitySelectorDiv.style.display = 'block';
    updateSelectedInfo();
}
resetToHome();
