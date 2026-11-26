// A Museum of Us: multiplayer server (Socket.IO, max 4 players per room)
const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX = 4;
const MAX_FRAMES = 60;
const MAX_IMG = 4000000; // characters in one photo data URL
const POSES = new Set(['idle', 'walk', 'run', 'sit', 'wave', 'kneel', 'talk', 'celebrate', 'hands', 'kiss']);
const EMOJI = new Set(['❤️', '😍', '😂', '😮', '👏', '🥹']);

const http = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('A Museum of Us server is running.');
});
// photos are sent as data URLs, so allow bigger messages than the 1 MB default
const io = new Server(http, { cors: { origin: '*' }, maxHttpBufferSize: 8e6 });

const rooms = new Map();  // room -> Map(socket.id -> last state)
const photos = new Map(); // room -> Map(frame index -> {i, url, cap, date})
const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
const clean = (s, n) => String(s || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').slice(0, n);
const text = (s, n) => String(s || '').slice(0, n);

io.on('connection', (socket) => {
  let room = null;
  let lastMsg = 0;
  let lastReact = 0;
  const myName = () => (rooms.get(room) && rooms.get(room).get(socket.id) || {}).name || 'Guest';

  socket.on('join', (d = {}) => {
    if (room) return;
    const r = clean(d.room || 'main', 12).replace(/ /g, '').toUpperCase() || 'MAIN';
    const members = rooms.get(r) || new Map();
    if (members.size >= MAX) { socket.emit('full'); return; }
    room = r;
    rooms.set(r, members);
    members.set(socket.id, { x: -9, z: 0, ry: Math.PI / 2, s: 'idle', g: 'f', name: clean(d.name, 20) || 'Guest' });
    socket.join(r);
    // tell the newcomer where everyone else already is
    members.forEach((st, id) => { if (id !== socket.id) socket.emit('state', { id, ...st }); });
    // and send every photo already in the room
    (photos.get(r) || new Map()).forEach((p) => socket.emit('photo', p));
  });

  socket.on('state', (m = {}) => {
    if (!room) return;
    const now = Date.now();
    if (now - lastMsg < 40) return; // rate limit
    lastMsg = now;
    const st = {
      x: num(m.x, -12, 48), z: num(m.z, -8, 8), ry: num(m.ry, -10, 10),
      s: POSES.has(m.s) ? m.s : 'idle', g: m.g === 'm' ? 'm' : 'f', name: clean(m.name, 20) || 'Guest',
    };
    rooms.get(room).set(socket.id, st);
    socket.to(room).volatile.emit('state', { id: socket.id, ...st });
  });

  // a photo was added, replaced or removed: remember it and show it to everyone else
  socket.on('photo', (d) => {
    if (!room || !d) return;
    const i = Number(d.i);
    if (!Number.isInteger(i) || i < 0 || i >= MAX_FRAMES) return;
    const store = photos.get(room) || new Map();
    photos.set(room, store);
    if (d.url) {
      if (typeof d.url !== 'string' || !d.url.startsWith('data:image/') || d.url.length > MAX_IMG) return;
      const p = { i, url: d.url, cap: text(d.cap, 200), date: text(d.date, 20) };
      store.set(i, p);
      socket.to(room).emit('photo', p);
    } else {
      store.delete(i);
      socket.to(room).emit('photo', { i, url: null });
    }
  });

  socket.on('photo:meta', (d) => {
    if (!room || !d) return;
    const i = Number(d.i);
    if (!Number.isInteger(i) || i < 0 || i >= MAX_FRAMES) return;
    const cap = text(d.cap, 200), date = text(d.date, 20);
    const p = photos.get(room) && photos.get(room).get(i);
    if (p) { p.cap = cap; p.date = date; }
    socket.to(room).emit('photo:meta', { i, cap, date });
  });

  // emoji reactions
  socket.on('react', (d) => {
    if (!room || !d || !EMOJI.has(d.e)) return;
    const now = Date.now();
    if (now - lastReact < 150) return;
    lastReact = now;
    const i = Number.isInteger(d.i) && d.i >= 0 && d.i < MAX_FRAMES ? d.i : -1;
    socket.to(room).emit('react', { e: d.e, i, name: myName() });
  });

  // proposal: ask the question, answer no, answer yes
  socket.on('proposal:ask', () => { if (room) socket.to(room).emit('proposal:ask', { name: myName() }); });
  socket.on('proposal:no', (d = {}) => { if (room) socket.to(room).emit('proposal:no', { n: num(d.n, 0, 99) | 0, name: myName() }); });

  // relayed for synced cinema and celebration
  ['video:state', 'proposal:yes'].forEach((ev) =>
    socket.on(ev, (d) => { if (room) socket.to(room).emit(ev, d); }));

  socket.on('disconnect', () => {
    if (!room) return;
    const members = rooms.get(room);
    members.delete(socket.id);
    if (!members.size) { rooms.delete(room); photos.delete(room); }
    socket.to(room).emit('leave', socket.id);
  });
});

http.listen(PORT, () => console.log('Museum server listening on ' + PORT));
