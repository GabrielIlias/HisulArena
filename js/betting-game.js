/* ==========================================================
   betting-game.js — HisulArena Betting Game Logic
   Select an alive target → drum-roll reveal → win/lose → history
   Requires: cards-loader.js, utils.js
   ========================================================== */

const BettingGame = (() => {

  /* ─── Constants ─── */
  const TARGETS_COUNT = 5;  // Targets shown per round (random sample from alive list)

  /* ─── State ─── */
  let _allAlive = [];       // Full alive list from cards.json (cache for resampling)
  let _alive    = [];       // 5 randomly selected alive cards for this round
  let _selected = null;     // Currently selected card object
  let _history  = [];       // [{date, betName, betId, winnerName, winnerId, hit}]
  let _spinning = false;    // Lock during drum-roll
  let _streak   = 0;        // Current win streak

  /* ─── Drum-roll tick timings (ms between each name change) ─── */
  const TICK_MS = [
    65, 65, 65, 65, 65,   // fast burst
    85, 85, 85,            // slight slow
    110, 110,              // slowing
    150, 150,              // noticeably slow
    210,                   // very slow
    340,                   // last slow tick before winner
  ];

  /* ─── Funny Hebrew result messages ─── */
  const HIT_MESSAGES = [
    'ניחשת! המוסד בודק קורות חיים שלך 📞',
    'פגיעה ישירה! שקל לשנות קריירה לאנליסט 🎯',
    'יש לך עין של צלף! כבוד הגדוד 🫡',
    'אחד לאחד! אפילו הרמטכ"ל מקנא בך 🏅',
  ];

  const MISS_MESSAGES = [
    name => `חוסל ${name}. הפעם לא, אבל ניסיון טוב! 😅`,
    name => `${name} נבחר. קרוב אבל לא מספיק... 🤷`,
    name => `ה-CIA בחרה ${name}. אולי הפעם הבאה 🕵️`,
    name => `טעות. אבל ${name} כבר לא מסביב. איזון 😏`,
  ];

  /* ─── Fake odds table (per card.id mod length) ─── */
  const ODDS_TABLE = [3, 5, 8, 12, 4, 7, 10, 6, 15, 2];

  /* ─── DOM shortcuts ─── */
  const $    = id => document.getElementById(id);
  const $all = sel => document.querySelectorAll(sel);

  /* ─── Pick TARGETS_COUNT random cards from the full alive list ─── */
  function _sampleTargets() {
    return shuffle([..._allAlive]).slice(0, TARGETS_COUNT);
  }

  /* ─── Init ─── */
  async function init() {
    try {
      _allAlive = await getAlive();
      _alive    = _sampleTargets();
      _history  = loadFromStorage('betting_history', []);
      _streak   = loadFromStorage('betting_streak', 0);

      _renderTargets();
      _renderHistory();
      _updateStats();
      _startOddsFlicker();

    } catch (err) {
      console.error('[BettingGame] Failed to load cards:', err);
      const grid = $('targets-grid');
      if (grid) grid.innerHTML = `
        <p style="color:var(--red);font-family:var(--font-mono);grid-column:1/-1;text-align:center;padding:40px 0">
          שגיאה בטעינת קלפים 😢<br>
          <small style="color:var(--text-muted)">הפעל: node server.js</small>
        </p>`;
    }
  }

  /* ─── Render target cards ─── */
  function _renderTargets() {
    const grid = $('targets-grid');
    if (!grid) return;
    grid.innerHTML = '';

    _alive.forEach((card, idx) => {
      const el = _createTargetCard(card, idx);
      grid.appendChild(el);
    });
  }

  /* ─── Build a single wanted-poster target card ─── */
  function _createTargetCard(card, idx) {
    const odds    = ODDS_TABLE[card.id % ODDS_TABLE.length];
    const probPct = Math.round(100 / odds);          // fake probability %

    const el = document.createElement('div');
    el.className = 'target-card';
    el.dataset.id = card.id;
    el.style.animationDelay = `${idx * 0.07}s`;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `בחר ${card.name}`);

    el.innerHTML = `
      <div class="target-header">
        <span class="wanted-label">מבוקש</span>
        <span class="target-odds-badge" data-base-odds="${odds}">×${odds}</span>
      </div>
      <div class="target-body">
        <div class="target-emoji"><img src="${getImageUrl(card)}" alt="${card.name}" class="card-img" loading="lazy" onerror="this.style.opacity='0'"></div>
        <div class="target-name">${card.name}</div>
        <div class="target-org">${card.org}</div>
        <div class="target-desc">${card.description}</div>
        <div class="target-prob-bar">
          <div class="target-prob-fill" style="width:${probPct}%"></div>
        </div>
      </div>
      <div class="target-footer">לחץ לבחירה</div>
    `;

    el.addEventListener('click', () => _selectCard(el, card));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _selectCard(el, card); }
    });

    return el;
  }

  /* ─── Handle card selection ─── */
  function _selectCard(el, card) {
    if (_spinning) return;

    // Deselect previous
    $all('.target-card.selected').forEach(c => {
      c.classList.remove('selected');
      c.querySelector('.target-footer').textContent = 'לחץ לבחירה';
      c.setAttribute('aria-pressed', 'false');
    });

    el.classList.add('selected');
    el.querySelector('.target-footer').textContent = '✓ נבחרת';
    el.setAttribute('aria-pressed', 'true');

    _selected = card;

    const betBtn = $('bet-btn');
    if (betBtn) {
      betBtn.disabled = false;
      betBtn.textContent = `🎯 הגש הימור על ${card.name}!`;
    }
  }

  /* ─── Submit bet ─── */
  function submitBet() {
    if (!_selected || _spinning) return;
    _spinning = true;

    const betBtn = $('bet-btn');
    if (betBtn) betBtn.disabled = true;

    // Pick random winner from alive list
    const winner = randomPick(_alive);

    _openDrumRoll(winner);
  }

  /* ─── Open drum-roll overlay and run animation ─── */
  function _openDrumRoll(winner) {
    const overlay = $('drumroll-overlay');
    if (overlay) overlay.classList.add('open');

    const tickerDisplay = $('ticker-display');
    const dotsEl        = $('drumroll-dots');
    const resultEl      = $('drumroll-result');

    // Reset state
    if (tickerDisplay) tickerDisplay.classList.remove('final');
    if (dotsEl)   dotsEl.classList.remove('hidden');
    if (resultEl) { resultEl.classList.remove('show'); resultEl.innerHTML = ''; }

    // Run the tick sequence
    let tickIdx = 0;
    // Generate a random display order (not ending on winner until forced)
    const shuffledTargets = shuffle([..._alive]);

    function doTick() {
      if (tickIdx < TICK_MS.length) {
        const displayCard = shuffledTargets[tickIdx % shuffledTargets.length];
        _updateTicker(getImageUrl(displayCard), displayCard.name, false);
        setTimeout(doTick, TICK_MS[tickIdx]);
        tickIdx++;
      } else {
        // Show winner with final animation
        _updateTicker(getImageUrl(winner), winner.name, true);

        if (dotsEl) dotsEl.classList.add('hidden');

        setTimeout(() => {
          _showResult(winner);
        }, 1100);
      }
    }

    doTick();
  }

  /* ─── Update the ticker display ─── */
  function _updateTicker(imgUrl, name, isFinal) {
    const emojiEl = $('ticker-emoji');
    const nameEl  = $('ticker-name');
    const display = $('ticker-display');

    if (!emojiEl || !nameEl) return;

    const imgTag = `<img src="${imgUrl}" alt="${name}" class="card-img ticker-img" loading="lazy" onerror="this.style.opacity='0'">`;

    if (isFinal) {
      emojiEl.innerHTML   = imgTag;
      nameEl.textContent  = name;
      if (display) display.classList.add('final');
    } else {
      // Quick fade out/in for each tick
      emojiEl.style.opacity = '0.3';
      nameEl.style.opacity  = '0.3';

      requestAnimationFrame(() => {
        emojiEl.innerHTML   = imgTag;
        nameEl.textContent  = name;
        emojiEl.style.opacity = '1';
        nameEl.style.opacity  = '1';
      });
    }
  }

  /* ─── Show bet result ─── */
  function _showResult(winner) {
    const hit = _selected.id === winner.id;

    // Update streak
    if (hit) {
      _streak++;
    } else {
      _streak = 0;
    }
    saveToStorage('betting_streak', _streak);

    // Save to history
    const entry = {
      date:       new Date().toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit' }),
      betName:    _selected.name,
      betId:      _selected.id,
      winnerName: winner.name,
      winnerId:   winner.id,
      hit,
    };
    _history.unshift(entry);
    if (_history.length > 10) _history.pop();
    saveToStorage('betting_history', _history);

    // Build result HTML
    const resultEl = $('drumroll-result');
    if (!resultEl) return;

    const msg = hit
      ? randomPick(HIT_MESSAGES)
      : randomPick(MISS_MESSAGES)(winner.name);

    resultEl.innerHTML = `
      <div class="result-icon">${hit ? '🎯' : '💨'}</div>
      <div class="result-title ${hit ? 'hit' : 'miss'}">
        ${hit ? 'פגיעה ישירה! 🏆' : 'החמצה... 😅'}
      </div>
      <p class="result-subtitle">${msg}</p>
      <div class="result-actions">
        <button class="btn-primary" onclick="BettingGame.reset()">🔄 הימור נוסף</button>
        <a href="../index.html" class="btn-secondary">← תפריט</a>
      </div>
    `;

    setTimeout(() => {
      resultEl.classList.add('show');
      _renderHistory();
      _updateStats();
    }, 80);
  }

  /* ─── Reset after result ─── */
  function reset() {
    _selected = null;
    _spinning = false;

    const overlay    = $('drumroll-overlay');
    const tickDisplay = $('ticker-display');
    const dotsEl     = $('drumroll-dots');
    const resultEl   = $('drumroll-result');
    const betBtn     = $('bet-btn');

    if (overlay)    overlay.classList.remove('open');
    if (tickDisplay) tickDisplay.classList.remove('final');
    if (dotsEl)     dotsEl.classList.remove('hidden');
    if (resultEl) {
      resultEl.classList.remove('show');
      resultEl.innerHTML = '';
    }

    if (betBtn) {
      betBtn.disabled    = true;
      betBtn.textContent = '🎯 בחר מטרה תחילה';
    }

    // Reset ticker display
    const emojiEl = $('ticker-emoji');
    const nameEl  = $('ticker-name');
    if (emojiEl) { emojiEl.textContent = '🎯'; emojiEl.style.opacity = '1'; }
    if (nameEl)  { nameEl.textContent  = 'מוכן';  nameEl.style.opacity  = '1'; }

    // Re-sample 5 fresh targets for next round
    _alive = _sampleTargets();
    _renderTargets();
  }

  /* ─── Clear history ─── */
  function clearHistory() {
    if (!confirm('למחוק את כל היסטוריית ההימורים?')) return;
    _history = [];
    _streak  = 0;
    removeFromStorage('betting_history');
    removeFromStorage('betting_streak');
    _renderHistory();
    _updateStats();
  }

  /* ─── Render history list ─── */
  function _renderHistory() {
    const listEl = $('history-list');
    if (!listEl) return;

    if (_history.length === 0) {
      listEl.innerHTML = `<p class="no-history">עוד לא הימרת. הגיע הזמן! 🎰</p>`;
      return;
    }

    listEl.innerHTML = _history.slice(0, 5).map((e, i) => `
      <div class="history-entry ${e.hit ? 'hit' : 'miss'}" style="animation-delay:${i * 0.06}s">
        <span class="history-icon">${e.hit ? '✅' : '❌'}</span>
        <span class="history-text">
          הימרת על <strong>${e.betName}</strong> —
          חוסל <strong>${e.winnerName}</strong>
        </span>
        <span class="history-date">${e.date}</span>
      </div>
    `).join('');
  }

  /* ─── Update stats display ─── */
  function _updateStats() {
    const total = _history.length;
    const hits  = _history.filter(e => e.hit).length;
    const rate  = total ? Math.round((hits / total) * 100) : null;

    const totalEl  = $('stat-total');
    const hitsEl   = $('stat-hits');
    const rateEl   = $('stat-rate');
    const streakEl = $('stat-streak');

    if (totalEl)  totalEl.textContent  = total;
    if (hitsEl)   hitsEl.textContent   = hits;
    if (rateEl)   rateEl.textContent   = rate !== null ? `${rate}%` : '—';
    if (streakEl) streakEl.textContent = _streak > 0 ? `🔥${_streak}` : '—';
  }

  /* ─── Live odds flicker (cosmetic) ─── */
  function _startOddsFlicker() {
    setInterval(() => {
      const badges = $all('.target-card:not(.selected) .target-odds-badge');
      if (!badges.length) return;

      // Pick 1–2 random badges to flicker
      const picks = shuffle([...badges]).slice(0, 1);
      picks.forEach(badge => {
        const base = parseInt(badge.dataset.baseOdds || '5', 10);
        const delta = Math.random() > 0.5 ? 1 : -1;
        const newOdds = Math.max(2, Math.min(20, base + delta));
        badge.textContent = `×${newOdds}`;
        badge.dataset.baseOdds = newOdds;
        badge.classList.remove('odds-flicker');
        void badge.offsetWidth;
        badge.classList.add('odds-flicker');
      });
    }, 2200);
  }

  /* ─── Public API ─── */
  return { init, submitBet, reset, clearHistory };

})();

/* ─── Bootstrap ─── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => BettingGame.init());
} else {
  BettingGame.init();
}
