module.exports = function attachOmokGame(rootIo) {
  const io = rootIo.of("/omok");

  const ROOM_CODE_LENGTH = 5;
  const TARGET_PLAYER_COUNT = 2;
  const MAX_CHAT_LENGTH = 140;
  const BOARD_SIZE = 15;
  const WIN_LENGTH = 5;
  const BOT_DELAY_MS = 700;
  const COLORS = ["black", "white"];
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

  function createPlayer(id, name, isBot = false) {
    return {
      id,
      name: sanitizeName(name),
      isBot,
      color: null
    };
  }

  function createRoom(code, hostId, hostName) {
    const room = {
      code,
      hostId,
      targetPlayerCount: TARGET_PLAYER_COUNT,
      phase: "lobby",
      players: [createPlayer(hostId, hostName)],
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

  function getPlayer(room, playerId) {
    return room.players.find((player) => player.id === playerId) || null;
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
      isCurrent: room.currentPlayerId === player.id
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

  function findWinningLine(board, x, y, color) {
    for (const [dx, dy] of DIRECTIONS) {
      const line = lineThrough(board, x, y, color, dx, dy);
      if (line.length >= WIN_LENGTH) {
        return line;
      }
    }

    return null;
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
      `${blackPlayer?.name || "-"} 흑, ${whitePlayer?.name || "-"} 백`,
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
      return { x: center, y: center };
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

    const candidates = empties.length
      ? empties
      : Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_unused, index) => ({
          x: index % BOARD_SIZE,
          y: Math.floor(index / BOARD_SIZE)
        })).filter(({ x, y }) => room.board[y][x] === null);

    for (const candidate of candidates) {
      if (simulatedWinningLine(room.board, candidate.x, candidate.y, bot.color)) {
        return candidate;
      }
    }

    const opponentColor = otherColor(bot.color);
    for (const candidate of candidates) {
      if (simulatedWinningLine(room.board, candidate.x, candidate.y, opponentColor)) {
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
    for (const room of rooms.values()) {
      const index = room.players.findIndex((player) => player.id === playerId);
      if (index === -1) {
        continue;
      }

      clearBotTimer(room);
      room.players.splice(index, 1);

      if (!room.players.length) {
        rooms.delete(room.code);
        return;
      }

      if (!room.players.some((player) => !player.isBot)) {
        rooms.delete(room.code);
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

  function leaveJoinedRooms(socket) {
    for (const roomName of socket.rooms) {
      if (roomName !== socket.id) {
        socket.leave(roomName);
      }
    }
  }

  io.on("connection", (socket) => {
    socket.join(socket.id);

    socket.on("room:create", ({ name }, callback = () => {}) => {
      const safeName = sanitizeName(name);
      if (!safeName) {
        callback({ ok: false, message: "닉네임을 입력하세요" });
        return;
      }

      removePlayer(socket.id);
      leaveJoinedRooms(socket);

      const room = createRoom(generateRoomCode(), socket.id, safeName);
      socket.join(room.code);
      broadcastRoom(room, { skipBotSchedule: true });
      callback({ ok: true, code: room.code });
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

      if (room.players.length >= TARGET_PLAYER_COUNT) {
        callback({ ok: false, message: "방이 가득 찼습니다" });
        return;
      }

      removePlayer(socket.id);
      leaveJoinedRooms(socket);

      room.players.push(createPlayer(socket.id, safeName));
      socket.join(room.code);
      broadcastRoom(room, { skipBotSchedule: true });
      callback({ ok: true, code: room.code });
    });

    socket.on("room:add_bots", ({ code, count }, callback = () => {}) => {
      const room = getRoom(code);

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (room.hostId !== socket.id) {
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

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (room.hostId !== socket.id) {
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
      const player = room ? getPlayer(room, socket.id) : null;
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

      if (room.currentPlayerId !== socket.id) {
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

      if (!room) {
        callback({ ok: false, message: "방을 찾을 수 없습니다" });
        return;
      }

      if (room.hostId !== socket.id) {
        callback({ ok: false, message: "호스트만 할 수 있습니다" });
        return;
      }

      resetGame(room);
      broadcastRoom(room, { skipBotSchedule: true });
      callback({ ok: true });
    });

    socket.on("chat:send", ({ code, text }, callback = () => {}) => {
      const room = getRoom(code);
      const player = room ? getPlayer(room, socket.id) : null;

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
      removePlayer(socket.id);
    });
  });
};
