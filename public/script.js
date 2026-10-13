/* =========================================================
 * Tebak Kata AI - mini game tebak kata dengan Gemini
 * Semua kata, clue, dan diskusi dihasilkan lewat endpoint /api/chat
 * ========================================================= */

const SERVER_URL = 'http://localhost:3000';
const API_URL =
  location.origin === SERVER_URL ? '/api/chat' : `${SERVER_URL}/api/chat`;

const SCORING = {
  start: 100,
  perQuestion: 10,
  perWrongGuess: 5,
  perReveal: 15,
  min: 1,
};

const THEMES = {
  otomotif: {
    label: '🚗 Otomotif',
    prompt: 'otomotif: komponen kendaraan, istilah bengkel, merek atau jenis kendaraan, dunia balap',
  },
  indonesia: {
    label: '🇮🇩 Umum Indonesia',
    prompt: 'pengetahuan umum Indonesia: budaya, kuliner, tempat wisata, sejarah, flora-fauna, tokoh, alat musik tradisional',
  },
  internasional: {
    label: '🌍 Umum Internasional',
    prompt: 'pengetahuan umum internasional: negara, bangunan terkenal, hewan, olahraga, sains, sejarah dunia',
  },
  campuran: { label: '🎲 Campuran' },
};

const PLAYABLE_THEMES = ['otomotif', 'indonesia', 'internasional'];

/* ---------------- Layanan Gemini (lewat backend) ---------------- */
const GeminiAI = {
  async chat(messages, systemInstruction, temperature, retries = 2) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, systemInstruction, temperature }),
      });
    } catch {
      throw new Error(`Server tidak bisa dihubungi di ${SERVER_URL}. Jalankan "npm start" di folder gemini-chatbot-api.`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = /quota/i.test(data.error || '')
        ? 'Kuota harian Gemini untuk model ini sudah habis. Ganti GEMINI_MODEL di file .env lalu restart server.'
        : data.error || `Server error (${res.status})`;
      if (retries > 0 && /high demand|overloaded|unavailable|try again|fetch failed|timeout/i.test(message)) {
        await new Promise((r) => setTimeout(r, 1500));
        return this.chat(messages, systemInstruction, temperature, retries - 1);
      }
      throw new Error(message);
    }
    if (!data.text) throw new Error('AI tidak mengembalikan jawaban.');
    return data.text.replace(/\*\*(.+?)\*\*/g, '$1').trim();
  },

  parseJSON(text) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Format jawaban AI tidak valid.');
    return JSON.parse(match[0]);
  },

  async generateWord(themeKey, usedWords, playerName) {
    const theme = THEMES[themeKey];
    const avoid = usedWords.length ? usedWords.join(', ') : '-';

    const systemInstruction =
      'Kamu adalah game master permainan tebak kata berbahasa Indonesia. ' +
      'Tugasmu memilih satu kata rahasia dan membuat clue yang menarik. ' +
      'Balas HANYA dengan JSON valid tanpa teks lain dan tanpa markdown.';

    const prompt = `Buat satu kata rahasia untuk tema ${theme.prompt}.

Aturan kata:
- Satu kata saja, tanpa spasi, tanda hubung, atau angka (hanya huruf A-Z).
- Panjang 4 sampai 10 huruf.
- Dikenal luas oleh orang Indonesia dan ditulis dengan ejaan yang umum dipakai di Indonesia.
- Jangan gunakan kata-kata ini: ${avoid}.

Aturan clue:
- 2-3 kalimat, sudut pandang orang pertama ("Aku ..."), seperti teka-teki.
- Tidak boleh menyebut kata rahasia atau bagian katanya.
- Cukup membantu, tapi jangan terlalu mudah.

Sapaan:
- 1-2 kalimat santai menyapa pemain bernama ${playerName}, ajak dia membaca clue dan bertanya bila perlu.
- Jangan membocorkan kata rahasia.

Format JSON:
{"answer": "KATA", "category": "kategori singkat", "clue": "clue", "greeting": "sapaan"}`;

    const text = await this.chat([{ role: 'user', content: prompt }], systemInstruction, 1);
    const data = this.parseJSON(text);
    const answer = String(data.answer || '').toUpperCase().replace(/[^A-Z]/g, '');

    if (answer.length < 3 || answer.length > 12) {
      throw new Error('AI memberikan kata yang tidak sesuai aturan.');
    }

    return {
      answer,
      category: data.category || 'Umum',
      clue: maskAnswer(data.clue || '', answer),
      greeting: maskAnswer(data.greeting || '', answer),
    };
  },
};

/* ---------------- Narasi untuk AI teman diskusi ---------------- */
function buildDiscussionInstruction() {
  const { answer, category, clue } = state.word;
  const letters = [...answer].map((ch, i) => `${i + 1}=${ch}`).join(', ');
  const vowels = (answer.match(/[AIUEO]/g) || []).length;
  const revealed = [...state.revealed]
    .sort((a, b) => a - b)
    .map((i) => `${i + 1}=${answer[i]}`)
    .join(', ');

  return `Kamu adalah teman diskusi yang ramah dalam permainan tebak kata. Pemain bernama ${state.playerName}.
Kata rahasia: ${answer} (kategori: ${category}).
Clue yang sudah dilihat pemain: "${clue}"

Data akurat tentang kata (gunakan ini, jangan menghitung sendiri):
- Jumlah huruf: ${answer.length}
- Huruf per posisi: ${letters}
- Jumlah huruf vokal: ${vowels}
- Huruf yang sudah dibuka di kotak jawaban: ${revealed || 'belum ada'}

Aturan wajib:
1. JANGAN PERNAH menyebut, mengeja lengkap, atau menuliskan kata rahasia dalam bentuk apa pun.
2. Dalam satu jawaban, beri informasi paling banyak SATU huruf.
3. Jika pemain menebak kata di chat, jangan konfirmasi benar/salah. Minta dia mengetikkan tebakannya di kotak huruf.
4. Jawab pertanyaan ya/tidak dengan jujur, lalu boleh tambahkan petunjuk kecil.
5. Jika diminta petunjuk, berikan petunjuk baru yang belum pernah kamu berikan, bertahap dari yang samar ke yang lebih jelas.
6. Gunakan bahasa Indonesia santai, singkat (maksimal 3 kalimat), tanpa format markdown, boleh pakai emoji secukupnya.
7. Pesan yang diawali [INFO GAME] adalah laporan sistem, bukan pertanyaan pemain. Tanggapi sesuai instruksinya.`;
}

function maskAnswer(text, answer) {
  if (!answer) return text;
  return text.replace(new RegExp(answer.split('').join('[\\s\\-.]*'), 'gi'), '■■■');
}

async function talkToAI(content, { countAsQuestion }) {
  state.chatHistory.push({ role: 'user', content });
  const typing = showTyping();
  try {
    const reply = await GeminiAI.chat(state.chatHistory, buildDiscussionInstruction(), 0.7);
    const safeReply = maskAnswer(reply, state.word.answer);
    state.chatHistory.push({ role: 'model', content: safeReply });
    typing.remove();
    addMessage('ai', safeReply);
    return true;
  } catch (err) {
    state.chatHistory.pop();
    typing.remove();
    addMessage(
      'system',
      `Gagal menghubungi AI: ${err.message}${countAsQuestion ? ' (nilai tidak dikurangi)' : ''}`
    );
    return false;
  }
}

/* ---------------- State ---------------- */
const state = {
  playerName: '',
  theme: null,
  round: 0,
  scores: [],
  usedWords: [],
  word: null,
  roundToken: null,
  chatHistory: [],
  questions: 0,
  wrongGuesses: 0,
  reveals: 0,
  revealed: new Set(),
  finished: false,
  busy: false,
};

/* ---------------- DOM ---------------- */
const $ = (sel) => document.querySelector(sel);
const el = {
  screenStart: $('#screen-start'),
  screenGame: $('#screen-game'),
  playerName: $('#player-name'),
  themeCards: document.querySelectorAll('.theme-card'),
  btnStart: $('#btn-start'),
  btnBack: $('#btn-back'),
  themeBadge: $('#theme-badge'),
  roundNumber: $('#round-number'),
  playerLabel: $('#player-label'),
  avgScore: $('#avg-score'),
  scoreValue: $('#score-value'),
  scoreBarFill: $('#score-bar-fill'),
  statQuestions: $('#stat-questions'),
  statWrong: $('#stat-wrong'),
  statReveal: $('#stat-reveal'),
  letterBoxes: $('#letter-boxes'),
  feedback: $('#answer-feedback'),
  btnReveal: $('#btn-reveal'),
  btnGiveUp: $('#btn-giveup'),
  btnSubmit: $('#btn-submit'),
  clueContent: $('#clue-content'),
  clueCategory: $('#clue-category'),
  clueLength: $('#clue-length'),
  chatMessages: $('#chat-messages'),
  chatForm: $('#chat-form'),
  chatInput: $('#chat-input'),
  chatSend: $('#chat-send'),
  chips: document.querySelectorAll('.chip'),
  modal: $('#result-modal'),
  resultIcon: $('#result-icon'),
  resultTitle: $('#result-title'),
  resultText: $('#result-text'),
  resultAI: $('#result-ai'),
  resultWord: $('#result-word'),
  resultScore: $('#result-score'),
  btnNext: $('#btn-next'),
  btnChangeTheme: $('#btn-change-theme'),
};

/* ---------------- Skor ---------------- */
function calculateScore() {
  const penalty =
    state.questions * SCORING.perQuestion +
    state.wrongGuesses * SCORING.perWrongGuess +
    state.reveals * SCORING.perReveal;
  return Math.max(SCORING.min, SCORING.start - penalty);
}

function scoreColor(score) {
  if (score >= 70) return 'var(--success)';
  if (score >= 40) return 'var(--warning)';
  return 'var(--danger)';
}

function updateScoreUI() {
  const score = calculateScore();
  el.scoreValue.textContent = score;
  el.scoreBarFill.style.width = `${score}%`;
  el.scoreBarFill.style.background = scoreColor(score);
  el.statQuestions.textContent = state.questions;
  el.statWrong.textContent = state.wrongGuesses;
  el.statReveal.textContent = state.reveals;
}

function updateAverage() {
  if (state.scores.length === 0) {
    el.avgScore.textContent = '-';
    return;
  }
  const avg = state.scores.reduce((a, b) => a + b, 0) / state.scores.length;
  el.avgScore.textContent = `${Math.round(avg)}%`;
}

/* ---------------- Layar ---------------- */
function showScreen(name) {
  el.screenStart.classList.toggle('active', name === 'start');
  el.screenGame.classList.toggle('active', name === 'game');
}

function refreshStartButton() {
  el.btnStart.disabled = !(state.theme && el.playerName.value.trim());
}

/* ---------------- Kotak huruf ---------------- */
function getInputs() {
  return [...el.letterBoxes.querySelectorAll('.letter-box')];
}

function renderLetterBoxes(answer) {
  el.letterBoxes.innerHTML = '';
  el.letterBoxes.classList.remove('shake');
  [...answer].forEach((char, i) => {
    const input = document.createElement('input');
    input.className = 'letter-box';
    input.maxLength = 1;
    input.dataset.index = i;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', `Huruf ke-${i + 1}`);
    el.letterBoxes.appendChild(input);
  });
  attachLetterEvents();
}

function focusNext(inputs, from, step) {
  let i = from + step;
  while (i >= 0 && i < inputs.length) {
    if (!inputs[i].readOnly) return inputs[i].focus();
    i += step;
  }
}

function attachLetterEvents() {
  const inputs = getInputs();
  inputs.forEach((input, idx) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
      if (input.value) focusNext(inputs, idx, 1);
      el.feedback.textContent = '';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value) {
        e.preventDefault();
        focusNext(inputs, idx, -1);
      } else if (e.key === 'ArrowLeft') {
        focusNext(inputs, idx, -1);
      } else if (e.key === 'ArrowRight') {
        focusNext(inputs, idx, 1);
      } else if (e.key === 'Enter') {
        submitAnswer();
      }
    });
    input.addEventListener('focus', () => input.select());
  });
  const first = inputs.find((i) => !i.readOnly);
  if (first) first.focus();
}

function getGuess() {
  return getInputs()
    .map((i) => i.value || '_')
    .join('');
}

/* ---------------- Chat ---------------- */
function addMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;
  if (role !== 'system') {
    const avatar = document.createElement('div');
    avatar.className = `avatar ${role}`;
    avatar.textContent = role === 'ai' ? '🤖' : '🙂';
    wrap.appendChild(avatar);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  el.chatMessages.appendChild(wrap);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  return wrap;
}

function showTyping() {
  const wrap = addMessage('ai', '');
  wrap.querySelector('.bubble').innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  return wrap;
}

function setChatEnabled(enabled) {
  el.chatInput.disabled = !enabled;
  el.chatSend.disabled = !enabled;
  el.chips.forEach((c) => (c.disabled = !enabled));
}

async function askAI(question) {
  if (state.busy || state.finished || !state.word || !question.trim()) return;
  state.busy = true;
  setChatEnabled(false);

  addMessage('user', question);
  state.questions++;
  updateScoreUI();

  const ok = await talkToAI(question, { countAsQuestion: true });
  if (!ok) {
    state.questions--;
    updateScoreUI();
  }

  state.busy = false;
  if (!state.finished) {
    setChatEnabled(true);
    el.chatInput.focus();
  }
}

/* ---------------- Alur permainan ---------------- */
async function startRound() {
  state.round++;
  state.word = null;
  state.chatHistory = [];
  state.questions = 0;
  state.wrongGuesses = 0;
  state.reveals = 0;
  state.revealed = new Set();
  state.finished = false;

  el.roundNumber.textContent = state.round;
  el.feedback.textContent = '';
  el.feedback.className = 'answer-feedback';
  el.letterBoxes.innerHTML = '';
  el.chatMessages.innerHTML = '';
  el.clueCategory.textContent = '-';
  el.clueLength.textContent = '-';
  el.clueContent.innerHTML = '<div class="skeleton"></div><div class="skeleton short"></div>';
  setChatEnabled(false);
  setActionsEnabled(false);
  updateScoreUI();

  const themeKey =
    state.theme === 'campuran'
      ? PLAYABLE_THEMES[Math.floor(Math.random() * PLAYABLE_THEMES.length)]
      : state.theme;

  addMessage('system', 'AI sedang memikirkan kata rahasia...');

  const token = {};
  state.roundToken = token;

  let word;
  try {
    word = await GeminiAI.generateWord(themeKey, state.usedWords, state.playerName);
  } catch (err) {
    if (state.roundToken !== token) return;
    state.round--;
    showRoundError(err.message);
    return;
  }
  if (state.roundToken !== token) return;

  state.word = word;
  state.usedWords.push(word.answer);

  el.clueContent.textContent = word.clue;
  el.clueCategory.textContent =
    state.theme === 'campuran' ? `${word.category} (${THEMES[themeKey].label})` : word.category;
  el.clueLength.textContent = `${word.answer.length} huruf`;
  renderLetterBoxes(word.answer);

  el.chatMessages.innerHTML = '';
  addMessage(
    'ai',
    `${word.greeting || `Halo ${state.playerName}! 👋 Kata rahasianya sudah siap.`}\n\nSetiap pertanyaan ke aku mengurangi nilaimu ${SCORING.perQuestion}% ya!`
  );
  setChatEnabled(true);
  setActionsEnabled(true);
}

function showRoundError(message) {
  el.clueContent.innerHTML = '';
  const text = document.createElement('p');
  text.className = 'answer-feedback error';
  text.textContent = `AI gagal menyiapkan kata: ${message}`;
  const retry = document.createElement('button');
  retry.className = 'btn btn-primary';
  retry.textContent = '🔄 Coba Lagi';
  retry.addEventListener('click', startRound);
  el.clueContent.append(text, retry);
  addMessage('system', 'Gagal terhubung ke AI. Pastikan server berjalan, lalu klik "Coba Lagi".');
}

function setActionsEnabled(enabled) {
  el.btnSubmit.disabled = !enabled;
  el.btnGiveUp.disabled = !enabled;
  el.btnReveal.disabled = !enabled;
}

function submitAnswer() {
  if (!state.word || state.finished) return;
  const guess = getGuess();
  const target = state.word.answer;

  if (guess.includes('_')) {
    el.feedback.textContent = 'Isi semua kotak huruf terlebih dahulu.';
    el.feedback.className = 'answer-feedback error';
    return;
  }

  if (guess === target) {
    getInputs().forEach((i) => {
      i.classList.add('correct');
      i.readOnly = true;
    });
    el.feedback.textContent = 'Jawaban benar! 🎉';
    el.feedback.className = 'answer-feedback ok';
    finishRound(true);
    return;
  }

  state.wrongGuesses++;
  updateScoreUI();
  el.feedback.textContent = `Belum tepat, coba lagi! (-${SCORING.perWrongGuess}%)`;
  el.feedback.className = 'answer-feedback error';
  el.letterBoxes.classList.remove('shake');
  void el.letterBoxes.offsetWidth;
  el.letterBoxes.classList.add('shake');

  reactToWrongGuess(guess);
}

async function reactToWrongGuess(guess) {
  if (state.busy) return;
  const correctPositions = [...guess].filter((ch, i) => ch === state.word.answer[i]).length;

  state.busy = true;
  setChatEnabled(false);
  addMessage('system', `Tebakan "${guess}" belum tepat.`);
  await talkToAI(
    `[INFO GAME] Pemain baru saja menebak "${guess}" di kotak jawaban dan SALAH. ` +
      `${correctPositions} dari ${guess.length} huruf sudah berada di posisi yang benar. ` +
      'Beri reaksi singkat yang menyemangati dan komentari apakah tebakannya sudah mendekati makna kata rahasia. ' +
      'Jangan beri petunjuk huruf baru.',
    { countAsQuestion: false }
  );
  state.busy = false;
  if (!state.finished) setChatEnabled(true);
}

function revealLetter() {
  if (!state.word || state.finished) return;
  const inputs = getInputs();
  const target = state.word.answer;
  const hidden = inputs
    .map((input, i) => ({ input, i }))
    .filter(({ input }) => !input.readOnly);

  if (hidden.length <= 1) {
    el.feedback.textContent = 'Tinggal satu huruf, coba tebak sendiri! 💪';
    el.feedback.className = 'answer-feedback error';
    return;
  }

  const pick = hidden[Math.floor(Math.random() * hidden.length)];
  pick.input.value = target[pick.i];
  pick.input.readOnly = true;
  pick.input.classList.add('revealed');
  state.revealed.add(pick.i);
  state.reveals++;
  updateScoreUI();
  addMessage('system', `Huruf ke-${pick.i + 1} dibuka (-${SCORING.perReveal}%).`);
}

function giveUp() {
  if (!state.word || state.finished) return;
  if (!confirm('Yakin ingin menyerah? Nilai ronde ini akan menjadi 0%.')) return;
  finishRound(false);
}

function finishRound(won) {
  state.finished = true;
  setChatEnabled(false);
  setActionsEnabled(false);

  const score = won ? calculateScore() : 0;
  state.scores.push(score);
  updateAverage();

  el.resultIcon.textContent = won ? (score >= 70 ? '🏆' : '🎉') : '😢';
  el.resultTitle.textContent = won ? 'Jawaban Benar!' : 'Kamu Menyerah';
  el.resultText.textContent = won
    ? `Kamu menjawab dengan ${state.questions} pertanyaan, ${state.wrongGuesses} tebakan salah, dan ${state.reveals} huruf dibuka.`
    : 'Tidak apa-apa, coba lagi di kata berikutnya!';
  el.resultWord.textContent = state.word.answer;
  el.resultScore.textContent = score;
  el.resultScore.parentElement.style.color = scoreColor(score);

  setTimeout(() => el.modal.classList.remove('hidden'), won ? 700 : 0);
  showClosingComment(won, score);
}

async function showClosingComment(won, score) {
  const word = state.word;
  const { answer, category } = word;
  el.resultAI.textContent = '🤖 AI sedang menulis komentar...';

  const prompt = won
    ? `Pemain bernama ${state.playerName} BERHASIL menebak kata "${answer}" (kategori: ${category}) ` +
      `dengan ${state.questions} pertanyaan, ${state.wrongGuesses} tebakan salah, dan ${state.reveals} huruf dibuka. Nilainya ${score}%. ` +
      'Beri ucapan selamat yang sesuai dengan nilainya, lalu satu fakta menarik singkat tentang kata tersebut.'
    : `Pemain bernama ${state.playerName} MENYERAH dan gagal menebak kata "${answer}" (kategori: ${category}). ` +
      'Hibur dia dengan singkat, jelaskan arti kata tersebut dalam satu kalimat, dan semangati untuk ronde berikutnya.';

  try {
    const text = await GeminiAI.chat(
      [{ role: 'user', content: prompt }],
      'Kamu adalah pembawa acara permainan tebak kata yang hangat dan ceria. Jawab dalam bahasa Indonesia santai, maksimal 3 kalimat, tanpa markdown.',
      0.8
    );
    if (state.word === word) el.resultAI.textContent = `🤖 ${text}`;
  } catch {
    if (state.word === word) el.resultAI.textContent = '';
  }
}

function backToMenu() {
  el.modal.classList.add('hidden');
  state.round = 0;
  state.scores = [];
  state.usedWords = [];
  state.word = null;
  state.roundToken = null;
  updateAverage();
  showScreen('start');
}

/* ---------------- Event listeners ---------------- */
el.themeCards.forEach((card) => {
  card.addEventListener('click', () => {
    el.themeCards.forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    state.theme = card.dataset.theme;
    refreshStartButton();
  });
});

el.playerName.addEventListener('input', refreshStartButton);
el.playerName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !el.btnStart.disabled) el.btnStart.click();
});

el.btnStart.addEventListener('click', () => {
  state.playerName = el.playerName.value.trim();
  el.playerLabel.textContent = state.playerName;
  el.themeBadge.textContent = THEMES[state.theme].label;
  showScreen('game');
  startRound();
});

el.btnBack.addEventListener('click', () => {
  if (!state.finished && state.word && !confirm('Kembali ke menu? Progres ronde ini akan hilang.')) return;
  backToMenu();
});

el.btnSubmit.addEventListener('click', submitAnswer);
el.btnReveal.addEventListener('click', revealLetter);
el.btnGiveUp.addEventListener('click', giveUp);

el.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.chatInput.value;
  el.chatInput.value = '';
  askAI(text);
});

el.chips.forEach((chip) => {
  chip.addEventListener('click', () => askAI(chip.textContent));
});

el.btnNext.addEventListener('click', () => {
  el.modal.classList.add('hidden');
  startRound();
});

el.btnChangeTheme.addEventListener('click', backToMenu);
