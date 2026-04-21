const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const TOPIC_WORDS = require("./data/topics");
const attachBangGame = require("./bang-game");
const attachDavinciGame = require("./davinci-game");
const attachCatchmindGame = require("./catchmind-game");
const attachHalliGame = require("./halli-game");
const attachMemoryGame = require("./memory-game");
const attachOmokGame = require("./omok-game");
const attachYutGame = require("./yut-game");
const { closeRedisClient } = require("./redis-client");
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

const PORT = process.env.PORT || 3000;
const SERVICE_NAME = process.env.RENDER_SERVICE_NAME || "liar-chat-game";
const BUILD_COMMIT_SHA =
  process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || process.env.GIT_COMMIT || "unknown";
const BOOT_AT = new Date().toISOString();
const ROOM_CODE_LENGTH = 5;
const MIN_PLAYERS = 2;
const DEFAULT_DISCUSSION_ROUNDS = 3;
const DEFAULT_BREAK_SECONDS = 90;
const MAX_CHAT_LENGTH = 140;
const MAX_OPINION_LENGTH = 48;
const MAX_GUESS_LENGTH = 24;
const DISCUSSION_ROUND_OPTIONS = [1, 2, 3, 4, 5];
const BREAK_SECOND_OPTIONS = [0, 30, 60, 90, 120, 180];
const DEFAULT_VOTE_MODE = "single";
const VOTE_MODES = new Set(["single", "elimination"]);
const DEFAULT_LIAR_COUNT = 1;
const LIAR_COUNT_OPTIONS = [1, 2];
const REACTION_EMOJIS = {
  heart: "❤️",
  poop: "💩",
  thumb: "👍"
};
const BOT_REACTION_DELAY_MIN_MS = 3500;
const BOT_REACTION_DELAY_MAX_MS = 8000;
const TEST_MODE_PLAYERS = 4;
const BOT_NAMES = ["BOT A", "BOT B", "BOT C", "BOT D", "BOT E", "BOT F"];
const BOT_DISCUSSION_LINES = [
  "너무 직접 말하면 바로 들킬 것 같다",
  "일상에서 꽤 익숙한 쪽이다",
  "상황을 떠올리면 감이 온다",
  "사람마다 느낌이 조금 갈릴 수 있다",
  "이번 힌트는 넓게 가겠다"
];
const BOT_CHAT_LINES = [
  "지금 말들 조금 헷갈린다",
  "한 명이 살짝 걸린다",
  "아직은 더 들어봐야겠다",
  "투표 때 고민될 것 같다"
];

const rooms = new Map();
const disconnectTimers = new Map();
const DISCONNECT_GRACE_MS = getDisconnectGraceMs();
let isShuttingDown = false;
const ADSENSE_LOADER_PATTERN =
  /\s*<script async src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-1492932683312516" crossorigin="anonymous"><\/script>\r?\n?/;
const roomStore = createRoomStore({
  gameKey: "liar",
  serializeRoom: (room) => snapshotRoom(room, { timers: [] })
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);
registerSessionNamespace(io);

app.use((request, response, next) => {
  if (
    request.path === "/halli" ||
    request.path === "/halli/" ||
    request.path.startsWith("/halli/") ||
    request.path === "/memory" ||
    request.path === "/memory/" ||
    request.path.startsWith("/memory/") ||
    request.path === "/catch" ||
    request.path === "/catch/" ||
    request.path.startsWith("/catch/") ||
    request.path === "/yut" ||
    request.path === "/yut/" ||
    request.path.startsWith("/yut/")
  ) {
    response.set("Cache-Control", "no-store, no-cache, must-revalidate");
    response.set("Pragma", "no-cache");
    response.set("Expires", "0");
  }

  next();
});

function serializeUnknownError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    value: typeof error === "string" ? error : JSON.stringify(error)
  };
}

function getProcessSnapshot() {
  return {
    service: SERVICE_NAME,
    commit: BUILD_COMMIT_SHA,
    pid: process.pid,
    bootAt: BOOT_AT,
    uptimeSeconds: Math.floor(process.uptime()),
    shuttingDown: isShuttingDown,
    node: process.version,
    clients: io.engine?.clientsCount ?? 0,
    liarRooms: rooms.size,
    memory: {
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal
    }
  };
}

function logProcessEvent(type, details = {}, level = "log") {
  const logger = typeof console[level] === "function" ? console[level] : console.log;
  logger(`[server] ${type} ${JSON.stringify({ ...getProcessSnapshot(), ...details })}`);
}

app.get("/healthz", (_request, response) => {
  response.status(200).json({
    ok: true,
    ...getProcessSnapshot()
  });
});

async function sendHtmlPage(response, filePath, options = {}) {
  const { stripAdsense = false, playMode = false } = options;

  try {
    let html = await fs.readFile(filePath, "utf8");

    if (stripAdsense) {
      html = html.replace(ADSENSE_LOADER_PATTERN, "");
    }

    if (playMode) {
      html = html
        .replace('id="entryScreen">', 'id="entryScreen" hidden>')
        .replace('id="gameScreen" hidden>', 'id="gameScreen">');
    }

    response.type("html").send(html);
  } catch (error) {
    response.status(500).send("Failed to load page.");
    logProcessEvent("page-load-failed", {
      filePath,
      error: serializeUnknownError(error)
    }, "error");
  }
}

function registerPageRoutes(entryRoutes, playRoutes, filePath) {
  app.get(entryRoutes, (_request, response) => {
    response.sendFile(filePath);
  });

  app.get(playRoutes, async (_request, response) => {
    await sendHtmlPage(response, filePath, {
      stripAdsense: true,
      playMode: true
    });
  });
}

registerPageRoutes(["/", "/index.html"], ["/play", "/play/"], path.join(__dirname, "public", "index.html"));
registerPageRoutes(["/bang", "/bang/"], ["/bang/play", "/bang/play/"], path.join(__dirname, "public", "bang", "index.html"));
registerPageRoutes(
  ["/davinci", "/davinci/"],
  ["/davinci/play", "/davinci/play/"],
  path.join(__dirname, "public", "davinci", "index.html")
);
registerPageRoutes(["/omok", "/omok/"], ["/omok/play", "/omok/play/"], path.join(__dirname, "public", "omok", "index.html"));
registerPageRoutes(["/halli", "/halli/"], ["/halli/play", "/halli/play/"], path.join(__dirname, "public", "halli", "index.html"));
registerPageRoutes(["/memory", "/memory/"], ["/memory/play", "/memory/play/"], path.join(__dirname, "public", "memory", "index.html"));
registerPageRoutes(["/catch", "/catch/"], ["/catch/play", "/catch/play/"], path.join(__dirname, "public", "catch", "index.html"));
registerPageRoutes(["/yut", "/yut/"], ["/yut/play", "/yut/play/"], path.join(__dirname, "public", "yut", "index.html"));

app.use(express.static(path.join(__dirname, "public")));

function sanitizeName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

function sanitizeText(value, limit) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizeAnswer(value) {
  return String(value || "").trim().toLowerCase().normalize("NFC");
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function createPlayer(id, name, isBot = false, socketId = null) {
  return {
    id,
    name: sanitizeName(name),
    isBot,
    ...createPresenceState(isBot ? null : socketId)
  };
}

function sanitizeSettings(input = {}) {
  const discussionRounds = Number.parseInt(input.discussionRounds, 10);
  const breakSeconds = Number.parseInt(input.breakSeconds, 10);
  const liarCount = Number.parseInt(input.liarCount, 10);
  const voteMode = String(input.voteMode || DEFAULT_VOTE_MODE);

  return {
    discussionRounds: DISCUSSION_ROUND_OPTIONS.includes(discussionRounds)
      ? discussionRounds
      : DEFAULT_DISCUSSION_ROUNDS,
    breakSeconds: BREAK_SECOND_OPTIONS.includes(breakSeconds)
      ? breakSeconds
      : DEFAULT_BREAK_SECONDS,
    liarCount: LIAR_COUNT_OPTIONS.includes(liarCount) ? liarCount : DEFAULT_LIAR_COUNT,
    voteMode: VOTE_MODES.has(voteMode) ? voteMode : DEFAULT_VOTE_MODE
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

function createRoom(code, hostId, hostSocketId, hostName, options = {}) {
  const room = {
    code,
    hostId,
    phase: "lobby",
    round: 0,
    topic: "",
    word: "",
    liarIds: [],
    accusedId: null,
    result: null,
    eliminatedIds: [],
    testMode: Boolean(options.testMode),
    players: [createPlayer(hostId, hostName, false, hostSocketId)],
    turnOrder: [],
    turnIndex: 0,
    discussionRound: 1,
    breakEndsAt: null,
    settings: sanitizeSettings(options.settings),
    votes: {},
    voteRound: 1,
    voteCandidateIds: null,
    voteCounts: {},
    liarGuessUsed: false,
    messages: [],
    messageSeq: 0,
    timers: new Set()
  };

  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(String(code || "").toUpperCase());
}

function hydrateRoom(snapshot) {
  const room = {
    ...snapshot,
    code: normalizeRoomCode(snapshot.code),
    timers: new Set()
  };

  room.players = (snapshot.players || []).map((player) => ({
    ...createPresenceState(),
    ...player
  }));

  room.messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  room.liarIds = Array.isArray(snapshot.liarIds) ? snapshot.liarIds : [];
  room.eliminatedIds = Array.isArray(snapshot.eliminatedIds) ? snapshot.eliminatedIds : [];
  room.turnOrder = Array.isArray(snapshot.turnOrder) ? snapshot.turnOrder : [];
  room.votes = snapshot.votes && typeof snapshot.votes === "object" ? snapshot.votes : {};
  room.voteCounts =
    snapshot.voteCounts && typeof snapshot.voteCounts === "object" ? snapshot.voteCounts : {};

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

function isEliminated(room, playerId) {
  return room.eliminatedIds.includes(playerId);
}

function getActivePlayers(room) {
  return room.players.filter((player) => !isEliminated(room, player.id));
}

function getLiarIds(room) {
  if (Array.isArray(room.liarIds)) {
    return room.liarIds;
  }

  return room.liarId ? [room.liarId] : [];
}

function isLiar(room, playerId) {
  return getLiarIds(room).includes(playerId);
}

function primaryLiarId(room) {
  return getLiarIds(room)[0] || null;
}

function getHumanPlayers(room) {
  return room.players.filter((player) => !player.isBot);
}

function getBotPlayers(room) {
  return room.players.filter((player) => player.isBot);
}

function nextHostId(room) {
  return getHumanPlayers(room)[0]?.id || room.players[0]?.id || null;
}

function serializePlayer(player, room) {
  return {
    id: player.id,
    name: player.name,
    isBot: Boolean(player.isBot),
    isHost: room.hostId === player.id,
    isEliminated: isEliminated(room, player.id),
    connected: isPlayerConnected(player),
    disconnectDeadlineAt: player.disconnectDeadlineAt || null
  };
}

function getPlayerRole(room, socketId) {
  if (room.phase === "lobby") {
    return null;
  }

  return isLiar(room, socketId) ? "liar" : "citizen";
}

function getVisibleTopic(room) {
  return room.phase === "lobby" ? null : room.topic;
}

function getVisibleWord(room, socketId) {
  if (room.phase === "lobby") {
    return null;
  }

  if (isLiar(room, socketId)) {
    return null;
  }

  return room.word;
}

function activeTurnPlayerId(room) {
  if (room.phase !== "discussion" || room.turnOrder.length === 0) {
    return null;
  }

  return room.turnOrder[room.turnIndex] || null;
}

function serializeRoom(room, socketId) {
  const me = getPlayer(room, socketId);
  const playerVote = room.votes[socketId] || null;
  const activePlayers = getActivePlayers(room);

  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    testMode: Boolean(room.testMode),
    players: room.players.map((player) => serializePlayer(player, room)),
    hostId: room.hostId,
    topic: getVisibleTopic(room),
    word: getVisibleWord(room, socketId),
    role: getPlayerRole(room, socketId),
    me: me ? serializePlayer(me, room) : null,
    turnOrder: room.turnOrder,
    turnIndex: room.turnIndex,
    activeTurnPlayer: activeTurnPlayerId(room),
    discussion: {
      round: room.discussionRound,
      maxRounds: room.settings.voteMode === "elimination" ? null : room.settings.discussionRounds
    },
    break: {
      endsAt: room.breakEndsAt,
      remainingMs:
        room.phase === "break" && room.breakEndsAt
          ? Math.max(room.breakEndsAt - Date.now(), 0)
          : 0,
      nextRound:
        room.phase === "break"
          ? Math.min(room.discussionRound + 1, room.settings.discussionRounds)
          : null
    },
    settings: room.settings,
    votes: {
      total: Object.keys(room.votes).length,
      required: activePlayers.length,
      submitted: Boolean(playerVote),
      targetId: playerVote,
      round: room.voteRound,
      candidateIds: room.voteCandidateIds,
      counts: room.voteCounts
    },
    liarGuess: {
      available:
        room.phase === "discussion" &&
        isLiar(room, socketId) &&
        activeTurnPlayerId(room) === socketId &&
        !isEliminated(room, socketId) &&
        !room.liarGuessUsed,
      finalAvailable:
        room.phase === "final-guess" &&
        isLiar(room, socketId) &&
        room.accusedId === socketId,
      used: isLiar(room, socketId) ? room.liarGuessUsed : false
    },
    accusedId: room.accusedId,
    result: room.result,
    messages: room.messages.map((message) => ({
      id: message.id,
      kind: message.kind,
      playerId: message.playerId,
      name: message.name,
      text: message.text,
      round: message.round || null,
      createdAt: message.createdAt
    }))
  };
}

function broadcastRoom(room) {
  getHumanPlayers(room).forEach((player) => {
    io.to(player.id).emit("room:update", serializeRoom(room, player.id));
  });
}

function createReactionPayload(fromId, targetId, reactionKey) {
  return {
    id: `${Date.now()}:${fromId}:${targetId}:${reactionKey}:${Math.random().toString(36).slice(2)}`,
    fromId,
    targetId,
    reaction: reactionKey,
    emoji: REACTION_EMOJIS[reactionKey],
    createdAt: Date.now()
  };
}

function broadcastReaction(room, payload) {
  getHumanPlayers(room).forEach((humanPlayer) => {
    io.to(humanPlayer.id).emit("reaction:show", payload);
  });
}

function clearRoomTimers(room) {
  if (!room?.timers) {
    room.timers = new Set();
    return;
  }

  room.timers.forEach((timer) => clearTimeout(timer));
  room.timers.clear();
}

function scheduleRoomTimer(room, delay, task) {
  const timer = setTimeout(() => {
    room.timers.delete(timer);

    if (rooms.get(room.code) !== room) {
      return;
    }

    task();
  }, delay);

  room.timers.add(timer);
}

function shuffle(list) {
  const clone = [...list];

  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }

  return clone;
}

function pickPrompt() {
  const topics = Object.keys(TOPIC_WORDS);
  const topic = randomItem(topics);
  const words = TOPIC_WORDS[topic];
  const word = randomItem(words);

  return { topic, word };
}

function chooseLiarIds(room) {
  const activePlayerIds = shuffle(getActivePlayers(room).map((player) => player.id));
  const liarCount = Math.min(room.settings.liarCount, Math.max(activePlayerIds.length - 1, 1));

  return activePlayerIds.slice(0, liarCount);
}

function ensureTestBots(room) {
  room.testMode = true;

  let botCount = getBotPlayers(room).length;

  while (room.players.length < TEST_MODE_PLAYERS) {
    botCount += 1;
    const botName = BOT_NAMES[(botCount - 1) % BOT_NAMES.length];
    room.players.push(createPlayer(`bot:${room.code}:${botCount}`, botName, true));
  }
}

function pushMessage(room, { kind, playerId, name, text, round = null }) {
  room.messageSeq += 1;
  room.messages.push({
    id: room.messageSeq,
    kind,
    playerId,
    name,
    text,
    round,
    createdAt: Date.now()
  });

  if (room.messages.length > 200) {
    room.messages.shift();
  }
}

function removeVotesForPlayer(room, playerId) {
  delete room.votes[playerId];
  delete room.voteCounts[playerId];
  room.eliminatedIds = room.eliminatedIds.filter((eliminatedId) => eliminatedId !== playerId);

  Object.keys(room.votes).forEach((voterId) => {
    if (room.votes[voterId] === playerId) {
      delete room.votes[voterId];
    }
  });

  if (room.voteCandidateIds) {
    room.voteCandidateIds = room.voteCandidateIds.filter((candidateId) => candidateId !== playerId);
  }
}

function resetRoundState(room) {
  clearRoomTimers(room);
  room.phase = "lobby";
  room.topic = "";
  room.word = "";
  room.liarIds = [];
  room.accusedId = null;
  room.result = null;
  room.eliminatedIds = [];
  room.turnOrder = [];
  room.turnIndex = 0;
  room.discussionRound = 1;
  room.breakEndsAt = null;
  room.votes = {};
  room.voteRound = 1;
  room.voteCandidateIds = null;
  room.voteCounts = {};
  room.liarGuessUsed = false;
  room.messages = [];
  room.messageSeq = 0;
}

function exposeVoteCounts(room, counts) {
  room.voteCounts = Object.fromEntries(counts.entries());
}

function startVote(room, candidateIds = null) {
  room.phase = "vote";
  room.votes = {};
  room.voteCandidateIds = candidateIds ? [...candidateIds] : null;
}

function startRound(room) {
  clearRoomTimers(room);

  const prompt = pickPrompt();
  room.round += 1;
  room.phase = "discussion";
  room.topic = prompt.topic;
  room.word = prompt.word;
  room.liarIds = chooseLiarIds(room);
  room.accusedId = null;
  room.result = null;
  room.eliminatedIds = [];
  room.turnOrder = shuffle(getActivePlayers(room).map((player) => player.id));
  room.turnIndex = 0;
  room.discussionRound = 1;
  room.breakEndsAt = null;
  room.votes = {};
  room.voteRound = 1;
  room.voteCandidateIds = null;
  room.voteCounts = {};
  room.liarGuessUsed = false;
  room.messages = [];
  room.messageSeq = 0;
}

function finishRound(room, winner, extra = {}) {
  clearRoomTimers(room);
  room.phase = "result";
  room.breakEndsAt = null;
  room.result = {
    winner,
    topic: room.topic,
    word: room.word,
    liarIds: getLiarIds(room),
    liarId: primaryLiarId(room),
    accusedId: room.accusedId,
    ...extra
  };
}

function startFinalGuess(room) {
  clearRoomTimers(room);
  room.phase = "final-guess";
  room.breakEndsAt = null;
}

function submitTurnGuess(room, player, guess) {
  room.liarGuessUsed = true;

  pushMessage(room, {
    kind: "turn",
    playerId: player.id,
    name: player.name,
    text: `정답 제출: ${guess}`,
    round: room.discussionRound
  });

  if (normalizeAnswer(guess) === normalizeAnswer(room.word)) {
    finishRound(room, "liar", {
      reason: "라이어가 단어를 맞혔습니다",
      guess
    });
    return;
  }

  finishRound(room, "citizen", {
    reason: "라이어가 잘못된 답을 제출했습니다",
    guess
  });
}

function submitFinalGuess(room, player, guess) {
  pushMessage(room, {
    kind: "guess",
    playerId: player.id,
    name: player.name,
    text: guess
  });

  if (normalizeAnswer(guess) === normalizeAnswer(room.word)) {
    finishRound(room, "liar", {
      reason: "라이어가 마지막 정답을 맞혔습니다",
      guess
    });
    return;
  }

  finishRound(room, "citizen", {
    reason: "라이어가 마지막 정답을 틀렸습니다",
    guess
  });
}

function startBreak(room) {
  room.phase = "break";
  room.breakEndsAt = Date.now() + room.settings.breakSeconds * 1000;
}

function resumeDiscussionFromBreak(room) {
  room.phase = "discussion";
  room.breakEndsAt = null;
  room.discussionRound += 1;
  room.turnIndex = 0;
}

function continueEliminationDiscussion(room) {
  room.phase = "discussion";
  room.breakEndsAt = null;
  room.discussionRound += 1;
  room.turnIndex = 0;
  room.turnOrder = shuffle(getActivePlayers(room).map((player) => player.id));
  room.votes = {};
  room.voteRound = 1;
  room.voteCandidateIds = null;
}

function advanceDiscussion(room) {
  if (room.turnIndex + 1 < room.turnOrder.length) {
    room.turnIndex += 1;
    return;
  }

  if (room.settings.voteMode === "elimination") {
    room.breakEndsAt = null;
    room.voteRound = 1;
    room.voteCandidateIds = null;
    room.voteCounts = {};
    startVote(room);
    return;
  }

  if (room.discussionRound >= room.settings.discussionRounds) {
    room.breakEndsAt = null;

    if (room.players.length <= 2) {
      finishRound(room, "citizen", { reason: "2인 플레이는 투표 없이 종료됩니다" });
      return;
    }

    room.voteRound = 1;
    room.voteCandidateIds = null;
    room.voteCounts = {};
    startVote(room);
    return;
  }

  if (room.settings.breakSeconds > 0) {
    startBreak(room);
    return;
  }

  room.discussionRound += 1;
  room.turnIndex = 0;
}

function handleEliminationVoteResult(room, targetId) {
  const target = getPlayer(room, targetId);
  const targetName = target?.name || "플레이어";
  room.accusedId = targetId;

  if (isLiar(room, targetId)) {
    finishRound(room, "citizen", {
      reason: `${targetName}은 라이어가 맞습니다`,
      accusedId: targetId
    });
    return;
  }

  if (!isEliminated(room, targetId)) {
    room.eliminatedIds.push(targetId);
  }

  pushMessage(room, {
    kind: "turn",
    playerId: "system",
    name: "SYSTEM",
    text: `${targetName}은 라이어가 아니었습니다`,
    round: room.discussionRound
  });

  const activePlayers = getActivePlayers(room);
  const remainingCitizens = activePlayers.filter((player) => !isLiar(room, player.id));
  const remainingLiars = activePlayers.filter((player) => isLiar(room, player.id));

  if (remainingCitizens.length <= remainingLiars.length) {
    finishRound(room, "liar", {
      reason: `${targetName}은 라이어가 아니었습니다`,
      accusedId: targetId
    });
    return;
  }

  continueEliminationDiscussion(room);
}

function tallyVotes(room) {
  const counts = new Map();

  Object.values(room.votes).forEach((targetId) => {
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  });

  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);

  if (ranked.length === 0) {
    finishRound(room, "liar", { reason: "투표가 제출되지 않았습니다" });
    return;
  }

  exposeVoteCounts(room, counts);

  const [topPlayerId, topVotes] = ranked[0];
  const ties = ranked.filter(([, voteCount]) => voteCount === topVotes);

  if (ties.length > 1) {
    room.voteRound += 1;
    startVote(
      room,
      ties.map(([playerId]) => playerId)
    );
    return;
  }

  room.accusedId = topPlayerId;

  if (room.settings.voteMode === "elimination") {
    handleEliminationVoteResult(room, topPlayerId);
    return;
  }

  if (isLiar(room, room.accusedId)) {
    startFinalGuess(room);
    return;
  }

  finishRound(room, "liar", { reason: "다른 플레이어를 지목했습니다" });
}

function leaveJoinedRooms(socket) {
  for (const roomName of socket.rooms) {
    if (roomName !== socket.id) {
      socket.leave(roomName);
    }
  }
}

function scheduleBreakEnd(room) {
  if (room.phase !== "break" || !room.breakEndsAt) {
    return;
  }

  const remainingMs = room.breakEndsAt - Date.now();

  if (remainingMs <= 0) {
    resumeDiscussionFromBreak(room);
    syncRoom(room);
    return;
  }

  scheduleRoomTimer(room, remainingMs + 20, () => {
    if (room.phase !== "break") {
      return;
    }

    resumeDiscussionFromBreak(room);
    syncRoom(room);
  });
}

function botDiscussionText() {
  return randomItem(BOT_DISCUSSION_LINES);
}

function pickBotVoteTarget(room, bot) {
  const candidates = getActivePlayers(room).filter(
    (player) =>
      player.id !== bot.id &&
      (!room.voteCandidateIds || room.voteCandidateIds.includes(player.id))
  );

  if (!candidates.length) {
    return null;
  }

  const liarCandidates = candidates.filter((player) => isLiar(room, player.id));

  if (!isLiar(room, bot.id) && liarCandidates.length && Math.random() < 0.65) {
    return randomItem(liarCandidates).id;
  }

  const nonLiarCandidates = candidates.filter((player) => !isLiar(room, player.id));

  if (isLiar(room, bot.id) && nonLiarCandidates.length) {
    return randomItem(nonLiarCandidates).id;
  }

  return randomItem(candidates).id;
}

function pickBotGuess(room) {
  const topicWords = TOPIC_WORDS[room.topic] || Object.values(TOPIC_WORDS).flat();
  const wrongWords = topicWords.filter(
    (word) => normalizeAnswer(word) !== normalizeAnswer(room.word)
  );

  if (Math.random() < 0.35) {
    return room.word;
  }

  return randomItem(wrongWords.length ? wrongWords : topicWords);
}

function scheduleBotTurn(room) {
  const bot = getPlayer(room, activeTurnPlayerId(room));

  if (!bot?.isBot) {
    return;
  }

  scheduleRoomTimer(room, 700 + Math.floor(Math.random() * 900), () => {
    if (
      room.phase !== "discussion" ||
      activeTurnPlayerId(room) !== bot.id ||
      isEliminated(room, bot.id)
    ) {
      return;
    }

    pushMessage(room, {
      kind: "turn",
      playerId: bot.id,
      name: bot.name,
      text: botDiscussionText(room, bot),
      round: room.discussionRound
    });

    advanceDiscussion(room);
    syncRoom(room);
  });
}

function scheduleBotVotes(room) {
  getActivePlayers(room)
    .filter((player) => player.isBot && !room.votes[player.id])
    .forEach((bot, index) => {
      scheduleRoomTimer(room, 800 + index * 650 + Math.floor(Math.random() * 600), () => {
        if (room.phase !== "vote" || room.votes[bot.id] || isEliminated(room, bot.id)) {
          return;
        }

        const targetId = pickBotVoteTarget(room, bot);

        if (!targetId) {
          return;
        }

        room.votes[bot.id] = targetId;

        if (Object.keys(room.votes).length === getActivePlayers(room).length) {
          tallyVotes(room);
        }

        syncRoom(room);
      });
    });
}

function scheduleBotFinalGuess(room) {
  const bot = getPlayer(room, room.accusedId);

  if (!bot?.isBot) {
    return;
  }

  scheduleRoomTimer(room, 1200 + Math.floor(Math.random() * 800), () => {
    if (room.phase !== "final-guess" || room.accusedId !== bot.id) {
      return;
    }

    submitFinalGuess(room, bot, pickBotGuess(room));
    syncRoom(room);
  });
}

function scheduleBotReactions(room) {
  if (!room.testMode || room.phase === "lobby" || room.phase === "result") {
    return;
  }

  const humanPlayers = getHumanPlayers(room);
  const botPlayers = getActivePlayers(room).filter((player) => player.isBot);

  if (!humanPlayers.length || !botPlayers.length) {
    return;
  }

  const delay =
    BOT_REACTION_DELAY_MIN_MS +
    Math.floor(Math.random() * (BOT_REACTION_DELAY_MAX_MS - BOT_REACTION_DELAY_MIN_MS));

  scheduleRoomTimer(room, delay, () => {
    if (!room.testMode || room.phase === "lobby" || room.phase === "result") {
      return;
    }

    const nextHumanPlayers = getHumanPlayers(room);
    const nextBotPlayers = getActivePlayers(room).filter((player) => player.isBot);

    if (nextHumanPlayers.length && nextBotPlayers.length) {
      const bot = randomItem(nextBotPlayers);
      const target = randomItem(nextHumanPlayers);
      const reactionKey = randomItem(Object.keys(REACTION_EMOJIS));

      broadcastReaction(room, createReactionPayload(bot.id, target.id, reactionKey));
    }

    scheduleBotReactions(room);
  });
}

function refreshRoomAutomation(room) {
  clearRoomTimers(room);

  if (room.phase === "break") {
    scheduleBreakEnd(room);
  }

  if (!room.testMode) {
    return;
  }

  if (room.phase === "discussion") {
    scheduleBotTurn(room);
  }

  if (room.phase === "vote") {
    scheduleBotVotes(room);
  }

  if (room.phase === "final-guess") {
    scheduleBotFinalGuess(room);
  }

  scheduleBotReactions(room);
}

function syncRoom(room) {
  persistRoomState(room);
  broadcastRoom(room);
  refreshRoomAutomation(room);
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
    syncRoom(room);
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

function removePlayer(playerId) {
  cancelDisconnect(disconnectTimers, playerId);

  for (const room of rooms.values()) {
    const index = room.players.findIndex((player) => player.id === playerId);

    if (index === -1) {
      continue;
    }

    const [removedPlayer] = room.players.splice(index, 1);
    removeVotesForPlayer(room, removedPlayer.id);

    if (getHumanPlayers(room).length === 0) {
      clearRoomTimers(room);
      rooms.delete(room.code);
      deletePersistedRoom(room.code);
      return;
    }

    if (room.hostId === playerId) {
      room.hostId = nextHostId(room);
    }

    if (room.phase !== "lobby" && room.phase !== "result") {
      const winner = isLiar(room, removedPlayer.id) ? "citizen" : "liar";
      finishRound(room, winner, {
        reason: "플레이어가 중간에 나갔습니다",
        accusedId: room.accusedId
      });
    }

    syncRoom(room);
    return;
  }
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name, settings }, callback = () => {}) => {
    const cleanName = sanitizeName(name);
    const playerId = getSocketPlayerId(socket);

    if (!cleanName) {
      callback({ ok: false, message: "이름을 입력하세요" });
      return;
    }

    removePlayer(playerId);
    leaveJoinedRooms(socket);

    const room = createRoom(generateRoomCode(), playerId, socket.id, cleanName, { settings });
    attachSocketToPlayer(room, socket, room.players[0]);
    syncRoom(room);
    callback({ ok: true, code: room.code });
  });

  socket.on("room:join", ({ code, name }, callback = () => {}) => {
    const cleanName = sanitizeName(name);
    const room = getRoom(code);
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
      syncRoom(room);
      callback({ ok: true, code: room.code, restored: true });
      return;
    }
    if (room.phase !== "lobby") {
      callback({ ok: false, message: "게임이 이미 진행 중입니다" });
      return;
    }
    removePlayer(playerId);
    leaveJoinedRooms(socket);

    room.players.push(createPlayer(playerId, cleanName, false, socket.id));
    attachSocketToPlayer(room, socket, room.players[room.players.length - 1]);
    syncRoom(room);
    callback({ ok: true, code: room.code });
  });

  socket.on("room:leave", (_payload = {}, callback = () => {}) => {
    leaveRoomForSocket(socket);
    callback({ ok: true });
  });

  socket.on("round:start", ({ code }, callback = () => {}) => {
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

    if (room.testMode) {
      ensureTestBots(room);
    }

    if (room.players.length < MIN_PLAYERS) {
      callback({ ok: false, message: `${MIN_PLAYERS}명부터 시작할 수 있습니다` });
      return;
    }

    if (room.players.length <= room.settings.liarCount) {
      callback({
        ok: false,
        message: `라이어 ${room.settings.liarCount}명은 ${room.settings.liarCount + 1}명부터 시작할 수 있습니다`
      });
      return;
    }

    if (room.settings.voteMode === "elimination" && room.players.length < 3) {
      callback({ ok: false, message: "라운드별 지목은 3명부터 시작할 수 있습니다" });
      return;
    }

    startRound(room);
    syncRoom(room);
    callback({ ok: true });
  });

  socket.on("chat:send", ({ code, text }, callback = () => {}) => {
    const room = getRoom(code);
    const playerId = getSocketPlayerId(socket);
    const player = room ? getPlayer(room, playerId) : null;
    const cleanText = sanitizeText(text, MAX_CHAT_LENGTH);

    if (!room || !player) {
      callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
      return;
    }

    if (room.phase === "lobby") {
      callback({ ok: false, message: "게임 시작 후에 채팅할 수 있습니다" });
      return;
    }

    if (room.settings.voteMode === "elimination" && isEliminated(room, playerId)) {
      callback({ ok: false, message: "탈락한 플레이어는 채팅할 수 없습니다" });
      return;
    }

    if (!cleanText) {
      callback({ ok: false, message: "채팅 내용을 입력하세요" });
      return;
    }

    pushMessage(room, {
      kind: "chat",
      playerId: player.id,
      name: player.name,
      text: cleanText
    });

    syncRoom(room);
    callback({ ok: true });
  });

  socket.on("reaction:send", ({ code, targetId, reaction }, callback = () => {}) => {
    const room = getRoom(code);
    const playerId = getSocketPlayerId(socket);
    const player = room ? getPlayer(room, playerId) : null;
    const target = room ? getPlayer(room, targetId) : null;
    const reactionKey = String(reaction || "");
    const emoji = REACTION_EMOJIS[reactionKey];

    if (!room || !player) {
      callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
      return;
    }

    if (!target) {
      callback({ ok: false, message: "대상을 확인하세요" });
      return;
    }

    if (target.id === player.id) {
      callback({ ok: false, message: "자기 자신에게는 보낼 수 없습니다" });
      return;
    }

    if (!emoji) {
      callback({ ok: false, message: "이모지를 확인하세요" });
      return;
    }

    broadcastReaction(room, createReactionPayload(player.id, target.id, reactionKey));

    callback({ ok: true });
  });

  socket.on("discussion:submit", ({ code, text }, callback = () => {}) => {
    const room = getRoom(code);
    const playerId = getSocketPlayerId(socket);
    const player = room ? getPlayer(room, playerId) : null;
    const cleanText = sanitizeText(text, MAX_OPINION_LENGTH);

    if (!room || !player) {
      callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
      return;
    }

    if (room.phase !== "discussion") {
      callback({ ok: false, message: "지금은 발언할 수 없습니다" });
      return;
    }

    if (activeTurnPlayerId(room) !== playerId) {
      callback({ ok: false, message: "아직 당신 차례가 아닙니다" });
      return;
    }

    if (!cleanText) {
      callback({ ok: false, message: "발언 내용을 입력하세요" });
      return;
    }

    pushMessage(room, {
      kind: "turn",
      playerId: player.id,
      name: player.name,
      text: cleanText,
      round: room.discussionRound
    });

    advanceDiscussion(room);
    syncRoom(room);
    callback({ ok: true });
  });

  socket.on("liar:guess", ({ code, guess }, callback = () => {}) => {
    const room = getRoom(code);
    const playerId = getSocketPlayerId(socket);
    const player = room ? getPlayer(room, playerId) : null;
    const cleanGuess = sanitizeText(guess, MAX_GUESS_LENGTH);

    if (!room || !player) {
      callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
      return;
    }

    if (!isLiar(room, playerId)) {
      callback({ ok: false, message: "라이어만 추리할 수 있습니다" });
      return;
    }

    if (!cleanGuess) {
      callback({ ok: false, message: "정답 단어를 입력하세요" });
      return;
    }

    if (room.phase === "discussion") {
      if (activeTurnPlayerId(room) !== playerId) {
        callback({ ok: false, message: "지금은 당신 차례가 아닙니다" });
        return;
      }

      if (room.liarGuessUsed) {
        callback({ ok: false, message: "턴 정답 제출은 한 번만 가능합니다" });
        return;
      }

      submitTurnGuess(room, player, cleanGuess);
      syncRoom(room);
      callback({ ok: true });
      return;
    }

    if (room.phase === "final-guess" && room.accusedId === playerId) {
      submitFinalGuess(room, player, cleanGuess);
      syncRoom(room);
      callback({ ok: true });
      return;
    }

    callback({ ok: false, message: "지금은 정답을 제출할 수 없습니다" });
  });

  socket.on("vote:submit", ({ code, targetId }, callback = () => {}) => {
    const room = getRoom(code);
    const playerId = getSocketPlayerId(socket);
    const player = room ? getPlayer(room, playerId) : null;

    if (!room || !player) {
      callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
      return;
    }

    if (room.phase !== "vote") {
      callback({ ok: false, message: "지금은 투표할 수 없습니다" });
      return;
    }

    if (isEliminated(room, playerId)) {
      callback({ ok: false, message: "탈락한 플레이어는 투표할 수 없습니다" });
      return;
    }

    if (
      !room.players.some(
        (candidate) =>
          candidate.id === targetId &&
          !isEliminated(room, candidate.id) &&
          (!room.voteCandidateIds || room.voteCandidateIds.includes(candidate.id))
      )
    ) {
      callback({ ok: false, message: "대상을 확인하세요" });
      return;
    }

    if (targetId === playerId) {
      callback({ ok: false, message: "자기 자신에게는 투표할 수 없습니다" });
      return;
    }

    room.votes[playerId] = targetId;

    if (Object.keys(room.votes).length === getActivePlayers(room).length) {
      tallyVotes(room);
    }

    syncRoom(room);
    callback({ ok: true });
  });

  socket.on("round:reset", ({ code }, callback = () => {}) => {
    const room = getRoom(code);
    const playerId = getSocketPlayerId(socket);

    if (!room) {
      callback({ ok: false, message: "방을 찾을 수 없습니다" });
      return;
    }

    if (room.hostId !== playerId) {
      callback({ ok: false, message: "호스트만 초기화할 수 있습니다" });
      return;
    }

    resetRoundState(room);
    syncRoom(room);
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
    syncRoom(room);
  });

  if (snapshots.length) {
    console.log(`[liar] restored ${snapshots.length} room(s) from Redis`);
  }
}

async function bootstrap() {
  logProcessEvent("bootstrap_start");

  await Promise.all([
    attachBangGame(io),
    attachDavinciGame(io),
    attachCatchmindGame(io),
    attachHalliGame(io),
    attachMemoryGame(io),
    attachOmokGame(io),
    attachYutGame(io),
    restorePersistedRooms()
  ]);

  server.listen(PORT, () => {
    logProcessEvent("listening", {
      port: PORT,
      url: `http://localhost:${PORT}`
    });
  });
}

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logProcessEvent("shutdown_start", { signal });

  const forceExitTimer = setTimeout(() => {
    logProcessEvent("shutdown_force_exit", { signal }, "error");
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  try {
    await new Promise((resolve) => {
      io.close(() => {
        resolve();
      });
    });
    logProcessEvent("socket_server_closed", { signal });
  } catch (error) {
    logProcessEvent("socket_server_close_failed", { signal, error: serializeUnknownError(error) }, "error");
  }

  try {
    await closeRedisClient();
    logProcessEvent("redis_closed", { signal });
  } catch (error) {
    logProcessEvent("redis_close_failed", { signal, error: serializeUnknownError(error) }, "error");
  } finally {
    clearTimeout(forceExitTimer);
    logProcessEvent("shutdown_complete", { signal });
    process.exit(0);
  }
}

server.on("error", (error) => {
  logProcessEvent("http_server_error", { error: serializeUnknownError(error) }, "error");
});

server.on("close", () => {
  logProcessEvent("http_server_closed");
});

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

process.on("uncaughtException", (error, origin) => {
  logProcessEvent("uncaught_exception", { origin, error: serializeUnknownError(error) }, "error");
});

process.on("unhandledRejection", (reason) => {
  logProcessEvent("unhandled_rejection", { error: serializeUnknownError(reason) }, "error");
});

bootstrap().catch(async (error) => {
  logProcessEvent("bootstrap_fatal_error", { error: serializeUnknownError(error) }, "error");
  await closeRedisClient().catch(() => {});
  process.exit(1);
});
