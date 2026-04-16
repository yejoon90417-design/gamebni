module.exports = function attachBangGame(rootIo) {
const io = rootIo.of("/bang");
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
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 7;
const BOT_DELAY_MS = 900;
const MAX_BOT_PLAYS = 5;

const SUITS = ["spades", "hearts", "diamonds", "clubs"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const ROLE_SETS = {
  3: ["deputy", "outlaw", "renegade"],
  4: ["sheriff", "outlaw", "outlaw", "renegade"],
  5: ["sheriff", "deputy", "outlaw", "outlaw", "renegade"],
  6: ["sheriff", "deputy", "outlaw", "outlaw", "outlaw", "renegade"],
  7: ["sheriff", "deputy", "deputy", "outlaw", "outlaw", "outlaw", "renegade"]
};

const ROLE_TEXT = {
  sheriff: "보안관",
  deputy: "부관",
  outlaw: "무법자",
  renegade: "배신자"
};

const CARD_SPECS = [
  ["bang", "뱅!", "brown", 25],
  ["missed", "빗나감!", "brown", 12],
  ["beer", "맥주", "brown", 6],
  ["cat_balou", "캣 벌루", "brown", 4],
  ["panic", "강탈", "brown", 4],
  ["stagecoach", "역마차", "brown", 2],
  ["wells_fargo", "웰스 파고", "brown", 1],
  ["general_store", "잡화점", "brown", 2],
  ["indians", "인디언!", "brown", 2],
  ["duel", "결투", "brown", 3],
  ["gatling", "기관총", "brown", 1],
  ["saloon", "주점", "brown", 1],
  ["jail", "감옥", "blue", 3],
  ["dynamite", "다이너마이트", "blue", 1],
  ["barrel", "술통", "blue", 2],
  ["mustang", "야생마", "blue", 2],
  ["scope", "조준경", "blue", 1],
  ["volcanic", "볼캐닉", "blue", 2, { weaponRange: 1 }],
  ["schofield", "스코필드", "blue", 3, { weaponRange: 2 }],
  ["remington", "레밍턴", "blue", 1, { weaponRange: 3 }],
  ["rev_carabine", "레버 카빈", "blue", 1, { weaponRange: 4 }],
  ["winchester", "윈체스터", "blue", 1, { weaponRange: 5 }]
];

const CARD_DESCRIPTIONS = {
  bang: "사거리 안의 플레이어 1명을 공격합니다. 피하지 못하면 피해 1을 받습니다.",
  missed: "뱅이나 기관총 공격을 피합니다. 이 구현에서는 방어 때 자동으로 사용됩니다.",
  beer: "체력 1을 회복합니다. 탈락 직전에도 조건이 맞으면 자동으로 사용됩니다.",
  cat_balou: "아무 플레이어 1명의 손패나 장비 중 1장을 버립니다.",
  panic: "거리 1인 플레이어 1명의 손패나 장비 중 1장을 가져옵니다.",
  stagecoach: "덱에서 카드 2장을 뽑습니다.",
  wells_fargo: "덱에서 카드 3장을 뽑습니다.",
  general_store: "살아있는 플레이어들이 차례로 카드 1장씩 얻습니다.",
  indians: "다른 모든 플레이어는 뱅을 버리거나 피해 1을 받습니다.",
  duel: "대상과 번갈아 뱅을 버립니다. 먼저 못 버린 쪽이 피해 1을 받습니다.",
  gatling: "다른 모든 플레이어에게 뱅 공격을 합니다.",
  saloon: "살아있는 모든 플레이어가 체력 1을 회복합니다.",
  jail: "보안관이 아닌 플레이어에게 둡니다. 그 플레이어는 턴 시작 판정에 실패하면 턴을 넘깁니다.",
  dynamite: "내 앞에 둡니다. 턴 시작 판정에서 스페이드 2~9가 나오면 피해 3, 아니면 다음 사람에게 넘어갑니다.",
  barrel: "뱅을 맞을 때 하트 판정에 성공하면 공격을 피합니다.",
  mustang: "다른 플레이어가 나를 볼 때 거리가 1 늘어납니다.",
  scope: "내가 다른 플레이어를 볼 때 거리가 1 줄어듭니다.",
  volcanic: "사거리 1 무기입니다. 장착 중에는 한 턴에 뱅을 여러 번 사용할 수 있습니다.",
  schofield: "사거리 2 무기입니다.",
  remington: "사거리 3 무기입니다.",
  rev_carabine: "사거리 4 무기입니다.",
  winchester: "사거리 5 무기입니다."
};

const CHARACTERS = [
  ["bart_cassidy", "바트 캐시디", 4, "피해를 받을 때마다 카드 1장을 뽑습니다."],
  ["black_jack", "블랙 잭", 4, "드로우 두 번째 카드가 빨강이면 1장을 더 뽑습니다."],
  ["calamity_janet", "캘러미티 자넷", 4, "뱅과 빗나감을 서로처럼 사용할 수 있습니다."],
  ["el_gringo", "엘 그링고", 3, "피해를 받으면 공격자의 손패 1장을 가져옵니다."],
  ["jesse_jones", "제시 존스", 4, "드로우 첫 장을 다른 플레이어 손패에서 가져오고, 두 번째 장은 덱에서 뽑습니다."],
  ["jourdonnais", "주르도네", 4, "항상 술통 판정을 하나 더 가집니다."],
  ["kit_carlson", "키트 칼슨", 4, "덱 위 3장 중 2장을 가져오고 1장은 덱 위로 돌립니다."],
  ["lucky_duke", "럭키 듀크", 4, "판정할 때 두 장 중 유리한 결과를 적용합니다."],
  ["paul_regret", "폴 리그레트", 3, "항상 야생마를 장착한 것처럼 보입니다."],
  ["pedro_ramirez", "페드로 라미레즈", 4, "드로우 첫 장을 버린 카드 더미 위에서 가져오고, 두 번째 장은 덱에서 뽑습니다."],
  ["rose_doolan", "로즈 둘란", 4, "항상 조준경을 장착한 것처럼 봅니다."],
  ["sid_ketchum", "시드 케첨", 4, "손패 2장을 버려 체력 1을 회복할 수 있습니다."],
  ["slab_the_killer", "슬랩 더 킬러", 4, "그가 쏜 뱅은 빗나감 2장이 필요합니다."],
  ["suzy_lafayette", "수지 라파예트", 4, "손패가 비면 카드 1장을 뽑습니다."],
  ["vulture_sam", "벌쳐 샘", 4, "누군가 탈락하면 그 플레이어의 카드를 가져옵니다."],
  ["willy_the_kid", "윌리 더 키드", 4, "한 턴에 뱅을 여러 번 사용할 수 있습니다."]
].map(([id, name, hp, ability]) => ({ id, name, hp, ability }));

const rooms = new Map();
const disconnectTimers = new Map();
const DISCONNECT_GRACE_MS = getDisconnectGraceMs();
const roomStore = createRoomStore({
  gameKey: "bang",
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
    return 4;
  }
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, count));
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

function createCard(spec, sequence) {
  const [id, name, type, _count, extra = {}] = spec;
  const suit = SUITS[sequence % SUITS.length];
  const rank = RANKS[sequence % RANKS.length];

  return {
    id: `${id}:${sequence}:${Math.random().toString(36).slice(2)}`,
    cardId: id,
    name,
    type,
    description: CARD_DESCRIPTIONS[id] || "",
    suit,
    rank,
    ...extra
  };
}

function createDeck() {
  let sequence = 0;
  const cards = [];

  CARD_SPECS.forEach((spec) => {
    const count = spec[3];
    for (let index = 0; index < count; index += 1) {
      cards.push(createCard(spec, sequence));
      sequence += 1;
    }
  });

  return shuffle(cards);
}

function createPlayer(id, name, options = {}) {
  return {
    id,
    name: sanitizeName(name),
    isBot: Boolean(options.isBot),
    role: null,
    roleRevealed: false,
    character: null,
    hp: 0,
    maxHp: 0,
    hand: [],
    inPlay: {
      weapon: null,
      barrel: null,
      mustang: null,
      scope: null,
      jail: null,
      dynamite: null
    },
    alive: true,
    bangUsedThisTurn: 0,
    ...createPresenceState(options.isBot ? null : options.socketId || null)
  };
}

function createRoom(code, hostId, hostSocketId, hostName, options = {}) {
  const room = {
    code,
    hostId,
    targetPlayerCount: sanitizeTargetPlayerCount(options.targetPlayerCount),
    phase: "lobby",
    players: [createPlayer(hostId, hostName, { socketId: hostSocketId })],
    deck: [],
    discard: [],
    currentPlayerId: null,
    result: null,
    log: [],
    pendingChoice: null,
    botTimer: null
  };

  rooms.set(code, room);
  return room;
}

function createBotPlayer(room) {
  const count = room.players.filter((player) => player.isBot).length + 1;
  return createPlayer(
    `bot:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    `BOT ${count}`,
    { isBot: true }
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
  room.deck = Array.isArray(snapshot.deck) ? snapshot.deck : [];
  room.discard = Array.isArray(snapshot.discard) ? snapshot.discard : [];
  room.log = Array.isArray(snapshot.log) ? snapshot.log : [];
  room.pendingChoice = snapshot.pendingChoice || null;
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

function activePlayers(room) {
  return room.players.filter((player) => player.alive);
}

function humanPlayers(room) {
  return room.players.filter((player) => !player.isBot);
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

function clearBotTimer(room) {
  if (!room?.botTimer) {
    return;
  }

  clearTimeout(room.botTimer);
  room.botTimer = null;
}

function drawOne(room) {
  if (!room.deck.length && room.discard.length) {
    room.deck = shuffle(room.discard);
    room.discard = [];
    pushLog(room, "버린 카드 더미를 섞었습니다");
  }

  return room.deck.pop() || null;
}

function drawCards(room, player, count) {
  for (let index = 0; index < count; index += 1) {
    const card = drawOne(room);
    if (!card) {
      return;
    }
    player.hand.push(card);
  }
}

function drawFromDiscard(room) {
  return room.discard.pop() || null;
}

function discardCard(room, card) {
  if (card) {
    room.discard.push(card);
  }
}

function removeFromHand(player, cardId) {
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index === -1) {
    return null;
  }
  return player.hand.splice(index, 1)[0];
}

function randomHandCard(player, predicate = () => true) {
  return randomItem(player.hand.filter(predicate));
}

function roleText(player) {
  return ROLE_TEXT[player.role] || "-";
}

function assignRoles(room) {
  const roles = shuffle(ROLE_SETS[room.players.length]);
  room.players.forEach((player, index) => {
    player.role = roles[index];
    player.roleRevealed = player.role === "sheriff";
  });
}

function assignCharacters(room) {
  const characters = shuffle(CHARACTERS);
  room.players.forEach((player, index) => {
    const character = characters[index];
    player.character = character;
    player.maxHp = character.hp + (player.role === "sheriff" ? 1 : 0);
    player.hp = player.maxHp;
  });
}

function sheriff(room) {
  return room.players.find((player) => player.role === "sheriff") || null;
}

function firstTurnPlayer(room) {
  return sheriff(room) || room.players[0];
}

function resetPlayerForGame(player) {
  player.role = null;
  player.roleRevealed = false;
  player.character = null;
  player.hp = 0;
  player.maxHp = 0;
  player.hand = [];
  player.inPlay = {
    weapon: null,
    barrel: null,
    mustang: null,
    scope: null,
    jail: null,
    dynamite: null
  };
  player.alive = true;
  player.bangUsedThisTurn = 0;
}

function canStart(room) {
  return room.players.length === room.targetPlayerCount;
}

function startGame(room) {
  clearBotTimer(room);
  room.deck = createDeck();
  room.discard = [];
  room.result = null;
  room.log = [];
  room.pendingChoice = null;
  room.players.forEach(resetPlayerForGame);
  assignRoles(room);
  assignCharacters(room);
  room.players.forEach((player) => drawCards(room, player, player.hp));
  room.currentPlayerId = firstTurnPlayer(room).id;
  room.phase = "draw";
  pushLog(room, "게임 시작");
  pushLog(room, `${getPlayer(room, room.currentPlayerId).name} 차례`);
}

function resetGame(room) {
  clearBotTimer(room);
  room.phase = "lobby";
  room.deck = [];
  room.discard = [];
  room.currentPlayerId = null;
  room.result = null;
  room.log = [];
  room.pendingChoice = null;
  room.players.forEach(resetPlayerForGame);
}

function weaponRange(player) {
  return player.inPlay.weapon?.weaponRange || 1;
}

function nextAliveIndex(room, startIndex, step) {
  let index = startIndex;

  for (let count = 0; count < room.players.length; count += 1) {
    index = (index + step + room.players.length) % room.players.length;
    if (room.players[index].alive) {
      return index;
    }
  }

  return startIndex;
}

function distanceBetween(room, fromId, toId) {
  const fromIndex = room.players.findIndex((player) => player.id === fromId);
  const toIndex = room.players.findIndex((player) => player.id === toId);

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return 0;
  }

  let clockwise = 0;
  let cursor = fromIndex;

  while (cursor !== toIndex) {
    cursor = nextAliveIndex(room, cursor, 1);
    clockwise += 1;
  }

  let counter = 0;
  cursor = fromIndex;

  while (cursor !== toIndex) {
    cursor = nextAliveIndex(room, cursor, -1);
    counter += 1;
  }

  const attacker = getPlayer(room, fromId);
  const target = getPlayer(room, toId);
  const scope = (attacker.inPlay.scope ? 1 : 0) + (attacker.character?.id === "rose_doolan" ? 1 : 0);
  const mustang = (target.inPlay.mustang ? 1 : 0) + (target.character?.id === "paul_regret" ? 1 : 0);

  return Math.max(1, Math.min(clockwise, counter) + mustang - scope);
}

function isRed(card) {
  return card.suit === "hearts" || card.suit === "diamonds";
}

function isHeart(card) {
  return card.suit === "hearts";
}

function isDynamiteHit(card) {
  return card.suit === "spades" && ["2", "3", "4", "5", "6", "7", "8", "9"].includes(card.rank);
}

function judge(room, player, predicate, options = {}) {
  const preferMatch = options.preferMatch !== false;
  const first = drawOne(room);
  const second = player.character?.id === "lucky_duke" ? drawOne(room) : null;
  const candidates = [first, second].filter(Boolean);
  const picked = preferMatch
    ? candidates.find(predicate) || candidates[0] || null
    : candidates.find((card) => !predicate(card)) || candidates[0] || null;

  candidates.forEach((card) => discardCard(room, card));
  return picked;
}

function clearPendingChoice(room, options = {}) {
  const pending = room.pendingChoice;

  if (options.restoreCards && pending?.abilityId === "kit_carlson" && Array.isArray(pending.peeked)) {
    pending.peeked
      .slice()
      .reverse()
      .forEach((card) => {
        room.deck.push(card);
      });
  }

  room.pendingChoice = null;
}

function finishDrawPhase(room, player) {
  clearPendingChoice(room);
  room.phase = "play";
  pushLog(room, `${player.name} 카드 뽑기`);
}

function discardInPlay(room, player, slot) {
  const card = player.inPlay[slot];
  player.inPlay[slot] = null;
  discardCard(room, card);
  return card;
}

function aliveOpponents(room, player) {
  return activePlayers(room).filter((target) => target.id !== player.id);
}

function botTargets(room, bot) {
  const alive = aliveOpponents(room, bot);

  if (bot.role === "sheriff" || bot.role === "deputy") {
    return alive
      .filter((player) => ["outlaw", "renegade"].includes(player.role))
      .sort((left, right) => left.hp - right.hp);
  }

  if (bot.role === "outlaw") {
    return alive
      .filter((player) => ["sheriff", "deputy"].includes(player.role))
      .sort((left, right) => {
        const leftScore = left.role === "sheriff" ? 0 : 1;
        const rightScore = right.role === "sheriff" ? 0 : 1;
        return leftScore - rightScore;
      });
  }

  return alive.sort((left, right) => right.hp - left.hp);
}

function collectDiscardableCards(player) {
  const cards = [...player.hand];
  Object.values(player.inPlay).forEach((card) => {
    if (card) {
      cards.push(card);
    }
  });
  return cards;
}

function removeRandomCardFromPlayer(room, player, moveToDiscard = true) {
  const slots = Object.entries(player.inPlay).filter(([_slot, card]) => Boolean(card));
  const sources = [];

  if (player.hand.length) {
    sources.push("hand");
  }
  if (slots.length) {
    sources.push("inPlay");
  }
  if (!sources.length) {
    return null;
  }

  const source = randomItem(sources);
  let card = null;

  if (source === "hand") {
    const index = Math.floor(Math.random() * player.hand.length);
    card = player.hand.splice(index, 1)[0];
  } else {
    const [slot] = randomItem(slots);
    card = player.inPlay[slot];
    player.inPlay[slot] = null;
  }

  if (moveToDiscard) {
    discardCard(room, card);
  }

  return card;
}

function ensureHandRefill(room, player) {
  if (player.alive && player.character?.id === "suzy_lafayette" && player.hand.length === 0) {
    drawCards(room, player, 1);
    pushLog(room, `${player.name} 카드 1장`);
  }
}

function finishGame(room, winnerId, reason) {
  clearBotTimer(room);
  clearPendingChoice(room);
  room.phase = "result";
  room.currentPlayerId = null;
  room.result = { winnerId, reason };
  room.players.forEach((player) => {
    player.roleRevealed = true;
  });
  pushLog(room, reason);
}

function checkWin(room) {
  const alive = activePlayers(room);
  const activeSheriff = sheriff(room);

  if (!activeSheriff) {
    if (alive.length === 1) {
      finishGame(room, alive[0].id, `${alive[0].name} 승리`);
      return true;
    }
    return false;
  }

  if (!activeSheriff.alive) {
    const winner = alive.length === 1 && alive[0].role === "renegade" ? "배신자" : "무법자";
    finishGame(room, null, `${winner} 승리`);
    return true;
  }

  if (!alive.some((player) => ["outlaw", "renegade"].includes(player.role))) {
    finishGame(room, activeSheriff.id, "보안관 팀 승리");
    return true;
  }

  return false;
}

function eliminatePlayer(room, player, sourcePlayer) {
  player.alive = false;
  player.roleRevealed = true;
  pushLog(room, `${player.name} 탈락 (${roleText(player)})`);

  if (sourcePlayer?.alive && player.role === "outlaw") {
    drawCards(room, sourcePlayer, 3);
    pushLog(room, `${sourcePlayer.name} 현상금 3장`);
  }

  if (sourcePlayer?.alive && sourcePlayer.role === "sheriff" && player.role === "deputy") {
    sourcePlayer.hand.forEach((card) => discardCard(room, card));
    sourcePlayer.hand = [];
    Object.keys(sourcePlayer.inPlay).forEach((slot) => discardInPlay(room, sourcePlayer, slot));
    pushLog(room, `${sourcePlayer.name} 부관 처치 패널티`);
  }

  const collector = room.players.find((candidate) => candidate.alive && candidate.character?.id === "vulture_sam");
  if (collector) {
    const cards = collectDiscardableCards(player);
    collector.hand.push(...cards);
    pushLog(room, `${collector.name} 카드 회수`);
  } else {
    player.hand.forEach((card) => discardCard(room, card));
    Object.values(player.inPlay).forEach((card) => discardCard(room, card));
  }

  player.hand = [];
  Object.keys(player.inPlay).forEach((slot) => {
    player.inPlay[slot] = null;
  });

  checkWin(room);
}

function heal(player, amount) {
  if (!player.alive) {
    return 0;
  }

  const before = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + amount);
  return player.hp - before;
}

function takeDamage(room, target, amount, sourcePlayer) {
  for (let hit = 0; hit < amount; hit += 1) {
    if (!target.alive) {
      return;
    }

    target.hp -= 1;
    pushLog(room, `${target.name} 피해 1`);

    if (target.character?.id === "bart_cassidy") {
      drawCards(room, target, 1);
    }

    if (target.character?.id === "el_gringo" && sourcePlayer?.hand.length) {
      const stolen = randomHandCard(sourcePlayer);
      if (stolen) {
        target.hand.push(removeFromHand(sourcePlayer, stolen.id));
      }
    }

    if (target.hp <= 0) {
      const beer = randomHandCard(target, (card) => card.cardId === "beer");
      if (beer && activePlayers(room).length > 2) {
        discardCard(room, removeFromHand(target, beer.id));
        target.hp = 1;
        pushLog(room, `${target.name} 맥주`);
      } else {
        eliminatePlayer(room, target, sourcePlayer);
      }
    }
  }
}

function missedCardsFor(player, count) {
  const missed = player.hand.filter((card) => card.cardId === "missed");

  if (player.character?.id === "calamity_janet") {
    missed.push(...player.hand.filter((card) => card.cardId === "bang"));
  }

  return missed.slice(0, count);
}

function discardSpecificCards(room, player, cards) {
  cards.forEach((card) => {
    discardCard(room, removeFromHand(player, card.id));
  });
  ensureHandRefill(room, player);
}

function barrelMissCount(room, target) {
  const attempts = (target.inPlay.barrel ? 1 : 0) + (target.character?.id === "jourdonnais" ? 1 : 0);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const judged = judge(room, target, isHeart);
    if (judged && isHeart(judged)) {
      return 1;
    }
  }

  return 0;
}

function resolveShot(room, attacker, target, options = {}) {
  const amount = options.amount || 1;
  const needsDoubleMissed = Boolean(options.isBang) && attacker.character?.id === "slab_the_killer";

  if (!target.alive || room.phase === "result") {
    return;
  }

  const needed = needsDoubleMissed ? 2 : 1;
  const barrelMisses = barrelMissCount(room, target);
  if (barrelMisses >= needed) {
    pushLog(room, `${target.name} 술통 회피`);
    return;
  }

  const missed = missedCardsFor(target, needed - barrelMisses);

  if (missed.length + barrelMisses >= needed) {
    discardSpecificCards(room, target, missed);
    pushLog(room, barrelMisses ? `${target.name} 술통 + 빗나감` : `${target.name} 빗나감`);
    return;
  }

  takeDamage(room, target, amount, attacker);
}

function bangCardsFor(player) {
  const bang = player.hand.filter((card) => card.cardId === "bang");

  if (player.character?.id === "calamity_janet") {
    bang.push(...player.hand.filter((card) => card.cardId === "missed"));
  }

  return bang;
}

function discardBangForDuel(room, player) {
  const card = bangCardsFor(player)[0];

  if (!card) {
    return false;
  }

  discardCard(room, removeFromHand(player, card.id));
  ensureHandRefill(room, player);
  return true;
}

function resolveDuel(room, player, target) {
  let current = target;

  while (current.alive && room.phase !== "result") {
    if (!discardBangForDuel(room, current)) {
      takeDamage(room, current, 1, current.id === player.id ? target : player);
      return;
    }

    current = current.id === player.id ? target : player;
  }
}

function equipCard(room, player, card) {
  if (card.weaponRange) {
    discardCard(room, player.inPlay.weapon);
    player.inPlay.weapon = card;
    pushLog(room, `${player.name} ${card.name}`);
    return { ok: true };
  }

  const slotByCard = {
    barrel: "barrel",
    mustang: "mustang",
    scope: "scope",
    dynamite: "dynamite"
  };
  const slot = slotByCard[card.cardId];

  if (!slot) {
    return { ok: false, message: "장착할 수 없습니다" };
  }

  if (player.inPlay[slot]) {
    return { ok: false, message: "이미 장착했습니다" };
  }

  player.inPlay[slot] = card;
  pushLog(room, `${player.name} ${card.name}`);
  return { ok: true };
}

function playTargetEquipment(room, player, card, target) {
  if (card.cardId === "jail") {
    if (!target || !target.alive || target.id === player.id || target.role === "sheriff" || target.inPlay.jail) {
      return { ok: false, message: "감옥 대상을 선택하세요" };
    }
    target.inPlay.jail = card;
    pushLog(room, `${player.name} 감옥 -> ${target.name}`);
    return { ok: true };
  }

  return equipCard(room, player, card);
}

function validateTarget(room, player, targetId) {
  const target = getPlayer(room, targetId);

  if (!target || !target.alive || target.id === player.id) {
    return null;
  }

  return target;
}

function playCardEffect(room, player, card, targetId) {
  const target = validateTarget(room, player, targetId);

  if (card.type === "blue") {
    return playTargetEquipment(room, player, card, target);
  }

  if (card.cardId === "bang" || (card.cardId === "missed" && player.character?.id === "calamity_janet")) {
    if (!target) {
      return { ok: false, message: "대상을 선택하세요" };
    }
    if (distanceBetween(room, player.id, target.id) > weaponRange(player)) {
      return { ok: false, message: "사거리 밖입니다" };
    }
    if (
      player.bangUsedThisTurn > 0 &&
      player.character?.id !== "willy_the_kid" &&
      player.inPlay.weapon?.cardId !== "volcanic"
    ) {
      return { ok: false, message: "뱅은 한 턴에 한 번입니다" };
    }
    player.bangUsedThisTurn += 1;
    pushLog(room, `${player.name} 뱅 -> ${target.name}`);
    resolveShot(room, player, target, { amount: 1, isBang: true });
    return { ok: true };
  }

  if (card.cardId === "missed") {
    return { ok: false, message: "지금 사용할 수 없습니다" };
  }

  if (card.cardId === "beer") {
    const healed = heal(player, 1);
    pushLog(room, healed ? `${player.name} 맥주` : `${player.name} 맥주 효과 없음`);
    return { ok: true };
  }

  if (card.cardId === "saloon") {
    activePlayers(room).forEach((targetPlayer) => heal(targetPlayer, 1));
    pushLog(room, `${player.name} 주점`);
    return { ok: true };
  }

  if (card.cardId === "stagecoach") {
    drawCards(room, player, 2);
    pushLog(room, `${player.name} 카드 2장`);
    return { ok: true };
  }

  if (card.cardId === "wells_fargo") {
    drawCards(room, player, 3);
    pushLog(room, `${player.name} 카드 3장`);
    return { ok: true };
  }

  if (card.cardId === "general_store") {
    activePlayers(room).forEach((targetPlayer) => drawCards(room, targetPlayer, 1));
    pushLog(room, `${player.name} 잡화점`);
    return { ok: true };
  }

  if (card.cardId === "gatling") {
    aliveOpponents(room, player).forEach((targetPlayer) => resolveShot(room, player, targetPlayer, { amount: 1 }));
    pushLog(room, `${player.name} 기관총`);
    return { ok: true };
  }

  if (card.cardId === "indians") {
    aliveOpponents(room, player).forEach((targetPlayer) => {
      if (!discardBangForDuel(room, targetPlayer)) {
        takeDamage(room, targetPlayer, 1, player);
      }
    });
    pushLog(room, `${player.name} 인디언`);
    return { ok: true };
  }

  if (card.cardId === "duel") {
    if (!target) {
      return { ok: false, message: "대상을 선택하세요" };
    }
    resolveDuel(room, player, target);
    pushLog(room, `${player.name} 결투 -> ${target.name}`);
    return { ok: true };
  }

  if (card.cardId === "cat_balou") {
    if (!target) {
      return { ok: false, message: "대상을 선택하세요" };
    }
    const removed = removeRandomCardFromPlayer(room, target, true);
    pushLog(room, removed ? `${player.name} 캣 벌루 -> ${target.name}` : `${target.name} 카드 없음`);
    return { ok: true };
  }

  if (card.cardId === "panic") {
    if (!target) {
      return { ok: false, message: "대상을 선택하세요" };
    }
    if (distanceBetween(room, player.id, target.id) > 1) {
      return { ok: false, message: "거리 1 대상만 가능합니다" };
    }
    const stolen = removeRandomCardFromPlayer(room, target, false);
    if (stolen) {
      player.hand.push(stolen);
    }
    pushLog(room, stolen ? `${player.name} 강탈 -> ${target.name}` : `${target.name} 카드 없음`);
    return { ok: true };
  }

  return { ok: false, message: "카드를 사용할 수 없습니다" };
}

function cardIsInPlay(room, card) {
  return room.players.some((player) => Object.values(player.inPlay).includes(card));
}

function playCardById(room, player, cardId, targetId) {
  const card = removeFromHand(player, cardId);

  if (!card) {
    return { ok: false, message: "카드를 찾을 수 없습니다" };
  }

  const result = playCardEffect(room, player, card, targetId);

  if (!result.ok) {
    player.hand.push(card);
    return result;
  }

  if (!cardIsInPlay(room, card)) {
    discardCard(room, card);
  }

  ensureHandRefill(room, player);
  checkWin(room);
  return result;
}

function startCurrentTurn(room) {
  clearPendingChoice(room, { restoreCards: true });

  if (room.phase === "result") {
    return;
  }

  const player = getPlayer(room, room.currentPlayerId);

  if (!player?.alive) {
    nextTurn(room);
    return;
  }

  player.bangUsedThisTurn = 0;

  if (player.inPlay.dynamite) {
    const judged = judge(room, player, isDynamiteHit, { preferMatch: false });
    const hit = Boolean(judged && isDynamiteHit(judged));
    if (hit) {
      discardInPlay(room, player, "dynamite");
      pushLog(room, `${player.name} 다이너마이트 폭발`);
      takeDamage(room, player, 3, null);
      if (room.phase === "result" || !player.alive) {
        return;
      }
    } else {
      const dynamite = player.inPlay.dynamite;
      player.inPlay.dynamite = null;
      const active = activePlayers(room);
      const startIndex = active.findIndex((candidate) => candidate.id === player.id);
      const next = active[(startIndex + 1) % active.length];
      if (next && !next.inPlay.dynamite) {
        next.inPlay.dynamite = dynamite;
        pushLog(room, `${player.name} 다이너마이트 통과`);
      } else {
        discardCard(room, dynamite);
      }
    }
  }

  if (player.inPlay.jail) {
    const judged = judge(room, player, isHeart);
    discardInPlay(room, player, "jail");
    if (!judged || !isHeart(judged)) {
      pushLog(room, `${player.name} 감옥`);
      nextTurn(room);
      return;
    }
    pushLog(room, `${player.name} 감옥 탈출`);
  }

  room.phase = "draw";
}

function nextTurn(room) {
  clearPendingChoice(room, { restoreCards: true });

  if (checkWin(room)) {
    return;
  }

  const active = activePlayers(room);
  if (!active.length) {
    finishGame(room, null, "게임 종료");
    return;
  }

  const currentIndex = room.players.findIndex((player) => player.id === room.currentPlayerId);
  let nextIndex = currentIndex;

  do {
    nextIndex = (nextIndex + 1 + room.players.length) % room.players.length;
  } while (!room.players[nextIndex].alive);

  room.currentPlayerId = room.players[nextIndex].id;
  pushLog(room, `${room.players[nextIndex].name} 차례`);
  startCurrentTurn(room);
}

function takeJesseJonesDraw(room, player) {
  const targetIds = aliveOpponents(room, player)
    .filter((target) => target.hand.length)
    .map((target) => target.id);

  if (!targetIds.length) {
    drawCards(room, player, 2);
    finishDrawPhase(room, player);
    return;
  }

  room.pendingChoice = {
    playerId: player.id,
    abilityId: "jesse_jones",
    targetIds
  };
}

function takeKitCarlsonDraw(room, player) {
  const peeked = [drawOne(room), drawOne(room), drawOne(room)].filter(Boolean);

  if (peeked.length <= 2) {
    player.hand.push(...peeked);
    pushLog(room, `${player.name} 키트 칼슨`);
    finishDrawPhase(room, player);
    return;
  }

  room.pendingChoice = {
    playerId: player.id,
    abilityId: "kit_carlson",
    peeked,
    selectCount: 2
  };
}

function takePedroRamirezDraw(room, player) {
  if (!room.discard.length) {
    drawCards(room, player, 2);
    finishDrawPhase(room, player);
    return;
  }

  room.pendingChoice = {
    playerId: player.id,
    abilityId: "pedro_ramirez",
    discardTop: room.discard[room.discard.length - 1]
  };
}

function resolveJesseJonesChoice(room, player, source, targetId) {
  if (source === "player") {
    const target = aliveOpponents(room, player).find(
      (candidate) => candidate.id === targetId && candidate.hand.length
    );
    if (!target) {
      return { ok: false, message: "대상을 다시 선택하세요" };
    }

    const stolen = randomHandCard(target);
    if (stolen) {
      player.hand.push(removeFromHand(target, stolen.id));
    }
    pushLog(room, `${player.name} 제시 존스 -> ${target.name}`);
  } else {
    drawCards(room, player, 1);
    pushLog(room, `${player.name} 제시 존스 -> 덱`);
  }

  drawCards(room, player, 1);
  finishDrawPhase(room, player);
  return { ok: true };
}

function resolvePedroRamirezChoice(room, player, source) {
  if (source === "discard") {
    const discarded = drawFromDiscard(room);
    if (!discarded) {
      return { ok: false, message: "버린 카드 더미가 비었습니다" };
    }
    player.hand.push(discarded);
    pushLog(room, `${player.name} 페드로 라미레즈 -> 버린 더미`);
  } else {
    drawCards(room, player, 1);
    pushLog(room, `${player.name} 페드로 라미레즈 -> 덱`);
  }

  drawCards(room, player, 1);
  finishDrawPhase(room, player);
  return { ok: true };
}

function resolveKitCarlsonChoice(room, player, keepCardIds) {
  const pending = room.pendingChoice;
  const ids = Array.isArray(keepCardIds) ? [...new Set(keepCardIds)] : [];

  if (!pending || pending.abilityId !== "kit_carlson") {
    return { ok: false, message: "선택 중이 아닙니다" };
  }

  if (ids.length !== pending.selectCount) {
    return { ok: false, message: "카드 2장을 선택하세요" };
  }

  const kept = pending.peeked.filter((card) => ids.includes(card.id));
  if (kept.length !== pending.selectCount) {
    return { ok: false, message: "카드 2장을 선택하세요" };
  }

  const returned = pending.peeked.find((card) => !ids.includes(card.id));
  player.hand.push(...kept);
  if (returned) {
    room.deck.push(returned);
  }

  pushLog(room, `${player.name} 키트 칼슨`);
  finishDrawPhase(room, player);
  return { ok: true };
}

function resolveDrawChoice(room, player, payload = {}) {
  const pending = room.pendingChoice;

  if (!pending || pending.playerId !== player.id) {
    return { ok: false, message: "선택 중이 아닙니다" };
  }

  if (pending.abilityId === "jesse_jones") {
    return resolveJesseJonesChoice(room, player, payload.source, payload.targetId);
  }

  if (pending.abilityId === "pedro_ramirez") {
    return resolvePedroRamirezChoice(room, player, payload.source);
  }

  if (pending.abilityId === "kit_carlson") {
    return resolveKitCarlsonChoice(room, player, payload.keepCardIds);
  }

  return { ok: false, message: "선택을 처리할 수 없습니다" };
}

function takeDrawPhase(room, player) {
  if (player.character?.id === "black_jack") {
    const first = drawOne(room);
    const second = drawOne(room);
    if (first) {
      player.hand.push(first);
    }
    if (second) {
      player.hand.push(second);
      if (isRed(second)) {
        drawCards(room, player, 1);
      }
    }
  } else if (player.character?.id === "jesse_jones") {
    takeJesseJonesDraw(room, player);
  } else if (player.character?.id === "kit_carlson") {
    takeKitCarlsonDraw(room, player);
  } else if (player.character?.id === "pedro_ramirez") {
    takePedroRamirezDraw(room, player);
  } else {
    drawCards(room, player, 2);
    finishDrawPhase(room, player);
    return;
  }

  if (room.phase !== "draw") {
    return;
  }

  if (!room.pendingChoice) {
    finishDrawPhase(room, player);
  }
}

function useSidKetchum(room, player, cardIds) {
  const ids = Array.isArray(cardIds) ? cardIds.slice(0, 2) : [];

  if (!player.alive || room.phase === "lobby" || room.phase === "result" || player.character?.id !== "sid_ketchum") {
    return { ok: false, message: "사용할 수 없습니다" };
  }

  if (ids.length !== 2 || player.hp >= player.maxHp) {
    return { ok: false, message: "카드 2장을 선택하세요" };
  }

  const removed = ids.map((id) => removeFromHand(player, id)).filter(Boolean);
  if (removed.length !== 2) {
    player.hand.push(...removed);
    return { ok: false, message: "카드 2장을 선택하세요" };
  }

  removed.forEach((card) => discardCard(room, card));
  heal(player, 1);
  pushLog(room, `${player.name} 시드 케첨`);
  return { ok: true };
}

function discardDownToHp(room, player) {
  while (player.hand.length > player.hp && player.hand.length) {
    discardCard(room, player.hand.pop());
  }
}

function serializeCard(card) {
  return {
    id: card.id,
    cardId: card.cardId,
    name: card.name,
    type: card.type,
    description: card.description || CARD_DESCRIPTIONS[card.cardId] || "",
    suit: card.suit,
    rank: card.rank,
    weaponRange: card.weaponRange || null
  };
}

function serializeInPlay(player) {
  return Object.fromEntries(
    Object.entries(player.inPlay).map(([slot, card]) => [slot, card ? serializeCard(card) : null])
  );
}

function serializePlayer(room, viewerId, player) {
  const isMe = viewerId === player.id;
  const roleVisible = isMe || player.roleRevealed;

  return {
    id: player.id,
    name: player.name,
    isBot: player.isBot,
    isHost: room.hostId === player.id,
    alive: player.alive,
    hp: player.hp,
    maxHp: player.maxHp,
    role: roleVisible ? player.role : null,
    roleName: roleVisible ? roleText(player) : "비공개",
    roleRevealed: player.roleRevealed,
    character: player.character,
    hand: isMe ? player.hand.map(serializeCard) : [],
    handCount: player.hand.length,
    inPlay: serializeInPlay(player),
    weaponRange: weaponRange(player),
    connected: isPlayerConnected(player),
    disconnectDeadlineAt: player.disconnectDeadlineAt || null
  };
}

function serializePendingChoice(room, viewerId) {
  const pending = room.pendingChoice;

  if (!pending || pending.playerId !== viewerId) {
    return null;
  }

  const serialized = {
    abilityId: pending.abilityId
  };

  if (Array.isArray(pending.targetIds)) {
    serialized.targets = pending.targetIds
      .map((targetId) => getPlayer(room, targetId))
      .filter(Boolean)
      .map((target) => ({
        id: target.id,
        name: target.name,
        handCount: target.hand.length
      }));
  }

  if (pending.discardTop) {
    serialized.discardTop = serializeCard(pending.discardTop);
  }

  if (Array.isArray(pending.peeked)) {
    serialized.peeked = pending.peeked.map(serializeCard);
  }

  if (pending.selectCount) {
    serialized.selectCount = pending.selectCount;
  }

  return serialized;
}

function serializeRoom(room, socketId) {
  const player = getPlayer(room, socketId);

  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    targetPlayerCount: room.targetPlayerCount,
    currentPlayerId: room.currentPlayerId,
    limits: {
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS
    },
    deckCount: room.deck.length,
    discardCount: room.discard.length,
    players: room.players.map((roomPlayer) => serializePlayer(room, socketId, roomPlayer)),
    me: player ? { id: player.id, name: player.name } : null,
    result: room.result,
    log: room.log,
    pendingChoice: serializePendingChoice(room, socketId)
  };
}

function broadcastRoom(room) {
  persistRoomState(room);

  room.players.forEach((player) => {
    if (!player.isBot) {
      io.to(player.id).emit("room:update", serializeRoom(room, player.id));
    }
  });

  scheduleBot(room);
}

function removePlayer(playerId) {
  cancelDisconnect(disconnectTimers, playerId);

  for (const room of rooms.values()) {
    const index = room.players.findIndex((player) => player.id === playerId);

    if (index === -1) {
      continue;
    }

    const wasCurrent = room.currentPlayerId === playerId;
    const [removed] = room.players.splice(index, 1);

    if (!humanPlayers(room).length) {
      clearBotTimer(room);
      rooms.delete(room.code);
      deletePersistedRoom(room.code);
      return;
    }

    if (room.hostId === playerId) {
      room.hostId = humanPlayers(room)[0].id;
    }

    if (room.phase !== "lobby" && room.phase !== "result") {
      removed.alive = false;
      pushLog(room, `${removed.name} 나감`);
      if (wasCurrent) {
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
    broadcastRoom(room);
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

function playBotCard(room, bot) {
  if (bot.hp < bot.maxHp) {
    const beer = randomHandCard(bot, (card) => card.cardId === "beer");
    if (beer) {
      return playCardById(room, bot, beer.id, null).ok;
    }
  }

  if (
    bot.character?.id === "sid_ketchum" &&
    bot.hp < bot.maxHp &&
    bot.hand.length >= 2 &&
    (bot.hp === 1 || bot.hand.length >= 4)
  ) {
    const discardIds = bot.hand.slice(0, 2).map((card) => card.id);
    return useSidKetchum(room, bot, discardIds).ok;
  }

  const equipment = bot.hand.find((card) =>
    ["barrel", "mustang", "scope", "dynamite", "volcanic", "schofield", "remington", "rev_carabine", "winchester"].includes(
      card.cardId
    )
  );
  if (equipment) {
    return playCardById(room, bot, equipment.id, null).ok;
  }

  const targets = botTargets(room, bot);
  const inRange = targets.find((target) => distanceBetween(room, bot.id, target.id) <= weaponRange(bot));
  const bang = bangCardsFor(bot)[0];
  if (bang && inRange) {
    return playCardById(room, bot, bang.id, inRange.id).ok;
  }

  const targetAny = targets[0];
  const duel = bot.hand.find((card) => card.cardId === "duel");
  if (duel && targetAny) {
    return playCardById(room, bot, duel.id, targetAny.id).ok;
  }

  const cat = bot.hand.find((card) => card.cardId === "cat_balou");
  if (cat && targetAny) {
    return playCardById(room, bot, cat.id, targetAny.id).ok;
  }

  const panic = bot.hand.find((card) => card.cardId === "panic");
  const closeTarget = targets.find((target) => distanceBetween(room, bot.id, target.id) <= 1);
  if (panic && closeTarget) {
    return playCardById(room, bot, panic.id, closeTarget.id).ok;
  }

  const drawCard = bot.hand.find((card) => ["stagecoach", "wells_fargo", "general_store"].includes(card.cardId));
  if (drawCard) {
    return playCardById(room, bot, drawCard.id, null).ok;
  }

  const area = bot.hand.find((card) => ["gatling", "indians", "saloon"].includes(card.cardId));
  if (area) {
    return playCardById(room, bot, area.id, null).ok;
  }

  const jail = bot.hand.find((card) => card.cardId === "jail");
  const jailTarget = targets.find((target) => target.role !== "sheriff" && !target.inPlay.jail);
  if (jail && jailTarget) {
    return playCardById(room, bot, jail.id, jailTarget.id).ok;
  }

  return false;
}

function runBotTurn(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.phase === "result") {
    return;
  }

  room.botTimer = null;
  const bot = getPlayer(room, room.currentPlayerId);

  if (!bot?.isBot || !bot.alive) {
    return;
  }

  if (room.pendingChoice?.playerId === bot.id) {
    let result = { ok: false };

    if (room.pendingChoice.abilityId === "jesse_jones") {
      const targets = aliveOpponents(room, bot)
        .filter((target) => target.hand.length)
        .sort((left, right) => right.hand.length - left.hand.length);
      const target = targets[0];
      result = resolveDrawChoice(room, bot, target ? { source: "player", targetId: target.id } : { source: "deck" });
    } else if (room.pendingChoice.abilityId === "pedro_ramirez") {
      result = resolveDrawChoice(room, bot, { source: room.discard.length ? "discard" : "deck" });
    } else if (room.pendingChoice.abilityId === "kit_carlson") {
      const keepCardIds = room.pendingChoice.peeked.slice(0, 2).map((card) => card.id);
      result = resolveDrawChoice(room, bot, { keepCardIds });
    }

    if (result.ok) {
      broadcastRoom(room);
    }
    return;
  }

  if (room.phase === "draw") {
    takeDrawPhase(room, bot);
    broadcastRoom(room);
    return;
  }

  if (room.phase === "play") {
    let played = 0;
    while (room.phase === "play" && played < MAX_BOT_PLAYS && playBotCard(room, bot)) {
      played += 1;
      if (room.phase === "result") {
        broadcastRoom(room);
        return;
      }
    }

    discardDownToHp(room, bot);
    nextTurn(room);
    broadcastRoom(room);
  }
}

function scheduleBot(room) {
  clearBotTimer(room);
  const player = getPlayer(room, room.currentPlayerId);

  if (room.phase !== "draw" && room.phase !== "play") {
    return;
  }

  if (!player?.isBot || !player.alive) {
    return;
  }

  room.botTimer = setTimeout(() => runBotTurn(room.code), BOT_DELAY_MS);
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name, targetPlayerCount }, callback = () => {}) => {
    const cleanName = sanitizeName(name);
    const cleanTargetCount = sanitizeTargetPlayerCount(targetPlayerCount);
    const playerId = getSocketPlayerId(socket);

    if (!cleanName) {
      callback({ ok: false, message: "이름을 입력하세요" });
      return;
    }

    removePlayer(playerId);
    leaveJoinedRooms(socket);

    const room = createRoom(generateRoomCode(), playerId, socket.id, cleanName, {
      targetPlayerCount: cleanTargetCount
    });
    attachSocketToPlayer(room, socket, room.players[0]);
    broadcastRoom(room);
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
      broadcastRoom(room);
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

    room.players.push(createPlayer(playerId, cleanName, { socketId: socket.id }));
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

    const totalToAdd = Math.min(addCount, remaining);
    for (let index = 0; index < totalToAdd; index += 1) {
      addBotToRoom(room);
    }

    broadcastRoom(room);
    callback({ ok: true, added: totalToAdd });
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

    if (!canStart(room)) {
      callback({ ok: false, message: `목표 인원 ${room.targetPlayerCount}명이 모두 들어와야 합니다` });
      return;
    }

    startGame(room);
    broadcastRoom(room);
    callback({ ok: true });
  });

  socket.on("turn:draw", ({ code }, callback = () => {}) => {
    const room = getRoom(code);
    const playerId = getSocketPlayerId(socket);
    const player = room ? getPlayer(room, playerId) : null;

    if (!room || !player) {
      callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
      return;
    }

    if (room.phase !== "draw" || room.currentPlayerId !== playerId) {
      callback({ ok: false, message: "지금 뽑을 수 없습니다" });
      return;
    }

    if (room.pendingChoice?.playerId === playerId) {
      callback({ ok: false, message: "먼저 능력을 선택하세요" });
      return;
    }

    takeDrawPhase(room, player);
    broadcastRoom(room);
    callback({ ok: true });
  });

  socket.on("ability:resolve", ({ code, ...payload }, callback = () => {}) => {
    const room = getRoom(code);
    const playerId = getSocketPlayerId(socket);
    const player = room ? getPlayer(room, playerId) : null;

    if (!room || !player) {
      callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
      return;
    }

    if (room.currentPlayerId !== playerId || room.phase !== "draw") {
      callback({ ok: false, message: "지금 선택할 수 없습니다" });
      return;
    }

    const result = resolveDrawChoice(room, player, payload);
    if (!result.ok) {
      callback(result);
      return;
    }

    broadcastRoom(room);
    callback({ ok: true });
  });

  socket.on("card:play", ({ code, cardId, targetId }, callback = () => {}) => {
    const room = getRoom(code);
    const playerId = getSocketPlayerId(socket);
    const player = room ? getPlayer(room, playerId) : null;

    if (!room || !player) {
      callback({ ok: false, message: "방 정보를 확인할 수 없습니다" });
      return;
    }

    if (room.phase !== "play" || room.currentPlayerId !== playerId || !player.alive) {
      callback({ ok: false, message: "지금 사용할 수 없습니다" });
      return;
    }

    const result = playCardById(room, player, cardId, targetId);

    if (!result.ok) {
      callback(result);
      return;
    }

    broadcastRoom(room);
    callback({ ok: true });
  });

  socket.on("ability:sid", ({ code, cardIds }, callback = () => {}) => {
    const room = getRoom(code);
    const playerId = getSocketPlayerId(socket);
    const player = room ? getPlayer(room, playerId) : null;

    if (!room || !player) {
      callback({ ok: false, message: "사용할 수 없습니다" });
      return;
    }

    const result = useSidKetchum(room, player, cardIds);
    if (!result.ok) {
      callback(result);
      return;
    }

    broadcastRoom(room);
    callback({ ok: true });
  });

  socket.on("turn:end", ({ code }, callback = () => {}) => {
    const room = getRoom(code);
    const playerId = getSocketPlayerId(socket);
    const player = room ? getPlayer(room, playerId) : null;

    if (!room || !player) {
      callback({ ok: false, message: "방을 찾을 수 없습니다" });
      return;
    }

    if (room.phase !== "play" || room.currentPlayerId !== playerId) {
      callback({ ok: false, message: "지금 끝낼 수 없습니다" });
      return;
    }

    discardDownToHp(room, player);
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
    console.log(`[bang] restored ${snapshots.length} room(s) from Redis`);
  }
}

return restorePersistedRooms();

};
