// app.js - client-side with nicknames + colored cursors
(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const cursorOverlay = document.getElementById('cursorOverlay');
  const cursorCtx = cursorOverlay.getContext('2d', { alpha: true });

  // toolbar elements
  const nicknameInput = document.getElementById('nickname');
  const setNameBtn = document.getElementById('setName');
  const cursorColorInput = document.getElementById('cursorColor');
  const colorInput = document.getElementById('color');
  const sizeInput = document.getElementById('size');
  const eraserBtn = document.getElementById('eraser');
  const clearBtn = document.getElementById('clear');
  const statusSpan = document.getElementById('status');
  const statusIndicator = document.getElementById('statusIndicator');
  const shareCursorCheckbox = document.getElementById('shareCursor');
  const sizeValue = document.getElementById('sizeValue');
  const opacityInput = document.getElementById('opacity');
  const opacityValue = document.getElementById('opacityValue');
  const undoBtn = document.getElementById('undo');
  const redoBtn = document.getElementById('redo');
  const exportBtn = document.getElementById('export');
  const textModal = document.getElementById('textModal');
  const textInput = document.getElementById('textInput');
  const textConfirm = document.getElementById('textConfirm');
  const textCancel = document.getElementById('textCancel');


  // Save state to history
  function saveToHistory() {
    // Remove any states after current index (when undoing and then drawing)
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }
    
    // Save current canvas state
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    history.push(imageData);
    historyIndex++;
    
    // Limit history size
    if (history.length > MAX_HISTORY) {
      history.shift();
      historyIndex--;
    }
    
    updateUndoRedoButtons();
  }

  // Undo
  function undo(isRemote = false) {
    if (historyIndex > 0) {
      historyIndex--;
      const imageData = history[historyIndex];
      ctx.putImageData(imageData, 0, 0);
      updateUndoRedoButtons();
      
      // Broadcast undo to all other users
      if (!isRemote) {
        const canvasData = canvas.toDataURL('image/png');
        send({ 
          type: 'undo', 
          canvasData: canvasData,
          historyIndex: historyIndex 
        });
      }
    }
  }

  // Redo
  function redo(isRemote = false) {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      const imageData = history[historyIndex];
      ctx.putImageData(imageData, 0, 0);
      updateUndoRedoButtons();
      
      // Broadcast redo to all other users
      if (!isRemote) {
        const canvasData = canvas.toDataURL('image/png');
        send({ 
          type: 'redo', 
          canvasData: canvasData,
          historyIndex: historyIndex 
        });
      }
    }
  }

  // Update undo/redo button states
  function updateUndoRedoButtons() {
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= history.length - 1;
  }

  // Export canvas as PNG
  function exportCanvas() {
    const link = document.createElement('a');
    link.download = `canvas-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  // sizing
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(300, rect.width || window.innerWidth);
    const h = Math.max(200, rect.height || (window.innerHeight - 60));
    // save current canvas as image
    const image = ctx.getImageData(0,0,canvas.width || 1, canvas.height || 1);
    canvas.width = w;
    canvas.height = h;
    cursorOverlay.width = w;
    cursorOverlay.height = h;
    // Update shape preview canvas if it exists
    if (shapePreviewCanvas) {
      shapePreviewCanvas.width = w;
      shapePreviewCanvas.height = h;
    }
    // fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    // clear cursor overlay
    cursorCtx.clearRect(0, 0, cursorOverlay.width, cursorOverlay.height);
    // Save initial state to history
    if (history.length === 0) {
      saveToHistory();
    }
  }
  window.addEventListener('load', resize);
  window.addEventListener('resize', resize);



  // drawing state
  let drawing = false;
  let current = { x: 0, y: 0, color: colorInput.value, size: +sizeInput.value, erasing: false, opacity: 100 };
  let drawMode = 'freehand'; // 'freehand', 'rectangle', 'circle', 'line', 'text'
  let shapeStart = null; // { x, y } for shape drawing
  let savedCanvasImage = null; // Store canvas state for shape preview
  let shapePreviewCanvas = null; // Temporary canvas for shape preview
  let shapePreviewCtx = null;
  let textPosition = null; // For text tool
  
  // Undo/Redo system
  let history = []; // Array of canvas states
  let historyIndex = -1; // Current position in history
  const MAX_HISTORY = 50; // Maximum history states

  // WebSocket connection
  const protocol = (location.protocol === 'https:') ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${location.host}`;
  const socket = new WebSocket(wsUrl);

  let clientId = null;
  let myMeta = { id: null, name: '', color: '' };
  const peers = {}; // peers[id] = { name, color, cursor: {x,y}, path: [] }

  socket.addEventListener('open', () => {
    statusSpan.textContent = 'Connected';
    if (statusIndicator) {
      statusIndicator.className = 'status-indicator connected';
    }
    // send join immediately with current nickname/color (they might still be empty)
    sendJoin();
  });
  socket.addEventListener('close', () => { 
    statusSpan.textContent = 'Disconnected'; 
    if (statusIndicator) {
      statusIndicator.className = 'status-indicator disconnected';
    }
  });
  socket.addEventListener('error', () => { 
    statusSpan.textContent = 'Connection error'; 
    if (statusIndicator) {
      statusIndicator.className = 'status-indicator disconnected';
    }
  });

  socket.addEventListener('message', (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch (e) { return; }
    if (data.type === 'welcome') {
      clientId = data.id;
      statusSpan.textContent = `Connected (ID: ${clientId})`;
      if (statusIndicator) {
        statusIndicator.className = 'status-indicator connected';
      }
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

    // remote drawing/cursor events
    const sender = data.sender;
    if (!peers[sender]) peers[sender] = { path: [], cursor: null, name: `User${sender}`, color: '#666', shapeStart: null, shapeType: null };

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
      // Save to history after remote drawing completes
      setTimeout(() => saveToHistory(), 50);
    } else if (data.type === 'shape-begin') {
      // Remote user started drawing a shape
      peers[sender].shapeStart = { x: data.x, y: data.y };
      peers[sender].shapeType = data.shapeType;
      peers[sender].shapeColor = data.color;
      peers[sender].shapeSize = data.size;
      peers[sender].shapeErasing = data.erasing;
      peers[sender].shapeOpacity = data.opacity || 100;
      // Save current canvas state for this peer's shape preview (save the state before shape starts)
      peers[sender].savedCanvasImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } else if (data.type === 'shape-move') {
      // Remote user is moving while drawing a shape - show preview
      const p = peers[sender];
      if (p.shapeStart && p.savedCanvasImage) {
        // Restore original saved state (before shape started)
        ctx.putImageData(p.savedCanvasImage, 0, 0);
        // Draw preview on top
        drawShapePreview(p.shapeStart.x, p.shapeStart.y, data.x, data.y, p.shapeType, p.shapeColor, p.shapeSize, p.shapeErasing, p.shapeOpacity);
      }
    } else if (data.type === 'shape-end') {
      // Remote user finished drawing a shape
      const p = peers[sender];
      if (p.shapeStart) {
        // Restore saved state and draw final shape
        if (p.savedCanvasImage) {
          ctx.putImageData(p.savedCanvasImage, 0, 0);
          p.savedCanvasImage = null;
        }
        drawShape(data.startX, data.startY, data.endX, data.endY, data.shapeType, data.color, data.size, data.erasing, data.opacity || 100);
        p.shapeStart = null;
        p.shapeType = null;
        // Save to history after remote shape is drawn
        setTimeout(() => saveToHistory(), 50);
      }
    } else if (data.type === 'cursor') {
      peers[sender].cursor = { x: data.x, y: data.y };
      drawScene();
    } else if (data.type === 'clear') {
      clearLocalCanvas();
      // Clear all saved canvas images for peers
      Object.keys(peers).forEach(id => {
        peers[id].savedCanvasImage = null;
      });
      // Reset history after clear
      history = [];
      historyIndex = -1;
      saveToHistory();
    } else if (data.type === 'undo' || data.type === 'redo') {
      // Remote user performed undo/redo - sync canvas state
      if (data.canvasData) {
        const img = new Image();
        img.onload = () => {
          // Save current state before updating
          const previousState = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          // Update canvas with remote state
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          
          // Get the new state
          const newState = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          // Update history: remove any states after current index, then add new state
          if (historyIndex < history.length - 1) {
            history = history.slice(0, historyIndex + 1);
          }
          
          // Add the new state to history
          history.push(newState);
          historyIndex = history.length - 1;
          
          // Limit history size
          if (history.length > MAX_HISTORY) {
            history.shift();
            historyIndex--;
          }
          
          updateUndoRedoButtons();
        };
        img.src = data.canvasData;
      }
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
    // Also clear cursor overlay when clearing canvas
    cursorCtx.clearRect(0, 0, cursorOverlay.width, cursorOverlay.height);
  }

  // draw cursors with labels on overlay canvas (separate from drawing canvas)
  function drawScene() {
    // Clear the cursor overlay completely before redrawing
    cursorCtx.clearRect(0, 0, cursorOverlay.width, cursorOverlay.height);
    
    // Draw all active cursors
    Object.keys(peers).forEach(id => {
      const p = peers[id];
      if (!p || !p.cursor) return;
      const x = p.cursor.x, y = p.cursor.y;
      const name = p.name || `User${id}`;
      const color = p.color || '#000';
      
      // label background
      cursorCtx.font = '12px sans-serif';
      const padding = 6;
      const txtWidth = cursorCtx.measureText(name).width;
      const rectW = txtWidth + padding;
      const rectH = 18;
      
      // draw rounded-ish rectangle bg
      cursorCtx.fillStyle = 'rgba(255,255,255,0.9)';
      cursorCtx.fillRect(x + 10, y - rectH / 2, rectW, rectH);
      
      // border colored accent
      cursorCtx.strokeStyle = color;
      cursorCtx.lineWidth = 1;
      cursorCtx.strokeRect(x + 10, y - rectH / 2, rectW, rectH);
      
      // text
      cursorCtx.fillStyle = '#000';
      cursorCtx.fillText(name, x + 12, y + 5);
      
      // small colored dot
      cursorCtx.beginPath();
      cursorCtx.arc(x + 6, y, 5, 0, Math.PI * 2);
      cursorCtx.fillStyle = color;
      cursorCtx.fill();
      cursorCtx.closePath();
    });
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
    drawMode = getDrawMode();
    
    if (drawMode === 'text') {
      // Text tool - show modal
      textPosition = { x: pos.x, y: pos.y };
      textModal.style.display = 'flex';
      textInput.focus();
      canvas.classList.add('text-mode');
      return;
    }

    drawing = true;
    current.color = colorInput.value;
    current.size = +sizeInput.value;
    current.opacity = +opacityInput.value;
    current.erasing = eraserBtn.dataset.active === 'true';
    current.x = pos.x; current.y = pos.y;

    if (drawMode === 'freehand') {
      // Freehand drawing
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      send({ type: 'begin', x: pos.x, y: pos.y, color: current.color, size: current.size, erasing: current.erasing, opacity: current.opacity });
    } else {
      // Shape drawing - save current canvas state
      shapeStart = { x: pos.x, y: pos.y };
      saveCanvasState();
      send({ type: 'shape-begin', x: pos.x, y: pos.y, shapeType: drawMode, color: current.color, size: current.size, erasing: current.erasing, opacity: current.opacity });
    }
  }

  function moveDraw(pos) {
    if (!drawing) {
      // send cursor update
      sendCursor(pos);
      return;
    }

      if (drawMode === 'freehand') {
      // Freehand drawing
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = current.erasing ? '#ffffff' : current.color;
      ctx.globalAlpha = current.opacity / 100;
      ctx.lineWidth = current.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1.0;
      send({ type: 'draw', x: pos.x, y: pos.y, size: current.size, erasing: current.erasing, opacity: current.opacity });
      current.x = pos.x; current.y = pos.y;
    } else {
      // Shape drawing - show preview
      if (shapeStart) {
        drawShapePreview(shapeStart.x, shapeStart.y, pos.x, pos.y, drawMode);
        send({ type: 'shape-move', x: pos.x, y: pos.y });
      }
    }
  }

  function endDraw() {
    if (!drawing) return;
    
    if (drawMode === 'freehand') {
      // Freehand drawing
      drawing = false;
      ctx.closePath();
      send({ type: 'end', erasing: current.erasing });
      saveToHistory();
    } else {
      // Shape drawing - commit the shape
      if (shapeStart) {
        const endPos = current;
        drawShape(shapeStart.x, shapeStart.y, endPos.x, endPos.y, drawMode, current.color, current.size, current.erasing, current.opacity);
        send({ 
          type: 'shape-end', 
          startX: shapeStart.x, 
          startY: shapeStart.y, 
          endX: endPos.x, 
          endY: endPos.y,
          shapeType: drawMode,
          color: current.color,
          size: current.size,
          erasing: current.erasing,
          opacity: current.opacity
        });
        shapeStart = null;
        savedCanvasImage = null;
        saveToHistory();
      }
      drawing = false;
    }
  }

  // pointer events hookup
  canvas.addEventListener('mousedown', (e) => {
    const pos = getPointerPos(e);
    current.x = pos.x;
    current.y = pos.y;
    beginDraw(pos);
  });
  canvas.addEventListener('mousemove', (e) => {
    const pos = getPointerPos(e);
    current.x = pos.x;
    current.y = pos.y;
    moveDraw(pos);
  });
  canvas.addEventListener('mouseup', (e) => {
    if (drawing && drawMode !== 'freehand') {
      const pos = getPointerPos(e);
      current.x = pos.x;
      current.y = pos.y;
    }
    endDraw();
  });
  canvas.addEventListener('mouseout', (e) => {
    if (drawing && drawMode !== 'freehand') {
      // Cancel shape drawing if mouse leaves canvas
      if (shapeStart) {
        restoreCanvasState();
        shapeStart = null;
        savedCanvasImage = null;
        drawing = false;
      }
    } else {
      endDraw();
    }
  });

  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); beginDraw(getPointerPos(e)); });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); moveDraw(getPointerPos(e)); });
  canvas.addEventListener('touchend', (e) => { e.preventDefault(); endDraw(); });

  // Update size value display
  sizeInput.addEventListener('input', () => {
    if (sizeValue) {
      sizeValue.textContent = sizeInput.value;
    }
  });

  // Update opacity value display
  opacityInput.addEventListener('input', () => {
    if (opacityValue) {
      opacityValue.textContent = opacityInput.value;
      current.opacity = +opacityInput.value;
    }
  });


  // Undo/Redo buttons
  undoBtn.addEventListener('click', () => undo(false));
  redoBtn.addEventListener('click', () => redo(false));

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    }
  });

  // Export button
  exportBtn.addEventListener('click', exportCanvas);

  // Text modal handlers
  textConfirm.addEventListener('click', () => {
    const text = textInput.value.trim();
    if (text && textPosition) {
      drawText(text, textPosition.x, textPosition.y);
      textInput.value = '';
      textModal.style.display = 'none';
      textPosition = null;
      saveToHistory();
    }
  });

  textCancel.addEventListener('click', () => {
    textInput.value = '';
    textModal.style.display = 'none';
    textPosition = null;
  });

  // Close modal on outside click
  textModal.addEventListener('click', (e) => {
    if (e.target === textModal) {
      textInput.value = '';
      textModal.style.display = 'none';
      textPosition = null;
    }
  });

  // Draw text function
  function drawText(text, x, y) {
    ctx.save();
    ctx.font = `${current.size * 4}px Arial`;
    ctx.fillStyle = current.erasing ? '#ffffff' : current.color;
    ctx.globalAlpha = current.opacity / 100;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // toolbar actions
  eraserBtn.addEventListener('click', () => {
    const active = eraserBtn.dataset.active === 'true';
    eraserBtn.dataset.active = (!active).toString();
    if (!active) {
      eraserBtn.classList.add('active');
      eraserBtn.textContent = 'Eraser ✓';
    } else {
      eraserBtn.classList.remove('active');
      eraserBtn.textContent = 'Eraser';
    }
  });

  clearBtn.addEventListener('click', () => {
    clearLocalCanvas();
    send({ type: 'clear' });
    // Clear history and start fresh
    history = [];
    historyIndex = -1;
    saveToHistory();
    updateUndoRedoButtons();
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
    // only send if user opted-in to share cursor
    if (!shareCursorCheckbox || !shareCursorCheckbox.checked) return;
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

  // Get draw mode from radio buttons
  function getDrawMode() {
    const checked = document.querySelector('input[name="drawMode"]:checked');
    return checked ? checked.value : 'freehand';
  }

  // Initialize shape preview canvas (offscreen)
  function initShapePreview() {
    shapePreviewCanvas = document.createElement('canvas');
    shapePreviewCanvas.width = canvas.width;
    shapePreviewCanvas.height = canvas.height;
    shapePreviewCtx = shapePreviewCanvas.getContext('2d');
  }

  // Save current canvas state
  function saveCanvasState() {
    savedCanvasImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  // Restore canvas state
  function restoreCanvasState() {
    if (savedCanvasImage) {
      ctx.putImageData(savedCanvasImage, 0, 0);
    }
  }

  // Draw shape preview (overloaded for local and remote)
  function drawShapePreview(startX, startY, endX, endY, shapeType, color, size, erasing, opacity) {
    // Use provided parameters or fall back to current drawing state
    const strokeColor = color !== undefined ? (erasing ? '#ffffff' : color) : (current.erasing ? '#ffffff' : current.color);
    const strokeSize = size !== undefined ? size : current.size;
    const shapeOpacity = opacity !== undefined ? opacity : current.opacity;
    
    if (color === undefined && !savedCanvasImage) return;
    
    // Restore saved state if this is a local preview
    if (color === undefined) {
      restoreCanvasState();
    }
    
    ctx.save();
    ctx.globalAlpha = shapeOpacity / 100;
    
    // Calculate shape dimensions
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = strokeColor;
    ctx.lineWidth = strokeSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    
    switch (shapeType) {
      case 'rectangle':
        ctx.rect(x, y, width, height);
        break;
      case 'circle':
        const radiusX = width / 2;
        const radiusY = height / 2;
        const centerX = startX + (endX - startX) / 2;
        const centerY = startY + (endY - startY) / 2;
        ctx.ellipse(centerX, centerY, Math.abs(radiusX), Math.abs(radiusY), 0, 0, Math.PI * 2);
        break;
      case 'line':
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        break;
    }
    
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  }

  // Draw final shape
  function drawShape(startX, startY, endX, endY, shapeType, color, size, erasing, opacity) {
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    
    ctx.save();
    ctx.globalAlpha = opacity / 100;
    ctx.strokeStyle = erasing ? '#ffffff' : color;
    ctx.fillStyle = erasing ? '#ffffff' : color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    
    switch (shapeType) {
      case 'rectangle':
        ctx.rect(x, y, width, height);
        break;
      case 'circle':
        const radiusX = width / 2;
        const radiusY = height / 2;
        const centerX = startX + (endX - startX) / 2;
        const centerY = startY + (endY - startY) / 2;
        ctx.ellipse(centerX, centerY, Math.abs(radiusX), Math.abs(radiusY), 0, 0, Math.PI * 2);
        break;
      case 'line':
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        break;
    }
    
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  }

  // Listen for draw mode changes
  document.querySelectorAll('input[name="drawMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      drawMode = e.target.value;
      if (drawMode === 'text') {
        canvas.classList.add('text-mode');
      } else {
        canvas.classList.remove('text-mode');
      }
    });
  });

  // initialize canvas and white background
  window.addEventListener('load', () => {
    resize();
    clearLocalCanvas();
    initShapePreview();
    drawMode = getDrawMode();
    saveToHistory(); // Save initial empty state
    updateUndoRedoButtons();
  });

})();
