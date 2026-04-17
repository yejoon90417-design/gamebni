module.exports = function attachCatchmindGame(rootIo) {
  const io = rootIo.of("/catch");
  const WORD_SETS = require("./data/catchmind-words");
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
  const TARGET_PLAYER_OPTIONS = [2, 3, 4, 5];
  const DEFAULT_TARGET_PLAYER_COUNT = 2;
  const ROUND_OPTIONS = [1, 2, 3];
  const DEFAULT_ROUND_COUNT = 1;
  const MAX_CHAT_LENGTH = 140;
  const MAX_MESSAGES = 100;
  const WORD_CHOICE_COUNT = 3;
  const CHOOSE_DURATION_MS = 12000;
  const TURN_DURATION_MS = 80000;
  const TURN_RESULT_DURATION_MS = 3500;
  const MAX_STROKES = 320;
  const MAX_STROKE_POINTS = 240;
  const BASE_GUESSED_SCORE = 3;
  const MAX_TIME_BONUS = 2;
  const DRAWER_SCORE = 2;
  const BOT_CHOOSE_DELAY_MIN_MS = 900;
  const BOT_CHOOSE_DELAY_MAX_MS = 1800;
  const BOT_GUESS_DELAY_MIN_MS = 5000;
  const BOT_GUESS_DELAY_MAX_MS = 9000;
  const BOT_WRONG_GUESS_DELAY_MIN_MS = 1500;
  const BOT_WRONG_GUESS_DELAY_MAX_MS = 4200;
  const BOT_STROKE_DELAY_STEP_MS = 320;
  const BOT_NAMES = ["BOT 1", "BOT 2", "BOT 3", "BOT 4", "BOT 5"];
  const BOT_FILLER_GUESSES = ["음...", "잘 모르겠다", "비슷한데", "어려운데", "헷갈린다"];

  const rooms = new Map();
  const disconnectTimers = new Map();
  const DISCONNECT_GRACE_MS = getDisconnectGraceMs();
  const roomStore = createRoomStore({
    gameKey: "catch",
    serializeRoom: (room) => snapshotRoom(room, { resolutionTimer: null, botTimers: [] })
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

  function normalizeGuess(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/\s+/g, "");
  }

  function sanitizeSettings(input = {}) {
    const targetPlayerCount = Number.parseInt(input.targetPlayerCount, 10);
    const roundCount = Number.parseInt(input.roundCount, 10);
    return {
      targetPlayerCount: TARGET_PLAYER_OPTIONS.includes(targetPlayerCount)
        ? targetPlayerCount
        : DEFAULT_TARGET_PLAYER_COUNT,
      roundCount: ROUND_OPTIONS.includes(roundCount) ? roundCount : DEFAULT_ROUND_COUNT
    };
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

  function shuffle(list) {
    const clone = [...list];
    for (let index = clone.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
    }
    return clone;
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function createPlayer(id, name, isBot = false, socketId = null) {
    return {
      id,
      name: sanitizeName(name),
      isBot,
      score: 0,
      guessedAtTurn: null,
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
      roundCount: settings.roundCount,
      players: [createPlayer(hostId, hostName, false, hostSocketId)],
      messages: [],
      turnOrder: [],
      currentDrawerId: null,
      drawerTurnIndex: 0,
      turnNumber: 0,
      currentRound: 0,
      wordChoices: [],
      wordTopic: "",
      currentWord: "",
      guessedPlayerIds: [],
      strokes: [],
      redoStrokes: [],
      timer: null,
      recentAction: null,
      result: null,
      usedWordKeys: [],
      resolutionTimer: null,
      botTimers: new Set()
    };

    rooms.set(code, room);
    return room;
  }

  function hydrateRoom(snapshot) {
    const room = {
      ...snapshot,
      code: normalizeRoomCode(snapshot.code),
      resolutionTimer: null,
      botTimers: new Set()
    };

    room.players = (snapshot.players || []).map((player) => ({
      score: 0,
      guessedAtTurn: null,
      ...createPresenceState(),
      ...player
    }));
    room.targetPlayerCount = TARGET_PLAYER_OPTIONS.includes(room.targetPlayerCount)
      ? room.targetPlayerCount
      : DEFAULT_TARGET_PLAYER_COUNT;
    room.roundCount = ROUND_OPTIONS.includes(room.roundCount) ? room.roundCount : DEFAULT_ROUND_COUNT;
    room.messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    room.turnOrder = Array.isArray(snapshot.turnOrder) ? snapshot.turnOrder : [];
    room.wordChoices = Array.isArray(snapshot.wordChoices) ? snapshot.wordChoices : [];
    room.guessedPlayerIds = Array.isArray(snapshot.guessedPlayerIds) ? snapshot.guessedPlayerIds : [];
    room.strokes = Array.isArray(snapshot.strokes) ? snapshot.strokes : [];
    room.redoStrokes = Array.isArray(snapshot.redoStrokes) ? snapshot.redoStrokes : [];
    room.timer = snapshot.timer || null;
    room.recentAction = snapshot.recentAction || null;
    room.result = snapshot.result || null;
    room.usedWordKeys = Array.isArray(snapshot.usedWordKeys) ? snapshot.usedWordKeys : [];
    return room;
  }

  function getRoom(code) {
    return rooms.get(String(code || "").trim().toUpperCase()) || null;
  }

  function persistRoomState(room) {
    roomStore.save(room);
  }

  function deletePersistedRoom(code) {
    roomStore.remove(code);
  }

  function getPlayer(room, playerId) {
    return room.players.find((player) => player.id === playerId || player.socketId === playerId) || null;
  }

  function appendMessage(room, message) {
    room.messages.push(message);
    if (room.messages.length > MAX_MESSAGES) {
      room.messages.shift();
    }
    return room.messages[room.messages.length - 1];
  }

  function pushSystemMessage(room, text) {
    const cleanText = sanitizeChatText(text);
    if (!cleanText) {
      return null;
    }

    return appendMessage(room, {
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      kind: "system",
      name: "SYSTEM",
      text: cleanText,
      createdAt: Date.now()
    });
  }

  function pushChatMessage(room, player, text) {
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

  function setRecentAction(room, text, tone = "neutral") {
    room.recentAction = {
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      text,
      tone,
      createdAt: Date.now()
    };
  }

  function clearResolutionTimer(room) {
    if (!room?.resolutionTimer) {
      return;
    }

    clearTimeout(room.resolutionTimer);
    room.resolutionTimer = null;
  }

  function clearBotTimers(room) {
    if (!room?.botTimers) {
      return;
    }

    room.botTimers.forEach((timerId) => {
      clearTimeout(timerId);
    });
    room.botTimers.clear();
  }

  function scheduleBotTimer(room, callback, delayMs) {
    if (!room?.botTimers) {
      return;
    }

    const timerId = setTimeout(() => {
      room.botTimers.delete(timerId);
      callback();
    }, delayMs);

    room.botTimers.add(timerId);
  }

  function clearAllTimers(room) {
    clearResolutionTimer(room);
    clearBotTimers(room);
    room.timer = null;
  }

  function maskWord(word) {
    return String(word || "")
      .split("")
      .map((character) => (/\s/.test(character) ? " " : "○"))
      .join("");
  }

  function playerIdsInRoom(room) {
    return room.players.map((player) => player.id);
  }

  function activePlayers(room) {
    return room.turnOrder
      .map((playerId) => getPlayer(room, playerId))
      .filter(Boolean);
  }

  function winnerIdsByScore(room) {
    const scores = room.players.map((player) => player.score);
    const maxScore = scores.length ? Math.max(...scores) : 0;
    return room.players.filter((player) => player.score === maxScore).map((player) => player.id);
  }

  function finishGame(room) {
    clearAllTimers(room);
    room.phase = "result";
    room.wordChoices = [];
    room.timer = null;
    const winnerIds = winnerIdsByScore(room);
    const winners = room.players.filter((player) => winnerIds.includes(player.id));
    const reason = winners.length
      ? `${winners.map((player) => player.name).join(", ")} 승리`
      : "게임 종료";
    room.result = {
      winnerIds,
      reason,
      scores: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        score: player.score
      }))
    };
    setRecentAction(room, reason, "success");
    pushSystemMessage(room, `게임 종료 · ${reason}`);
  }

  function clearPerTurnState(room) {
    room.wordChoices = [];
    room.wordTopic = "";
    room.currentWord = "";
    room.guessedPlayerIds = [];
    room.strokes = [];
    room.redoStrokes = [];
    room.players.forEach((player) => {
      player.guessedAtTurn = null;
    });
  }

  function buildWordPool() {
    const pool = [];
    WORD_SETS.forEach((entry) => {
      entry.words.forEach((word) => {
        pool.push({
          topic: entry.topic,
          word
        });
      });
    });
    return pool;
  }

  const WORD_POOL = buildWordPool();

  function pickWordChoices(room) {
    const usedSet = new Set(room.usedWordKeys);
    const available = WORD_POOL.filter((entry) => !usedSet.has(`${entry.topic}:${entry.word}`));
    const source = available.length >= WORD_CHOICE_COUNT ? available : WORD_POOL;
    return shuffle(source)
      .slice(0, WORD_CHOICE_COUNT)
      .map((entry) => ({ topic: entry.topic, word: entry.word }));
  }

  function currentDrawer(room) {
    return getPlayer(room, room.currentDrawerId);
  }

  function createBotPlayer(room) {
    const count = room.players.filter((player) => player.isBot).length;
    return createPlayer(
      `catch-bot:${room.code}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      BOT_NAMES[count] || `BOT ${count + 1}`,
      true
    );
  }

  function addBotToRoom(room) {
    if (room.players.length >= room.targetPlayerCount) {
      return null;
    }

    const bot = createBotPlayer(room);
    room.players.push(bot);
    return bot;
  }

  function currentTurnPlayerCount(room) {
    return room.turnOrder.filter((playerId) => room.players.some((player) => player.id === playerId)).length;
  }

  function createBotStroke() {
    const pointCount = randomBetween(3, 6);
    const startX = Math.random() * 0.7 + 0.15;
    const startY = Math.random() * 0.7 + 0.15;
    const points = [];

    for (let index = 0; index < pointCount; index += 1) {
      points.push({
        x: Math.max(0.08, Math.min(0.92, startX + (Math.random() - 0.5) * 0.32)),
        y: Math.max(0.08, Math.min(0.92, startY + (Math.random() - 0.5) * 0.32))
      });
    }

    return {
      id: `stroke:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      color: "#111111",
      size: randomBetween(4, 9),
      points
    };
  }

  function scheduleBotChoice(room) {
    const drawer = currentDrawer(room);
    if (!drawer?.isBot || room.phase !== "choosing" || !room.wordChoices.length) {
      return;
    }

    scheduleBotTimer(room, () => {
      if (room.phase !== "choosing" || room.currentDrawerId !== drawer.id) {
        return;
      }

      const choice = room.wordChoices[Math.floor(Math.random() * room.wordChoices.length)];
      startDrawingPhase(room, choice);
      broadcastRoom(room);
    }, randomBetween(BOT_CHOOSE_DELAY_MIN_MS, BOT_CHOOSE_DELAY_MAX_MS));
  }

  function scheduleBotDrawing(room) {
    const drawer = currentDrawer(room);
    if (!drawer?.isBot || room.phase !== "drawing") {
      return;
    }

    const strokeCount = randomBetween(4, 8);
    for (let index = 0; index < strokeCount; index += 1) {
      scheduleBotTimer(
        room,
        () => {
          if (room.phase !== "drawing" || room.currentDrawerId !== drawer.id) {
            return;
          }

          room.strokes.push(createBotStroke());
          room.redoStrokes = [];
          if (room.strokes.length > MAX_STROKES) {
            room.strokes.shift();
          }
          broadcastRoom(room);
        },
        600 + index * BOT_STROKE_DELAY_STEP_MS
      );
    }
  }

  function scheduleBotGuesses(room) {
    if (room.phase !== "drawing") {
      return;
    }

    const botGuessers = room.players.filter((player) => player.isBot && player.id !== room.currentDrawerId);
    if (!botGuessers.length) {
      return;
    }

    botGuessers.forEach((bot, index) => {
      scheduleBotTimer(
        room,
        () => {
          if (room.phase !== "drawing" || room.guessedPlayerIds.length) {
            return;
          }

          pushChatMessage(
            room,
            bot,
            BOT_FILLER_GUESSES[(index + room.turnNumber) % BOT_FILLER_GUESSES.length]
          );
          broadcastRoom(room);
        },
        randomBetween(BOT_WRONG_GUESS_DELAY_MIN_MS, BOT_WRONG_GUESS_DELAY_MAX_MS)
      );
    });

    const correctBot = botGuessers[Math.floor(Math.random() * botGuessers.length)];
    scheduleBotTimer(
      room,
      () => {
        if (room.phase !== "drawing" || room.guessedPlayerIds.length) {
          return;
        }

        const message = pushChatMessage(room, correctBot, room.currentWord);
        if (!message) {
          return;
        }

        maybeResolveGuess(room, correctBot, message.text);
        broadcastRoom(room);
      },
      randomBetween(BOT_GUESS_DELAY_MIN_MS, BOT_GUESS_DELAY_MAX_MS)
    );
  }

  function scheduleBotPhase(room) {
    if (room.phase === "choosing") {
      scheduleBotChoice(room);
      return;
    }

    if (room.phase === "drawing") {
      scheduleBotDrawing(room);
      scheduleBotGuesses(room);
    }
  }

  function startChoosePhase(room) {
    clearAllTimers(room);
    clearPerTurnState(room);

    const turnPlayerCount = currentTurnPlayerCount(room);
    if (!turnPlayerCount) {
      finishGame(room);
      return;
    }

    room.turnNumber = room.drawerTurnIndex + 1;
    room.currentRound = Math.floor(room.drawerTurnIndex / turnPlayerCount) + 1;
    room.currentDrawerId = room.turnOrder[room.drawerTurnIndex % turnPlayerCount];
    room.wordChoices = pickWordChoices(room);

    const drawer = currentDrawer(room);
    setRecentAction(room, `${drawer?.name || "플레이어"} 제시어 선택`, "neutral");
    pushSystemMessage(room, `${drawer?.name || "플레이어"} 그림 차례`);
    startDrawingPhase(room, room.wordChoices[0]);
  }

  function startDrawingPhase(room, selection) {
    const choice = room.wordChoices.find(
      (entry) => entry.word === selection.word && entry.topic === selection.topic
    );
    const picked = choice || room.wordChoices[0];

    if (!picked) {
      finishGame(room);
      return;
    }

    room.phase = "drawing";
    room.wordChoices = [];
    room.wordTopic = picked.topic;
    room.currentWord = picked.word;
    room.redoStrokes = [];
    room.usedWordKeys.push(`${picked.topic}:${picked.word}`);
    room.timer = {
      kind: "draw",
      dueAt: Date.now() + TURN_DURATION_MS
    };

    const drawer = currentDrawer(room);
    setRecentAction(room, `${drawer?.name || "플레이어"} 그림 시작`, "neutral");
    scheduleRoomTimer(room);
    scheduleBotPhase(room);
  }

  function finishTurn(room, options = {}) {
    const drawTimer = room.timer;
    clearAllTimers(room);

    const drawer = currentDrawer(room);
    const guesser = options.correctGuesserId ? getPlayer(room, options.correctGuesserId) : null;

    room.phase = "turn-result";
    room.timer = {
      kind: "turn-result",
      dueAt: Date.now() + TURN_RESULT_DURATION_MS
    };

    if (guesser && drawer) {
      const remainingMs =
        drawTimer?.kind === "draw" && Number.isFinite(drawTimer.dueAt)
          ? Math.max(drawTimer.dueAt - Date.now(), 0)
          : 0;
      const timeBonus = Math.min(
        MAX_TIME_BONUS,
        Math.floor((remainingMs / TURN_DURATION_MS) * (MAX_TIME_BONUS + 1))
      );
      const guessedScore = BASE_GUESSED_SCORE + timeBonus;

      guesser.score += guessedScore;
      drawer.score += DRAWER_SCORE;
      guesser.guessedAtTurn = room.turnNumber;
      room.guessedPlayerIds = [guesser.id];
      setRecentAction(room, `${guesser.name} 정답`, "success");
      pushSystemMessage(
        room,
        `${guesser.name} 정답 · +${guessedScore}점(${BASE_GUESSED_SCORE}+보너스 ${timeBonus}) / ${drawer.name} +${DRAWER_SCORE}점`
      );
    } else {
      setRecentAction(room, `시간 종료 · 정답 ${room.currentWord}`, "warning");
      pushSystemMessage(room, `시간 종료 · 정답 ${room.currentWord}`);
    }

    scheduleRoomTimer(room);
  }

  function advanceAfterTurn(room) {
    room.drawerTurnIndex += 1;
    if (room.drawerTurnIndex >= room.turnOrder.length * room.roundCount) {
      finishGame(room);
      return;
    }

    startChoosePhase(room);
  }

  function resolveRoomTimer(roomCode) {
    const room = getRoom(roomCode);
    if (!room?.timer) {
      return;
    }

    const timer = room.timer;
    clearResolutionTimer(room);

    if (timer.kind === "choose") {
      const fallback = room.wordChoices[0];
      if (!fallback) {
        finishGame(room);
      } else {
        startDrawingPhase(room, fallback);
      }
      broadcastRoom(room);
      return;
    }

    if (timer.kind === "draw") {
      finishTurn(room);
      broadcastRoom(room);
      return;
    }

    if (timer.kind === "turn-result") {
      advanceAfterTurn(room);
      broadcastRoom(room);
    }
  }

  function scheduleRoomTimer(room) {
    clearResolutionTimer(room);

    if (!room?.timer) {
      return;
    }

    const delay = Math.max(room.timer.dueAt - Date.now(), 20);
    room.resolutionTimer = setTimeout(() => {
      resolveRoomTimer(room.code);
    }, delay);
  }

  function resetGame(room) {
    clearAllTimers(room);
    room.phase = "lobby";
    room.turnOrder = [];
    room.currentDrawerId = null;
    room.drawerTurnIndex = 0;
    room.turnNumber = 0;
    room.currentRound = 0;
    room.wordChoices = [];
    room.wordTopic = "";
    room.currentWord = "";
    room.guessedPlayerIds = [];
    room.strokes = [];
    room.recentAction = null;
    room.result = null;
    room.usedWordKeys = [];
    room.players.forEach((player) => {
      player.score = 0;
      player.guessedAtTurn = null;
    });
  }

  function startGame(room) {
    resetGame(room);
    room.messages = [];
    room.turnOrder = playerIdsInRoom(room);
    room.drawerTurnIndex = 0;
    startChoosePhase(room);
  }

  function serializePlayer(room, player) {
    return {
      id: player.id,
      name: player.name,
      isBot: player.isBot,
      isHost: room.hostId === player.id,
      isDrawer: room.currentDrawerId === player.id,
      score: player.score,
      guessedAtTurn: player.guessedAtTurn,
      connected: isPlayerConnected(player)
    };
  }

  function serializeStroke(stroke) {
    return {
      id: stroke.id,
      color: stroke.color,
      size: stroke.size,
      points: stroke.points
    };
  }

  function visibleWordFor(room, me) {
    if (room.phase === "lobby") {
      return "";
    }

    if (room.phase === "choosing") {
      return me?.id === room.currentDrawerId ? "단어 선택 중" : "제시어 선택 중";
    }

    if (room.phase === "drawing") {
      return me?.id === room.currentDrawerId ? room.currentWord : maskWord(room.currentWord);
    }

    if (room.phase === "turn-result" || room.phase === "result") {
      return room.currentWord;
    }

    return "";
  }

  function serializeRoom(room, playerId) {
    const me = getPlayer(room, playerId);
    return {
      code: room.code,
      phase: room.phase,
      hostId: room.hostId,
      targetPlayerCount: room.targetPlayerCount,
      roundCount: room.roundCount,
      currentDrawerId: room.currentDrawerId,
      turnOrder: room.turnOrder,
      drawerTurnIndex: room.drawerTurnIndex,
      turnNumber: room.turnNumber,
      currentRound: room.currentRound,
      maxRound: room.roundCount,
      recentAction: room.recentAction,
      result: room.result,
      timeLeftMs: room.timer ? Math.max(room.timer.dueAt - Date.now(), 0) : 0,
      timerKind: room.timer?.kind || null,
      wordTopic: room.wordTopic,
      visibleWord: visibleWordFor(room, me),
      strokes: room.strokes.map(serializeStroke),
      canUndo: room.phase === "drawing" && me?.id === room.currentDrawerId && room.strokes.length > 0,
      canRedo:
        room.phase === "drawing" && me?.id === room.currentDrawerId && room.redoStrokes.length > 0,
      messages: room.messages,
      players: room.players.map((player) => serializePlayer(room, player)),
      wordChoices:
        room.phase === "choosing" && me?.id === room.currentDrawerId ? room.wordChoices : [],
      canDraw: room.phase === "drawing" && me?.id === room.currentDrawerId,
      canGuess: room.phase === "drawing" && me?.id !== room.currentDrawerId,
      canChoose: room.phase === "choosing" && me?.id === room.currentDrawerId,
      me: me ? serializePlayer(room, me) : null
    };
  }

  function broadcastRoom(room) {
    persistRoomState(room);
    room.players.forEach((player) => {
      if (player.isBot) {
        return;
      }

      io.to(player.id).emit("room:update", serializeRoom(room, player.id));
    });
  }

  function sanitizeStrokePayload(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const size = Math.max(2, Math.min(24, Number(payload.size) || 4));
    const color = /^#[0-9a-f]{6}$/i.test(String(payload.color || "")) ? String(payload.color) : "#111111";
    const inputPoints = Array.isArray(payload.points) ? payload.points : [];
    const points = inputPoints
      .slice(0, MAX_STROKE_POINTS)
      .map((point) => ({
        x: Math.max(0, Math.min(1, Number(point?.x) || 0)),
        y: Math.max(0, Math.min(1, Number(point?.y) || 0))
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

    if (points.length < 2) {
      return null;
    }

    return {
      id: `stroke:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      color,
      size,
      points
    };
  }

  function processDrawStroke(room, player, strokePayload) {
    if (!room || !player) {
      return { ok: false, message: "플레이어 정보를 확인할 수 없습니다." };
    }

    if (room.phase !== "drawing") {
      return { ok: false, message: "그릴 수 있는 단계가 아닙니다." };
    }

    if (room.currentDrawerId !== player.id) {
      return { ok: false, message: "지금은 그림 그리는 사람이 아닙니다." };
    }

    const stroke = sanitizeStrokePayload(strokePayload);
    if (!stroke) {
      return { ok: false, message: "그림 정보를 확인할 수 없습니다." };
    }

    room.strokes.push(stroke);
    room.redoStrokes = [];
    if (room.strokes.length > MAX_STROKES) {
      room.strokes.shift();
    }
    return { ok: true };
  }

  function clearCanvas(room, player) {
    if (!room || !player) {
      return { ok: false, message: "플레이어 정보를 확인할 수 없습니다." };
    }

    if (room.phase !== "drawing") {
      return { ok: false, message: "지금은 캔버스를 지울 수 없습니다." };
    }

    if (room.currentDrawerId !== player.id) {
      return { ok: false, message: "지금은 그림 그리는 사람이 아닙니다." };
    }

    room.strokes = [];
    room.redoStrokes = [];
    return { ok: true };
  }

  function undoCanvas(room, player) {
    if (!room || !player) {
      return { ok: false, message: "플레이어 정보를 확인할 수 없습니다." };
    }

    if (room.phase !== "drawing") {
      return { ok: false, message: "지금은 실행 취소할 수 없습니다." };
    }

    if (room.currentDrawerId !== player.id) {
      return { ok: false, message: "지금은 그림 그리는 사람만 수정할 수 있습니다." };
    }

    if (!room.strokes.length) {
      return { ok: false, message: "되돌릴 선이 없습니다." };
    }

    const stroke = room.strokes.pop();
    room.redoStrokes.push(stroke);
    return { ok: true };
  }

  function redoCanvas(room, player) {
    if (!room || !player) {
      return { ok: false, message: "플레이어 정보를 확인할 수 없습니다." };
    }

    if (room.phase !== "drawing") {
      return { ok: false, message: "지금은 다시 실행할 수 없습니다." };
    }

    if (room.currentDrawerId !== player.id) {
      return { ok: false, message: "지금은 그림 그리는 사람만 수정할 수 있습니다." };
    }

    if (!room.redoStrokes.length) {
      return { ok: false, message: "다시 살릴 선이 없습니다." };
    }

    const stroke = room.redoStrokes.pop();
    room.strokes.push(stroke);
    return { ok: true };
  }

  function chooseWord(room, player, word) {
    if (!room || !player) {
      return { ok: false, message: "플레이어 정보를 확인할 수 없습니다." };
    }

    if (room.phase !== "choosing") {
      return { ok: false, message: "단어를 고를 수 있는 단계가 아닙니다." };
    }

    if (room.currentDrawerId !== player.id) {
      return { ok: false, message: "지금은 단어를 고를 차례가 아닙니다." };
    }

    const choice = room.wordChoices.find((entry) => entry.word === String(word || ""));
    if (!choice) {
      return { ok: false, message: "선택할 수 없는 단어입니다." };
    }

    startDrawingPhase(room, choice);
    return { ok: true };
  }

  function maybeResolveGuess(room, player, text) {
    if (room.phase !== "drawing") {
      return;
    }

    if (player.id === room.currentDrawerId) {
      return;
    }

    if (normalizeGuess(text) !== normalizeGuess(room.currentWord)) {
      return;
    }

    finishTurn(room, { correctGuesserId: player.id });
  }

  function attachSocketToPlayer(room, socket, player) {
    socket.join(room.code);
    bindPlayerSocket(io, player, socket, disconnectTimers);
  }

  function removePlayer(playerId) {
    cancelDisconnect(disconnectTimers, playerId);

    for (const room of rooms.values()) {
      const index = room.players.findIndex((player) => player.id === playerId);
      if (index === -1) {
        continue;
      }

      clearAllTimers(room);
      room.players.splice(index, 1);
      room.turnOrder = room.turnOrder.filter((id) => id !== playerId);

      if (!room.players.length || !room.players.some((player) => !player.isBot)) {
        rooms.delete(room.code);
        deletePersistedRoom(room.code);
        return;
      }

      room.hostId = room.players.find((player) => !player.isBot)?.id || room.players[0].id;

      if (room.phase !== "lobby") {
        resetGame(room);
      }

      broadcastRoom(room);
      return;
    }
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
      broadcastRoom(room);
      return;
    }
  }

  function leaveJoinedRooms(socket) {
    for (const roomName of socket.rooms) {
      if (roomName !== socket.id) {
        socket.leave(roomName);
      }
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

  io.on("connection", (socket) => {
    socket.join(socket.id);

    socket.on("room:create", ({ name, settings }, callback = () => {}) => {
      const safeName = sanitizeName(name);
      const playerId = getSocketPlayerId(socket);

      if (!safeName) {
        callback({ ok: false, message: "닉네임을 먼저 입력하세요." });
        return;
      }

      removePlayer(playerId);
      leaveJoinedRooms(socket);

      const room = createRoom(generateRoomCode(), playerId, socket.id, safeName, settings);
      attachSocketToPlayer(room, socket, room.players[0]);
      broadcastRoom(room);
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
        callback({ ok: false, message: "닉네임을 먼저 입력하세요." });
        return;
      }

      const reconnectingPlayer = room.players.find((player) => player.id === playerId && !player.isBot);
      if (reconnectingPlayer) {
        reconnectingPlayer.name = safeName;
        leaveJoinedRooms(socket);
        attachSocketToPlayer(room, socket, reconnectingPlayer);
        broadcastRoom(room);
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
      attachSocketToPlayer(room, socket, room.players[room.players.length - 1]);
      broadcastRoom(room);
      callback({ ok: true, code: room.code, room: serializeRoom(room, playerId) });
    });

    socket.on("room:state", ({ code }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;

      if (!room || !player) {
        callback({ ok: false, message: "플레이어 정보를 확인할 수 없습니다." });
        return;
      }

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
        callback({ ok: false, message: "방장만 할 수 있습니다." });
        return;
      }

      if (room.phase !== "lobby") {
        callback({ ok: false, message: "대기실에서만 봇을 추가할 수 있습니다." });
        return;
      }

      const openSlots = room.targetPlayerCount - room.players.length;
      const requested = Math.max(1, Math.min(openSlots, Number.parseInt(count, 10) || 1));
      let added = 0;

      for (let index = 0; index < requested; index += 1) {
        if (!addBotToRoom(room)) {
          break;
        }
        added += 1;
      }

      if (!added) {
        callback({ ok: false, message: "추가할 자리가 없습니다." });
        return;
      }

      broadcastRoom(room);
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
        callback({ ok: false, message: "최소 2명이 필요합니다." });
        return;
      }

      if (room.players.length !== room.targetPlayerCount) {
        callback({ ok: false, message: "설정한 인원이 모두 입장해야 시작할 수 있습니다." });
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
      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("word:choose", ({ code, word }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;
      const response = chooseWord(room, player, word);
      if (!response.ok) {
        callback(response);
        return;
      }

      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("draw:stroke", ({ code, stroke }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;
      const response = processDrawStroke(room, player, stroke);
      if (!response.ok) {
        callback(response);
        return;
      }

      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("draw:clear", ({ code }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;
      const response = clearCanvas(room, player);
      if (!response.ok) {
        callback(response);
        return;
      }

      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("draw:undo", ({ code }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;
      const response = undoCanvas(room, player);
      if (!response.ok) {
        callback(response);
        return;
      }

      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("draw:redo", ({ code }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;
      const response = redoCanvas(room, player);
      if (!response.ok) {
        callback(response);
        return;
      }

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

      const message = pushChatMessage(room, player, text);
      if (!message) {
        callback({ ok: false, message: "채팅 내용을 입력하세요." });
        return;
      }

      maybeResolveGuess(room, player, message.text);
      broadcastRoom(room);
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
      if (room.timer) {
        scheduleRoomTimer(room);
        scheduleBotPhase(room);
      }
      persistRoomState(room);
    });

    if (snapshots.length) {
      console.log(`[catch] restored ${snapshots.length} room(s) from Redis`);
    }
  }

  return restorePersistedRooms();
};
