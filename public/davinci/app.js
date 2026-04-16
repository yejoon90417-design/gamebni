const socket = io("/davinci");
const appSession = window.GamebniSession.createClient("davinci");
socket.auth = {
  ...(socket.auth || {}),
  playerSessionId: appSession.playerSessionId
};
socket.disconnect().connect();
const CHAT_BUBBLE_TTL = 5000;
const ROULETTE_ANIMATION_MS = 5600;

const state = {
  room: null,
  roomCode: "",
  selectedTargetPlayerId: null,
  selectedTargetTileId: null,
  selectedPenaltyTileId: null,
  flash: "",
  chatStatus: "",
  guessStatus: "",
  lastChatLogMessageId: "",
  chatIsComposing: false,
  pendingRoomUpdate: null,
  rouletteShownId: "",
  rouletteActive: false,
  rouletteSpinning: false,
  rouletteRotation: 0,
  rouletteWinnerId: "",
  rouletteTimerId: null,
  bubbleTimerId: null,
  guessModalOpen: false,
  guessType: "number",
  restoreAttempted: false
};

const elements = {
  entryScreen: document.getElementById("entryScreen"),
  gameScreen: document.getElementById("gameScreen"),
  nameInput: document.getElementById("nameInput"),
  targetPlayerCountSelect: document.getElementById("targetPlayerCountSelect"),
  ruleGuide: document.getElementById("ruleGuide"),
  roomInput: document.getElementById("roomInput"),
  entryStatus: document.getElementById("entryStatus"),
  roomBadge: document.getElementById("roomBadge"),
  targetBadge: document.getElementById("targetBadge"),
  phaseBadge: document.getElementById("phaseBadge"),
  turnBadge: document.getElementById("turnBadge"),
  botTools: document.getElementById("botTools"),
  botCountInput: document.getElementById("botCountInput"),
  addBotButton: document.getElementById("addBotButton"),
  startButton: document.getElementById("startButton"),
  resetButton: document.getElementById("resetButton"),
  tableStage: document.getElementById("tableStage"),
  playerBoard: document.getElementById("playerBoard"),
  chatLogList: document.getElementById("chatLogList"),
  deckBadge: document.getElementById("deckBadge"),
  statusBadge: document.getElementById("statusBadge"),
  startRoulette: document.getElementById("startRoulette"),
  rouletteWheel: document.getElementById("rouletteWheel"),
  rouletteLabels: document.getElementById("rouletteLabels"),
  rouletteStatus: document.getElementById("rouletteStatus"),
  centerAction: document.getElementById("centerAction"),
  centerStatus: document.getElementById("centerStatus"),
  drawControls: document.getElementById("drawControls"),
  guessControls: document.getElementById("guessControls"),
  penaltyControls: document.getElementById("penaltyControls"),
  drawBlackButton: document.getElementById("drawBlackButton"),
  drawWhiteButton: document.getElementById("drawWhiteButton"),
  drawSkipButton: document.getElementById("drawSkipButton"),
  revealPenaltyButton: document.getElementById("revealPenaltyButton"),
  endTurnButton: document.getElementById("endTurnButton"),
  seatChatComposer: document.getElementById("seatChatComposer"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  sendChatButton: document.getElementById("sendChatButton"),
  chatStatus: document.getElementById("chatStatus"),
  guessModal: document.getElementById("guessModal"),
  guessBackdrop: document.getElementById("guessBackdrop"),
  guessTargetLabel: document.getElementById("guessTargetLabel"),
  guessTypeNumberButton: document.getElementById("guessTypeNumberButton"),
  guessTypeJokerButton: document.getElementById("guessTypeJokerButton"),
  guessModalInput: document.getElementById("guessModalInput"),
  guessSubmitButton: document.getElementById("guessSubmitButton"),
  guessCancelButton: document.getElementById("guessCancelButton"),
  guessStatus: document.getElementById("guessStatus"),
  createRoomButton: document.getElementById("createRoomButton"),
  joinRoomButton: document.getElementById("joinRoomButton"),
  leaveButton: document.getElementById("leaveButton")
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

const PHASE_TEXT = {
  lobby: "대기",
  draw: "드로우",
  guess: "추리",
  penalty: "공개",
  result: "결과"
};

const RULE_GUIDE = {
  2: "2인: 시작 타일 4개, 같은 숫자는 검정이 왼쪽입니다.",
  3: "3인: 시작 타일 4개, 같은 숫자는 검정이 왼쪽입니다.",
  4: "4인: 시작 타일 3개, 같은 숫자는 검정이 왼쪽입니다."
};

const SEAT_LAYOUTS = {
  2: [
    { x: 50, y: 74 },
    { x: 50, y: 18 }
  ],
  3: [
    { x: 50, y: 74 },
    { x: 22, y: 22 },
    { x: 78, y: 22 }
  ],
  4: [
    { x: 50, y: 74 },
    { x: 18, y: 50 },
    { x: 50, y: 18 },
    { x: 82, y: 50 }
  ]
};

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function currentPlayer(room = state.room) {
  return room?.players.find((player) => player.id === room.currentPlayerId) || null;
}

function isMyTurn(room = state.room) {
  return room?.currentPlayerId === room?.me?.id;
}

function currentDeckCounts(room = state.room) {
  return room?.deckCounts || {
    black: 0,
    white: 0
  };
}

function orderedPlayers(room = state.room) {
  if (!room?.players?.length) {
    return [];
  }

  const myIndex = room.players.findIndex((player) => player.id === room.me?.id);
  if (myIndex <= 0) {
    return room.players.slice();
  }

  return room.players.map((_unused, index) => room.players[(myIndex + index) % room.players.length]);
}

function introActive(room = state.room) {
  return Number.isFinite(room?.introEndsAt) && room.introEndsAt > Date.now();
}

function mySeatPosition(room = state.room) {
  return seatPosition(0, room?.players?.length || 0);
}

function selectedTargetPlayer() {
  return state.room?.players.find((player) => player.id === state.selectedTargetPlayerId) || null;
}

function selectedTargetTile() {
  return selectedTargetPlayer()?.tiles.find((tile) => tile.id === state.selectedTargetTileId) || null;
}

function setEntryStatus(text) {
  elements.entryStatus.textContent = text || "";
}

function setChatStatus(text) {
  state.chatStatus = text || "";
  elements.chatStatus.textContent = state.chatStatus;
}

function setGuessStatus(text) {
  state.guessStatus = text || "";
  elements.guessStatus.textContent = state.guessStatus;
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

function renderRuleGuide() {
  const count = Number.parseInt(elements.targetPlayerCountSelect.value || "3", 10);
  elements.ruleGuide.textContent = RULE_GUIDE[count] || RULE_GUIDE[3];
}

function displayPhaseStatus() {
  if (state.flash) {
    return state.flash;
  }

  if (!state.room) {
    return "";
  }

  if (introActive(state.room)) {
    return "선 정하는 중";
  }

  if (state.room.phase === "draw") {
    if (!isMyTurn()) {
      return `${currentPlayer()?.name || "-"} 차례`;
    }

    return state.room.deckCount > 0 ? "가져올 색 선택" : "더미 없음, 추리 시작";
  }

  return phaseStatus();
}

function phaseStatus() {
  if (state.flash) {
    return state.flash;
  }

  if (!state.room) {
    return "";
  }

  if (state.room.phase === "lobby") {
    return `${state.room.players.length} / ${state.room.targetPlayerCount}명 입장`;
  }

  if (state.room.phase === "draw") {
    return isMyTurn() ? "타일 가져오기" : `${currentPlayer()?.name || "-"} 차례`;
  }

  if (state.room.phase === "guess") {
    if (!isMyTurn()) {
      return `${currentPlayer()?.name || "-"} 추리 중`;
    }

    return state.room.canEndTurn ? "추리 계속 또는 종료" : "상대 타일 선택";
  }

  if (state.room.phase === "penalty") {
    return isMyTurn() ? "내 타일 공개 선택" : `${currentPlayer()?.name || "-"} 공개 중`;
  }

  if (state.room.phase === "result") {
    return state.room.result?.reason || "게임 종료";
  }

  return "-";
}

function renderHeader() {
  const room = state.room;
  elements.roomBadge.textContent = `방 ${room.code}`;
  elements.targetBadge.textContent = `${room.players.length}/${room.targetPlayerCount}명`;
  elements.phaseBadge.textContent = PHASE_TEXT[room.phase] || "-";
  elements.turnBadge.textContent =
    room.phase === "lobby" || room.phase === "result"
      ? "-"
      : `${currentPlayer()?.name || "-"} 차례`;
  elements.deckBadge.textContent = `남은 타일 ${room.deckCount}`;
  elements.statusBadge.textContent = phaseStatus();
}

function renderControls() {
  const room = state.room;
  const host = room.hostId === room.me.id;
  const remainingSeats = Math.max(0, room.targetPlayerCount - room.players.length);
  const mine = isMyTurn();
  const lockedByIntro = introActive(room);

  elements.botTools.hidden = !(room.phase === "lobby" && host && remainingSeats > 0);
  elements.startButton.hidden = !(room.phase === "lobby" && host);
  elements.startButton.disabled = room.players.length !== room.targetPlayerCount;
  elements.resetButton.hidden = !(room.phase === "result" && host);

  if (!elements.botTools.hidden) {
    elements.botCountInput.max = String(Math.max(1, remainingSeats));
    const current = Number.parseInt(elements.botCountInput.value || "1", 10) || 1;
    elements.botCountInput.value = String(Math.min(Math.max(1, current), Math.max(1, remainingSeats)));
  }

  elements.drawControls.hidden = !(room.phase === "draw" && mine && !lockedByIntro);
  elements.guessControls.hidden = !(room.phase === "guess" && mine && room.canEndTurn && !lockedByIntro);
  elements.penaltyControls.hidden = !(room.phase === "penalty" && mine && room.pendingPenalty && !lockedByIntro);
  elements.endTurnButton.disabled = !room.canEndTurn || lockedByIntro;
  elements.revealPenaltyButton.disabled = !state.selectedPenaltyTileId || lockedByIntro;
}

function syncDrawUi() {
  const room = state.room;
  if (!room) {
    return;
  }

  const drawPhase = room.phase === "draw" && isMyTurn();
  const deckCounts = currentDeckCounts(room);
  const noDeck = room.deckCount === 0;

  elements.drawControls.hidden = !drawPhase;
  elements.drawBlackButton.hidden = !drawPhase || noDeck;
  elements.drawWhiteButton.hidden = !drawPhase || noDeck;
  elements.drawSkipButton.hidden = !drawPhase || !noDeck;

  elements.drawBlackButton.disabled = !drawPhase || deckCounts.black <= 0;
  elements.drawWhiteButton.disabled = !drawPhase || deckCounts.white <= 0;
  elements.drawBlackButton.textContent = `검정 ${deckCounts.black}`;
  elements.drawWhiteButton.textContent = `흰색 ${deckCounts.white}`;
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

    if (state.chatIsComposing && document.activeElement === elements.chatInput) {
      state.bubbleTimerId = window.setTimeout(() => {
        scheduleBubbleRefresh(state.room);
      }, 120);
      return;
    }

    const shouldRestoreChatFocus = document.activeElement === elements.chatInput;

    renderBoard();
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

function clearRouletteTimer() {
  if (!state.rouletteTimerId) {
    return;
  }

  window.clearTimeout(state.rouletteTimerId);
  state.rouletteTimerId = null;
}

function renderStartRoulette() {
  if (!state.room || !state.rouletteActive) {
    elements.startRoulette.hidden = true;
    elements.rouletteWheel.style.removeProperty("--rotation");
    elements.rouletteWheel.classList.remove("is-spinning");
    elements.rouletteWheel.innerHTML = "";
    elements.rouletteLabels.style.removeProperty("--rotation");
    elements.rouletteLabels.classList.remove("is-spinning");
    elements.rouletteLabels.innerHTML = "";
    return;
  }

  const players = orderedPlayers(state.room);
  const count = players.length || 1;
  const segmentAngle = 360 / count;

  elements.startRoulette.hidden = false;
  elements.rouletteWheel.style.setProperty("--rotation", `${state.rouletteRotation}deg`);
  elements.rouletteWheel.classList.toggle("is-spinning", state.rouletteSpinning);
  elements.rouletteWheel.innerHTML = "";
  for (let index = 0; index < count; index += 1) {
    const divider = document.createElement("span");
    divider.className = "roulette-divider";
    divider.style.setProperty("--divider-angle", `${index * segmentAngle}deg`);
    elements.rouletteWheel.appendChild(divider);
  }

  elements.rouletteLabels.style.setProperty("--rotation", `${state.rouletteRotation}deg`);
  elements.rouletteLabels.classList.toggle("is-spinning", state.rouletteSpinning);
  elements.rouletteStatus.textContent = state.rouletteSpinning
    ? "선 정하는 중"
    : `${currentPlayer(state.room)?.name || "플레이어"} 선`;

  elements.rouletteLabels.innerHTML = "";
  players.forEach((player, index) => {
    const label = document.createElement("span");
    label.className = "roulette-label";
    label.textContent = player.name;
    if (player.id === state.rouletteWinnerId) {
      label.classList.add("is-winner");
    }
    label.style.setProperty("--angle", `${index * segmentAngle + segmentAngle / 2}deg`);
    elements.rouletteLabels.appendChild(label);
  });
}

function beginStartRoulette() {
  const selection = state.room?.startSelection;
  if (!selection?.id || state.rouletteShownId === selection.id || !introActive(state.room)) {
    return;
  }

  clearRouletteTimer();
  const players = orderedPlayers(state.room);
  const targetIndex = Math.max(
    0,
    players.findIndex((player) => player.id === selection.firstPlayerId)
  );
  const segmentAngle = 360 / Math.max(players.length, 1);
  const centerAngle = targetIndex * segmentAngle + segmentAngle / 2;
  const finalRotation = 360 * 11 - centerAngle;

  state.rouletteShownId = selection.id;
  state.rouletteActive = true;
  state.rouletteSpinning = false;
  state.rouletteRotation = 0;
  state.rouletteWinnerId = selection.firstPlayerId;
  renderStartRoulette();

  window.requestAnimationFrame(() => {
    state.rouletteSpinning = true;
    state.rouletteRotation = finalRotation;
    renderStartRoulette();
  });

  const remaining = Math.max((state.room.introEndsAt || 0) - Date.now(), ROULETTE_ANIMATION_MS);
  state.rouletteTimerId = window.setTimeout(() => {
    state.rouletteSpinning = false;
    state.rouletteActive = false;
    renderRoom();
  }, remaining + 40);
}

function seatPosition(index, total) {
  return SEAT_LAYOUTS[total]?.[index] || { x: 50, y: 50 };
}

function tileLabel(tile, isOwner) {
  if (tile.revealed || isOwner) {
    if (tile.kind === "joker") {
      return "J";
    }

    return String(tile.value);
  }

  return "?";
}

function setGuessType(nextType) {
  state.guessType = nextType === "joker" ? "joker" : "number";
  setGuessStatus("");
  renderGuessModal();

  window.requestAnimationFrame(() => {
    if (!state.guessModalOpen) {
      return;
    }

    if (state.guessType === "joker") {
      elements.guessSubmitButton.focus();
      return;
    }

    elements.guessModalInput.focus();
    elements.guessModalInput.select();
  });
}

function openGuessModal(player, tile) {
  state.selectedTargetPlayerId = player.id;
  state.selectedTargetTileId = tile.id;
  state.guessModalOpen = true;
  state.guessType = "number";
  elements.guessModalInput.value = "";
  setGuessStatus("");
  renderGuessModal();
  window.requestAnimationFrame(() => {
    elements.guessModalInput.focus();
  });
}

function closeGuessModal(options = {}) {
  const { clearSelection = true } = options;

  state.guessModalOpen = false;
  state.guessType = "number";
  elements.guessModalInput.value = "";
  setGuessStatus("");

  if (clearSelection) {
    state.selectedTargetPlayerId = null;
    state.selectedTargetTileId = null;
  }
}

function guessTargetText() {
  const player = selectedTargetPlayer();
  const tile = selectedTargetTile();

  if (!player || !tile) {
    return "-";
  }

  const tileIndex = player.tiles.findIndex((candidate) => candidate.id === tile.id) + 1;
  const colorLabel = tile.color === "black" ? "검정" : "흰색";
  return `${player.name}의 ${tileIndex}번째 ${colorLabel} 타일`;
}

function renderGuessModal() {
  const canShow =
    state.guessModalOpen &&
    state.room?.phase === "guess" &&
    isMyTurn() &&
    selectedTargetPlayer() &&
    selectedTargetTile();

  elements.guessModal.hidden = !canShow;
  if (!canShow) {
    return;
  }

  elements.guessTargetLabel.textContent = guessTargetText();
  elements.guessStatus.textContent = state.guessStatus;
  elements.guessModalInput.hidden = state.guessType === "joker";
  elements.guessModalInput.disabled = state.guessType === "joker";
  elements.guessSubmitButton.textContent = state.guessType === "joker" ? "조커 제출" : "제출";
  elements.guessTypeNumberButton.classList.toggle("is-active", state.guessType === "number");
  elements.guessTypeJokerButton.classList.toggle("is-active", state.guessType === "joker");
}

function createTileButton(player, tile, tileIndex) {
  const isOwner = player.id === state.room.me.id;
  const canSelectTarget =
    state.room.phase === "guess" &&
    isMyTurn() &&
    !isOwner &&
    !player.isEliminated &&
    !tile.revealed;
  const canSelectPenalty =
    state.room.phase === "penalty" &&
    isMyTurn() &&
    isOwner &&
    !tile.revealed;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `tile ${tile.color}${!tile.revealed && !isOwner ? " hidden" : ""}`;
  button.disabled = !(canSelectTarget || canSelectPenalty);

  if (tile.kind === "joker" && (tile.revealed || isOwner)) {
    button.classList.add("is-joker");
  }

  if (isOwner) {
    button.classList.add(tile.revealed ? "is-owned-revealed" : "is-owned-hidden");
  }

  if (state.selectedTargetTileId === tile.id || state.selectedPenaltyTileId === tile.id) {
    button.classList.add("is-selected");
  }

  const indexNode = document.createElement("span");
  indexNode.className = "tile-index";
  indexNode.textContent = String(tileIndex + 1);

  const valueNode = document.createElement("span");
  valueNode.className = "tile-value";
  valueNode.textContent = tileLabel(tile, isOwner);

  button.append(indexNode, valueNode);

  button.addEventListener("click", () => {
    if (canSelectTarget) {
      openGuessModal(player, tile);
      renderRoom();
      return;
    }

    if (canSelectPenalty) {
      state.selectedPenaltyTileId = tile.id;
      renderRoom();
    }
  });

  return button;
}

function renderBoard() {
  elements.playerBoard.innerHTML = "";
  const room = state.room;
  const players = orderedPlayers(room);
  const bubbles = currentChatBubbles(room);

  players.forEach((player, index) => {
    const placement = seatPosition(index, players.length);
    const bubble = bubbles.get(player.id);
    const seat = document.createElement("section");
    seat.className = "player-seat";
    seat.style.left = `${placement.x}%`;
    seat.style.top = `${placement.y}%`;
    seat.style.setProperty("--tile-count", String(Math.max(player.tiles.length, 3)));

    if (placement.y < 24) {
      seat.classList.add("is-near-top");
    }
    if (bubble) {
      seat.classList.add("has-bubble");
    }
    if (player.id === room.me.id) {
      seat.classList.add("is-self");
    }
    if (player.id === room.currentPlayerId) {
      seat.classList.add("is-current");
    }
    if (player.isEliminated) {
      seat.classList.add("is-eliminated");
    }

    const frame = document.createElement("div");
    frame.className = "seat-frame";

    const topLine = document.createElement("div");
    topLine.className = "seat-topline";

    const name = document.createElement("strong");
    name.className = "seat-name";
    name.textContent = player.name;

    const tag = document.createElement("span");
    tag.className = "seat-chip";
    tag.textContent = player.id === room.me.id ? "나" : player.isBot ? "BOT" : `${player.hiddenCount}개`;

    topLine.append(name, tag);

    const meta = document.createElement("div");
    meta.className = "seat-meta";

    const hidden = document.createElement("span");
    hidden.className = "seat-chip";
    hidden.textContent = `비공개 ${player.hiddenCount}`;

    const status = document.createElement("span");
    status.className = "seat-chip";
    status.textContent = player.isEliminated ? "탈락" : "진행";

    meta.append(hidden, status);

    const row = document.createElement("div");
    row.className = "tile-row";
    player.tiles.forEach((tile, tileIndex) => {
      row.appendChild(createTileButton(player, tile, tileIndex));
    });

    frame.append(topLine, meta, row);

    if (bubble) {
      const bubbleNode = document.createElement("span");
      bubbleNode.className = "chat-bubble";
      bubbleNode.textContent = bubble.text;
      seat.appendChild(bubbleNode);
    }

    seat.appendChild(frame);
    elements.playerBoard.appendChild(seat);
  });
}

function renderSeatChatComposer() {
  if (!state.room) {
    elements.seatChatComposer.hidden = true;
    return;
  }

  const selfSeat = elements.playerBoard.querySelector(".player-seat.is-self");
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
  const deckCounts = currentDeckCounts();
  elements.deckBadge.textContent = `검정 ${deckCounts.black} · 흰색 ${deckCounts.white}`;
  elements.statusBadge.textContent = displayPhaseStatus();
  renderCenterAction();
  elements.centerStatus.textContent = displayPhaseStatus();
  syncDrawUi();
  renderStartRoulette();
  renderChatLog();
  renderBoard();
  renderSeatChatComposer();
  renderGuessModal();
  scheduleBubbleRefresh(state.room);
}

function applyRoomUpdate(room, options = {}) {
  const { restoreChatFocus = false } = options;
  state.flash = "";
  state.room = room;
  state.roomCode = room.code;
  rememberSessionRoom(room.code, room.me?.name || currentName());

  if (!introActive(room)) {
    clearRouletteTimer();
    if (room.phase === "lobby" || room.phase === "result") {
      state.rouletteActive = false;
      state.rouletteSpinning = false;
      state.rouletteRotation = 0;
      state.rouletteWinnerId = "";
    }
  }

  if (!room.players.some((player) => player.id === state.selectedTargetPlayerId)) {
    state.selectedTargetPlayerId = null;
  }
  if (!selectedTargetTile()) {
    state.selectedTargetTileId = null;
  }
  if (!(room.pendingPenalty?.tileIds || []).includes(state.selectedPenaltyTileId)) {
    state.selectedPenaltyTileId = null;
  }
  if (room.phase !== "guess" || !isMyTurn(room)) {
    closeGuessModal();
  }
  if (room.phase !== "penalty") {
    state.selectedPenaltyTileId = null;
  }

  renderRoom();

  beginStartRoulette();

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
    name: elements.nameInput.value.trim(),
    targetPlayerCount: Number(elements.targetPlayerCountSelect.value)
  });

  if (!response?.ok) {
    setEntryStatus(response?.message || "방 생성 실패");
    return;
  }

  setEntryStatus("");
  state.roomCode = response.code;
  elements.roomInput.value = response.code;
  rememberSessionRoom(response.code);
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
  rememberSessionRoom(response.code);
}

async function restoreSavedRoom() {
  if (state.restoreAttempted || state.room) {
    return;
  }

  const saved = appSession.getSavedRoom();
  if (!saved?.roomCode) {
    return;
  }

  state.restoreAttempted = true;

  if (!currentName() && saved.name) {
    elements.nameInput.value = saved.name;
  }

  if (!currentRoomInput()) {
    elements.roomInput.value = saved.roomCode;
  }

  const response = await emitWithAck("room:join", {
    code: currentRoomInput(),
    name: currentName()
  });

  if (!response?.ok) {
    appSession.clearRoom();
    return;
  }

  state.roomCode = response.code;
  rememberSessionRoom(response.code);
}

function resetLocalRoomState(message = "방을 나갔습니다") {
  appSession.clearRoom();
  clearRouletteTimer();
  closeGuessModal({ preserveStatus: false });

  if (state.bubbleTimerId) {
    clearTimeout(state.bubbleTimerId);
    state.bubbleTimerId = null;
  }

  state.room = null;
  state.roomCode = "";
  state.selectedTargetPlayerId = null;
  state.selectedTargetTileId = null;
  state.selectedPenaltyTileId = null;
  state.flash = "";
  state.chatStatus = "";
  state.guessStatus = "";
  state.lastChatLogMessageId = "";
  state.chatIsComposing = false;
  state.pendingRoomUpdate = null;
  state.rouletteShownId = "";
  state.rouletteActive = false;
  state.rouletteSpinning = false;
  state.rouletteRotation = 0;
  state.rouletteWinnerId = "";
  state.guessModalOpen = false;
  state.guessType = "number";
  elements.roomInput.value = "";
  elements.chatInput.value = "";
  renderRoom();
  setEntryStatus(message);
}

async function leaveRoom() {
  const response = await emitWithAck("room:leave", {
    code: state.roomCode
  });

  if (!response?.ok) {
    state.flash = response?.message || "방 나가기에 실패했습니다";
    renderRoom();
    return;
  }

  resetLocalRoomState();
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

async function submitGuess() {
  let guessValue = null;
  if (state.guessType === "number") {
    guessValue = Number.parseInt(elements.guessModalInput.value, 10);
  }

  if (state.guessType === "number" && !Number.isInteger(guessValue)) {
    setGuessStatus("숫자를 입력하세요");
    return;
  }

  const response = await emitWithAck("turn:guess", {
    code: state.roomCode,
    targetPlayerId: state.selectedTargetPlayerId,
    tileId: state.selectedTargetTileId,
    value: guessValue,
    guessType: state.guessType
  });
  if (!response?.ok) {
    setGuessStatus(response?.message || "추리 실패");
    return;
  }
  closeGuessModal();
  renderRoom();
}
async function takeDraw(color = null) {
  const response = await emitWithAck("turn:draw", {
    code: state.roomCode,
    color
  });
  if (!response?.ok) {
    state.flash = response?.message || "드로우 실패";
    renderRoom();
    return;
  }
  state.flash = "";
}

elements.createRoomButton.addEventListener("click", createRoom);
elements.joinRoomButton.addEventListener("click", joinRoom);
elements.leaveButton.addEventListener("click", leaveRoom);
elements.addBotButton.addEventListener("click", addBots);
elements.targetPlayerCountSelect.addEventListener("change", renderRuleGuide);
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

elements.startButton.addEventListener("click", async () => {
  const response = await emitWithAck("game:start", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "시작 실패";
    renderRoom();
    return;
  }
  state.flash = "";
});

elements.resetButton.addEventListener("click", async () => {
  const response = await emitWithAck("game:reset", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "초기화 실패";
    renderRoom();
    return;
  }
  state.flash = "";
});

elements.drawBlackButton.addEventListener("click", () => {
  takeDraw("black");
});
elements.drawWhiteButton.addEventListener("click", () => {
  takeDraw("white");
});
elements.drawSkipButton.addEventListener("click", () => {
  takeDraw(null);
});

elements.revealPenaltyButton.addEventListener("click", async () => {
  const response = await emitWithAck("turn:reveal_penalty", {
    code: state.roomCode,
    tileId: state.selectedPenaltyTileId
  });

  if (!response?.ok) {
    state.flash = response?.message || "공개 실패";
    renderRoom();
    return;
  }

  state.flash = "";
});

elements.endTurnButton.addEventListener("click", async () => {
  const response = await emitWithAck("turn:end", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "턴 종료 실패";
    renderRoom();
    return;
  }

  state.flash = "";
});

elements.guessSubmitButton.addEventListener("click", submitGuess);
elements.guessTypeNumberButton.addEventListener("click", () => {
  setGuessType("number");
});
elements.guessTypeJokerButton.addEventListener("click", () => {
  setGuessType("joker");
});
elements.guessCancelButton.addEventListener("click", () => {
  closeGuessModal();
  renderRoom();
});
elements.guessBackdrop.addEventListener("click", () => {
  closeGuessModal();
  renderRoom();
});
elements.guessModalInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    submitGuess();
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

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.guessModalOpen) {
    closeGuessModal();
    renderRoom();
  }
});

renderRuleGuide();
renderRoom();

if (socket.connected) {
  restoreSavedRoom();
} else {
  socket.on("connect", restoreSavedRoom);
}


