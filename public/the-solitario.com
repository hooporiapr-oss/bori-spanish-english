<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Bori Memory — Hey Bori</title>
<link rel="icon" type="image/png" href="/icon-01F.png">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #0C1B2A;
  --card-back: linear-gradient(145deg, #0050A0, #003872);
  --card-front: #FFFDF8;
  --card-border: rgba(255,215,0,0.15);
  --gold: #FFD700;
  --sun: #FF6B35;
  --green: #22C55E;
  --text: #e8e4d9;
  --text-dim: #7a8899;
  --text-dark: #1A1A1A;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  height: 100%;
  overflow: hidden;
  touch-action: manipulation;
}

body {
  background: var(--bg);
  background-image:
    radial-gradient(ellipse at 20% 10%, rgba(0,80,160,0.15) 0%, transparent 55%),
    radial-gradient(ellipse at 80% 90%, rgba(255,107,53,0.08) 0%, transparent 50%);
  font-family: 'Outfit', sans-serif;
  color: var(--text);
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  position: fixed;
  width: 100%;
}

/* ═══ HEADER ═══ */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: linear-gradient(180deg, rgba(8,20,36,0.97), rgba(12,27,42,0.92));
  border-bottom: 1px solid rgba(255,215,0,0.08);
  height: 50px;
  flex-shrink: 0;
}

.header-left { display: flex; align-items: center; gap: 8px; }

.header-back {
  background: none; border: none; color: var(--gold);
  font-size: 22px; cursor: pointer; padding: 4px 6px; line-height: 1;
}

.header-brand { display: flex; flex-direction: column; }

.header-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 19px; letter-spacing: 2px;
  background: linear-gradient(135deg, var(--gold), #FFA000);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text; line-height: 1.1;
}

.header-sub { font-size: 8px; color: var(--text-dim); letter-spacing: 1.5px; text-transform: uppercase; }

.header-right { display: flex; align-items: center; gap: 12px; }
.stat { text-align: center; }
.stat-label { font-size: 7px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; line-height: 1; }
.stat-value { font-family: 'Bebas Neue', sans-serif; font-size: 18px; color: var(--gold); line-height: 1.1; }

.btn {
  background: linear-gradient(135deg, var(--gold), #FFA000);
  color: #000; border: none; padding: 7px 14px; border-radius: 20px;
  font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 11px;
  cursor: pointer; letter-spacing: 1px; text-transform: uppercase;
}
.btn:active { transform: scale(0.93); }

/* ═══ GAME AREA ═══ */
.game-wrap {
  height: calc(100vh - 50px); height: calc(100dvh - 50px);
  display: flex; flex-direction: column; overflow: hidden;
}

/* ═══ LEVEL SELECT ═══ */
.level-select {
  display: flex; justify-content: center; gap: 6px;
  padding: 10px 12px 6px; flex-shrink: 0;
}

.level-btn {
  padding: 5px 14px; border-radius: 20px;
  border: 1.5px solid rgba(255,215,0,0.15); background: transparent;
  color: var(--text-dim); font-family: 'Outfit', sans-serif;
  font-size: 11px; font-weight: 700; cursor: pointer;
  transition: all 0.2s; letter-spacing: 0.5px;
}
.level-btn.active { background: rgba(255,215,0,0.12); border-color: var(--gold); color: var(--gold); }
.level-btn:active { transform: scale(0.95); }

/* ═══ BOARD ═══ */
.board {
  flex: 1; display: grid; padding: 8px; gap: 8px;
  align-content: center; justify-content: center; overflow: hidden;
}

/* ═══ MEMORY CARD ═══ */
.mem-card {
  position: relative; cursor: pointer;
  perspective: 800px; -webkit-tap-highlight-color: transparent;
}

.mem-card-inner {
  width: 100%; height: 100%; position: relative;
  transform-style: preserve-3d;
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.mem-card.flipped .mem-card-inner,
.mem-card.matched .mem-card-inner { transform: rotateY(180deg); }

.mem-card.matched { animation: matchPop 0.4s ease; }
@keyframes matchPop { 0%{transform:scale(1)} 30%{transform:scale(1.1)} 60%{transform:scale(0.95)} 100%{transform:scale(1)} }

.mem-card.matched .mem-card-front {
  border-color: var(--green);
  box-shadow: 0 0 0 2px var(--green), 0 4px 16px rgba(34,197,94,0.2);
  background: linear-gradient(145deg, #f0fdf4, #FFFDF8);
}

.mem-card.wrong .mem-card-inner { animation: cardShake 0.4s ease; }
@keyframes cardShake {
  0%,100% { transform: rotateY(180deg) translateX(0); }
  25% { transform: rotateY(180deg) translateX(-6px); }
  75% { transform: rotateY(180deg) translateX(6px); }
}

.mem-card-front, .mem-card-back {
  position: absolute; inset: 0; border-radius: 12px;
  backface-visibility: hidden; -webkit-backface-visibility: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}

.mem-card-back {
  background: var(--card-back);
  border: 2px solid var(--card-border);
  box-shadow: 0 3px 12px rgba(0,0,0,0.35);
}
.mem-card-back-icon { font-size: 28px; opacity: 0.6; }
.mem-card-back-label { font-family: 'Bebas Neue', sans-serif; font-size: 10px; color: rgba(255,255,255,0.3); letter-spacing: 2px; margin-top: 4px; }

.mem-card-front {
  background: var(--card-front);
  border: 2px solid #e0dcd0;
  box-shadow: 0 3px 12px rgba(0,0,0,0.25);
  transform: rotateY(180deg);
  gap: 2px; padding: 4px;
}
.mem-card-emoji { line-height: 1; }
.mem-card-name { font-weight: 800; color: var(--text-dark); text-align: center; line-height: 1.2; letter-spacing: 0.3px; max-width: 100%; overflow: hidden; }

/* ═══ BOTTOM BAR ═══ */
.bottom-bar {
  position: fixed; bottom: 0; left: 0; right: 0; height: 68px;
  background: linear-gradient(180deg, rgba(8,20,36,0.95), rgba(6,14,28,0.98));
  border-top: 1px solid rgba(255,215,0,0.08);
  display: flex; align-items: center; justify-content: space-around;
  padding: 0 12px; z-index: 50;
}

.bar-center { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.bar-center-count { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: var(--gold); line-height: 1; }
.bar-center-label { font-size: 8px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }

.bar-btn {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  background: none; border: none; color: var(--text-dim); cursor: pointer;
  padding: 6px 14px; border-radius: 12px; transition: all 0.15s;
  font-family: 'Outfit', sans-serif;
}
.bar-btn:active { background: rgba(255,215,0,0.06); }
.bar-btn-icon { font-size: 20px; }
.bar-btn-label { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }

/* ═══ OVERLAY ═══ */
.overlay {
  display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.88);
  z-index: 9999; justify-content: center; align-items: center;
  flex-direction: column; gap: 16px;
}
.overlay.show { display: flex; }

.overlay-title {
  font-family: 'Bebas Neue', sans-serif; font-size: 52px;
  background: linear-gradient(135deg, var(--gold), #FFA000, var(--gold));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text; letter-spacing: 4px;
  animation: pulse 1.5s ease infinite;
}
@keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }

.overlay-stats { color: var(--text-dim); font-size: 15px; text-align: center; line-height: 2; }
.overlay-stats span { color: var(--gold); font-weight: 700; }
.overlay-stars { font-size: 36px; letter-spacing: 8px; }

.overlay-btn {
  background: linear-gradient(135deg, var(--gold), #FFA000); color: #000;
  border: none; padding: 14px 36px; border-radius: 30px;
  font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 16px;
  cursor: pointer; letter-spacing: 1px; text-transform: uppercase;
}

/* ═══ HELP DROPDOWN ═══ */
.help-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 199; }
.help-backdrop.show { display: block; }

.help-dropdown {
  position: fixed; bottom: 68px; left: 0; right: 0; z-index: 200;
  transform: translateY(120%);
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}
.help-dropdown.show { transform: translateY(0); pointer-events: auto; }

.help-box {
  background: linear-gradient(180deg, rgba(12,27,42,0.98), rgba(6,14,28,0.99));
  border-top: 1.5px solid rgba(255,215,0,0.15);
  border-radius: 20px 20px 0 0; padding: 16px 20px 24px;
  max-height: 60vh; overflow-y: auto; -webkit-overflow-scrolling: touch;
}

.help-handle { width: 36px; height: 4px; background: rgba(255,215,0,0.2); border-radius: 2px; margin: 0 auto 12px; }

.help-title { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: var(--gold); letter-spacing: 2px; text-align: center; margin-bottom: 6px; }

.help-lang {
  display: flex; justify-content: center; gap: 0; margin-bottom: 14px;
  border-radius: 8px; overflow: hidden; border: 1.5px solid rgba(255,215,0,0.15);
  width: fit-content; margin-left: auto; margin-right: auto;
}

.help-lang-btn {
  padding: 5px 18px; font-family: 'Outfit', sans-serif; font-size: 11px;
  font-weight: 800; border: none; cursor: pointer;
  background: transparent; color: var(--text-dim); transition: all 0.2s;
}
.help-lang-btn.active { background: var(--gold); color: #000; }

.help-content { display: none; }
.help-content.active { display: block; }

.help-text { font-size: 14px; color: var(--text); line-height: 1.8; font-weight: 600; text-align: center; }
.help-text strong { color: var(--gold); }

/* ═══ TOAST ═══ */
.toast {
  position: fixed; bottom: 80px; left: 50%;
  transform: translateX(-50%) translateY(80px);
  background: linear-gradient(135deg, rgba(12,27,42,0.97), rgba(0,0,0,0.95));
  border: 1px solid rgba(255,215,0,0.2); border-radius: 12px;
  padding: 10px 16px; max-width: min(340px, 88vw); text-align: center;
  font-size: 12px; color: var(--text); z-index: 100;
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  pointer-events: none;
}
.toast.show { transform: translateX(-50%) translateY(0); }
.toast-label { color: var(--gold); font-family: 'Bebas Neue', sans-serif; font-size: 10px; letter-spacing: 2px; margin-bottom: 2px; }

@media (min-width: 420px) {
  .mem-card-back-icon { font-size: 32px; }
}
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <button class="header-back" onclick="window.location.href='/'">←</button>
    <div class="header-brand">
      <div class="header-title">BORI MEMORY</div>
      <div class="header-sub">Hey Bori Games</div>
    </div>
  </div>
  <div class="header-right">
    <div class="stat">
      <div class="stat-label">Pairs</div>
      <div class="stat-value" id="pairsCount">0/0</div>
    </div>
    <div class="stat">
      <div class="stat-label">Moves</div>
      <div class="stat-value" id="moveCount">0</div>
    </div>
    <button class="btn" onclick="newGame()">NUEVA</button>
  </div>
</div>

<div class="game-wrap">
  <div class="level-select" id="levelSelect">
    <button class="level-btn active" data-level="easy" onclick="setLevel('easy')">Easy (8)</button>
    <button class="level-btn" data-level="medium" onclick="setLevel('medium')">Medium (12)</button>
    <button class="level-btn" data-level="hard" onclick="setLevel('hard')">Hard (18)</button>
  </div>
  <div class="board" id="board"></div>
</div>

<div class="bottom-bar">
  <button class="bar-btn" onclick="newGame()">
    <span class="bar-btn-icon">🔄</span>
    <span class="bar-btn-label">Restart</span>
  </button>
  <div class="bar-center">
    <div class="bar-center-count" id="timerDisplay">0:00</div>
    <div class="bar-center-label">Time</div>
  </div>
  <button class="bar-btn" onclick="toggleHelp()">
    <span class="bar-btn-icon">?</span>
    <span class="bar-btn-label">How</span>
  </button>
</div>

<!-- WIN -->
<div class="overlay" id="winOverlay">
  <div class="overlay-title">¡WEPA!</div>
  <div class="overlay-stars" id="winStars">⭐⭐⭐</div>
  <div class="overlay-stats">
    Moves: <span id="winMoves">0</span><br>
    Time: <span id="winTime">0:00</span>
  </div>
  <button class="overlay-btn" onclick="newGame()">JUGAR OTRA VEZ</button>
</div>

<!-- HELP -->
<div class="help-backdrop" id="helpBackdrop" onclick="toggleHelp()"></div>
<div class="help-dropdown" id="helpDropdown">
  <div class="help-box">
    <div class="help-handle"></div>
    <div class="help-title">HOW TO PLAY</div>
    <div class="help-lang">
      <button class="help-lang-btn active" id="helpEn" onclick="setHelpLang('en')">English</button>
      <button class="help-lang-btn" id="helpEs" onclick="setHelpLang('es')">Español</button>
    </div>
    <div class="help-content active" id="helpContentEn">
      <div class="help-text">
        Tap a card to <strong>flip it</strong>.<br>
        Then tap another to find its <strong>match</strong>.<br><br>
        Match all pairs to win!<br>
        Fewer moves = more <strong>⭐ stars</strong>.<br><br>
        Each card shows a piece of<br><strong>Puerto Rican culture</strong>.<br><br>
        Try <strong>Easy</strong> first, then level up to <strong>Hard</strong>. 🇵🇷
      </div>
    </div>
    <div class="help-content" id="helpContentEs">
      <div class="help-text">
        Toca una carta para <strong>voltearla</strong>.<br>
        Luego toca otra para encontrar su <strong>pareja</strong>.<br><br>
        ¡Empareja todas para ganar!<br>
        Menos movimientos = más <strong>⭐ estrellas</strong>.<br><br>
        Cada carta muestra un pedazo de<br>la <strong>cultura puertorriqueña</strong>.<br><br>
        Empieza en <strong>Fácil</strong> y sube a <strong>Difícil</strong>. 🇵🇷
      </div>
    </div>
  </div>
</div>

<!-- TOAST -->
<div class="toast" id="toast">
  <div class="toast-label">¿SABÍAS?</div>
  <div id="toastText"></div>
</div>

<script>
const CULTURE_ITEMS = [
  { emoji: '🐸', en: 'Coquí', es: 'Coquí', fact: 'The coquí frog is found nowhere else on Earth.' },
  { emoji: '🏰', en: 'El Morro', es: 'El Morro', fact: 'El Morro took over 200 years to build, starting in 1539.' },
  { emoji: '🇵🇷', en: 'La Bandera', es: 'La Bandera', fact: "Puerto Rico's flag was designed in 1895." },
  { emoji: '🥘', en: 'Mofongo', es: 'Mofongo', fact: 'Mofongo was adapted from West African fufu.' },
  { emoji: '🌴', en: 'Palma Real', es: 'Palma Real', fact: "The royal palm is one of Puerto Rico's iconic trees." },
  { emoji: '🎵', en: 'Bomba', es: 'Bomba', fact: 'Bomba originated in Loíza from African traditions.' },
  { emoji: '🌊', en: 'Playa', es: 'Playa', fact: "Flamenco Beach is ranked among the world's best." },
  { emoji: '☕', en: 'Café', es: 'Café', fact: 'Yauco coffee is among the finest in the world.' },
  { emoji: '🥥', en: 'Coco', es: 'Coco', fact: 'Piña colada was invented in San Juan in 1954.' },
  { emoji: '🎭', en: 'Vejigante', es: 'Vejigante', fact: 'Vejigante masks come from Loíza and Ponce festivals.' },
  { emoji: '🎸', en: 'Cuatro', es: 'Cuatro', fact: "The cuatro is Puerto Rico's national instrument." },
  { emoji: '🌿', en: 'El Yunque', es: 'El Yunque', fact: 'El Yunque is the only tropical rainforest in the US system.' },
  { emoji: '⚾', en: 'Béisbol', es: 'Béisbol', fact: 'Roberto Clemente was the first Latino in the Hall of Fame.' },
  { emoji: '🍌', en: 'Plátano', es: 'Plátano', fact: 'Tostones and amarillos are PR kitchen staples.' },
  { emoji: '🦜', en: 'Cotorra', es: 'Cotorra', fact: 'The Puerto Rican parrot is one of the rarest birds.' },
  { emoji: '🌺', en: 'Flor de Maga', es: 'Flor de Maga', fact: "The flor de maga is Puerto Rico's national flower." },
  { emoji: '🏖️', en: 'Isla', es: 'Isla', fact: 'Puerto Rico has over 270 miles of coastline.' },
  { emoji: '🥁', en: 'Plena', es: 'Plena', fact: 'Plena is called "the people\'s newspaper" in music.' },
];

const LEVELS = {
  easy:   { pairs: 4,  cols: 4, rows: 2 },
  medium: { pairs: 6,  cols: 4, rows: 3 },
  hard:   { pairs: 9,  cols: 6, rows: 3 },
};

let currentLevel = 'easy';
let cards = [];
let flippedIndices = [];
let matchedPairs = 0;
let totalPairs = 0;
let moveCount = 0;
let timerInterval = null;
let seconds = 0;
let isLocked = false;
let gameStarted = false;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setLevel(level) {
  currentLevel = level;
  document.querySelectorAll('.level-btn').forEach(b => b.classList.toggle('active', b.dataset.level === level));
  newGame();
}

function newGame() {
  document.getElementById('winOverlay').classList.remove('show');
  clearInterval(timerInterval);

  const config = LEVELS[currentLevel];
  totalPairs = config.pairs;
  matchedPairs = 0;
  moveCount = 0;
  seconds = 0;
  flippedIndices = [];
  isLocked = false;
  gameStarted = false;

  document.getElementById('timerDisplay').textContent = '0:00';
  updateUI();

  const items = shuffle([...CULTURE_ITEMS]).slice(0, totalPairs);
  cards = [];
  items.forEach((item, idx) => {
    cards.push({ ...item, pairId: idx, matched: false });
    cards.push({ ...item, pairId: idx, matched: false });
  });
  cards = shuffle(cards);
  renderBoard();
}

function startTimer() {
  if (gameStarted) return;
  gameStarted = true;
  timerInterval = setInterval(() => {
    seconds++;
    document.getElementById('timerDisplay').textContent =
      Math.floor(seconds/60) + ':' + String(seconds%60).padStart(2,'0');
  }, 1000);
}

function updateUI() {
  document.getElementById('pairsCount').textContent = matchedPairs + '/' + totalPairs;
  document.getElementById('moveCount').textContent = moveCount;
}

function renderBoard() {
  const board = document.getElementById('board');
  const config = LEVELS[currentLevel];

  const vw = window.innerWidth;
  const availH = window.innerHeight - 50 - 44 - 68 - 24;
  const availW = vw - 16;

  const gapSize = 8;
  const cardW = Math.floor((availW - (config.cols - 1) * gapSize) / config.cols);
  const cardH = Math.floor((availH - (config.rows - 1) * gapSize) / config.rows);
  const size = Math.min(cardW, cardH, 150);

  // Emoji and name sizing based on card size
  const emojiSize = Math.max(24, Math.floor(size * 0.38));
  const nameSize = Math.max(8, Math.floor(size * 0.1));

  board.style.gridTemplateColumns = `repeat(${config.cols}, ${size}px)`;
  board.style.gridAutoRows = `${size}px`;
  board.innerHTML = '';

  cards.forEach((card, idx) => {
    const el = document.createElement('div');
    el.className = 'mem-card' + (card.matched ? ' flipped matched' : '');
    el.style.width = size + 'px';
    el.style.height = size + 'px';

    el.innerHTML = `
      <div class="mem-card-inner">
        <div class="mem-card-back">
          <span class="mem-card-back-icon">🇵🇷</span>
          <span class="mem-card-back-label">BORI</span>
        </div>
        <div class="mem-card-front">
          <span class="mem-card-emoji" style="font-size:${emojiSize}px">${card.emoji}</span>
          <span class="mem-card-name" style="font-size:${nameSize}px">${card.en}</span>
        </div>
      </div>
    `;

    if (!card.matched) {
      el.addEventListener('click', () => onCardTap(idx, el));
    }

    board.appendChild(el);
  });

  updateUI();
}

function onCardTap(idx, el) {
  if (isLocked) return;
  if (cards[idx].matched) return;
  if (flippedIndices.includes(idx)) return;

  startTimer();
  el.classList.add('flipped');
  flippedIndices.push(idx);

  if (flippedIndices.length === 2) {
    moveCount++;
    updateUI();
    const [a, b] = flippedIndices;

    if (cards[a].pairId === cards[b].pairId) {
      isLocked = true;
      setTimeout(() => {
        cards[a].matched = true;
        cards[b].matched = true;
        matchedPairs++;
        updateUI();

        const allCards = document.querySelectorAll('.mem-card');
        allCards[a].classList.add('matched');
        allCards[b].classList.add('matched');

        showFact(cards[a].fact);
        flippedIndices = [];
        isLocked = false;

        if (matchedPairs === totalPairs) setTimeout(showWin, 600);
      }, 400);
    } else {
      isLocked = true;
      const allCards = document.querySelectorAll('.mem-card');
      allCards[a].classList.add('wrong');
      allCards[b].classList.add('wrong');

      setTimeout(() => {
        allCards[a].classList.remove('flipped', 'wrong');
        allCards[b].classList.remove('flipped', 'wrong');
        flippedIndices = [];
        isLocked = false;
      }, 800);
    }
  }
}

function showWin() {
  clearInterval(timerInterval);
  const ratio = moveCount / totalPairs;
  let stars = ratio <= 1.5 ? '⭐⭐⭐' : ratio <= 2.5 ? '⭐⭐' : '⭐';

  document.getElementById('winStars').textContent = stars;
  document.getElementById('winMoves').textContent = moveCount;
  document.getElementById('winTime').textContent = document.getElementById('timerDisplay').textContent;
  document.getElementById('winOverlay').classList.add('show');
}

function toggleHelp() {
  document.getElementById('helpDropdown').classList.toggle('show');
  document.getElementById('helpBackdrop').classList.toggle('show');
}

function setHelpLang(lang) {
  document.getElementById('helpEn').className = 'help-lang-btn' + (lang === 'en' ? ' active' : '');
  document.getElementById('helpEs').className = 'help-lang-btn' + (lang === 'es' ? ' active' : '');
  document.getElementById('helpContentEn').className = 'help-content' + (lang === 'en' ? ' active' : '');
  document.getElementById('helpContentEs').className = 'help-content' + (lang === 'es' ? ' active' : '');
}

function showFact(fact) {
  if (!fact) return;
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = fact;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

window.addEventListener('resize', () => { if (cards.length) renderBoard(); });

newGame();
</script>
</body>
</html>