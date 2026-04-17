module.exports = function attachYutGame(rootIo) {
  const io = rootIo.of("/yut");
  const { createRoomStore, normalizeRoomCode, snapshotRoom } = require("./room-store");
  const {
    bindPlayerSocket,
    cancelDisconnect,
    createPresenceState,
    getDisconnectGraceMs,
    getSocketPlayerId,
    isPlayerConnected,
    registerSessionNamespace,
    restoreRoomPresence,
    schedulePlayerDisconnect
  } = require("./stability");

  const ROOM_CODE_LENGTH = 5;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 5;
  const DEFAULT_TARGET_PLAYER_COUNT = 2;
  const TARGET_PLAYER_OPTIONS = [2, 3, 4, 5];
  const MAX_CHAT_LENGTH = 140;
  const PIECES_PER_PLAYER = 4;
  const MAX_MESSAGES = 80;
  const BOT_DELAY_MIN_MS = 800;
  const BOT_DELAY_MAX_MS = 1600;
  const PLAYER_COLORS = [
    { key: "terracotta", label: "Terracotta" },
    { key: "jade", label: "Jade" },
    { key: "navy", label: "Navy" },
    { key: "gold", label: "Gold" },
    { key: "plum", label: "Plum" }
  ];
  const ROLL_RESULTS = [
    { kind: "backdo", label: "빽도", steps: -1, bonus: false, weight: 1 },
    { kind: "do", label: "도", steps: 1, bonus: false, weight: 4 },
    { kind: "gae", label: "개", steps: 2, bonus: false, weight: 6 },
    { kind: "geol", label: "걸", steps: 3, bonus: false, weight: 4 },
    { kind: "yut", label: "윷", steps: 4, bonus: true, weight: 2 },
    { kind: "mo", label: "모", steps: 5, bonus: true, weight: 1 }
  ];

  const BOARD_GRAPH = {
    start: { next: ["o1"], spotKey: "start", progress: 0 },
    o1: { next: ["o2"], spotKey: "o1", progress: 1 },
    o2: { next: ["o3"], spotKey: "o2", progress: 2 },
    o3: { next: ["o4"], spotKey: "o3", progress: 3 },
    o4: { next: ["o5"], spotKey: "o4", progress: 4 },
    o5: { next: ["o6", "a1"], spotKey: "o5", progress: 5 },
    o6: { next: ["o7"], spotKey: "o6", progress: 6 },
    o7: { next: ["o8"], spotKey: "o7", progress: 7 },
    o8: { next: ["o9"], spotKey: "o8", progress: 8 },
    o9: { next: ["o10"], spotKey: "o9", progress: 9 },
    o10: { next: ["o11", "b1"], spotKey: "o10", progress: 10 },
    o11: { next: ["o12"], spotKey: "o11", progress: 11 },
    o12: { next: ["o13"], spotKey: "o12", progress: 12 },
    o13: { next: ["o14"], spotKey: "o13", progress: 13 },
    o14: { next: ["o15"], spotKey: "o14", progress: 14 },
    o15: { next: ["o16"], spotKey: "o15", progress: 15 },
    o16: { next: ["o17"], spotKey: "o16", progress: 16 },
    o17: { next: ["o18"], spotKey: "o17", progress: 17 },
    o18: { next: ["o19"], spotKey: "o18", progress: 18 },
    o19: { next: ["o20"], spotKey: "o19", progress: 19 },
    o20: { next: ["finish"], spotKey: "o20", progress: 20 },
    a1: { next: ["a2"], spotKey: "a1", progress: 7 },
    a2: { next: ["aCenter"], spotKey: "a2", progress: 9 },
    aCenter: { next: ["a3", "b2"], spotKey: "center", progress: 11 },
    a3: { next: ["a4"], spotKey: "a3", progress: 13 },
    a4: { next: ["o15"], spotKey: "a4", progress: 14 },
    b1: { next: ["bPre2"], spotKey: "b1", progress: 13 },
    bPre2: { next: ["bCenter"], spotKey: "b2", progress: 15 },
    bCenter: { next: ["b2", "a3"], spotKey: "center", progress: 17 },
    b2: { next: ["bPost2"], spotKey: "b3", progress: 18 },
    bPost2: { next: ["o20"], spotKey: "b4", progress: 19 },
    finish: { next: [], spotKey: "finish", progress: 21 }
  };

  const rooms = new Map();
  const disconnectTimers = new Map();
  const DISCONNECT_GRACE_MS = getDisconnectGraceMs();
  const roomStore = createRoomStore({
    gameKey: "yut",
    serializeRoom: (room) => snapshotRoom(room, { botTimer: null })
  });
  registerSessionNamespace(io);

  function sanitizeName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 16);
  }

  function sanitizeChatText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CHAT_LENGTH);
  }

  function sanitizeSettings(input = {}) {
    const targetPlayerCount = Number.parseInt(input.targetPlayerCount, 10);
    return {
      targetPlayerCount: TARGET_PLAYER_OPTIONS.includes(targetPlayerCount)
        ? targetPlayerCount
        : DEFAULT_TARGET_PLAYER_COUNT
    };
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomItem(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function shuffle(list) {
    const clone = [...list];
    for (let index = clone.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
    }
    return clone;
  }

  function generateRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";

    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () =>
        alphabet[Math.floor(Math.random() * alphabet.length)]
      ).join("");
    } while (rooms.has(code));

    return code;
  }

  function createPiece(playerId, serial) {
    return {
      id: `${playerId}:piece:${serial}`,
      serial,
      nodeId: "start",
      history: ["start"]
    };
  }

  function createPlayer(id, name, isBot = false, socketId = null) {
    return {
      id,
      name: sanitizeName(name),
      isBot,
      pieces: Array.from({ length: PIECES_PER_PLAYER }, (_unused, index) => createPiece(id, index + 1)),
      colorKey: null,
      ...createPresenceState(isBot ? null : socketId)
    };
  }

  function createRoom(code, hostId, hostSocketId, hostName, options = {}) {
    const settings = sanitizeSettings(options);
    const room = {
      code,
      hostId,
      phase: "lobby",
      targetPlayerCount: settings.targetPlayerCount,
      players: [createPlayer(hostId, hostName, false, hostSocketId)],
      turnOrder: [],
      currentPlayerId: null,
      throwCountRemaining: 0,
      pendingRolls: [],
      recentAction: null,
      lastMove: null,
      result: null,
      messages: [],
      turnNumber: 0,
      botTimer: null
    };

    assignPlayerColors(room);
    rooms.set(code, room);
    return room;
  }

  function getRoom(code) {
    return rooms.get(String(code || "").toUpperCase()) || null;
  }

  function hydrateRoom(snapshot) {
    const room = {
      ...snapshot,
      code: normalizeRoomCode(snapshot.code),
      botTimer: null
    };

    room.players = (snapshot.players || []).map((player) => ({
      ...createPresenceState(),
      ...player,
      pieces: (player.pieces || []).map((piece, index) => ({
        id: piece.id || `${player.id}:piece:${index + 1}`,
        serial: piece.serial || index + 1,
        nodeId: piece.nodeId || "start",
        history: Array.isArray(piece.history) && piece.history.length ? piece.history : ["start"]
      }))
    }));
    room.turnOrder = Array.isArray(snapshot.turnOrder) ? snapshot.turnOrder : [];
    room.pendingRolls = Array.isArray(snapshot.pendingRolls) ? snapshot.pendingRolls : [];
    room.messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    room.recentAction = snapshot.recentAction || null;
    room.lastMove = snapshot.lastMove || null;
    room.result = snapshot.result || null;
    room.turnNumber = Number.isInteger(snapshot.turnNumber) ? snapshot.turnNumber : 0;
    assignPlayerColors(room);
    return room;
  }

  function persistRoomState(room) {
    roomStore.save(room);
  }

  function deletePersistedRoom(code) {
    roomStore.remove(code);
  }

  function assignPlayerColors(room) {
    room.players.forEach((player, index) => {
      player.colorKey = PLAYER_COLORS[index % PLAYER_COLORS.length].key;
    });
  }

  function getPlayer(room, playerId) {
    return room.players.find((player) => player.id === playerId || player.socketId === playerId) || null;
  }

  function getNode(nodeId) {
    return BOARD_GRAPH[nodeId] || BOARD_GRAPH.start;
  }

  function getSpotKey(nodeId) {
    if (nodeId === "start" || nodeId === "finish") {
      return nodeId;
    }

    return getNode(nodeId).spotKey || nodeId;
  }

  function getProgress(nodeId) {
    if (nodeId === "finish") {
      return BOARD_GRAPH.finish.progress;
    }

    return getNode(nodeId).progress || 0;
  }

  function getSpotLabel(spotKey) {
    if (spotKey === "start") {
      return "출발";
    }
    if (spotKey === "finish") {
      return "도착";
    }
    if (spotKey === "center") {
      return "중앙";
    }
    if (/^[ab][1-4]$/.test(spotKey)) {
      return "지름길";
    }

    return spotKey.replace(/^o/, "");
  }

  function clearBotTimer(room) {
    if (!room?.botTimer) {
      return;
    }

    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  function setRecentAction(room, text, tone = "neutral") {
    room.recentAction = {
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      text,
      tone,
      createdAt: Date.now()
    };
  }

  function appendMessage(room, message) {
    room.messages.push(message);

    if (room.messages.length > MAX_MESSAGES) {
      room.messages.shift();
    }

    return room.messages[room.messages.length - 1];
  }

  function normalizeSystemMessageText(text) {
    if (typeof text !== "string") {
      return text;
    }

    const match = text.match(/^(.*?님이)\s+.*?까지 이동했습니다(?:\s*[·ㆍ]\s*잡기\s+(\d+))?(?:\s*[·ㆍ]\s*도착\s+(\d+))?$/);
    if (!match) {
      return text;
    }

    const [, actor, captureCount, finishCount] = match;
    const extras = [];

    if (captureCount) {
      extras.push(`잡기 ${captureCount}`);
    }
    if (finishCount) {
      extras.push(`도착 ${finishCount}`);
    }

    return `${actor} 말을 이동했습니다${extras.length ? ` · ${extras.join(" · ")}` : ""}`;
  }

  function pushMessage(room, player, text) {
    const cleanText = sanitizeChatText(text);
    if (!cleanText) {
      return null;
    }

    return appendMessage(room, {
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      kind: "chat",
      playerId: player.id,
      name: player.name,
      text: cleanText,
      createdAt: Date.now()
    });
  }

  function pushSystemMessage(room, text, tone = "neutral") {
    const cleanText = sanitizeChatText(normalizeSystemMessageText(text));
    if (!cleanText) {
      return null;
    }

    return appendMessage(room, {
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      kind: "system",
      name: "시스템",
      text: cleanText,
      tone,
      createdAt: Date.now()
    });
  }

  function resetPieces(player) {
    player.pieces = Array.from({ length: PIECES_PER_PLAYER }, (_unused, index) => createPiece(player.id, index + 1));
  }

  function resetGame(room) {
    clearBotTimer(room);
    room.phase = "lobby";
    room.turnOrder = [];
    room.currentPlayerId = null;
    room.throwCountRemaining = 0;
    room.pendingRolls = [];
    room.result = null;
    room.recentAction = null;
    room.lastMove = null;
    room.turnNumber = 0;
    room.players.forEach((player) => {
      resetPieces(player);
    });
  }

  function finishedCount(player) {
    return player.pieces.filter((piece) => piece.nodeId === "finish").length;
  }

  function unfinishedPlayers(room) {
    return room.players.filter((player) => finishedCount(player) < PIECES_PER_PLAYER);
  }

  function isOpeningDoBackdoWrap(piece) {
    return (
      piece.nodeId === "o1" &&
      Array.isArray(piece.history) &&
      piece.history.length === 2 &&
      piece.history[0] === "start" &&
      piece.history[1] === "o1"
    );
  }

  function backdoDestinationNode(piece) {
    if (isOpeningDoBackdoWrap(piece)) {
      return "o20";
    }

    return piece.history[piece.history.length - 2] || "start";
  }

  function buildBackdoHistory(piece, destinationNodeId) {
    if (destinationNodeId === "o20" && isOpeningDoBackdoWrap(piece)) {
      return [
        "start",
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
        "o20"
      ];
    }

    const history = piece.history.slice(0, -1);
    return history.length ? history : ["start"];
  }

  function waitingCount(player) {
    return player.pieces.filter((piece) => piece.nodeId === "start").length;
  }

  function onBoardCount(player) {
    return player.pieces.filter((piece) => piece.nodeId !== "start" && piece.nodeId !== "finish").length;
  }

  function activeRoll(room) {
    return room.pendingRolls[0] || null;
  }

  function createRoll() {
    const totalWeight = ROLL_RESULTS.reduce((sum, result) => sum + result.weight, 0);
    let threshold = Math.floor(Math.random() * totalWeight);
    let selected = ROLL_RESULTS[0];

    for (const result of ROLL_RESULTS) {
      threshold -= result.weight;
      if (threshold < 0) {
        selected = result;
        break;
      }
    }

    return {
      id: `roll:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      kind: selected.kind,
      label: selected.label,
      steps: selected.steps,
      bonus: selected.bonus
    };
  }

  function serializeRoll(roll) {
    return {
      id: roll.id,
      kind: roll.kind,
      label: roll.label,
      steps: roll.steps,
      bonus: Boolean(roll.bonus)
    };
  }

  function isShortcutEntryNode(nodeId) {
    return nodeId === "o5" || nodeId === "o10" || nodeId === "aCenter" || nodeId === "bCenter";
  }

  function walkForward(nodeId, steps, firstHop = null, allowShortcutEntry = true) {
    if (steps <= 0) {
      return [
        {
          destinationNodeId: nodeId,
          pathNodes: [],
          routeHint: firstHop
        }
      ];
    }

    const node = getNode(nodeId);
    const canBranchHere = allowShortcutEntry && isShortcutEntryNode(nodeId);
    const nextNodes =
      node.next?.length
        ? canBranchHere || node.next.length === 1
          ? node.next
          : [node.next[0]]
        : ["finish"];
    const results = [];

    nextNodes.forEach((nextNodeId) => {
      const nextFirstHop =
        firstHop ||
        (nodeId === "o5" && nextNodeId === "a1"
          ? "shortcut"
          : nodeId === "o10" && nextNodeId === "b1"
            ? "shortcut"
            : nodeId === "aCenter" || nodeId === "bCenter"
              ? "shortcut"
            : nodeId === "o5" || nodeId === "o10"
              ? "outer"
              : null);

      if (nextNodeId === "finish") {
        results.push({
          destinationNodeId: "finish",
          pathNodes: ["finish"],
          routeHint: nextFirstHop
        });
        return;
      }

      if (steps === 1) {
        results.push({
          destinationNodeId: nextNodeId,
          pathNodes: [nextNodeId],
          routeHint: nextFirstHop
        });
        return;
      }

      walkForward(nextNodeId, steps - 1, nextFirstHop, false).forEach((result) => {
        results.push({
          destinationNodeId: result.destinationNodeId,
          pathNodes: [nextNodeId, ...result.pathNodes],
          routeHint: result.routeHint
        });
      });
    });

    return results;
  }

  function currentStackPieces(player, piece) {
    const spotKey = getSpotKey(piece.nodeId);

    if (spotKey === "start" || spotKey === "finish") {
      return [piece];
    }

    return player.pieces.filter((candidate) => getSpotKey(candidate.nodeId) === spotKey);
  }

  function distinctMovableEntries(player) {
    const entries = [];
    const seen = new Set();

    player.pieces.forEach((piece) => {
      if (piece.nodeId === "finish") {
        return;
      }

      const spotKey = getSpotKey(piece.nodeId);
      if (spotKey === "start") {
        return;
      }

      if (seen.has(spotKey)) {
        return;
      }

      seen.add(spotKey);
      entries.push({
        anchor: piece,
        pieces: currentStackPieces(player, piece)
      });
    });

    player.pieces
      .filter((piece) => piece.nodeId === "start")
      .forEach((waitingPiece) => {
        entries.push({
          anchor: waitingPiece,
          pieces: [waitingPiece],
          isWaiting: true
        });
      });

    return entries;
  }

  function getCapturedPieces(room, playerId, destinationSpotKey) {
    if (destinationSpotKey === "start" || destinationSpotKey === "finish") {
      return [];
    }

    const captured = [];
    room.players.forEach((player) => {
      if (player.id === playerId) {
        return;
      }

      player.pieces.forEach((piece) => {
        if (getSpotKey(piece.nodeId) === destinationSpotKey) {
          captured.push({
            playerId: player.id,
            name: player.name,
            pieceId: piece.id
          });
        }
      });
    });

    return captured;
  }

  function alliedMergeCount(player, destinationSpotKey, movingPieceIds) {
    if (destinationSpotKey === "start" || destinationSpotKey === "finish") {
      return 0;
    }

    return player.pieces.filter(
      (piece) =>
        !movingPieceIds.includes(piece.id) &&
        piece.nodeId !== "finish" &&
        piece.nodeId !== "start" &&
        getSpotKey(piece.nodeId) === destinationSpotKey
    ).length;
  }

  function legalMoveOptions(room, player, roll) {
    if (!roll) {
      return [];
    }

    const entries = distinctMovableEntries(player);
    const options = [];

    entries.forEach((entry) => {
      if (roll.steps < 0) {
        if (entry.isWaiting) {
          return;
        }

        const previousNodeId = backdoDestinationNode(entry.anchor);
        const destinationSpotKey = getSpotKey(previousNodeId);
        const movingPieceIds = entry.pieces.map((piece) => piece.id);
        options.push({
          id: `${roll.id}:${entry.anchor.id}:backdo:${previousNodeId}`,
          rollId: roll.id,
          rollKind: roll.kind,
          rollLabel: roll.label,
          rollSteps: roll.steps,
          pieceId: entry.anchor.id,
          pieceIds: movingPieceIds,
          pieceSerial: entry.anchor.serial,
          pieceCount: entry.pieces.length,
          startNodeId: entry.anchor.nodeId,
          startSpotKey: getSpotKey(entry.anchor.nodeId),
          destinationNodeId: previousNodeId,
          destinationSpotKey,
          destinationLabel: getSpotLabel(destinationSpotKey),
          routeHint: "backdo",
          reachesFinish: false,
          captures: getCapturedPieces(room, player.id, destinationSpotKey),
          mergeCount: alliedMergeCount(player, destinationSpotKey, movingPieceIds)
        });
        return;
      }

      walkForward(entry.anchor.nodeId, roll.steps).forEach((pathResult) => {
        const destinationSpotKey = getSpotKey(pathResult.destinationNodeId);
        const movingPieceIds = entry.pieces.map((piece) => piece.id);
        options.push({
          id: `${roll.id}:${entry.anchor.id}:${pathResult.destinationNodeId}:${pathResult.routeHint || "main"}`,
          rollId: roll.id,
          rollKind: roll.kind,
          rollLabel: roll.label,
          rollSteps: roll.steps,
          pieceId: entry.anchor.id,
          pieceIds: movingPieceIds,
          pieceSerial: entry.anchor.serial,
          pieceCount: entry.pieces.length,
          startNodeId: entry.anchor.nodeId,
          startSpotKey: getSpotKey(entry.anchor.nodeId),
          destinationNodeId: pathResult.destinationNodeId,
          destinationSpotKey,
          destinationLabel: getSpotLabel(destinationSpotKey),
          pathNodes: pathResult.pathNodes,
          routeHint: pathResult.routeHint || null,
          reachesFinish: pathResult.destinationNodeId === "finish",
          captures: getCapturedPieces(room, player.id, destinationSpotKey),
          mergeCount: alliedMergeCount(player, destinationSpotKey, movingPieceIds)
        });
      });
    });

    const deduped = new Map();
    options.forEach((option) => {
      const key = `${option.pieceIds.slice().sort().join(",")}:${option.destinationNodeId}:${option.routeHint || ""}`;
      if (!deduped.has(key)) {
        deduped.set(key, option);
      }
    });

    return [...deduped.values()];
  }

  function allLegalMoveOptions(room, player) {
    if (!room || !player || room.throwCountRemaining > 0) {
      return [];
    }

    return room.pendingRolls.flatMap((roll) => legalMoveOptions(room, player, roll));
  }

  function findMoveOption(room, player, optionId) {
    return allLegalMoveOptions(room, player).find((option) => option.id === optionId) || null;
  }

  function finishGame(room, result = {}) {
    clearBotTimer(room);
    room.phase = "result";
    room.result = {
      winnerId: result.winnerId || null,
      loserId: result.loserId || null,
      reason: result.reason || "게임 종료"
    };
    room.currentPlayerId = null;
    room.throwCountRemaining = 0;
    room.pendingRolls = [];
    setRecentAction(room, room.result.reason, result.winnerId ? "success" : "neutral");
  }

  function nextPlayerId(room, fromPlayerId = room.currentPlayerId) {
    const orderedIds = room.turnOrder.filter((playerId) =>
      room.players.some((player) => player.id === playerId && finishedCount(player) < PIECES_PER_PLAYER)
    );

    if (!orderedIds.length) {
      return null;
    }

    const currentIndex = orderedIds.indexOf(fromPlayerId);
    if (currentIndex === -1) {
      return orderedIds[0];
    }

    return orderedIds[(currentIndex + 1) % orderedIds.length];
  }

  function startTurn(room, playerId) {
    room.currentPlayerId = playerId;
    room.throwCountRemaining = 1;
    room.pendingRolls = [];
    room.turnNumber += 1;
    const currentPlayer = getPlayer(room, playerId);
    setRecentAction(room, `${currentPlayer?.name || "플레이어"} 차례입니다. 윷을 던지세요.`, "neutral");
  }

  function advanceTurn(room) {
    const playerId = nextPlayerId(room);
    if (!playerId) {
      finishGame(room, null, "플레이어가 부족해 게임이 종료되었습니다");
      return;
    }

    startTurn(room, playerId);
  }

  function advanceTurn(room) {
    const playerId = nextPlayerId(room);
    if (!playerId) {
      finishGame(room, { reason: "플레이어가 부족해 게임이 종료되었습니다" });
      return;
    }

    startTurn(room, playerId);
  }

  function startGame(room) {
    clearBotTimer(room);
    room.phase = "playing";
    room.result = null;
    room.players.forEach((player) => {
      resetPieces(player);
    });
    room.turnOrder = shuffle(room.players.map((player) => player.id));
    room.turnNumber = 0;
    startTurn(room, room.turnOrder[0]);
    pushSystemMessage(room, `게임이 시작되었습니다. 첫 차례는 ${getPlayer(room, room.turnOrder[0])?.name || "플레이어"}입니다.`);
  }

  function applyMove(room, player, option) {
    const rollIndex = room.pendingRolls.findIndex((candidate) => candidate.id === option.rollId);
    if (rollIndex === -1) {
      return false;
    }

    const [roll] = room.pendingRolls.splice(rollIndex, 1);
    const anchor = player.pieces.find((piece) => piece.id === option.pieceId);
    const movingPieces =
      anchor &&
      (option.startSpotKey === "start" ? [anchor] : currentStackPieces(player, anchor));

    if (!anchor || !movingPieces?.length) {
      return false;
    }

    const nextHistory =
      roll.steps < 0
        ? buildBackdoHistory(anchor, option.destinationNodeId)
        : [...anchor.history, ...(option.pathNodes || [option.destinationNodeId])];
    const destinationNodeId = option.destinationNodeId;
    const destinationSpotKey = getSpotKey(destinationNodeId);

    movingPieces.forEach((piece) => {
      piece.nodeId = destinationNodeId;
      piece.history = [...nextHistory];
    });

  const capturedPieces =
    destinationSpotKey === "start" || destinationSpotKey === "finish"
      ? []
      : room.players.flatMap((candidate) => {
          if (candidate.id === player.id) {
            return [];
          }

          return candidate.pieces.filter((piece) => getSpotKey(piece.nodeId) === destinationSpotKey);
        });

    capturedPieces.forEach((piece) => {
      piece.nodeId = "start";
      piece.history = ["start"];
    });

    if (destinationSpotKey !== "start" && destinationSpotKey !== "finish") {
      player.pieces
        .filter((piece) => getSpotKey(piece.nodeId) === destinationSpotKey)
        .forEach((piece) => {
          piece.nodeId = destinationNodeId;
          piece.history = [...nextHistory];
        });
    }

    const captureCount = capturedPieces.length;
    const finishCount = movingPieces.filter((piece) => piece.nodeId === "finish").length;
    const playerCompleted = finishedCount(player) === PIECES_PER_PLAYER;

    room.lastMove = {
      id: option.id,
      playerId: player.id,
      pieceIds: movingPieces.map((piece) => piece.id),
      pieceCount: movingPieces.length,
      startSpotKey: option.startSpotKey,
      destinationSpotKey,
      pathSpotKeys: (option.pathNodes?.length ? option.pathNodes : [destinationNodeId]).map((nodeId) => getSpotKey(nodeId)),
      capturedPieceIds: capturedPieces.map((piece) => piece.id)
    };

    if (captureCount) {
      room.throwCountRemaining += 1;
    }

    if (false && finishedCount(player) === PIECES_PER_PLAYER) {
      finishGame(room, player.id, `${player.name} 승리`);
      return true;
    }

    const moveBits = [`${player.name} ${roll.label}`];
    if (option.routeHint === "shortcut") {
      moveBits.push("지름길");
    }
    moveBits.push(option.destinationLabel);
    if (captureCount) {
      moveBits.push(`잡기 ${captureCount}`);
    }
    if (finishCount) {
      moveBits.push(`도착 ${finishCount}`);
    }
    if (captureCount) {
      moveBits.push("한 번 더");
    }

    setRecentAction(room, moveBits.join(" · "), captureCount ? "success" : "neutral");
    pushSystemMessage(
      room,
      `${player.name}님이 ${option.destinationLabel}까지 이동했습니다${captureCount ? ` · 잡기 ${captureCount}` : ""}${finishCount ? ` · 도착 ${finishCount}` : ""}`
    );

    if (playerCompleted) {
      const remainingPlayers = unfinishedPlayers(room);

      if (remainingPlayers.length <= 1) {
        const loser = remainingPlayers[0] || null;
        finishGame(room, {
          loserId: loser?.id || null,
          reason: loser ? `${loser.name} 패배` : "모든 플레이어가 완주했습니다"
        });
        return true;
      }

      room.throwCountRemaining = 0;
      room.pendingRolls = [];
      pushSystemMessage(room, `${player.name}이 모든 말을 완주했습니다.`);
      advanceTurn(room);
      return true;
    }

    if (!room.pendingRolls.length && room.throwCountRemaining === 0) {
      advanceTurn(room);
    }

    return true;
  }

  function discardRoll(room, player, rollId) {
    const rollIndex = room.pendingRolls.findIndex((candidate) => candidate.id === rollId);
    if (rollIndex === -1) {
      return false;
    }

    const [roll] = room.pendingRolls.splice(rollIndex, 1);
    if (!roll) {
      return false;
    }

    setRecentAction(room, `${player.name}님이 ${roll.label} 결과를 버렸습니다`, "neutral");
    pushSystemMessage(room, `${player.name}님이 ${roll.label} 결과를 버렸습니다.`);

    if (!room.pendingRolls.length && room.throwCountRemaining === 0) {
      advanceTurn(room);
    }

    return true;
  }

  function chooseBotMove(options) {
    if (!options.length) {
      return null;
    }

    let best = null;

    options.forEach((option) => {
      const progressGain = getProgress(option.destinationNodeId) - getProgress(option.startNodeId);
      const score =
        progressGain * 18 +
        option.captures.length * 240 +
        option.mergeCount * 80 +
        option.pieceCount * 18 +
        (option.reachesFinish ? 420 : 0) +
        (option.routeHint === "shortcut" ? 32 : 0);

      if (!best || score > best.score) {
        best = {
          option,
          score
        };
      }
    });

    return best?.option || randomItem(options);
  }

  function scheduleBot(room) {
    clearBotTimer(room);

    if (!room || room.phase !== "playing") {
      return;
    }

    const bot = getPlayer(room, room.currentPlayerId);
    if (!bot?.isBot) {
      return;
    }

    room.botTimer = setTimeout(() => {
      runBotTurn(room.code);
    }, randomBetween(BOT_DELAY_MIN_MS, BOT_DELAY_MAX_MS));
  }

  function runBotTurn(roomCode) {
    const room = getRoom(roomCode);
    if (!room || room.phase !== "playing") {
      return;
    }

    room.botTimer = null;

    const bot = getPlayer(room, room.currentPlayerId);
    if (!bot?.isBot) {
      return;
    }

    if (room.throwCountRemaining > 0) {
      const roll = createRoll();
      room.pendingRolls.push(roll);
      room.throwCountRemaining -= 1;
      if (roll.bonus) {
        room.throwCountRemaining += 1;
      }

      setRecentAction(
        room,
        `${bot.name} ${roll.label}${roll.bonus ? " · 한 번 더" : ""}`, 
        roll.bonus ? "success" : "neutral"
      );
      pushSystemMessage(room, `${bot.name}님이 ${roll.label}을(를) 던졌습니다${roll.bonus ? " · 한 번 더" : ""}`);
      broadcastRoom(room);
      return;
    }

    const options = allLegalMoveOptions(room, bot);
    if (!options.length) {
      const discardableRoll = room.pendingRolls.find((roll) => !legalMoveOptions(room, bot, roll).length);
      if (!discardableRoll) {
        broadcastRoom(room);
        return;
      }

      discardRoll(room, bot, discardableRoll.id);
      broadcastRoom(room);
      return;
    }

    const selected = chooseBotMove(options);
    applyMove(room, bot, selected);
    broadcastRoom(room);
  }

  function serializePiece(piece) {
    return {
      id: piece.id,
      serial: piece.serial,
      nodeId: piece.nodeId,
      spotKey: getSpotKey(piece.nodeId),
      finished: piece.nodeId === "finish"
    };
  }

  function serializePlayer(room, player) {
    return {
      id: player.id,
      name: player.name,
      isBot: player.isBot,
      isHost: room.hostId === player.id,
      colorKey: player.colorKey,
      isCurrent: room.currentPlayerId === player.id,
      connected: isPlayerConnected(player),
      disconnectDeadlineAt: player.disconnectDeadlineAt || null,
      waitingCount: waitingCount(player),
      onBoardCount: onBoardCount(player),
      finishedCount: finishedCount(player),
      pieces: player.pieces.map(serializePiece)
    };
  }

  function serializeMoveOption(option) {
    return {
      id: option.id,
      rollId: option.rollId,
      rollKind: option.rollKind,
      rollLabel: option.rollLabel,
      rollSteps: option.rollSteps,
      pieceId: option.pieceId,
      pieceIds: option.pieceIds,
      pieceSerial: option.pieceSerial,
      pieceCount: option.pieceCount,
      startNodeId: option.startNodeId,
      startSpotKey: option.startSpotKey,
      destinationNodeId: option.destinationNodeId,
      destinationSpotKey: option.destinationSpotKey,
      destinationLabel: option.destinationLabel,
      pathSpotKeys: (option.pathNodes || []).map((nodeId) => getSpotKey(nodeId)),
      routeHint: option.routeHint,
      reachesFinish: option.reachesFinish,
      captureCount: option.captures.length,
      captureNames: [...new Set(option.captures.map((capture) => capture.name))],
      mergeCount: option.mergeCount
    };
  }

  function serializeRoom(room, socketId) {
    const me = getPlayer(room, socketId);
    const roll = room.phase === "playing" && me?.id === room.currentPlayerId ? activeRoll(room) : null;
    const moveOptions = room.phase === "playing" && me?.id === room.currentPlayerId ? allLegalMoveOptions(room, me) : [];
    const discardableRollIds =
      room.phase === "playing" && me?.id === room.currentPlayerId && room.throwCountRemaining === 0
        ? room.pendingRolls.filter((pendingRoll) => !legalMoveOptions(room, me, pendingRoll).length).map((pendingRoll) => pendingRoll.id)
        : [];

    return {
      code: room.code,
      phase: room.phase,
      hostId: room.hostId,
      targetPlayerCount: room.targetPlayerCount,
      turnOrder: room.turnOrder,
      currentPlayerId: room.currentPlayerId,
      throwCountRemaining: room.throwCountRemaining,
      pendingRolls: room.pendingRolls.map(serializeRoll),
      activeRoll: roll ? serializeRoll(roll) : null,
      canThrow: room.phase === "playing" && me?.id === room.currentPlayerId && room.throwCountRemaining > 0,
      canDiscardActiveRoll: Boolean(discardableRollIds.length),
      discardableRollIds,
      moveOptions: moveOptions.map(serializeMoveOption),
      recentAction: room.recentAction,
      lastMove: room.lastMove,
      result: room.result,
      messages: room.messages,
      players: room.players.map((player) => serializePlayer(room, player)),
      me: me ? serializePlayer(room, me) : null
    };
  }

  function broadcastRoom(room, options = {}) {
    const { skipBotSchedule = false } = options;
    persistRoomState(room);

    room.players.forEach((player) => {
      if (!player.isBot) {
        io.to(player.id).emit("room:update", serializeRoom(room, player.id));
      }
    });

    if (!skipBotSchedule) {
      scheduleBot(room);
    }
  }

  function removePlayer(playerId) {
    cancelDisconnect(disconnectTimers, playerId);

    for (const room of rooms.values()) {
      const index = room.players.findIndex((player) => player.id === playerId);
      if (index === -1) {
        continue;
      }

      clearBotTimer(room);
      room.players.splice(index, 1);
      room.turnOrder = room.turnOrder.filter((id) => id !== playerId);

      if (!room.players.length || !room.players.some((player) => !player.isBot)) {
        rooms.delete(room.code);
        deletePersistedRoom(room.code);
        return;
      }

      room.hostId = room.players.find((player) => !player.isBot)?.id || room.players[0].id;
      assignPlayerColors(room);

      if (room.phase !== "lobby") {
        resetGame(room);
      }

      broadcastRoom(room, { skipBotSchedule: room.phase === "lobby" });
      return;
    }
  }

  function attachSocketToPlayer(room, socket, player) {
    socket.join(room.code);
    bindPlayerSocket(io, player, socket, disconnectTimers);
  }

  function disconnectPlayerSocket(socket) {
    const playerId = getSocketPlayerId(socket);

    if (!playerId) {
      return;
    }

    for (const room of rooms.values()) {
      const player = room.players.find((candidate) => candidate.id === playerId && !candidate.isBot);
      if (!player || player.socketId !== socket.id) {
        continue;
      }

      schedulePlayerDisconnect(player, disconnectTimers, removePlayer, DISCONNECT_GRACE_MS);
      broadcastRoom(room, { skipBotSchedule: true });
      return;
    }
  }

  function leaveRoomForSocket(socket) {
    const playerId = getSocketPlayerId(socket);

    if (!playerId) {
      leaveJoinedRooms(socket);
      return;
    }

    cancelDisconnect(disconnectTimers, playerId);
    removePlayer(playerId);
    leaveJoinedRooms(socket);
  }

  function leaveJoinedRooms(socket) {
    for (const roomName of socket.rooms) {
      if (roomName !== socket.id) {
        socket.leave(roomName);
      }
    }
  }

  function createBotPlayer(room) {
    const botCount = room.players.filter((player) => player.isBot).length + 1;
    return createPlayer(
      `yut-bot:${room.code}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      `봇 ${botCount}`,
      true
    );
  }

  function addBotToRoom(room) {
    if (room.players.length >= room.targetPlayerCount) {
      return null;
    }

    const bot = createBotPlayer(room);
    room.players.push(bot);
    assignPlayerColors(room);
    return bot;
  }

  io.on("connection", (socket) => {
    socket.join(socket.id);

    socket.on("room:create", ({ name, settings }, callback = () => {}) => {
      const safeName = sanitizeName(name);
      const playerId = getSocketPlayerId(socket);
      if (!safeName) {
        callback({ ok: false, message: "닉네임을 먼저 입력해 주세요." });
        return;
      }

      removePlayer(playerId);
      leaveJoinedRooms(socket);

      const room = createRoom(generateRoomCode(), playerId, socket.id, safeName, settings);
      attachSocketToPlayer(room, socket, room.players[0]);
      broadcastRoom(room, { skipBotSchedule: true });
      callback({ ok: true, code: room.code, room: serializeRoom(room, playerId) });
    });

    socket.on("room:join", ({ code, name }, callback = () => {}) => {
      const room = getRoom(code);
      const safeName = sanitizeName(name);
      const playerId = getSocketPlayerId(socket);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다." });
        return;
      }

      if (!safeName) {
        callback({ ok: false, message: "닉네임을 먼저 입력해 주세요." });
        return;
      }

      const reconnectingPlayer = room.players.find((player) => player.id === playerId && !player.isBot);
      if (reconnectingPlayer) {
        reconnectingPlayer.name = safeName;
        leaveJoinedRooms(socket);
        attachSocketToPlayer(room, socket, reconnectingPlayer);
        broadcastRoom(room, { skipBotSchedule: true });
        callback({ ok: true, code: room.code, room: serializeRoom(room, playerId), restored: true });
        return;
      }

      if (room.phase !== "lobby") {
        callback({ ok: false, message: "이미 게임이 시작된 방입니다." });
        return;
      }

      if (room.players.length >= room.targetPlayerCount) {
        callback({ ok: false, message: "방이 가득 찼습니다." });
        return;
      }

      removePlayer(playerId);
      leaveJoinedRooms(socket);

      room.players.push(createPlayer(playerId, safeName, false, socket.id));
      assignPlayerColors(room);
      attachSocketToPlayer(room, socket, room.players[room.players.length - 1]);
      broadcastRoom(room, { skipBotSchedule: true });
      callback({ ok: true, code: room.code, room: serializeRoom(room, playerId) });
    });

    socket.on("room:leave", (_payload = {}, callback = () => {}) => {
      leaveRoomForSocket(socket);
      callback({ ok: true });
    });

    socket.on("room:add_bots", ({ code, count }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다." });
        return;
      }

      if (room.hostId !== playerId) {
        callback({ ok: false, message: "호스트만 할 수 있습니다." });
        return;
      }

      if (room.phase !== "lobby") {
        callback({ ok: false, message: "대기실에서만 봇을 추가할 수 있습니다." });
        return;
      }

      const requested = Math.max(1, Math.min(MAX_PLAYERS - room.players.length, Number.parseInt(count, 10) || 1));
      let added = 0;

      for (let index = 0; index < requested; index += 1) {
        if (!addBotToRoom(room)) {
          break;
        }
        added += 1;
      }

      if (!added) {
        callback({ ok: false, message: "더 이상 봇을 추가할 수 없습니다." });
        return;
      }

      broadcastRoom(room, { skipBotSchedule: true });
      callback({ ok: true, added });
    });

    socket.on("game:start", ({ code }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다." });
        return;
      }

      if (room.hostId !== playerId) {
        callback({ ok: false, message: "호스트만 시작할 수 있습니다." });
        return;
      }

      if (room.players.length < MIN_PLAYERS) {
        callback({ ok: false, message: "최소 2명이 있어야 시작할 수 있습니다." });
        return;
      }

      if (room.players.length !== room.targetPlayerCount) {
        callback({ ok: false, message: "설정한 인원이 모두 모여야 시작할 수 있습니다." });
        return;
      }

      startGame(room);
      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("game:reset", ({ code }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다." });
        return;
      }

      if (room.hostId !== playerId) {
        callback({ ok: false, message: "호스트만 다시 시작할 수 있습니다." });
        return;
      }

      resetGame(room);
      broadcastRoom(room, { skipBotSchedule: true });
      callback({ ok: true });
    });

    socket.on("throw:sticks", ({ code }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;

      if (!room || !player) {
        callback({ ok: false, message: "플레이어 정보를 확인할 수 없습니다." });
        return;
      }

      if (room.phase !== "playing") {
        callback({ ok: false, message: "지금은 윷을 던질 수 없습니다." });
        return;
      }

      if (room.currentPlayerId !== playerId) {
        callback({ ok: false, message: "지금은 당신 차례가 아닙니다." });
        return;
      }

      if (room.throwCountRemaining <= 0) {
        callback({ ok: false, message: "쌓인 결과를 먼저 모두 처리해 주세요." });
        return;
      }

      const roll = createRoll();
      room.pendingRolls.push(roll);
      room.throwCountRemaining -= 1;
      if (roll.bonus) {
        room.throwCountRemaining += 1;
      }

      setRecentAction(
        room,
        `${player.name} ${roll.label}${roll.bonus ? " · 한 번 더" : ""}`, 
        roll.bonus ? "success" : "neutral"
      );
      pushSystemMessage(room, `${player.name}님이 ${roll.label}을(를) 던졌습니다${roll.bonus ? " · 한 번 더" : ""}`);
      broadcastRoom(room);
      callback({ ok: true, roll: serializeRoll(roll) });
    });

    socket.on("move:piece", ({ code, optionId }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;

      if (!room || !player) {
        callback({ ok: false, message: "플레이어 정보를 확인할 수 없습니다." });
        return;
      }

      if (room.phase !== "playing") {
        callback({ ok: false, message: "지금은 말을 움직일 수 없습니다." });
        return;
      }

      if (room.currentPlayerId !== playerId) {
        callback({ ok: false, message: "지금은 당신 차례가 아닙니다." });
        return;
      }

      if (room.throwCountRemaining > 0) {
        callback({ ok: false, message: "윷 던지기를 먼저 모두 마쳐 주세요." });
        return;
      }

      const option = findMoveOption(room, player, optionId);
      if (!option) {
        callback({ ok: false, message: "선택한 이동이 더 이상 유효하지 않습니다." });
        return;
      }

      if (!applyMove(room, player, option)) {
        callback({ ok: false, message: "선택한 이동을 적용할 수 없습니다." });
        return;
      }

      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("roll:discard", ({ code, rollId }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;
      const roll = room ? room.pendingRolls.find((pendingRoll) => pendingRoll.id === rollId) || null : null;

      if (!room || !player) {
        callback({ ok: false, message: "플레이어 정보를 확인할 수 없습니다." });
        return;
      }

      if (room.phase !== "playing") {
        callback({ ok: false, message: "지금은 결과를 버릴 수 없습니다." });
        return;
      }

      if (room.currentPlayerId !== playerId) {
        callback({ ok: false, message: "지금은 당신 차례가 아닙니다." });
        return;
      }

      if (!roll || room.throwCountRemaining > 0) {
        callback({ ok: false, message: "버릴 수 있는 결과가 없습니다." });
        return;
      }

      if (legalMoveOptions(room, player, roll).length) {
        callback({ ok: false, message: "아직 움직일 수 있는 말이 있습니다." });
        return;
      }

      discardRoll(room, player, roll.id);
      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("chat:send", ({ code, text }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;

      if (!room || !player) {
        callback({ ok: false, message: "플레이어 정보를 확인할 수 없습니다." });
        return;
      }

      if (!pushMessage(room, player, text)) {
        callback({ ok: false, message: "채팅 내용을 먼저 입력해 주세요." });
        return;
      }

      broadcastRoom(room, { skipBotSchedule: true });
      callback({ ok: true });
    });

    socket.on("disconnect", () => {
      disconnectPlayerSocket(socket);
    });
  });

  async function restorePersistedRooms() {
    const snapshots = await roomStore.restoreAll();

    snapshots.forEach((snapshot) => {
      const room = hydrateRoom(snapshot);
      rooms.set(room.code, room);
      restoreRoomPresence(room, disconnectTimers, removePlayer, DISCONNECT_GRACE_MS);
      persistRoomState(room);
      scheduleBot(room);
    });

    if (snapshots.length) {
      console.log(`[yut] restored ${snapshots.length} room(s) from Redis`);
    }
  }

  return restorePersistedRooms();
};

