// app.js - client-side with nicknames + colored cursors
(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  // toolbar elements
  const nicknameInput = document.getElementById('nickname');
  const setNameBtn = document.getElementById('setName');
  const cursorColorInput = document.getElementById('cursorColor');
  const colorInput = document.getElementById('color');
  const sizeInput = document.getElementById('size');
  const eraserBtn = document.getElementById('eraser');
  const clearBtn = document.getElementById('clear');
  const statusSpan = document.getElementById('status');
  const shareCursorCheckbox = document.getElementById('shareCursor');

  // sizing
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(300, rect.width || window.innerWidth);
    const h = Math.max(200, rect.height || (window.innerHeight - 60));
    // save current canvas as image
    const image = ctx.getImageData(0,0,canvas.width || 1, canvas.height || 1);
    canvas.width = w;
    canvas.height = h;
    // fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    // restore image if same size (simple approach: skip restore to avoid complexity)
    // For a simple app we don't restore after resize to avoid scaling issues.
  }
  window.addEventListener('load', resize);
  window.addEventListener('resize', resize);



  // drawing state
  let drawing = false;
  let current = { x: 0, y: 0, color: colorInput.value, size: +sizeInput.value, erasing: false };

  // WebSocket connection
  const protocol = (location.protocol === 'https:') ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${location.host}`;
  const socket = new WebSocket(wsUrl);

  let clientId = null;
  let myMeta = { id: null, name: '', color: '' };
  const peers = {}; // peers[id] = { name, color, cursor: {x,y}, path: [] }

  socket.addEventListener('open', () => {
    statusSpan.textContent = 'Connected';
    // send join immediately with current nickname/color (they might still be empty)
    sendJoin();
  });
  socket.addEventListener('close', () => { statusSpan.textContent = 'Disconnected'; });
  socket.addEventListener('error', () => { statusSpan.textContent = 'Connection error'; });

  socket.addEventListener('message', (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch (e) { return; }
    if (data.type === 'welcome') {
      clientId = data.id;
      statusSpan.textContent = `Connected (id: ${clientId})`;
      // populate existing users (server sent the users list)
      if (Array.isArray(data.users)) {
        data.users.forEach(u => {
          if (u.id === clientId) {
            myMeta.id = clientId;
            myMeta.name = u.name;
            myMeta.color = u.color;
            nicknameInput.value = myMeta.name;
            cursorColorInput.value = myMeta.color;
          } else {
            peers[u.id] = { name: u.name, color: u.color, cursor: null, path: [] };
          }
        });
      }
      return;
    }

    if (data.type === 'joined') {
      // server confirmed our join metadata
      if (data.id === clientId) {
        myMeta.name = data.name;
        myMeta.color = data.color;
        nicknameInput.value = myMeta.name;
        cursorColorInput.value = myMeta.color;
      } else {
        peers[data.id] = peers[data.id] || {};
        peers[data.id].name = data.name;
        peers[data.id].color = data.color;
      }
      drawScene();
      return;
    }

    if (data.type === 'user-joined') {
      // someone else joined or updated their meta
      if (data.id === clientId) return;
      peers[data.id] = peers[data.id] || { path: [], cursor: null };
      peers[data.id].name = data.name;
      peers[data.id].color = data.color;
      drawScene();
      return;
    }

    if (data.type === 'leave') {
      delete peers[data.id];
      drawScene();
      return;
    }
    function sendCursor(pos) {
        if (socket.readyState !== WebSocket.OPEN) return;
        // only send if user opted-in
        if (!shareCursorCheckbox || !shareCursorCheckbox.checked) return;
        const now = Date.now();
        if (now - lastCursorSent < 50) return;
        lastCursorSent = now;
        socket.send(JSON.stringify({ type: 'cursor', x: pos.x, y: pos.y }));
}

    // remote drawing/cursor events
    const sender = data.sender;
    if (!peers[sender]) peers[sender] = { path: [], cursor: null, name: `User${sender}`, color: '#666' };

    if (data.type === 'begin') {
      peers[sender].path = [{ x: data.x, y: data.y }];
      // capture meta if provided in event (defensive)
      if (data.name) peers[sender].name = data.name;
      if (data.color) peers[sender].color = data.color;
    } else if (data.type === 'draw') {
      const p = peers[sender];
      p.path.push({ x: data.x, y: data.y });
      // draw incremental
      drawLineSegment(p.path[p.path.length - 2], p.path[p.path.length - 1], { color: p.color, size: data.size, erasing: data.erasing });
    } else if (data.type === 'end') {
      commitPathToCanvas(peers[sender], data.erasing);
      peers[sender].path = [];
    } else if (data.type === 'cursor') {
      peers[sender].cursor = { x: data.x, y: data.y };
      drawScene();
    } else if (data.type === 'clear') {
      clearLocalCanvas();
    }
  });

  // helpers for drawing
  function drawLineSegment(p1, p2, peerInfo) {
    if (!p1 || !p2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = peerInfo.erasing ? '#ffffff' : (peerInfo.color || '#000000');
    ctx.lineWidth = peerInfo.size || 4;
    ctx.stroke();
    ctx.closePath();
  }

  function commitPathToCanvas(peer, erasing) {
    if (!peer || !peer.path || peer.path.length < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(peer.path[0].x, peer.path[0].y);
    for (let i = 1; i < peer.path.length; i++) ctx.lineTo(peer.path[i].x, peer.path[i].y);
    ctx.strokeStyle = erasing ? '#ffffff' : (peer.color || '#000');
    ctx.lineWidth = peer.pathSize || 4;
    ctx.stroke();
    ctx.closePath();
  }

  function clearLocalCanvas() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
  }

  // draw cursors with labels on top of canvas; this implementation draws labels directly
  function drawScene() {
    // We draw cursors/labels on top of existing canvas content.
    // Save & restore to avoid affecting strokes.
    ctx.save();
    Object.keys(peers).forEach(id => {
      const p = peers[id];
      if (!p || !p.cursor) return;
      const x = p.cursor.x, y = p.cursor.y;
      const name = p.name || `User${id}`;
      const color = p.color || '#000';
      // label background
      ctx.font = '12px sans-serif';
      const padding = 6;
      const txtWidth = ctx.measureText(name).width;
      const rectW = txtWidth + padding;
      const rectH = 18;
      // draw rounded-ish rectangle bg
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(x + 10, y - rectH / 2, rectW, rectH);
      // border colored accent
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 10, y - rectH / 2, rectW, rectH);
      // text
      ctx.fillStyle = '#000';
      ctx.fillText(name, x + 12, y + 5);
      // small colored dot
      ctx.beginPath();
      ctx.arc(x + 6, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.closePath();
    });
    ctx.restore();
  }

  // pointer coordinate helper
  function getPointerPos(evt) {
    const rect = canvas.getBoundingClientRect();
    if (evt.touches && evt.touches.length) {
      const t = evt.touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    } else {
      return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }
  }

  // events for drawing
  function beginDraw(pos) {
    drawing = true;
    current.color = colorInput.value;
    current.size = +sizeInput.value;
    current.erasing = eraserBtn.dataset.active === 'true';
    current.x = pos.x; current.y = pos.y;

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);

    // send begin (include optional meta for convenience)
    send({ type: 'begin', x: pos.x, y: pos.y, color: current.color, size: current.size, erasing: current.erasing });
  }

  function moveDraw(pos) {
    if (!drawing) {
      // send cursor update
      sendCursor(pos);
      return;
    }
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = current.erasing ? '#ffffff' : current.color;
    ctx.lineWidth = current.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    send({ type: 'draw', x: pos.x, y: pos.y, size: current.size, erasing: current.erasing });
    current.x = pos.x; current.y = pos.y;
  }

  function endDraw() {
    if (!drawing) return;
    drawing = false;
    ctx.closePath();
    send({ type: 'end', erasing: current.erasing });
  }

  // pointer events hookup
  canvas.addEventListener('mousedown', (e) => beginDraw(getPointerPos(e)));
  canvas.addEventListener('mousemove', (e) => moveDraw(getPointerPos(e)));
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseout', endDraw);

  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); beginDraw(getPointerPos(e)); });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); moveDraw(getPointerPos(e)); });
  canvas.addEventListener('touchend', (e) => { e.preventDefault(); endDraw(); });

  // toolbar actions
  eraserBtn.addEventListener('click', () => {
    const active = eraserBtn.dataset.active === 'true';
    eraserBtn.dataset.active = (!active).toString();
    eraserBtn.textContent = (!active) ? 'Eraser ✓' : 'Eraser';
  });

  clearBtn.addEventListener('click', () => {
    clearLocalCanvas();
    send({ type: 'clear' });
  });

  // nickname set button — sends 'join' to server with chosen name and cursor color
  setNameBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim() || `User${clientId || Math.floor(Math.random() * 1000)}`;
    const col = cursorColorInput.value || '#000000';
    sendJoin(name, col);
    // optimistic update local meta
    myMeta.name = name;
    myMeta.color = col;
  });

  // pressing enter in nickname input triggers set
  nicknameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      setNameBtn.click();
    }
  });

  // send join helper
  function sendJoin(name = nicknameInput.value.trim(), color = cursorColorInput.value) {
    if (socket.readyState !== WebSocket.OPEN) return;
    const msg = { type: 'join', name: name || `User${clientId || Math.floor(Math.random()*1000)}`, color: color || '#000000' };
    socket.send(JSON.stringify(msg));
  }

  // throttle cursor updates
  let lastCursorSent = 0;
  function sendCursor(pos) {
    if (socket.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastCursorSent < 50) return;
    lastCursorSent = now;
    socket.send(JSON.stringify({ type: 'cursor', x: pos.x, y: pos.y }));
  }

  // general send
  function send(obj) {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(obj));
  }

  // initialize canvas and white background
  window.addEventListener('load', () => {
    resize();
    clearLocalCanvas();
  });

})();
