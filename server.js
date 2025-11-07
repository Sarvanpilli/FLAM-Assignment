// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// keep metadata about clients
// Map client -> { id, name, color }
let nextClientId = 1;
const clientMeta = new Map(); // ws -> { id, name, color }

function safeSend(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  const clientId = nextClientId++;
  // temporarily store minimal metadata; name/color will be set when client sends 'join'
  clientMeta.set(ws, { id: clientId, name: `User${clientId}`, color: randomColor() });

  // when a client connects, send welcome including assigned id and current users
  const users = [];
  for (const [otherWs, meta] of clientMeta.entries()) {
    users.push({ id: meta.id, name: meta.name, color: meta.color });
  }
  safeSend(ws, { type: 'welcome', id: clientId, users });

  // notify others that a new socket connected (they'll update after receiving 'user-joined' from the join msg)
  ws.on('message', (message) => {
    let parsed;
    try { parsed = JSON.parse(message); } catch (e) { return; }
    // Handle special 'join' message to set nickname/color metadata
    if (parsed.type === 'join') {
      const meta = clientMeta.get(ws) || {};
      meta.name = String(parsed.name || meta.name || `User${clientId}`).slice(0, 40);
      // validate color (basic)
      meta.color = typeof parsed.color === 'string' && /^#?[0-9a-fA-F]{6}$/.test(parsed.color) ?
        (parsed.color.startsWith('#') ? parsed.color : `#${parsed.color}`) :
        meta.color || randomColor();
      clientMeta.set(ws, meta);

      // let everyone know this user joined/updated (broadcast)
      const joinMsg = { type: 'user-joined', id: meta.id, name: meta.name, color: meta.color };
      broadcastExcept(ws, joinMsg);
      // also reply to the joining client with confirmed meta
      safeSend(ws, { type: 'joined', id: meta.id, name: meta.name, color: meta.color });
      return;
    }

    // For other messages, broadcast them to everyone else, and attach sender id
    const meta = clientMeta.get(ws);
    const senderId = meta ? meta.id : clientId;
    parsed.sender = senderId;

    // non-control messages: forward
    const outgoing = JSON.stringify(parsed);
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(outgoing);
      }
    });
  });

  ws.on('close', () => {
    const meta = clientMeta.get(ws);
    clientMeta.delete(ws);
    // broadcast leave with id
    const leave = { type: 'leave', id: meta ? meta.id : clientId };
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(leave));
    });
  });
});

function broadcastExcept(wsToSkip, obj) {
  const out = JSON.stringify(obj);
  wss.clients.forEach((client) => {
    if (client !== wsToSkip && client.readyState === WebSocket.OPEN) client.send(out);
  });
}

function randomColor() {
  // return hex color like #a3b4c5
  const r = Math.floor(Math.random() * 200) + 20;
  const g = Math.floor(Math.random() * 200) + 20;
  const b = Math.floor(Math.random() * 200) + 20;
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
