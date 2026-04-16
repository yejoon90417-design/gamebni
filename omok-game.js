module.exports = function attachOmokGame(rootIo) {
  const io = rootIo.of("/omok");
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
  const TARGET_PLAYER_COUNT = 2;
  const MAX_CHAT_LENGTH = 140;
  const BOARD_SIZE = 15;
  const WIN_LENGTH = 5;
  const BOT_DELAY_MS = 700;
  const COLORS = ["black", "white"];
  const RULE_TEXT = {
    normal: "일반 오목",
    renju: "렌주룰"
  };
  const COLOR_TEXT = {
    black: "흑",
    white: "백"
  };
  const DIRECTIONS = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];

  const rooms = new Map();
  const disconnectTimers = new Map();
  const DISCONNECT_GRACE_MS = getDisconnectGraceMs();
  const roomStore = createRoomStore({
    gameKey: "omok",
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
    return {
      renjuEnabled: Boolean(input.renjuEnabled)
    };
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

  function createEmptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  }

  function createPlayer(id, name, isBot = false, socketId = null) {
    return {
      id,
      name: sanitizeName(name),
      isBot,
      color: null,
      ...createPresenceState(isBot ? null : socketId)
    };
  }

  function createRoom(code, hostId, hostSocketId, hostName, options = {}) {
    const settings = sanitizeSettings(options);
    const room = {
      code,
      hostId,
      targetPlayerCount: TARGET_PLAYER_COUNT,
      renjuEnabled: settings.renjuEnabled,
      phase: "lobby",
      players: [createPlayer(hostId, hostName, false, hostSocketId)],
      messages: [],
      board: createEmptyBoard(),
      currentPlayerId: null,
      recentAction: null,
      result: null,
      lastMove: null,
      winningLine: [],
      botTimer: null
    };

    rooms.set(code, room);
    return room;
  }

  function createBotPlayer(room) {
    const count = room.players.filter((player) => player.isBot).length + 1;
    return createPlayer(
      `omok-bot:${room.code}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      `BOT ${count}`,
      true
    );
  }

  function addBotToRoom(room) {
    if (room.players.length >= TARGET_PLAYER_COUNT) {
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
    room.board = Array.isArray(snapshot.board) ? snapshot.board : createEmptyBoard();
    room.winningLine = Array.isArray(snapshot.winningLine) ? snapshot.winningLine : [];
    room.recentAction = snapshot.recentAction || null;
    room.result = snapshot.result || null;
    room.lastMove = snapshot.lastMove || null;
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

  function resetBoardState(room) {
    room.board = createEmptyBoard();
    room.currentPlayerId = null;
    room.recentAction = null;
    room.result = null;
    room.lastMove = null;
    room.winningLine = [];
    room.players.forEach((player) => {
      player.color = null;
    });
  }

  function resetGame(room) {
    clearBotTimer(room);
    room.phase = "lobby";
    resetBoardState(room);
  }

  function serializePlayer(room, player) {
    return {
      id: player.id,
      name: player.name,
      isBot: player.isBot,
      isHost: room.hostId === player.id,
      color: player.color,
      isCurrent: room.currentPlayerId === player.id,
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
      renjuEnabled: room.renjuEnabled,
      targetPlayerCount: room.targetPlayerCount,
      currentPlayerId: room.currentPlayerId,
      boardSize: BOARD_SIZE,
      board: room.board,
      lastMove: room.lastMove,
      winningLine: room.winningLine,
      recentAction: room.recentAction,
      result: room.result,
      messages: room.messages,
      players: room.players.map((player) => serializePlayer(room, player)),
      me: me ? serializePlayer(room, me) : null
    };
  }

  function scheduleBot(room) {
    clearBotTimer(room);

    if (!room || room.phase !== "playing") {
      return;
    }

    const currentPlayer = getPlayer(room, room.currentPlayerId);
    if (!currentPlayer?.isBot) {
      return;
    }

    room.botTimer = setTimeout(() => {
      runBotTurn(room.code);
    }, BOT_DELAY_MS);
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

  function insideBoard(x, y) {
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
  }

  function boardCell(board, x, y) {
    if (!insideBoard(x, y)) {
      return null;
    }

    return board[y][x];
  }

  function formatMove(x, y) {
    return `${String.fromCharCode(65 + x)}${y + 1}`;
  }

  function lineThrough(board, x, y, color, dx, dy) {
    const negative = [];
    const positive = [];

    for (let step = 1; insideBoard(x - dx * step, y - dy * step); step += 1) {
      if (board[y - dy * step][x - dx * step] !== color) {
        break;
      }
      negative.unshift({ x: x - dx * step, y: y - dy * step });
    }

    for (let step = 1; insideBoard(x + dx * step, y + dy * step); step += 1) {
      if (board[y + dy * step][x + dx * step] !== color) {
        break;
      }
      positive.push({ x: x + dx * step, y: y + dy * step });
    }

    return [...negative, { x, y }, ...positive];
  }

  function lineLength(board, x, y, color, dx, dy) {
    return lineThrough(board, x, y, color, dx, dy).length;
  }

  function findExactFiveLine(board, x, y, color) {
    for (const [dx, dy] of DIRECTIONS) {
      const line = lineThrough(board, x, y, color, dx, dy);
      if (line.length === WIN_LENGTH) {
        return line;
      }
    }

    return null;
  }

  function findWinningLine(board, x, y, color) {
    for (const [dx, dy] of DIRECTIONS) {
      const line = lineThrough(board, x, y, color, dx, dy);
      if (line.length >= WIN_LENGTH) {
        return line;
      }
    }

    return null;
  }

  function hasOverline(board, x, y, color) {
    return DIRECTIONS.some(([dx, dy]) => lineLength(board, x, y, color, dx, dy) > WIN_LENGTH);
  }

  function collectWinningExtensions(board, anchorX, anchorY, color, dx, dy) {
    const empties = new Map();
    const enemy = otherColor(color);

    for (let start = -4; start <= 0; start += 1) {
      let ownCount = 0;
      let blocked = false;
      const emptyCells = [];

      for (let offset = 0; offset < WIN_LENGTH; offset += 1) {
        const x = anchorX + (start + offset) * dx;
        const y = anchorY + (start + offset) * dy;

        if (!insideBoard(x, y)) {
          blocked = true;
          break;
        }

        const cell = board[y][x];
        if (cell === enemy) {
          blocked = true;
          break;
        }

        if (cell === color) {
          ownCount += 1;
        } else if (cell === null) {
          emptyCells.push({ x, y });
        }
      }

      if (!blocked && ownCount === WIN_LENGTH - 1 && emptyCells.length === 1) {
        const empty = emptyCells[0];
        empties.set(`${empty.x}:${empty.y}`, empty);
      }
    }

    return [...empties.values()];
  }

  function countFours(board, x, y, color) {
    return DIRECTIONS.reduce((count, [dx, dy]) => {
      return count + (collectWinningExtensions(board, x, y, color, dx, dy).length > 0 ? 1 : 0);
    }, 0);
  }

  function createsLegalStraightFour(board, x, y, candidateX, candidateY, color, dx, dy, renjuEnabled) {
    if (!insideBoard(candidateX, candidateY) || board[candidateY][candidateX] !== null) {
      return false;
    }

    board[candidateY][candidateX] = color;

    const exactFive = Boolean(findExactFiveLine(board, candidateX, candidateY, color));
    const straightFour = collectWinningExtensions(board, x, y, color, dx, dy).length >= 2;
    const illegalForBlack =
      renjuEnabled &&
      color === "black" &&
      (hasOverline(board, candidateX, candidateY, color) || countFours(board, candidateX, candidateY, color) >= 2);

    board[candidateY][candidateX] = null;
    return !exactFive && straightFour && !illegalForBlack;
  }

  function countOpenThrees(board, x, y, color, renjuEnabled) {
    return DIRECTIONS.reduce((count, [dx, dy]) => {
      for (let step = -4; step <= 4; step += 1) {
        const candidateX = x + step * dx;
        const candidateY = y + step * dy;

        if (
          createsLegalStraightFour(board, x, y, candidateX, candidateY, color, dx, dy, renjuEnabled)
        ) {
          return count + 1;
        }
      }

      return count;
    }, 0);
  }

  function forbiddenType(board, x, y, color, renjuEnabled) {
    if (!renjuEnabled || color !== "black") {
      return null;
    }

    if (findExactFiveLine(board, x, y, color)) {
      return null;
    }

    if (hasOverline(board, x, y, color)) {
      return "장목";
    }

    if (countFours(board, x, y, color) >= 2) {
      return "44";
    }

    if (countOpenThrees(board, x, y, color, renjuEnabled) >= 2) {
      return "33";
    }

    return null;
  }

  function simulateMoveResult(board, x, y, color, renjuEnabled) {
    board[y][x] = color;
    const exactFiveLine = findExactFiveLine(board, x, y, color);
    const forbidden = forbiddenType(board, x, y, color, renjuEnabled);
    const winningLine =
      renjuEnabled && color === "black" ? exactFiveLine : findWinningLine(board, x, y, color);
    board[y][x] = null;

    return {
      exactFiveLine,
      forbidden,
      winningLine
    };
  }

  function boardIsFull(board) {
    return board.every((row) => row.every((cell) => cell !== null));
  }

  function otherColor(color) {
    return color === "black" ? "white" : "black";
  }

  function findPlayerByColor(room, color) {
    return room.players.find((player) => player.color === color) || null;
  }

  function startGame(room) {
    clearBotTimer(room);
    resetBoardState(room);
    room.phase = "playing";

    const shuffled = shuffle(room.players);
    shuffled[0].color = COLORS[0];
    shuffled[1].color = COLORS[1];
    room.currentPlayerId = shuffled[0].id;

    const blackPlayer = findPlayerByColor(room, "black");
    const whitePlayer = findPlayerByColor(room, "white");
    setRecentAction(
      room,
      `${RULE_TEXT[room.renjuEnabled ? "renju" : "normal"]} · ${blackPlayer?.name || "-"} 흑, ${whitePlayer?.name || "-"} 백`,
      "neutral"
    );
  }

  function finishGame(room, winnerId, reason, winningLine = []) {
    clearBotTimer(room);
    room.phase = "result";
    room.result = {
      winnerId,
      reason
    };
    room.currentPlayerId = null;
    room.winningLine = winningLine;
    setRecentAction(room, reason, winnerId ? "success" : "neutral");
  }

  function endTurn(room) {
    const currentPlayer = getPlayer(room, room.currentPlayerId);
    const nextColor = otherColor(currentPlayer?.color || "black");
    const nextPlayer = findPlayerByColor(room, nextColor);
    room.currentPlayerId = nextPlayer?.id || null;
  }

  function hasNeighbor(board, x, y, distance = 2) {
    for (let offsetY = -distance; offsetY <= distance; offsetY += 1) {
      for (let offsetX = -distance; offsetX <= distance; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) {
          continue;
        }

        if (!insideBoard(x + offsetX, y + offsetY)) {
          continue;
        }

        if (board[y + offsetY][x + offsetX] !== null) {
          return true;
        }
      }
    }

    return false;
  }

  function countRun(board, x, y, color, dx, dy) {
    let count = 0;
    let step = 1;

    while (insideBoard(x + dx * step, y + dy * step)) {
      const nextColor = board[y + dy * step][x + dx * step];
      if (nextColor !== color) {
        break;
      }
      count += 1;
      step += 1;
    }

    const nextX = x + dx * step;
    const nextY = y + dy * step;
    const isOpen = insideBoard(nextX, nextY) && board[nextY][nextX] === null;
    return {
      count,
      open: isOpen
    };
  }

  function lineScore(length, openEnds) {
    if (length >= 5) {
      return 200000;
    }
    if (length === 4 && openEnds === 2) {
      return 30000;
    }
    if (length === 4 && openEnds === 1) {
      return 12000;
    }
    if (length === 3 && openEnds === 2) {
      return 5000;
    }
    if (length === 3 && openEnds === 1) {
      return 1300;
    }
    if (length === 2 && openEnds === 2) {
      return 260;
    }
    if (length === 2 && openEnds === 1) {
      return 60;
    }
    if (length === 1 && openEnds === 2) {
      return 16;
    }
    return 4;
  }

  function evaluateMove(board, x, y, color) {
    let score = 0;

    for (const [dx, dy] of DIRECTIONS) {
      const forward = countRun(board, x, y, color, dx, dy);
      const backward = countRun(board, x, y, color, -dx, -dy);
      const length = 1 + forward.count + backward.count;
      const openEnds = Number(forward.open) + Number(backward.open);
      score += lineScore(length, openEnds);
    }

    return score;
  }

  function simulatedWinningLine(board, x, y, color) {
    board[y][x] = color;
    const winningLine = findWinningLine(board, x, y, color);
    board[y][x] = null;
    return winningLine;
  }

  function occupiedCount(board) {
    return board.reduce(
      (count, row) => count + row.reduce((rowCount, cell) => rowCount + (cell ? 1 : 0), 0),
      0
    );
  }

  function chooseBotMove(room, bot) {
    if (occupiedCount(room.board) === 0) {
      const center = Math.floor(BOARD_SIZE / 2);
      if (!simulateMoveResult(room.board, center, center, bot.color, room.renjuEnabled).forbidden) {
        return { x: center, y: center };
      }
    }

    const empties = [];
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        if (room.board[y][x] !== null) {
          continue;
        }
        if (!hasNeighbor(room.board, x, y, 2)) {
          continue;
        }
        empties.push({ x, y });
      }
    }

    const candidates = (
      empties.length
      ? empties
      : Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_unused, index) => ({
          x: index % BOARD_SIZE,
          y: Math.floor(index / BOARD_SIZE)
        })).filter(({ x, y }) => room.board[y][x] === null)
    ).filter(({ x, y }) => !simulateMoveResult(room.board, x, y, bot.color, room.renjuEnabled).forbidden);

    if (!candidates.length) {
      return null;
    }

    for (const candidate of candidates) {
      if (simulateMoveResult(room.board, candidate.x, candidate.y, bot.color, room.renjuEnabled).winningLine) {
        return candidate;
      }
    }

    const opponentColor = otherColor(bot.color);
    for (const candidate of candidates) {
      if (
        simulateMoveResult(room.board, candidate.x, candidate.y, opponentColor, room.renjuEnabled).winningLine
      ) {
        return candidate;
      }
    }

    const center = (BOARD_SIZE - 1) / 2;
    let best = null;

    candidates.forEach((candidate) => {
      const offense = evaluateMove(room.board, candidate.x, candidate.y, bot.color);
      const defense = evaluateMove(room.board, candidate.x, candidate.y, opponentColor);
      let adjacency = 0;

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }

          const value = boardCell(room.board, candidate.x + offsetX, candidate.y + offsetY);
          if (value === bot.color) {
            adjacency += 12;
          } else if (value === opponentColor) {
            adjacency += 9;
          }
        }
      }

      const centerPenalty = Math.abs(candidate.x - center) + Math.abs(candidate.y - center);
      const score = offense + defense * 0.92 + adjacency - centerPenalty * 2;

      if (!best || score > best.score) {
        best = {
          ...candidate,
          score
        };
      }
    });

    return best || candidates[0];
  }

  function applyStone(room, player, x, y) {
    room.board[y][x] = player.color;
    room.lastMove = {
      x,
      y,
      playerId: player.id,
      color: player.color
    };

    const moveText = `${player.name} ${COLOR_TEXT[player.color]} ${formatMove(x, y)}`;
    const exactFiveLine = findExactFiveLine(room.board, x, y, player.color);
    const forbidden = forbiddenType(room.board, x, y, player.color, room.renjuEnabled);

    if (room.renjuEnabled && player.color === "black") {
      if (exactFiveLine) {
        finishGame(room, player.id, `${player.name} 승리`, exactFiveLine);
        return {
          win: true,
          draw: false,
          moveText
        };
      }

      if (forbidden) {
        const whitePlayer = findPlayerByColor(room, "white");
        finishGame(room, whitePlayer?.id || null, `${player.name} ${forbidden} 금수 · ${whitePlayer?.name || "백"} 승리`);
        return {
          win: false,
          draw: false,
          forbidden,
          moveText
        };
      }
    }

    const winningLine = findWinningLine(room.board, x, y, player.color);

    if (winningLine) {
      finishGame(room, player.id, `${player.name} 승리`, winningLine);
      return {
        win: true,
        draw: false,
        moveText
      };
    }

    if (boardIsFull(room.board)) {
      finishGame(room, null, "무승부");
      return {
        win: false,
        draw: true,
        moveText
      };
    }

    endTurn(room);
    setRecentAction(room, moveText, "neutral");
    return {
      win: false,
      draw: false,
      moveText
    };
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

    const move = chooseBotMove(room, bot);
    if (!move) {
      finishGame(room, null, "무승부");
      broadcastRoom(room);
      return;
    }

    applyStone(room, bot, move.x, move.y);
    broadcastRoom(room);
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

      if (!room.players.length) {
        rooms.delete(room.code);
        deletePersistedRoom(room.code);
        return;
      }

      if (!room.players.some((player) => !player.isBot)) {
        rooms.delete(room.code);
        deletePersistedRoom(room.code);
        return;
      }

      room.hostId = room.players.find((player) => !player.isBot)?.id || room.players[0].id;

      if (room.players.length < TARGET_PLAYER_COUNT) {
        resetGame(room);
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

  function leaveJoinedRooms(socket) {
    for (const roomName of socket.rooms) {
      if (roomName !== socket.id) {
        socket.leave(roomName);
      }
    }
  }

  io.on("connection", (socket) => {
    socket.join(socket.id);

    socket.on("room:create", ({ name, settings }, callback = () => {}) => {
      const safeName = sanitizeName(name);
      const playerId = getSocketPlayerId(socket);
      if (!safeName) {
        callback({ ok: false, message: "닉네임을 입력하세요" });
        return;
      }

      removePlayer(playerId);
      leaveJoinedRooms(socket);

      const room = createRoom(generateRoomCode(), playerId, socket.id, safeName, settings);
      attachSocketToPlayer(room, socket, room.players[0]);
      broadcastRoom(room, { skipBotSchedule: true });
      callback({ ok: true, code: room.code });
    });

    socket.on("room:join", ({ code, name }, callback = () => {}) => {
      const room = getRoom(code);
      const safeName = sanitizeName(name);
      const playerId = getSocketPlayerId(socket);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (!safeName) {
        callback({ ok: false, message: "닉네임을 입력하세요" });
        return;
      }

      const reconnectingPlayer = room.players.find((player) => player.id === playerId && !player.isBot);
      if (reconnectingPlayer) {
        reconnectingPlayer.name = safeName;
        leaveJoinedRooms(socket);
        attachSocketToPlayer(room, socket, reconnectingPlayer);
        broadcastRoom(room, { skipBotSchedule: true });
        callback({ ok: true, code: room.code, restored: true });
        return;
      }
      if (room.players.length >= TARGET_PLAYER_COUNT) {
        callback({ ok: false, message: "방이 가득 찼습니다" });
        return;
      }

      removePlayer(playerId);
      leaveJoinedRooms(socket);

      room.players.push(createPlayer(playerId, safeName, false, socket.id));
      attachSocketToPlayer(room, socket, room.players[room.players.length - 1]);
      broadcastRoom(room, { skipBotSchedule: true });
      callback({ ok: true, code: room.code });
    });

    socket.on("room:add_bots", ({ code, count }, callback = () => {}) => {
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

      if (room.phase !== "lobby") {
        callback({ ok: false, message: "대기 중에만 추가할 수 있습니다" });
        return;
      }

      const requested = Math.max(1, Math.min(1, Number.parseInt(count, 10) || 1));
      let added = 0;

      for (let index = 0; index < requested; index += 1) {
        if (!addBotToRoom(room)) {
          break;
        }
        added += 1;
      }

      if (!added) {
        callback({ ok: false, message: "더 이상 추가할 수 없습니다" });
        return;
      }

      broadcastRoom(room, { skipBotSchedule: true });
      callback({ ok: true, added });
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

      if (room.players.length !== TARGET_PLAYER_COUNT) {
        callback({ ok: false, message: "2명이 모여야 시작할 수 있습니다" });
        return;
      }

      startGame(room);
      broadcastRoom(room);
      callback({ ok: true });
    });

    socket.on("move:place", ({ code, x, y }, callback = () => {}) => {
      const room = getRoom(code);
      const playerId = getSocketPlayerId(socket);
      const player = room ? getPlayer(room, playerId) : null;
      const column = Number.parseInt(x, 10);
      const row = Number.parseInt(y, 10);

      if (!room || !player) {
        callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
        return;
      }

      if (room.phase !== "playing") {
        callback({ ok: false, message: "지금 둘 수 없습니다" });
        return;
      }

      if (room.currentPlayerId !== playerId) {
        callback({ ok: false, message: "내 차례가 아닙니다" });
        return;
      }

      if (!Number.isInteger(column) || !Number.isInteger(row) || !insideBoard(column, row)) {
        callback({ ok: false, message: "보드 안쪽을 선택하세요" });
        return;
      }

      if (room.board[row][column] !== null) {
        callback({ ok: false, message: "이미 돌이 있습니다" });
        return;
      }

      applyStone(room, player, column, row);
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
      broadcastRoom(room, { skipBotSchedule: true });
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
      console.log(`[omok] restored ${snapshots.length} room(s) from Redis`);
    }
  }

  return restorePersistedRooms();
};
