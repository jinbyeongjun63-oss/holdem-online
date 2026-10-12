'use strict';
/* 텍사스 홀덤 온라인 서버 — 외부 패키지 없이 Node 기본 모듈만 사용.
   - 화면(public/index.html)과 API를 같은 주소로 제공
   - 실시간 전달은 SSE(서버 → 브라우저), 행동은 POST(브라우저 → 서버)
   - 게임 규칙은 engine.js (혼자 하기와 같은 코드) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createGame, playHand } = require('./engine.js');

const PORT = process.env.PORT || 3000;
const MAX_SEATS = 4;
const START_CHIPS = 1000;
const TURN_MS = Number(process.env.TURN_MS) || 45000;   // 내 차례 제한 시간 (넘으면 체크/폴드)
const NEXT_MS = Number(process.env.NEXT_MS) || 30000;   // 다음 핸드 대기 최대 시간
const IDLE_ROOM_MS = 30 * 60 * 1000;                    // 아무도 없는 방은 30분 뒤 삭제
const MAX_ROOMS = 200;
const SLEEP_SCALE = Number(process.env.SLEEP_SCALE) || 1;  // 테스트용: 연출 대기 시간 배율

const AIS = [
  { name: '도윤', tag: '공격형', style: { tight: -0.03, aggr: 0.85, bluff: 0.22, loose: 0.35 } },
  { name: '서아', tag: '신중형', style: { tight: 0.06, aggr: 0.35, bluff: 0.05, loose: 0.1 } },
  { name: '지후', tag: '변칙형', style: { tight: 0, aggr: 0.6, bluff: 0.3, loose: 0.5 } },
];

const INDEX_HTML = fs
  .readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
  .replace('<head>', '<head>\n<meta name="holdem-server" content="1">');

const rooms = new Map();
const ABORT = new Error('abort');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 방 ---------- */
function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  for (let t = 0; t < 50; t++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
function cleanName(s) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f<>&"'`\\]/g, '').trim();
  return Array.from(s).slice(0, 8).join('') || '플레이어';
}
function uniqueName(room, base) {
  const taken = new Set(room.seats.map((s) => s.name).concat(AIS.map((a) => a.name)));
  let name = base, n = 2;
  while (taken.has(name)) name = Array.from(base).slice(0, 6).join('') + n++;
  return name;
}
const connected = (s) => s.conns.size > 0 && !s.left;

function createRoom(name) {
  const code = newCode();
  if (!code) return null;
  const room = {
    code, seats: [], started: false, G: null, log: [], logId: 0,
    ask: null, askSeq: 0, askTimer: null, next: null, over: null,
    dead: false, flushQueued: false, chat: [], chatId: 0, ai: true, waiters: [], emptySince: Date.now(),
  };
  rooms.set(code, room);
  addSeat(room, name);
  return room;
}
function addSeat(room, name) {
  const seat = {
    name: uniqueName(room, cleanName(name)),
    token: crypto.randomBytes(16).toString('hex'),
    conns: new Set(), left: false, lastLog: 0, fresh: true, lastChat: 0, chatFresh: true, lastChatAt: 0,
  };
  room.seats.push(seat);
  return seat;
}
function destroyRoom(room) {
  if (room.dead) return;
  room.dead = true;
  clearTimeout(room.askTimer);
  if (room.ask) { const r = room.ask.res; room.ask = null; r({ type: 'fold' }); }
  if (room.next) { room.next.finish(); }
  room.waiters.splice(0).forEach((f) => f());
  for (const s of room.seats) for (const c of s.conns) { try { c.end(); } catch (e) {} }
  rooms.delete(room.code);
}

/* ---------- 좌석별 화면(뷰): 남의 패는 가려서 보낸다 ---------- */
function viewFor(room, v) {
  const G = room.G, n = G.players.length;
  const map = (i) => (i < 0 ? i : (i - v + n) % n);
  const over = G.street === 'over';   // 핸드가 끝나면 모두의 패를 공개
  const players = [];
  for (let k = 0; k < n; k++) {
    const p = G.players[(v + k) % n];
    const open = p.revealed || (over && p.cards.length > 0);
    const show = k === 0 || open;
    players.push({
      id: k, name: p.name, tag: p.human ? (k === 0 ? '' : '친구') : p.tag, human: k === 0,
      stack: p.stack, bet: p.bet, total: p.total,
      cards: p.cards.map((c) => (show ? c : { r: 0, s: 'x' })),
      inHand: p.inHand, out: p.out, allIn: p.allIn, acted: p.acted,
      lastAction: p.lastAction, revealed: open, won: p.won, returned: p.returned,
      bestName: show ? p.bestName : '', ev: null,
    });
  }
  return {
    players, dealer: map(G.dealer), sbI: map(G.sbI), bbI: map(G.bbI), handNo: G.handNo,
    sb: G.sb, bb: G.bb, level: G.level, pot: G.pot, board: G.board, currentBet: G.currentBet,
    minRaise: G.minRaise, street: G.street, turn: map(G.turn), showdown: G.showdown,
    aggr: map(G.aggr), runout: G.runout, idx: 0, mp: true,
    result: G.result ? { text: G.result.text, showdown: G.result.showdown, winners: G.result.winners.map(map) } : null,
  };
}

function seatMsg(room, i) {
  const seat = room.seats[i];
  const base = {
    t: 'room', code: room.code, max: MAX_SEATS, you: i, started: room.started, ai: room.ai,
    seats: room.seats.map((s) => ({ name: s.name, on: connected(s) })),
  };
  if (seat.chatFresh) { base.chatReset = true; seat.lastChat = 0; seat.chatFresh = false; }
  const cs = room.chat.filter((e) => e.id > seat.lastChat);
  if (cs.length) {
    base.chat = cs.map((e) => [e.id, e.name, e.text, e.seat === seat ? 1 : 0]);
    seat.lastChat = cs[cs.length - 1].id;
  } else if (base.chatReset) base.chat = [];
  if (!room.started || !room.G) return base;
  const m = { t: 'state', chat: base.chat, chatReset: base.chatReset, you: i, view: viewFor(room, i), log: [], reset: false };
  if (seat.fresh) { m.reset = true; seat.lastLog = 0; seat.fresh = false; }
  m.log = room.log.filter((e) => e.id > seat.lastLog).map((e) => [e.id, e.t, e.k]);
  if (m.log.length) seat.lastLog = m.log[m.log.length - 1][0];
  if (room.ask && room.ask.seat === i) {
    m.ask = { id: room.ask.id, info: room.ask.info, left: Math.max(0, room.ask.until - Date.now()) };
  }
  if (room.next) {
    const mine = !room.next.pressed.has(i) && room.next.need.has(i);
    m.next = { waiting: [...room.next.need].filter((x) => !room.next.pressed.has(x)).length, mine };
  }
  if (room.over) m.over = room.over;
  return m;
}
function sendSeat(room, i) {
  const seat = room.seats[i];
  if (!seat || !seat.conns.size) return;
  const m = seatMsg(room, i);
  const data = 'data: ' + JSON.stringify(m) + '\n\n';
  for (const c of seat.conns) { try { c.write(data); } catch (e) {} }
}
function broadcast(room) {
  room.flushQueued = false;
  if (room.dead) return;
  for (let i = 0; i < room.seats.length; i++) sendSeat(room, i);
}
function schedule(room) {
  if (room.flushQueued || room.dead) return;
  room.flushQueued = true;
  setImmediate(() => broadcast(room));
}
function anyConnected(room) { return room.seats.some(connected); }
async function waitPresence(room) {
  while (!room.dead && !anyConnected(room)) await new Promise((r) => room.waiters.push(r));
}

/* ---------- 게임 진행 (엔진 훅) ---------- */
function makeHooks(room) {
  const chk = () => { if (room.dead) throw ABORT; };
  const humansIn = () => room.G.players.some((p) => p.human && p.inHand);
  return {
    render() { chk(); schedule(room); },
    log(t, k) {
      chk();
      room.log.push({ id: ++room.logId, t, k: k || '' });
      if (room.log.length > 300) room.log.shift();
    },
    save() {},
    async sleep(ms) {
      chk();
      await waitPresence(room);
      await delay(ms * SLEEP_SCALE * (humansIn() ? 1 : 0.45));
      chk();
    },
    async askHuman(info, p) {
      chk();
      await waitPresence(room);
      chk();
      const seat = room.seats[p.id];
      const id = ++room.askSeq;
      const ms = seat.left ? 0 : (connected(seat) ? TURN_MS : 8000);
      return await new Promise((res) => {
        room.ask = { seat: p.id, id, info, res, until: Date.now() + ms };
        room.askTimer = setTimeout(() => answer(room, p.id, id, { type: 'fold' }, true), ms);
        schedule(room);
      });
    },
    async waitNext() {
      chk();
      await waitPresence(room);
      const need = new Set();
      room.G.players.forEach((p, i) => { if (p.human && p.stack > 0 && connected(room.seats[i])) need.add(i); });
      if (!need.size) return;
      await new Promise((res) => {
        const nx = { need, pressed: new Set(), finish: null };
        const timer = setTimeout(() => nx.finish(), NEXT_MS);
        nx.finish = () => { clearTimeout(timer); room.next = null; res(); schedule(room); };
        room.next = nx;
        schedule(room);
      });
      chk();
    },
    gameOver() {},
  };
}
function answer(room, seat, id, act, timeout) {
  const a = room.ask;
  if (!a || a.seat !== seat || a.id !== id) return false;
  if (!act || !['fold', 'call', 'raise'].includes(act.type)) return false;
  if (act.type === 'raise' && !Number.isFinite(Number(act.to))) return false;
  clearTimeout(room.askTimer);
  room.ask = null;
  a.res(act.type === 'raise' ? { type: 'raise', to: Number(act.to) } : { type: act.type });
  schedule(room);
  return true;
}
function pressNext(room, seat) {
  const nx = room.next;
  if (!nx || !nx.need.has(seat) || nx.pressed.has(seat)) return;
  nx.pressed.add(seat);
  if ([...nx.need].every((x) => nx.pressed.has(x))) nx.finish(); else schedule(room);
}

async function runRoom(room) {
  const H = makeHooks(room);
  try {
    const G = room.G;
    while (true) {
      await playHand(G, H);
      const alive = G.players.filter((p) => p.stack > 0);
      const humansAlive = G.players.some((p) => p.human && p.stack > 0);
      if (alive.length <= 1 || !humansAlive) {
        room.over = { winner: alive.length === 1 ? alive[0].id : -1 };
        schedule(room);
        return;
      }
      await H.waitNext();
    }
  } catch (e) {
    if (e !== ABORT) {
      console.error('room error', room.code, e);
      room.log.push({ id: ++room.logId, t: '서버 오류가 발생했어요. 방을 새로 만들어 주세요.', k: 'hand' });
      schedule(room);
    }
  }
}
function startRoom(room, fillAI) {
  const defs = room.seats.map((s) => ({ name: s.name, human: true }));
  const used = new Set(defs.map((d) => d.name));
  for (const a of AIS) { if (!fillAI || defs.length >= MAX_SEATS) break; used.add(a.name); defs.push({ name: a.name, tag: a.tag, style: a.style }); }
  room.G = createGame(defs, START_CHIPS, { mp: true });
  room.started = true;
  room.seats.forEach((s) => { s.fresh = true; });
  schedule(room);
  runRoom(room);
}

/* ---------- HTTP ---------- */
function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 4096) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function auth(code, token) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room || typeof token !== 'string') return null;
  const i = room.seats.findIndex((s) => s.token.length === token.length && crypto.timingSafeEqual(Buffer.from(s.token), Buffer.from(token)));
  return i < 0 ? null : { room, i, seat: room.seats[i] };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(INDEX_HTML);
    }
    if (req.method === 'GET' && url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }

    if (req.method === 'GET' && url.pathname === '/api/check') {
      const a = auth(url.searchParams.get('code'), url.searchParams.get('token'));
      return a ? json(res, 200, { ok: true }) : json(res, 404, { error: 'no room' });
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const a = auth(url.searchParams.get('code'), url.searchParams.get('token'));
      if (!a) return json(res, 404, { error: 'no room' });
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive', 'x-accel-buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      const { room, i, seat } = a;
      seat.left = false;
      seat.conns.add(res);
      seat.fresh = true;
      seat.chatFresh = true;
      const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
      req.on('close', () => {
        clearInterval(ka);
        seat.conns.delete(res);
        if (!anyConnected(room)) room.emptySince = Date.now();
        schedule(room);
      });
      room.waiters.splice(0).forEach((f) => f());
      sendSeat(room, i);
      schedule(room);
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const body = await readBody(req);
      if (url.pathname === '/api/create') {
        if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: '지금은 방을 더 만들 수 없어요. 잠시 후 다시 해 주세요.' });
        const room = createRoom(body.name);
        if (!room) return json(res, 503, { error: '방을 만들지 못했어요.' });
        return json(res, 200, { code: room.code, token: room.seats[0].token });
      }
      if (url.pathname === '/api/join') {
        const room = rooms.get(String(body.code || '').trim().toUpperCase());
        if (!room) return json(res, 404, { error: '그 코드의 방이 없어요. 코드를 다시 확인해 주세요.' });
        if (room.started) return json(res, 409, { error: '이미 시작된 방이에요.' });
        if (room.seats.length >= MAX_SEATS) return json(res, 409, { error: '방이 가득 찼어요.' });
        const seat = addSeat(room, body.name);
        schedule(room);
        return json(res, 200, { code: room.code, token: seat.token });
      }
      const a = auth(body.code, body.token);
      if (!a) return json(res, 404, { error: '방을 찾을 수 없어요.' });
      const { room, i, seat } = a;
      if (url.pathname === '/api/start') {
        if (i !== 0) return json(res, 403, { error: '방장만 시작할 수 있어요.' });
        if (room.started) return json(res, 409, { error: '이미 시작했어요.' });
        const fillAI = room.ai;
        if (!fillAI && room.seats.length < 2) return json(res, 400, { error: '사람끼리만 하려면 2명 이상이 필요해요.' });
        startRoom(room, fillAI);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/ai') {
        if (i !== 0) return json(res, 403, { error: '방장만 바꿀 수 있어요.' });
        if (room.started) return json(res, 409, { error: '이미 시작했어요.' });
        room.ai = body.on !== false;
        room.seats.forEach((s) => { s.fresh = true; });
        schedule(room);
        return json(res, 200, { ok: true, ai: room.ai });
      }
      if (url.pathname === '/api/act') {
        return json(res, 200, { ok: answer(room, i, Number(body.id), body.act) });
      }
      if (url.pathname === '/api/chat') {
        const text = Array.from(String(body.text == null ? '' : body.text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, 200).join('');
        if (!text) return json(res, 200, { ok: false });
        const now = Date.now();
        if (now - seat.lastChatAt < 400) return json(res, 429, { error: '너무 빨라요.' });
        seat.lastChatAt = now;
        room.chat.push({ id: ++room.chatId, name: seat.name, text, seat });
        if (room.chat.length > 100) room.chat.shift();
        schedule(room);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/next') { pressNext(room, i); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/leave') {
        if (!room.started) {
          // 시작 전: 자리를 비운다 (방장이 나가면 방을 닫는다)
          if (i === 0) { destroyRoom(room); return json(res, 200, { ok: true }); }
          room.seats.splice(i, 1);
          for (const c of seat.conns) { try { c.end(); } catch (e) {} }
          room.seats.forEach((s) => { s.fresh = true; });
          schedule(room);
        } else {
          seat.left = true;
          for (const c of seat.conns) { try { c.end(); } catch (e) {} }
          seat.conns.clear();
          if (room.ask && room.ask.seat === i) answer(room, i, room.ask.id, { type: 'fold' }, true);
          if (room.next) { room.next.need.delete(i); if (room.next.need.size === 0 || [...room.next.need].every((x) => room.next.pressed.has(x))) room.next.finish(); }
          if (!anyConnected(room)) room.emptySince = Date.now();
          schedule(room);
        }
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'unknown' });
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: '요청을 처리하지 못했어요.' });
    else try { res.end(); } catch (_) {}
  }
});

setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (!anyConnected(room) && now - room.emptySince > IDLE_ROOM_MS) destroyRoom(room);
  }
}, 60000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log('holdem-online listening on ' + PORT));
}
module.exports = { server, rooms };
