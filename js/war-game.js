/* ==========================================================
   war-game.js — HisulArena War Game Client Logic
   1v1 via Socket.io room codes
   Requires: socket.io (served by server), cards-loader.js, utils.js
   ========================================================== */

const WarGame = (() => {

  /* ─── State ─── */
  let _socket       = null;
  let _myName       = '';
  let _opponentName = '';
  let _hand         = [];         // Card[] (player's current hand)
  let _selectedId   = null;       // Currently selected card.id
  let _scores       = { you: 0, opponent: 0 };
  let _round        = 1;
  let _totalRounds  = 4;
  let _waiting      = false;      // Waiting for opponent to play

  /* ─── DOM shortcuts ─── */
  const $   = id  => document.getElementById(id);
  const $$  = sel => document.querySelectorAll(sel);

  /* ─── Screen management ─── */
  const SCREENS = ['screen-lobby', 'screen-waiting', 'screen-game', 'screen-gameover'];

  function _showScreen(id) {
    SCREENS.forEach(s => {
      const el = $(s);
      if (el) el.classList.remove('active');
    });
    const target = $(id);
    if (target) target.classList.add('active');
  }

  /* ─── Init ─── */
  function init() {
    // Guard: Socket.io client CDN must have loaded
    if (typeof io === 'undefined') {
      const errEl = document.getElementById('lobby-error');
      if (errEl) {
        errEl.textContent = 'שגיאה: בעיית טעינה — בדוק חיבור אינטרנט ורענן';
        errEl.classList.add('show');
      }
      console.error('[WarGame] socket.io client not loaded — CDN may have failed');
      return;
    }
    // Local dev (served by server.js on :3000) → connect to same origin.
    // Production (Vercel) → connect to the Render Socket.io server.
    const RAILWAY_URL = 'https://hisularena.onrender.com';
    const _serverUrl  = ['localhost', '127.0.0.1'].includes(window.location.hostname)
      ? ''            // same origin → http://localhost:3000
      : RAILWAY_URL;
    _socket = io(_serverUrl);
    _bindSocketEvents();
    _bindUIEvents();
    _showScreen('screen-lobby');
  }

  /* ─── Socket event bindings ─── */
  function _bindSocketEvents() {

    _socket.on('room-created', ({ code }) => {
      $('room-code-display').textContent = code;
      $('waiting-status').textContent    = 'ממתין ליריב...';
      _showScreen('screen-waiting');
    });

    _socket.on('room-error', ({ message }) => {
      _showLobbyError(message);
    });

    _socket.on('opponent-joined', ({ opponentName }) => {
      const statusEl = $('waiting-status');
      if (statusEl) statusEl.textContent = `${opponentName} הצטרף! מתחיל...`;
    });

    _socket.on('game-start', ({ hand, opponentName, round, totalRounds }) => {
      _hand         = hand;
      _opponentName = opponentName;
      _round        = round;
      _totalRounds  = totalRounds;
      _scores       = { you: 0, opponent: 0 };
      _waiting      = false;
      _selectedId   = null;

      $('player-name-display').textContent   = _myName;
      $('opponent-name-display').textContent = _opponentName;

      _updateHUD();
      _renderHand();
      _renderOpponentHand(hand.length);
      _clearArena();
      _setPlayBtnState();

      _showScreen('screen-game');
    });

    _socket.on('opponent-played', () => {
      // Show face-down card in opponent's arena slot
      const slot = $('arena-opponent');
      if (slot && !slot.querySelector('.battle-card')) {
        slot.innerHTML = `
          <div class="battle-card battle-card-waiting">
            <div class="battle-card-back">
              <span class="wc-back-stamp">שוחק...</span>
            </div>
          </div>`;
      }
    });

    _socket.on('round-result', ({ yourCard, opponentCard, roundWinner, scores, round, isLastRound }) => {
      _scores  = scores;
      _waiting = false;
      _selectedId = null;

      _revealArena(yourCard, opponentCard, roundWinner);
      _updateHUD();

      if (!isLastRound) {
        _round = round + 1;
        setTimeout(() => {
          _clearArena();
          _renderHand();
          _renderOpponentHand(_hand.length);
          _updateHUD();
          _setPlayBtnState();
        }, 3200);
      }
    });

    _socket.on('game-over', ({ result, scores, opponentName }) => {
      setTimeout(() => _showGameOver(result, scores, opponentName), 3500);
    });

    _socket.on('opponent-disconnected', () => {
      _showLobbyError('היריב התנתק מהמשחק');
      setTimeout(() => _showScreen('screen-lobby'), 2500);
    });

    _socket.on('connect_error', () => {
      // On localhost the /api/socket route doesn't exist — expected in dev mode.
      // On Vercel production this won't fire.
      const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (isLocal) {
        _showDevNote('מצב פיתוח — Socket.io פעיל רק על Vercel');
      } else {
        _showLobbyError('שגיאת חיבור לשרת');
      }
    });
  }

  /* ─── UI event bindings ─── */
  function _bindUIEvents() {

    /* Create room */
    $('btn-create-room').addEventListener('click', () => {
      const name = ($('player-name-input').value || '').trim();
      if (!name) return _showLobbyError('הכנס שם שחקן');
      _myName = name;
      _socket.emit('create-room', { playerName: name });
    });

    /* Join room */
    $('btn-join-room').addEventListener('click', () => {
      const name = ($('player-name-input').value || '').trim();
      const code = ($('room-code-input').value || '').trim().toUpperCase();
      if (!name)          return _showLobbyError('הכנס שם שחקן');
      if (code.length !== 4) return _showLobbyError('קוד חדר: 4 אותיות');
      _myName = name;
      _socket.emit('join-room', { code, playerName: name });
    });

    /* Enter key in name field → create room */
    $('player-name-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('btn-create-room').click();
    });

    /* Enter key in room code field → join */
    $('room-code-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('btn-join-room').click();
    });

    /* Auto-uppercase room code input */
    $('room-code-input').addEventListener('input', e => {
      const start = e.target.selectionStart;
      e.target.value = e.target.value.toUpperCase();
      e.target.setSelectionRange(start, start);
    });

    /* Copy room code */
    $('btn-copy-code').addEventListener('click', () => {
      const code = $('room-code-display').textContent;
      navigator.clipboard.writeText(code).then(() => {
        const btn = $('btn-copy-code');
        btn.textContent = '✓ הועתק!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '📋 העתק';
          btn.classList.remove('copied');
        }, 2000);
      });
    });

    /* Play card */
    $('btn-play-card').addEventListener('click', () => {
      if (_selectedId == null || _waiting) return;
      const cardId = _selectedId;
      _waiting = true;

      // Animate card from hand to arena
      _playCardToArena(cardId);
      _socket.emit('play-card', { cardId });
      _setPlayBtnState();
    });
  }

  /* ─── Render player hand ─── */
  function _renderHand() {
    const container = $('player-hand');
    if (!container) return;
    container.innerHTML = '';
    _hand.forEach(card => container.appendChild(_buildHandCard(card)));
  }

  /* ─── Build a hand card element ─── */
  function _buildHandCard(card) {
    const power   = card.id;           // power = id (1–8)
    const powerPct = Math.round((power / 8) * 100);

    const el = document.createElement('div');
    el.className  = 'war-card';
    el.dataset.id = card.id;
    el.innerHTML  = `
      <div class="wc-org">${card.org}</div>
      <div class="wc-emoji"><img src="${getImageUrl(card)}" alt="${card.name}" class="card-img" loading="lazy" onerror="this.style.opacity='0'"></div>
      <div class="wc-name">${card.name}</div>
      <div class="wc-power-bar">
        <div class="wc-power-fill" style="width:${powerPct}%"></div>
      </div>
      <div class="wc-power-label">כוח ${power}</div>
    `;

    el.addEventListener('click', () => _selectCard(el, card.id));
    return el;
  }

  /* ─── Select / deselect a hand card ─── */
  function _selectCard(el, cardId) {
    if (_waiting) return;

    $$('.war-card.selected').forEach(c => c.classList.remove('selected'));

    if (_selectedId === cardId) {
      _selectedId = null;
    } else {
      el.classList.add('selected');
      _selectedId = cardId;
    }
    _setPlayBtnState();
  }

  /* ─── Render opponent's face-down cards ─── */
  function _renderOpponentHand(count) {
    const container = $('opponent-hand');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'war-card war-card-back';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `<span class="wc-back-stamp">מסווג</span>`;
      container.appendChild(el);
    }
  }

  /* ─── Animate card from hand into player's arena slot ─── */
  function _playCardToArena(cardId) {
    // Remove card from hand display
    const handCard = $('player-hand').querySelector(`[data-id="${cardId}"]`);
    if (handCard) handCard.remove();

    // Remove one back card from opponent display (they're playing too)
    const oppBack = $('opponent-hand').querySelector('.war-card-back');
    if (oppBack) oppBack.remove();

    // Update local hand state
    _hand = _hand.filter(c => c.id !== cardId);
    _selectedId = null;

    // Show face-down card in player's arena slot
    const slot = $('arena-player');
    slot.innerHTML = `
      <div class="battle-card battle-card-waiting">
        <div class="battle-card-back">
          <span class="wc-back-stamp">ממתין...</span>
        </div>
      </div>`;
  }

  /* ─── Reveal both arena cards after both players play ─── */
  function _revealArena(yourCard, opponentCard, roundWinner) {
    const yourResult = roundWinner === 'you'      ? 'winner'
                     : roundWinner === 'opponent' ? 'loser'
                     : 'tie';
    const oppResult  = roundWinner === 'opponent' ? 'winner'
                     : roundWinner === 'you'      ? 'loser'
                     : 'tie';

    $('arena-player').innerHTML   = _buildBattleCardHTML(yourCard,     yourResult);
    $('arena-opponent').innerHTML = _buildBattleCardHTML(opponentCard, oppResult);

    // Round banner
    _showRoundBanner(roundWinner);
  }

  /* ─── Build a battle card (flip reveal) HTML ─── */
  function _buildBattleCardHTML(card, result) {
    return `
      <div class="battle-card battle-card-reveal ${result}">
        <div class="battle-card-inner">
          <div class="battle-card-back">
            <span class="wc-back-stamp">מסווג</span>
          </div>
          <div class="battle-card-front">
            <div class="wc-org">${card.org}</div>
            <div class="wc-emoji"><img src="${getImageUrl(card)}" alt="${card.name}" class="card-img" loading="lazy" onerror="this.style.opacity='0'"></div>
            <div class="wc-name">${card.name}</div>
            <div class="wc-power-label">כוח ${card.id}</div>
          </div>
        </div>
      </div>`;
  }

  /* ─── Show round result banner ─── */
  function _showRoundBanner(roundWinner) {
    const banner = $('round-banner');
    const text   = $('round-banner-text');
    if (!banner || !text) return;

    if (roundWinner === 'you') {
      text.textContent  = '🎯 ניצחת את הסיבוב!';
      banner.className  = 'round-banner win';
    } else if (roundWinner === 'opponent') {
      text.textContent  = '💥 הפסדת את הסיבוב';
      banner.className  = 'round-banner lose';
    } else {
      text.textContent  = '⚖️ תיקו!';
      banner.className  = 'round-banner tie';
    }

    banner.classList.add('show');
    setTimeout(() => banner.classList.remove('show'), 2600);
  }

  /* ─── Clear arena for next round ─── */
  function _clearArena() {
    $('arena-player').innerHTML   = '<div class="arena-slot-empty">בחר קלף לשחק</div>';
    $('arena-opponent').innerHTML = '<div class="arena-slot-empty">ממתין ליריב</div>';
  }

  /* ─── Update HUD ─── */
  function _updateHUD() {
    const roundEl    = $('hud-round');
    const scoreYouEl = $('hud-score-you');
    const scoreOppEl = $('hud-score-opp');

    if (roundEl)    roundEl.textContent    = `${String(_round).padStart(2,'0')}/${String(_totalRounds).padStart(2,'0')}`;
    if (scoreYouEl) scoreYouEl.textContent = _scores.you;
    if (scoreOppEl) scoreOppEl.textContent = _scores.opponent;
  }

  /* ─── Set play button state ─── */
  function _setPlayBtnState() {
    const btn = $('btn-play-card');
    if (!btn) return;

    if (_waiting) {
      btn.disabled     = true;
      btn.textContent  = '⏳ ממתין ליריב...';
    } else if (_selectedId != null) {
      const card = _hand.find(c => c.id === _selectedId);
      btn.disabled    = false;
      btn.textContent = card ? `⚔️ פרוס ${card.name}!` : '⚔️ שחק קלף';
    } else {
      btn.disabled    = true;
      btn.textContent = '⚔️ בחר קלף לשחק';
    }
  }

  /* ─── Show game over screen ─── */
  function _showGameOver(result, scores, opponentName) {
    const icons = { win: '🏆', lose: '💀', tie: '⚖️' };
    const titles = { win: 'ניצחת!', lose: 'הפסדת', tie: 'תיקו' };

    $('gameover-result-icon').textContent      = icons[result]  || '🏆';
    $('gameover-result-title').textContent     = titles[result] || '';
    $('gameover-result-title').className       = `gameover-title ${result}`;
    $('gameover-score-you').textContent        = scores.you;
    $('gameover-score-opp').textContent        = scores.opponent;
    $('gameover-opponent-name').textContent    = opponentName;

    _showScreen('screen-gameover');
  }

  /* ─── Show lobby error ─── */
  function _showLobbyError(msg) {
    const el = $('lobby-error');
    if (!el) return;
    el.textContent = msg;
    el.className = 'lobby-error show';
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* ─── Show dev-mode note (grey, not red) ─── */
  function _showDevNote(msg) {
    const el = $('lobby-error');
    if (!el) return;
    el.textContent = msg;
    el.className = 'lobby-error lobby-dev-note show';
    setTimeout(() => el.classList.remove('show'), 5000);
  }

  /* ─── Public: restart → back to lobby ─── */
  function playAgain() {
    _hand       = [];
    _selectedId = null;
    _scores     = { you: 0, opponent: 0 };
    _round      = 1;
    _waiting    = false;
    _showScreen('screen-lobby');
  }

  return { init, playAgain };

})();

/* ─── Bootstrap ─── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => WarGame.init());
} else {
  WarGame.init();
}
