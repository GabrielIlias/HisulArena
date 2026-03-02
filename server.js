/* ==========================================================
   server.js — HisulArena Local Static Server + War Game
   Serves static files + Socket.io 1v1 War game rooms
   Run: node server.js
   Visit: http://localhost:3000
   ========================================================== */

const express    = require('express');
const path       = require('path');
const http       = require('http');
const fs         = require('fs');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
const PORT   = process.env.PORT || 3000;

/* --- Load eliminated cards for War game dealing --- */
let ELIMINATED_CARDS = [];
try {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'cards.json'), 'utf8'));
  ELIMINATED_CARDS = data.eliminated || [];
} catch (err) {
  console.error('  ⚠️  Could not load cards.json:', err.message);
}

/* --- Serve static files from project root --- */
app.use(express.static(path.join(__dirname), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.webmanifest') || filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
    if (filePath.endsWith('service-worker.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
    }
  },
}));

/* --- SPA fallback --- */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ============================================================
   WAR GAME — Socket.io Room Management
   Room structure:
   {
     code:        string,
     players:     [{ socket, name, hand:Card[], score, played:Card|null }],
     round:       number,
     totalRounds: number,
     state:       'waiting' | 'playing' | 'finished',
   }
   ============================================================ */

const rooms = new Map(); // code → room

function _generateCode() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O (ambiguous)
  let code;
  do {
    code = Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function _shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _dealCards(room) {
  const deck = _shuffle(ELIMINATED_CARDS);
  const half = Math.floor(deck.length / 2);
  room.players[0].hand = deck.slice(0, half);
  room.players[1].hand = deck.slice(half, half * 2);
  room.totalRounds = half; // rounds = cards per player
}

function _resolveRound(room) {
  const [p0, p1] = room.players;
  const card0    = p0.played;
  const card1    = p1.played;

  // Power = card.id (higher wins)
  let roundWinner = null; // 0 | 1 | null (tie)
  if (card0.id > card1.id)      { roundWinner = 0; p0.score++; }
  else if (card1.id > card0.id) { roundWinner = 1; p1.score++; }

  p0.played = null;
  p1.played = null;

  const isLastRound = room.round >= room.totalRounds;

  // Send personalised result to each player
  [p0, p1].forEach((player, idx) => {
    player.socket.emit('round-result', {
      yourCard:     idx === 0 ? card0 : card1,
      opponentCard: idx === 0 ? card1 : card0,
      roundWinner:  roundWinner === null ? 'tie'
                  : roundWinner === idx  ? 'you'
                  : 'opponent',
      scores:       { you: player.score, opponent: room.players[1 - idx].score },
      round:        room.round,
      isLastRound,
    });
  });

  if (isLastRound) {
    room.state = 'finished';
    setTimeout(() => {
      [p0, p1].forEach((player, idx) => {
        const myScore   = player.score;
        const oppScore  = room.players[1 - idx].score;
        player.socket.emit('game-over', {
          result:       myScore > oppScore ? 'win' : myScore < oppScore ? 'lose' : 'tie',
          scores:       { you: myScore, opponent: oppScore },
          opponentName: room.players[1 - idx].name,
        });
      });
      rooms.delete(room.code);
    }, 3500);
  } else {
    room.round++;
  }
}

/* --- Socket.io connection handler --- */
io.on('connection', (socket) => {

  /* Create a new room */
  socket.on('create-room', ({ playerName }) => {
    const name = (playerName || '').trim().slice(0, 20);
    if (!name) return;

    const code = _generateCode();
    const room = {
      code,
      players:     [{ socket, name, hand: [], score: 0, played: null }],
      round:       1,
      totalRounds: 4,
      state:       'waiting',
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode     = code;
    socket.data.playerIndex  = 0;

    socket.emit('room-created', { code });
  });

  /* Join an existing room */
  socket.on('join-room', ({ code, playerName }) => {
    const name = (playerName || '').trim().slice(0, 20);
    const key  = (code || '').trim().toUpperCase();
    if (!name || !key) return;

    const room = rooms.get(key);
    if (!room)                     return socket.emit('room-error', { message: 'קוד חדר לא נמצא' });
    if (room.players.length >= 2)  return socket.emit('room-error', { message: 'החדר מלא' });
    if (room.state !== 'waiting')  return socket.emit('room-error', { message: 'המשחק כבר התחיל' });

    room.players.push({ socket, name, hand: [], score: 0, played: null });
    socket.join(key);
    socket.data.roomCode    = key;
    socket.data.playerIndex = 1;

    // Notify host
    room.players[0].socket.emit('opponent-joined', { opponentName: name });

    // Deal and start
    _dealCards(room);
    room.state = 'playing';

    room.players.forEach((player, idx) => {
      player.socket.emit('game-start', {
        hand:         player.hand,
        opponentName: room.players[1 - idx].name,
        round:        room.round,
        totalRounds:  room.totalRounds,
        playerIndex:  idx,
      });
    });
  });

  /* Player plays a card */
  socket.on('play-card', ({ cardId }) => {
    const code = socket.data.roomCode;
    const idx  = socket.data.playerIndex;
    if (code == null || idx == null) return;

    const room = rooms.get(code);
    if (!room || room.state !== 'playing') return;

    const player = room.players[idx];
    if (player.played !== null) return; // already played

    const card = player.hand.find(c => c.id === cardId);
    if (!card) return;

    player.hand   = player.hand.filter(c => c.id !== cardId);
    player.played = card;

    // Notify opponent that this player has played (without revealing the card)
    room.players[1 - idx].socket.emit('opponent-played');

    // Both played → resolve
    if (room.players[0].played && room.players[1].played) {
      _resolveRound(room);
    }
  });

  /* Handle disconnect */
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    room.players.forEach(p => {
      if (p.socket.id !== socket.id) {
        p.socket.emit('opponent-disconnected');
      }
    });
    rooms.delete(code);
  });
});

/* --- Start server --- */
server.listen(PORT, () => {
  console.log('');
  console.log('  🎯 HisulArena – חיסול ארנה');
  console.log('  ─────────────────────────────');
  console.log(`  ✅  Running at: http://localhost:${PORT}`);
  console.log(`  📂  Serving:    ${__dirname}`);
  console.log(`  🃏  Cards loaded: ${ELIMINATED_CARDS.length} eliminated`);
  console.log('  ⌨️   Press Ctrl+C to stop');
  console.log('');
});

/* --- Graceful shutdown --- */
process.on('SIGINT', () => {
  console.log('\n  👋 Shutting down HisulArena server...');
  server.close(() => process.exit(0));
});
