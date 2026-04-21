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

const ENTRY_PATH = "/yut/";
const PLAY_PATH = "/yut/play";

function isPlayRoute() {
  const { pathname } = window.location;
  return pathname === PLAY_PATH || pathname === `${PLAY_PATH}/`;
}

function navigateToPlay() {
  if (!isPlayRoute()) {
    window.location.replace(PLAY_PATH);
  }
}

function navigateToEntry() {
  if (isPlayRoute()) {
    window.location.replace(ENTRY_PATH);
  }
}

const PHASE_TEXT = {
  lobby: "대기",
  playing: "진행",
  result: "결과"
};

const RULE_GUIDE = {
  2: "2인전. 빽도 사용, 잡기 추가 턴, 업기를 적용합니다.",
  3: "3인전. 빽도 사용, 잡기 추가 턴, 업기를 적용합니다.",
  4: "4인전. 빽도 사용, 잡기 추가 턴, 업기를 적용합니다.",
  5: "5인전. 빽도 사용, 잡기 추가 턴, 업기를 적용합니다."
};

const COLOR_TEXT = {
  terracotta: "주황",
  jade: "초록",
  navy: "남색",
  gold: "노랑",
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
  return "Piece " + option.pieceSerial + (option.pieceCount > 1 ? " +" + (option.pieceCount - 1) : "");
}

function optionMetaBits(option) {
  const bits = [];

  if (option.routeHint === "shortcut") {
    bits.push("shortcut");
  }
  if (option.captureCount) {
    bits.push("capture " + option.captureCount);
  }
  if (option.mergeCount) {
    bits.push("stack " + option.mergeCount);
  }
  if (option.reachesFinish) {
    bits.push("finish");
  }

  return bits;
}

function rollDistanceLabel(roll) {
  if (!roll) {
    return "";
  }

  return roll.steps < 0 ? "1칸 뒤로" : `${roll.steps}칸`;
}

function randomThrowLayout() {
  return Array.from({ length: 4 }, (_unused, index) => ({
    x: 18 + Math.random() * 60,
    y: 18 + Math.random() * 58,
    rotate: -60 + Math.random() * 120,
    delay: index * 50
  }));
}

function finalThrowLayout(kind) {
  const pattern = THROW_PATTERNS[kind] || THROW_PATTERNS.do;

  return pattern.map((face, index) => ({
    face,
    x: THROW_FINAL_LAYOUT[index].x,
    y: THROW_FINAL_LAYOUT[index].y,
    rotate: THROW_FINAL_LAYOUT[index].rotate
  }));
}

function displayedThrowRoll() {
  return state.throwFx?.roll || selectedRoll() || state.lastThrowRoll || state.room?.activeRoll || pendingRolls()[0] || null;
}

function throwPromptText(room = state.room) {
  if (!room) {
    return "Create or join a room to begin.";
  }

  if (state.throwFx?.phase === "throwing") {
    return "Throwing the sticks...";
  }

  if (room.phase === "lobby") {
    return room.hostId === room.me?.id
      ? "Fill the room, then press START."
      : "Waiting for the host to start.";
  }

  if (room.phase === "result") {
    return room.hostId === room.me?.id ? "Press RESET to play again." : "Game over.";
  }

  if (room.canThrow) {
    return "Press THROW when you are ready.";
  }

  if (room.canDiscardActiveRoll) {
    if (state.selectedRollId && room.discardableRollIds?.includes(state.selectedRollId)) {
      return "This result cannot move any piece. Use DISCARD.";
    }

    return "A stuck result can be discarded.";
  }

  if (pendingRolls(room).length) {
    if (!state.selectedPieceId) {
      return "Tap one of your pieces to see where it can go.";
    }

    if (!selectedPieceOptions(room).length) {
      return "That piece cannot use any stacked result. Pick a different piece.";
    }

    return "Choose one of the shown move cases or tap a glowing destination.";
  }

  return "Waiting for the next turn.";
}

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function currentName() {
  return elements.nameInput.value.trim();
}

function currentRoomInput() {
  return elements.roomInput.value.trim().toUpperCase();
}

function rememberSessionRoom(roomCode = state.roomCode, name = currentName()) {
  appSession.rememberRoom(state.room?.me?.name || name, roomCode);
}

function renderRuleGuide() {
  const target = String(elements.targetPlayerCountSelect.value || "2");
  elements.ruleGuide.textContent = RULE_GUIDE[target] || RULE_GUIDE[2];
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

function playerColorLabel(player) {
  return COLOR_TEXT[player?.colorKey] || "-";
}

function currentPlayer(room = state.room) {
  return room?.players.find((player) => player.id === room.currentPlayerId) || null;
}

function displayStatus() {
  if (state.flash) {
    return state.flash;
  }

  if (!state.room) {
    return "";
  }

  if (state.room.phase === "lobby") {
    return `${state.room.players.length}/${state.room.targetPlayerCount}명 참가`;
  }

  if (state.room.phase === "playing") {
    if (state.room.canThrow) {
      return "윷을 던지세요";
    }
    if (state.room.activeRoll) {
      return `${state.room.activeRoll.label} 결과를 처리하세요`;
    }
    return `${currentPlayer()?.name || "플레이어"} 차례`;
  }

  if (state.room.phase === "result") {
    return state.room.result?.reason || "게임 종료";
  }

  return "-";
}

function displayBoardMeta() {
  if (!state.room) {
    return {
      title: "대기실",
      text: "인원이 모이면 시작 버튼으로 판을 엽니다."
    };
  }

  if (state.room.phase === "lobby") {
    return {
      title: "윷판 준비",
      text: `${state.room.players.length}/${state.room.targetPlayerCount}명이 모였습니다. 업기, 빽도, 잡기 추가 턴 규칙으로 진행합니다.`
    };
  }

  if (state.room.phase === "playing") {
    if (state.room.canThrow) {
      return {
        title: `${state.room.me?.name || "내"} 차례`,
        text: "윷을 던져 결과를 쌓고, 앞에서부터 하나씩 말을 움직입니다."
      };
    }

    if (state.room.activeRoll) {
      return {
        title: `현재 결과: ${state.room.activeRoll.label}`,
        text:
          state.room.moveOptions.length
            ? "이동 버튼으로 말을 움직이세요. 잡으면 한 번 더 던집니다."
            : "움직일 수 있는 말이 없으면 결과를 넘길 수 있습니다."
      };
    }

    const player = currentPlayer();
    return {
      title: `${player?.name || "플레이어"} 차례`,
      text: `${playerColorLabel(player)} 말이 윷을 던지고 이동할 순서입니다.`
    };
  }

  return {
    title: state.room.result?.reason || "게임 종료",
    text: "호스트가 다시 시작하면 새 판을 바로 열 수 있습니다."
  };
}

function displayStatus() {
  if (state.flash) {
    return state.flash;
  }

  if (!state.room) {
    return "";
  }

  if (state.room.phase === "lobby") {
    return `${state.room.players.length}/${state.room.targetPlayerCount}명 참가`;
  }

  if (state.room.phase === "playing") {
    if (state.room.canThrow) {
      return "윷 던지기";
    }

    if (pendingRolls(state.room).length) {
      if (!state.selectedPieceId) {
        return "말 선택";
      }

      if (!state.selectedRollId) {
        return "결과 선택";
      }

      return `${selectedRoll()?.label || "결과"} 처리`;
    }

    return `${currentPlayer()?.name || "플레이어"} 차례`;
  }

  if (state.room.phase === "result") {
    return state.room.result?.reason || "게임 종료";
  }

  return "-";
}

function displayBoardMeta() {
  if (!state.room) {
    return {
      title: "대기중",
      text: "인원이 모이면 게임을 시작할 수 있습니다."
    };
  }

  if (state.room.phase === "lobby") {
    return {
      title: "윷판 준비",
      text: `${state.room.players.length}/${state.room.targetPlayerCount}명이 모였습니다. 빽도, 업기, 잡기 추가 턴 규칙으로 진행합니다.`
    };
  }

  if (state.room.phase === "playing") {
    if (state.room.canThrow) {
      return {
        title: `${state.room.me?.name || "플레이어"} 차례`,
        text: "윷을 던져 결과를 쌓은 뒤, 말을 선택해서 결과를 사용하세요."
      };
    }

    if (pendingRolls(state.room).length) {
      return {
        title: state.selectedPieceId ? "말을 골랐습니다" : "쌓인 결과를 쓰는 중",
        text: throwPromptText(state.room)
      };
    }

    const player = currentPlayer();
    return {
      title: `${player?.name || "플레이어"} 차례`,
      text: `${playerColorLabel(player)} 말이 윷을 던지고 움직일 차례입니다.`
    };
  }

  return {
    title: state.room.result?.reason || "게임 종료",
    text: "호스트가 다시 시작하면 바로 새 판을 열 수 있습니다."
  };
}

function renderHeader() {
  const room = state.room;
  elements.roomBadge.textContent = `방 ${room.code}`;
  elements.playerBadge.textContent = `${room.players.length}/${room.targetPlayerCount}명`;
  elements.phaseBadge.textContent = PHASE_TEXT[room.phase] || room.phase;
  elements.statusBadge.textContent =
    room.phase === "playing" ? `${currentPlayer(room)?.name || "?뚮젅?댁뼱"} 李⑤?` : displayStatus();
}

function renderControls() {
  const room = state.room;
  const isHost = room.hostId === room.me.id;
  const canAddBot = isHost && room.phase === "lobby" && room.players.length < room.targetPlayerCount;
  const canDiscardSelectedRoll =
    room.phase === "playing" &&
    Boolean(state.selectedRollId && room.discardableRollIds?.includes(state.selectedRollId));

  elements.botTools.hidden = !canAddBot;
  elements.botCountInput.max = String(Math.max(1, room.targetPlayerCount - room.players.length));
  elements.startButton.hidden = !(room.phase === "lobby" && isHost);
  elements.startButton.disabled = room.players.length !== room.targetPlayerCount || room.players.length < 2;
  elements.throwButton.hidden = room.phase !== "playing";
  elements.throwButton.disabled = !room.canThrow || state.throwFx?.phase === "throwing";
  elements.discardRollButton.hidden = !canDiscardSelectedRoll;
  elements.discardRollButton.disabled = !canDiscardSelectedRoll;
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
    renderSeatLayer();
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
    empty.textContent = "No chat yet.";
    elements.chatLogList.appendChild(empty);
    state.lastChatLogMessageId = "";
    return;
  }

  const fragment = document.createDocumentFragment();

  [...messages].reverse().forEach((message) => {
    const item = document.createElement("article");
    item.className = "chat-log-item";
    if (message.kind === "system") {
      item.classList.add("is-system");
    } else if (message.playerId === state.room.me?.id) {
      item.classList.add("is-self");
    }

    const name = document.createElement("strong");
    name.className = "chat-log-name";
    name.textContent = message.kind === "system" ? "SYSTEM" : message.name || "Player";

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

function renderBoardSvg() {
  const fragment = document.createDocumentFragment();

  BOARD_PATHS.forEach((path) => {
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute(
      "points",
      path.map((spotKey) => `${SPOT_LAYOUT[spotKey].x},${SPOT_LAYOUT[spotKey].y}`).join(" ")
    );
    polyline.setAttribute("class", "board-line");
    fragment.appendChild(polyline);
  });

  elements.boardSvg.replaceChildren(fragment);
}

function hiddenAnimationPieceIds() {
  return state.moveAnimation?.hiddenPieceIds || null;
}

function boardPiecesBySpot(room) {
  const piecesBySpot = new Map();
  const hiddenPieceIds = hiddenAnimationPieceIds();

  room.players.forEach((player) => {
    player.pieces.forEach((piece) => {
      if (hiddenPieceIds?.has(piece.id)) {
        return;
      }

      const spotKey = piece.spotKey;
      if (!piecesBySpot.has(spotKey)) {
        piecesBySpot.set(spotKey, []);
      }

      piecesBySpot.get(spotKey).push({
        id: piece.id,
        serial: piece.serial,
        playerId: player.id,
        playerName: player.name,
        colorKey: player.colorKey
      });
    });
  });

  return piecesBySpot;
}

function handleBoardSpotPress(spotKey) {
  if (!isTargetingActive()) {
    return;
  }

  const options = selectedMoveOptionsBySpot().get(spotKey) || [];
  if (!options.length) {
    return;
  }

  if (options.length === 1) {
    commitMoveOption(options[0]);
    return;
  }

  state.spotPicker = { spotKey };
  renderBoardNodes();
  renderSpotPicker();
  renderMoveOptions();
}

function handlePiecePress(pieceId) {
  if (!canSelectMapMove()) {
    return;
  }

  if (state.selectedPieceId === pieceId) {
    resetMoveSelection();
    renderControls();
    renderBoardNodes();
    renderRollQueue();
    renderThrowStage();
    renderSpotPicker();
    renderMoveOptions();
    return;
  }

  state.selectedPieceId = pieceId;
  clearSelectedRoll();
  clearSpotPicker();
  renderControls();
  renderBoardNodes();
  renderRollQueue();
  renderThrowStage();
  renderSpotPicker();
  renderMoveOptions();
}

function createNode(
  spotKey,
  room,
  pieces,
  highlight = false,
  selectable = false,
  selected = false,
  movablePieceIds = new Set(),
  selectedPieceSet = new Set()
) {
  const layout = SPOT_LAYOUT[spotKey];
  const node = document.createElement("div");
  node.className = "board-node";
  node.style.left = `${layout.x}%`;
  node.style.top = `${layout.y}%`;
  node.title = layout.label;

  if (layout.type === "large") {
    node.classList.add("is-large");
  }
  if (layout.type === "dock") {
    node.classList.add("is-dock");
  }
  if (highlight) {
    node.classList.add("is-option");
  }
  if (selected) {
    node.classList.add("is-selected");
  }
  if (selectable) {
    node.classList.add("is-selectable");
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.addEventListener("click", () => {
      handleBoardSpotPress(spotKey);
    });
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleBoardSpotPress(spotKey);
      }
    });
  }
  if (pieces.length) {
    node.classList.add("is-occupied");
  }

  const label = document.createElement("span");
  label.className = "node-label";
  label.textContent = layout.label;

  const stack = document.createElement("div");
  stack.className = "node-stack";
  let hasMovablePiece = false;

  pieces.forEach((piece) => {
    const isMovable = movablePieceIds.has(piece.id);
    const chip = document.createElement(isMovable ? "button" : "span");
    chip.className = `piece-chip color-${piece.colorKey}`;
    chip.textContent = piece.serial;
    chip.title = `${piece.playerName} piece ${piece.serial}`;

    if (isMovable) {
      hasMovablePiece = true;
      chip.type = "button";
      chip.classList.add("is-movable");
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        handlePiecePress(piece.id);
      });
      chip.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          handlePiecePress(piece.id);
        }
      });
    }

    if (selectedPieceSet.has(piece.id)) {
      chip.classList.add("is-selected-piece");
    }

    stack.appendChild(chip);
  });

  if (hasMovablePiece) {
    node.classList.add("has-movable-piece");
  }

  node.append(label, stack);
  return node;
}

function renderBoardNodes() {
  if (!state.room) {
    elements.boardNodes.innerHTML = "";
    return;
  }

  const piecesBySpot = boardPiecesBySpot(state.room);
  const groupedOptions = selectedMoveOptionsBySpot(state.room);
  const movablePieceIds = selectablePieceIds(state.room);
  const selectedPieceSet = selectedPieceIds(state.room);
  const highlightedSpots = isTargetingActive(state.room) ? new Set(groupedOptions.keys()) : new Set();
  const selectedSpotKey = state.spotPicker?.spotKey || "";
  const fragment = document.createDocumentFragment();

  BOARD_RENDER_ORDER.forEach((spotKey) => {
    fragment.appendChild(
      createNode(
        spotKey,
        state.room,
        piecesBySpot.get(spotKey) || [],
        highlightedSpots.has(spotKey),
        highlightedSpots.has(spotKey),
        selectedSpotKey === spotKey,
        movablePieceIds,
        selectedPieceSet
      )
    );
  });

  elements.boardNodes.replaceChildren(fragment);
}

function spriteOffset(index, total) {
  if (total <= 1) {
    return { x: 0, y: 0 };
  }

  const presets = {
    2: [
      { x: -10, y: -2 },
      { x: 10, y: 2 }
    ],
    3: [
      { x: 0, y: -10 },
      { x: -10, y: 8 },
      { x: 10, y: 8 }
    ],
    4: [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: -10, y: 10 },
      { x: 10, y: 10 }
    ]
  };

  return presets[total]?.[index] || { x: 0, y: 0 };
}

function renderBoardAnimationLayer() {
  if (!state.moveAnimation) {
    elements.boardAnimationLayer.innerHTML = "";
    return;
  }

  const existing = new Map(
    [...elements.boardAnimationLayer.children].map((node) => [node.dataset.spriteId, node])
  );
  const activeIds = new Set();

  state.moveAnimation.sprites.forEach((sprite, index) => {
    const spriteId = String(sprite.id);
    activeIds.add(spriteId);

    let chip = existing.get(spriteId);
    if (!chip) {
      chip = document.createElement("span");
      chip.dataset.spriteId = spriteId;
      elements.boardAnimationLayer.appendChild(chip);
    }

    chip.className = "piece-chip piece-sprite color-" + sprite.colorKey;
    chip.textContent = sprite.serial;
    chip.title = sprite.playerName + " " + sprite.serial;
    chip.style.left = String(sprite.x) + "%";
    chip.style.top = String(sprite.y) + "%";

    const offset = spriteOffset(index % sprite.stackSize, sprite.stackSize);
    chip.style.transform = "translate(calc(-50% + " + offset.x + "px), calc(-50% + " + offset.y + "px))";
  });

  existing.forEach((node, spriteId) => {
    if (!activeIds.has(spriteId)) {
      node.remove();
    }
  });
}

function renderSpotPicker() {
  if (!state.room || !isTargetingActive(state.room) || !state.spotPicker?.spotKey) {
    elements.spotPicker.innerHTML = "";
    return;
  }

  const options = selectedMoveOptionsBySpot(state.room).get(state.spotPicker.spotKey) || [];
  if (options.length <= 1) {
    elements.spotPicker.innerHTML = "";
    return;
  }

  const layout = animationSpotPosition(state.spotPicker.spotKey);
  const panel = document.createElement("div");
  panel.className = "spot-picker-card";
  panel.style.left = String(layout.x) + "%";
  panel.style.top = String(layout.y) + "%";

  const title = document.createElement("p");
  title.className = "spot-picker-title";
  title.textContent = options[0].destinationLabel + " destination";
  panel.appendChild(title);

  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "spot-picker-option";
    button.addEventListener("click", () => {
      commitMoveOption(option);
    });

    const titleText = document.createElement("span");
    titleText.textContent = optionLabel(option);

    const metaText = document.createElement("span");
    const bits = optionMetaBits(option);
    metaText.className = "spot-picker-meta";
    metaText.textContent = bits.length ? bits.join(" / ") : "standard move";

    button.append(titleText, metaText);
    panel.appendChild(button);
  });

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "spot-picker-cancel";
  cancelButton.textContent = "Close";
  cancelButton.addEventListener("click", () => {
    clearSpotPicker();
    renderSpotPicker();
    renderBoardNodes();
    renderMoveOptions();
  });
  panel.appendChild(cancelButton);

  elements.spotPicker.replaceChildren(panel);
}

function createBubble(message) {
  if (!message) {
    return null;
  }

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = message.text;
  return bubble;
}

function renderSeatLayer() {
  const chatShell = elements.chatLogList?.parentElement;
  if (chatShell && elements.seatChatComposer.parentElement !== chatShell) {
    chatShell.appendChild(elements.seatChatComposer);
  }

  elements.seatLayer.innerHTML = "";
}

function syncStaticLabels() {
  const currentGameButton = document.querySelector(".game-picker > button[disabled]");
  if (currentGameButton) {
    currentGameButton.textContent = "YUT";
  }

  document.querySelectorAll(".brand").forEach((brand) => {
    const mark = brand.querySelector(".brand-mark");
    const labels = [...brand.querySelectorAll("span")];
    const label = labels[labels.length - 1];
    if (mark?.textContent.trim() === "Y" && label) {
      label.textContent = "YUT";
    }
  });
}

function renderSeatLayer__sideCards_disabled() {
  if (!state.room) {
    elements.seatLayer.innerHTML = "";
    return;
  }

  const layout = SEAT_LAYOUTS[state.room.players.length] || SEAT_LAYOUTS[4];
  const bubbles = currentChatBubbles(state.room);
  const fragment = document.createDocumentFragment();

  state.room.players.forEach((player, index) => {
    const position = layout[index] || layout[layout.length - 1];
    const seat = document.createElement("section");
    seat.className = "player-seat";
    seat.style.left = `${position.x}%`;
    seat.style.top = `${position.y}%`;

    if (player.isCurrent) {
      seat.classList.add("is-current");
    }

    const bubble = createBubble(bubbles.get(player.id));
    if (bubble) {
      seat.appendChild(bubble);
    }

    const card = document.createElement("div");
    card.className = "seat-card";

    const topLine = document.createElement("div");
    topLine.className = "seat-topline";

    const name = document.createElement("strong");
    name.className = "seat-name";
    name.textContent = player.name;

    const roleChip = document.createElement("span");
    roleChip.className = "seat-chip";
    roleChip.textContent = player.isBot ? "BOT" : player.id === state.room.me?.id ? "나" : playerColorLabel(player);

    topLine.append(name, roleChip);

    const stats = document.createElement("div");
    stats.className = "seat-stats";

    const turnChip = document.createElement("span");
    turnChip.className = "seat-chip";
    if (player.isCurrent) {
      turnChip.classList.add("is-current");
      turnChip.textContent = "차례";
    } else if (!player.connected) {
      turnChip.classList.add("is-offline");
      turnChip.textContent = "오프라인";
    } else {
      turnChip.textContent = "대기";
    }

    const stat = document.createElement("span");
    stat.className = "seat-stat";
    stat.textContent = `대기 ${player.waitingCount} · 완주 ${player.finishedCount}`;

    stats.append(turnChip, stat);
    card.append(topLine, stats);
    seat.appendChild(card);
    fragment.appendChild(seat);
  });

  elements.seatLayer.replaceChildren(fragment);
}

function renderRecentAction() {
  elements.recentActionText.textContent = state.room?.recentAction?.text || "-";
}

function renderThrowStage() {
  if (!elements.throwArena) {
    return;
  }

  const room = state.room;
  const roll = displayedThrowRoll();
  const isThrowing = state.throwFx?.phase === "throwing";
  const sticks = isThrowing ? state.throwFx.layout || randomThrowLayout() : finalThrowLayout(roll?.kind || "do");
  const fragment = document.createDocumentFragment();

  sticks.forEach((stick, index) => {
    const node = document.createElement("div");
    node.className = "throw-stick";
    node.style.left = `${stick.x}%`;
    node.style.top = `${stick.y}%`;
    node.style.setProperty("--throw-rotate", `${stick.rotate}deg`);

    if (isThrowing) {
      node.classList.add("is-throwing");
      node.style.animationDelay = `${stick.delay || 0}ms`;
    } else {
      node.classList.add(stick.face === "front" ? "is-front" : "is-back");
    }

    const front = document.createElement("span");
    front.className = "throw-stick-face throw-stick-front";
    const back = document.createElement("span");
    back.className = "throw-stick-face throw-stick-back";
    if (roll?.kind === "backdo" && index === 0) {
      back.classList.add("is-special-backdo");
    }

    node.append(front, back);
    fragment.appendChild(node);
  });

  elements.throwArena.replaceChildren(fragment);
  elements.throwStage.classList.toggle("is-throwing", isThrowing);
  elements.throwResult.textContent = isThrowing ? "THROWING" : roll?.label || "READY";
  elements.throwPrompt.textContent = throwPromptText(room);
}

function renderRollQueue() {
  if (!state.room) {
    elements.rollQueue.innerHTML = "";
    return;
  }

  elements.rollQueue.innerHTML = "";

  if (!state.room.pendingRolls.length) {
    const empty = document.createElement("p");
    empty.className = "move-options-empty";
    empty.textContent = state.room.phase === "playing" && state.room.canThrow ? "던진 결과가 아직 없습니다." : "쌓인 결과가 없습니다.";
    elements.rollQueue.appendChild(empty);
    return;
  }

  const selectableRollIds = new Set(selectedPieceRollIds(state.room));
  const discardableRollIds = new Set(state.room.discardableRollIds || []);
  const fragment = document.createDocumentFragment();

  state.room.pendingRolls.forEach((roll) => {
    const canUseSelectedPiece = state.selectedPieceId ? selectableRollIds.has(roll.id) : false;
    const canFocusForDiscard = discardableRollIds.has(roll.id);
    const canInteract = canFocusForDiscard;
    const isSelected = state.selectedRollId === roll.id;
    const card = document.createElement(canInteract ? "button" : "article");
    card.className = "roll-card";
    if (isSelected) {
      card.classList.add("is-armed");
    }
    if (canInteract) {
      card.type = "button";
      card.classList.add("is-selectable");
      card.addEventListener("click", () => {
        state.selectedRollId = isSelected ? "" : roll.id;
        clearSpotPicker();
        renderControls();
        renderThrowStage();
        renderRollQueue();
        renderMoveOptions();
        renderBoardNodes();
        renderSpotPicker();
      });
    }
    if (discardableRollIds.has(roll.id) && !canUseSelectedPiece) {
      card.classList.add("is-muted");
    }

    const name = document.createElement("p");
    name.className = "roll-name";
    name.textContent = roll.label || roll.kind;

    const meta = document.createElement("p");
    meta.className = "roll-meta";
    if (!state.selectedPieceId) {
      meta.textContent = rollDistanceLabel(roll);
    } else if (canUseSelectedPiece) {
      meta.textContent = `${rollDistanceLabel(roll)} 이동`;
    } else if (discardableRollIds.has(roll.id)) {
      meta.textContent = "막힌 결과";
    } else {
      meta.textContent = "이 말로는 불가";
    }

    meta.textContent = !state.selectedPieceId
      ? rollDistanceLabel(roll)
      : canUseSelectedPiece
        ? `${rollDistanceLabel(roll)} move ready`
        : discardableRollIds.has(roll.id)
          ? "discardable"
          : "not for this piece";

    card.append(name, meta);
    fragment.appendChild(card);
  });

  elements.rollQueue.appendChild(fragment);
}

function renderMoveOptions() {
  if (!state.room) {
    elements.moveOptions.innerHTML = "";
    return;
  }

  elements.moveOptions.innerHTML = "";

  if (state.room.phase !== "playing") {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = "Move hints will appear here after the game starts.";
    elements.moveOptions.appendChild(text);
    return;
  }

  if (state.room.canThrow) {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = "Throw the sticks first.";
    elements.moveOptions.appendChild(text);
    return;
  }

  if (state.room.canDiscardActiveRoll) {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = "No piece can move. Use discard for this result.";
    elements.moveOptions.appendChild(text);
    return;
  }

  if (!state.room.moveOptions.length) {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = "Another player is resolving their result.";
    elements.moveOptions.appendChild(text);
    return;
  }

  if (state.moveRequest || state.moveAnimation) {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = "A piece is moving.";
    elements.moveOptions.appendChild(text);
    return;
  }

  if (!isTargetingActive(state.room)) {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = state.selectedPieceId
      ? "That piece cannot use the current stacked results. Pick a different piece."
      : "Tap one of your pieces to show every move case for that piece.";
    elements.moveOptions.appendChild(text);
    return;
  }

  const visibleOptions = state.spotPicker?.spotKey
    ? selectedMoveOptionsBySpot(state.room).get(state.spotPicker.spotKey) || []
    : selectedPieceOptions(state.room);

  if (state.spotPicker?.spotKey) {
    const guide = document.createElement("p");
    guide.className = "move-options-empty";
    guide.textContent =
      visibleOptions.length > 1
        ? (visibleOptions[0]?.destinationLabel || "that spot") + " has multiple move cases."
        : "Move to the selected spot.";
    elements.moveOptions.appendChild(guide);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "move-option";
    cancel.addEventListener("click", () => {
      clearSpotPicker();
      renderBoardNodes();
      renderSpotPicker();
      renderMoveOptions();
    });

    const cancelTitle = document.createElement("p");
    cancelTitle.className = "move-option-title";
    cancelTitle.textContent = "Show all move cases";

    const cancelMeta = document.createElement("p");
    cancelMeta.className = "move-option-meta";
    cancelMeta.textContent = "Return to the full list for this piece.";

    cancel.append(cancelTitle, cancelMeta);
    elements.moveOptions.appendChild(cancel);
  } else {
    const guide = document.createElement("p");
    guide.className = "move-options-empty";
    guide.textContent = "Choose one of the move cases below or tap a glowing destination.";
    elements.moveOptions.appendChild(guide);
  }

  visibleOptions.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "move-option";
    if (state.spotPicker?.spotKey && state.spotPicker.spotKey === option.destinationSpotKey) {
      button.classList.add("is-focused");
    }
    button.addEventListener("click", () => {
      commitMoveOption(option);
    });

    const title = document.createElement("p");
    title.className = "move-option-title";
    title.textContent = `${option.rollLabel} -> ${option.destinationLabel}`;

    const meta = document.createElement("p");
    meta.className = "move-option-meta";
    const bits = [option.rollSteps < 0 ? "back 1" : `${option.rollSteps} step${option.rollSteps === 1 ? "" : "s"}`];
    if (option.pieceCount > 1) {
      bits.push(`stack x${option.pieceCount}`);
    }
    optionMetaBits(option).forEach((bit) => bits.push(bit));
    meta.textContent = bits.join(" / ");

    button.append(title, meta);
    elements.moveOptions.appendChild(button);
  });
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

    const top = document.createElement("div");
    top.className = "player-row-top";

    const name = document.createElement("p");
    name.className = "player-row-name";
    name.textContent = player.name;

    const chip = document.createElement("span");
    chip.className = "seat-chip";
    chip.textContent = player.isBot ? "BOT" : playerColorLabel(player);
    if (player.isCurrent) {
      chip.classList.add("is-current");
      chip.textContent = "차례";
    }

    top.append(name, chip);

    const meta = document.createElement("p");
    meta.className = "player-row-meta";
    meta.textContent = `대기 ${player.waitingCount} · 판 위 ${player.onBoardCount} · 완주 ${player.finishedCount}${player.connected ? "" : " · 오프라인"}`;

    row.append(top, meta);
    fragment.appendChild(row);
  });

  elements.playerList.replaceChildren(fragment);
}

function renderSeatChatComposer() {
  elements.seatChatComposer.hidden = !state.room?.me;
  elements.chatInput.disabled = !state.room?.me;
  elements.sendChatButton.disabled = !state.room?.me;
  elements.chatStatus.textContent = state.chatStatus;
}

function renderScreens() {
  const joined = Boolean(state.room);
  elements.entryScreen.hidden = joined;
  elements.gameScreen.hidden = !joined;
}

function renderRoom() {
  renderScreens();

  if (!state.room) {
    elements.boardAnimationLayer.innerHTML = "";
    elements.spotPicker.innerHTML = "";
    elements.rollQueue.innerHTML = "";
    renderThrowStage();
    return;
  }

  syncMoveSelection(state.room);
  const boardMeta = displayBoardMeta();
  if (state.room.phase === "playing") {
    boardMeta.title = `${currentPlayer(state.room)?.name || "?뚮젅?댁뼱"} 李⑤?`;
    boardMeta.text = "";
  }
  renderHeader();
  renderControls();
  elements.boardMetaTitle.textContent = boardMeta.title;
  elements.boardMetaText.textContent = boardMeta.text;
  renderRecentAction();
  renderThrowStage();
  renderChatLog();
  renderRollQueue();
  renderMoveOptions();
  renderPlayerList();
  renderBoardNodes();
  renderBoardAnimationLayer();
  renderSpotPicker();
  renderSeatLayer();
  renderSeatChatComposer();
  scheduleBubbleRefresh(state.room);
}

function applyRoomUpdate(room, options = {}) {
  const { restoreChatFocus = false } = options;
  state.flash = "";
  state.room = room;
  state.roomCode = room.code;
  if (room?.lastMove?.id) {
    state.lastAnimatedMoveId = room.lastMove.id;
  }
  syncMoveSelection(room);
  rememberSessionRoom(room.code, room.me?.name || currentName());
  renderRoom();

  if (restoreChatFocus) {
    focusChatInput();
  }
}

async function createRoom() {
  if (!socket.connected) {
    setEntryStatus("서버에 연결 중입니다. 잠시 후 다시 시도해 주세요.");
    return;
  }

  const response = await emitWithAck("room:create", {
    name: currentName(),
    settings: {
      targetPlayerCount: Number.parseInt(elements.targetPlayerCountSelect.value || "2", 10)
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
  navigateToPlay();
}

async function joinRoom() {
  if (!socket.connected) {
    setEntryStatus("서버에 연결 중입니다. 잠시 후 다시 시도해 주세요.");
    return;
  }

  const response = await emitWithAck("room:join", {
    code: currentRoomInput(),
    name: currentName()
  });

  if (!response?.ok) {
    setEntryStatus(response?.message || "입장에 실패했습니다");
    return;
  }

  setEntryStatus("");
  state.roomCode = response.code;
  rememberSessionRoom(response.code);
  navigateToPlay();
}

async function restoreSavedRoom() {
  if (state.restoreAttempted || state.room) {
    return;
  }

  const saved = appSession.getSavedRoom();
  if (!isPlayRoute()) {
    return;
  }

  if (!saved?.roomCode) {
    navigateToEntry();
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
    navigateToEntry();
    return;
  }

  state.roomCode = response.code;
  rememberSessionRoom(response.code);
  if (response.room) {
    applyRoomUpdate(response.room);
  }
}

function resetLocalRoomState(message = "방을 나갔습니다") {
  appSession.clearRoom();

  if (state.bubbleTimerId) {
    clearTimeout(state.bubbleTimerId);
    state.bubbleTimerId = null;
  }

  state.room = null;
  state.roomCode = "";
  state.flash = "";
  state.chatStatus = "";
  state.lastChatLogMessageId = "";
  state.chatIsComposing = false;
  state.pendingRoomUpdate = null;
  state.targetingRollId = "";
  state.selectedPieceId = "";
  state.selectedRollId = "";
  state.spotPicker = null;
  state.moveRequest = null;
  state.moveAnimation = null;
  state.deferredRoomUpdate = null;
  state.throwFx = null;
  state.lastThrowRoll = null;
  state.lastAnimatedMoveId = "";
  elements.roomInput.value = "";
  elements.chatInput.value = "";
  renderRoom();
  setEntryStatus(message);
  navigateToEntry();
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
    state.flash = response?.message || "다시 시작에 실패했습니다";
    renderRoom();
    return;
  }

  state.flash = "";
}

async function throwSticks() {
  if (state.throwFx?.phase === "throwing") {
    return;
  }

  const startedAt = Date.now();
  state.throwFx = {
    phase: "throwing",
    layout: randomThrowLayout()
  };
  renderControls();
  renderThrowStage();

  const response = await emitWithAck("throw:sticks", { code: state.roomCode });
  const elapsed = Date.now() - startedAt;
  if (elapsed < THROW_REVEAL_DELAY_MS) {
    await wait(THROW_REVEAL_DELAY_MS - elapsed);
  }

  if (!response?.ok) {
    state.throwFx = null;
    state.flash = response?.message || "윷 던지기에 실패했습니다.";
    renderRoom();
    return;
  }

  state.throwFx = {
    phase: "revealed",
    roll: response.roll
  };
  state.lastThrowRoll = response.roll;
  state.flash = "";
  renderControls();
  renderThrowStage();
  window.setTimeout(() => {
    if (state.throwFx?.phase === "revealed" && state.throwFx.roll?.id === response.roll?.id) {
      state.throwFx = null;
      renderControls();
      renderThrowStage();
    }
  }, 900);
}

async function discardRoll() {
  const response = await emitWithAck("roll:discard", { code: state.roomCode });
  if (!response?.ok) {
    state.flash = response?.message || "결과 넘기기에 실패했습니다";
    renderRoom();
    return;
  }

  state.flash = "";
}

async function discardRoll() {
  if (!state.selectedRollId) {
    state.flash = "버릴 결과를 먼저 고르세요.";
    renderRoom();
    return;
  }

  const response = await emitWithAck("roll:discard", {
    code: state.roomCode,
    rollId: state.selectedRollId
  });
  if (!response?.ok) {
    state.flash = response?.message || "결과 버리기에 실패했습니다.";
    renderRoom();
    return;
  }

  state.flash = "";
}

function createAnimationSprite(player, piece, spotKey, stackSize) {
  const position = animationSpotPosition(spotKey);

  return {
    id: piece.id,
    serial: piece.serial,
    playerId: player.id,
    playerName: player.name,
    colorKey: player.colorKey,
    x: position.x,
    y: position.y,
    stackSize
  };
}

function buildMoveAnimation(room, option) {
  const movingPieceIds = new Set(option.pieceIds);
  const explicitCapturedPieceIds = new Set(option.capturedPieceIds || []);
  const movingPlayerId = option.playerId || room.me?.id || null;
  const capturedSprites = [];
  const movingSprites = [];

  room.players.forEach((player) => {
    player.pieces.forEach((piece) => {
      if (movingPieceIds.has(piece.id)) {
        movingSprites.push(createAnimationSprite(player, piece, option.startSpotKey, option.pieceIds.length));
        return;
      }

      if (explicitCapturedPieceIds.size) {
        if (explicitCapturedPieceIds.has(piece.id)) {
          capturedSprites.push(createAnimationSprite(player, piece, option.destinationSpotKey, 1));
        }
        return;
      }

      if (piece.spotKey === option.destinationSpotKey && (!movingPlayerId || player.id !== movingPlayerId)) {
        capturedSprites.push(createAnimationSprite(player, piece, option.destinationSpotKey, 1));
      }
    });
  });

  return {
    movingPieceIds: new Set(option.pieceIds),
    capturedPieceIds: new Set(capturedSprites.map((sprite) => sprite.id)),
    hiddenPieceIds: new Set(option.pieceIds),
    sprites: [...movingSprites, ...capturedSprites],
    movingSprites,
    capturedSprites
  };
}

function moveSpritesToSpot(sprites, spotKey) {
  const position = animationSpotPosition(spotKey);
  sprites.forEach((sprite) => {
    sprite.x = position.x;
    sprite.y = position.y;
  });
  renderBoardAnimationLayer();
}

async function playMoveAnimation(roomBefore, option, options = {}) {
  const { finalRoom = null, restoreChatFocus = false } = options;
  state.moveAnimation = buildMoveAnimation(roomBefore, option);
  renderBoardNodes();
  renderBoardAnimationLayer();
  renderSpotPicker();
  renderMoveOptions();

  for (const spotKey of optionPathSpots(option)) {
    moveSpritesToSpot(state.moveAnimation.movingSprites, spotKey);
    await wait(MOVE_STEP_MS);
  }

  if (state.moveAnimation.capturedSprites.length) {
    state.moveAnimation.hiddenPieceIds = new Set([
      ...state.moveAnimation.movingPieceIds,
      ...state.moveAnimation.capturedPieceIds
    ]);
    renderBoardNodes();
    moveSpritesToSpot(state.moveAnimation.capturedSprites, "start");
    await wait(MOVE_CAPTURE_MS);
  }

  await wait(MOVE_ANIMATION_SETTLE_MS);
  state.moveAnimation = null;
  renderBoardAnimationLayer();

  if (state.deferredRoomUpdate) {
    const deferredRoom = state.deferredRoomUpdate;
    state.deferredRoomUpdate = null;
    if (shouldAnimateIncomingMove(deferredRoom)) {
      await animateIncomingMove(deferredRoom);
      return;
    }

    applyRoomUpdate(deferredRoom);
    return;
  }

  if (finalRoom) {
    applyRoomUpdate(finalRoom, { restoreChatFocus });
    return;
  }

  renderRoom();
}

async function commitMoveOption(option) {
  if (!option || state.moveRequest || state.moveAnimation) {
    return;
  }

  const roomBefore = state.room;
  state.lastAnimatedMoveId = option.id;
  state.flash = "";
  state.deferredRoomUpdate = null;
  state.moveRequest = {
    optionId: option.id
  };
  resetMoveSelection();
  renderRollQueue();
  renderMoveOptions();
  renderBoardNodes();
  renderSpotPicker();

  const response = await emitWithAck("move:piece", {
    code: state.roomCode,
    optionId: option.id
  });

  if (!response?.ok) {
    state.moveRequest = null;
    state.deferredRoomUpdate = null;
    state.flash = response?.message || "말 이동에 실패했습니다";
    renderRoom();
    return;
  }

  state.moveRequest = null;
  await playMoveAnimation(roomBefore, option);
  state.flash = "";
}

function shouldAnimateIncomingMove(nextRoom) {
  if (!state.room || !nextRoom?.lastMove?.id) {
    return false;
  }

  if (nextRoom.lastMove.id === state.lastAnimatedMoveId) {
    return false;
  }

  return Boolean(nextRoom.lastMove.pathSpotKeys?.length && nextRoom.lastMove.pieceIds?.length);
}

async function animateIncomingMove(nextRoom, options = {}) {
  const move = nextRoom?.lastMove;
  if (!move || !state.room) {
    applyRoomUpdate(nextRoom, options);
    return;
  }

  state.lastAnimatedMoveId = move.id;
  await playMoveAnimation(state.room, move, {
    finalRoom: nextRoom,
    restoreChatFocus: options.restoreChatFocus
  });
}

async function movePiece(optionId) {
  const option = activeMoveOptions().find((candidate) => candidate.id === optionId);

  if (!option) {
    state.flash = "이동할 수 있는 선택지를 다시 골라주세요.";
    renderRoom();
    return;
  }

  await commitMoveOption(option);
  return;

  const response = await emitWithAck("move:piece", {
    code: state.roomCode,
    optionId
  });

  if (!response?.ok) {
    state.flash = response?.message || "말 이동에 실패했습니다";
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
    setChatStatus(response?.message || "채팅 전송에 실패했습니다");
    focusChatInput();
    return;
  }

  elements.chatInput.value = "";
  setChatStatus("");
  focusChatInput();
}

socket.on("room:update", (room) => {
  const shouldRestoreChatFocus = document.activeElement === elements.chatInput;

  if (state.chatIsComposing && shouldRestoreChatFocus) {
    state.pendingRoomUpdate = room;
    return;
  }

  if (state.moveRequest || state.moveAnimation) {
    state.deferredRoomUpdate = room;
    return;
  }

  state.pendingRoomUpdate = null;
  if (shouldAnimateIncomingMove(room)) {
    animateIncomingMove(room, { restoreChatFocus: shouldRestoreChatFocus });
    return;
  }
  applyRoomUpdate(room, { restoreChatFocus: shouldRestoreChatFocus });
});

socket.on("connect_error", () => {
  if (!state.room) {
    setEntryStatus("서버 연결에 실패했습니다. 새로고침 후 다시 시도해 주세요.");
  }
});

socket.on("disconnect", () => {
  if (!state.room) {
    setEntryStatus("서버와 연결이 끊겼습니다. 재연결 중입니다.");
  }
});

elements.createRoomButton.addEventListener("click", createRoom);
elements.joinRoomButton.addEventListener("click", joinRoom);
elements.leaveButton.addEventListener("click", leaveRoom);
elements.addBotButton.addEventListener("click", addBots);
elements.startButton.addEventListener("click", startGame);
elements.throwButton.addEventListener("click", throwSticks);
elements.discardRollButton.addEventListener("click", discardRoll);
elements.resetButton.addEventListener("click", resetGame);
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
    if (shouldAnimateIncomingMove(pending)) {
      animateIncomingMove(pending, { restoreChatFocus: true });
      return;
    }
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
  elements.roomInput.value = currentRoomInput();
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
    return "윷을 던지는 중입니다...";
  }

  if (room.phase === "lobby") {
    return room.hostId === room.me?.id
      ? "인원이 모두 모이면 시작할 수 있습니다."
      : "호스트가 게임을 시작할 때까지 기다려 주세요.";
  }

  if (room.phase === "result") {
    return room.hostId === room.me?.id ? "다시하기를 누르면 새 판이 시작됩니다." : "게임이 끝났습니다.";
  }

  if (room.canThrow) {
    return "윷을 던질 차례입니다.";
  }

  if (room.canDiscardActiveRoll) {
    if (state.selectedRollId && room.discardableRollIds?.includes(state.selectedRollId)) {
      return "선택한 결과는 쓸 수 없어 버릴 수 있습니다.";
    }

    return "쓸 수 없는 결과가 있어 버릴 수 있습니다.";
  }

  if (pendingRolls(room).length) {
    if (!state.selectedPieceId) {
      return "말을 눌러 이동 경우의 수를 확인하세요.";
    }

    if (!selectedPieceOptions(room).length) {
      return "이 말은 현재 결과를 사용할 수 없습니다.";
    }

    return "원하는 경우의 수를 골라 이동하세요.";
  }

  return "다음 차례를 기다리는 중입니다.";
}

function displayStatus() {
  if (state.flash) {
    return state.flash;
  }

  if (!state.room) {
    return "";
  }

  if (state.room.phase === "lobby") {
    return `${state.room.players.length}/${state.room.targetPlayerCount}명 참가`;
  }

  if (state.room.phase === "playing") {
    return `${currentPlayer()?.name || "플레이어"} 차례`;
  }

  if (state.room.phase === "result") {
    return state.room.result?.reason || "게임 종료";
  }

  return "-";
}

function displayBoardMeta() {
  if (!state.room) {
    return {
      title: "대기실",
      text: "방을 만들거나 입장해 주세요."
    };
  }

  if (state.room.phase === "lobby") {
    return {
      title: "대기실",
      text: `${state.room.players.length}/${state.room.targetPlayerCount}명이 모였습니다.`
    };
  }

  if (state.room.phase === "playing") {
    return {
      title: `${currentPlayer()?.name || "플레이어"} 차례`,
      text: ""
    };
  }

  return {
    title: state.room.result?.reason || "게임 종료",
    text: ""
  };
}

function renderHeader() {
  const room = state.room;
  elements.roomBadge.textContent = `방 ${room.code}`;
  elements.playerBadge.textContent = `${room.players.length}/${room.targetPlayerCount}명`;
  elements.phaseBadge.textContent = PHASE_TEXT[room.phase] || room.phase;
  elements.statusBadge.textContent = displayStatus();
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
    empty.textContent = "아직 채팅이 없습니다.";
    elements.chatLogList.appendChild(empty);
    state.lastChatLogMessageId = "";
    return;
  }

  const fragment = document.createDocumentFragment();

  [...messages].reverse().forEach((message) => {
    const item = document.createElement("article");
    item.className = "chat-log-item";
    if (message.kind === "system") {
      item.classList.add("is-system");
    } else if (message.playerId === state.room.me?.id) {
      item.classList.add("is-self");
    }

    const name = document.createElement("strong");
    name.className = "chat-log-name";
    name.textContent = message.kind === "system" ? "시스템" : message.name || "플레이어";

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

function renderSpotPicker() {
  elements.spotPicker.innerHTML = "";

  if (!state.spotPicker?.spotKey) {
    return;
  }

  const options = selectedMoveOptionsBySpot().get(state.spotPicker.spotKey) || [];
  if (!options.length) {
    return;
  }

  const position = SPOT_LAYOUT[state.spotPicker.spotKey];
  const panel = document.createElement("div");
  panel.className = "spot-picker-card";
  panel.style.left = `${position.x}%`;
  panel.style.top = `${position.y}%`;

  const title = document.createElement("p");
  title.className = "spot-picker-title";
  title.textContent = `${options[0].destinationLabel} 선택지`;
  panel.appendChild(title);

  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "spot-picker-option";
    button.addEventListener("click", () => {
      commitMoveOption(option);
    });

    const titleText = document.createElement("span");
    titleText.textContent = optionLabel(option);

    const metaText = document.createElement("span");
    const bits = optionMetaBits(option);
    metaText.className = "spot-picker-meta";
    metaText.textContent = bits.length ? bits.join(" / ") : "기본 이동";

    button.append(titleText, metaText);
    panel.appendChild(button);
  });

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "spot-picker-cancel";
  cancelButton.textContent = "닫기";
  cancelButton.addEventListener("click", () => {
    clearSpotPicker();
    renderSpotPicker();
    renderBoardNodes();
    renderMoveOptions();
  });
  panel.appendChild(cancelButton);

  elements.spotPicker.replaceChildren(panel);
}

function renderThrowStage() {
  if (!elements.throwArena) {
    return;
  }

  const room = state.room;
  const roll = displayedThrowRoll();
  const isThrowing = state.throwFx?.phase === "throwing";
  const sticks = isThrowing ? state.throwFx.layout || randomThrowLayout() : finalThrowLayout(roll?.kind || "do");
  const fragment = document.createDocumentFragment();

  sticks.forEach((stick, index) => {
    const node = document.createElement("div");
    node.className = "throw-stick";
    node.style.left = `${stick.x}%`;
    node.style.top = `${stick.y}%`;
    node.style.setProperty("--throw-rotate", `${stick.rotate}deg`);

    if (isThrowing) {
      node.classList.add("is-throwing");
      node.style.animationDelay = `${stick.delay || 0}ms`;
    } else {
      node.classList.add(stick.face === "front" ? "is-front" : "is-back");
    }

    const front = document.createElement("span");
    front.className = "throw-stick-face throw-stick-front";
    const back = document.createElement("span");
    back.className = "throw-stick-face throw-stick-back";
    if (roll?.kind === "backdo" && index === 0) {
      back.classList.add("is-special-backdo");
    }

    node.append(front, back);
    fragment.appendChild(node);
  });

  elements.throwArena.replaceChildren(fragment);
  elements.throwStage.classList.toggle("is-throwing", isThrowing);
  elements.throwResult.textContent = isThrowing ? "던지는 중" : roll?.label || "대기";
  elements.throwPrompt.textContent = throwPromptText(room);
}

function renderRollQueue() {
  if (!state.room) {
    elements.rollQueue.innerHTML = "";
    return;
  }

  elements.rollQueue.innerHTML = "";

  if (!state.room.pendingRolls.length) {
    const empty = document.createElement("p");
    empty.className = "move-options-empty";
    empty.textContent =
      state.room.phase === "playing" && state.room.canThrow ? "아직 나온 결과가 없습니다." : "쌓인 결과가 없습니다.";
    elements.rollQueue.appendChild(empty);
    return;
  }

  const selectableRollIds = new Set(selectedPieceRollIds(state.room));
  const discardableRollIds = new Set(state.room.discardableRollIds || []);
  const fragment = document.createDocumentFragment();

  state.room.pendingRolls.forEach((roll) => {
    const canUseSelectedPiece = state.selectedPieceId ? selectableRollIds.has(roll.id) : false;
    const canFocusForDiscard = discardableRollIds.has(roll.id);
    const canInteract = canFocusForDiscard;
    const isSelected = state.selectedRollId === roll.id;
    const card = document.createElement(canInteract ? "button" : "article");
    card.className = "roll-card";
    if (isSelected) {
      card.classList.add("is-armed");
    }
    if (canInteract) {
      card.type = "button";
      card.classList.add("is-selectable");
      card.addEventListener("click", () => {
        state.selectedRollId = isSelected ? "" : roll.id;
        clearSpotPicker();
        renderControls();
        renderThrowStage();
        renderRollQueue();
        renderMoveOptions();
        renderBoardNodes();
        renderSpotPicker();
      });
    }
    if (discardableRollIds.has(roll.id) && !canUseSelectedPiece) {
      card.classList.add("is-muted");
    }

    const name = document.createElement("p");
    name.className = "roll-name";
    name.textContent = roll.label || roll.kind;

    const meta = document.createElement("p");
    meta.className = "roll-meta";
    meta.textContent = !state.selectedPieceId
      ? rollDistanceLabel(roll)
      : canUseSelectedPiece
        ? `${rollDistanceLabel(roll)} 사용 가능`
        : discardableRollIds.has(roll.id)
          ? "버릴 수 있음"
          : "이 말은 사용 불가";

    card.append(name, meta);
    fragment.appendChild(card);
  });

  elements.rollQueue.appendChild(fragment);
}

function renderMoveOptions() {
  if (!state.room) {
    elements.moveOptions.innerHTML = "";
    return;
  }

  elements.moveOptions.innerHTML = "";

  if (state.room.phase !== "playing") {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = "게임이 시작되면 이동 선택지가 여기에 표시됩니다.";
    elements.moveOptions.appendChild(text);
    return;
  }

  if (state.room.canThrow) {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = "먼저 윷을 던지세요.";
    elements.moveOptions.appendChild(text);
    return;
  }

  if (state.room.canDiscardActiveRoll) {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = "움직일 수 있는 말이 없습니다. 결과를 버릴 수 있습니다.";
    elements.moveOptions.appendChild(text);
    return;
  }

  if (!state.room.moveOptions.length) {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = "다른 플레이어가 결과를 처리하는 중입니다.";
    elements.moveOptions.appendChild(text);
    return;
  }

  if (state.moveRequest || state.moveAnimation) {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = "말이 움직이는 중입니다.";
    elements.moveOptions.appendChild(text);
    return;
  }

  if (!isTargetingActive(state.room)) {
    const text = document.createElement("p");
    text.className = "move-options-empty";
    text.textContent = state.selectedPieceId
      ? "이 말은 현재 결과를 사용할 수 없습니다. 다른 말을 골라 주세요."
      : "말을 눌러 가능한 모든 경우의 수를 확인하세요.";
    elements.moveOptions.appendChild(text);
    return;
  }

  const visibleOptions = state.spotPicker?.spotKey
    ? selectedMoveOptionsBySpot(state.room).get(state.spotPicker.spotKey) || []
    : selectedPieceOptions(state.room);

  if (state.spotPicker?.spotKey) {
    const guide = document.createElement("p");
    guide.className = "move-options-empty";
    guide.textContent =
      visibleOptions.length > 1
        ? `${visibleOptions[0]?.destinationLabel || "해당 칸"}으로 가는 경우의 수입니다.`
        : "이 경우의 수로 바로 이동할 수 있습니다.";
    elements.moveOptions.appendChild(guide);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "move-option";
    cancel.addEventListener("click", () => {
      clearSpotPicker();
      renderBoardNodes();
      renderSpotPicker();
      renderMoveOptions();
    });

    const cancelTitle = document.createElement("p");
    cancelTitle.className = "move-option-title";
    cancelTitle.textContent = "전체 경우의 수 보기";

    const cancelMeta = document.createElement("p");
    cancelMeta.className = "move-option-meta";
    cancelMeta.textContent = "선택한 말의 모든 이동 경우의 수로 돌아갑니다.";

    cancel.append(cancelTitle, cancelMeta);
    elements.moveOptions.appendChild(cancel);
  } else {
    const guide = document.createElement("p");
    guide.className = "move-options-empty";
    guide.textContent = "아래 경우의 수에서 원하는 이동을 고르세요.";
    elements.moveOptions.appendChild(guide);
  }

  visibleOptions.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "move-option";
    if (state.spotPicker?.spotKey && state.spotPicker.spotKey === option.destinationSpotKey) {
      button.classList.add("is-focused");
    }
    button.addEventListener("click", () => {
      commitMoveOption(option);
    });

    const title = document.createElement("p");
    title.className = "move-option-title";
    title.textContent = `${option.rollLabel} -> ${option.destinationLabel}`;

    const meta = document.createElement("p");
    meta.className = "move-option-meta";
    const bits = [option.rollSteps < 0 ? "뒤로 1칸" : `${option.rollSteps}칸 이동`];
    if (option.pieceCount > 1) {
      bits.push(`업은 말 ${option.pieceCount}개`);
    }
    optionMetaBits(option).forEach((bit) => bits.push(bit));
    meta.textContent = bits.join(" / ");

    button.append(title, meta);
    elements.moveOptions.appendChild(button);
  });
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

    const top = document.createElement("div");
    top.className = "player-row-top";

    const name = document.createElement("p");
    name.className = "player-row-name";
    name.textContent = player.name;

    const chip = document.createElement("span");
    chip.className = "seat-chip";
    chip.textContent = player.isBot ? "봇" : playerColorLabel(player);
    if (player.isCurrent) {
      chip.classList.add("is-current");
      chip.textContent = "차례";
    }

    top.append(name, chip);

    const meta = document.createElement("p");
    meta.className = "player-row-meta";
    meta.textContent = `대기 ${player.waitingCount} · 판 위 ${player.onBoardCount} · 완주 ${player.finishedCount}${player.connected ? "" : " · 오프라인"}`;

    row.append(top, meta);
    fragment.appendChild(row);
  });

  elements.playerList.replaceChildren(fragment);
}

function renderRoom() {
  renderScreens();

  if (!state.room) {
    elements.boardAnimationLayer.innerHTML = "";
    elements.spotPicker.innerHTML = "";
    elements.rollQueue.innerHTML = "";
    renderThrowStage();
    return;
  }

  syncMoveSelection(state.room);
  const boardMeta = displayBoardMeta();
  renderHeader();
  renderControls();
  elements.boardMetaTitle.textContent = boardMeta.title;
  elements.boardMetaText.textContent = boardMeta.text;
  renderRecentAction();
  renderThrowStage();
  renderChatLog();
  renderRollQueue();
  renderMoveOptions();
  renderPlayerList();
  renderBoardNodes();
  renderBoardAnimationLayer();
  renderSpotPicker();
  renderSeatLayer();
  renderSeatChatComposer();
  scheduleBubbleRefresh(state.room);
}

function displayStatus() {
  if (!state.room || state.room.phase !== "playing") {
    return "";
  }

  return `${currentPlayer(state.room)?.name || "플레이어"} 차례`;
}

function displayBoardMeta() {
  if (!state.room || state.room.phase !== "playing") {
    return {
      title: "",
      text: ""
    };
  }

  return {
    title: `${currentPlayer(state.room)?.name || "플레이어"} 차례`,
    text: ""
  };
}

function renderMoveOptions() {
  if (!state.room) {
    elements.moveOptions.innerHTML = "";
    return;
  }

  elements.moveOptions.innerHTML = "";

  if (
    state.room.phase !== "playing" ||
    state.room.canThrow ||
    state.room.canDiscardActiveRoll ||
    !state.room.moveOptions.length ||
    state.moveRequest ||
    state.moveAnimation ||
    !isTargetingActive(state.room)
  ) {
    return;
  }

  const visibleOptions = state.spotPicker?.spotKey
    ? selectedMoveOptionsBySpot(state.room).get(state.spotPicker.spotKey) || []
    : selectedPieceOptions(state.room);

  if (state.spotPicker?.spotKey) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "move-option";
    cancel.addEventListener("click", () => {
      clearSpotPicker();
      renderBoardNodes();
      renderSpotPicker();
      renderMoveOptions();
    });

    const cancelTitle = document.createElement("p");
    cancelTitle.className = "move-option-title";
    cancelTitle.textContent = "전체 보기";

    cancel.append(cancelTitle);
    elements.moveOptions.appendChild(cancel);
  }

  visibleOptions.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "move-option";
    if (state.spotPicker?.spotKey && state.spotPicker.spotKey === option.destinationSpotKey) {
      button.classList.add("is-focused");
    }
    button.addEventListener("click", () => {
      commitMoveOption(option);
    });

    const title = document.createElement("p");
    title.className = "move-option-title";
    title.textContent = `${option.rollLabel} -> ${option.destinationLabel}`;

    const meta = document.createElement("p");
    meta.className = "move-option-meta";
    const bits = [option.rollSteps < 0 ? "뒤로 1칸" : `${option.rollSteps}칸 이동`];
    if (option.pieceCount > 1) {
      bits.push(`업은 말 ${option.pieceCount}개`);
    }
    optionMetaBits(option).forEach((bit) => bits.push(bit));
    meta.textContent = bits.join(" / ");

    button.append(title, meta);
    elements.moveOptions.appendChild(button);
  });
}

function createBubble(message) {
  if (!message) {
    return null;
  }

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = message.text.length > 36 ? `${message.text.slice(0, 36)}…` : message.text;
  return bubble;
}

function renderSeatLayer() {
  if (!state.room) {
    elements.seatLayer.innerHTML = "";
    return;
  }

  const layout = SEAT_LAYOUTS[state.room.players.length] || SEAT_LAYOUTS[4];
  const bubbles = currentChatBubbles(state.room);
  const fragment = document.createDocumentFragment();

  state.room.players.forEach((player, index) => {
    const position = layout[index] || layout[layout.length - 1];
    const seat = document.createElement("section");
    seat.className = "player-seat";
    seat.style.left = `${position.x}%`;
    seat.style.top = `${position.y}%`;
    seat.classList.add(position.side === "right" ? "is-right" : "is-left");

    if (player.isCurrent) {
      seat.classList.add("is-current");
    }

    if (player.id === state.room.me?.id) {
      seat.classList.add("is-me");
    }

    const bubble = createBubble(bubbles.get(player.id));
    if (bubble) {
      seat.appendChild(bubble);
    }

    const card = document.createElement("div");
    card.className = "seat-card";

    const topLine = document.createElement("div");
    topLine.className = "seat-topline";

    const name = document.createElement("strong");
    name.className = "seat-name";
    name.textContent = player.name;

    const roleChip = document.createElement("span");
    roleChip.className = "seat-chip";
    if (player.isBot) {
      roleChip.textContent = "봇";
    } else if (player.id === state.room.me?.id) {
      roleChip.textContent = "나";
    } else {
      roleChip.textContent = playerColorLabel(player);
    }
    topLine.append(name, roleChip);

    const stats = document.createElement("div");
    stats.className = "seat-stats";

    const turnChip = document.createElement("span");
    turnChip.className = "seat-chip";
    if (player.isCurrent) {
      turnChip.classList.add("is-current");
      turnChip.textContent = "차례";
    } else if (!player.connected) {
      turnChip.classList.add("is-offline");
      turnChip.textContent = "오프라인";
    } else {
      turnChip.textContent = "대기";
    }

    const stat = document.createElement("span");
    stat.className = "seat-stat";
    stat.textContent = `판 ${player.onBoardCount} · 완주 ${player.finishedCount}`;
    stats.append(turnChip, stat);

    card.append(topLine, stats);

    if (player.id === state.room.me?.id) {
      card.appendChild(elements.seatChatComposer);
    }

    seat.appendChild(card);
    fragment.appendChild(seat);
  });

  elements.seatLayer.replaceChildren(fragment);
}

function renderSeatLayer() {
  const chatShell = elements.chatLogList?.parentElement;
  if (chatShell && elements.seatChatComposer.parentElement !== chatShell) {
    chatShell.appendChild(elements.seatChatComposer);
  }

  elements.seatLayer.innerHTML = "";
}

function hashThrowSeed(text = "") {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function throwSeedUnit(seed, index, salt = 0) {
  const value = Math.sin(seed * 0.00021 + index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function throwSeedRange(seed, index, salt, min, max) {
  return min + throwSeedUnit(seed, index, salt) * (max - min);
}

function randomThrowLayout() {
  const seed = hashThrowSeed(`${Date.now()}:${Math.random()}`);
  const anchors = [
    { x: 39, y: 64, rotate: -18 },
    { x: 47, y: 46, rotate: 10 },
    { x: 57, y: 62, rotate: 22 },
    { x: 66, y: 47, rotate: -8 }
  ];

  return anchors.map((anchor, index) => {
    const x = anchor.x + throwSeedRange(seed, index, 1, -2.6, 2.6);
    const y = anchor.y + throwSeedRange(seed, index, 2, -3.2, 3.2);
    const rotate = anchor.rotate + throwSeedRange(seed, index, 3, -7, 7);
    const releaseX = 53 + throwSeedRange(seed, index, 4, -3.5, 3.5);
    const releaseY = 88 + throwSeedRange(seed, index, 5, -1.5, 2.5);
    const fromX = (releaseX - x) * 3.1;
    const fromY = (releaseY - y) * 2.55;

    return {
      x,
      y,
      rotate,
      fromX,
      fromY,
      apexX: fromX * 0.32 + throwSeedRange(seed, index, 6, -12, 12),
      apexY: -throwSeedRange(seed, index, 7, 34, 56),
      bounceX: throwSeedRange(seed, index, 8, -7, 7),
      bounceY: throwSeedRange(seed, index, 9, 5, 12),
      fromRotate: rotate + throwSeedRange(seed, index, 10, -110, 110),
      apexRotate: rotate + throwSeedRange(seed, index, 11, -185, 185),
      bounceRotate: rotate + throwSeedRange(seed, index, 12, -16, 16),
      delay: Math.round(index * 22 + throwSeedRange(seed, index, 13, 0, 20)),
      duration: Math.round(700 + throwSeedRange(seed, index, 14, 0, 80))
    };
  });
}

function finalThrowLayout(kind, rollId = "") {
  const pattern = THROW_PATTERNS[kind] || THROW_PATTERNS.do;
  const seed = hashThrowSeed(`${kind}:${rollId || "preview"}`);
  const anchors = [
    { x: 39, y: 64, rotate: -16 },
    { x: 47, y: 46, rotate: 10 },
    { x: 57, y: 62, rotate: 22 },
    { x: 66, y: 47, rotate: -8 }
  ];

  return pattern.map((face, index) => ({
    face,
    x: anchors[index].x + throwSeedRange(seed, index, 1, -2.2, 2.2),
    y: anchors[index].y + throwSeedRange(seed, index, 2, -2.8, 2.8),
    rotate: anchors[index].rotate + throwSeedRange(seed, index, 3, -6, 6)
  }));
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
      ? "다시하기로 새 판을 열 수 있습니다."
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

  return "";
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
