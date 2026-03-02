/* ==========================================================
   api/socket.js — HisulArena War Game · Vercel Serverless
   Socket.io attaches once to the underlying Node.js HTTP server
   (res.socket.server). Subsequent calls re-use the same io instance.
   Room state lives in module-scope memory — shared across all
   connections on the same warm Lambda instance.
   ========================================================== */

const { Server } = require('socket.io');
const fs         = require('fs');
const path       = require('path');

/* --- Load eliminated cards (module scope = loaded once per instance) --- */
let ELIMINATED_CARDS = [];
try {
  const raw    = fs.readFileSync(path.join(process.cwd(), 'cards.json'), 'utf8');
  ELIMINATED_CARDS = JSON.parse(raw).eliminated || [];
} catch (e) {
  console.error('[socket] cards.json load failed:', e.message);
}

/* --- Room state (shared within the same warm instance) --- */
const rooms = new Map();

/* ─── Helpers ─── */

function _generateCode() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O (ambiguous)
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CHARS[Math.floor(Math.random() * CHARS.length)]
    ).join('');
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
  room.totalRounds     = half;
}

function _resolveRound(room) {
  const [p0, p1] = room.players;
  const card0    = p0.played;
  const card1    = p1.played;

  let roundWinner = null;
  if (card0.id > card1.id)      { roundWinner = 0; p0.score++; }
  else if (card1.id > card0.id) { roundWinner = 1; p1.score++; }

  p0.played = null;
  p1.played = null;

  const isLastRound = room.round >= room.totalRounds;

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
        const myScore  = player.score;
        const oppScore = room.players[1 - idx].score;
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

/* ─── Attach Socket.io to the underlying HTTP server (once) ─── */
function _attachIO(server) {
  const io = new Server(server, {
    path:             '/api/socket',
    addTrailingSlash: false,
    cors:             { origin: '*', methods: ['GET', 'POST'] },
  });

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
      socket.data.roomCode    = code;
      socket.data.playerIndex = 0;

      socket.emit('room-created', { code });
    });

    /* Join an existing room */
    socket.on('join-room', ({ code, playerName }) => {
      const name = (playerName || '').trim().slice(0, 20);
      const key  = (code || '').trim().toUpperCase();
      if (!name || !key) return;

      const room = rooms.get(key);
      if (!room)
        return socket.emit('room-error', { message: 'קוד חדר לא נמצא' });
      if (room.players.length >= 2)
        return socket.emit('room-error', { message: 'החדר מלא' });
      if (room.state !== 'waiting')
        return socket.emit('room-error', { message: 'המשחק כבר התחיל' });

      room.players.push({ socket, name, hand: [], score: 0, played: null });
      socket.join(key);
      socket.data.roomCode    = key;
      socket.data.playerIndex = 1;

      room.players[0].socket.emit('opponent-joined', { opponentName: name });

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
      if (player.played !== null) return;

      const card = player.hand.find(c => c.id === cardId);
      if (!card) return;

      player.hand   = player.hand.filter(c => c.id !== cardId);
      player.played = card;

      room.players[1 - idx].socket.emit('opponent-played');

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

  return io;
}

/* ─── Vercel serverless handler ─── */
module.exports = function handler(req, res) {
  // Attach Socket.io once; subsequent calls re-use the same instance
  if (!res.socket.server.io) {
    res.socket.server.io = _attachIO(res.socket.server);
  }
  res.end();
};
