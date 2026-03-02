/* ==========================================================
   memory-game.js — HisulArena Memory Game Logic
   Match pairs of eliminated-target cards.
   Requires: cards-loader.js, utils.js
   ========================================================== */

const MemoryGame = (() => {

  /* ─── Constants ─── */
  const PAIRS_COUNT = 15;       // Cards selected per round (15 pairs = 30-card 5×6 grid)

  /* ─── State ─── */
  let _allEliminated = [];      // Full eliminated list from cards.json (cache for restart)
  let _cards       = [];        // 30 shuffled card objects (15 pairs)
  let _flipped     = [];        // Currently face-up cards (max 2)
  let _matched     = new Set(); // Set of matched card IDs
  let _moves       = 0;
  let _seconds     = 0;
  let _timerHandle = null;
  let _locked      = false;     // Block clicks during animations
  let _started     = false;     // Timer started flag

  /* ─── DOM refs ─── */
  const $grid    = () => document.getElementById('memory-grid');
  const $loading = () => document.getElementById('loading-state');
  const $moves   = () => document.getElementById('moves');
  const $timer   = () => document.getElementById('timer');
  const $matches = () => document.getElementById('matches');
  const $total   = () => document.getElementById('total-pairs');
  const $overlay = () => document.getElementById('win-overlay');

  /* ─── Win messages ─── */
  const WIN_MESSAGES = [
    'כל המחוסלים זוהו — המוסד שולח ברכות! 🎖️',
    'מוח כמו ביון! הם לא יכלו להסתתר ממך 🧠',
    'הם היו מסווגים, עכשיו הם שלך לנצח 😂',
    'מי צריך צלמ"מ? יש לך זיכרון של ברזל! 🎯',
    '15 מתוך 15! הגרעין האירני בפאניקה ⚛️',
    'בינה מלאכותית? לא. בינה ישראלית מ-100% 🇮🇱',
    'זיכרון של ברזל — פנסיה במוסד מחכה לך 🕵️',
  ];

  /* ─── Helpers ─── */
  function _pulseHudValue(el) {
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth; // reflow to restart animation
    el.classList.add('pulse');
  }

  /* ─── Pick N random cards and build the deck ─── */
  function _buildDeck(source) {
    const selected = shuffle([...source]).slice(0, PAIRS_COUNT);
    const pairs = [...selected, ...selected].map((card, idx) => ({
      ...card,
      uid: idx,
    }));
    return shuffle(pairs);
  }

  /* ─── Init ─── */
  async function init() {
    try {
      _allEliminated = await getEliminated();

      _cards = _buildDeck(_allEliminated);
      document.getElementById('total-pairs').textContent = PAIRS_COUNT;

      _render();

      // Hide loading, show grid
      const loadEl = $loading();
      if (loadEl) loadEl.style.display = 'none';

    } catch (err) {
      console.error('[MemoryGame] Failed to load cards:', err);
      const loadEl = $loading();
      if (loadEl) {
        loadEl.innerHTML = `
          <p style="color:var(--red);font-family:var(--font-mono);text-align:center">
            שגיאה בטעינת קלפים 😢<br>
            <small style="color:var(--text-muted)">הפעל את השרת: node server.js</small>
          </p>
        `;
      }
    }
  }

  /* ─── Render grid ─── */
  function _render() {
    const grid = $grid();
    if (!grid) return;
    grid.innerHTML = '';
    _cards.forEach((card, idx) => {
      grid.appendChild(_createCard(card, idx));
    });
  }

  /* ─── Build a single card element ─── */
  function _createCard(card, idx) {
    const el = document.createElement('div');
    el.className = 'mem-card';
    el.setAttribute('role', 'gridcell');
    el.setAttribute('aria-label', 'קלף מסווג');
    el.setAttribute('tabindex', '0');
    el.dataset.id  = card.id;
    el.dataset.uid = card.uid;
    el.style.animationDelay = `${idx * 0.04}s`;

    el.innerHTML = `
      <div class="mem-card-inner">

        <!-- Face-down: Classified Dossier -->
        <div class="mem-card-face mem-card-back">
          <span class="back-stamp">מסווג</span>
          <span class="back-icon">🎯</span>
          <span class="back-num">#${String(idx + 1).padStart(2, '0')}</span>
        </div>

        <!-- Face-up: Target Revealed -->
        <div class="mem-card-face mem-card-front">
          <div class="front-org">${card.org}</div>
          <div class="front-emoji"><img src="${getImageUrl(card)}" alt="${card.name}" class="card-img" loading="lazy" onerror="this.style.opacity='0'"></div>
          <div class="front-name">${card.name}</div>
          <div class="front-matched-stamp">✓ חוסל</div>
        </div>

      </div>
    `;

    el.addEventListener('click', () => _onCardClick(el, card));

    // Keyboard: flip on Enter/Space
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _onCardClick(el, card);
      }
    });

    return el;
  }

  /* ─── Handle card click ─── */
  function _onCardClick(el, card) {
    if (_locked)                          return;
    if (el.classList.contains('flipped')) return;
    if (el.classList.contains('matched')) return;

    // Start timer on first interaction
    if (!_started) _startTimer();

    el.classList.add('flipped');
    el.setAttribute('aria-label', card.name);
    _flipped.push({ el, card });

    if (_flipped.length === 2) {
      _moves++;
      const movesEl = $moves();
      if (movesEl) {
        movesEl.textContent = _moves;
        _pulseHudValue(movesEl);
      }
      _locked = true;
      // Wait for flip animation to finish before evaluating
      setTimeout(_checkMatch, 640);
    }
  }

  /* ─── Evaluate pair ─── */
  function _checkMatch() {
    const [a, b] = _flipped;

    if (a.card.id === b.card.id) {
      /* ✓ MATCH */
      a.el.classList.add('matched');
      b.el.classList.add('matched');
      a.el.setAttribute('aria-label', `${a.card.name} – זוג נמצא`);
      b.el.setAttribute('aria-label', `${b.card.name} – זוג נמצא`);

      _matched.add(a.card.id);
      const matchesEl = $matches();
      if (matchesEl) {
        matchesEl.textContent = _matched.size;
        _pulseHudValue(matchesEl);
      }

      // Check win
      if (_matched.size === _cards.length / 2) {
        setTimeout(_onWin, 700);
      }

      _flipped = [];
      _locked  = false;

    } else {
      /* ✗ NO MATCH */
      a.el.classList.add('no-match');
      b.el.classList.add('no-match');

      setTimeout(() => {
        a.el.classList.remove('flipped', 'no-match');
        b.el.classList.remove('flipped', 'no-match');
        a.el.setAttribute('aria-label', 'קלף מסווג');
        b.el.setAttribute('aria-label', 'קלף מסווג');
        _flipped = [];
        _locked  = false;
      }, 950);
    }
  }

  /* ─── Timer ─── */
  function _startTimer() {
    _started = true;
    _timerHandle = setInterval(() => {
      _seconds++;
      const timerEl = $timer();
      if (timerEl) timerEl.textContent = formatTime(_seconds);
    }, 1000);
  }

  function _stopTimer() {
    clearInterval(_timerHandle);
    _timerHandle = null;
  }

  /* ─── Win ─── */
  function _onWin() {
    _stopTimer();

    const overlay = $overlay();
    if (!overlay) return;

    // Populate win overlay with real emojis from matched cards
    const parade = overlay.querySelector('.win-emoji-parade');
    if (parade) {
      const uniqueCards = _cards.filter(
        (c, i, arr) => arr.findIndex(x => x.id === c.id) === i
      );
      parade.innerHTML = uniqueCards
        .map((c, i) => `<span style="animation-delay:${0.05 + i * 0.1}s"><img src="${getImageUrl(c)}" alt="${c.name}" class="card-img parade-img" loading="lazy" onerror="this.style.opacity='0'"></span>`)
        .join('');
    }

    const winMovesEl = overlay.querySelector('#win-moves');
    const winTimeEl  = overlay.querySelector('#win-time');
    const winMsgEl   = overlay.querySelector('#win-message');

    if (winMovesEl) winMovesEl.textContent = _moves;
    if (winTimeEl)  winTimeEl.textContent  = formatTime(_seconds);
    if (winMsgEl)   winMsgEl.textContent   = randomPick(WIN_MESSAGES);

    overlay.classList.add('open');
  }

  /* ─── Restart (public) ─── */
  function restart() {
    _flipped  = [];
    _matched  = new Set();
    _moves    = 0;
    _seconds  = 0;
    _locked   = false;
    _started  = false;
    _stopTimer();

    // Reset HUD
    const movesEl  = $moves();
    const timerEl  = $timer();
    const matchesEl = $matches();
    if (movesEl)  movesEl.textContent  = '0';
    if (timerEl)  timerEl.textContent  = '00:00';
    if (matchesEl) matchesEl.textContent = '0';

    // Close win overlay
    const overlay = $overlay();
    if (overlay) overlay.classList.remove('open');

    // Pick a fresh random 15 from all eliminated cards and re-render
    _cards = _buildDeck(_allEliminated);
    _render();
  }

  /* ─── Public API ─── */
  return { init, restart };

})();

/* ─── Bootstrap on DOM ready ─── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => MemoryGame.init());
} else {
  MemoryGame.init();
}
