const socket = io("/omok");
const CHAT_BUBBLE_TTL = 5000;

const state = {
  room: null,
  roomCode: "",
  flash: "",
  chatStatus: "",
  lastChatLogMessageId: "",
  chatIsComposing: false,
  pendingRoomUpdate: null,
  bubbleTimerId: null
};

const elements = {
  entryScreen: document.getElementById("entryScreen"),
  gameScreen: document.getElementById("gameScreen"),
  nameInput: document.getElementById("nameInput"),
  ruleGuide: document.getElementById("ruleGuide"),
  roomInput: document.getElementById("roomInput"),
  entryStatus: document.getElementById("entryStatus"),
  roomBadge: document.getElementById("roomBadge"),
  playerBadge: document.getElementById("playerBadge"),
  phaseBadge: document.getElementById("phaseBadge"),
  statusBadge: document.getElementById("statusBadge"),
  botTools: document.getElementById("botTools"),
  botCountInput: document.getElementById("botCountInput"),
  addBotButton: document.getElementById("addBotButton"),
  startButton: document.getElementById("startButton"),
  resetButton: document.getElementById("resetButton"),
  chatLogList: document.getElementById("chatLogList"),
  topSeat: document.getElementById("topSeat"),
  bottomSeat: document.getElementById("bottomSeat"),
  boardGrid: document.getElementById("boardGrid"),
  centerStatus: document.getElementById("centerStatus"),
  centerAction: document.getElementById("centerAction"),
  seatChatComposer: document.getElementById("seatChatComposer"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  sendChatButton: document.getElementById("sendChatButton"),
  chatStatus: document.getElementById("chatStatus"),
  createRoomButton: document.getElementById("createRoomButton"),
  joinRoomButton: document.getElementById("joinRoomButton")
};

const PHASE_TEXT = {
  lobby: "대기",
  playing: "진행",
  result: "결과"
};

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function isMyTurn(room = state.room) {
  return room?.currentPlayerId === room?.me?.id;
}

function currentPlayer(room = state.room) {
  return room?.players.find((player) => player.id === room.currentPlayerId) || null;
}

function otherPlayer(room = state.room) {
  if (!room?.me) {
    return null;
  }

  return room.players.find((player) => player.id !== room.me.id) || null;
}

function colorText(color) {
  if (color === "black") {
    return "흑";
  }
  if (color === "white") {
    return "백";
  }
  return "대기";
}

function setEntryStatus(text) {
  elements.entryStatus.textContent = text || "";
}

function setChatStatus(text) {
  state.chatStatus = text || "";
  elements.chatStatus.textContent = state.chatStatus;
}

function focusChatInput() {
  if (elements.seatChatComposer.hidden || elements.chatInput.disabled) {
    return;
  }

  window.requestAnimationFrame(() => {
    elements.chatInput.focus({ preventScroll: true });
    const caret = elements.chatInput.value.length;
    if (typeof elements.chatInput.setSelectionRange === "function") {
      elements.chatInput.setSelectionRange(caret, caret);
    }
  });
}

function displayStatus() {
  if (state.flash) {
    return state.flash;
  }

  if (!state.room) {
    return "";
  }

  if (state.room.phase === "lobby") {
    return `${state.room.players.length} / ${state.room.targetPlayerCount}명 입장`;
  }

  if (state.room.phase === "playing") {
    const player = currentPlayer();
    if (!player) {
      return "진행 중";
    }

    return `${player.name} ${colorText(player.color)} 차례`;
  }

  if (state.room.phase === "result") {
    return state.room.result?.reason || "게임 종료";
  }

  return "-";
}

function displayCenterStatus() {
  if (!state.room) {
    return "";
  }

  if (state.room.phase === "lobby") {
    return "호스트가 시작하면 흑과 백이 배정됩니다";
  }

  if (state.room.phase === "playing") {
    if (isMyTurn()) {
      return `내 차례 · ${colorText(state.room.me.color)}`;
    }

    const player = currentPlayer();
    return player ? `${player.name} ${colorText(player.color)} 차례` : "진행 중";
  }

  if (state.room.phase === "result") {
    return state.room.result?.reason || "게임 종료";
  }

  return "-";
}

function renderHeader() {
  const room = state.room;
  elements.roomBadge.textContent = `방 ${room.code}`;
  elements.playerBadge.textContent = `${room.players.length}/${room.targetPlayerCount}명`;
  elements.phaseBadge.textContent = PHASE_TEXT[room.phase] || room.phase;
  elements.statusBadge.textContent = displayStatus();
}

function renderControls() {
  const room = state.room;
  const isHost = room.hostId === room.me.id;
  const canAddBot = isHost && room.phase === "lobby" && room.players.length < room.targetPlayerCount;

  elements.botTools.hidden = !canAddBot;
  elements.startButton.hidden = !(room.phase === "lobby" && isHost);
  elements.startButton.disabled = room.players.length !== room.targetPlayerCount;
  elements.resetButton.hidden = !(room.phase === "result" && isHost);
}

function currentChatBubbles(room) {
  const now = Date.now();
  const bubbles = new Map();

  (room.messages || []).forEach((message) => {
    if (!message.playerId || typeof message.createdAt !== "number") {
      return;
    }

    if (now - message.createdAt > CHAT_BUBBLE_TTL) {
      return;
    }

    const previous = bubbles.get(message.playerId);
    if (!previous || previous.createdAt < message.createdAt) {
      bubbles.set(message.playerId, message);
    }
  });

  return bubbles;
}

function scheduleBubbleRefresh(room) {
  if (state.bubbleTimerId) {
    clearTimeout(state.bubbleTimerId);
    state.bubbleTimerId = null;
  }

  if (!room) {
    return;
  }

  const now = Date.now();
  let nextExpiry = null;

  (room.messages || []).forEach((message) => {
    if (typeof message.createdAt !== "number") {
      return;
    }

    const expiry = message.createdAt + CHAT_BUBBLE_TTL;
    if (expiry <= now) {
      return;
    }

    if (nextExpiry === null || expiry < nextExpiry) {
      nextExpiry = expiry;
    }
  });

  if (nextExpiry === null) {
    return;
  }

  state.bubbleTimerId = window.setTimeout(() => {
    if (!state.room) {
      return;
    }

    const shouldRestoreChatFocus = document.activeElement === elements.chatInput;
    renderSeats();
    renderSeatChatComposer();
    if (shouldRestoreChatFocus) {
      focusChatInput();
    }
    scheduleBubbleRefresh(state.room);
  }, Math.max(nextExpiry - now, 0) + 20);
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
  const wasNearTop = elements.chatLogList.scrollTop < 24;
  const nextLastMessageId = messages[messages.length - 1]?.id || "";
  const hasNewMessage = nextLastMessageId !== state.lastChatLogMessageId;
  elements.chatLogList.innerHTML = "";

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-log-empty";
    empty.textContent = "아직 채팅이 없습니다";
    elements.chatLogList.appendChild(empty);
    state.lastChatLogMessageId = "";
    return;
  }

  const fragment = document.createDocumentFragment();

  [...messages].reverse().forEach((message) => {
    const item = document.createElement("article");
    item.className = "chat-log-item";
    if (message.playerId === state.room.me?.id) {
      item.classList.add("is-self");
    }

    const name = document.createElement("strong");
    name.className = "chat-log-name";
    name.textContent = message.name || "플레이어";

    const text = document.createElement("p");
    text.className = "chat-log-text";
    text.textContent = message.text || "";

    item.append(name, text);
    fragment.appendChild(item);
  });

  elements.chatLogList.appendChild(fragment);

  if (hasNewMessage) {
    if (wasNearTop) {
      elements.chatLogList.scrollTop = 0;
    } else {
      elements.chatLogList.scrollTop =
        previousScrollTop + (elements.chatLogList.scrollHeight - previousScrollHeight);
    }
  } else {
    elements.chatLogList.scrollTop = previousScrollTop;
  }

  state.lastChatLogMessageId = nextLastMessageId;
}

function renderCenterAction() {
  const action = state.room?.recentAction;
  if (!action?.text) {
    elements.centerAction.hidden = true;
    elements.centerAction.textContent = "";
    elements.centerAction.className = "center-action";
    return;
  }

  elements.centerAction.hidden = false;
  elements.centerAction.textContent = action.text;
  elements.centerAction.className = `center-action tone-${action.tone || "neutral"}`;
}

function createBubble(message) {
  if (!message) {
    return null;
  }

  const bubble = document.createElement("span");
  bubble.className = "chat-bubble";
  bubble.textContent = message.text;
  return bubble;
}

function createSeat(player, options = {}) {
  const { isSelf = false, bubble = null } = options;
  const seat = document.createElement("section");
  seat.className = "player-seat";

  if (isSelf) {
    seat.classList.add("is-self");
  }
  if (player.isCurrent) {
    seat.classList.add("is-current");
  }

  if (bubble) {
    seat.appendChild(createBubble(bubble));
  }

  const frame = document.createElement("div");
  frame.className = "seat-frame";

  const topLine = document.createElement("div");
  topLine.className = "seat-topline";

  const name = document.createElement("strong");
  name.className = "seat-name";
  name.textContent = player.name;

  const identity = document.createElement("span");
  identity.className = "seat-chip";
  identity.textContent = isSelf ? "나" : player.isBot ? "BOT" : "상대";

  topLine.append(name, identity);

  const meta = document.createElement("div");
  meta.className = "seat-meta";

  const color = document.createElement("span");
  color.className = `seat-chip stone-${player.color || "white"}`;
  color.textContent = colorText(player.color);
  if (!player.color) {
    color.className = "seat-chip";
  }

  const status = document.createElement("span");
  status.className = "seat-chip";
  if (player.isCurrent && state.room.phase === "playing") {
    status.classList.add("is-current");
    status.textContent = "차례";
  } else if (state.room.phase === "result" && state.room.result?.winnerId === player.id) {
    status.textContent = "승리";
  } else {
    status.textContent = state.room.phase === "lobby" ? "대기" : "준비";
  }

  meta.append(color, status);
  frame.append(topLine, meta);
  seat.appendChild(frame);
  return seat;
}

function createPlaceholderSeat(text) {
  const seat = document.createElement("section");
  seat.className = "player-seat";

  const placeholder = document.createElement("div");
  placeholder.className = "seat-placeholder";
  placeholder.textContent = text;
  seat.appendChild(placeholder);

  return seat;
}

function renderSeats() {
  if (!state.room?.me) {
    elements.topSeat.innerHTML = "";
    elements.bottomSeat.innerHTML = "";
    return;
  }

  const bubbles = currentChatBubbles(state.room);
  const me = state.room.me;
  const opponent = otherPlayer();

  elements.topSeat.innerHTML = "";
  elements.bottomSeat.innerHTML = "";

  if (opponent) {
    elements.topSeat.appendChild(
      createSeat(opponent, {
        bubble: bubbles.get(opponent.id)
      })
    );
  } else {
    elements.topSeat.appendChild(createPlaceholderSeat("상대 대기 중"));
  }

  elements.bottomSeat.appendChild(
    createSeat(me, {
      isSelf: true,
      bubble: bubbles.get(me.id)
    })
  );
}

function renderSeatChatComposer() {
  if (!state.room?.me) {
    elements.seatChatComposer.hidden = true;
    return;
  }

  const selfSeat = elements.bottomSeat.querySelector(".player-seat.is-self");
  if (!selfSeat) {
    elements.seatChatComposer.hidden = true;
    return;
  }

  elements.seatChatComposer.hidden = false;
  elements.seatChatComposer.classList.add("is-embedded");
  elements.chatInput.disabled = false;
  elements.sendChatButton.disabled = false;
  elements.chatStatus.textContent = state.chatStatus;

  if (elements.seatChatComposer.parentElement !== selfSeat) {
    selfSeat.appendChild(elements.seatChatComposer);
  }

  elements.seatChatComposer.style.width = "";
  elements.seatChatComposer.style.left = "";
  elements.seatChatComposer.style.top = "";
  elements.seatChatComposer.style.bottom = "";
  elements.seatChatComposer.style.transform = "";
}

function renderBoard() {
  if (!state.room) {
    elements.boardGrid.innerHTML = "";
    return;
  }

  const size = state.room.boardSize || 15;
  const winningSet = new Set(
    (state.room.winningLine || []).map((point) => `${point.x}:${point.y}`)
  );
  const lastMove = state.room.lastMove;
  const canPlace = state.room.phase === "playing" && isMyTurn();
  const fragment = document.createDocumentFragment();

  elements.boardGrid.innerHTML = "";

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "board-cell";
      button.dataset.edgeRight = String(x === size - 1);
      button.dataset.edgeBottom = String(y === size - 1);
      button.setAttribute("aria-label", `${String.fromCharCode(65 + x)}${y + 1}`);

      const value = state.room.board?.[y]?.[x] || null;
      const isEmpty = value === null;
      const isWinning = winningSet.has(`${x}:${y}`);
      const isLast = lastMove?.x === x && lastMove?.y === y;

      if (isWinning) {
        button.classList.add("is-winning");
      }
      if (isLast) {
        button.classList.add("is-last");
      }
      if (canPlace && isEmpty) {
        button.classList.add("is-placeable");
      }

      if (value) {
        const stone = document.createElement("span");
        stone.className = `stone ${value}`;
        button.appendChild(stone);
      }

      button.disabled = !canPlace || !isEmpty;
      button.addEventListener("click", () => {
        placeStone(x, y);
      });
      fragment.appendChild(button);
    }
  }

  elements.boardGrid.appendChild(fragment);
}

function renderScreens() {
  const joined = Boolean(state.room);
  elements.entryScreen.hidden = joined;
  elements.gameScreen.hidden = !joined;
}

function renderRoom() {
  renderScreens();

  if (!state.room) {
    return;
  }

  renderHeader();
  renderControls();
  elements.centerStatus.textContent = displayCenterStatus();
  renderCenterAction();
  renderChatLog();
  renderSeats();
  renderSeatChatComposer();
  renderBoard();
  scheduleBubbleRefresh(state.room);
}

function applyRoomUpdate(room, options = {}) {
  const { restoreChatFocus = false } = options;
  state.flash = "";
  state.room = room;
  state.roomCode = room.code;
  renderRoom();

  if (restoreChatFocus) {
    focusChatInput();
  }
}

socket.on("room:update", (room) => {
  const shouldRestoreChatFocus = document.activeElement === elements.chatInput;

  if (state.chatIsComposing && shouldRestoreChatFocus) {
    state.pendingRoomUpdate = room;
    return;
  }

  state.pendingRoomUpdate = null;
  applyRoomUpdate(room, { restoreChatFocus: shouldRestoreChatFocus });
});

async function createRoom() {
  const response = await emitWithAck("room:create", {
    name: elements.nameInput.value.trim()
  });

  if (!response?.ok) {
    setEntryStatus(response?.message || "방 생성 실패");
    return;
  }

  setEntryStatus("");
  state.roomCode = response.code;
  elements.roomInput.value = response.code;
}

async function joinRoom() {
  const response = await emitWithAck("room:join", {
    code: elements.roomInput.value.trim().toUpperCase(),
    name: elements.nameInput.value.trim()
  });

  if (!response?.ok) {
    setEntryStatus(response?.message || "입장 실패");
    return;
  }

  setEntryStatus("");
  state.roomCode = response.code;
}

async function addBots() {
  const response = await emitWithAck("room:add_bots", {
    code: state.roomCode,
    count: Number.parseInt(elements.botCountInput.value || "1", 10)
  });

  if (!response?.ok) {
    state.flash = response?.message || "봇 추가 실패";
    renderRoom();
    return;
  }

  state.flash = "";
}

async function startGame() {
  const response = await emitWithAck("game:start", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "시작 실패";
    renderRoom();
    return;
  }

  state.flash = "";
}

async function resetGame() {
  const response = await emitWithAck("game:reset", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "초기화 실패";
    renderRoom();
    return;
  }

  state.flash = "";
}

async function placeStone(x, y) {
  const response = await emitWithAck("move:place", {
    code: state.roomCode,
    x,
    y
  });

  if (!response?.ok) {
    state.flash = response?.message || "착수 실패";
    renderRoom();
    return;
  }

  state.flash = "";
}

async function sendChat(event) {
  event?.preventDefault();

  if (state.chatIsComposing) {
    return;
  }

  const text = elements.chatInput.value.trim();
  if (!text) {
    setChatStatus("메시지를 입력하세요");
    focusChatInput();
    return;
  }

  const response = await emitWithAck("chat:send", {
    code: state.roomCode,
    text
  });

  if (!response?.ok) {
    setChatStatus(response?.message || "채팅 전송 실패");
    focusChatInput();
    return;
  }

  elements.chatInput.value = "";
  setChatStatus("");
  focusChatInput();
}

elements.createRoomButton.addEventListener("click", createRoom);
elements.joinRoomButton.addEventListener("click", joinRoom);
elements.addBotButton.addEventListener("click", addBots);
elements.startButton.addEventListener("click", startGame);
elements.resetButton.addEventListener("click", resetGame);
elements.chatForm.addEventListener("submit", sendChat);

elements.chatInput.addEventListener("compositionstart", () => {
  state.chatIsComposing = true;
});

elements.chatInput.addEventListener("compositionend", () => {
  state.chatIsComposing = false;
  if (state.pendingRoomUpdate) {
    const pending = state.pendingRoomUpdate;
    state.pendingRoomUpdate = null;
    applyRoomUpdate(pending, { restoreChatFocus: true });
    return;
  }
  focusChatInput();
});

elements.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.isComposing) {
    event.preventDefault();
  }
});

elements.roomInput.addEventListener("input", () => {
  elements.roomInput.value = elements.roomInput.value.trim().toUpperCase();
});

elements.roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    joinRoom();
  }
});

elements.nameInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) {
    return;
  }

  if (elements.roomInput.value.trim()) {
    joinRoom();
    return;
  }

  createRoom();
});

renderRoom();
