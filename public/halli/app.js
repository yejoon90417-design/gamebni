const socket = io("/halli");
const appSession = window.GamebniSession.createClient("halli");
socket.auth = {
  ...(socket.auth || {}),
  playerSessionId: appSession.playerSessionId
};
socket.disconnect().connect();
const CHAT_BUBBLE_TTL = 5000;
const TRANSFER_ANIMATION_MS = 900;
const TRANSFER_STAGGER_MS = 110;
const MAX_TRANSFER_CARDS_PER_PATH = 3;
const BELL_DEFAULT_SEGMENT_MS = 1850;

const state = {
  room: null,
  roomCode: "",
  flash: "",
  chatStatus: "",
  lastChatLogMessageId: "",
  chatIsComposing: false,
  pendingRoomUpdate: null,
  pendingJoin: false,
  bubbleTimerId: null,
  lastTransferEffectId: "",
  transferCleanupTimerId: null,
  bellFrameId: null,
  restoreAttempted: false
};

const elements = {
  entryScreen: document.getElementById("entryScreen"),
  gameScreen: document.getElementById("gameScreen"),
  nameInput: document.getElementById("nameInput"),
  targetPlayerCountInput: document.getElementById("targetPlayerCountInput"),
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
  tableStage: document.getElementById("tableStage"),
  seatLayer: document.getElementById("seatLayer"),
  selfDock: document.getElementById("selfDock"),
  selfSeatArea: document.getElementById("selfSeatArea"),
  bellButton: document.getElementById("bellButton"),
  flipButton: document.getElementById("flipButton"),
  seatChatComposer: document.getElementById("seatChatComposer"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  sendChatButton: document.getElementById("sendChatButton"),
  chatStatus: document.getElementById("chatStatus"),
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

const SEAT_POSITIONS = {
  0: [],
  1: [{ left: 50, top: 14 }],
  2: [
    { left: 26, top: 20 },
    { left: 74, top: 20 }
  ],
  3: [
    { left: 18, top: 28 },
    { left: 50, top: 12 },
    { left: 82, top: 28 }
  ],
  4: [
    { left: 16, top: 40 },
    { left: 34, top: 14 },
    { left: 66, top: 14 },
    { left: 84, top: 40 }
  ],
  5: [
    { left: 14, top: 44 },
    { left: 28, top: 18 },
    { left: 50, top: 10 },
    { left: 72, top: 18 },
    { left: 86, top: 44 }
  ]
};

function escapeSelectorValue(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(String(value));
  }

  return String(value).replace(/["\\]/g, "\\$&");
}

function clearTransferEffects() {
  if (state.transferCleanupTimerId) {
    clearTimeout(state.transferCleanupTimerId);
    state.transferCleanupTimerId = null;
  }

  const layer = document.getElementById("transferLayer");
  if (layer) {
    layer.innerHTML = "";
  }
}

function ensureTransferLayer() {
  let layer = document.getElementById("transferLayer");

  if (!layer) {
    layer = document.createElement("div");
    layer.id = "transferLayer";
    layer.className = "transfer-layer";
    elements.tableStage.appendChild(layer);
  }

  return layer;
}

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function bellPointForSegment(room, segmentIndex, stageRect) {
  const motion = room?.bellMotion;
  const baseSeed = hashString(`${room?.code || "halli"}:${motion?.seed || 0}`);
  const rng = createSeededRandom(baseSeed + segmentIndex * 0x9e3779b9);
  const bellWidth = elements.bellButton?.offsetWidth || 64;
  const bellHeight = elements.bellButton?.offsetHeight || 64;
  const minX = Math.max(40, bellWidth / 2 + 10);
  const maxX = Math.min(stageRect.width - 40, stageRect.width - bellWidth / 2 - 10);
  const minY = Math.max(56, bellHeight / 2 + 10);
  const maxY = Math.min(stageRect.height - 200, stageRect.height - bellHeight / 2 - 10);

  if (!(maxX > minX) || !(maxY > minY)) {
    return {
      x: stageRect.width / 2,
      y: stageRect.height / 2
    };
  }

  const zone = Math.floor(rng() * 7);
  const xSpan = maxX - minX;
  const ySpan = maxY - minY;
  let xRatio = rng();
  let yRatio = rng();

  if (zone === 0) {
    xRatio = 0.06 + rng() * 0.18;
    yRatio = 0.08 + rng() * 0.34;
  } else if (zone === 1) {
    xRatio = 0.76 + rng() * 0.18;
    yRatio = 0.08 + rng() * 0.34;
  } else if (zone === 2) {
    xRatio = 0.12 + rng() * 0.76;
    yRatio = 0.06 + rng() * 0.18;
  } else if (zone === 3) {
    xRatio = 0.08 + rng() * 0.28;
    yRatio = 0.42 + rng() * 0.28;
  } else if (zone === 4) {
    xRatio = 0.64 + rng() * 0.28;
    yRatio = 0.42 + rng() * 0.28;
  } else if (zone === 5) {
    xRatio = 0.24 + rng() * 0.52;
    yRatio = 0.24 + rng() * 0.32;
  }

  return {
    x: minX + xRatio * xSpan,
    y: minY + yRatio * ySpan
  };
}

function bellSegmentDuration(room, segmentIndex) {
  const motion = room?.bellMotion;
  const baseSeed = hashString(`${room?.code || "halli"}:${motion?.seed || 0}:dur`);
  const rng = createSeededRandom(baseSeed + segmentIndex * 0x85ebca6b);
  const base = Math.max(700, Number(motion?.segmentMs) || BELL_DEFAULT_SEGMENT_MS);
  return Math.round(base * (0.8 + rng() * 0.9));
}

function bellControlPoint(room, segmentIndex, from, to, stageRect) {
  const motion = room?.bellMotion;
  const baseSeed = hashString(`${room?.code || "halli"}:${motion?.seed || 0}:ctrl`);
  const rng = createSeededRandom(baseSeed + segmentIndex * 0xc2b2ae35);
  const bellWidth = elements.bellButton?.offsetWidth || 64;
  const bellHeight = elements.bellButton?.offsetHeight || 64;
  const minX = Math.max(40, bellWidth / 2 + 10);
  const maxX = Math.min(stageRect.width - 40, stageRect.width - bellWidth / 2 - 10);
  const minY = Math.max(56, bellHeight / 2 + 10);
  const maxY = Math.min(stageRect.height - 200, stageRect.height - bellHeight / 2 - 10);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const nx = -dy / distance;
  const ny = dx / distance;
  const curve = (rng() > 0.5 ? 1 : -1) * (24 + rng() * 72);
  const drag = (rng() - 0.5) * 64;

  return {
    x: Math.max(minX, Math.min(maxX, midX + nx * curve + dx * 0.12 + drag)),
    y: Math.max(minY, Math.min(maxY, midY + ny * curve + dy * 0.12 + (rng() - 0.5) * 44))
  };
}

function bellTimelineState(room, elapsed) {
  let segmentIndex = 0;
  let segmentStart = 0;

  while (segmentIndex < 2048) {
    const duration = bellSegmentDuration(room, segmentIndex);
    if (elapsed < segmentStart + duration) {
      return {
        segmentIndex,
        segmentStart,
        segmentDuration: duration
      };
    }

    segmentStart += duration;
    segmentIndex += 1;
  }

  return {
    segmentIndex: 0,
    segmentStart: 0,
    segmentDuration: bellSegmentDuration(room, 0)
  };
}

function renderBellMotion() {
  const room = state.room;
  if (!elements.bellButton || !elements.tableStage) {
    return;
  }

  if (!room || room.phase !== "playing" || !room.bellMotion) {
    elements.bellButton.style.left = "50%";
    elements.bellButton.style.top = "50%";
    return;
  }

  const stageRect = elements.tableStage.getBoundingClientRect();
  if (!stageRect.width || !stageRect.height) {
    return;
  }

  const startedAt = Number(room.bellMotion.startedAt) || 0;
  const syncedAt = Number(room.clientSyncedAt) || Date.now();
  const serverNow = Number(room.serverNow) || syncedAt;
  const baseElapsed = Math.max(0, serverNow - startedAt);
  const elapsed = Math.max(0, baseElapsed + (Date.now() - syncedAt));
  const timeline = bellTimelineState(room, elapsed);
  const progress = (elapsed - timeline.segmentStart) / timeline.segmentDuration;
  const eased = progress * progress * (3 - 2 * progress);
  const from = bellPointForSegment(room, timeline.segmentIndex, stageRect);
  const to = bellPointForSegment(room, timeline.segmentIndex + 1, stageRect);
  const control = bellControlPoint(room, timeline.segmentIndex, from, to, stageRect);
  const oneMinus = 1 - eased;
  const x =
    oneMinus * oneMinus * from.x +
    2 * oneMinus * eased * control.x +
    eased * eased * to.x;
  const y =
    oneMinus * oneMinus * from.y +
    2 * oneMinus * eased * control.y +
    eased * eased * to.y;

  elements.bellButton.style.left = `${x}px`;
  elements.bellButton.style.top = `${y}px`;
}

function startBellMotionLoop() {
  if (state.bellFrameId) {
    return;
  }

  const tick = () => {
    renderBellMotion();
    state.bellFrameId = window.requestAnimationFrame(tick);
  };

  state.bellFrameId = window.requestAnimationFrame(tick);
}

function isMyTurn(room = state.room) {
  return room?.currentPlayerId === room?.me?.id;
}

function currentPlayer(room = state.room) {
  return room?.players.find((player) => player.id === room.currentPlayerId) || null;
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
    return `${state.room.players.length}/${state.room.targetPlayerCount}명 대기`;
  }

  if (state.room.phase === "playing") {
    const player = currentPlayer();
    return player ? `${player.name} 차례` : "대기";
  }

  if (state.room.phase === "result") {
    return state.room.result?.reason || "결과 대기";
  }

  return "-";
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
  }, Math.max(nextExpiry - now, 0) + 24);
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
    if (message.kind === "system" || !message.playerId) {
      item.classList.add("is-system");
    } else if (message.playerId === state.room.me?.id) {
      item.classList.add("is-self");
    }

    const name = document.createElement("strong");
    name.className = "chat-log-name";
    name.textContent = message.name || "SYSTEM";

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

function renderHeader() {
  const room = state.room;
  elements.roomBadge.textContent = `방 ${room.code}`;
  elements.playerBadge.textContent = `${room.players.length}/${room.targetPlayerCount}명`;
  elements.phaseBadge.textContent = room.phaseText || room.phase;
  elements.statusBadge.textContent = displayStatus();
}

function renderControls() {
  const room = state.room;
  const isHost = room.hostId === room.me.id;
  const openSlots = room.targetPlayerCount - room.players.length;
  const canAddBot = isHost && room.phase === "lobby" && openSlots > 0;

  elements.botTools.hidden = !canAddBot;
  elements.botCountInput.max = String(Math.max(openSlots, 1));
  elements.startButton.hidden = !(room.phase === "lobby" && isHost);
  elements.startButton.disabled = room.players.length < 2;
  elements.resetButton.hidden = !isHost || room.phase === "lobby";
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

const CARD_IMAGE_FILES = {
  banana: {
    1: "banana1.png",
    2: "banana2.png",
    3: "banana3.png",
    4: "banana4.png",
    5: "banana5.png"
  },
  strawberry: {
    1: "strawberry1.png",
    2: "strawberry2.png",
    3: "strawberry3.png",
    4: "strawberry4.png",
    5: "strawberry5.png"
  },
  lime: {
    1: "lime1.png",
    2: "lime2.png",
    3: "lime3.png",
    4: "lime4.png",
    5: "lime5.png"
  },
  plum: {
    1: "cherry1.png",
    2: "cherry2.png",
    3: "cherry3.png",
    4: "cherry4.png",
    5: "cherry5.png"
  }
};

function cardImageFileName(card) {
  return CARD_IMAGE_FILES[card?.fruit]?.[card?.count] || "";
}

function cardImageSrc(card) {
  const fileName = cardImageFileName(card);
  return fileName ? `/halli/${encodeURIComponent(fileName)}` : "";
}

function createCardImage(card) {
  const src = cardImageSrc(card);
  if (!src) {
    return null;
  }

  const image = document.createElement("img");
  image.className = "card-preview-image";
  image.src = src;
  image.alt = "";
  image.decoding = "async";
  image.draggable = false;
  return image;
}

function fruitSvgMarkup(fruit) {
  if (fruit === "banana") {
    return `
      <svg viewBox="0 0 72 54" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M17 33C23 18 39 11 55 13C49 31 35 40 21 39" fill="#ffffff" stroke="#111111" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M23 37C34 37 44 31 50 22" stroke="#111111" stroke-width="2" stroke-linecap="round"/>
        <path d="M15 33L11 37" stroke="#111111" stroke-width="3" stroke-linecap="round"/>
        <path d="M56 13L61 11" stroke="#111111" stroke-width="3" stroke-linecap="round"/>
      </svg>
    `;
  }

  if (fruit === "strawberry") {
    return `
      <svg viewBox="0 0 72 54" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M28 12L22 7M36 12V6M44 12L50 7" stroke="#111111" stroke-width="3" stroke-linecap="round"/>
        <path d="M20 13C24 10 28 10 31 13C34 10 39 10 42 13C45 10 49 10 53 13" stroke="#111111" stroke-width="3" stroke-linecap="round"/>
        <path d="M36 48C22 48 14 38 14 27C14 18 22 12 36 12C50 12 58 18 58 27C58 38 50 48 36 48Z" fill="#ffffff" stroke="#111111" stroke-width="3"/>
        <circle cx="28" cy="24" r="1.5" fill="#111111"/>
        <circle cx="36" cy="21" r="1.5" fill="#111111"/>
        <circle cx="44" cy="24" r="1.5" fill="#111111"/>
        <circle cx="24" cy="31" r="1.5" fill="#111111"/>
        <circle cx="32" cy="29" r="1.5" fill="#111111"/>
        <circle cx="40" cy="30" r="1.5" fill="#111111"/>
        <circle cx="48" cy="31" r="1.5" fill="#111111"/>
        <circle cx="29" cy="37" r="1.5" fill="#111111"/>
        <circle cx="36" cy="39" r="1.5" fill="#111111"/>
        <circle cx="43" cy="37" r="1.5" fill="#111111"/>
      </svg>
    `;
  }

  if (fruit === "lime") {
    return `
      <svg viewBox="0 0 72 54" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="36" cy="28" r="18" fill="#ffffff" stroke="#111111" stroke-width="3"/>
        <circle cx="36" cy="28" r="12" stroke="#111111" stroke-width="2"/>
        <path d="M36 16V40M24 28H48M28 20L44 36M44 20L28 36" stroke="#111111" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 72 54" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M37 10V18" stroke="#111111" stroke-width="3" stroke-linecap="round"/>
      <path d="M37 13C41 9 47 9 51 13" stroke="#111111" stroke-width="3" stroke-linecap="round"/>
      <path d="M36 46C23 46 14 37 14 27C14 18 23 11 36 11C49 11 58 18 58 27C58 37 49 46 36 46Z" fill="#ffffff" stroke="#111111" stroke-width="3"/>
      <path d="M26 23C29 20 33 19 36 19C39 19 43 20 46 23" stroke="#111111" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
}

function fruitLayoutPositions(count) {
  if (count === 1) {
    return [{ x: 50, y: 50 }];
  }

  if (count === 2) {
    return [
      { x: 32, y: 32 },
      { x: 68, y: 68 }
    ];
  }

  if (count === 3) {
    return [
      { x: 28, y: 28 },
      { x: 50, y: 50 },
      { x: 72, y: 72 }
    ];
  }

  if (count === 4) {
    return [
      { x: 34, y: 30 },
      { x: 66, y: 30 },
      { x: 40, y: 70 },
      { x: 72, y: 70 }
    ];
  }

  return [
    { x: 24, y: 24 },
    { x: 44, y: 38 },
    { x: 34, y: 52 },
    { x: 54, y: 66 },
    { x: 74, y: 80 }
  ];
}

function createFruitLayout(fruit, count) {
  const layout = document.createElement("div");
  layout.className = `fruit-layout count-${count}`;

  fruitLayoutPositions(count).forEach((position) => {
    const item = document.createElement("span");
    item.className = "fruit-layout-item";
    item.innerHTML = fruitSvgMarkup(fruit);
    item.style.left = `${position.x}%`;
    item.style.top = `${position.y}%`;
    layout.appendChild(item);
  });

  return layout;
}

function createCardPreview(card, options = {}) {
  const { stackCount = 0 } = options;
  const preview = document.createElement("div");
  preview.className = "card-preview";

  if (!card) {
    preview.classList.add("is-empty");
    return preview;
  }

  const stackDepth = Math.max(0, Math.min(2, stackCount - 1));
  for (let index = stackDepth; index >= 1; index -= 1) {
    const shadow = document.createElement("span");
    shadow.className = `card-stack-shadow is-depth-${index}`;
    preview.append(shadow);
  }

  const image = createCardImage(card);
  if (image) {
    image.addEventListener(
      "error",
      () => {
        image.remove();
        preview.append(createFruitLayout(card.fruit, card.count));
      },
      { once: true }
    );
    preview.append(image);
    return preview;
  }

  preview.append(createFruitLayout(card.fruit, card.count));
  return preview;
}

function seatAnchor(playerId) {
  if (!elements.tableStage || !playerId) {
    return null;
  }

  const selector = `.player-seat[data-player-id="${escapeSelectorValue(playerId)}"]`;
  const seat = elements.tableStage.querySelector(selector);
  if (!seat) {
    return null;
  }

  const preview = seat.querySelector(".card-preview");
  const frame = seat.querySelector(".seat-frame");
  const tableRect = elements.tableStage.getBoundingClientRect();
  const previewRect = preview?.getBoundingClientRect();
  const anchor =
    previewRect && previewRect.width > 8 && previewRect.height > 8 ? preview : frame || seat;
  const anchorRect = anchor.getBoundingClientRect();

  return {
    x: anchorRect.left - tableRect.left + anchorRect.width / 2,
    y: anchorRect.top - tableRect.top + anchorRect.height / 2
  };
}

function createTransferCard(type, transfer, copyIndex, copies) {
  const card = document.createElement("div");
  card.className = `transfer-card transfer-card-${type}`;
  card.innerHTML = `
    <div class="transfer-card-face">
      <span class="transfer-card-mark"></span>
      <span class="transfer-card-mark"></span>
      <span class="transfer-card-mark"></span>
    </div>
  `;

  if (copyIndex === copies - 1 && transfer.count > copies) {
    const badge = document.createElement("span");
    badge.className = "transfer-card-badge";
    badge.textContent = `x${transfer.count}`;
    card.appendChild(badge);
  }

  return card;
}

function playTransferEffect(effect) {
  if (!effect?.id || effect.id === state.lastTransferEffectId) {
    return;
  }

  state.lastTransferEffectId = effect.id;
  clearTransferEffects();

  const transfers = (effect.transfers || []).filter((transfer) => transfer.count > 0);
  if (!transfers.length) {
    return;
  }

  const layer = ensureTransferLayer();
  let latestEndAt = 0;

  transfers.forEach((transfer, transferIndex) => {
    const from = seatAnchor(transfer.fromPlayerId);
    const to = seatAnchor(transfer.toPlayerId);

    if (!from || !to) {
      return;
    }

    const copies = Math.max(1, Math.min(MAX_TRANSFER_CARDS_PER_PATH, transfer.count));

    for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
      const card = createTransferCard(effect.type || "collect", transfer, copyIndex, copies);
      const spread = copyIndex - (copies - 1) / 2;
      const startX = from.x + spread * 10;
      const startY = from.y + copyIndex * 6;
      const endX = to.x + spread * 6;
      const endY = to.y + copyIndex * 4;
      const delay = transferIndex * TRANSFER_STAGGER_MS + copyIndex * 70;

      card.style.left = `${startX}px`;
      card.style.top = `${startY}px`;
      layer.appendChild(card);

      card.animate([
        {
          left: `${startX}px`,
          top: `${startY}px`,
          opacity: 0,
          transform: `translate(-50%, -50%) rotate(${spread * 8 - 10}deg) scale(0.88)`
        },
        {
          left: `${startX}px`,
          top: `${startY}px`,
          opacity: 1,
          transform: `translate(-50%, -50%) rotate(${spread * 6 - 6}deg) scale(1)`,
          offset: 0.12
        },
        {
          left: `${endX}px`,
          top: `${endY}px`,
          opacity: 1,
          transform: `translate(-50%, -50%) rotate(${spread * 4 + 6}deg) scale(1)`,
          offset: 0.86
        },
        {
          left: `${endX}px`,
          top: `${endY}px`,
          opacity: 0,
          transform: `translate(-50%, -50%) rotate(${spread * 4 + 10}deg) scale(0.94)`
        }
      ], {
        duration: TRANSFER_ANIMATION_MS,
        delay,
        easing: "cubic-bezier(0.2, 0.9, 0.18, 1)",
        fill: "forwards"
      });

      latestEndAt = Math.max(latestEndAt, delay + TRANSFER_ANIMATION_MS);
    }
  });

  if (!latestEndAt) {
    return;
  }

  state.transferCleanupTimerId = window.setTimeout(() => {
    clearTransferEffects();
  }, latestEndAt + 120);
}

function createSeat(player, options = {}) {
  const { isSelf = false, bubble = null } = options;
  const seat = document.createElement("section");
  seat.className = "player-seat";
  seat.dataset.playerId = player.id;

  if (isSelf) {
    seat.classList.add("is-self");
  }
  if (player.isCurrent && state.room.phase === "playing") {
    seat.classList.add("is-current");
  }
  if (player.isEliminated) {
    seat.classList.add("is-eliminated");
  }

  if (bubble) {
    seat.appendChild(createBubble(bubble));
  }

  const frame = document.createElement("div");
  frame.className = "seat-frame";

  const name = document.createElement("strong");
  name.className = "seat-name";
  name.textContent = player.name;

  const remaining = document.createElement("strong");
  remaining.className = "seat-remaining";
  remaining.textContent = `남은 ${player.drawCount}장`;

  frame.append(
    name,
    createCardPreview(player.topCard, {
      stackCount: player.faceUpCount
    }),
    remaining
  );
  seat.append(frame);
  return seat;
}

function orderedPlayers(room) {
  const meId = room.me?.id;
  const meIndex = room.players.findIndex((player) => player.id === meId);
  if (meIndex === -1) {
    return room.players.slice();
  }

  return room.players.map((_, offset) => room.players[(meIndex + offset) % room.players.length]);
}

function renderSeats() {
  elements.seatLayer.innerHTML = "";
  elements.selfSeatArea.innerHTML = "";

  if (!state.room?.me) {
    return;
  }

  const bubbles = currentChatBubbles(state.room);
  const ordered = orderedPlayers(state.room);
  const me = ordered[0];
  const others = ordered.slice(1);
  const positions = SEAT_POSITIONS[others.length] || SEAT_POSITIONS[5];

  others.forEach((player, index) => {
    const seat = createSeat(player, { bubble: bubbles.get(player.id) });
    const position = positions[index] || positions[positions.length - 1];

    seat.style.left = `${position.left}%`;
    seat.style.top = `${position.top}%`;
    seat.style.transform = "translate(-50%, -50%)";
    elements.seatLayer.appendChild(seat);
  });

  elements.selfSeatArea.appendChild(
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

  if (!elements.selfDock) {
    elements.seatChatComposer.hidden = true;
    return;
  }

  elements.seatChatComposer.hidden = false;
  elements.chatInput.disabled = false;
  elements.sendChatButton.disabled = false;
  elements.chatStatus.textContent = state.chatStatus;

  if (elements.seatChatComposer.parentElement !== elements.selfDock) {
    elements.selfDock.appendChild(elements.seatChatComposer);
  }
}

function renderActionButtons() {
  const me = state.room?.me;
  const hasFieldCards = Boolean(state.room?.players?.some((player) => player.faceUpCount > 0));
  const canFlip =
    state.room?.phase === "playing" &&
    isMyTurn() &&
    Boolean(me?.drawCount);
  const canRing =
    state.room?.phase === "playing" &&
    !me?.isEliminated &&
    hasFieldCards;

  elements.flipButton.disabled = !canFlip;
  elements.bellButton.disabled = !canRing;
}

function renderScreens() {
  const joined = Boolean(state.room) || state.pendingJoin;
  elements.entryScreen.hidden = joined;
  elements.gameScreen.hidden = !joined;
  elements.entryScreen.style.display = joined ? "none" : "";
  elements.gameScreen.style.display = joined ? "grid" : "none";
}

function renderRoom() {
  renderScreens();

  if (!state.room) {
    clearTransferEffects();
    return;
  }

  renderHeader();
  renderControls();
  renderActionButtons();
  renderChatLog();
  renderSeats();
  renderSeatChatComposer();
  scheduleBubbleRefresh(state.room);
  renderBellMotion();
}

function showPendingGameScreen(code) {
  state.pendingJoin = true;
  state.lastTransferEffectId = "";
  clearTransferEffects();
  elements.entryScreen.hidden = true;
  elements.gameScreen.hidden = false;
  elements.entryScreen.style.display = "none";
  elements.gameScreen.style.display = "grid";
  elements.roomBadge.textContent = code ? `방 ${code}` : "방";
  elements.playerBadge.textContent = "-";
  elements.phaseBadge.textContent = "대기";
  elements.statusBadge.textContent = "방 정보를 불러오는 중";
}

async function syncRoomState(code) {
  const response = await emitWithAck("room:state", { code });
  if (!response?.ok || !response.room) {
    return null;
  }

  return response.room;
}

function applyRoomUpdate(room, options = {}) {
  const { restoreChatFocus = false } = options;
  state.flash = "";
  state.pendingJoin = false;
  room.clientSyncedAt = Date.now();
  state.room = room;
  state.roomCode = room.code;
  rememberSessionRoom(room.code, room.me?.name || currentName());
  renderRoom();
  playTransferEffect(room.transferEffect);

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
  try {
    const response = await emitWithAck("room:create", {
      name: elements.nameInput.value.trim(),
      settings: {
        targetPlayerCount: Number.parseInt(elements.targetPlayerCountInput.value, 10)
      }
    });

    if (!response?.ok) {
      setEntryStatus(response?.message || "방 생성에 실패했습니다");
      return;
    }

    setEntryStatus("");
    state.roomCode = response.code;
    elements.roomInput.value = response.code;
    rememberSessionRoom(response.code);
    showPendingGameScreen(response.code);
    const room = response.room || (await syncRoomState(response.code));
    if (room) {
      applyRoomUpdate(room);
    } else {
      state.pendingJoin = false;
      state.room = null;
      renderScreens();
      setEntryStatus("방 정보를 불러오지 못했습니다");
    }
  } catch (error) {
    state.pendingJoin = false;
    state.room = null;
    renderScreens();
    setEntryStatus(`방 생성 실패: ${error?.message || "알 수 없는 오류"}`);
  }
}

async function joinRoom() {
  try {
    const response = await emitWithAck("room:join", {
      code: elements.roomInput.value.trim().toUpperCase(),
      name: elements.nameInput.value.trim()
    });

    if (!response?.ok) {
      setEntryStatus(response?.message || "입장에 실패했습니다");
      return;
    }

    setEntryStatus("");
    state.roomCode = response.code;
    rememberSessionRoom(response.code);
    showPendingGameScreen(response.code);
    const room = response.room || (await syncRoomState(response.code));
    if (room) {
      applyRoomUpdate(room);
    } else {
      state.pendingJoin = false;
      state.room = null;
      renderScreens();
      setEntryStatus("방 정보를 불러오지 못했습니다");
    }
  } catch (error) {
    state.pendingJoin = false;
    state.room = null;
    renderScreens();
    setEntryStatus(`입장 실패: ${error?.message || "알 수 없는 오류"}`);
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

  if (!currentName() && saved.name) {
    elements.nameInput.value = saved.name;
  }

  if (!currentRoomInput()) {
    elements.roomInput.value = saved.roomCode;
  }

  try {
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
    showPendingGameScreen(response.code);
    const room = response.room || (await syncRoomState(response.code));
    if (room) {
      applyRoomUpdate(room);
      return;
    }
  } catch (_error) {
    // Fall through to clear stale recovery data.
  }

  appSession.clearRoom();
  state.pendingJoin = false;
  state.room = null;
  renderScreens();
}

function resetLocalRoomState(message = "방을 나갔습니다") {
  appSession.clearRoom();

  if (state.bubbleTimerId) {
    clearTimeout(state.bubbleTimerId);
    state.bubbleTimerId = null;
  }

  if (state.transferCleanupTimerId) {
    clearTimeout(state.transferCleanupTimerId);
    state.transferCleanupTimerId = null;
  }

  if (state.bellFrameId) {
    window.cancelAnimationFrame(state.bellFrameId);
    state.bellFrameId = null;
  }

  clearTransferEffects();
  state.room = null;
  state.roomCode = "";
  state.flash = "";
  state.chatStatus = "";
  state.lastChatLogMessageId = "";
  state.chatIsComposing = false;
  state.pendingRoomUpdate = null;
  state.pendingJoin = false;
  state.lastTransferEffectId = "";
  elements.roomInput.value = "";
  elements.chatInput.value = "";
  renderRoom();
  renderBellMotion();
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
    state.flash = response?.message || "봇 추가에 실패했습니다";
    renderRoom();
    return;
  }

  state.flash = "";
}

async function startGame() {
  const response = await emitWithAck("game:start", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "게임 시작에 실패했습니다";
    renderRoom();
    return;
  }

  state.flash = "";
}

async function resetGame() {
  const response = await emitWithAck("game:reset", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "대기실 복귀에 실패했습니다";
    renderRoom();
    return;
  }

  state.flash = "";
}

async function flipCard() {
  const response = await emitWithAck("turn:flip", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "카드를 뒤집지 못했습니다";
    renderRoom();
    return;
  }

  state.flash = "";
}

async function ringBell() {
  const response = await emitWithAck("bell:ring", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "종을 칠 수 없습니다";
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
    setChatStatus("채팅을 입력하세요");
    focusChatInput();
    return;
  }

  const response = await emitWithAck("chat:send", {
    code: state.roomCode,
    text
  });

  if (!response?.ok) {
    setChatStatus(response?.message || "채팅 전송에 실패했습니다");
    focusChatInput();
    return;
  }

  elements.chatInput.value = "";
  setChatStatus("");
  focusChatInput();
}

elements.createRoomButton.addEventListener("click", createRoom);
elements.joinRoomButton.addEventListener("click", joinRoom);
elements.leaveButton.addEventListener("click", leaveRoom);
elements.addBotButton.addEventListener("click", addBots);
elements.startButton.addEventListener("click", startGame);
elements.resetButton.addEventListener("click", resetGame);
elements.flipButton.addEventListener("click", flipCard);
elements.bellButton.addEventListener("click", ringBell);
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

startBellMotionLoop();

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

if (socket.connected) {
  restoreSavedRoom();
} else {
  socket.on("connect", restoreSavedRoom);
}
