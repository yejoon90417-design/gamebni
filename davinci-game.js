module.exports = function attachDavinciGame(rootIo) {
  const io = rootIo.of("/davinci");
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
  const MAX_PLAYERS = 4;
  const BOT_DELAY_MS = 900;
  const START_ROULETTE_MS = 5800;
  const MAX_CHAT_LENGTH = 140;
  const COLORS = ["black", "white"];
  const VALUES = Array.from({ length: 12 }, (_unused, index) => index);
  const COLOR_TEXT = {
    black: "검정",
    white: "흰색"
  };

  const rooms = new Map();
  const disconnectTimers = new Map();
  const DISCONNECT_GRACE_MS = getDisconnectGraceMs();
  const roomStore = createRoomStore({
    gameKey: "davinci",
    serializeRoom: (room) => snapshotRoom(room, { botTimer: null })
  });
  registerSessionNamespace(io);

  function sanitizeName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 16);
  }

  function sanitizeTargetPlayerCount(value) {
    const count = Number.parseInt(value, 10);
    if (!Number.isInteger(count)) {
      return 2;
    }
    return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, count));
  }

  function sanitizeChatText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CHAT_LENGTH);
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

  function baseSortRank(value, color) {
    return value * 10 + (color === "black" ? 0 : 1);
  }

  function tileCompare(left, right) {
    return left.sortRank - right.sortRank;
  }

  function createDeck() {
    const tiles = [];

    COLORS.forEach((color) => {
      VALUES.forEach((value) => {
        tiles.push({
          id: `${color}:${value}:${Math.random().toString(36).slice(2)}`,
          color,
          kind: "number",
          value,
          sortRank: baseSortRank(value, color),
          revealed: false
        });
      });

      tiles.push({
        id: `${color}:joker:${Math.random().toString(36).slice(2)}`,
        color,
        kind: "joker",
        value: null,
        sortRank: null,
        revealed: false
      });
    });

    return shuffle(tiles);
  }

  function createPlayer(id, name, isBot = false, socketId = null) {
    return {
      id,
      name: sanitizeName(name),
      isBot,
      tiles: [],
      ...createPresenceState(isBot ? null : socketId)
    };
  }

  function createRoom(code, hostId, hostSocketId, hostName, options = {}) {
    const room = {
      code,
      hostId,
      targetPlayerCount: sanitizeTargetPlayerCount(options.targetPlayerCount),
      phase: "lobby",
      players: [createPlayer(hostId, hostName, false, hostSocketId)],
      messages: [],
      deck: [],
      currentPlayerId: null,
      log: [],
      recentAction: null,
      startSelection: null,
      introEndsAt: 0,
      result: null,
      turnDrawnTileId: null,
      canEndTurn: false,
      pendingPenaltyPlayerId: null,
      botTimer: null
    };

    rooms.set(code, room);
    return room;
  }

  function createBotPlayer(room) {
    const count = room.players.filter((player) => player.isBot).length + 1;
    return createPlayer(
      `davinci-bot:${room.code}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
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
      ...player
    }));
    room.messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    room.deck = Array.isArray(snapshot.deck) ? snapshot.deck : [];
    room.log = Array.isArray(snapshot.log) ? snapshot.log : [];
    room.recentAction = snapshot.recentAction || null;
    room.startSelection = snapshot.startSelection || null;
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

  function pushLog(room, text) {
    room.log.push({
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      text,
      createdAt: Date.now()
    });

    if (room.log.length > 120) {
      room.log.shift();
    }
  }

  function setRecentAction(room, text, tone = "neutral") {
    room.recentAction = {
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      text,
      tone,
      createdAt: Date.now()
    };
  }

  function introInProgress(room) {
    return Number.isFinite(room?.introEndsAt) && room.introEndsAt > Date.now();
  }

  function pushMessage(room, player, text) {
    const cleanText = sanitizeChatText(text);
    if (!cleanText) {
      return null;
    }

    room.messages.push({
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      playerId: player.id,
      name: player.name,
      text: cleanText,
      createdAt: Date.now()
    });

    if (room.messages.length > 80) {
      room.messages.shift();
    }

    return room.messages[room.messages.length - 1];
  }

  function clearBotTimer(room) {
    if (!room?.botTimer) {
      return;
    }

    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  function hiddenTiles(player) {
    return player.tiles.filter((tile) => !tile.revealed);
  }

  function isEliminated(player) {
    return hiddenTiles(player).length === 0;
  }

  function activePlayers(room) {
    return room.players.filter((player) => !isEliminated(player));
  }

  function startingTileCount(room) {
    return room.targetPlayerCount === 4 ? 3 : 4;
  }

  function sortTiles(player) {
    player.tiles.sort(tileCompare);
  }

  function assignJokerSortRank(player, tile) {
    const insertionIndex = Math.floor(Math.random() * (player.tiles.length + 1));
    const leftRank = player.tiles[insertionIndex - 1]?.sortRank ?? -10;
    const rightRank = player.tiles[insertionIndex]?.sortRank ?? 120;
    tile.sortRank = (leftRank + rightRank) / 2;
  }

  function deckCountByColor(room, color) {
    return room.deck.reduce((count, tile) => count + (tile.color === color ? 1 : 0), 0);
  }

  function deckCounts(room) {
    return {
      black: deckCountByColor(room, "black"),
      white: deckCountByColor(room, "white")
    };
  }

  function availableDrawColors(room) {
    return COLORS.filter((color) => deckCountByColor(room, color) > 0);
  }

  function drawOne(room, preferredColor = null) {
    if (!room.deck.length) {
      return null;
    }

    if (!preferredColor) {
      return room.deck.pop() || null;
    }

    const indices = [];
    room.deck.forEach((tile, index) => {
      if (tile.color === preferredColor) {
        indices.push(index);
      }
    });

    if (!indices.length) {
      return null;
    }

    const selectedIndex = randomItem(indices);
    const [tile] = room.deck.splice(selectedIndex, 1);
    return tile || null;
  }

  function drawTileToPlayer(room, player, preferredColor = null) {
    const tile = drawOne(room, preferredColor);
    if (!tile) {
      return null;
    }

    if (tile.kind === "joker") {
      assignJokerSortRank(player, tile);
    }

    player.tiles.push(tile);
    sortTiles(player);
    return tile;
  }

  function insertionIndexForTile(tiles, tile) {
    const index = tiles.findIndex((candidate) => tileCompare(tile, candidate) < 0);
    return index === -1 ? tiles.length : index;
  }

  function placementScore(player, tile) {
    const index = insertionIndexForTile(player.tiles, tile);
    const onEdge = index === 0 || index === player.tiles.length;
    const left = player.tiles[index - 1] || null;
    const right = player.tiles[index] || null;

    let score = onEdge ? 2.4 : 0.4;
    score += Math.abs(index - player.tiles.length / 2) * 0.15;

    if (left && left.value === tile.value) {
      score += 0.5;
    }
    if (right && right.value === tile.value) {
      score += 0.5;
    }

    return score;
  }

  function chooseBotDrawColor(room, bot) {
    const colors = availableDrawColors(room);
    if (colors.length <= 1) {
      return colors[0] || null;
    }

    const ranked = colors.map((color) => {
      const candidates = room.deck.filter((tile) => tile.color === color);
      const totalScore = candidates.reduce((sum, tile) => sum + placementScore(bot, tile), 0);
      const averageScore = candidates.length ? totalScore / candidates.length : -Infinity;

      return {
        color,
        score: averageScore + candidates.length * 0.01
      };
    });

    ranked.sort((left, right) => right.score - left.score);
    return ranked[0]?.color || colors[0];
  }

  function revealTile(player, tileId) {
    const tile = player.tiles.find((candidate) => candidate.id === tileId);
    if (!tile || tile.revealed) {
      return null;
    }

    tile.revealed = true;
    return tile;
  }

  function guessLabel(color, guessType, guessValue) {
    return guessType === "joker" ? `${COLOR_TEXT[color]} 조커` : `${COLOR_TEXT[color]} ${guessValue}`;
  }

  function tileRevealLabel(tile) {
    return tile.kind === "joker" ? `${COLOR_TEXT[tile.color]} 조커` : `${COLOR_TEXT[tile.color]} ${tile.value}`;
  }

  function roomCanStart(room) {
    return room.players.length === room.targetPlayerCount;
  }

  function nextAliveIndex(room, startIndex) {
    let index = startIndex;

    do {
      index = (index + 1) % room.players.length;
    } while (isEliminated(room.players[index]));

    return index;
  }

  function finishGame(room, winnerId, reason) {
    clearBotTimer(room);
    room.phase = "result";
    room.result = {
      winnerId,
      reason
    };
    room.currentPlayerId = null;
    room.turnDrawnTileId = null;
    room.canEndTurn = false;
    room.pendingPenaltyPlayerId = null;
    room.introEndsAt = 0;
    pushLog(room, reason);
  }

  function checkWin(room) {
    const alive = activePlayers(room);

    if (alive.length !== 1) {
      return false;
    }

    finishGame(room, alive[0].id, `${alive[0].name} 승리`);
    return true;
  }

  function startCurrentTurn(room) {
    if (checkWin(room)) {
      return;
    }

    room.phase = "draw";
    room.turnDrawnTileId = null;
    room.canEndTurn = false;
    room.pendingPenaltyPlayerId = null;

    const player = getPlayer(room, room.currentPlayerId);
    if (player) {
      pushLog(room, `${player.name} 차례`);
    }
  }

  function nextTurn(room) {
    if (checkWin(room)) {
      return;
    }

    const currentIndex = room.players.findIndex((player) => player.id === room.currentPlayerId);
    const nextIndex = nextAliveIndex(room, currentIndex);
    room.currentPlayerId = room.players[nextIndex].id;
    startCurrentTurn(room);
  }

  function startGame(room) {
    clearBotTimer(room);
    room.deck = createDeck();
    room.log = [];
    room.result = null;
    room.turnDrawnTileId = null;
    room.canEndTurn = false;
    room.pendingPenaltyPlayerId = null;
    room.recentAction = null;
    room.startSelection = null;
    room.introEndsAt = 0;

    room.players.forEach((player) => {
      player.tiles = [];
    });

    const initialCount = startingTileCount(room);
    room.players.forEach((player) => {
      for (let index = 0; index < initialCount; index += 1) {
        drawTileToPlayer(room, player);
      }
    });

    room.currentPlayerId = randomItem(room.players).id;
    room.startSelection = {
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      firstPlayerId: room.currentPlayerId,
      createdAt: Date.now()
    };
    room.introEndsAt = Date.now() + START_ROULETTE_MS;
    pushLog(room, "게임 시작");
    startCurrentTurn(room);
  }

  function resetGame(room) {
    clearBotTimer(room);
    room.phase = "lobby";
    room.deck = [];
    room.currentPlayerId = null;
    room.log = [];
    room.result = null;
    room.turnDrawnTileId = null;
    room.canEndTurn = false;
    room.pendingPenaltyPlayerId = null;
    room.recentAction = null;
    room.startSelection = null;
    room.introEndsAt = 0;
    room.players.forEach((player) => {
      player.tiles = [];
    });
  }

  function serializeTile(tile, viewerIsOwner) {
    const visible = viewerIsOwner || tile.revealed;

    return {
      id: tile.id,
      color: tile.color,
      kind: visible ? tile.kind : null,
      value: visible ? tile.value : null,
      revealed: tile.revealed
    };
  }

  function serializePlayer(room, viewerId, player) {
    const isOwner = viewerId === player.id;

    return {
      id: player.id,
      name: player.name,
      isBot: player.isBot,
      isHost: room.hostId === player.id,
      isEliminated: isEliminated(player),
      hiddenCount: hiddenTiles(player).length,
      tiles: player.tiles.map((tile) => serializeTile(tile, isOwner)),
      connected: isPlayerConnected(player),
      disconnectDeadlineAt: player.disconnectDeadlineAt || null
    };
  }

  function serializeRoom(room, socketId) {
    const me = getPlayer(room, socketId);

    return {
      code: room.code,
      phase: room.phase,
      hostId: room.hostId,
      targetPlayerCount: room.targetPlayerCount,
      currentPlayerId: room.currentPlayerId,
      deckCount: room.deck.length,
      deckCounts: deckCounts(room),
      startSelection: room.startSelection,
      introEndsAt: room.introEndsAt,
      players: room.players.map((player) => serializePlayer(room, socketId, player)),
      me: me ? { id: me.id, name: me.name } : null,
      result: room.result,
      messages: room.messages,
      recentAction: room.recentAction,
      canEndTurn: room.currentPlayerId === socketId ? room.canEndTurn : false,
      pendingPenalty:
        room.phase === "penalty" && room.pendingPenaltyPlayerId === socketId
          ? {
              tileIds: hiddenTiles(me || { tiles: [] }).map((tile) => tile.id)
            }
          : null
    };
  }

  function broadcastRoom(room, options = {}) {
    persistRoomState(room);

    room.players.forEach((player) => {
      if (!player.isBot) {
        io.to(player.id).emit("room:update", serializeRoom(room, player.id));
      }
    });

    if (!options.skipBotSchedule) {
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

      const wasCurrent = room.currentPlayerId === playerId;
      room.players.splice(index, 1);

      if (!room.players.some((player) => !player.isBot)) {
        clearBotTimer(room);
        rooms.delete(room.code);
        deletePersistedRoom(room.code);
        return;
      }

      if (room.hostId === playerId) {
        room.hostId = room.players.find((player) => !player.isBot)?.id || room.players[0].id;
      }

      if (room.phase !== "lobby" && room.phase !== "result") {
        if (room.players.length < MIN_PLAYERS) {
          resetGame(room);
        } else if (wasCurrent) {
          nextTurn(room);
        } else {
          checkWin(room);
        }
      }

      broadcastRoom(room);
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

  function availableBotGuesses(room, bot, targetTile) {
    const knownNumbers = new Set();
    let jokerKnown = false;

    room.players.forEach((player) => {
      player.tiles.forEach((tile) => {
        const visibleToBot = player.id === bot.id || tile.revealed;
        if (!visibleToBot || tile.color !== targetTile.color) {
          return;
        }

        if (tile.kind === "joker") {
          jokerKnown = true;
          return;
        }

        if (tile.kind === "number") {
          knownNumbers.add(tile.value);
        }
      });
    });

    const remaining = VALUES.filter((value) => !knownNumbers.has(value));
    const guesses = (remaining.length ? remaining : VALUES.slice()).map((value) => ({
      type: "number",
      value
    }));

    if (!jokerKnown) {
      guesses.push({
        type: "joker",
        value: null
      });
    }

    return guesses;
  }

  function runBotGuess(room, bot) {
    const targets = activePlayers(room)
      .filter((player) => player.id !== bot.id)
      .flatMap((player) =>
        player.tiles
          .filter((tile) => !tile.revealed)
          .map((tile) => ({
            player,
            tile
          }))
      );

    if (!targets.length) {
      nextTurn(room);
      return;
    }

    const picked = randomItem(targets);
    const guess = randomItem(availableBotGuesses(room, bot, picked.tile));
    const correct =
      picked.tile.kind === "joker"
        ? guess.type === "joker"
        : guess.type === "number" && guess.value === picked.tile.value;
    const guessedText = guessLabel(picked.tile.color, guess.type, guess.value);

    if (correct) {
      picked.tile.revealed = true;
      room.canEndTurn = true;
      pushLog(room, `${bot.name} ${picked.player.name} ${guessedText} 적중`);
      setRecentAction(
        room,
        `${bot.name} -> ${picked.player.name} ${guessedText} 추리 성공`,
        "success"
      );

      if (checkWin(room)) {
        return;
      }

      if (Math.random() < 0.45) {
        nextTurn(room);
      }
      return;
    }

    pushLog(room, `${bot.name} ${picked.player.name} ${guessedText} 실패`);

    if (room.turnDrawnTileId) {
      const drawnTile = revealTile(bot, room.turnDrawnTileId);
      if (drawnTile) {
        pushLog(room, `${bot.name} ${tileRevealLabel(drawnTile)} 공개`);
        setRecentAction(
          room,
          `${bot.name} -> ${picked.player.name} ${guessedText} 추리 실패, ${bot.name} ${tileRevealLabel(drawnTile)} 공개`,
          "fail"
        );
      } else {
        setRecentAction(
          room,
          `${bot.name} -> ${picked.player.name} ${guessedText} 추리 실패`,
          "fail"
        );
      }
      nextTurn(room);
      return;
    }

    const hidden = hiddenTiles(bot)[0];
    if (hidden) {
      hidden.revealed = true;
      pushLog(room, `${bot.name} ${tileRevealLabel(hidden)} 공개`);
      setRecentAction(
        room,
        `${bot.name} -> ${picked.player.name} ${guessedText} 추리 실패, ${bot.name} ${tileRevealLabel(hidden)} 공개`,
        "fail"
      );
    } else {
      setRecentAction(
        room,
        `${bot.name} -> ${picked.player.name} ${guessedText} 추리 실패`,
        "fail"
      );
    }
    nextTurn(room);
  }

  function runBotTurn(roomCode) {
    const room = getRoom(roomCode);
    if (!room || room.phase === "result") {
      return;
    }

    room.botTimer = null;

    const bot = getPlayer(room, room.currentPlayerId);
    if (!bot?.isBot || isEliminated(bot)) {
      return;
    }

    if (introInProgress(room)) {
      scheduleBot(room);
      return;
    }

    if (room.phase === "draw") {
      const chosenColor = chooseBotDrawColor(room, bot);
      const drawn = drawTileToPlayer(room, bot, chosenColor);
      room.turnDrawnTileId = drawn?.id || null;
      room.phase = "guess";
      pushLog(
        room,
        drawn
          ? `${bot.name} ${COLOR_TEXT[chosenColor]} 타일 추가`
          : `${bot.name} 더미 없음`
      );
      broadcastRoom(room);
      return;
    }

    if (room.phase === "guess") {
      runBotGuess(room, bot);
      broadcastRoom(room);
      return;
    }

    if (room.phase === "penalty" && room.pendingPenaltyPlayerId === bot.id) {
      const hidden = hiddenTiles(bot)[0];
      if (hidden) {
        hidden.revealed = true;
        pushLog(room, `${bot.name} ${tileRevealLabel(hidden)} 공개`);
      }
      nextTurn(room);
      broadcastRoom(room);
    }
  }

  function scheduleBot(room) {
    clearBotTimer(room);

    if (!["draw", "guess", "penalty"].includes(room.phase)) {
      return;
    }

    const player = getPlayer(room, room.currentPlayerId);
    if (!player?.isBot || isEliminated(player)) {
      return;
    }

    const introDelay = introInProgress(room) ? room.introEndsAt - Date.now() : 0;
    room.botTimer = setTimeout(() => runBotTurn(room.code), Math.max(BOT_DELAY_MS, introDelay + BOT_DELAY_MS));
  }

  io.on("connection", (socket) => {
    socket.on("room:create", ({ name, targetPlayerCount }, callback = () => {}) => {
      const cleanName = sanitizeName(name);
      const playerId = getSocketPlayerId(socket);

      if (!cleanName) {
        callback({ ok: false, message: "이름을 입력하세요" });
        return;
      }

      removePlayer(playerId);
      leaveJoinedRooms(socket);

      const room = createRoom(generateRoomCode(), playerId, socket.id, cleanName, { targetPlayerCount });
      attachSocketToPlayer(room, socket, room.players[0]);
      broadcastRoom(room);
      callback({ ok: true, code: room.code });
    });

    socket.on("room:join", ({ code, name }, callback = () => {}) => {
      const room = getRoom(code);
      const cleanName = sanitizeName(name);
      const playerId = getSocketPlayerId(socket);

      if (!cleanName) {
        callback({ ok: false, message: "이름을 입력하세요" });
        return;
      }

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      const reconnectingPlayer = room.players.find((player) => player.id === playerId && !player.isBot);
      if (reconnectingPlayer) {
        reconnectingPlayer.name = cleanName;
        leaveJoinedRooms(socket);
        attachSocketToPlayer(room, socket, reconnectingPlayer);
        broadcastRoom(room, { skipBotSchedule: true });
        callback({ ok: true, code: room.code, restored: true });
        return;
      }

      if (room.phase !== "lobby") {
        callback({ ok: false, message: "이미 진행 중입니다" });
        return;
      }

      if (room.players.length >= room.targetPlayerCount) {
        callback({ ok: false, message: "방 인원이 가득 찼습니다" });
        return;
      }

      removePlayer(playerId);
      leaveJoinedRooms(socket);

      room.players.push(createPlayer(playerId, cleanName, false, socket.id));
      attachSocketToPlayer(room, socket, room.players[room.players.length - 1]);
      broadcastRoom(room);
      callback({ ok: true, code: room.code });
    });

    socket.on("room:leave", (_payload = {}, callback = () => {}) => {
      leaveRoomForSocket(socket);
      callback({ ok: true });
    });

    socket.on("room:add_bots", ({ code, count }, callback = () => {}) => {
      const room = getRoom(code);
      const addCount = Number.parseInt(count, 10);
      const playerId = getSocketPlayerId(socket);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (room.hostId !== playerId) {
        callback({ ok: false, message: "호스트만 할 수 있습니다" });
        return;
      }

      if (room.phase !== "lobby") {
        callback({ ok: false, message: "대기 중에만 추가할 수 있습니다" });
        return;
      }

      if (!Number.isInteger(addCount) || addCount < 1) {
        callback({ ok: false, message: "봇 수를 확인하세요" });
        return;
      }

      const remaining = room.targetPlayerCount - room.players.length;
      if (remaining <= 0) {
        callback({ ok: false, message: "이미 목표 인원입니다" });
        return;
      }

      const total = Math.min(addCount, remaining);
      for (let index = 0; index < total; index += 1) {
        addBotToRoom(room);
      }

      broadcastRoom(room);
      callback({ ok: true, added: total });
    });

    socket.on("game:start", ({ code }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (room.hostId !== playerId) {
        callback({ ok: false, message: "호스트만 시작할 수 있습니다" });
        return;
      }

      if (!roomCanStart(room)) {
        callback({ ok: false, message: `목표 인원 ${room.targetPlayerCount}명이 모두 들어와야 합니다` });
        return;
      }

      startGame(room);
      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("turn:draw", ({ code, color }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;
      const selectedColor = COLORS.includes(color) ? color : null;

      if (!room || !player) {
        callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
        return;
      }

      if (room.phase !== "draw" || room.currentPlayerId !== playerId || isEliminated(player)) {
        callback({ ok: false, message: "지금 진행할 수 없습니다" });
        return;
      }

      if (introInProgress(room)) {
        callback({ ok: false, message: "선 정하는 중입니다" });
        return;
      }

      if (room.deck.length > 0 && !selectedColor) {
        callback({ ok: false, message: "가져올 색을 선택하세요" });
        return;
      }

      if (selectedColor && deckCountByColor(room, selectedColor) === 0) {
        callback({ ok: false, message: "선택한 색 타일이 없습니다" });
        return;
      }

      const drawn = drawTileToPlayer(room, player, selectedColor);
      room.turnDrawnTileId = drawn?.id || null;
      room.phase = "guess";
      pushLog(
        room,
        drawn
          ? `${player.name} ${COLOR_TEXT[selectedColor || drawn.color]} 타일 추가`
          : `${player.name} 더미 없음`
      );
      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("turn:guess", ({ code, targetPlayerId, tileId, value, guessType }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;
      const targetPlayer = room ? getPlayer(room, targetPlayerId) : null;
      const guessValue = Number.parseInt(value, 10);
      const normalizedGuessType = guessType === "joker" ? "joker" : "number";

      if (!room || !player || !targetPlayer) {
        callback({ ok: false, message: "대상을 확인할 수 없습니다" });
        return;
      }

      if (room.phase !== "guess" || room.currentPlayerId !== playerId || isEliminated(player)) {
        callback({ ok: false, message: "지금 추리할 수 없습니다" });
        return;
      }

      if (introInProgress(room)) {
        callback({ ok: false, message: "선 정하는 중입니다" });
        return;
      }

      if (targetPlayer.id === player.id || isEliminated(targetPlayer)) {
        callback({ ok: false, message: "상대 타일을 선택하세요" });
        return;
      }

      if (
        normalizedGuessType === "number" &&
        (!Number.isInteger(guessValue) || guessValue < 0 || guessValue > 11)
      ) {
        callback({ ok: false, message: "숫자는 0부터 11까지입니다" });
        return;
      }

      const targetTile = targetPlayer.tiles.find((tile) => tile.id === tileId && !tile.revealed);
      if (!targetTile) {
        callback({ ok: false, message: "숨겨진 타일을 선택하세요" });
        return;
      }

      const guessedText = guessLabel(targetTile.color, normalizedGuessType, guessValue);
      const correct =
        targetTile.kind === "joker"
          ? normalizedGuessType === "joker"
          : normalizedGuessType === "number" && guessValue === targetTile.value;

      if (correct) {
        targetTile.revealed = true;
        room.canEndTurn = true;
        pushLog(room, `${player.name} ${targetPlayer.name} ${guessedText} 적중`);
        setRecentAction(
          room,
          `${player.name} -> ${targetPlayer.name} ${guessedText} 추리 성공`,
          "success"
        );
        checkWin(room);
        broadcastRoom(room);
        callback({ ok: true, correct: true });
        return;
      }

      pushLog(room, `${player.name} ${targetPlayer.name} ${guessedText} 실패`);

      if (room.turnDrawnTileId) {
        const drawnTile = revealTile(player, room.turnDrawnTileId);
        if (drawnTile) {
          pushLog(room, `${player.name} ${tileRevealLabel(drawnTile)} 공개`);
          setRecentAction(
            room,
            `${player.name} -> ${targetPlayer.name} ${guessedText} 추리 실패, ${player.name} ${tileRevealLabel(drawnTile)} 공개`,
            "fail"
          );
        } else {
          setRecentAction(
            room,
            `${player.name} -> ${targetPlayer.name} ${guessedText} 추리 실패`,
            "fail"
          );
        }
        nextTurn(room);
        broadcastRoom(room);
        callback({ ok: true, correct: false });
        return;
      }

      const hasPenaltyTarget = hiddenTiles(player).length > 0;
      if (hasPenaltyTarget) {
        room.phase = "penalty";
        room.pendingPenaltyPlayerId = player.id;
        room.canEndTurn = false;
        setRecentAction(
          room,
          `${player.name} -> ${targetPlayer.name} ${guessedText} 추리 실패, 공개할 타일 선택`,
          "fail"
        );
        broadcastRoom(room);
        callback({ ok: true, correct: false });
        return;
      }

      setRecentAction(
        room,
        `${player.name} -> ${targetPlayer.name} ${guessedText} 추리 실패`,
        "fail"
      );
      nextTurn(room);
      broadcastRoom(room);
      callback({ ok: true, correct: false });
    });

    socket.on("turn:reveal_penalty", ({ code, tileId }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;

      if (!room || !player) {
        callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
        return;
      }

      if (room.phase !== "penalty" || room.pendingPenaltyPlayerId !== playerId) {
        callback({ ok: false, message: "지금 공개할 수 없습니다" });
        return;
      }

      if (introInProgress(room)) {
        callback({ ok: false, message: "선 정하는 중입니다" });
        return;
      }

      const tile = revealTile(player, tileId);
      if (!tile) {
        callback({ ok: false, message: "숨겨진 타일을 선택하세요" });
        return;
      }

      pushLog(room, `${player.name} ${tileRevealLabel(tile)} 공개`);
      nextTurn(room);
      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("turn:end", ({ code }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;

      if (!room || !player) {
        callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
        return;
      }

      if (room.phase !== "guess" || room.currentPlayerId !== playerId || !room.canEndTurn) {
        callback({ ok: false, message: "지금 끝낼 수 없습니다" });
        return;
      }

      if (introInProgress(room)) {
        callback({ ok: false, message: "선 정하는 중입니다" });
        return;
      }

      nextTurn(room);
      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("game:reset", ({ code }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (room.hostId !== playerId) {
        callback({ ok: false, message: "호스트만 할 수 있습니다" });
        return;
      }

      resetGame(room);
      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("chat:send", ({ code, text }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;

      if (!room || !player) {
        callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
        return;
      }

      if (!pushMessage(room, player, text)) {
        callback({ ok: false, message: "메시지를 입력하세요" });
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
      console.log(`[davinci] restored ${snapshots.length} room(s) from Redis`);
    }
  }

  return restorePersistedRooms();
};


