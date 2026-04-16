const appSession = window.GamebniSession.createClient("bang");
const socket = io("/bang", {
  auth: {
    playerSessionId: appSession.playerSessionId
  }
});

const state = {
  room: null,
  previousRoom: null,
  roomCode: "",
  selectedCardId: null,
  selectedTargetId: null,
  inspectedCard: null,
  focusPlayerId: null,
  detailHidden: true,
  flash: "",
  seatElements: new Map(),
  bannerTimer: null,
  introSeenKey: "",
  abilityMode: null,
  abilitySelectedCardIds: [],
  restoreAttempted: false
};

const elements = {
  entryScreen: document.getElementById("entryScreen"),
  gameScreen: document.getElementById("gameScreen"),
  nameInput: document.getElementById("nameInput"),
  targetPlayerCountSelect: document.getElementById("targetPlayerCountSelect"),
  roleGuide: document.getElementById("roleGuide"),
  roomInput: document.getElementById("roomInput"),
  entryStatus: document.getElementById("entryStatus"),
  roomBadge: document.getElementById("roomBadge"),
  targetBadge: document.getElementById("targetBadge"),
  phaseBadge: document.getElementById("phaseBadge"),
  turnBadge: document.getElementById("turnBadge"),
  botTools: document.getElementById("botTools"),
  botCountInput: document.getElementById("botCountInput"),
  addBotButton: document.getElementById("addBotButton"),
  startButton: document.getElementById("startButton"),
  resetButton: document.getElementById("resetButton"),
  gameLayout: document.getElementById("gameLayout"),
  tablePanel: document.querySelector(".table-panel"),
  tableStage: document.getElementById("tableStage"),
  playerBoard: document.getElementById("playerBoard"),
  centerStatus: document.getElementById("centerStatus"),
  selectedLine: document.getElementById("selectedLine"),
  deckStack: document.getElementById("deckStack"),
  discardStack: document.getElementById("discardStack"),
  deckCount: document.getElementById("deckCount"),
  discardCount: document.getElementById("discardCount"),
  animationLayer: document.getElementById("animationLayer"),
  cinematicBanner: document.getElementById("cinematicBanner"),
  drawControls: document.getElementById("drawControls"),
  drawButton: document.getElementById("drawButton"),
  playControls: document.getElementById("playControls"),
  playButton: document.getElementById("playButton"),
  endTurnButton: document.getElementById("endTurnButton"),
  abilityControls: document.getElementById("abilityControls"),
  abilityButton: document.getElementById("abilityButton"),
  detailPanel: document.getElementById("detailPanel"),
  detailBackdrop: document.getElementById("detailBackdrop"),
  detailCloseButton: document.getElementById("detailCloseButton"),
  detailName: document.getElementById("detailName"),
  detailRole: document.getElementById("detailRole"),
  detailStats: document.getElementById("detailStats"),
  detailCharacter: document.getElementById("detailCharacter"),
  detailAbility: document.getElementById("detailAbility"),
  detailEquipment: document.getElementById("detailEquipment"),
  handCount: document.getElementById("handCount"),
  handList: document.getElementById("handList"),
  logList: document.getElementById("logList"),
  introModal: document.getElementById("introModal"),
  introTitle: document.getElementById("introTitle"),
  introBody: document.getElementById("introBody"),
  introChoices: document.getElementById("introChoices"),
  introCloseButton: document.getElementById("introCloseButton"),
  abilityModal: document.getElementById("abilityModal"),
  abilityBackdrop: document.getElementById("abilityBackdrop"),
  abilityCloseButton: document.getElementById("abilityCloseButton"),
  abilityTitle: document.getElementById("abilityTitle"),
  abilityBody: document.getElementById("abilityBody"),
  abilityOptions: document.getElementById("abilityOptions"),
  abilityActions: document.getElementById("abilityActions"),
  abilityConfirmButton: document.getElementById("abilityConfirmButton"),
  cardZoomModal: document.getElementById("cardZoomModal"),
  cardZoomBackdrop: document.getElementById("cardZoomBackdrop"),
  cardZoomCloseButton: document.getElementById("cardZoomCloseButton"),
  cardZoomTitle: document.getElementById("cardZoomTitle"),
  cardZoomView: document.getElementById("cardZoomView"),
  cardZoomMeta: document.getElementById("cardZoomMeta"),
  cardZoomDescription: document.getElementById("cardZoomDescription"),
  createRoomButton: document.getElementById("createRoomButton"),
  joinRoomButton: document.getElementById("joinRoomButton")
};

appSession.hydrateEntry({
  nameInput: elements.nameInput,
  roomInput: elements.roomInput
});

function currentName() {
  return elements.nameInput.value.trim();
}

function currentRoomInput() {
  return elements.roomInput.value.trim().toUpperCase();
}

function rememberSessionRoom(roomCode = state.roomCode, name = currentName()) {
  appSession.rememberRoom(state.room?.me?.name || name, roomCode);
}

const TABLE_STAGE_ASPECT_RATIO = 16 / 10;

const CARD_FACE_IMAGE_URLS = {
  bang: "/bang/assets/cards/faces/bang.png",
  missed: "/bang/assets/cards/faces/missed.png",
  beer: "/bang/assets/cards/faces/beer.png",
  panic: "/bang/assets/cards/faces/panic.png",
  duel: "/bang/assets/cards/faces/duel.png",
  stagecoach: "/bang/assets/cards/faces/stagecoach.png",
  wells_fargo: "/bang/assets/cards/faces/wells_fargo.png",
  gatling: "/bang/assets/cards/faces/gatling.png",
  dynamite: "/bang/assets/cards/faces/dynamite.png",
  jail: "/bang/assets/cards/faces/jail.png",
  remington: "/bang/assets/cards/faces/remington.png",
  rev_carabine: "/bang/assets/cards/faces/rev_carabine.png",
  volcanic: "/bang/assets/cards/faces/volcanic.png",
  barrel: "/bang/assets/cards/faces/barrel.png",
  schofield: "/bang/assets/cards/faces/schofield.png",
  mustang: "/bang/assets/cards/faces/mustang.png",
  winchester: "/bang/assets/cards/faces/winchester.png",
  indians: "/bang/assets/cards/faces/indians.png",
  general_store: "/bang/assets/cards/faces/general_store.png",
  scope: "/bang/assets/cards/faces/scope.png",
  saloon: "/bang/assets/cards/faces/saloon.png",
  cat_balou: "/bang/assets/cards/faces/cat_balou.png"
};

const SUIT_SYMBOLS = {
  spades: "\u2660",
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663"
};

const ACTION_CARD_META = {
  bang: { name: "뱅!", type: "brown", tone: "attack", description: "사거리 안의 대상에게 피해 1" },
  missed: { name: "빗나감!", type: "brown", tone: "defense", description: "뱅! 공격을 회피" },
  beer: { name: "맥주", type: "brown", tone: "utility", description: "체력 1 회복" },
  saloon: { name: "주점", type: "brown", tone: "utility", description: "모든 생존 플레이어 체력 1 회복" },
  stagecoach: { name: "역마차", type: "brown", tone: "utility", description: "카드 2장 뽑기" },
  wells_fargo: { name: "웰스 파고", type: "brown", tone: "utility", description: "카드 3장 뽑기" },
  general_store: { name: "잡화점", type: "brown", tone: "utility", description: "모든 생존 플레이어가 카드 1장 획득" },
  indians: { name: "인디언!", type: "brown", tone: "warning", description: "뱅!을 버리거나 피해 1" },
  duel: { name: "결투", type: "brown", tone: "attack", description: "번갈아 뱅!을 내며 승부" },
  gatling: { name: "기관총", type: "brown", tone: "attack", description: "모든 다른 플레이어에게 뱅!" },
  panic: { name: "강탈", type: "brown", tone: "utility", description: "거리 1 대상 카드 1장 가져오기" },
  cat_balou: { name: "캣 벌루", type: "brown", tone: "utility", description: "대상 카드 1장 버리기" },
  jail: { name: "감옥", type: "blue", tone: "warning", description: "대상 다음 턴을 묶습니다" },
  dynamite: { name: "다이너마이트", type: "blue", tone: "warning", description: "폭발 시 피해 3" },
  barrel: { name: "술통", type: "blue", tone: "defense", description: "판정 성공 시 뱅! 회피" }
};

const PHASE_TEXT = {
  lobby: "대기",
  draw: "드로우",
  play: "플레이",
  result: "결과"
};

const ROLE_GUIDE = {
  3: ["부관 1", "무법자 1", "배신자 1"],
  4: ["보안관 1", "무법자 2", "배신자 1"],
  5: ["보안관 1", "부관 1", "무법자 2", "배신자 1"],
  6: ["보안관 1", "부관 1", "무법자 3", "배신자 1"],
  7: ["보안관 1", "부관 2", "무법자 3", "배신자 1"]
};

const ABILITY_COPY = {
  jesse_jones: {
    title: "제시 존스",
    body: "첫 번째 카드를 덱에서 뽑거나 다른 플레이어 손에서 무작위로 가져오세요."
  },
  pedro_ramirez: {
    title: "페드로 라미레즈",
    body: "첫 번째 카드를 덱 또는 버린 카드 더미 맨 위에서 가져오세요."
  },
  kit_carlson: {
    title: "키트 칼슨",
    body: "덱 위 3장 중 손에 넣을 카드 2장을 선택하세요."
  },
  sid_ketchum: {
    title: "시드 케첨",
    body: "손패 2장을 버리고 체력 1을 회복합니다."
  }
};

const SUIT_TEXT = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣"
};
const SEAT_LAYOUTS = {
  3: [
    { x: 50, y: 90 },
    { x: 14, y: 12 },
    { x: 86, y: 12 }
  ],
  4: [
    { x: 50, y: 90 },
    { x: 6, y: 50 },
    { x: 50, y: 8 },
    { x: 94, y: 50 }
  ],
  5: [
    { x: 50, y: 90 },
    { x: 8, y: 68 },
    { x: 18, y: 10 },
    { x: 82, y: 10 },
    { x: 92, y: 68 }
  ],
  6: [
    { x: 50, y: 90 },
    { x: 8, y: 72 },
    { x: 6, y: 26 },
    { x: 50, y: 8 },
    { x: 94, y: 26 },
    { x: 92, y: 72 }
  ],
  7: [
    { x: 50, y: 90 },
    { x: 8, y: 76 },
    { x: 4, y: 40 },
    { x: 22, y: 8 },
    { x: 78, y: 8 },
    { x: 96, y: 40 },
    { x: 92, y: 76 }
  ]
};

const IN_PLAY_SLOT_ORDER = ["weapon", "barrel", "mustang", "scope", "jail", "dynamite"];

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function me(room = state.room) {
  return room?.players.find((player) => player.id === room.me?.id) || null;
}

function currentPlayer(room = state.room) {
  return room?.players.find((player) => player.id === room.currentPlayerId) || null;
}

function selectedCard() {
  return me()?.hand.find((card) => card.id === state.selectedCardId) || null;
}

function inspectedCard() {
  return state.inspectedCard || null;
}

function openCardZoom(card) {
  state.inspectedCard = card ? { ...card } : null;
}

function closeCardZoom() {
  state.inspectedCard = null;
}

function pendingChoice(room = state.room) {
  return room?.pendingChoice || null;
}

function sidSelectionCards() {
  const self = me();
  if (!self) {
    return [];
  }
  return self.hand.filter((card) => state.abilitySelectedCardIds.includes(card.id));
}

function canUseSidAbility(room = state.room) {
  const self = me(room);

  return Boolean(
    room &&
      self?.alive &&
      self.character?.id === "sid_ketchum" &&
      self.hp < self.maxHp &&
      self.hand.length >= 2 &&
      !["lobby", "result"].includes(room.phase)
  );
}

function openSidAbility() {
  if (!canUseSidAbility()) {
    return;
  }

  state.abilityMode = "sid_ketchum";
  state.abilitySelectedCardIds = [];
}

function closeSidAbility() {
  state.abilityMode = null;
  state.abilitySelectedCardIds = [];
}

function toggleAbilityCardSelection(cardId, limit) {
  const ids = state.abilitySelectedCardIds.slice();
  const index = ids.indexOf(cardId);

  if (index >= 0) {
    ids.splice(index, 1);
  } else if (ids.length < limit) {
    ids.push(cardId);
  } else {
    ids.splice(0, ids.length - limit + 1);
    ids.push(cardId);
  }

  state.abilitySelectedCardIds = ids;
}

function activeAbilityModal() {
  const pending = pendingChoice();
  if (pending) {
    return { mode: "pending", abilityId: pending.abilityId, pending };
  }

  if (state.abilityMode === "sid_ketchum" && canUseSidAbility()) {
    return { mode: "local", abilityId: "sid_ketchum" };
  }

  return null;
}

function selectedTarget() {
  return state.room?.players.find((player) => player.id === state.selectedTargetId) || null;
}

function isMyTurn() {
  return state.room?.currentPlayerId === state.room?.me?.id;
}

function isTargetSelectionMode() {
  const card = selectedCard();
  return Boolean(card) && state.room?.phase === "play" && isMyTurn() && cardNeedsTarget(card);
}

function setEntryStatus(text) {
  elements.entryStatus.textContent = text || "";
}

function selectedTargetPlayerCount() {
  const count = Number.parseInt(elements.targetPlayerCountSelect?.value || "4", 10);
  return Number.isInteger(count) ? count : 4;
}

function roleGuideText(count) {
  return (ROLE_GUIDE[count] || []).join(" · ");
}

function renderRoleGuide() {
  if (!elements.roleGuide) {
    return;
  }
  elements.roleGuide.textContent = roleGuideText(selectedTargetPlayerCount());
}

function setFlash(text) {
  state.flash = text || "";
  renderStatus();
}

function phaseStatus() {
  if (state.flash) {
    return state.flash;
  }

  const room = state.room;
  const pending = pendingChoice();
  if (!room) {
    return "";
  }

  if (pending && isMyTurn()) {
    const copy = ABILITY_COPY[pending.abilityId];
    return copy?.body || "능력을 선택하세요";
  }

  if (room.phase === "lobby") {
    return `${room.players.length} / ${room.targetPlayerCount}명 입장`;
  }

  if (room.phase === "draw") {
    return isMyTurn() ? "카드를 뽑으세요" : `${currentPlayer()?.name || "-"} 드로우`;
  }

  if (room.phase === "play") {
    return isMyTurn() ? "카드를 선택하고 대상을 고르세요" : `${currentPlayer()?.name || "-"} 행동 중`;
  }

  if (room.phase === "result") {
    return room.result?.reason || "결과";
  }

  return "-";
}
function cardNeedsTarget(card) {
  return ["bang", "missed", "duel", "cat_balou", "panic", "jail"].includes(card?.cardId);
}

function cardClass(card) {
  return `card ${card.type === "blue" ? "blue-card" : "brown-card"} ${card.cardId}`;
}

function cardSuitSymbol(suit) {
  return SUIT_SYMBOLS[suit] || "";
}

function cardSuitColorClass(suit) {
  return suit === "hearts" || suit === "diamonds" ? "is-red" : "is-black";
}

function shouldRenderCardIndices(card) {
  return card?.showIndices !== false && Boolean(card?.rank) && Boolean(card?.suit);
}

function createCardCorner(card, position = "top") {
  const corner = document.createElement("div");
  corner.className = `card-corner ${position} ${cardSuitColorClass(card.suit)}`;

  const rank = document.createElement("span");
  rank.className = "card-corner-rank";
  rank.textContent = card.rank;

  const suit = document.createElement("span");
  suit.className = "card-corner-suit";
  suit.textContent = cardSuitSymbol(card.suit);

  corner.append(rank, suit);
  return corner;
}

function renderCardFace(card) {
  const article = document.createElement("article");
  article.className = cardClass(card);

  const faceImageUrl = CARD_FACE_IMAGE_URLS[card.cardId];
  if (faceImageUrl) {
    article.classList.add("has-face-image");

    const image = document.createElement("img");
    image.className = "card-face-image";
    image.src = faceImageUrl;
    image.alt = card.name;

    article.appendChild(image);
    if (shouldRenderCardIndices(card)) {
      article.append(createCardCorner(card, "top"), createCardCorner(card, "bottom"));
    }
    return article;
  }

  const top = document.createElement("div");
  top.className = "card-top";
  top.innerHTML = `<span>${card.rank}</span><span>${SUIT_TEXT[card.suit] || ""}</span>`;

  const name = document.createElement("strong");
  name.textContent = card.name;

  const art = document.createElement("div");
  art.className = "card-art";
  art.textContent = card.name.slice(0, 1);

  const description = document.createElement("p");
  description.className = "card-description";
  description.textContent = card.description || "";

  const type = document.createElement("span");
  type.className = "card-type";
  type.textContent = card.weaponRange ? `사거리 ${card.weaponRange}` : card.type === "blue" ? "장비 카드" : "행동 카드";

  article.append(top, art, name, description, type);
  return article;
}

function orderedPlayers(room) {
  if (!room?.players?.length) {
    return [];
  }

  const meIndex = room.players.findIndex((player) => player.id === room.me?.id);
  if (meIndex === -1) {
    return room.players.slice();
  }

  return room.players.map((_, index) => room.players[(meIndex + index) % room.players.length]);
}

function stageMetrics() {
  const rect = elements.tableStage?.getBoundingClientRect();

  return {
    width: Math.max(360, rect?.width || 1100),
    height: Math.max(520, rect?.height || 760)
  };
}

function fitTableStage() {
  const panel = elements.tablePanel;
  const stage = elements.tableStage;

  if (!panel || !stage) {
    return;
  }

  const rect = panel.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }

  const styles = window.getComputedStyle(panel);
  const paddingX = parseFloat(styles.paddingLeft || "0") + parseFloat(styles.paddingRight || "0");
  const paddingY = parseFloat(styles.paddingTop || "0") + parseFloat(styles.paddingBottom || "0");
  const availableWidth = Math.max(320, rect.width - paddingX);
  const availableHeight = Math.max(260, rect.height - paddingY);
  const width = Math.min(1460, availableWidth, availableHeight * TABLE_STAGE_ASPECT_RATIO);
  const height = width / TABLE_STAGE_ASPECT_RATIO;

  stage.style.width = `${Math.round(width)}px`;
  stage.style.height = `${Math.round(height)}px`;
}

function seatConfig(total) {
  const { width, height } = stageMetrics();
  const seatWidth =
    total >= 7 ? Math.min(136, width * 0.128, height * 0.215) :
    total === 6 ? Math.min(144, width * 0.133, height * 0.222) :
    total === 5 ? Math.min(154, width * 0.143, height * 0.232) :
    total === 4 ? Math.min(166, width * 0.153, height * 0.242) :
    Math.min(178, width * 0.163, height * 0.252);
  const seatHeight = Math.round(seatWidth * (total >= 6 ? 1.08 : 1.04));
  const selfWidth = Math.round(Math.min(seatWidth + 18, seatWidth * 1.12));
  const selfHeight = Math.round(Math.max(seatHeight + 28, selfWidth * 1.16));
  const scale =
    total >= 7 ? 0.96 :
    total === 6 ? 0.97 :
    total === 5 ? 0.985 :
    1;

  return {
    width,
    height,
    seatWidth,
    seatHeight,
    selfWidth,
    selfHeight,
    scale
  };
}

function seatPlacement(index, total) {
  const config = seatConfig(total);
  const preset = SEAT_LAYOUTS[total]?.[index];
  const xPercent = preset?.x ?? 50;
  const yPercent = preset?.y ?? 50;
  const seatWidth = index === 0 ? config.selfWidth : config.seatWidth;
  const seatHeight = index === 0 ? config.selfHeight : config.seatHeight;
  const marginX = seatWidth / 2 + 10;
  const marginY = seatHeight / 2 + 10;
  const reservedBottom = Math.round(Math.max(92, Math.min(124, config.height * 0.16)));
  const usableWidth = Math.max(0, config.width - marginX * 2);
  const usableHeight = Math.max(0, config.height - marginY * 2 - reservedBottom);
  const selfDrop = index === 0 ? Math.round(Math.max(10, Math.min(18, config.height * 0.018))) : 0;
  const yBase = marginY + (usableHeight * yPercent) / 100;

  return {
    x: marginX + (usableWidth * xPercent) / 100,
    y: Math.min(config.height - marginY, yBase + selfDrop),
    scale: index === 0 ? 1 : config.scale,
    width: seatWidth,
    height: seatHeight
  };
}

function createHpMeter(player) {
  const meter = document.createElement("div");
  meter.className = "hp-meter";

  for (let index = 0; index < player.maxHp; index += 1) {
    const pip = document.createElement("span");
    pip.className = `hp-pip${index < player.hp ? " is-filled" : ""}`;
    meter.appendChild(pip);
  }

  return meter;
}

function equipmentCards(player) {
  return IN_PLAY_SLOT_ORDER.map((slot) => player.inPlay?.[slot]).filter(Boolean);
}

function createEquipmentPreview(card) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "equipment-preview";
  button.title = card.name;
  button.setAttribute("aria-label", `${card.name} 크게 보기`);

  const art = document.createElement("div");
  art.className = "equipment-preview-art";

  const imageUrl = CARD_FACE_IMAGE_URLS[card.cardId];
  if (imageUrl) {
    art.classList.add("has-image");
    art.style.setProperty("--equipment-image", `url("${imageUrl}")`);
  } else {
    art.textContent = card.name.slice(0, 2);
  }

  if (shouldRenderCardIndices(card)) {
    art.append(createCardCorner(card, "top"), createCardCorner(card, "bottom"));
  }

  if (card.weaponRange) {
    const range = document.createElement("span");
    range.className = "equipment-preview-range";
    range.textContent = String(card.weaponRange);
    art.appendChild(range);
  }

  const name = document.createElement("span");
  name.className = "equipment-preview-name";
  name.textContent = card.name;

  button.append(art, name);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openCardZoom(card);
    renderRoom();
  });

  return button;
}

function createEquipmentRow(player) {
  const row = document.createElement("div");
  row.className = "equipment-row";

  const cards = equipmentCards(player);
  if (!cards.length) {
    row.dataset.empty = "true";
    return row;
  }

  cards.forEach((card) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "equipment-item";
    item.title = card.name;
    item.setAttribute("aria-label", `${card.name} 크게 보기`);

    const imageUrl = CARD_FACE_IMAGE_URLS[card.cardId];
    if (imageUrl) {
      item.classList.add("has-image");
      item.style.setProperty("--equipment-image", `url("${imageUrl}")`);
    } else {
      item.textContent = card.name.slice(0, 2);
    }

    if (card.weaponRange) {
      const range = document.createElement("span");
      range.className = "equipment-range";
      range.textContent = String(card.weaponRange);
      item.appendChild(range);
    }

    item.addEventListener("click", (event) => {
      event.stopPropagation();
      openCardZoom(card);
      renderRoom();
    });

    row.appendChild(item);
  });

  return row;
}
function renderBoard() {
  const room = state.room;
  const players = orderedPlayers(room);
  const targetMode = isTargetSelectionMode();

  elements.playerBoard.innerHTML = "";
  state.seatElements = new Map();
  elements.tableStage.dataset.count = String(players.length);

  players.forEach((player, index) => {
    const placement = seatPlacement(index, players.length);
    const seat = document.createElement("section");
    seat.className = "player-seat";
    seat.dataset.playerId = player.id;
    seat.style.left = `${placement.x}px`;
    seat.style.top = `${placement.y}px`;
    seat.style.width = `${placement.width}px`;
    seat.style.height = `${placement.height}px`;
    seat.style.zIndex = String(Math.round(placement.y));
    seat.style.setProperty("--seat-scale", String(placement.scale));

    if (player.id === room.me.id) {
      seat.classList.add("is-self");
    }
    if (player.id === room.currentPlayerId) {
      seat.classList.add("is-current");
    }
    if (!player.alive) {
      seat.classList.add("is-dead");
    }
    if (player.id === state.selectedTargetId) {
      seat.classList.add("is-selected");
    }
    if (player.id === state.focusPlayerId) {
      seat.classList.add("is-focused");
    }

    const targetable = targetMode && player.id !== room.me.id && player.alive;
    seat.classList.add("is-inspectable");
    seat.addEventListener("click", () => {
      if (targetable) {
        state.selectedTargetId = player.id;
        renderRoom();
        return;
      }
      if (targetMode) {
        return;
      }
      state.focusPlayerId = player.id;
      state.detailHidden = false;
      renderRoom();
    });

    const frame = document.createElement("div");
    frame.className = "seat-frame";

    const topLine = document.createElement("div");
    topLine.className = "seat-topline";

    const role = document.createElement("span");
    role.className = "role-chip";
    role.dataset.role = player.role || "hidden";
    role.textContent = player.roleName;

    const statusTag = document.createElement("span");
    statusTag.className = "seat-tag";
    statusTag.textContent = player.id === room.me.id ? "나" : player.isBot ? "BOT" : "PLAYER";

    const infoButton = document.createElement("button");
    infoButton.type = "button";
    infoButton.className = "seat-info-button";
    infoButton.setAttribute("aria-label", `${player.name} 상세 보기`);
    infoButton.textContent = "i";
    infoButton.addEventListener("click", (event) => {
      event.stopPropagation();
      state.focusPlayerId = player.id;
      state.detailHidden = false;
      renderRoom();
    });

    topLine.append(role, statusTag, infoButton);

    const head = document.createElement("div");
    head.className = "seat-head";

    const avatar = document.createElement("div");
    avatar.className = "seat-avatar";
    avatar.textContent = player.name.slice(0, 1);

    const title = document.createElement("div");
    title.className = "seat-title";

    const name = document.createElement("strong");
    name.textContent = player.name;
    title.append(name);
    head.append(avatar, title);

    const stats = document.createElement("div");
    stats.className = "seat-stats";

    const handStat = document.createElement("span");
    handStat.textContent = `손패 ${player.handCount}`;

    const rangeStat = document.createElement("span");
    rangeStat.textContent = `사거리 ${player.weaponRange}`;

    stats.append(handStat, rangeStat);

    frame.append(topLine, head, createHpMeter(player), stats, createEquipmentRow(player));
    seat.appendChild(frame);
    elements.playerBoard.appendChild(seat);
    state.seatElements.set(player.id, seat);
  });
}

function renderHand() {
  const self = me();
  const cards = self?.hand || [];

  elements.handList.innerHTML = "";
  elements.handCount.textContent = cards.length;
  const overlap = cards.length >= 10 ? -52 : cards.length >= 8 ? -42 : cards.length >= 6 ? -32 : -24;
  const width = cards.length >= 10 ? 108 : cards.length >= 8 ? 116 : cards.length >= 6 ? 126 : 138;
  elements.handList.style.setProperty("--hand-overlap", `${overlap}px`);
  elements.handList.style.setProperty("--hand-card-width", `${width}px`);

  if (!cards.length) {
    const empty = document.createElement("div");
    empty.className = "hand-empty";
    empty.textContent = "손패 없음";
    elements.handList.appendChild(empty);
    return;
  }

  const mid = (cards.length - 1) / 2;

  cards.forEach((card, index) => {
    const shell = document.createElement("div");
    shell.className = "hand-card-shell";
    shell.style.setProperty("--fan-rotate", `${(index - mid) * 3.2}deg`);
    shell.style.zIndex = String(index + 1);

    if (card.id === state.selectedCardId) {
      shell.classList.add("is-selected");
      shell.style.zIndex = String(cards.length + 10);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "hand-card";
    button.appendChild(renderCardFace(card));
    button.addEventListener("click", () => {
      state.selectedCardId = card.id;
      if (!cardNeedsTarget(card)) {
        state.selectedTargetId = null;
      }
      renderRoom();
    });

    const inspectButton = document.createElement("button");
    inspectButton.type = "button";
    inspectButton.className = "hand-inspect-button";
    inspectButton.setAttribute("aria-label", `${card.name} 크게 보기`);
    inspectButton.textContent = "⌕";
    inspectButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openCardZoom(card);
      renderRoom();
    });

    shell.append(button, inspectButton);
    elements.handList.appendChild(shell);
  });
}

function renderControls() {
  const room = state.room;
  const mine = isMyTurn();
  const card = selectedCard();
  const target = selectedTarget();
  const pending = pendingChoice();
  const sidReady = canUseSidAbility();
  const remainingSeats = Math.max(0, (room.targetPlayerCount || room.limits.maxPlayers) - room.players.length);

  elements.botTools.hidden = !(room.phase === "lobby" && room.hostId === room.me.id && remainingSeats > 0);
  elements.addBotButton.disabled = remainingSeats <= 0;
  elements.botCountInput.max = String(Math.max(1, remainingSeats));
  elements.botCountInput.value = String(Math.min(Math.max(1, Number.parseInt(elements.botCountInput.value || "1", 10) || 1), Math.max(1, remainingSeats)));
  elements.startButton.hidden = !(room.phase === "lobby" && room.hostId === room.me.id);
  elements.startButton.disabled = room.players.length !== room.targetPlayerCount;
  elements.resetButton.hidden = !(room.phase === "result" && room.hostId === room.me.id);

  elements.drawControls.hidden = !(room.phase === "draw" && mine && !pending);
  elements.playControls.hidden = !(room.phase === "play" && mine);
  elements.abilityControls.hidden = !sidReady || Boolean(pending);

  if (pending && mine) {
    elements.selectedLine.textContent = ABILITY_COPY[pending.abilityId]?.body || "능력을 선택하세요";
  } else if (room.phase === "lobby") {
    elements.selectedLine.textContent = roleGuideText(room.targetPlayerCount);
  } else if (card) {
    const targetText = cardNeedsTarget(card) ? ` -> ${target?.name || "대상 선택"}` : "";
    const descriptionText = card.description ? ` · ${card.description}` : "";
    elements.selectedLine.textContent = `${card.name}${targetText}${descriptionText}`;
  } else if (room.phase === "play" && mine) {
    elements.selectedLine.textContent = "카드를 선택하세요";
  } else if (room.phase === "draw" && mine) {
    elements.selectedLine.textContent = "카드를 뽑으세요";
  } else {
    elements.selectedLine.textContent = "테이블 대기";
  }

  elements.playButton.disabled = !card || (cardNeedsTarget(card) && !target);
}
function renderHeader() {
  const room = state.room;
  elements.roomBadge.textContent = room.code;
  elements.targetBadge.textContent = `${room.players.length}/${room.targetPlayerCount}명`;
  elements.phaseBadge.textContent = PHASE_TEXT[room.phase] || "-";
  elements.turnBadge.textContent =
    room.phase === "lobby" || room.phase === "result"
      ? "-"
      : `${currentPlayer()?.name || "-"} 차례`;
  elements.deckCount.textContent = room.deckCount;
  elements.discardCount.textContent = room.discardCount;
}

function renderStatus() {
  elements.centerStatus.textContent = phaseStatus();
}

function renderScreens() {
  const joined = Boolean(state.room);
  elements.entryScreen.hidden = joined;
  elements.gameScreen.hidden = !joined;
}

function renderRoom() {
  renderScreens();
  if (!state.room) {
    return;
  }

  renderHeader();
  fitTableStage();
  renderStatus();
  renderBoard();
  renderHand();
  renderControls();
  renderDetailPanel();
  renderLog();
  renderIntroModal();
  renderAbilityModal();
  renderCardZoomModal();
}

function focusedPlayer() {
  return (
    state.room?.players.find((player) => player.id === state.focusPlayerId) ||
    state.room?.players.find((player) => player.id === state.selectedTargetId) ||
    null
  );
}

function renderDetailStat(text) {
  const stat = document.createElement("span");
  stat.textContent = text;
  return stat;
}

function renderDetailPanel() {
  const player = focusedPlayer();
  const visible = Boolean(player) && !state.detailHidden;

  if (!visible) {
    elements.detailPanel.hidden = true;
    return;
  }

  elements.detailPanel.hidden = false;
  elements.detailName.textContent = player.name;
  elements.detailRole.textContent = player.roleName;
  elements.detailCharacter.textContent = player.character ? player.character.name : "-";
  elements.detailAbility.textContent = player.character?.ability || "-";

  elements.detailStats.innerHTML = "";
  [
    `체력 ${player.hp}/${player.maxHp}`,
    `손패 ${player.handCount}`,
    `사거리 ${player.weaponRange}`
  ].forEach((text) => {
    elements.detailStats.appendChild(renderDetailStat(text));
  });

  elements.detailEquipment.innerHTML = "";
  const equipment = equipmentCards(player);
  if (!equipment.length) {
    const tag = document.createElement("span");
    tag.textContent = "장비 없음";
    elements.detailEquipment.appendChild(tag);
    return;
  }

  equipment.forEach((card) => {
    elements.detailEquipment.appendChild(createEquipmentPreview(card));
  });
}
function introSummaryKey(room) {
  const self = me(room);
  return self ? `${room.code}:${self.role || "-"}:${self.character?.id || "-"}` : "";
}

function roleHeadline(player) {
  return `당신은 ${player.roleName}입니다`;
}
function renderCharacterChoice(option) {
  const card = document.createElement("div");
  card.className = "intro-choice intro-choice-static";
  card.innerHTML = `
    <strong>${option.name}</strong>
    <span>체력 ${option.hp}</span>
    <p>${option.ability}</p>
  `;
  return card;
}

function renderIntroModal() {
  const room = state.room;
  const self = me();

  if (!room || !self) {
    elements.introModal.hidden = true;
    return;
  }

  const summaryKey = introSummaryKey(room);
  const needsSummary =
    Boolean(self.character) &&
    room.phase !== "lobby" &&
    state.introSeenKey !== summaryKey;

  if (!needsSummary) {
    elements.introModal.hidden = true;
    return;
  }

  elements.introModal.hidden = false;
  elements.introChoices.innerHTML = "";

  elements.introTitle.textContent = roleHeadline(self);
  elements.introBody.textContent = `${self.character.name} · 체력 ${self.maxHp} · ${self.character.ability}`;
  elements.introCloseButton.hidden = false;
  elements.introChoices.appendChild(renderCharacterChoice(self.character));
}

function renderCardZoomTag(text) {
  const tag = document.createElement("span");
  tag.textContent = text;
  return tag;
}

function renderCardZoomModal() {
  const card = inspectedCard();

  if (!card) {
    elements.cardZoomModal.hidden = true;
    elements.cardZoomView.innerHTML = "";
    return;
  }

  elements.cardZoomModal.hidden = false;
  elements.cardZoomTitle.textContent = card.name;
  elements.cardZoomView.innerHTML = "";
  elements.cardZoomView.appendChild(renderCardFace(card));

  elements.cardZoomMeta.innerHTML = "";
  if (card.rank && card.suit) {
    elements.cardZoomMeta.appendChild(renderCardZoomTag(`${card.rank} ${cardSuitSymbol(card.suit)}`));
  }
  elements.cardZoomMeta.appendChild(renderCardZoomTag(card.type === "blue" ? "장비 카드" : "행동 카드"));
  if (card.weaponRange) {
    elements.cardZoomMeta.appendChild(renderCardZoomTag(`사거리 ${card.weaponRange}`));
  }

  elements.cardZoomDescription.textContent = card.description || "설명이 없습니다.";
}

function renderAbilityOptionCard(card, selected, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ability-card-option${selected ? " is-selected" : ""}`;
  button.appendChild(renderCardFace(card));
  button.addEventListener("click", onClick);
  return button;
}

async function resolvePendingChoice(payload) {
  const response = await emitWithAck("ability:resolve", { code: state.roomCode, ...payload });
  if (!response?.ok) {
    setFlash(response?.message || "능력 선택 실패");
    return;
  }
  state.abilitySelectedCardIds = [];
  setFlash("");
}

async function submitSidAbility() {
  const response = await emitWithAck("ability:sid", {
    code: state.roomCode,
    cardIds: state.abilitySelectedCardIds
  });
  if (!response?.ok) {
    setFlash(response?.message || "능력 사용 실패");
    return;
  }
  closeSidAbility();
  setFlash("");
}

function renderJesseJonesOptions(choice) {
  const fragment = document.createDocumentFragment();

  const deckButton = document.createElement("button");
  deckButton.type = "button";
  deckButton.className = "ability-choice-button";
  deckButton.innerHTML = `<strong>덱에서 뽑기</strong><span>첫 번째 카드를 덱에서 가져옵니다.</span>`;
  deckButton.addEventListener("click", () => resolvePendingChoice({ source: "deck" }));
  fragment.appendChild(deckButton);

  (choice.targets || []).forEach((target) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ability-choice-button";
    button.innerHTML = `<strong>${target.name}</strong><span>손패 ${target.handCount}장 중 무작위 1장</span>`;
    button.addEventListener("click", () => resolvePendingChoice({ source: "player", targetId: target.id }));
    fragment.appendChild(button);
  });

  elements.abilityOptions.appendChild(fragment);
}

function renderPedroRamirezOptions(choice) {
  const fragment = document.createDocumentFragment();

  if (choice.discardTop) {
    const discardButton = document.createElement("button");
    discardButton.type = "button";
    discardButton.className = "ability-choice-button ability-choice-card";
    discardButton.append(renderCardFace(choice.discardTop));
    const copy = document.createElement("span");
    copy.textContent = "버린 카드 더미 맨 위 카드 가져오기";
    discardButton.appendChild(copy);
    discardButton.addEventListener("click", () => resolvePendingChoice({ source: "discard" }));
    fragment.appendChild(discardButton);
  }

  const deckButton = document.createElement("button");
  deckButton.type = "button";
  deckButton.className = "ability-choice-button";
  deckButton.innerHTML = `<strong>덱에서 뽑기</strong><span>첫 번째 카드를 덱에서 가져옵니다.</span>`;
  deckButton.addEventListener("click", () => resolvePendingChoice({ source: "deck" }));
  fragment.appendChild(deckButton);

  elements.abilityOptions.appendChild(fragment);
}

function renderKitCarlsonOptions(choice) {
  const required = choice.selectCount || 2;

  (choice.peeked || []).forEach((card) => {
    const selected = state.abilitySelectedCardIds.includes(card.id);
    elements.abilityOptions.appendChild(
      renderAbilityOptionCard(card, selected, () => {
        toggleAbilityCardSelection(card.id, required);
        renderAbilityModal();
      })
    );
  });

  elements.abilityConfirmButton.disabled = state.abilitySelectedCardIds.length !== required;
}

function renderSidOptions() {
  const self = me();
  const required = 2;

  (self?.hand || []).forEach((card) => {
    const selected = state.abilitySelectedCardIds.includes(card.id);
    elements.abilityOptions.appendChild(
      renderAbilityOptionCard(card, selected, () => {
        toggleAbilityCardSelection(card.id, required);
        renderAbilityModal();
      })
    );
  });

  elements.abilityConfirmButton.disabled = state.abilitySelectedCardIds.length !== required;
}

function renderAbilityModal() {
  const modal = activeAbilityModal();
  if (!modal) {
    elements.abilityModal.hidden = true;
    elements.abilityOptions.innerHTML = "";
    return;
  }

  const copy = ABILITY_COPY[modal.abilityId];
  const pending = modal.mode === "pending";

  elements.abilityModal.hidden = false;
  elements.abilityTitle.textContent = copy?.title || "능력";
  elements.abilityBody.textContent = copy?.body || "-";
  elements.abilityOptions.innerHTML = "";
  elements.abilityCloseButton.hidden = pending;
  elements.abilityActions.hidden = pending && modal.abilityId !== "kit_carlson";
  elements.abilityConfirmButton.textContent = "확인";
  elements.abilityConfirmButton.disabled = false;

  if (modal.abilityId === "jesse_jones") {
    renderJesseJonesOptions(modal.pending);
    return;
  }

  if (modal.abilityId === "pedro_ramirez") {
    renderPedroRamirezOptions(modal.pending);
    return;
  }

  if (modal.abilityId === "kit_carlson") {
    elements.abilityConfirmButton.textContent = "선택 완료";
    renderKitCarlsonOptions(modal.pending);
    return;
  }

  if (modal.abilityId === "sid_ketchum") {
    elements.abilityConfirmButton.textContent = "회복";
    renderSidOptions();
  }
}

function renderLog() {
  if (!elements.logList) {
    return;
  }

  elements.logList.innerHTML = "";
  const logs = state.room?.log || [];

  if (!logs.length) {
    const item = document.createElement("li");
    item.className = "message-item";
    item.textContent = "-";
    elements.logList.appendChild(item);
    return;
  }

  logs
    .slice()
    .reverse()
    .forEach((entry) => {
      const item = document.createElement("li");
      item.className = "message-item";
      item.textContent = entry.text;
      elements.logList.appendChild(item);
    });
}

function pointFromElement(element) {
  if (!element) {
    return null;
  }

  const stageRect = elements.tableStage.getBoundingClientRect();
  const rect = element.getBoundingClientRect();

  return {
    x: rect.left - stageRect.left + rect.width / 2,
    y: rect.top - stageRect.top + rect.height / 2
  };
}

function seatPoint(playerId) {
  const seat = state.seatElements.get(playerId);
  if (!seat) {
    return null;
  }
  return pointFromElement(seat.querySelector(".seat-avatar") || seat);
}

function pilePoint(kind) {
  return pointFromElement(kind === "discard" ? elements.discardStack : elements.deckStack);
}

function appendAnimatedNode(node) {
  if (!node) {
    return null;
  }

  elements.animationLayer.appendChild(node);
  node.addEventListener(
    "animationend",
    () => {
      node.remove();
    },
    { once: true }
  );
  return node;
}

function makeFxNode(className, point, text = "") {
  if (!point) {
    return null;
  }

  const node = document.createElement("div");
  node.className = className;
  if (text) {
    node.textContent = text;
  }
  node.style.left = `${point.x}px`;
  node.style.top = `${point.y}px`;
  return appendAnimatedNode(node);
}

function makeTravelFx(className, from, to) {
  if (!from || !to) {
    return null;
  }

  const node = document.createElement("div");
  node.className = className;
  node.style.left = `${from.x}px`;
  node.style.top = `${from.y}px`;
  node.style.setProperty("--dx", `${to.x - from.x}px`);
  node.style.setProperty("--dy", `${to.y - from.y}px`);
  node.style.setProperty("--card-rotate", `${Math.round(Math.random() * 18 - 9)}deg`);
  return appendAnimatedNode(node);
}

function pulseSeat(playerId, className, duration = 700) {
  const seat = state.seatElements.get(playerId);
  const frame = seat?.querySelector(".seat-frame");

  if (!frame) {
    return;
  }

  frame.classList.remove(className);
  void frame.offsetWidth;
  frame.classList.add(className);
  window.setTimeout(() => frame.classList.remove(className), duration);
}

function showBanner(text, tone = "action", delay = 0) {
  window.setTimeout(() => {
    elements.cinematicBanner.textContent = text;
    elements.cinematicBanner.dataset.tone = tone;
    elements.cinematicBanner.classList.remove("is-visible");
    void elements.cinematicBanner.offsetWidth;
    elements.cinematicBanner.classList.add("is-visible");

    clearTimeout(state.bannerTimer);
    state.bannerTimer = window.setTimeout(() => {
      elements.cinematicBanner.classList.remove("is-visible");
    }, 1100);
  }, delay);
}

function animateCardTravel(from, to, count = 1, variant = "draw", delay = 0) {
  for (let index = 0; index < count; index += 1) {
    window.setTimeout(() => {
      makeTravelFx(`fx-card-travel ${variant}`, from, to);
    }, delay + index * 120);
  }
}

function animateShot(fromId, toId, label = "BANG!", delay = 0) {
  window.setTimeout(() => {
    const from = seatPoint(fromId);
    const to = seatPoint(toId);

    if (!from || !to) {
      return;
    }

    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const shot = document.createElement("div");
    shot.className = "fx-shot";
    shot.style.left = `${from.x}px`;
    shot.style.top = `${from.y}px`;
    shot.style.width = `${distance}px`;
    shot.style.transform = `translateY(-50%) rotate(${angle}rad)`;

    const head = document.createElement("span");
    head.className = "fx-shot-head";
    shot.appendChild(head);
    appendAnimatedNode(shot);

    makeFxNode("fx-burst", from);
    makeFxNode("fx-impact", to);
    pulseSeat(fromId, "fx-recoil", 420);

    if (label) {
      showBanner(label, "attack");
    }
  }, delay);
}

function animateLink(fromId, toId, label, className = "fx-link", delay = 0) {
  window.setTimeout(() => {
    const from = seatPoint(fromId);
    const to = seatPoint(toId);

    if (!from || !to) {
      return;
    }

    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const link = document.createElement("div");
    link.className = className;
    link.style.left = `${from.x}px`;
    link.style.top = `${from.y}px`;
    link.style.width = `${distance}px`;
    link.style.transform = `translateY(-50%) rotate(${angle}rad)`;
    appendAnimatedNode(link);

    showBanner(label, "utility");
  }, delay);
}

function animateDamage(playerId, amount = 1, delay = 0) {
  window.setTimeout(() => {
    const point = seatPoint(playerId);
    if (!point) {
      return;
    }

    pulseSeat(playerId, "fx-hit", 700);
    for (let index = 0; index < amount; index += 1) {
      makeFxNode("fx-popup damage", { x: point.x + index * 10, y: point.y - index * 6 }, "-1");
    }
  }, delay);
}

function animateHeal(playerId, amount = 1, delay = 0) {
  window.setTimeout(() => {
    const point = seatPoint(playerId);
    if (!point) {
      return;
    }

    pulseSeat(playerId, "fx-heal", 700);
    for (let index = 0; index < amount; index += 1) {
      makeFxNode("fx-popup heal", { x: point.x + index * 10, y: point.y - index * 6 }, "+1");
    }
  }, delay);
}

function animateEliminate(playerId, delay = 0) {
  window.setTimeout(() => {
    const point = seatPoint(playerId);
    pulseSeat(playerId, "fx-eliminate", 950);
    makeFxNode("fx-impact large", point);
  }, delay);
}

function animateTurn(playerId, delay = 0) {
  window.setTimeout(() => {
    pulseSeat(playerId, "fx-turn", 1100);
  }, delay);
}

function animateGatling(fromId, room, delay = 0) {
  showBanner("GATLING", "attack", delay);
  room.players
    .filter((player) => player.alive && player.id !== fromId)
    .forEach((player, index) => {
      animateShot(fromId, player.id, "", delay + index * 90);
    });
}

function animateIndians(room, delay = 0) {
  showBanner("INDIANS!", "warning", delay);
  room.players
    .filter((player) => player.alive)
    .forEach((player, index) => {
      window.setTimeout(() => {
        makeFxNode("fx-arrow-rain", seatPoint(player.id));
      }, delay + index * 70);
    });
}

function playerNameById(room, playerId) {
  return room.players.find((player) => player.id === playerId)?.name || "";
}

function playerIdByName(room, name) {
  return room.players.find((player) => player.name === name)?.id || null;
}

function actionCardData(cardId) {
  const meta = ACTION_CARD_META[cardId];
  if (!meta) {
    return null;
  }

  return {
    cardId,
    name: meta.name,
    type: meta.type,
    description: meta.description,
    rank: "",
    suit: ""
  };
}

function actionSpotlightLine(event, room) {
  const actor = playerNameById(room, event.fromId || event.playerId);
  const target = playerNameById(room, event.toId);

  if (event.fromId && event.toId) {
    return `${actor} -> ${target}`;
  }

  if (event.fromId && event.scope === "all") {
    return `${actor} -> 전체`;
  }

  if (event.playerId) {
    return actor;
  }

  if (event.fromId) {
    return actor;
  }

  return "즉시 효과";
}

function actionSpotlightKicker(tone) {
  if (tone === "attack") {
    return "공격 카드";
  }

  if (tone === "defense") {
    return "방어 카드";
  }

  if (tone === "warning") {
    return "지속 효과";
  }

  return "효과 카드";
}

function showActionSpotlight(event, room, delay = 0) {
  const card = actionCardData(event.cardId);
  if (!card) {
    return;
  }

  const tone = event.tone || ACTION_CARD_META[event.cardId]?.tone || "utility";

  window.setTimeout(() => {
    const panel = document.createElement("section");
    panel.className = "action-spotlight";
    panel.dataset.tone = tone;

    const cardWrap = document.createElement("div");
    cardWrap.className = "action-spotlight-card";
    cardWrap.appendChild(renderCardFace(card));

    const copy = document.createElement("div");
    copy.className = "action-spotlight-copy";

    const kicker = document.createElement("span");
    kicker.className = "action-spotlight-kicker";
    kicker.textContent = actionSpotlightKicker(tone);

    const title = document.createElement("strong");
    title.className = "action-spotlight-title";
    title.textContent = card.name;

    const line = document.createElement("p");
    line.className = "action-spotlight-line";
    line.textContent = actionSpotlightLine(event, room);

    const description = document.createElement("p");
    description.className = "action-spotlight-description";
    description.textContent = event.summary || card.description;

    copy.append(kicker, title, line, description);
    panel.append(cardWrap, copy);
    appendAnimatedNode(panel);
  }, delay);
}

function parseActionEvents(text, room) {
  const events = [];
  let match = null;

  if (text === "게임 시작") {
    events.push({ type: "banner", text: "BANG!", tone: "attack" });
    return events;
  }

  match = text.match(/^(.+?) 뱅 -> (.+)$/);
  if (match) {
    const fromId = playerIdByName(room, match[1]);
    const toId = playerIdByName(room, match[2]);
    if (fromId && toId) {
      events.push({ type: "shot", fromId, toId, label: "BANG!", cardId: "bang", tone: "attack", summary: ACTION_CARD_META.bang.description });
    }
    return events;
  }

  match = text.match(/^(.+?) 결투 -> (.+)$/);
  if (match) {
    const fromId = playerIdByName(room, match[1]);
    const toId = playerIdByName(room, match[2]);
    if (fromId && toId) {
      events.push({ type: "duel", fromId, toId, label: "DUEL", cardId: "duel", tone: "attack", summary: ACTION_CARD_META.duel.description });
    }
    return events;
  }

  match = text.match(/^(.+?) 강탈 -> (.+)$/);
  if (match) {
    const fromId = playerIdByName(room, match[1]);
    const toId = playerIdByName(room, match[2]);
    if (fromId && toId) {
      events.push({ type: "steal", fromId, toId, label: "PANIC", cardId: "panic", tone: "utility", summary: ACTION_CARD_META.panic.description });
    }
    return events;
  }

  match = text.match(/^(.+?) 캣 벌루 -> (.+)$/);
  if (match) {
    const fromId = playerIdByName(room, match[1]);
    const toId = playerIdByName(room, match[2]);
    if (fromId && toId) {
      events.push({ type: "break", fromId, toId, label: "CAT BALOU", cardId: "cat_balou", tone: "utility", summary: ACTION_CARD_META.cat_balou.description });
    }
    return events;
  }

  match = text.match(/^(.+?) 감옥 -> (.+)$/);
  if (match) {
    const fromId = playerIdByName(room, match[1]);
    const toId = playerIdByName(room, match[2]);
    if (fromId && toId) {
      events.push({ type: "jail", fromId, toId, label: "JAIL", cardId: "jail", tone: "warning", summary: ACTION_CARD_META.jail.description });
    }
    return events;
  }

  match = text.match(/^(.+?) 기관총$/);
  if (match) {
    const fromId = playerIdByName(room, match[1]);
    if (fromId) {
      events.push({ type: "gatling", fromId, scope: "all", cardId: "gatling", tone: "attack", summary: ACTION_CARD_META.gatling.description });
    }
    return events;
  }

  match = text.match(/^(.+?) 인디언!?$/);
  if (match) {
    const fromId = playerIdByName(room, match[1]);
    events.push({ type: "indians", fromId, scope: "all", cardId: "indians", tone: "warning", summary: ACTION_CARD_META.indians.description });
    return events;
  }

  match = text.match(/^(.+?) 다이너마이트 폭발$/);
  if (match) {
    const playerId = playerIdByName(room, match[1]);
    if (playerId) {
      events.push({ type: "boom", playerId, label: "BOOM", cardId: "dynamite", tone: "warning", summary: "다이너마이트가 폭발해 피해 3" });
    }
    return events;
  }

  match = text.match(/^(.+?) 빗나감!?$/);
  if (match) {
    const playerId = playerIdByName(room, match[1]);
    if (playerId) {
      events.push({ type: "miss", playerId, label: "MISS", cardId: "missed", tone: "defense", summary: ACTION_CARD_META.missed.description });
    }
    return events;
  }

  match = text.match(/^(.+?) 술통 회피$/);
  if (match) {
    const playerId = playerIdByName(room, match[1]);
    if (playerId) {
      events.push({ type: "miss", playerId, label: "BARREL", cardId: "barrel", tone: "defense", summary: "술통 판정으로 공격 회피" });
    }
    return events;
  }

  match = text.match(/^(.+?) 맥주(?: 효과 없음)?$/);
  if (match) {
    const playerId = playerIdByName(room, match[1]);
    if (playerId) {
      events.push({ type: "spotlight", playerId, cardId: "beer", tone: "utility", summary: text.endsWith("효과 없음") ? "체력이 가득 차 있으면 회복되지 않습니다" : ACTION_CARD_META.beer.description });
    }
    return events;
  }

  match = text.match(/^(.+?) 주점$/);
  if (match) {
    const fromId = playerIdByName(room, match[1]);
    if (fromId) {
      events.push({ type: "spotlight", fromId, scope: "all", cardId: "saloon", tone: "utility", summary: ACTION_CARD_META.saloon.description });
    }
    return events;
  }

  match = text.match(/^(.+?) 카드 2장$/);
  if (match) {
    const playerId = playerIdByName(room, match[1]);
    if (playerId) {
      events.push({ type: "spotlight", playerId, cardId: "stagecoach", tone: "utility", summary: ACTION_CARD_META.stagecoach.description });
    }
    return events;
  }

  match = text.match(/^(.+?) 카드 3장$/);
  if (match) {
    const playerId = playerIdByName(room, match[1]);
    if (playerId) {
      events.push({ type: "spotlight", playerId, cardId: "wells_fargo", tone: "utility", summary: ACTION_CARD_META.wells_fargo.description });
    }
    return events;
  }

  match = text.match(/^(.+?) 잡화점$/);
  if (match) {
    const fromId = playerIdByName(room, match[1]);
    if (fromId) {
      events.push({ type: "spotlight", fromId, scope: "all", cardId: "general_store", tone: "utility", summary: ACTION_CARD_META.general_store.description });
    }
    return events;
  }

  if (text.includes("승리")) {
    events.push({ type: "banner", text, tone: "result" });
  }

  return events;
}

function parseLogAnimations() {
  return [];
}
function collectAnimationEvents(previousRoom, nextRoom) {
  if (!previousRoom || previousRoom.code !== nextRoom.code) {
    return [];
  }

  const events = [];
  const previousPlayers = new Map(previousRoom.players.map((player) => [player.id, player]));
  const previousLogIds = new Set((previousRoom.log || []).map((entry) => entry.id));
  const animateHandChanges = previousRoom.phase !== "lobby" && nextRoom.phase !== "lobby";

  (nextRoom.log || [])
    .filter((entry) => !previousLogIds.has(entry.id))
    .forEach((entry) => {
      events.push(...parseActionEvents(entry.text, nextRoom));
    });

  nextRoom.players.forEach((player) => {
    const before = previousPlayers.get(player.id);
    if (!before) {
      return;
    }

    if (player.hp < before.hp) {
      events.push({ type: "damage", playerId: player.id, amount: before.hp - player.hp });
    }
    if (player.hp > before.hp) {
      events.push({ type: "heal", playerId: player.id, amount: player.hp - before.hp });
    }
    if (animateHandChanges) {
      const handDelta = player.handCount - before.handCount;
      if (handDelta > 0) {
        events.push({ type: "draw", playerId: player.id, count: Math.min(handDelta, 3) });
      }
    }
    if (before.alive && !player.alive) {
      events.push({ type: "eliminate", playerId: player.id });
    }
  });

  if (previousRoom.currentPlayerId !== nextRoom.currentPlayerId && nextRoom.currentPlayerId) {
    events.push({ type: "turn", playerId: nextRoom.currentPlayerId });
  }

  return events;
}

function eventDelayStep(event) {
  switch (event.type) {
    case "shot":
      return 260;
    case "duel":
      return 340;
    case "steal":
    case "break":
    case "jail":
      return 260;
    case "gatling":
      return 360;
    case "indians":
      return 320;
    case "boom":
      return 260;
    case "spotlight":
      return 260;
    case "draw":
      return 140;
    case "damage":
    case "heal":
    case "miss":
      return 140;
    case "turn":
      return 100;
    case "banner":
      return 180;
    default:
      return 120;
  }
}

function runAnimationEvent(event, room, delay) {
  switch (event.type) {
    case "banner":
      showBanner(event.text, event.tone, delay);
      break;
    case "shot":
      showActionSpotlight(event, room, delay);
      animateShot(event.fromId, event.toId, event.label, delay);
      break;
    case "duel":
      showActionSpotlight(event, room, delay);
      animateLink(event.fromId, event.toId, event.label, "fx-link duel", delay);
      animateShot(event.fromId, event.toId, "", delay + 60);
      animateShot(event.toId, event.fromId, "", delay + 140);
      break;
    case "steal":
      showActionSpotlight(event, room, delay);
      animateLink(event.fromId, event.toId, event.label, "fx-link steal", delay);
      animateCardTravel(seatPoint(event.toId), seatPoint(event.fromId), 1, "steal", delay + 40);
      break;
    case "break":
      showActionSpotlight(event, room, delay);
      animateLink(event.fromId, event.toId, event.label, "fx-link break", delay);
      animateCardTravel(seatPoint(event.toId), pilePoint("discard"), 1, "discard", delay + 40);
      break;
    case "jail":
      showActionSpotlight(event, room, delay);
      animateLink(event.fromId, event.toId, event.label, "fx-link jail", delay);
      animateCardTravel(pilePoint("deck"), seatPoint(event.toId), 1, "jail", delay + 40);
      break;
    case "gatling":
      showActionSpotlight(event, room, delay);
      animateGatling(event.fromId, room, delay);
      break;
    case "indians":
      showActionSpotlight(event, room, delay);
      animateIndians(room, delay);
      break;
    case "boom":
      showActionSpotlight(event, room, delay);
      showBanner(event.label, "warning", delay);
      window.setTimeout(() => {
        const point = seatPoint(event.playerId);
        makeFxNode("fx-impact large", point);
        pulseSeat(event.playerId, "fx-hit", 850);
      }, delay);
      break;
    case "miss":
      showActionSpotlight(event, room, delay);
      showBanner(event.label, "utility", delay);
      window.setTimeout(() => {
        makeFxNode("fx-burst", seatPoint(event.playerId));
      }, delay);
      break;
    case "spotlight":
      showActionSpotlight(event, room, delay);
      break;
    case "draw":
      animateCardTravel(pilePoint("deck"), seatPoint(event.playerId), event.count, "draw", delay);
      break;
    case "damage":
      animateDamage(event.playerId, event.amount, delay);
      break;
    case "heal":
      animateHeal(event.playerId, event.amount, delay);
      break;
    case "eliminate":
      animateEliminate(event.playerId, delay);
      break;
    case "turn":
      animateTurn(event.playerId, delay);
      break;
    default:
      break;
  }
}

function playRoomAnimations(previousRoom, nextRoom) {
  if (!previousRoom || !nextRoom || previousRoom.code !== nextRoom.code) {
    return;
  }

  const events = collectAnimationEvents(previousRoom, nextRoom);
  let delay = 0;

  events.forEach((event) => {
    runAnimationEvent(event, nextRoom, delay);
    delay += eventDelayStep(event);
  });
}

let responsiveRenderFrame = null;

function queueResponsiveRender() {
  if (!state.room) {
    return;
  }

  if (responsiveRenderFrame) {
    cancelAnimationFrame(responsiveRenderFrame);
  }

  responsiveRenderFrame = requestAnimationFrame(() => {
    responsiveRenderFrame = null;
    renderRoom();
  });
}

async function createRoom() {
  const response = await emitWithAck("room:create", {
    name: elements.nameInput.value.trim(),
    targetPlayerCount: selectedTargetPlayerCount()
  });
  if (!response?.ok) {
    setEntryStatus(response?.message || "방 생성 실패");
    return;
  }
  state.roomCode = response.code;
  elements.roomInput.value = response.code;
  rememberSessionRoom(response.code);
}

async function joinRoom() {
  const response = await emitWithAck("room:join", {
    code: elements.roomInput.value.trim().toUpperCase(),
    name: elements.nameInput.value.trim()
  });
  if (!response?.ok) {
    setEntryStatus(response?.message || "입장 실패");
    return;
  }
  state.roomCode = response.code;
  rememberSessionRoom(response.code);
}

async function restoreSavedRoom() {
  if (state.restoreAttempted || state.room) {
    return;
  }

  const saved = appSession.getSavedRoom();
  if (!saved?.roomCode) {
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
    return;
  }

  state.roomCode = response.code;
  rememberSessionRoom(response.code);
}

async function addBot() {
  const response = await emitWithAck("room:add_bots", {
    code: state.roomCode,
    count: Number.parseInt(elements.botCountInput.value || "1", 10)
  });
  if (!response?.ok) {
    setFlash(response?.message || "봇 추가 실패");
    return;
  }
  setFlash("");
}

socket.on("room:update", (room) => {
  const previousRoom = state.room;
  const previousPendingAbilityId = previousRoom?.pendingChoice?.abilityId || null;

  state.previousRoom = previousRoom;
  state.room = room;
  state.roomCode = room.code;
  rememberSessionRoom(room.code, room.me?.name || currentName());

  if (!previousRoom || previousRoom.code !== room.code || room.phase === "lobby") {
    state.introSeenKey = "";
  }

  const self = me(room);
  if (room.pendingChoice) {
    state.abilityMode = null;
  }
  if (!room.pendingChoice || room.pendingChoice.abilityId !== previousPendingAbilityId) {
    state.abilitySelectedCardIds = [];
  }
  if (state.abilityMode === "sid_ketchum" && !canUseSidAbility(room)) {
    closeSidAbility();
  }
  state.abilitySelectedCardIds = state.abilitySelectedCardIds.filter((id) => self?.hand.some((card) => card.id === id));
  if (!room.players.some((player) => player.id === state.focusPlayerId)) {
    state.focusPlayerId = null;
    state.detailHidden = true;
  }
  if (!self?.hand.some((card) => card.id === state.selectedCardId)) {
    state.selectedCardId = null;
  }
  if (!room.players.some((player) => player.id === state.selectedTargetId && player.alive)) {
    state.selectedTargetId = null;
  }
  if (room.phase !== "play") {
    state.selectedCardId = null;
    state.selectedTargetId = null;
  }

  renderRoom();
  requestAnimationFrame(() => playRoomAnimations(previousRoom, room));
});

elements.createRoomButton.addEventListener("click", createRoom);
elements.joinRoomButton.addEventListener("click", joinRoom);
elements.addBotButton.addEventListener("click", addBot);
elements.introCloseButton.addEventListener("click", () => {
  state.introSeenKey = introSummaryKey(state.room);
  renderIntroModal();
});
elements.abilityButton?.addEventListener("click", () => {
  openSidAbility();
  renderAbilityModal();
});
elements.abilityCloseButton?.addEventListener("click", () => {
  if (pendingChoice()) {
    return;
  }
  closeSidAbility();
  renderAbilityModal();
});
elements.abilityBackdrop?.addEventListener("click", () => {
  if (pendingChoice()) {
    return;
  }
  closeSidAbility();
  renderAbilityModal();
});
elements.abilityConfirmButton?.addEventListener("click", async () => {
  const modal = activeAbilityModal();
  if (!modal) {
    return;
  }

  if (modal.abilityId === "kit_carlson") {
    await resolvePendingChoice({ keepCardIds: state.abilitySelectedCardIds });
    return;
  }

  if (modal.abilityId === "sid_ketchum") {
    await submitSidAbility();
  }
});
elements.detailCloseButton?.addEventListener("click", () => {
  state.detailHidden = true;
  state.focusPlayerId = null;
  renderRoom();
});
elements.detailBackdrop?.addEventListener("click", () => {
  state.detailHidden = true;
  state.focusPlayerId = null;
  renderRoom();
});
elements.cardZoomCloseButton.addEventListener("click", () => {
  closeCardZoom();
  renderCardZoomModal();
});
elements.cardZoomBackdrop.addEventListener("click", () => {
  closeCardZoom();
  renderCardZoomModal();
});
elements.startButton.addEventListener("click", async () => {
  const response = await emitWithAck("game:start", { code: state.roomCode });
  if (!response?.ok) {
    setFlash(response?.message || "시작 실패");
    return;
  }
  setFlash("");
});
elements.resetButton.addEventListener("click", async () => {
  const response = await emitWithAck("game:reset", { code: state.roomCode });
  if (!response?.ok) {
    setFlash(response?.message || "초기화 실패");
    return;
  }
  setFlash("");
});
elements.drawButton.addEventListener("click", async () => {
  const response = await emitWithAck("turn:draw", { code: state.roomCode });
  if (!response?.ok) {
    setFlash(response?.message || "드로우 실패");
    return;
  }
  setFlash("");
});
elements.playButton.addEventListener("click", async () => {
  const response = await emitWithAck("card:play", {
    code: state.roomCode,
    cardId: state.selectedCardId,
    targetId: state.selectedTargetId
  });
  if (!response?.ok) {
    setFlash(response?.message || "사용 실패");
    return;
  }
  state.selectedCardId = null;
  state.selectedTargetId = null;
  setFlash("");
});
elements.endTurnButton.addEventListener("click", async () => {
  const response = await emitWithAck("turn:end", { code: state.roomCode });
  if (!response?.ok) {
    setFlash(response?.message || "턴 종료 실패");
    return;
  }
  state.selectedCardId = null;
  state.selectedTargetId = null;
  setFlash("");
});
elements.targetPlayerCountSelect?.addEventListener("change", () => {
  renderRoleGuide();
});
elements.botCountInput?.addEventListener("input", () => {
  const value = Number.parseInt(elements.botCountInput.value || "1", 10);
  const max = Number.parseInt(elements.botCountInput.max || "1", 10);
  elements.botCountInput.value = String(Math.min(Math.max(1, value || 1), Math.max(1, max)));
});
elements.roomInput.addEventListener("input", () => {
  elements.roomInput.value = elements.roomInput.value.trim().toUpperCase();
});
elements.roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom();
  }
});
elements.nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    if (elements.roomInput.value.trim()) {
      joinRoom();
    } else {
      createRoom();
    }
  }
});
window.addEventListener("resize", queueResponsiveRender);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.inspectedCard) {
    closeCardZoom();
    renderCardZoomModal();
    return;
  }

  if (event.key === "Escape" && state.abilityMode === "sid_ketchum") {
    closeSidAbility();
    renderAbilityModal();
    return;
  }

  if (event.key === "Escape" && !state.detailHidden) {
    state.detailHidden = true;
    state.focusPlayerId = null;
    renderRoom();
  }
});

renderRoleGuide();
renderRoom();

if (socket.connected) {
  restoreSavedRoom();
} else {
  socket.on("connect", restoreSavedRoom);
}




