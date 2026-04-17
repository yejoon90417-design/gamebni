const socket = io("/yut");
const appSession = window.GamebniSession.createClient("yut");
socket.auth = {
  ...(socket.auth || {}),
  playerSessionId: appSession.playerSessionId
};
socket.disconnect().connect();

const CHAT_BUBBLE_TTL = 5000;
const MOVE_STEP_MS = 220;
const MOVE_CAPTURE_MS = 180;
const MOVE_ANIMATION_SETTLE_MS = 90;
const THROW_REVEAL_DELAY_MS = 760;

const THROW_PATTERNS = {
  backdo: ["front", "back", "back", "back"],
  do: ["front", "back", "back", "back"],
  gae: ["front", "front", "back", "back"],
  geol: ["front", "front", "front", "back"],
  yut: ["front", "front", "front", "front"],
  mo: ["back", "back", "back", "back"]
};

const THROW_FINAL_LAYOUT = [
  { x: 22, y: 26, rotate: -24 },
  { x: 60, y: 24, rotate: 14 },
  { x: 34, y: 66, rotate: 18 },
  { x: 72, y: 66, rotate: -12 }
];

const state = {
  room: null,
  roomCode: "",
  flash: "",
  chatStatus: "",
  lastChatLogMessageId: "",
  chatIsComposing: false,
  pendingRoomUpdate: null,
  bubbleTimerId: null,
  restoreAttempted: false,
  targetingRollId: "",
  selectedPieceId: "",
  selectedRollId: "",
  spotPicker: null,
  moveRequest: null,
  moveAnimation: null,
  deferredRoomUpdate: null,
  throwFx: null,
  lastThrowRoll: null,
  lastAnimatedMoveId: ""
};

const elements = {
  entryScreen: document.getElementById("entryScreen"),
  gameScreen: document.getElementById("gameScreen"),
  nameInput: document.getElementById("nameInput"),
  targetPlayerCountSelect: document.getElementById("targetPlayerCountSelect"),
  ruleGuide: document.getElementById("ruleGuide"),
  roomInput: document.getElementById("roomInput"),
  entryStatus: document.getElementById("entryStatus"),
  createRoomButton: document.getElementById("createRoomButton"),
  joinRoomButton: document.getElementById("joinRoomButton"),
  roomBadge: document.getElementById("roomBadge"),
  playerBadge: document.getElementById("playerBadge"),
  phaseBadge: document.getElementById("phaseBadge"),
  statusBadge: document.getElementById("statusBadge"),
  botTools: document.getElementById("botTools"),
  botCountInput: document.getElementById("botCountInput"),
  addBotButton: document.getElementById("addBotButton"),
  startButton: document.getElementById("startButton"),
  throwButton: document.getElementById("throwButton"),
  discardRollButton: document.getElementById("discardRollButton"),
  resetButton: document.getElementById("resetButton"),
  leaveButton: document.getElementById("leaveButton"),
  chatLogList: document.getElementById("chatLogList"),
  boardMetaTitle: document.getElementById("boardMetaTitle"),
  boardMetaText: document.getElementById("boardMetaText"),
  boardSvg: document.getElementById("boardSvg"),
  boardNodes: document.getElementById("boardNodes"),
  boardAnimationLayer: document.getElementById("boardAnimationLayer"),
  spotPicker: document.getElementById("spotPicker"),
  throwStage: document.getElementById("throwStage"),
  throwArena: document.getElementById("throwArena"),
  throwResult: document.getElementById("throwResult"),
  throwPrompt: document.getElementById("throwPrompt"),
  seatLayer: document.getElementById("seatLayer"),
  seatChatComposer: document.getElementById("seatChatComposer"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  sendChatButton: document.getElementById("sendChatButton"),
  chatStatus: document.getElementById("chatStatus"),
  recentActionText: document.getElementById("recentActionText"),
  rollQueue: document.getElementById("rollQueue"),
  moveOptions: document.getElementById("moveOptions"),
  playerList: document.getElementById("playerList")
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

const RULE_GUIDE = {
  2: "2인전. 빽도 사용, 잡기 추가 턴, 업기 규칙을 적용합니다.",
  3: "3인전. 빽도 사용, 잡기 추가 턴, 업기 규칙을 적용합니다.",
  4: "4인전. 빽도 사용, 잡기 추가 턴, 업기 규칙을 적용합니다.",
  5: "5인전. 빽도 사용, 잡기 추가 턴, 업기 규칙을 적용합니다."
};

const COLOR_TEXT = {
  terracotta: "주황",
  jade: "초록",
  navy: "남색",
  gold: "금색",
  plum: "보라"
};

const LEGACY_SPOT_LAYOUT = {
  start: { x: 93, y: 94, label: "출발", type: "start" },
  o1: { x: 86, y: 76, label: "1" },
  o2: { x: 86, y: 60, label: "2" },
  o3: { x: 86, y: 44, label: "3" },
  o4: { x: 86, y: 28, label: "4" },
  o5: { x: 86, y: 12, label: "5" },
  o6: { x: 70, y: 12, label: "6" },
  o7: { x: 54, y: 12, label: "7" },
  o8: { x: 38, y: 12, label: "8" },
  o9: { x: 22, y: 12, label: "9" },
  o10: { x: 6, y: 12, label: "10" },
  o11: { x: 6, y: 28, label: "11" },
  o12: { x: 6, y: 44, label: "12" },
  o13: { x: 6, y: 60, label: "13" },
  o14: { x: 6, y: 76, label: "14" },
  o15: { x: 6, y: 92, label: "15" },
  o16: { x: 22, y: 92, label: "16" },
  o17: { x: 38, y: 92, label: "17" },
  o18: { x: 54, y: 92, label: "18" },
  o19: { x: 70, y: 92, label: "19" },
  o20: { x: 86, y: 92, label: "20" },
  a1: { x: 70, y: 28, label: "지름" },
  a2: { x: 54, y: 44, label: "지름" },
  center: { x: 46, y: 58, label: "중앙" },
  a3: { x: 22, y: 76, label: "지름" },
  b1: { x: 22, y: 28, label: "지름" },
  b2: { x: 70, y: 76, label: "지름" },
  finish: { x: 93, y: 78, label: "도착", type: "finish" }
};

const LEGACY_BOARD_PATHS = [
  ["start", "o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o9", "o10", "o11", "o12", "o13", "o14", "o15", "o16", "o17", "o18", "o19", "o20", "finish"],
  ["o5", "a1", "a2", "center", "a3", "o15"],
  ["o10", "b1", "center", "b2", "o20"]
];

const SPOT_LAYOUT = {
  start: { x: 107.5, y: 86.5, label: "출발", type: "dock" },
  finish: { x: 107.5, y: 68, label: "도착", type: "dock" },
  o1: { x: 89.9, y: 74.2, label: "1" },
  o2: { x: 89.9, y: 58.4, label: "2" },
  o3: { x: 89.9, y: 42.4, label: "3" },
  o4: { x: 89.9, y: 26.6, label: "4" },
  o5: { x: 89.9, y: 10.7, label: "5", type: "large" },
  o6: { x: 73.9, y: 10.7, label: "6" },
  o7: { x: 58, y: 10.7, label: "7" },
  o8: { x: 42, y: 10.7, label: "8" },
  o9: { x: 26.1, y: 10.7, label: "9" },
  o10: { x: 10.1, y: 10.7, label: "10", type: "large" },
  o11: { x: 10.1, y: 26.6, label: "11" },
  o12: { x: 10.1, y: 42.4, label: "12" },
  o13: { x: 10.1, y: 58.4, label: "13" },
  o14: { x: 10.1, y: 74.2, label: "14" },
  o15: { x: 10.1, y: 89.9, label: "15", type: "large" },
  o16: { x: 26.1, y: 89.9, label: "16" },
  o17: { x: 42, y: 89.9, label: "17" },
  o18: { x: 58, y: 89.9, label: "18" },
  o19: { x: 73.9, y: 89.9, label: "19" },
  o20: { x: 89.9, y: 89.9, label: "20", type: "large" },
  a1: { x: 76.6, y: 23.8, label: "A1" },
  a2: { x: 63.3, y: 37, label: "A2" },
  center: { x: 50, y: 50.1, label: "CENTER", type: "large" },
  a3: { x: 36.7, y: 63.3, label: "A3" },
  a4: { x: 23.4, y: 76.4, label: "A4" },
  b1: { x: 23.4, y: 23.8, label: "B1" },
  b2: { x: 36.7, y: 37, label: "B2" },
  b3: { x: 63.3, y: 63.3, label: "B3" },
  b4: { x: 76.6, y: 76.4, label: "B4" }
};

const BOARD_PATHS = [
  ["start", "o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o9", "o10", "o11", "o12", "o13", "o14", "o15", "o16", "o17", "o18", "o19", "o20", "finish"],
  ["o5", "a1", "a2", "center", "a3", "a4", "o15"],
  ["o10", "b1", "b2", "center", "b3", "b4", "o20"]
];

const BOARD_RENDER_ORDER = [
  "o1",
  "o2",
  "o3",
  "o4",
  "o5",
  "o6",
  "o7",
  "o8",
  "o9",
  "o10",
  "o11",
  "o12",
  "o13",
  "o14",
  "o15",
  "o16",
  "o17",
  "o18",
  "o19",
  "o20",
  "a1",
  "a2",
  "a3",
  "a4",
  "b1",
  "b2",
  "b3",
  "b4",
  "center",
  "finish",
  "start"
];

const SEAT_LAYOUTS = {
  2: [
    { x: 8, y: 50, side: "left" },
    { x: 92, y: 50, side: "right" }
  ],
  3: [
    { x: 8, y: 50, side: "left" },
    { x: 92, y: 24, side: "right" },
    { x: 92, y: 76, side: "right" }
  ],
  4: [
    { x: 8, y: 24, side: "left" },
    { x: 92, y: 24, side: "right" },
    { x: 92, y: 76, side: "right" },
    { x: 8, y: 76, side: "left" }
  ],
  5: [
    { x: 8, y: 18, side: "left" },
    { x: 92, y: 18, side: "right" },
    { x: 92, y: 50, side: "right" },
    { x: 92, y: 82, side: "right" },
    { x: 8, y: 82, side: "left" }
  ]
};

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function activeRollId(room = state.room) {
  return room?.activeRoll?.id || "";
}

function pendingRolls(room = state.room) {
  return room?.pendingRolls || [];
}

function activeMoveOptions(room = state.room) {
  return room?.moveOptions || [];
}

function canSelectMapMove(room = state.room) {
  return Boolean(
    room &&
      room.phase === "playing" &&
      room.me?.id === room.currentPlayerId &&
      pendingRolls(room).length &&
      !room.canThrow &&
      !state.moveRequest &&
      !state.moveAnimation
  );
}

function isTargetingActive(room = state.room) {
  return Boolean(canSelectMapMove(room) && state.selectedPieceId && selectedPieceOptions(room).length);
}

function clearSpotPicker() {
  state.spotPicker = null;
}

function clearSelectedRoll() {
  state.targetingRollId = "";
  state.selectedRollId = "";
  clearSpotPicker();
}

function resetMoveSelection() {
  state.selectedPieceId = "";
  clearSelectedRoll();
}

function syncMoveSelection(room = state.room) {
  if (!canSelectMapMove(room)) {
    resetMoveSelection();
    return;
  }

  if (state.selectedPieceId && !selectablePieceIds(room).has(state.selectedPieceId)) {
    resetMoveSelection();
    return;
  }

  if (state.selectedRollId && !pendingRolls(room).some((roll) => roll.id === state.selectedRollId)) {
    clearSelectedRoll();
    return;
  }

  if (state.spotPicker?.spotKey && !selectedMoveOptionsBySpot(room).has(state.spotPicker.spotKey)) {
    clearSpotPicker();
  }
}

function groupOptionsBySpot(options = []) {
  const grouped = new Map();

  options.forEach((option) => {
    if (!grouped.has(option.destinationSpotKey)) {
      grouped.set(option.destinationSpotKey, []);
    }

    grouped.get(option.destinationSpotKey).push(option);
  });

  return grouped;
}

function moveOptionsBySpot(room = state.room) {
  return groupOptionsBySpot(activeMoveOptions(room));
}

function moveOptionsByPiece(room = state.room) {
  const grouped = new Map();

  activeMoveOptions(room).forEach((option) => {
    (option.pieceIds || []).forEach((pieceId) => {
      if (!grouped.has(pieceId)) {
        grouped.set(pieceId, []);
      }

      grouped.get(pieceId).push(option);
    });
  });

  return grouped;
}

function selectablePieceIds(room = state.room) {
  if (!canSelectMapMove(room)) {
    return new Set();
  }

  return new Set((room?.me?.pieces || []).filter((piece) => !piece.finished).map((piece) => piece.id));
}

function selectedPieceOptions(room = state.room) {
  if (!state.selectedPieceId) {
    return [];
  }

  return activeMoveOptions(room).filter((option) => (option.pieceIds || []).includes(state.selectedPieceId));
}

function selectedPieceRollIds(room = state.room) {
  const available = new Set(selectedPieceOptions(room).map((option) => option.rollId));
  return pendingRolls(room)
    .filter((roll) => available.has(roll.id))
    .map((roll) => roll.id);
}

function selectedRoll(room = state.room) {
  if (!state.selectedRollId) {
    return null;
  }

  return pendingRolls(room).find((roll) => roll.id === state.selectedRollId) || null;
}

function selectedRollOptions(room = state.room) {
  if (!state.selectedRollId) {
    return [];
  }

  return selectedPieceOptions(room).filter((option) => option.rollId === state.selectedRollId);
}

function selectedMoveOptionsBySpot(room = state.room) {
  return groupOptionsBySpot(selectedPieceOptions(room));
}

function selectedPieceIds(room = state.room) {
  const ids = new Set();
  if (!state.selectedPieceId) {
    return ids;
  }

  const anchor = room?.me?.pieces?.find((piece) => piece.id === state.selectedPieceId);
  if (!anchor) {
    return ids;
  }

  if (anchor.spotKey === "start" || anchor.spotKey === "finish") {
    ids.add(anchor.id);
    return ids;
  }

  (room?.me?.pieces || []).forEach((piece) => {
    if (piece.spotKey === anchor.spotKey) {
      ids.add(piece.id);
    }
  });

  return ids;
}

function optionPathSpots(option) {
  return option.pathSpotKeys?.length ? option.pathSpotKeys : [option.destinationSpotKey];
}

function animationSpotPosition(spotKey) {
  return SPOT_LAYOUT[spotKey] || SPOT_LAYOUT.start;
}

function playerById(room, playerId) {
  return room?.players?.find((player) => player.id === playerId) || null;
}

function optionLabel(option) {
  return option.pieceCount > 1
    ? `말 ${option.pieceSerial} 포함 ${option.pieceCount}개`
    : `말 ${option.pieceSerial}`;
}

function optionMetaBits(option) {
  const bits = [];

  if (option.routeHint === "shortcut") {
    bits.push("지름길");
  }
  if (option.captureCount) {
    bits.push(`잡기 ${option.captureCount}`);
  }
  if (option.mergeCount) {
    bits.push(`합류 ${option.mergeCount}`);
  }
  if (option.reachesFinish) {
    bits.push("도착");
  }

  return bits;
}

function throwPromptText(room = state.room) {
  if (!room) {
    return "방을 만들거나 입장해 주세요.";
  }

  if (state.throwFx?.phase === "throwing") {
    return "윷이 굴러가는 중입니다.";
  }

  if (room.phase === "lobby") {
    return room.hostId === room.me?.id
      ? "인원이 모두 모이면 시작할 수 있습니다."
      : "호스트가 시작할 때까지 기다려 주세요.";
  }

  if (room.phase === "result") {
    return room.hostId === room.me?.id
      ? "다시 하기를 누르면 새 판을 시작합니다."
      : "결과를 확인하고 다음 판을 기다려 주세요.";
  }

  if (room.canThrow) {
    return "윷을 던져 결과를 만드세요.";
  }

  if (room.canDiscardActiveRoll) {
    return "쓸 수 없는 결과를 버릴 수 있습니다.";
  }

  if (pendingRolls(room).length) {
    return "쌓인 결과를 말에 사용하세요.";
  }

  return "다음 차례를 기다리는 중입니다.";
}

function renderThrowStage() {
  if (!elements.throwArena) {
    return;
  }

  const room = state.room;
  const roll = displayedThrowRoll();
  const isThrowing = state.throwFx?.phase === "throwing";
  const sticks = isThrowing
    ? state.throwFx.layout || randomThrowLayout()
    : finalThrowLayout(roll?.kind || "do", roll?.id || roll?.label || "");
  const fragment = document.createDocumentFragment();

  sticks.forEach((stick, index) => {
    const node = document.createElement("div");
    node.className = "throw-stick";
    node.style.left = `${stick.x}%`;
    node.style.top = `${stick.y}%`;
    node.style.zIndex = String(20 + index);
    node.style.setProperty("--throw-rotate", `${stick.rotate}deg`);
    node.style.setProperty("--throw-from-x", `${stick.fromX || 0}px`);
    node.style.setProperty("--throw-from-y", `${stick.fromY || 0}px`);
    node.style.setProperty("--throw-apex-x", `${stick.apexX || 0}px`);
    node.style.setProperty("--throw-apex-y", `${stick.apexY || 0}px`);
    node.style.setProperty("--throw-bounce-x", `${stick.bounceX || 0}px`);
    node.style.setProperty("--throw-bounce-y", `${stick.bounceY || 0}px`);
    node.style.setProperty("--throw-from-rotate", `${stick.fromRotate || stick.rotate}deg`);
    node.style.setProperty("--throw-apex-rotate", `${stick.apexRotate || stick.rotate}deg`);
    node.style.setProperty("--throw-bounce-rotate", `${stick.bounceRotate || stick.rotate}deg`);
    node.style.setProperty("--throw-delay", `${stick.delay || 0}ms`);
    node.style.setProperty("--throw-duration", `${stick.duration || THROW_REVEAL_DELAY_MS}ms`);

    if (isThrowing) {
      node.classList.add("is-throwing");
    } else {
      node.classList.add(stick.face === "back" ? "is-back" : "is-front");
    }

    const shadow = document.createElement("span");
    shadow.className = "throw-stick-shadow";

    const front = document.createElement("span");
    front.className = "throw-stick-face throw-stick-front";

    const back = document.createElement("span");
    back.className = "throw-stick-face throw-stick-back";
    if (roll?.kind === "backdo" && index === 0) {
      node.classList.add("is-special-backdo");
    }

    node.append(shadow, front, back);
    fragment.appendChild(node);
  });

  elements.throwArena.replaceChildren(fragment);
  elements.throwStage.classList.toggle("is-throwing", isThrowing);
  elements.throwStage.classList.toggle("is-revealed", !isThrowing && Boolean(roll));
  elements.throwResult.textContent = isThrowing ? "던지는 중" : roll?.label || "대기";
  elements.throwPrompt.textContent = throwPromptText(room);
}

syncStaticLabels();
renderBoardSvg();
renderRuleGuide();
renderRoom();

if (socket.connected) {
  restoreSavedRoom();
} else {
  socket.on("connect", restoreSavedRoom);
}
