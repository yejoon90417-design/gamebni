module.exports = function attachHalliGame(rootIo) {
  const io = rootIo.of("/halli");

  const ROOM_CODE_LENGTH = 5;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 6;
  const DEFAULT_TARGET_PLAYER_COUNT = 4;
  const TARGET_PLAYER_OPTIONS = [2, 3, 4, 5, 6];
  const MAX_CHAT_LENGTH = 140;
  const BOT_FLIP_DELAY_MIN_MS = 1000;
  const BOT_FLIP_DELAY_MAX_MS = 1750;
  const BOT_RING_DELAY_MIN_MS = 850;
  const BOT_RING_DELAY_MAX_MS = 1550;
  const RING_SUCCESS_GRACE_MS = 240;
  const FRUITS = [
    { key: "banana", label: "바나나" },
    { key: "strawberry", label: "딸기" },
    { key: "lime", label: "라임" },
    { key: "plum", label: "자두" }
  ];
  const DECK_PATTERN = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5];
  const PHASE_TEXT = {
    lobby: "대기",
    playing: "진행",
    result: "결과"
  };

  const rooms = new Map();

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

  function fruitLabel(fruitKey) {
    return FRUITS.find((fruit) => fruit.key === fruitKey)?.label || fruitKey;
  }

  function createDeck() {
    const cards = [];
    let sequence = 0;

    FRUITS.forEach((fruit) => {
      DECK_PATTERN.forEach((count) => {
        cards.push({
          id: `halli:${fruit.key}:${count}:${sequence}`,
          fruit: fruit.key,
          count
        });
        sequence += 1;
      });
    });

    return cards;
  }

  function createPlayer(id, name, isBot = false) {
    return {
      id,
      name: sanitizeName(name),
      isBot,
      drawPile: [],
      faceUpPile: []
    };
  }

  function createRoom(code, hostId, hostName, options = {}) {
    const settings = sanitizeSettings(options);
    const room = {
      code,
      hostId,
      phase: "lobby",
      targetPlayerCount: settings.targetPlayerCount,
      players: [createPlayer(hostId, hostName)],
      messages: [],
      startedPlayerCount: 0,
      currentPlayerId: null,
      lastFlipperId: null,
      recentAction: null,
      transferEffect: null,
      bellMotion: null,
      bellGraceUntil: 0,
      result: null,
      botTimers: new Set()
    };

    rooms.set(code, room);
    return room;
  }

  function getRoom(code) {
    return rooms.get(String(code || "").toUpperCase()) || null;
  }

  function getPlayer(room, playerId) {
    return room.players.find((player) => player.id === playerId) || null;
  }

  function totalCards(player) {
    return player.drawPile.length + player.faceUpPile.length;
  }

  function isEliminated(player) {
    return totalCards(player) === 0;
  }

  function isActive(player) {
    return totalCards(player) > 0;
  }

  function canFlip(player) {
    return player.drawPile.length > 0;
  }

  function getActivePlayers(room) {
    return room.players.filter(isActive);
  }

  function getFlippablePlayers(room) {
    return room.players.filter(canFlip);
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
    clearBotTimers(room);
  }

  function scheduleBotTimer(room, callback, delayMs) {
    const timerId = setTimeout(() => {
      room.botTimers.delete(timerId);
      callback();
    }, delayMs);

    room.botTimers.add(timerId);
  }

  function setRecentAction(room, text, tone = "neutral") {
    room.recentAction = {
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      text,
      tone,
      createdAt: Date.now()
    };
  }

  function clearTransferEffect(room) {
    room.transferEffect = null;
  }

  function setTransferEffect(room, type, transfers) {
    const normalizedTransfers = (transfers || [])
      .filter((transfer) => transfer && transfer.count > 0)
      .map((transfer) => ({
        fromPlayerId: transfer.fromPlayerId,
        toPlayerId: transfer.toPlayerId,
        count: transfer.count
      }));

    if (!normalizedTransfers.length) {
      room.transferEffect = null;
      return;
    }

    room.transferEffect = {
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      type,
      transfers: normalizedTransfers,
      createdAt: Date.now()
    };
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

    if (room.messages.length > 120) {
      room.messages.shift();
    }

    return room.messages[room.messages.length - 1];
  }

  function pushSystemMessage(room, text) {
    const cleanText = sanitizeChatText(text);
    if (!cleanText) {
      return null;
    }

    room.messages.push({
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      playerId: null,
      name: "SYSTEM",
      text: cleanText,
      createdAt: Date.now(),
      kind: "system"
    });

    if (room.messages.length > 120) {
      room.messages.shift();
    }

    return room.messages[room.messages.length - 1];
  }

  function visibleFruitTotals(room) {
    const totals = Object.fromEntries(FRUITS.map((fruit) => [fruit.key, 0]));

    room.players.forEach((player) => {
      const topCard = player.faceUpPile[player.faceUpPile.length - 1];
      if (!topCard) {
        return;
      }

      totals[topCard.fruit] += topCard.count;
    });

    return totals;
  }

  function exactFiveFruit(room) {
    const totals = visibleFruitTotals(room);
    return FRUITS.find((fruit) => totals[fruit.key] === 5)?.key || null;
  }

  function serializeCard(card) {
    if (!card) {
      return null;
    }

    return {
      id: card.id,
      fruit: card.fruit,
      count: card.count
    };
  }

  function serializePlayer(room, player) {
    return {
      id: player.id,
      name: player.name,
      isBot: player.isBot,
      isHost: room.hostId === player.id,
      isCurrent: room.currentPlayerId === player.id,
      drawCount: player.drawPile.length,
      faceUpCount: player.faceUpPile.length,
      totalCards: totalCards(player),
      topCard: serializeCard(player.faceUpPile[player.faceUpPile.length - 1] || null),
      isEliminated: isEliminated(player)
    };
  }

  function serializeRoom(room, socketId) {
    const me = getPlayer(room, socketId);
    const totals = visibleFruitTotals(room);
    const exactFruit = exactFiveFruit(room);

    return {
      code: room.code,
      serverNow: Date.now(),
      phase: room.phase,
      phaseText: PHASE_TEXT[room.phase] || room.phase,
      hostId: room.hostId,
      targetPlayerCount: room.targetPlayerCount,
      currentPlayerId: room.currentPlayerId,
      lastFlipperId: room.lastFlipperId,
      recentAction: room.recentAction,
      transferEffect: room.transferEffect,
      bellMotion: room.bellMotion,
      result: room.result,
      messages: room.messages,
      visibleTotals: FRUITS.map((fruit) => ({
        fruit: fruit.key,
        label: fruit.label,
        total: totals[fruit.key]
      })),
      exactFiveFruit: exactFruit,
      players: room.players.map((player) => serializePlayer(room, player)),
      me: me ? serializePlayer(room, me) : null
    };
  }

  function nextFlippableAfter(room, playerId) {
    if (!room.players.length) {
      return null;
    }

    const startIndex = Math.max(
      0,
      room.players.findIndex((player) => player.id === playerId)
    );

    for (let offset = 1; offset <= room.players.length; offset += 1) {
      const candidate = room.players[(startIndex + offset) % room.players.length];
      if (canFlip(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function nextFlippablePlayer(room) {
    return getFlippablePlayers(room)[0] || null;
  }

  function collectFaceUpCards(room) {
    const collected = [];
    const transfers = [];

    room.players.forEach((player) => {
      const count = player.faceUpPile.length;
      if (!count) {
        return;
      }

      transfers.push({
        fromPlayerId: player.id,
        count
      });
      collected.push(...player.faceUpPile);
      player.faceUpPile = [];
    });

    return {
      cards: collected,
      transfers
    };
  }

  function awardFaceUpCards(room, winner) {
    const collected = collectFaceUpCards(room);
    if (collected.cards.length) {
      winner.drawPile = collected.cards.concat(winner.drawPile);
    }
    return {
      count: collected.cards.length,
      transfers: collected.transfers
        .filter((transfer) => transfer.fromPlayerId !== winner.id)
        .map((transfer) => ({
          fromPlayerId: transfer.fromPlayerId,
          toPlayerId: winner.id,
          count: transfer.count
        }))
    };
  }

  function applyFalseBellPenalty(room, player) {
    let transferred = 0;
    const transfers = [];

    getActivePlayers(room)
      .filter((target) => target.id !== player.id)
      .forEach((target) => {
        if (!player.drawPile.length) {
          return;
        }

        const card = player.drawPile.pop();
        target.drawPile = [card, ...target.drawPile];
        transferred += 1;
        transfers.push({
          fromPlayerId: player.id,
          toPlayerId: target.id,
          count: 1
        });
      });

    return {
      count: transferred,
      transfers
    };
  }

  function endByCardCount(room, reason) {
    clearAllTimers(room);
    room.phase = "result";
    room.currentPlayerId = null;
    room.lastFlipperId = null;

    const ranking = room.players
      .map((player) => ({
        id: player.id,
        name: player.name,
        count: totalCards(player)
      }))
      .sort((left, right) => right.count - left.count);

    const topCount = ranking[0]?.count ?? 0;
    const winners = ranking.filter((entry) => entry.count === topCount);
    const winnerId = winners.length === 1 ? winners[0].id : null;
    const winnerName = winners.length === 1 ? winners[0].name : "무승부";
    const summary =
      winners.length === 1 ? `게임 종료 · ${winnerName} 승리` : "게임 종료 · 무승부";

    room.result = {
      winnerId,
      reason: summary,
      scores: ranking
    };

    setRecentAction(room, summary, winnerId ? "success" : "neutral");
    pushSystemMessage(room, summary);
  }

  function resetStacks(room) {
    clearAllTimers(room);
    room.currentPlayerId = null;
    room.lastFlipperId = null;
    room.startedPlayerCount = 0;
    room.recentAction = null;
    clearTransferEffect(room);
    room.bellMotion = null;
    room.bellGraceUntil = 0;
    room.result = null;
    room.players.forEach((player) => {
      player.drawPile = [];
      player.faceUpPile = [];
    });
  }

  function refreshBellMotion(room) {
    room.bellMotion = {
      seed: Math.floor(Math.random() * 0x7fffffff),
      startedAt: Date.now(),
      segmentMs: 1850
    };
  }

  function resetGame(room) {
    room.phase = "lobby";
    resetStacks(room);
  }

  function startGame(room) {
    resetStacks(room);
    room.phase = "playing";
    room.startedPlayerCount = room.players.length;
    refreshBellMotion(room);

    const deck = shuffle(createDeck());
    deck.forEach((card, index) => {
      room.players[index % room.players.length].drawPile.push(card);
    });

    const firstPlayer = room.players[Math.floor(Math.random() * room.players.length)];
    room.currentPlayerId = firstPlayer.id;
    setRecentAction(room, `${firstPlayer.name}부터 시작`, "neutral");
    pushSystemMessage(room, `${firstPlayer.name}부터 시작`);
  }

  function finishIfGameOver(room, reason) {
    const activePlayers = getActivePlayers(room);

    if (activePlayers.length <= 1) {
      endByCardCount(room, reason);
      return true;
    }

    return false;
  }

  function handleRing(room, player) {
    if (room.phase !== "playing") {
      return {
        ok: false,
        message: "지금은 종을 칠 수 없습니다"
      };
    }

    if (room.bellGraceUntil && Date.now() <= room.bellGraceUntil) {
      return {
        ok: false,
        message: "방금 처리된 종입니다"
      };
    }

    clearBotTimers(room);

    const fruit = exactFiveFruit(room);
    if (fruit) {
      const collected = awardFaceUpCards(room, player);
      setTransferEffect(room, "collect", collected.transfers);
      room.bellGraceUntil = Date.now() + RING_SUCCESS_GRACE_MS;
      room.currentPlayerId = player.id;
      room.lastFlipperId = null;
      pushSystemMessage(
        room,
        `${player.name} 종 성공 · ${fruitLabel(fruit)} 합 5 · 카드 ${collected.count}장 획득`
      );

      if (finishIfGameOver(room, `${player.name} 종 성공`)) {
        return { ok: true };
      }

      setRecentAction(room, `${player.name} 종 성공 · ${fruitLabel(fruit)} 5`, "success");
      return { ok: true };
    }

    const penalty = applyFalseBellPenalty(room, player);
    room.bellGraceUntil = 0;
    setTransferEffect(room, "penalty", penalty.transfers);
    pushSystemMessage(room, `${player.name} 오판 · 패널티 ${penalty.count}장`);

    if (finishIfGameOver(room, `${player.name} 오판`)) {
      return { ok: true };
    }

    const currentPlayer = getPlayer(room, room.currentPlayerId);
    const nextPlayer =
      currentPlayer && canFlip(currentPlayer)
        ? currentPlayer
        : currentPlayer
          ? nextFlippableAfter(room, currentPlayer.id)
          : nextFlippablePlayer(room);

    if (!nextPlayer) {
      endByCardCount(room, `${player.name} 오판`);
      return { ok: true };
    }

    room.currentPlayerId = nextPlayer.id;
    setRecentAction(
      room,
      `${player.name} 오판 · 패널티 ${penalty.count}장 · ${nextPlayer.name} 차례`,
      "danger"
    );
    return { ok: true };
  }

function flipCard(room, player) {
    if (!canFlip(player)) {
      return {
        ok: false,
        message: "뒤집을 카드가 없습니다"
      };
    }

    const card = player.drawPile.pop();
    player.faceUpPile.push(card);
    room.lastFlipperId = player.id;
    setRecentAction(room, `${player.name} 뒤집기 · ${fruitLabel(card.fruit)} ${card.count}`, "neutral");
    const nextPlayer = nextFlippableAfter(room, player.id);
    room.currentPlayerId = nextPlayer?.id || null;

    return {
      ok: true,
      card
    };
  }

function scheduleBotRings(room) {
    const fruit = exactFiveFruit(room);
    if (!fruit) {
      return;
    }

    room.players.forEach((player) => {
      if (!player.isBot || !isActive(player)) {
        return;
      }

      scheduleBotTimer(room, () => {
        const latestRoom = getRoom(room.code);
        if (!latestRoom || latestRoom.phase !== "playing" || !exactFiveFruit(latestRoom)) {
          return;
        }

        const latestPlayer = getPlayer(latestRoom, player.id);
        if (!latestPlayer || !latestPlayer.isBot || !isActive(latestPlayer)) {
          return;
        }

        handleRing(latestRoom, latestPlayer);
        broadcastRoom(latestRoom);
      }, randomBetween(BOT_RING_DELAY_MIN_MS, BOT_RING_DELAY_MAX_MS));
    });
  }

  function scheduleRoomFlow(room) {
  clearBotTimers(room);

  if (!room || room.phase !== "playing") {
    return;
  }

  if (exactFiveFruit(room)) {
    scheduleBotRings(room);
  }

  const currentPlayer = getPlayer(room, room.currentPlayerId);

    if (!currentPlayer) {
      const nextPlayer = nextFlippablePlayer(room);
      if (!nextPlayer) {
      endByCardCount(room, "더 뒤집을 카드가 없습니다");
      broadcastRoom(room, { skipFlow: true });
      return;
    }

    room.currentPlayerId = nextPlayer.id;
    setRecentAction(room, `${nextPlayer.name} 차례`, "neutral");
    broadcastRoom(room);
    return;
  }

  if (!canFlip(currentPlayer)) {
    scheduleBotTimer(room, () => {
      const latestRoom = getRoom(room.code);
      if (!latestRoom || latestRoom.phase !== "playing") {
        return;
      }

      const latestCurrent = getPlayer(latestRoom, latestRoom.currentPlayerId);
      if (!latestCurrent || canFlip(latestCurrent)) {
        return;
      }

      const nextPlayer = nextFlippableAfter(latestRoom, latestCurrent.id);
      if (!nextPlayer) {
        endByCardCount(latestRoom, "더 뒤집을 카드가 없습니다");
        broadcastRoom(latestRoom, { skipFlow: true });
        return;
      }

      latestRoom.currentPlayerId = nextPlayer.id;
      setRecentAction(latestRoom, `${latestCurrent.name} 카드 소진 · ${nextPlayer.name} 차례`, "neutral");
      broadcastRoom(latestRoom);
    }, 650);
    return;
  }

  if (!currentPlayer.isBot) {
    return;
  }

  scheduleBotTimer(room, () => {
    const latestRoom = getRoom(room.code);
    if (!latestRoom || latestRoom.phase !== "playing") {
      return;
    }

    const latestPlayer = getPlayer(latestRoom, latestRoom.currentPlayerId);
    if (!latestPlayer?.isBot || !canFlip(latestPlayer)) {
      return;
    }

    flipCard(latestRoom, latestPlayer);
    broadcastRoom(latestRoom);
  }, randomBetween(BOT_FLIP_DELAY_MIN_MS, BOT_FLIP_DELAY_MAX_MS));
}

function createBotPlayer(room) {
    const count = room.players.filter((player) => player.isBot).length + 1;
    return createPlayer(
      `halli-bot:${room.code}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
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

  function broadcastRoom(room, options = {}) {
    const { skipFlow = false } = options;

    room.players.forEach((player) => {
      if (!player.isBot) {
        io.to(player.id).emit("room:update", serializeRoom(room, player.id));
      }
    });

    if (!skipFlow) {
      scheduleRoomFlow(room);
    }
  }

  function leaveJoinedRooms(socket) {
    for (const roomName of socket.rooms) {
      if (roomName !== socket.id) {
        socket.leave(roomName);
      }
    }
  }

  function removePlayer(playerId) {
  for (const room of rooms.values()) {
    const index = room.players.findIndex((player) => player.id === playerId);
    if (index === -1) {
      continue;
    }

    clearAllTimers(room);
    const [removedPlayer] = room.players.splice(index, 1);

    if (!room.players.length) {
      rooms.delete(room.code);
      return;
    }

    if (!room.players.some((player) => !player.isBot)) {
      rooms.delete(room.code);
      return;
    }

    room.hostId = room.players.find((player) => !player.isBot)?.id || room.players[0].id;

    if (room.phase !== "lobby") {
      resetGame(room);
      setRecentAction(room, `${removedPlayer.name} 퇴장 · 게임 초기화`, "danger");
    } else {
      setRecentAction(room, `${removedPlayer.name} 퇴장`, "neutral");
    }

    if (room.players.length < MIN_PLAYERS) {
      resetGame(room);
    }

    broadcastRoom(room, { skipFlow: true });
    return;
  }
}

io.on("connection", (socket) => {
    socket.join(socket.id);

    socket.on("room:create", ({ name, settings }, callback = () => {}) => {
      const safeName = sanitizeName(name);
      if (!safeName) {
        callback({ ok: false, message: "닉네임을 입력하세요" });
        return;
      }

      removePlayer(socket.id);
      leaveJoinedRooms(socket);

      const room = createRoom(generateRoomCode(), socket.id, safeName, settings);
      socket.join(room.code);
      broadcastRoom(room, { skipFlow: true });
      callback({ ok: true, code: room.code, room: serializeRoom(room, socket.id) });
    });

    socket.on("room:join", ({ code, name }, callback = () => {}) => {
      const room = getRoom(code);
      const safeName = sanitizeName(name);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (!safeName) {
        callback({ ok: false, message: "닉네임을 입력하세요" });
        return;
      }

      if (room.phase !== "lobby") {
        callback({ ok: false, message: "이미 게임이 시작된 방입니다" });
        return;
      }

      if (room.players.length >= room.targetPlayerCount) {
        callback({ ok: false, message: "방이 가득 찼습니다" });
        return;
      }

      removePlayer(socket.id);
      leaveJoinedRooms(socket);

      room.players.push(createPlayer(socket.id, safeName));
      socket.join(room.code);
      broadcastRoom(room, { skipFlow: true });
      callback({ ok: true, code: room.code, room: serializeRoom(room, socket.id) });
    });

    socket.on("room:state", ({ code }, callback = () => {}) => {
      const room = getRoom(code);
      const player = room ? getPlayer(room, socket.id) : null;

      if (!room || !player) {
        callback({ ok: false, message: "이 방에 참가 중이 아닙니다" });
        return;
      }

      callback({ ok: true, code: room.code, room: serializeRoom(room, socket.id) });
    });

    socket.on("room:add_bots", ({ code, count }, callback = () => {}) => {
      const room = getRoom(code);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (room.hostId !== socket.id) {
        callback({ ok: false, message: "방장만 할 수 있습니다" });
        return;
      }

      if (room.phase !== "lobby") {
        callback({ ok: false, message: "대기실에서만 봇을 추가할 수 있습니다" });
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
        callback({ ok: false, message: "추가할 자리가 없습니다" });
        return;
      }

      broadcastRoom(room, { skipFlow: true });
      callback({ ok: true, added });
    });

    socket.on("game:start", ({ code }, callback = () => {}) => {
      const room = getRoom(code);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (room.hostId !== socket.id) {
        callback({ ok: false, message: "방장만 시작할 수 있습니다" });
        return;
      }

      if (room.phase !== "lobby") {
        callback({ ok: false, message: "이미 시작된 게임입니다" });
        return;
      }

      if (room.players.length < MIN_PLAYERS) {
        callback({ ok: false, message: "2명 이상 필요합니다" });
        return;
      }

      startGame(room);
      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("game:reset", ({ code }, callback = () => {}) => {
      const room = getRoom(code);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (room.hostId !== socket.id) {
        callback({ ok: false, message: "방장만 대기실로 돌릴 수 있습니다" });
        return;
      }

      resetGame(room);
      broadcastRoom(room, { skipFlow: true });
      callback({ ok: true });
    });

    socket.on("turn:flip", ({ code }, callback = () => {}) => {
      const room = getRoom(code);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (room.phase !== "playing") {
        callback({ ok: false, message: "게임 중이 아닙니다" });
        return;
      }

      if (room.currentPlayerId !== socket.id) {
        callback({ ok: false, message: "내 차례가 아닙니다" });
        return;
      }

      const player = getPlayer(room, socket.id);
      if (!player) {
        callback({ ok: false, message: "플레이어를 찾을 수 없습니다" });
        return;
      }

      const result = flipCard(room, player);
      if (!result.ok) {
        callback(result);
        return;
      }

      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("bell:ring", ({ code }, callback = () => {}) => {
      const room = getRoom(code);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (room.phase !== "playing") {
        callback({ ok: false, message: "게임 중이 아닙니다" });
        return;
      }

      const player = getPlayer(room, socket.id);
      if (!player || !isActive(player)) {
        callback({ ok: false, message: "탈락한 플레이어는 종을 칠 수 없습니다" });
        return;
      }

      const result = handleRing(room, player);
      if (!result.ok) {
        callback(result);
        return;
      }

      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("chat:send", ({ code, text }, callback = () => {}) => {
      const room = getRoom(code);
      const player = room ? getPlayer(room, socket.id) : null;

      if (!room || !player) {
        callback({ ok: false, message: "채팅을 보낼 수 없습니다" });
        return;
      }

      if (!pushMessage(room, player, text)) {
        callback({ ok: false, message: "채팅을 입력하세요" });
        return;
      }

      broadcastRoom(room, { skipFlow: true });
      callback({ ok: true });
    });

socket.on("disconnect", () => {
      removePlayer(socket.id);
    });
  });
};

