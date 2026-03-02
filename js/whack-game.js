/* ==========================================================
   whack-game.js — HisulArena Quick-Elimination (Whack-a-Mole)
   Cards pop from tunnel holes → click to eliminate → score!
   Requires: cards-loader.js, utils.js
   ========================================================== */

const WhackGame = (() => {

  /* ─── Constants ─── */
  const TOTAL_TIME   = 60;
  const HOLE_COUNT   = 9;     // 3×3 grid
  const POINTS_HIT   = 100;
  const MAX_ACTIVE   = 4;     // max cards visible simultaneously

  /* ─── State ─── */
  let _allCards       = [];
  let _score          = 0;
  let _hits           = 0;
  let _total          = 0;   // total cards that appeared
  let _timeLeft       = TOTAL_TIME;
  let _timerHandle    = null;
  let _spawnHandle    = null;
  let _running        = false;
  let _holeActive     = new Array(HOLE_COUNT).fill(false);
  let _pendingTimeouts = [];  // track all card-retreat timeouts

  /* ─── DOM shortcuts ─── */
  const $ = id => document.getElementById(id);

  /* ─── Funny Hebrew end messages ─── */
  const END_MESSAGES = [
    [0,    400,  s => `${s} ניקוד? טרוריסטים 1, אתה 0. תתאמן! 😅`],
    [500,  900,  s => `${s} ניקוד – לא רע! אבל ג'יימס בונד עדיין שולט 🕵️`],
    [1000, 1500, s => `${s} ניקוד! כמעט מדרגת מוסד. עוד אימון קטן 💪`],
    [1600, 2200, s => `${s} ניקוד! המוסד שלח קורות חיים 📞`],
    [2300, 9999, s => `${s} ניקוד?! אתה לא אדם. כיפת ברזל ברגליים 🚀`],
  ];

  function _getEndMessage() {
    for (const [min, max, fn] of END_MESSAGES) {
      if (_score >= min && _score <= max) return fn(_score);
    }
    return `${_score} ניקוד — מרשים! 🎯`;
  }

  /* ─── Adaptive difficulty (faster as time runs low) ─── */
  function _getSpawnDelay() {
    if (_timeLeft > 45) return 1100 + Math.random() * 300;
    if (_timeLeft > 30) return  880 + Math.random() * 250;
    if (_timeLeft > 15) return  680 + Math.random() * 200;
    return                       520 + Math.random() * 150;
  }

  function _getCardDuration() {
    if (_timeLeft > 45) return 2100;
    if (_timeLeft > 30) return 1700;
    if (_timeLeft > 15) return 1350;
    return 1100;
  }

  /* ─── Init ─── */
  async function init() {
    try {
      const data = await loadCards();
      _allCards = [...data.eliminated, ...data.alive];
      _renderHoles();
      _bindUIEvents();
    } catch (err) {
      console.error('[WhackGame] Failed to load cards:', err);
      const arena = $('holes-arena');
      if (arena) arena.innerHTML = `
        <p style="color:var(--red);font-family:var(--font-mono);grid-column:1/-1;text-align:center;padding:40px 0">
          שגיאה בטעינת קלפים 😢<br>
          <small style="color:var(--text-muted)">הפעל: node server.js</small>
        </p>`;
    }
  }

  /* ─── Render 9 empty holes ─── */
  function _renderHoles() {
    const arena = $('holes-arena');
    if (!arena) return;
    arena.innerHTML = '';
    for (let i = 0; i < HOLE_COUNT; i++) {
      const hole = document.createElement('div');
      hole.className = 'hole';
      hole.id = `hole-${i}`;
      hole.innerHTML = `
        <div class="hole-pit" aria-hidden="true"></div>
        <div class="mole-slot" id="mole-${i}" aria-live="polite"></div>
      `;
      arena.appendChild(hole);
    }
  }

  /* ─── Bind start / restart buttons ─── */
  function _bindUIEvents() {
    const startBtn   = $('start-btn');
    const restartBtn = $('restart-btn');
    if (startBtn)   startBtn.addEventListener('click', start);
    if (restartBtn) restartBtn.addEventListener('click', restart);
  }

  /* ─── Start game ─── */
  function start() {
    if (_running) return;

    _score    = 0;
    _hits     = 0;
    _total    = 0;
    _timeLeft = TOTAL_TIME;
    _holeActive.fill(false);
    _running  = true;

    // Hide start overlay
    const startOverlay = $('start-overlay');
    if (startOverlay) startOverlay.classList.remove('show');

    _updateHUD();
    _updateTimerDisplay();
    _startTimer();
    _scheduleSpawn();
  }

  /* ─── Timer ─── */
  function _startTimer() {
    _timerHandle = setInterval(() => {
      _timeLeft--;
      _updateTimerDisplay();
      if (_timeLeft <= 0) _endGame();
    }, 1000);
  }

  function _updateTimerDisplay() {
    const el = $('whack-timer');
    if (!el) return;
    el.textContent = String(_timeLeft).padStart(2, '0');
    el.classList.toggle('urgent', _timeLeft <= 10);
  }

  /* ─── Spawn scheduling ─── */
  function _scheduleSpawn() {
    if (!_running) return;
    _spawnHandle = setTimeout(() => {
      _trySpawn();
      _scheduleSpawn();
    }, _getSpawnDelay());
  }

  function _trySpawn() {
    if (!_running) return;
    const activeCount = _holeActive.filter(Boolean).length;
    if (activeCount >= MAX_ACTIVE) return;

    const freeHoles = _holeActive
      .map((busy, i) => busy ? null : i)
      .filter(i => i !== null);
    if (!freeHoles.length) return;

    const holeIdx = randomPick(freeHoles);
    const card    = randomPick(_allCards);
    _spawnMole(holeIdx, card);
  }

  /* ─── Spawn a mole card in a hole ─── */
  function _spawnMole(holeIdx, card) {
    _holeActive[holeIdx] = true;
    _total++;

    const slot = $(`mole-${holeIdx}`);
    const hole = $(`hole-${holeIdx}`);
    if (!slot) { _holeActive[holeIdx] = false; return; }

    const imgUrl  = getImageUrl(card);
    const duration = _getCardDuration();

    slot.innerHTML = `
      <div class="mole" data-hole="${holeIdx}" role="button" tabindex="0" aria-label="חסל ${card.name}">
        <div class="mole-img-wrap">
          <img src="${imgUrl}" alt="${card.name}" class="card-img mole-img" loading="lazy" onerror="this.style.opacity='0'">
        </div>
        <div class="mole-name">${card.name}</div>
      </div>
    `;

    const mole = slot.querySelector('.mole');
    if (hole) hole.classList.add('occupied');

    // Trigger pop animation (double rAF ensures paint first)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      mole.classList.add('active');
    }));

    // Click / keyboard hit handler
    const hitHandler = (e) => {
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      _onHit(mole, holeIdx, retreatId);
    };
    mole.addEventListener('click',   hitHandler, { once: true });
    mole.addEventListener('keydown', hitHandler, { once: true });

    // Auto-retreat timeout
    const retreatId = setTimeout(() => {
      if (!mole.classList.contains('hit')) {
        _retreatMole(mole, holeIdx);
      }
    }, duration);

    _pendingTimeouts.push(retreatId);
  }

  /* ─── Player hits a mole ─── */
  function _onHit(mole, holeIdx, retreatId) {
    if (!_running) return;
    if (mole.classList.contains('hit') || mole.classList.contains('miss')) return;

    clearTimeout(retreatId);
    _pendingTimeouts = _pendingTimeouts.filter(id => id !== retreatId);

    _score += POINTS_HIT;
    _hits++;
    _updateHUD();

    mole.classList.remove('active');
    mole.classList.add('hit');

    // +100 floating label
    const boom = document.createElement('div');
    boom.className = 'boom-label';
    boom.textContent = '+100';
    mole.appendChild(boom);

    const hole = $(`hole-${holeIdx}`);

    const cleanupId = setTimeout(() => {
      _holeActive[holeIdx] = false;
      if (hole) hole.classList.remove('occupied');
      if (mole.parentNode) mole.remove();
    }, 600);
    _pendingTimeouts.push(cleanupId);
  }

  /* ─── Mole retreats without being hit ─── */
  function _retreatMole(mole, holeIdx) {
    mole.classList.remove('active');
    mole.classList.add('miss');

    const hole = $(`hole-${holeIdx}`);
    const cleanupId = setTimeout(() => {
      _holeActive[holeIdx] = false;
      if (hole) hole.classList.remove('occupied');
      if (mole.parentNode) mole.remove();
    }, 350);
    _pendingTimeouts.push(cleanupId);
  }

  /* ─── HUD update ─── */
  function _updateHUD() {
    const scoreEl = $('whack-score');
    const hitsEl  = $('whack-hits');
    const totalEl = $('whack-total');
    if (scoreEl) { scoreEl.textContent = _score; _pulseEl(scoreEl); }
    if (hitsEl)  hitsEl.textContent  = _hits;
    if (totalEl) totalEl.textContent = _total;
  }

  function _pulseEl(el) {
    el.classList.remove('score-pulse');
    void el.offsetWidth;
    el.classList.add('score-pulse');
  }

  /* ─── End game ─── */
  function _endGame() {
    _running = false;
    clearInterval(_timerHandle);
    clearTimeout(_spawnHandle);
    _timerHandle = null;
    _spawnHandle = null;

    // Retreat all remaining moles
    for (let i = 0; i < HOLE_COUNT; i++) {
      if (_holeActive[i]) {
        const slot = $(`mole-${i}`);
        const mole = slot?.querySelector('.mole');
        if (mole) _retreatMole(mole, i);
      }
    }

    setTimeout(_showEndOverlay, 700);
  }

  function _showEndOverlay() {
    const overlay = $('end-overlay');
    if (!overlay) return;

    const scoreEl = overlay.querySelector('#end-score');
    const hitsEl  = overlay.querySelector('#end-hits');
    const totalEl = overlay.querySelector('#end-total');
    const msgEl   = overlay.querySelector('#end-message');
    const iconEl  = overlay.querySelector('#end-icon');

    if (scoreEl) scoreEl.textContent = _score;
    if (hitsEl)  hitsEl.textContent  = _hits;
    if (totalEl) totalEl.textContent = _total;
    if (msgEl)   msgEl.textContent   = _getEndMessage();
    if (iconEl)  iconEl.textContent  = _score >= 1600 ? '🏆' : _score >= 800 ? '🎯' : '😅';

    overlay.classList.add('open');
  }

  /* ─── Restart (public) ─── */
  function restart() {
    _running = false;
    clearInterval(_timerHandle);
    clearTimeout(_spawnHandle);

    // Clear all pending timeouts
    _pendingTimeouts.forEach(id => clearTimeout(id));
    _pendingTimeouts = [];

    // Close end overlay
    const endOverlay = $('end-overlay');
    if (endOverlay) endOverlay.classList.remove('open');

    // Clear all holes
    _holeActive.fill(false);
    for (let i = 0; i < HOLE_COUNT; i++) {
      const slot = $(`mole-${i}`);
      if (slot) slot.innerHTML = '';
      const hole = $(`hole-${i}`);
      if (hole) hole.classList.remove('occupied');
    }

    // Reset timer display
    const timerEl = $('whack-timer');
    if (timerEl) { timerEl.textContent = String(TOTAL_TIME).padStart(2, '0'); timerEl.classList.remove('urgent'); }

    setTimeout(start, 100);
  }

  /* ─── Public API ─── */
  return { init, start, restart };

})();

/* ─── Bootstrap ─── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => WhackGame.init());
} else {
  WhackGame.init();
}
