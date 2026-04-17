module.exports = function attachMemoryGame(rootIo) {
  const io = rootIo.of("/memory");
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
  const TOTAL_CARD_COUNT_OPTIONS = [16, 20, 24, 30, 36, 40];
  const DEFAULT_TOTAL_CARD_COUNT_BY_PLAYER_COUNT = {
    2: 16,
    3: 20,
    4: 30,
    5: 40
  };
  const MAX_CHAT_LENGTH = 140;
  const MAX_MESSAGES = 80;
  const PREVIEW_DURATION_MS = 10000;
  const MISMATCH_DELAY_MS = 2800;
  const BOT_FLIP_DELAY_MIN_MS = 850;
  const BOT_FLIP_DELAY_MAX_MS = 1450;

  const rooms = new Map();
  const disconnectTimers = new Map();
  const DISCONNECT_GRACE_MS = getDisconnectGraceMs();
  const roomStore = createRoomStore({
    gameKey: "memory",
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

  function sanitizeSettings(input = {}) {
    const targetPlayerCount = Number.parseInt(input.targetPlayerCount, 10);
    const totalCardCount = Number.parseInt(input.totalCardCount, 10);
    const normalizedTargetPlayerCount = TARGET_PLAYER_OPTIONS.includes(targetPlayerCount)
      ? targetPlayerCount
      : DEFAULT_TARGET_PLAYER_COUNT;

    return {
      targetPlayerCount: normalizedTargetPlayerCount,
      totalCardCount: TOTAL_CARD_COUNT_OPTIONS.includes(totalCardCount)
        ? totalCardCount
        : DEFAULT_TOTAL_CARD_COUNT_BY_PLAYER_COUNT[normalizedTargetPlayerCount]
    };
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

  function createPlayer(id, name, isBot = false, socketId = null) {
    return {
      id,
      name: sanitizeName(name),
      isBot,
      ...createPresenceState(isBot ? null : socketId)
    };
  }

  function createDeck(totalCardCount) {
    const pairCount = Math.max(2, Math.floor((Number(totalCardCount) || 16) / 2));
    const entries = [];

    for (let index = 0; index < pairCount; index += 1) {
      const pairKey = `pair${String(index + 1).padStart(2, "0")}`;
      entries.push({ pairKey, copy: 1 });
      entries.push({ pairKey, copy: 2 });
    }

    return shuffle(entries).map((entry, index) => ({
      id: `card:${index + 1}`,
      pairKey: entry.pairKey,
      faceUp: false,
      matchedBy: null
    }));
  }

  function createRoom(code, hostId, hostSocketId, hostName, options = {}) {
    const settings = sanitizeSettings(options);
    const room = {
      code,
      hostId,
      phase: "lobby",
      targetPlayerCount: settings.targetPlayerCount,
      totalCardCount: settings.totalCardCount,
      players: [createPlayer(hostId, hostName, false, hostSocketId)],
      messages: [],
      turnOrder: [],
      currentPlayerId: null,
      turnNumber: 0,
      cards: [],
      flippedCardIds: [],
      preview: null,
      pendingHide: null,
      recentAction: null,
      result: null,
      resolutionTimer: null,
      botTimers: new Set()
    };

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
      resolutionTimer: null,
      botTimers: new Set()
    };

    room.players = (snapshot.players || []).map((player) => ({
      ...createPresenceState(),
      ...player
    }));
    room.targetPlayerCount = TARGET_PLAYER_OPTIONS.includes(room.targetPlayerCount)
      ? room.targetPlayerCount
      : DEFAULT_TARGET_PLAYER_COUNT;
    room.totalCardCount = TOTAL_CARD_COUNT_OPTIONS.includes(room.totalCardCount)
      ? room.totalCardCount
      : DEFAULT_TOTAL_CARD_COUNT_BY_PLAYER_COUNT[room.targetPlayerCount];
    room.messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    room.turnOrder = Array.isArray(snapshot.turnOrder) ? snapshot.turnOrder : [];
    room.cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
    room.flippedCardIds = Array.isArray(snapshot.flippedCardIds) ? snapshot.flippedCardIds : [];
    room.preview = snapshot.preview || null;
    room.pendingHide = snapshot.pendingHide || null;
    room.recentAction = snapshot.recentAction || null;
    room.result = snapshot.result || null;
    return room;
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

  function clearAllTimers(room) {
    clearResolutionTimer(room);
    clearBotTimers(room);
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

  function appendMessage(room, message) {
    room.messages.push(message);
    if (room.messages.length > MAX_MESSAGES) {
      room.messages.shift();
    }
    return room.messages[room.messages.length - 1];
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

  function pushSystemMessage(room, text) {
    const cleanText = sanitizeChatText(text);
    if (!cleanText || !cleanText.includes("짝 맞춤 · 카드 2장 획득")) {
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

  function setRecentAction(room, text, tone = "neutral") {
    room.recentAction = {
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      text,
      tone,
      createdAt: Date.now()
    };
  }

  function resetGame(room) {
    clearAllTimers(room);
    room.phase = "lobby";
    room.turnOrder = [];
    room.currentPlayerId = null;
    room.turnNumber = 0;
    room.cards = [];
    room.flippedCardIds = [];
    room.preview = null;
    room.pendingHide = null;
    room.recentAction = null;
    room.result = null;
  }

  function countClaimedCards(room, playerId) {
    return room.cards.filter((card) => card.matchedBy === playerId).length;
  }

  function allCardsMatched(room) {
    return room.cards.length > 0 && room.cards.every((card) => card.matchedBy);
  }

  function nextPlayerId(room, fromPlayerId = room.currentPlayerId) {
    const orderedIds = room.turnOrder.filter((playerId) => room.players.some((player) => player.id === playerId));

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
    room.turnNumber += 1;
    room.flippedCardIds = [];
    room.preview = null;
    room.pendingHide = null;
    const currentPlayer = getPlayer(room, playerId);
    setRecentAction(room, `${currentPlayer?.name || "플레이어"} 차례`, "neutral");
  }

  function advanceTurn(room) {
    const playerId = nextPlayerId(room);
    if (!playerId) {
      finishGame(room, [], "플레이어가 부족해 게임이 종료되었습니다");
      return;
    }

    startTurn(room, playerId);
  }

  function winnerIdsByScore(room) {
    let bestScore = -1;
    let winnerIds = [];

    room.players.forEach((player) => {
      const score = countClaimedCards(room, player.id);
      if (score > bestScore) {
        bestScore = score;
        winnerIds = [player.id];
        return;
      }

      if (score === bestScore) {
        winnerIds.push(player.id);
      }
    });

    return winnerIds;
  }

  function winnerReason(room, winnerIds) {
    if (!winnerIds.length) {
      return "게임 종료";
    }

    const names = winnerIds
      .map((winnerId) => getPlayer(room, winnerId)?.name)
      .filter(Boolean);

    return names.length === 1 ? `${names[0]} 승리` : `${names.join(", ")} 공동 승리`;
  }

  function finishGame(room, winnerIds, reason) {
    clearResolutionTimer(room);
    room.phase = "result";
    room.currentPlayerId = null;
    room.flippedCardIds = [];
    room.pendingHide = null;
    room.result = {
      winnerIds,
      reason
    };
    setRecentAction(room, reason, winnerIds.length === 1 ? "success" : "neutral");
  }

  function serializeCard(room, card) {
    const visible = room.phase === "preview" || card.faceUp || Boolean(card.matchedBy);
    return {
      id: card.id,
      faceUp: card.faceUp,
      matched: Boolean(card.matchedBy),
      matchedBy: card.matchedBy,
      pairKey: visible ? card.pairKey : null
    };
  }

  function serializePlayer(room, player) {
    const claimedCards = countClaimedCards(room, player.id);
    return {
      id: player.id,
      name: player.name,
      isBot: player.isBot,
      isHost: room.hostId === player.id,
      isCurrent: room.currentPlayerId === player.id,
      connected: isPlayerConnected(player),
      disconnectDeadlineAt: player.disconnectDeadlineAt || null,
      claimedCards,
      claimedPairs: Math.floor(claimedCards / 2)
    };
  }

  function serializeRoom(room, socketId) {
    const me = getPlayer(room, socketId);

    return {
      code: room.code,
      phase: room.phase,
      hostId: room.hostId,
      targetPlayerCount: room.targetPlayerCount,
      totalCardCount: room.totalCardCount,
      turnOrder: room.turnOrder,
      currentPlayerId: room.currentPlayerId,
      turnNumber: room.turnNumber,
      recentAction: room.recentAction,
      result: room.result,
      previewMs: room.preview ? Math.max(room.preview.dueAt - Date.now(), 0) : 0,
      pendingHideMs: room.pendingHide ? Math.max(room.pendingHide.dueAt - Date.now(), 0) : 0,
      remainingCards: room.cards.filter((card) => !card.matchedBy).length,
      canFlip:
        room.phase === "playing" &&
        me?.id === room.currentPlayerId &&
        !room.pendingHide,
      cards: room.cards.map((card) => serializeCard(room, card)),
      messages: room.messages,
      players: room.players.map((player) => serializePlayer(room, player)),
      me: me ? serializePlayer(room, me) : null
    };
  }

  function nextBotCardId(room) {
    const candidates = room.cards.filter((card) => !card.faceUp && !card.matchedBy);
    if (!candidates.length) {
      return null;
    }

    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    return selected?.id || null;
  }

  function createBotPlayer(room) {
    const count = room.players.filter((player) => player.isBot).length + 1;
    return createPlayer(
      `memory-bot:${room.code}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      `BOT ${count}`,
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

  function processCardFlip(room, player, cardId) {
    if (!room || !player) {
      return { ok: false, message: "플레이어 정보를 확인할 수 없습니다." };
    }

    if (room.phase !== "playing") {
      return { ok: false, message: "진행 중인 게임이 아닙니다." };
    }

    if (room.currentPlayerId !== player.id) {
      return { ok: false, message: "지금은 당신 차례가 아닙니다." };
    }

    if (room.pendingHide) {
      return { ok: false, message: "카드가 다시 뒤집히는 중입니다." };
    }

    const card = room.cards.find((candidate) => candidate.id === cardId);
    if (!card) {
      return { ok: false, message: "카드를 찾을 수 없습니다." };
    }

    if (card.faceUp || card.matchedBy) {
      return { ok: false, message: "이미 열린 카드입니다." };
    }

    card.faceUp = true;
    room.flippedCardIds.push(card.id);

    if (room.flippedCardIds.length === 1) {
      setRecentAction(room, `${player.name} 첫 카드`, "neutral");
      return { ok: true };
    }

    const openedCards = room.flippedCardIds
      .map((openedId) => room.cards.find((candidate) => candidate.id === openedId))
      .filter(Boolean);

    if (openedCards.length < 2) {
      return { ok: true };
    }

    const [firstCard, secondCard] = openedCards;
    if (firstCard.pairKey === secondCard.pairKey) {
      firstCard.matchedBy = player.id;
      secondCard.matchedBy = player.id;
      firstCard.faceUp = true;
      secondCard.faceUp = true;
      room.flippedCardIds = [];
      setRecentAction(room, `${player.name} 짝 맞춤`, "success");
      pushSystemMessage(room, `${player.name} 짝 맞춤 · 카드 2장 획득`);

      if (allCardsMatched(room)) {
        const winnerIds = winnerIdsByScore(room);
        finishGame(room, winnerIds, winnerReason(room, winnerIds));
        return { ok: true };
      }

      setRecentAction(room, `${player.name} 한 번 더`, "success");
      return { ok: true };
    }

    room.pendingHide = {
      cardIds: room.flippedCardIds.slice(0, 2),
      dueAt: Date.now() + MISMATCH_DELAY_MS,
      playerId: player.id
    };
    setRecentAction(room, `${player.name} 불일치`, "neutral");
    schedulePendingHide(room);
    return { ok: true };
  }

  function scheduleRoomFlow(room) {
    clearBotTimers(room);

    if (!room || room.phase !== "playing" || room.pendingHide) {
      return;
    }

    const currentPlayer = getPlayer(room, room.currentPlayerId);
    if (!currentPlayer?.isBot) {
      return;
    }

    scheduleBotTimer(
      room,
      () => {
        const latestRoom = getRoom(room.code);
        if (!latestRoom || latestRoom.phase !== "playing" || latestRoom.pendingHide) {
          return;
        }

        const latestPlayer = getPlayer(latestRoom, latestRoom.currentPlayerId);
        if (!latestPlayer?.isBot) {
          return;
        }

        const cardId = nextBotCardId(latestRoom);
        if (!cardId) {
          return;
        }

        processCardFlip(latestRoom, latestPlayer, cardId);
        broadcastRoom(latestRoom);
      },
      randomBetween(BOT_FLIP_DELAY_MIN_MS, BOT_FLIP_DELAY_MAX_MS)
    );
  }

  function broadcastRoom(room, options = {}) {
    const { skipFlow = false } = options;
    persistRoomState(room);

    room.players.forEach((player) => {
      if (!player.isBot) {
        io.to(player.id).emit("room:update", serializeRoom(room, player.id));
      }
    });

    if (!skipFlow) {
      scheduleRoomFlow(room);
    }
  }

  function resolveMismatch(roomCode) {
    const room = getRoom(roomCode);
    if (!room || room.phase !== "playing" || !room.pendingHide) {
      return;
    }

    clearResolutionTimer(room);
    const pending = room.pendingHide;

    pending.cardIds.forEach((cardId) => {
      const card = room.cards.find((candidate) => candidate.id === cardId);
      if (card && !card.matchedBy) {
        card.faceUp = false;
      }
    });

    room.flippedCardIds = [];
    room.pendingHide = null;
    advanceTurn(room);
    broadcastRoom(room);
  }

  function resolvePreview(roomCode) {
    const room = getRoom(roomCode);
    if (!room || room.phase !== "preview" || !room.preview) {
      return;
    }

    clearResolutionTimer(room);
    room.preview = null;

    const firstPlayerId = room.turnOrder[0] || null;
    if (!firstPlayerId) {
      finishGame(room, [], "게임 종료");
      broadcastRoom(room, { skipFlow: true });
      return;
    }

    room.phase = "playing";
    startTurn(room, firstPlayerId);
    broadcastRoom(room);
  }

  function schedulePreview(room) {
    clearResolutionTimer(room);

    if (!room?.preview) {
      return;
    }

    const delay = Math.max(room.preview.dueAt - Date.now(), 20);
    room.resolutionTimer = setTimeout(() => {
      resolvePreview(room.code);
    }, delay);
  }

  function schedulePendingHide(room) {
    clearResolutionTimer(room);

    if (!room?.pendingHide) {
      return;
    }

    const delay = Math.max(room.pendingHide.dueAt - Date.now(), 20);
    room.resolutionTimer = setTimeout(() => {
      resolveMismatch(room.code);
    }, delay);
  }

  function startGame(room) {
    clearAllTimers(room);
    room.phase = "preview";
    room.result = null;
    room.cards = createDeck(room.totalCardCount);
    room.turnOrder = room.players.map((player) => player.id);
    room.currentPlayerId = null;
    room.turnNumber = 0;
    room.flippedCardIds = [];
    room.preview = {
      dueAt: Date.now() + PREVIEW_DURATION_MS
    };
    room.pendingHide = null;
    setRecentAction(room, "전체 카드 10초 공개", "neutral");
    schedulePreview(room);
  }

  function removePlayer(playerId) {
    cancelDisconnect(disconnectTimers, playerId);

    for (const room of rooms.values()) {
      const index = room.players.findIndex((player) => player.id === playerId);
      if (index === -1) {
        continue;
      }

      const removedPlayer = room.players[index];
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

      broadcastRoom(room, { skipFlow: true });
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
      broadcastRoom(room, { skipFlow: true });
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
      broadcastRoom(room, { skipFlow: true });
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
        broadcastRoom(room, { skipFlow: true });
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
      broadcastRoom(room, { skipFlow: true });
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

      broadcastRoom(room, { skipFlow: true });
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

    socket.on("card:flip", ({ code, cardId }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;
      const response = processCardFlip(room, player, cardId);
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

      if (!pushChatMessage(room, player, text)) {
        callback({ ok: false, message: "채팅 내용을 입력하세요." });
        return;
      }

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
      if (room.preview) {
        schedulePreview(room);
      }
      if (room.pendingHide) {
        schedulePendingHide(room);
      }
      if (room.phase === "playing" && !room.pendingHide) {
        scheduleRoomFlow(room);
      }
      persistRoomState(room);
    });

    if (snapshots.length) {
      console.log(`[memory] restored ${snapshots.length} room(s) from Redis`);
    }
  }

  return restorePersistedRooms();
};
