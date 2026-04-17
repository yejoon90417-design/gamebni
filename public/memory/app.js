const socket = io("/memory");
const appSession = window.GamebniSession.createClient("memory");
socket.auth = {
  ...(socket.auth || {}),
  playerSessionId: appSession.playerSessionId
};
socket.disconnect().connect();

const state = {
  room: null,
  roomCode: "",
  pendingJoin: false,
  restoreAttempted: false,
  flash: "",
  chatStatus: "",
  lastChatLogMessageId: "",
  flipCardIds: new Set(),
  transferCleanupTimerId: null,
  lastClaimSignature: "",
  roomUpdatedAt: 0,
  liveStatusTimerId: null
};

const elements = {
  entryScreen: document.getElementById("entryScreen"),
  gameScreen: document.getElementById("gameScreen"),
  nameInput: document.getElementById("nameInput"),
  targetPlayerCountInput: document.getElementById("targetPlayerCountInput"),
  cardCountInput: document.getElementById("cardCountInput"),
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
  leaveButton: document.getElementById("leaveButton"),
  chatLogList: document.getElementById("chatLogList"),
  tableStage: document.getElementById("tableStage"),
  centerStatus: document.getElementById("centerStatus"),
  centerSubstatus: document.getElementById("centerSubstatus"),
  boardShell: document.querySelector(".board-shell"),
  boardGrid: document.getElementById("boardGrid"),
  playerList: document.getElementById("playerList"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  sendChatButton: document.getElementById("sendChatButton"),
  chatStatus: document.getElementById("chatStatus"),
  createRoomButton: document.getElementById("createRoomButton"),
  joinRoomButton: document.getElementById("joinRoomButton")
};

appSession.hydrateEntry({
  nameInput: elements.nameInput,
  roomInput: elements.roomInput
});

const PHASE_TEXT = {
  lobby: "대기",
  playing: "진행",
  result: "결과"
};

const RECOMMENDED_CARD_COUNT_BY_PLAYER_COUNT = {
  2: 16,
  3: 20,
  4: 30,
  5: 40
};

const BOARD_LAYOUT_BY_CARD_COUNT = {
  16: { columns: 4, rows: 4, gap: 0 },
  20: { columns: 5, rows: 4, gap: 0 },
  24: { columns: 6, rows: 4, gap: 0 },
  30: { columns: 6, rows: 5, gap: 0 },
  36: { columns: 6, rows: 6, gap: 0 },
  40: { columns: 8, rows: 5, gap: 0 }
};

function currentName() {
  return elements.nameInput.value.trim();
}

function currentRoomInput() {
  return elements.roomInput.value.trim().toUpperCase();
}

function rememberSessionRoom(roomCode = state.roomCode, name = currentName()) {
  appSession.rememberRoom(state.room?.me?.name || name, roomCode);
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

function setEntryStatus(text) {
  elements.entryStatus.textContent = text || "";
}

function setChatStatus(text) {
  state.chatStatus = text || "";
  elements.chatStatus.textContent = state.chatStatus;
}

function focusChatInput() {
  if (elements.chatInput.disabled) {
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

function currentPlayer(room = state.room) {
  return room?.players.find((player) => player.id === room.currentPlayerId) || null;
}

function isMyTurn(room = state.room) {
  return room?.currentPlayerId === room?.me?.id;
}

function getBoardLayout(cardCount) {
  return (
    BOARD_LAYOUT_BY_CARD_COUNT[Number(cardCount)] || {
      columns: 6,
      rows: Math.max(1, Math.ceil(Number(cardCount || 0) / 6)),
      gap: 0
    }
  );
}

function resizeBoardGrid() {
  if (!state.room || !elements.boardShell || !elements.boardGrid) {
    return;
  }

  const layout = getBoardLayout(state.room.cards.length);
  const shellRect = elements.boardShell.getBoundingClientRect();
  const availableWidth = Math.max(Math.floor(shellRect.width), 0);
  const availableHeight = Math.max(Math.floor(shellRect.height), 0);
  if (!availableWidth || !availableHeight) {
    return;
  }

  const boardAspect = (layout.columns * 3) / (layout.rows * 4);
  let gridWidth = availableWidth;
  let gridHeight = Math.floor(gridWidth / boardAspect);

  if (gridHeight > availableHeight) {
    gridHeight = availableHeight;
    gridWidth = Math.floor(gridHeight * boardAspect);
  }

  elements.boardGrid.style.width = `${Math.max(gridWidth, 1)}px`;
  elements.boardGrid.style.height = `${Math.max(gridHeight, 1)}px`;
}

function previewSecondsLeft(room = state.room) {
  if (!room?.previewMs) {
    return 0;
  }

  const elapsed = Math.max(Date.now() - (state.roomUpdatedAt || Date.now()), 0);
  return Math.max(Math.ceil((room.previewMs - elapsed) / 1000), 0);
}

function clearLiveStatusTimer() {
  if (!state.liveStatusTimerId) {
    return;
  }

  clearTimeout(state.liveStatusTimerId);
  state.liveStatusTimerId = null;
}

function scheduleLiveStatusRender() {
  clearLiveStatusTimer();

  if (!state.room || state.room.phase !== "preview" || previewSecondsLeft() <= 0) {
    return;
  }

  state.liveStatusTimerId = window.setTimeout(() => {
    state.liveStatusTimerId = null;
    if (!state.room || state.room.phase !== "preview") {
      return;
    }

    renderHeader();
    renderCenter();
    scheduleLiveStatusRender();
  }, 250);
}

function displayStatus() {
  if (state.flash) {
    return state.flash;
  }

  if (!state.room) {
    return "";
  }

  if (state.room.phase === "lobby") {
    return `${state.room.players.length}/${state.room.targetPlayerCount}명 입장 · ${state.room.totalCardCount}장`;
  }

  if (state.room.phase === "preview") {
    return `전체 카드 공개 ${previewSecondsLeft()}초`;
  }

  if (state.room.phase === "playing") {
    if (state.room.pendingHideMs > 0) {
      return "카드 확인 중";
    }

    const player = currentPlayer();
    return player ? `${player.name} 차례` : "진행 중";
  }

  return state.room.result?.reason || "게임 종료";
}

function displayCenterStatus() {
  if (!state.room) {
    return "-";
  }

  if (state.room.phase === "lobby") {
    return "방 준비";
  }

  if (state.room.phase === "preview") {
    return "전체 카드 공개";
  }

  if (state.room.phase === "playing") {
    if (isMyTurn()) {
      return "내 차례";
    }

    const player = currentPlayer();
    return player ? `${player.name} 차례` : "진행 중";
  }

  return state.room.result?.reason || "게임 종료";
}

function displayCenterSubstatus() {
  if (!state.room) {
    return "-";
  }

  if (state.room.phase === "lobby") {
    return `인원 ${state.room.players.length}/${state.room.targetPlayerCount} · 카드 ${state.room.totalCardCount}장`;
  }

  if (state.room.phase === "preview") {
    return `${previewSecondsLeft()}초 동안 모든 카드를 외우세요`;
  }

  if (state.room.phase === "playing") {
    const remainingPairs = Math.floor(state.room.remainingCards / 2);
    if (state.room.pendingHideMs > 0) {
      return `남은 짝 ${remainingPairs} · 카드가 다시 뒤집히는 중`;
    }
    return `남은 짝 ${remainingPairs} · ${state.room.recentAction?.text || "카드를 뒤집으세요"}`;
  }

  return state.room.recentAction?.text || state.room.result?.reason || "게임 종료";
}

function renderHeader() {
  const room = state.room;
  elements.roomBadge.textContent = `방 ${room.code}`;
  elements.playerBadge.textContent = `${room.players.length}/${room.targetPlayerCount}명 · ${room.totalCardCount}장`;
  elements.phaseBadge.textContent =
    room.phase === "preview" ? "공개" : PHASE_TEXT[room.phase] || room.phase;
  elements.statusBadge.textContent = displayStatus();
}

function renderControls() {
  const room = state.room;
  const isHost = room.hostId === room.me.id;
  const openSlots = Math.max(room.targetPlayerCount - room.players.length, 0);
  const canAddBot = room.phase === "lobby" && isHost && openSlots > 0;

  elements.botTools.hidden = !canAddBot;
  elements.botCountInput.max = String(Math.max(openSlots, 1));
  elements.startButton.hidden = !(room.phase === "lobby" && isHost);
  elements.startButton.disabled =
    room.players.length !== room.targetPlayerCount || room.players.length < 2;
  elements.resetButton.hidden = !(room.phase === "result" && isHost);
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
  const wasNearTop = elements.chatLogList.scrollTop < 24;
  const nextLastMessageId = messages[messages.length - 1]?.id || "";
  const hasNewMessage = nextLastMessageId !== state.lastChatLogMessageId;
  elements.chatLogList.innerHTML = "";

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-log-empty";
    empty.textContent = "아직 로그가 없습니다.";
    elements.chatLogList.appendChild(empty);
    state.lastChatLogMessageId = "";
    return;
  }

  const fragment = document.createDocumentFragment();

  [...messages].reverse().forEach((message) => {
    const item = document.createElement("article");
    item.className = messageClassName(message);

    const name = document.createElement("strong");
    name.className = "chat-log-name";
    name.textContent = message.kind === "system" ? "SYSTEM" : message.name || "플레이어";

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

function pairAssetCandidates(pairKey) {
  const numeric = Number.parseInt(String(pairKey || "").replace(/\D/g, ""), 10);
  const baseNames = [pairKey];
  if (Number.isFinite(numeric) && numeric > 0) {
    baseNames.push(`animal${numeric}`);
    baseNames.push(`pair${String(numeric).padStart(2, "0")}`);
  }

  return [...new Set(baseNames.filter(Boolean))].flatMap((baseName) =>
    ["png", "jpg", "webp", "jpeg"].map((extension) => `/memory/assets/cards/${baseName}.${extension}`)
  );
}

function pairDisplayLabel(pairKey) {
  const numeric = Number.parseInt(String(pairKey || "").replace(/\D/g, ""), 10);
  return Number.isFinite(numeric) ? String(numeric) : "?";
}

function createPairMedia(pairKey, placeholderClassName = "memory-card-placeholder") {
  const candidates = pairAssetCandidates(pairKey);
  const shell = document.createElement("div");
  shell.className = "memory-card-media-shell";

  const fallback = document.createElement("div");
  fallback.className = placeholderClassName;
  fallback.textContent = pairDisplayLabel(pairKey);
  shell.appendChild(fallback);

  if (!pairKey) {
    return shell;
  }

  const image = document.createElement("img");
  image.className = "memory-card-media";
  image.alt = pairKey;
  image.hidden = true;
  let index = 0;

  const loadNext = () => {
    if (index >= candidates.length) {
      return;
    }

    image.src = candidates[index];
    index += 1;
  };

  image.addEventListener("load", () => {
    image.hidden = false;
    fallback.hidden = true;
  });

  image.addEventListener("error", () => {
    if (index < candidates.length) {
      loadNext();
    }
  });

  shell.appendChild(image);
  loadNext();
  return shell;
}

function matchedOwnerName(playerId) {
  return state.room?.players.find((player) => player.id === playerId)?.name || "획득";
}

function ensureTransferLayer() {
  let layer = document.getElementById("transferLayer");
  if (layer) {
    return layer;
  }

  layer = document.createElement("div");
  layer.id = "transferLayer";
  layer.className = "transfer-layer";
  elements.tableStage.appendChild(layer);
  return layer;
}

function clearTransferEffects() {
  if (state.transferCleanupTimerId) {
    clearTimeout(state.transferCleanupTimerId);
    state.transferCleanupTimerId = null;
  }

  const layer = document.getElementById("transferLayer");
  if (layer) {
    layer.remove();
  }
}

function cardAnchor(cardId) {
  if (!elements.tableStage || !cardId) {
    return null;
  }

  const card = elements.tableStage.querySelector(`.memory-card[data-card-id="${CSS.escape(cardId)}"]`);
  if (!card) {
    return null;
  }

  const tableRect = elements.tableStage.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();

  return {
    x: cardRect.left - tableRect.left + cardRect.width / 2,
    y: cardRect.top - tableRect.top + cardRect.height / 2
  };
}

function playerAnchor(playerId) {
  if (!elements.playerList || !elements.tableStage || !playerId) {
    return null;
  }

  const row = elements.playerList.querySelector(`.player-row[data-player-id="${CSS.escape(playerId)}"]`);
  if (!row) {
    return null;
  }

  const tableRect = elements.tableStage.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();

  return {
    x: rowRect.left - tableRect.left + rowRect.width / 2,
    y: rowRect.top - tableRect.top + rowRect.height / 2
  };
}

function createTransferCard(pairKey) {
  const card = document.createElement("div");
  card.className = "transfer-card";

  const face = document.createElement("div");
  face.className = "transfer-card-face";
  face.appendChild(createPairMedia(pairKey, "transfer-card-mark"));
  card.appendChild(face);
  return card;
}

function playClaimEffect(claims) {
  if (!claims.length) {
    return;
  }

  clearTransferEffects();
  const layer = ensureTransferLayer();
  const TRANSFER_MS = 760;
  const STAGGER_MS = 90;
  let latestEndAt = 0;

  claims.forEach((claim, index) => {
    const from = cardAnchor(claim.cardId);
    const to = playerAnchor(claim.playerId);
    if (!from || !to) {
      return;
    }

    const card = createTransferCard(claim.pairKey);
    card.style.left = `${from.x}px`;
    card.style.top = `${from.y}px`;
    layer.appendChild(card);

    const delay = index * STAGGER_MS;
    card.animate([
      {
        left: `${from.x}px`,
        top: `${from.y}px`,
        opacity: 0,
        transform: "translate(-50%, -50%) rotate(-10deg) scale(0.9)"
      },
      {
        left: `${from.x}px`,
        top: `${from.y}px`,
        opacity: 1,
        transform: "translate(-50%, -50%) rotate(-6deg) scale(1)",
        offset: 0.12
      },
      {
        left: `${to.x}px`,
        top: `${to.y}px`,
        opacity: 1,
        transform: "translate(-50%, -50%) rotate(8deg) scale(1)",
        offset: 0.88
      },
      {
        left: `${to.x}px`,
        top: `${to.y}px`,
        opacity: 0,
        transform: "translate(-50%, -50%) rotate(12deg) scale(0.94)"
      }
    ], {
      duration: TRANSFER_MS,
      delay,
      easing: "cubic-bezier(0.2, 0.9, 0.18, 1)",
      fill: "forwards"
    });

    latestEndAt = Math.max(latestEndAt, delay + TRANSFER_MS);
  });

  if (!latestEndAt) {
    return;
  }

  state.transferCleanupTimerId = window.setTimeout(() => {
    clearTransferEffects();
  }, latestEndAt + 120);
}

function renderBoard() {
  if (!state.room) {
    elements.boardGrid.innerHTML = "";
    elements.boardGrid.style.width = "";
    elements.boardGrid.style.height = "";
    return;
  }

  const layout = getBoardLayout(state.room.cards.length);
  elements.boardGrid.style.setProperty("--memory-columns", String(layout.columns));
  elements.boardGrid.style.setProperty("--memory-rows", String(layout.rows));
  elements.boardGrid.style.setProperty("--memory-gap", `${layout.gap}px`);
  elements.boardGrid.innerHTML = "";

  const fragment = document.createDocumentFragment();
  const previewActive = state.room.phase === "preview";

  state.room.cards.forEach((card) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "memory-card";
    button.dataset.cardId = card.id;

    if (card.faceUp || previewActive) {
      button.classList.add("is-face-up");
    }
    if (card.matched) {
      button.classList.add("is-matched");
    }
    if (state.flipCardIds.has(card.id)) {
      button.classList.add("is-flipping");
    }

    const visible = previewActive || card.faceUp || card.matched;
    button.disabled = !state.room.canFlip || visible;
    button.addEventListener("click", () => {
      flipCard(card.id);
    });

    const inner = document.createElement("div");
    inner.className = "memory-card-inner";

    const back = document.createElement("div");
    back.className = "memory-card-face memory-card-back";

    const front = document.createElement("div");
    front.className = "memory-card-face memory-card-front";
    if (card.pairKey) {
      front.appendChild(createPairMedia(card.pairKey));
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "memory-card-placeholder";
      placeholder.textContent = "?";
      front.appendChild(placeholder);
    }

    if (card.matched && card.matchedBy) {
      const owner = document.createElement("span");
      owner.className = "memory-card-owner";
      owner.textContent = matchedOwnerName(card.matchedBy);
      front.appendChild(owner);
    }

    inner.append(back, front);
    button.appendChild(inner);
    fragment.appendChild(button);
  });

  elements.boardGrid.appendChild(fragment);
  window.requestAnimationFrame(resizeBoardGrid);

  if (state.flipCardIds.size) {
    window.setTimeout(() => {
      state.flipCardIds.clear();
      renderBoard();
    }, 460);
  }
}

function renderPlayerList() {
  if (!state.room) {
    elements.playerList.innerHTML = "";
    return;
  }

  const fragment = document.createDocumentFragment();

  state.room.players.forEach((player) => {
    const row = document.createElement("article");
    row.className = "player-row";
    row.dataset.playerId = player.id;

    if (player.isCurrent && state.room.phase === "playing") {
      row.classList.add("is-current");
    }
    if (state.room.result?.winnerIds?.includes(player.id)) {
      row.classList.add("is-winner");
    }

    const top = document.createElement("div");
    top.className = "player-row-top";

    const name = document.createElement("p");
    name.className = "player-row-name";
    name.textContent = player.name;

    const chip = document.createElement("span");
    chip.className = "player-row-chip";
    if (state.room.phase === "playing" && player.isCurrent) {
      chip.textContent = "차례";
    } else if (player.isBot) {
      chip.textContent = "BOT";
    } else if (state.room.result?.winnerIds?.includes(player.id)) {
      chip.textContent = "승리";
    } else if (!player.connected) {
      chip.textContent = "오프라인";
    } else if (player.isHost) {
      chip.textContent = "호스트";
    } else {
      chip.textContent = "대기";
    }

    const meta = document.createElement("p");
    meta.className = "player-row-meta";
    meta.textContent = `카드 ${player.claimedCards}장 · 짝 ${player.claimedPairs}`;

    top.append(name, chip);
    row.append(top, meta);
    fragment.appendChild(row);
  });

  elements.playerList.replaceChildren(fragment);
}

function renderCenter() {
  elements.centerStatus.textContent = displayCenterStatus();
  elements.centerSubstatus.textContent = displayCenterSubstatus();
}

function renderScreens() {
  const showGame = Boolean(state.room) || state.pendingJoin;
  elements.entryScreen.hidden = showGame;
  elements.gameScreen.hidden = !showGame;
  elements.entryScreen.style.display = showGame ? "none" : "";
  elements.gameScreen.style.display = showGame ? "grid" : "none";
}

function renderChatComposer() {
  const hasRoom = Boolean(state.room);
  elements.chatInput.disabled = !hasRoom;
  elements.sendChatButton.disabled = !hasRoom;
  elements.chatStatus.textContent = state.chatStatus;
}

function syncRecommendedCardCount() {
  const recommended = RECOMMENDED_CARD_COUNT_BY_PLAYER_COUNT[
    Number.parseInt(elements.targetPlayerCountInput.value, 10)
  ];

  if (recommended) {
    elements.cardCountInput.value = String(recommended);
  }
}

function render() {
  renderScreens();
  if (!state.room) {
    clearLiveStatusTimer();
    renderChatComposer();
    return;
  }

  renderHeader();
  renderControls();
  renderCenter();
  renderBoard();
  renderPlayerList();
  renderChatLog();
  renderChatComposer();
}

function detectFlipAnimations(previousRoom, nextRoom) {
  if (!previousRoom) {
    return new Set();
  }

  const previousCards = new Map(previousRoom.cards.map((card) => [card.id, card]));
  const flipIds = new Set();

  nextRoom.cards.forEach((card) => {
    const previous = previousCards.get(card.id);
    if (!previous) {
      return;
    }

    if (!previous.faceUp && !previous.matched && card.faceUp && !card.matched) {
      flipIds.add(card.id);
    }
  });

  return flipIds;
}

function detectClaimTransfers(previousRoom, nextRoom) {
  if (!previousRoom) {
    return [];
  }

  const previousCards = new Map(previousRoom.cards.map((card) => [card.id, card]));
  const claims = [];

  nextRoom.cards.forEach((card) => {
    const previous = previousCards.get(card.id);
    if (!previous) {
      return;
    }

    if (!previous.matchedBy && card.matchedBy && card.pairKey) {
      claims.push({
        cardId: card.id,
        playerId: card.matchedBy,
        pairKey: card.pairKey
      });
    }
  });

  return claims;
}

function claimSignature(claims) {
  return claims
    .map((claim) => `${claim.cardId}:${claim.playerId}:${claim.pairKey}`)
    .sort()
    .join("|");
}

function applyRoomUpdate(room) {
  const previousRoom = state.room;
  const claims = detectClaimTransfers(previousRoom, room);
  if (!previousRoom || previousRoom.phase !== room.phase || room.phase !== "playing") {
    state.lastClaimSignature = "";
  }
  state.pendingJoin = false;
  state.flash = "";
  state.flipCardIds = detectFlipAnimations(previousRoom, room);
  state.room = room;
  state.roomUpdatedAt = Date.now();
  state.roomCode = room.code;
  elements.roomInput.value = room.code;
  rememberSessionRoom();
  render();
  scheduleLiveStatusRender();

  const signature = claimSignature(claims);
  if (signature && signature !== state.lastClaimSignature) {
    state.lastClaimSignature = signature;
    playClaimEffect(claims);
  }
}

function clearRoomState() {
  state.pendingJoin = false;
  state.room = null;
  state.roomCode = "";
  state.flash = "";
  state.chatStatus = "";
  state.lastChatLogMessageId = "";
  state.flipCardIds.clear();
  state.lastClaimSignature = "";
  state.roomUpdatedAt = 0;
  clearLiveStatusTimer();
  appSession.clearRoom();
  clearTransferEffects();
  render();
}

function showPendingGameScreen(code) {
  state.pendingJoin = true;
  state.roomCode = code || "";
  state.flash = "";
  renderScreens();
  elements.roomBadge.textContent = code ? `방 ${code}` : "방";
  elements.playerBadge.textContent = "-";
  elements.phaseBadge.textContent = "대기";
  elements.statusBadge.textContent = "방 정보를 불러오는 중";
}

async function createRoom() {
  const name = currentName();
  if (!name) {
    setEntryStatus("닉네임을 입력하세요.");
    return;
  }

  try {
    const response = await emitWithAck("room:create", {
      name,
      settings: {
        targetPlayerCount: Number.parseInt(elements.targetPlayerCountInput.value, 10) || 2,
        totalCardCount: Number.parseInt(elements.cardCountInput.value, 10) || 16
      }
    });

    if (!response?.ok) {
      state.pendingJoin = false;
      renderScreens();
      setEntryStatus(response?.message || "방을 만들 수 없습니다.");
      return;
    }

    setEntryStatus("");
    state.roomCode = response.code || "";
    elements.roomInput.value = response.code || "";
    rememberSessionRoom(response.code, name);
    showPendingGameScreen(response.code);

    const room = response.room || (await syncRoomState(response.code));
    if (!room) {
      clearRoomState();
      setEntryStatus("방 정보를 불러오지 못했습니다.");
      return;
    }

    applyRoomUpdate(room);
  } catch (error) {
    clearRoomState();
    setEntryStatus(`방 생성 실패: ${error?.message || "알 수 없는 오류"}`);
  }
}

async function joinRoom() {
  const name = currentName();
  const code = currentRoomInput();

  if (!name) {
    setEntryStatus("닉네임을 입력하세요.");
    return;
  }

  if (!code) {
    setEntryStatus("방 코드를 입력하세요.");
    return;
  }

  try {
    const response = await emitWithAck("room:join", {
      code,
      name
    });

    if (!response?.ok) {
      state.pendingJoin = false;
      renderScreens();
      setEntryStatus(response?.message || "방에 입장할 수 없습니다.");
      return;
    }

    setEntryStatus("");
    state.roomCode = response.code || code;
    elements.roomInput.value = response.code || code;
    rememberSessionRoom(response.code || code, name);
    showPendingGameScreen(response.code || code);

    const room = response.room || (await syncRoomState(response.code || code));
    if (!room) {
      clearRoomState();
      setEntryStatus("방 정보를 불러오지 못했습니다.");
      return;
    }

    applyRoomUpdate(room);
  } catch (error) {
    clearRoomState();
    setEntryStatus(`입장 실패: ${error?.message || "알 수 없는 오류"}`);
  }
}

async function leaveRoom() {
  if (!state.room) {
    clearRoomState();
    return;
  }

  await emitWithAck("room:leave", {});
  clearRoomState();
}

async function startGame() {
  if (!state.room) {
    return;
  }

  const response = await emitWithAck("game:start", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "게임을 시작할 수 없습니다.";
    render();
    window.setTimeout(() => {
      state.flash = "";
      render();
    }, 2000);
  }
}

async function addBots() {
  if (!state.room) {
    return;
  }

  const response = await emitWithAck("room:add_bots", {
    code: state.roomCode,
    count: Number.parseInt(elements.botCountInput.value || "1", 10)
  });

  if (!response?.ok) {
    state.flash = response?.message || "봇 추가에 실패했습니다.";
    render();
    window.setTimeout(() => {
      state.flash = "";
      render();
    }, 2000);
    return;
  }

  state.flash = "";
}

async function resetGame() {
  if (!state.room) {
    return;
  }

  const response = await emitWithAck("game:reset", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "게임을 다시 준비할 수 없습니다.";
    render();
    window.setTimeout(() => {
      state.flash = "";
      render();
    }, 2000);
  }
}

async function sendChat() {
  if (!state.room) {
    return;
  }

  const text = elements.chatInput.value.trim();
  if (!text) {
    setChatStatus("채팅 내용을 입력하세요.");
    return;
  }

  const response = await emitWithAck("chat:send", {
    code: state.roomCode,
    text
  });

  if (!response?.ok) {
    setChatStatus(response?.message || "채팅을 전송할 수 없습니다.");
    return;
  }

  elements.chatInput.value = "";
  setChatStatus("");
  focusChatInput();
}

async function flipCard(cardId) {
  if (!state.room) {
    return;
  }

  const response = await emitWithAck("card:flip", {
    code: state.roomCode,
    cardId
  });

  if (!response?.ok) {
    state.flash = response?.message || "카드를 뒤집을 수 없습니다.";
    render();
    window.setTimeout(() => {
      state.flash = "";
      render();
    }, 1600);
  }
}

async function restoreSavedRoom() {
  if (state.restoreAttempted || state.room || state.pendingJoin) {
    return;
  }

  const saved = appSession.getSavedRoom();
  if (!saved?.roomCode) {
    return;
  }

  state.restoreAttempted = true;
  elements.nameInput.value = elements.nameInput.value.trim() || saved.name || "";
  elements.roomInput.value = saved.roomCode;

  try {
    const response = await emitWithAck("room:join", {
      code: saved.roomCode,
      name: elements.nameInput.value.trim()
    });

    if (!response?.ok) {
      appSession.clearRoom();
      state.restoreAttempted = false;
      state.pendingJoin = false;
      renderScreens();
      return;
    }

    showPendingGameScreen(response.code || saved.roomCode);
    const room = response.room || (await syncRoomState(response.code || saved.roomCode));
    if (!room) {
      appSession.clearRoom();
      state.restoreAttempted = false;
      clearRoomState();
      return;
    }

    applyRoomUpdate(room);
  } catch (_error) {
    appSession.clearRoom();
    state.restoreAttempted = false;
    state.pendingJoin = false;
    renderScreens();
  }
}

socket.on("room:update", (room) => {
  if (!room) {
    return;
  }

  applyRoomUpdate(room);
});

elements.createRoomButton.addEventListener("click", createRoom);
elements.joinRoomButton.addEventListener("click", joinRoom);
elements.targetPlayerCountInput.addEventListener("change", syncRecommendedCardCount);
elements.addBotButton.addEventListener("click", addBots);
elements.startButton.addEventListener("click", startGame);
elements.resetButton.addEventListener("click", resetGame);
elements.leaveButton.addEventListener("click", leaveRoom);
elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendChat();
});

socket.on("connect", restoreSavedRoom);
syncRecommendedCardCount();
window.addEventListener("resize", () => {
  window.requestAnimationFrame(resizeBoardGrid);
});
restoreSavedRoom();
render();
