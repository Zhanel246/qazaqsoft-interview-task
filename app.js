// ========== Константы и ключи хранилища ==========
const STORAGE_KEYS = {
  STATE: "quiz.state.v1",
};
const DATA_URL = "./data/questions.json";

// ========== Модели ==========
/**
 * @typedef {{ id: string; text: string; options: string[]; correctIndex: number; topic?: string }} QuestionDTO
 * @typedef {{ title: string; timeLimitSec: number; passThreshold: number; questions: QuestionDTO[] }} QuizDTO
 */

class Question {
  /** @param {QuestionDTO} dto */
  constructor(dto) {
    this.id = dto.id;
    this.text = dto.text;
    this.options = dto.options;
    this.correctIndex = dto.correctIndex;
    this.topic = dto.topic ?? null;
  }
}

// ========== Сервисы ==========
class StorageService {
  static saveState(state) {
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
  }

  static loadState() {
    const data = localStorage.getItem(STORAGE_KEYS.STATE);
    return data ? JSON.parse(data) : null;
  }

  static clear() {
    localStorage.removeItem(STORAGE_KEYS.STATE);
  }
}

// ========== Движок теста ==========
class QuizEngine {
  /** @param {QuizDTO} quiz */
  constructor(quiz) {
    this.title = quiz.title;
    this.timeLimitSec = quiz.timeLimitSec;
    this.passThreshold = quiz.passThreshold;
    this.questions = quiz.questions.map((q) => new Question(q));

    this.currentIndex = 0;
    /** @type {Record<string, number|undefined>} */
    this.answers = {}; // questionId -> selectedIndex
    this.remainingSec = quiz.timeLimitSec;
    this.isFinished = false;
  }

  get length() {
    return this.questions.length;
  }
  
  get currentQuestion() {
    return this.questions[this.currentIndex];
  }

  /** @param {number} index */
  goTo(index) {
    if (index >= 0 && index < this.questions.length) {
      this.currentIndex = index;
    }
  }

  next() {
    if (this.currentIndex < this.questions.length - 1) {
      this.currentIndex++;
    }
  }

  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
    }
  }

  /** @param {number} optionIndex */
  select(optionIndex) {
    this.answers[this.currentQuestion.id] = optionIndex;
  }

  getSelectedIndex() {
    return this.answers[this.currentQuestion.id];
  }

  tick() {
    if (this.isFinished) return;
    
    this.remainingSec--;
    if (this.remainingSec <= 0) {
      this.remainingSec = 0;
      this.finish();
    }
  }

  finish() {
    this.isFinished = true;
    
    let correct = 0;
    this.questions.forEach((q) => {
      if (this.answers[q.id] === q.correctIndex) {
        correct++;
      }
    });
    
    const total = this.questions.length;
    const percent = correct / total;
    const passed = percent >= this.passThreshold;
    
    return { correct, total, percent, passed };
  }

  /** Восстановление/выгрузка состояния для localStorage */
  toState() {
    return {
      currentIndex: this.currentIndex,
      answers: this.answers,
      remainingSec: this.remainingSec,
      isFinished: this.isFinished,
      timeLimitSec: this.timeLimitSec,
      passThreshold: this.passThreshold
    };
  }

  /** @param {any} state */
  static fromState(quiz, state) {
    const engine = new QuizEngine(quiz);
    engine.currentIndex = state.currentIndex || 0;
    engine.answers = state.answers || {};
    engine.remainingSec = state.remainingSec ?? quiz.timeLimitSec;
    engine.isFinished = state.isFinished || false;
    return engine;
  }
}

// ========== DOM-утилиты ==========
const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const els = {
  title: $("#quiz-title"),
  progress: $("#progress"),
  timer: $("#timer"),
  qSection: $("#question-section"),
  qText: $("#question-text"),
  form: $("#options-form"),
  btnPrev: $("#btn-prev"),
  btnNext: $("#btn-next"),
  btnFinish: $("#btn-finish"),
  result: $("#result-section"),
  resultSummary: $("#result-summary"),
  btnReview: $("#btn-review"),
  btnRestart: $("#btn-restart"),
};

let engine = /** @type {QuizEngine|null} */ (null);
let timerId = /** @type {number|undefined} */ (undefined);
let reviewMode = false;

// ========== Инициализация ==========
document.addEventListener("DOMContentLoaded", async () => {
  const quiz = await loadQuiz();
  els.title.textContent = quiz.title;

  const saved = StorageService.loadState();
  if (saved) {
    engine = QuizEngine.fromState(quiz, saved);
  } else {
    engine = new QuizEngine(quiz);
  }

  bindEvents();
  renderAll();

  if (!engine.isFinished) {
    startTimer();
  } else {
    const summary = engine.finish();
    renderResult(summary);
  }
});

async function loadQuiz() {
  const res = await fetch(DATA_URL);
  /** @type {QuizDTO} */
  const data = await res.json();
  if (!data?.questions?.length) {
    throw new Error("Некорректные данные теста");
  }
  return data;
}

// ========== Таймер ==========
function startTimer() {
  stopTimer();
  timerId = window.setInterval(() => {
    engine.tick();
    persist();
    renderTimer();
    
    if (engine.isFinished) {
      stopTimer();
      const summary = engine.finish();
      renderResult(summary);
    }
  }, 1000);
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = undefined;
  }
}

// ========== События ==========
function bindEvents() {
  els.btnPrev.addEventListener("click", () => {
    engine.prev();
    persist();
    renderAll();
  });

  els.btnNext.addEventListener("click", () => {
    engine.next();
    persist();
    renderAll();
  });

  els.btnFinish.addEventListener("click", () => {
    const summary = engine.finish();
    if (summary) {
      stopTimer();
      renderResult(summary);
      persist();
    }
  });

  els.btnReview.addEventListener("click", () => {
    reviewMode = true;
    engine.currentIndex = 0;
    els.qSection.classList.remove('hidden');
    els.result.classList.add('hidden');
    renderAll();
  });

  els.btnRestart.addEventListener("click", () => {
    StorageService.clear();
    window.location.reload();
  });

  els.form.addEventListener("change", (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (target?.name === "option") {
      const idx = Number(target.value);
      engine.select(idx);
      persist();
      renderNav();
    }
  });
}

// ========== Рендер ==========
function renderAll() {
  renderProgress();
  renderTimer();
  renderQuestion();
  renderNav();
}

function renderProgress() {
  els.progress.textContent = `Вопрос ${engine.currentIndex + 1} из ${engine.length}`;
}

function renderTimer() {
  const sec = engine.remainingSec ?? 0;
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  els.timer.textContent = `${m}:${s}`;
}

function renderQuestion() {

  if (engine.isFinished && !reviewMode) {
    els.qSection.classList.add('hidden');
    return;
  }
  

  if (reviewMode) {
    els.qSection.classList.remove('hidden');
  }
  
  const q = engine.currentQuestion;
  els.qText.textContent = q.text;

  els.form.innerHTML = "";
  q.options.forEach((opt, i) => {
    const id = `opt-${q.id}-${i}`;
    const wrapper = document.createElement("label");
    wrapper.className = "option";
    wrapper.setAttribute("for", id);
    
    if (reviewMode) {
      const chosen = engine.answers[q.id];
      if (i === q.correctIndex) wrapper.classList.add("correct");
      if (chosen === i && i !== q.correctIndex) wrapper.classList.add("incorrect");
    }

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "option";
    input.value = String(i);
    input.id = id;
    input.checked = engine.getSelectedIndex() === i;
    if (reviewMode || engine.isFinished) {
      input.disabled = true;
    }

    const span = document.createElement("span");
    span.textContent = opt;

    wrapper.appendChild(input);
    wrapper.appendChild(span);
    els.form.appendChild(wrapper);
  });
}

function renderNav() {

  if (engine.isFinished && reviewMode) {
    els.btnPrev.style.display = 'inline-block';
    els.btnNext.style.display = 'inline-block';
    els.btnFinish.style.display = 'none';
    els.btnPrev.disabled = engine.currentIndex === 0;
    els.btnNext.disabled = engine.currentIndex === engine.length - 1;
    return;
  }
  

  if (engine.isFinished && !reviewMode) {
    els.btnPrev.style.display = 'none';
    els.btnNext.style.display = 'none';
    els.btnFinish.style.display = 'none';
    return;
  }

  const hasSelection = Number.isInteger(engine.getSelectedIndex());
  els.btnPrev.style.display = 'inline-block';
  els.btnNext.style.display = engine.currentIndex < engine.length - 1 ? 'inline-block' : 'none';
  els.btnFinish.style.display = engine.currentIndex === engine.length - 1 ? 'inline-block' : 'none';
  els.btnPrev.disabled = engine.currentIndex === 0;
  els.btnNext.disabled = !(engine.currentIndex < engine.length - 1 && hasSelection);
  els.btnFinish.disabled = !(engine.currentIndex === engine.length - 1 && hasSelection);
}

function renderResult(summary) {
  els.result.classList.remove("hidden");
  els.qSection.classList.add("hidden");
  
  const pct = Math.round(summary.percent * 100);
  const status = summary.passed ? "Пройден" : "Не пройден";
  els.resultSummary.textContent = `${summary.correct} / ${summary.total} (${pct}%) — ${status}`;
  
  //"Посмотреть ответы" и "Пройти заново"
  els.btnReview.style.display = 'inline-block';
  els.btnRestart.style.display = 'inline-block';
  
  els.btnPrev.style.display = 'none';
  els.btnNext.style.display = 'none';
  els.btnFinish.style.display = 'none';
}

// ========== Persist ==========
function persist() {
  const snapshot = engine.toState();
  if (snapshot) StorageService.saveState(snapshot);
}
