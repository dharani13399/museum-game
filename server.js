// A Museum of Us: multiplayer server (Socket.IO, max 4 players per room)
const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX = 4;
const POSES = new Set(['idle', 'walk', 'run', 'sit', 'wave', 'kneel', 'talk', 'celebrate', 'hands', 'kiss']);

const http = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('A Museum of Us server is running.');
});
const io = new Server(http, { cors: { origin: '*' } });

const rooms = new Map(); // room -> Map(socket.id -> last state)
const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
const clean = (s, n) => String(s || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').slice(0, n);

io.on('connection', (socket) => {
  let room = null;
  let lastMsg = 0;

  socket.on('join', (d = {}) => {
    if (room) return;
    const r = clean(d.room || 'main', 12).replace(/ /g, '').toUpperCase() || 'MAIN';
    const members = rooms.get(r) || new Map();
    if (members.size >= MAX) { socket.emit('full'); return; }
    room = r;
    rooms.set(r, members);
    members.set(socket.id, { x: -9, z: 0, ry: Math.PI / 2, s: 'idle', name: clean(d.name, 20) || 'Guest' });
    socket.join(r);
    // tell the newcomer where everyone else already is
    members.forEach((st, id) => { if (id !== socket.id) socket.emit('state', { id, ...st }); });
  });

  socket.on('state', (m = {}) => {
    if (!room) return;
    const now = Date.now();
    if (now - lastMsg < 40) return; // rate limit
    lastMsg = now;
    const st = {
      x: num(m.x, -12, 48), z: num(m.z, -8, 8), ry: num(m.ry, -10, 10),
      s: POSES.has(m.s) ? m.s : 'idle', name: clean(m.name, 20) || 'Guest',
    };
    rooms.get(room).set(socket.id, st);
    socket.to(room).volatile.emit('state', { id: socket.id, ...st });
  });

  // relayed for later use (synced cinema and celebration); the client does not send these yet
  ['video:state', 'proposal:yes'].forEach((ev) =>
    socket.on(ev, (d) => { if (room) socket.to(room).emit(ev, d); }));

  socket.on('disconnect', () => {
    if (!room) return;
    const members = rooms.get(room);
    members.delete(socket.id);
    if (!members.size) rooms.delete(room);
    socket.to(room).emit('leave', socket.id);
  });
});

http.listen(PORT, () => console.log('Museum server listening on ' + PORT));
