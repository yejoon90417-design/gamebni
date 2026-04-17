const socket = io("/catch");
const appSession = window.GamebniSession.createClient("catch");
socket.auth = {
  ...(socket.auth || {}),
  playerSessionId: appSession.playerSessionId
};
socket.disconnect().connect();

const PHASE_TEXT = {
  lobby: "대기",
  drawing: "그리기",
  "turn-result": "결과",
  result: "종료"
};

const state = {
  room: null,
  roomCode: "",
  pendingJoin: false,
  restoreAttempted: false,
  chatStatus: "",
  lastChatLogMessageId: "",
  roomUpdatedAt: 0,
  liveTimerId: null,
  topicNoticeTimerId: null,
  lastTopicNoticeKey: "",
  brushColor: "#111111",
  brushSize: 6,
  activeStroke: null,
  optimisticStrokes: [],
  resizeObserver: null
};

const elements = {
  entryScreen: document.getElementById("entryScreen"),
  gameScreen: document.getElementById("gameScreen"),
  nameInput: document.getElementById("nameInput"),
  targetPlayerCountInput: document.getElementById("targetPlayerCountInput"),
  roundCountInput: document.getElementById("roundCountInput"),
  roomInput: document.getElementById("roomInput"),
  entryStatus: document.getElementById("entryStatus"),
  roomBadge: document.getElementById("roomBadge"),
  playerBadge: document.getElementById("playerBadge"),
  roundBadge: document.getElementById("roundBadge"),
  phaseBadge: document.getElementById("phaseBadge"),
  statusBadge: document.getElementById("statusBadge"),
  topicBadge: document.getElementById("topicBadge"),
  wordBadge: document.getElementById("wordBadge"),
  timerBadge: document.getElementById("timerBadge"),
  topicNotice: document.getElementById("topicNotice"),
  topicNoticeTitle: document.getElementById("topicNoticeTitle"),
  topicNoticeWord: document.getElementById("topicNoticeWord"),
  botTools: document.getElementById("botTools"),
  botCountInput: document.getElementById("botCountInput"),
  addBotButton: document.getElementById("addBotButton"),
  startButton: document.getElementById("startButton"),
  resetButton: document.getElementById("resetButton"),
  leaveButton: document.getElementById("leaveButton"),
  chatLogList: document.getElementById("chatLogList"),
  playerList: document.getElementById("playerList"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  sendChatButton: document.getElementById("sendChatButton"),
  chatStatus: document.getElementById("chatStatus"),
  createRoomButton: document.getElementById("createRoomButton"),
  joinRoomButton: document.getElementById("joinRoomButton"),
  drawingCanvas: document.getElementById("drawingCanvas"),
  canvasShell: document.getElementById("canvasShell"),
  canvasEmpty: document.getElementById("canvasEmpty"),
  colorTools: document.getElementById("colorTools"),
  brushSizeInput: document.getElementById("brushSizeInput"),
  undoButton: document.getElementById("undoButton"),
  redoButton: document.getElementById("redoButton"),
  clearCanvasButton: document.getElementById("clearCanvasButton")
};

appSession.hydrateEntry({
  nameInput: elements.nameInput,
  roomInput: elements.roomInput
});

function currentName() {
  return elements.nameInput.value.trim();
}

function currentRoomInput() {
  return elements.roomInput.value.trim().toUpperCase();
}

function rememberSessionRoom(roomCode = state.roomCode, name = currentName()) {
  appSession.rememberRoom(state.room?.me?.name || name, roomCode);
}

function setEntryStatus(text) {
  elements.entryStatus.textContent = text || "";
}

function setChatStatus(text) {
  state.chatStatus = text || "";
  elements.chatStatus.textContent = state.chatStatus;
}

function clearTopicNoticeTimer() {
  if (!state.topicNoticeTimerId) {
    return;
  }

  clearTimeout(state.topicNoticeTimerId);
  state.topicNoticeTimerId = null;
}

function hideTopicNotice() {
  clearTopicNoticeTimer();
  if (!elements.topicNotice) {
    return;
  }

  elements.topicNotice.hidden = true;
  elements.topicNotice.classList.remove("is-visible");
}

function showTopicNotice(title, word = "") {
  if (!elements.topicNotice) {
    return;
  }

  elements.topicNoticeTitle.textContent = title || "";
  elements.topicNoticeWord.textContent = word || "";
  elements.topicNotice.hidden = false;
  elements.topicNotice.classList.add("is-visible");

  clearTopicNoticeTimer();
  state.topicNoticeTimerId = window.setTimeout(() => {
    hideTopicNotice();
  }, 2600);
}

function syncTopicNotice(room = state.room) {
  if (!room?.canDraw || room.phase !== "drawing") {
    if (!room || room.phase !== "drawing") {
      state.lastTopicNoticeKey = "";
    }
    hideTopicNotice();
    return;
  }

  const noticeKey = [
    room.code,
    room.currentRound,
    room.turnNumber,
    room.currentDrawerId,
    room.wordTopic || "",
    room.visibleWord || ""
  ].join(":");

  if (state.lastTopicNoticeKey === noticeKey) {
    return;
  }

  state.lastTopicNoticeKey = noticeKey;
  showTopicNotice(room.visibleWord || "", "");
}

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

async function syncRoomState(code) {
  const response = await emitWithAck("room:state", { code });
  if (!response?.ok || !response.room) {
    return null;
  }

  return response.room;
}

function isMyTurnToDraw(room = state.room) {
  return Boolean(room?.canDraw);
}

function timeLeftSeconds(room = state.room) {
  if (!room?.timeLeftMs) {
    return 0;
  }

  const elapsed = Math.max(Date.now() - (state.roomUpdatedAt || Date.now()), 0);
  return Math.max(Math.ceil((room.timeLeftMs - elapsed) / 1000), 0);
}

function clearLiveTimer() {
  if (!state.liveTimerId) {
    return;
  }

  clearTimeout(state.liveTimerId);
  state.liveTimerId = null;
}

function scheduleLiveTimer() {
  clearLiveTimer();

  if (!state.room || !state.room.timeLeftMs || !["drawing", "turn-result"].includes(state.room.phase)) {
    return;
  }

  state.liveTimerId = window.setTimeout(() => {
    state.liveTimerId = null;
    renderHeader();
    renderBoardInfo();
    scheduleLiveTimer();
  }, 250);
}

function displayStatus(room = state.room) {
  if (!room) {
    return "";
  }

  if (room.phase === "lobby") {
    return `${room.players.length}/${room.targetPlayerCount}명`;
  }

  if (room.phase === "drawing") {
    return `${timeLeftSeconds(room)}초`;
  }

  if (room.phase === "turn-result") {
    return room.recentAction?.text || room.visibleWord || "";
  }

  return room.result?.reason || "게임 종료";
}

function renderScreens() {
  const inRoom = Boolean(state.room) || state.pendingJoin;
  elements.entryScreen.hidden = inRoom;
  elements.gameScreen.hidden = !inRoom;
  elements.entryScreen.style.display = inRoom ? "none" : "grid";
  elements.gameScreen.style.display = inRoom ? "grid" : "none";
}

function renderHeader() {
  if (!state.room) {
    return;
  }

  elements.roomBadge.textContent = `방 ${state.room.code}`;
  elements.playerBadge.textContent = `${state.room.players.length}/${state.room.targetPlayerCount}명`;
  elements.roundBadge.textContent = `라운드 ${Math.max(state.room.currentRound, 1)}/${state.room.maxRound}`;
  elements.phaseBadge.textContent = PHASE_TEXT[state.room.phase] || state.room.phase;
  elements.statusBadge.textContent = displayStatus();
}

function renderControls() {
  if (!state.room) {
    return;
  }

  const isHost = state.room.hostId === state.room.me?.id;
  const openSlots = Math.max(state.room.targetPlayerCount - state.room.players.length, 0);
  const canAddBot = state.room.phase === "lobby" && isHost && openSlots > 0;

  elements.botTools.hidden = !canAddBot;
  elements.botCountInput.max = String(Math.max(openSlots, 1));
  elements.startButton.hidden = !(state.room.phase === "lobby" && isHost);
  elements.startButton.disabled =
    state.room.players.length !== state.room.targetPlayerCount || state.room.players.length < 2;
  elements.resetButton.hidden = !(state.room.phase === "result" && isHost);
  elements.chatInput.disabled = state.room.phase === "lobby";
  elements.sendChatButton.disabled = state.room.phase === "lobby";
  elements.undoButton.disabled = !state.room.canUndo;
  elements.redoButton.disabled = !state.room.canRedo;
  elements.clearCanvasButton.disabled = !state.room.canDraw;
}

function messageClassName(message) {
  const classes = ["chat-log-item"];
  if (message.kind === "system") {
    classes.push("is-system");
  }
  if (message.playerId && message.playerId === state.room?.me?.id) {
    classes.push("is-self");
  }
  return classes.join(" ");
}

function renderChatLog() {
  if (!state.room) {
    elements.chatLogList.innerHTML = "";
    state.lastChatLogMessageId = "";
    return;
  }

  const messages = state.room.messages || [];
  const previousScrollTop = elements.chatLogList.scrollTop;
  const previousScrollHeight = elements.chatLogList.scrollHeight;
  const wasNearBottom =
    previousScrollTop + elements.chatLogList.clientHeight >= previousScrollHeight - 24;
  const nextLastMessageId = messages[messages.length - 1]?.id || "";
  const hasNewMessage = nextLastMessageId !== state.lastChatLogMessageId;

  elements.chatLogList.innerHTML = "";
  messages.forEach((message) => {
    const item = document.createElement("article");
    item.className = messageClassName(message);

    const name = document.createElement("span");
    name.className = "chat-log-name";
    name.textContent = message.name || "";

    const text = document.createElement("div");
    text.className = "chat-log-text";
    text.textContent = message.text || "";

    item.append(name, text);
    elements.chatLogList.append(item);
  });

  state.lastChatLogMessageId = nextLastMessageId;

  if (wasNearBottom || hasNewMessage) {
    elements.chatLogList.scrollTop = elements.chatLogList.scrollHeight;
    return;
  }

  const heightDiff = elements.chatLogList.scrollHeight - previousScrollHeight;
  elements.chatLogList.scrollTop = previousScrollTop + heightDiff;
}

function renderPlayers() {
  if (!state.room) {
    elements.playerList.innerHTML = "";
    return;
  }

  elements.playerList.innerHTML = "";

  const sortedPlayers = [...state.room.players].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.name.localeCompare(right.name, "ko");
  });

  sortedPlayers.forEach((player) => {
    const card = document.createElement("article");
    card.className = "player-card";
    if (player.id === state.room.currentDrawerId) {
      card.classList.add("is-current");
    }

    const row = document.createElement("div");
    row.className = "player-row";

    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;

    const score = document.createElement("span");
    score.className = "player-score";
    score.textContent = `${player.score}점`;

    row.append(name, score);

    const meta = document.createElement("div");
    meta.className = "player-meta";

    if (player.isHost) {
      const pill = document.createElement("span");
      pill.className = "player-pill";
      pill.textContent = "HOST";
      meta.append(pill);
    }

    if (player.isBot) {
      const pill = document.createElement("span");
      pill.className = "player-pill";
      pill.textContent = "BOT";
      meta.append(pill);
    }

    if (player.id === state.room.currentDrawerId) {
      const pill = document.createElement("span");
      pill.className = "player-pill is-accent";
      pill.textContent = "DRAW";
      meta.append(pill);
    }

    if (!player.connected) {
      const pill = document.createElement("span");
      pill.className = "player-pill";
      pill.textContent = "OFF";
      meta.append(pill);
    }

    if (player.guessedAtTurn === state.room.turnNumber) {
      const pill = document.createElement("span");
      pill.className = "player-pill is-accent";
      pill.textContent = "정답";
      meta.append(pill);
    }

    card.append(row, meta);
    elements.playerList.append(card);
  });
}

function renderBoardInfo() {
  if (!state.room) {
    return;
  }

  const isDrawing = state.room.phase === "drawing";
  const showEmpty = state.room.phase === "lobby";

  if (elements.topicBadge) {
    elements.topicBadge.hidden = true;
  }
  elements.wordBadge.textContent = state.room.visibleWord || "-";
  elements.timerBadge.textContent =
    isDrawing || state.room.phase === "turn-result"
      ? `${timeLeftSeconds(state.room)}초`
      : state.room.recentAction?.text || "-";

  elements.canvasEmpty.hidden = !showEmpty;
  elements.canvasEmpty.style.display = showEmpty ? "grid" : "none";
}

function renderChoices() {
  return;
}

function clearCanvasSurface() {
  const context = elements.drawingCanvas.getContext("2d");
  if (!context) {
    return;
  }

  context.clearRect(0, 0, elements.drawingCanvas.width, elements.drawingCanvas.height);
}

function drawStroke(context, stroke) {
  if (!stroke?.points?.length) {
    return;
  }

  const devicePixelRatio = window.devicePixelRatio || 1;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size * devicePixelRatio;
  context.beginPath();

  stroke.points.forEach((point, index) => {
    const x = point.x * elements.drawingCanvas.width;
    const y = point.y * elements.drawingCanvas.height;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();
}

function syncCanvasSize() {
  const rect = elements.canvasShell.getBoundingClientRect();
  const devicePixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(Math.floor(rect.width * devicePixelRatio), 1);
  const height = Math.max(Math.floor(rect.height * devicePixelRatio), 1);

  if (elements.drawingCanvas.width === width && elements.drawingCanvas.height === height) {
    return false;
  }

  elements.drawingCanvas.width = width;
  elements.drawingCanvas.height = height;
  return true;
}

function renderCanvas() {
  const resized = syncCanvasSize();
  if (!state.room && !resized) {
    clearCanvasSurface();
    return;
  }

  const context = elements.drawingCanvas.getContext("2d");
  if (!context) {
    return;
  }

  context.clearRect(0, 0, elements.drawingCanvas.width, elements.drawingCanvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, elements.drawingCanvas.width, elements.drawingCanvas.height);

  const strokes = [
    ...(state.room?.strokes || []),
    ...state.optimisticStrokes,
    ...(state.activeStroke ? [state.activeStroke] : [])
  ];

  strokes.forEach((stroke) => drawStroke(context, stroke));
  elements.canvasShell.classList.toggle("is-readonly", !isMyTurnToDraw());
}

function renderToolState() {
  const buttons = elements.colorTools.querySelectorAll(".tool-color");
  buttons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.color === state.brushColor);
    button.disabled = !state.room?.canDraw;
  });

  elements.brushSizeInput.value = String(state.brushSize);
  elements.brushSizeInput.disabled = !state.room?.canDraw;
}

function render() {
  renderScreens();
  if (!state.room) {
    setChatStatus("");
    hideTopicNotice();
    return;
  }

  renderHeader();
  renderControls();
  renderChatLog();
  renderPlayers();
  renderBoardInfo();
  renderChoices();
  renderToolState();
  renderCanvas();
  scheduleLiveTimer();
}

function updateRoom(room) {
  state.room = room;
  state.roomCode = room.code;
  state.pendingJoin = false;
  state.roomUpdatedAt = Date.now();
  state.optimisticStrokes = [];
  rememberSessionRoom(room.code);
  render();
  syncTopicNotice(room);
}

async function createRoom() {
  const name = currentName();
  if (!name) {
    setEntryStatus("닉네임을 먼저 입력하세요.");
    return;
  }

  setEntryStatus("");
  const response = await emitWithAck("room:create", {
    name,
    settings: {
      targetPlayerCount: Number(elements.targetPlayerCountInput.value),
      roundCount: Number(elements.roundCountInput.value)
    }
  });

  if (!response?.ok) {
    setEntryStatus(response?.message || "방을 만들지 못했습니다.");
    return;
  }

  state.pendingJoin = true;
  renderScreens();

  const room = response.room || (await syncRoomState(response.code));
  if (!room) {
    state.pendingJoin = false;
    renderScreens();
    setEntryStatus("방 상태를 불러오지 못했습니다.");
    return;
  }

  updateRoom(room);
}

async function joinRoom() {
  const name = currentName();
  const code = currentRoomInput();

  if (!name) {
    setEntryStatus("닉네임을 먼저 입력하세요.");
    return;
  }

  if (!code) {
    setEntryStatus("방 코드를 입력하세요.");
    return;
  }

  setEntryStatus("");
  const response = await emitWithAck("room:join", {
    code,
    name
  });

  if (!response?.ok) {
    setEntryStatus(response?.message || "방에 입장하지 못했습니다.");
    return;
  }

  state.pendingJoin = true;
  renderScreens();

  const room = response.room || (await syncRoomState(response.code));
  if (!room) {
    state.pendingJoin = false;
    renderScreens();
    setEntryStatus("방 상태를 불러오지 못했습니다.");
    return;
  }

  updateRoom(room);
}

async function leaveRoom() {
  await emitWithAck("room:leave", {});
  appSession.clearRoom();
  state.room = null;
  state.roomCode = "";
  state.pendingJoin = false;
  state.activeStroke = null;
  state.optimisticStrokes = [];
  state.lastTopicNoticeKey = "";
  hideTopicNotice();
  clearLiveTimer();
  renderScreens();
  render();
}

async function startGame() {
  if (!state.room) {
    return;
  }

  const response = await emitWithAck("game:start", { code: state.room.code });
  if (!response?.ok) {
    setChatStatus(response?.message || "게임을 시작하지 못했습니다.");
  }
}

async function resetGame() {
  if (!state.room) {
    return;
  }

  const response = await emitWithAck("game:reset", { code: state.room.code });
  if (!response?.ok) {
    setChatStatus(response?.message || "게임을 다시 시작하지 못했습니다.");
  }
}

async function addBots() {
  if (!state.room) {
    return;
  }

  const response = await emitWithAck("room:add_bots", {
    code: state.room.code,
    count: Number(elements.botCountInput.value) || 1
  });

  if (!response?.ok) {
    setChatStatus(response?.message || "봇을 추가하지 못했습니다.");
    return;
  }

  setChatStatus("");
}

async function sendChat(text) {
  if (!state.room) {
    return;
  }

  const response = await emitWithAck("chat:send", {
    code: state.room.code,
    text
  });

  if (!response?.ok) {
    setChatStatus(response?.message || "채팅을 전송하지 못했습니다.");
    return;
  }

  setChatStatus("");
}

async function clearCanvas() {
  if (!state.room?.canDraw) {
    return;
  }

  const response = await emitWithAck("draw:clear", { code: state.room.code });
  if (!response?.ok) {
    setChatStatus(response?.message || "캔버스를 지우지 못했습니다.");
  }
}

async function undoCanvas() {
  if (!state.room?.canUndo) {
    return;
  }

  const response = await emitWithAck("draw:undo", { code: state.room.code });
  if (!response?.ok) {
    setChatStatus(response?.message || "실행 취소하지 못했습니다.");
  }
}

async function redoCanvas() {
  if (!state.room?.canRedo) {
    return;
  }

  const response = await emitWithAck("draw:redo", { code: state.room.code });
  if (!response?.ok) {
    setChatStatus(response?.message || "다시 실행하지 못했습니다.");
  }
}

function shouldIgnoreShortcutTarget(target) {
  if (!target) {
    return false;
  }

  const tagName = String(target.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}

function pointerToPoint(event) {
  const rect = elements.drawingCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

function beginStroke(event) {
  if (!state.room?.canDraw) {
    return;
  }

  event.preventDefault();
  const point = pointerToPoint(event);
  if (!point) {
    return;
  }

  if (typeof event.pointerId === "number" && elements.drawingCanvas.setPointerCapture) {
    elements.drawingCanvas.setPointerCapture(event.pointerId);
  }

  state.activeStroke = {
    color: state.brushColor,
    size: state.brushSize,
    points: [point]
  };
  renderCanvas();
}

function extendStroke(event) {
  if (!state.activeStroke) {
    return;
  }

  event.preventDefault();
  const point = pointerToPoint(event);
  if (!point) {
    return;
  }

  state.activeStroke.points.push(point);
  renderCanvas();
}

async function endStroke(event) {
  if (!state.activeStroke) {
    return;
  }

  event.preventDefault();
  const point = pointerToPoint(event);
  if (point) {
    state.activeStroke.points.push(point);
  }

  if (typeof event.pointerId === "number" && elements.drawingCanvas.releasePointerCapture) {
    try {
      elements.drawingCanvas.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // ignore
    }
  }

  const stroke = {
    color: state.activeStroke.color,
    size: state.activeStroke.size,
    points: state.activeStroke.points.slice(0, 240)
  };

  state.optimisticStrokes.push(stroke);
  state.activeStroke = null;
  renderCanvas();

  const response = await emitWithAck("draw:stroke", {
    code: state.room.code,
    stroke
  });

  if (!response?.ok) {
    state.optimisticStrokes = [];
    renderCanvas();
    setChatStatus(response?.message || "그림을 전송하지 못했습니다.");
  }
}

function mouseLikeEvent(event) {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    preventDefault() {
      event.preventDefault();
    }
  };
}

function touchLikeEvent(touch, sourceEvent) {
  return {
    clientX: touch.clientX,
    clientY: touch.clientY,
    preventDefault() {
      sourceEvent.preventDefault();
    }
  };
}

async function tryRestoreRoom() {
  if (state.restoreAttempted) {
    return;
  }

  state.restoreAttempted = true;
  const saved = appSession.getSavedRoom();
  if (!saved) {
    return;
  }

  if (!elements.nameInput.value.trim() && saved.name) {
    elements.nameInput.value = saved.name;
  }

  if (!elements.roomInput.value.trim() && saved.roomCode) {
    elements.roomInput.value = saved.roomCode;
  }

  if (!saved.name || !saved.roomCode) {
    return;
  }

  const response = await emitWithAck("room:join", {
    code: saved.roomCode,
    name: saved.name
  });

  if (!response?.ok) {
    appSession.clearRoom();
    return;
  }

  updateRoom(response.room);
}

socket.on("room:update", (room) => {
  updateRoom(room);
});

socket.on("connect", () => {
  tryRestoreRoom();
});

elements.createRoomButton.addEventListener("click", () => {
  createRoom().catch((error) => {
    setEntryStatus(error?.message || "방을 만들지 못했습니다.");
  });
});

elements.joinRoomButton.addEventListener("click", () => {
  joinRoom().catch((error) => {
    setEntryStatus(error?.message || "방에 입장하지 못했습니다.");
  });
});

elements.startButton.addEventListener("click", () => {
  startGame().catch((error) => {
    setChatStatus(error?.message || "게임을 시작하지 못했습니다.");
  });
});

elements.addBotButton.addEventListener("click", () => {
  addBots().catch((error) => {
    setChatStatus(error?.message || "봇을 추가하지 못했습니다.");
  });
});

elements.resetButton.addEventListener("click", () => {
  resetGame().catch((error) => {
    setChatStatus(error?.message || "게임을 다시 시작하지 못했습니다.");
  });
});

elements.leaveButton.addEventListener("click", () => {
  leaveRoom().catch((error) => {
    setChatStatus(error?.message || "방에서 나가지 못했습니다.");
  });
});

elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = elements.chatInput.value.trim();
  if (!text) {
    return;
  }

  sendChat(text).then(() => {
    elements.chatInput.value = "";
  });
});

elements.colorTools.addEventListener("click", (event) => {
  const button = event.target.closest(".tool-color");
  if (!button) {
    return;
  }

  state.brushColor = button.dataset.color || "#111111";
  renderToolState();
});

elements.brushSizeInput.addEventListener("input", () => {
  state.brushSize = Number(elements.brushSizeInput.value) || 6;
});

elements.clearCanvasButton.addEventListener("click", () => {
  clearCanvas().catch((error) => {
    setChatStatus(error?.message || "캔버스를 지우지 못했습니다.");
  });
});

elements.undoButton.addEventListener("click", () => {
  undoCanvas().catch((error) => {
    setChatStatus(error?.message || "실행 취소하지 못했습니다.");
  });
});

elements.redoButton.addEventListener("click", () => {
  redoCanvas().catch((error) => {
    setChatStatus(error?.message || "다시 실행하지 못했습니다.");
  });
});

if ("PointerEvent" in window) {
  elements.drawingCanvas.addEventListener("pointerdown", beginStroke);
  elements.drawingCanvas.addEventListener("pointermove", extendStroke);
  elements.drawingCanvas.addEventListener("pointerup", endStroke);
  elements.drawingCanvas.addEventListener("pointercancel", endStroke);
  elements.drawingCanvas.addEventListener("pointerleave", (event) => {
    if (event.buttons) {
      extendStroke(event);
    }
  });
} else {
  let mouseDrawing = false;

  elements.drawingCanvas.addEventListener("mousedown", (event) => {
    mouseDrawing = true;
    beginStroke(mouseLikeEvent(event));
  });

  elements.drawingCanvas.addEventListener("mousemove", (event) => {
    if (!mouseDrawing) {
      return;
    }
    extendStroke(mouseLikeEvent(event));
  });

  window.addEventListener("mouseup", (event) => {
    if (!mouseDrawing) {
      return;
    }
    mouseDrawing = false;
    endStroke(mouseLikeEvent(event));
  });

  elements.drawingCanvas.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.changedTouches?.[0];
      if (!touch) {
        return;
      }
      beginStroke(touchLikeEvent(touch, event));
    },
    { passive: false }
  );

  elements.drawingCanvas.addEventListener(
    "touchmove",
    (event) => {
      const touch = event.changedTouches?.[0];
      if (!touch) {
        return;
      }
      extendStroke(touchLikeEvent(touch, event));
    },
    { passive: false }
  );

  elements.drawingCanvas.addEventListener(
    "touchend",
    (event) => {
      const touch = event.changedTouches?.[0];
      if (!touch) {
        return;
      }
      endStroke(touchLikeEvent(touch, event));
    },
    { passive: false }
  );
}

window.addEventListener("resize", () => {
  renderCanvas();
});

window.addEventListener("keydown", (event) => {
  if (!state.room?.canDraw || shouldIgnoreShortcutTarget(event.target)) {
    return;
  }

  const key = String(event.key || "").toLowerCase();
  const withModifier = event.ctrlKey || event.metaKey;
  if (!withModifier) {
    return;
  }

  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    undoCanvas().catch((error) => {
      setChatStatus(error?.message || "실행 취소하지 못했습니다.");
    });
    return;
  }

  if (key === "y" || (key === "z" && event.shiftKey)) {
    event.preventDefault();
    redoCanvas().catch((error) => {
      setChatStatus(error?.message || "다시 실행하지 못했습니다.");
    });
  }
});

if ("ResizeObserver" in window) {
  state.resizeObserver = new ResizeObserver(() => {
    renderCanvas();
  });
  state.resizeObserver.observe(elements.canvasShell);
}

renderScreens();
render();
