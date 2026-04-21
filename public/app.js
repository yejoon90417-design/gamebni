const appSession = window.GamebniSession.createClient("liar");
const socket = io({
  auth: {
    playerSessionId: appSession.playerSessionId
  }
});
const MIN_PLAYERS = 2;
const CHAT_BUBBLE_TTL = 5000;
const REACTION_OPTIONS = [
  { key: "heart", emoji: "❤️", label: "하트" },
  { key: "poop", emoji: "💩", label: "똥" },
  { key: "thumb", emoji: "👍", label: "엄지" }
];
const REACTION_ANIMATION_TTL = 1800;

const state = {
  roomCode: "",
  room: null,
  flashStatus: "",
  roleModalRound: null,
  dismissedRoleModalRound: null,
  turnModalMode: null,
  turnModalKey: null,
  bubbleTimerId: null,
  phaseClockTimerId: null,
  reactionPickerPlayerId: null,
  restoreAttempted: false
};

const elements = {
  entryScreen: document.getElementById("entryScreen"),
  gameScreen: document.getElementById("gameScreen"),
  nameInput: document.getElementById("nameInput"),
  roomInput: document.getElementById("roomInput"),
  discussionRoundsInput: document.getElementById("discussionRoundsInput"),
  breakSecondsInput: document.getElementById("breakSecondsInput"),
  voteModeInput: document.getElementById("voteModeInput"),
  liarCountInput: document.getElementById("liarCountInput"),
  entryStatus: document.getElementById("entryStatus"),
  roomBadge: document.getElementById("roomBadge"),
  phaseBadge: document.getElementById("phaseBadge"),
  roundBadge: document.getElementById("roundBadge"),
  startRoundButton: document.getElementById("startRoundButton"),
  resetRoundButton: document.getElementById("resetRoundButton"),
  seatMap: document.getElementById("seatMap"),
  seatChatComposer: document.getElementById("seatChatComposer"),
  roleLabel: document.getElementById("roleLabel"),
  topicLabel: document.getElementById("topicLabel"),
  wordLabel: document.getElementById("wordLabel"),
  turnLabel: document.getElementById("turnLabel"),
  settingsLabel: document.getElementById("settingsLabel"),
  phaseMeta: document.getElementById("phaseMeta"),
  globalStatus: document.getElementById("globalStatus"),
  chatLogList: document.getElementById("chatLogList"),
  messageList: document.getElementById("messageList"),
  voteArea: document.getElementById("voteArea"),
  voteTitle: document.getElementById("voteTitle"),
  voteList: document.getElementById("voteList"),
  chatInput: document.getElementById("chatInput"),
  sendChatButton: document.getElementById("sendChatButton"),
  opinionInput: document.getElementById("opinionInput"),
  sendOpinionButton: document.getElementById("sendOpinionButton"),
  turnModal: document.getElementById("turnModal"),
  turnModalCurrentLabel: document.getElementById("turnModalCurrentLabel"),
  turnModePicker: document.getElementById("turnModePicker"),
  selectOpinionModeButton: document.getElementById("selectOpinionModeButton"),
  selectGuessModeButton: document.getElementById("selectGuessModeButton"),
  turnOpinionSection: document.getElementById("turnOpinionSection"),
  turnGuessSection: document.getElementById("turnGuessSection"),
  turnGuessInput: document.getElementById("turnGuessInput"),
  submitTurnGuessButton: document.getElementById("submitTurnGuessButton"),
  finalGuessModal: document.getElementById("finalGuessModal"),
  finalGuessInput: document.getElementById("finalGuessInput"),
  submitFinalGuessButton: document.getElementById("submitFinalGuessButton"),
  resultPanel: document.getElementById("resultPanel"),
  winnerLabel: document.getElementById("winnerLabel"),
  answerLabel: document.getElementById("answerLabel"),
  liarLabel: document.getElementById("liarLabel"),
  accusedLabel: document.getElementById("accusedLabel"),
  guessLabel: document.getElementById("guessLabel"),
  reasonLabel: document.getElementById("reasonLabel"),
  createRoomButton: document.getElementById("createRoomButton"),
  joinRoomButton: document.getElementById("joinRoomButton"),
  leaveButton: document.getElementById("leaveButton"),
  roleModal: document.getElementById("roleModal"),
  modalRoleTitle: document.getElementById("modalRoleTitle"),
  modalTopicLabel: document.getElementById("modalTopicLabel"),
  modalWordLabel: document.getElementById("modalWordLabel"),
  closeRoleModalButton: document.getElementById("closeRoleModalButton")
};

appSession.hydrateEntry({
  nameInput: elements.nameInput,
  roomInput: elements.roomInput
});

const ENTRY_PATH = "/";
const PLAY_PATH = "/play";

function isPlayRoute() {
  const { pathname } = window.location;
  return pathname === PLAY_PATH || pathname === `${PLAY_PATH}/`;
}

function navigateToPlay() {
  if (!isPlayRoute()) {
    window.location.replace(PLAY_PATH);
  }
}

function navigateToEntry() {
  if (isPlayRoute()) {
    window.location.replace(ENTRY_PATH);
  }
}

const PHASE_TEXT = {
  lobby: "대기",
  discussion: "발언",
  break: "수다",
  vote: "투표",
  "final-guess": "최종 추리",
  result: "결과"
};

const VOTE_MODE_TEXT = {
  single: "최종 지목",
  elimination: "라운드별 지목"
};

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function currentName() {
  return elements.nameInput.value.trim();
}

function currentRoomInput() {
  return elements.roomInput.value.trim().toUpperCase();
}

function currentSettings() {
  return {
    discussionRounds: Number(elements.discussionRoundsInput.value),
    breakSeconds: Number(elements.breakSecondsInput.value),
    liarCount: Number(elements.liarCountInput.value),
    voteMode: elements.voteModeInput.value
  };
}

function rememberSessionRoom(roomCode = state.roomCode, name = currentName()) {
  appSession.rememberRoom(state.room?.me?.name || name, roomCode);
}

function playerNameById(id) {
  return state.room?.players.find((player) => player.id === id)?.name || "-";
}

function playerNamesByIds(ids) {
  const names = ids.map((id) => playerNameById(id)).filter((name) => name !== "-");

  return names.length ? names.join(", ") : "-";
}

function resultLiarIds(result) {
  if (Array.isArray(result?.liarIds)) {
    return result.liarIds;
  }

  return result?.liarId ? [result.liarId] : [];
}

function setEntryStatus(text) {
  elements.entryStatus.textContent = text || "";
}

function setFlashStatus(text) {
  state.flashStatus = text || "";
  renderStatus();
}

function clearFlashStatus() {
  state.flashStatus = "";
  renderStatus();
}

function orderedPlayers(room) {
  const players = [...room.players];
  const myIndex = players.findIndex((player) => player.id === room.me?.id);

  if (myIndex <= 0) {
    return players;
  }

  return [...players.slice(myIndex), ...players.slice(0, myIndex)];
}

function seatPosition(index, total) {
  if (total === 1) {
    return { x: 50, y: 78 };
  }

  if (index === 0) {
    return { x: 50, y: 76 };
  }

  const centerX = 50;
  const centerY = 50;
  const radius = total === 2 ? 34 : total === 3 ? 36 : total <= 5 ? 39 : 41;
  const angle = Math.PI / 2 - index * ((Math.PI * 2) / total);

  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius
  };
}

function mySeatPosition(room) {
  return seatPosition(0, room.players.length);
}

function playerSeatPosition(room, playerId) {
  const players = orderedPlayers(room);
  const index = players.findIndex((player) => player.id === playerId);

  if (index < 0) {
    return null;
  }

  return seatPosition(index, players.length);
}

function formatDuration(totalMs) {
  const totalSeconds = Math.max(Math.ceil(totalMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBreakSeconds(totalSeconds) {
  if (totalSeconds <= 0) {
    return "없음";
  }

  if (totalSeconds % 60 === 0) {
    return `${totalSeconds / 60}분`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}초`;
  }

  return `${minutes}분 ${seconds}초`;
}

function roomSettingsText(room) {
  const liarText = `라이어 ${room.settings.liarCount || 1}명`;

  if (room.settings.voteMode === "elimination") {
    return `라운드별 지목 · ${liarText} · 한 바퀴마다 투표`;
  }

  return `${room.settings.discussionRounds}라운드 · ${liarText} · 수다 ${formatBreakSeconds(room.settings.breakSeconds)} · ${
    VOTE_MODE_TEXT[room.settings.voteMode] || "최종 지목"
  }`;
}

function breakRemainingMs(room) {
  if (room.phase !== "break" || !room.break?.endsAt) {
    return 0;
  }

  return Math.max(room.break.endsAt - Date.now(), 0);
}

function breakCountdownText(room) {
  return formatDuration(breakRemainingMs(room));
}

function briefingTitle(room) {
  if (room.phase === "lobby") {
    return "게임 시작 전";
  }

  if (room.phase === "discussion") {
    return room.discussion.maxRounds
      ? `발언 ${room.discussion.round} / ${room.discussion.maxRounds}`
      : `발언 ${room.discussion.round}`;
  }

  if (room.phase === "break") {
    return "수다 시간";
  }

  if (room.phase === "vote") {
    return "투표";
  }

  if (room.phase === "final-guess") {
    return "최종 추리";
  }

  return "결과";
}

function topicText(room) {
  return room.phase === "lobby" ? "-" : room.topic || "-";
}

function wordText(room) {
  if (room.phase === "lobby") {
    return "-";
  }

  return room.role === "liar" ? "공개되지 않습니다" : room.word || "-";
}

function turnText(room) {
  if (room.phase === "discussion") {
    return `${playerNameById(room.activeTurnPlayer)} 차례`;
  }

  if (room.phase === "break") {
    return `다음 발언까지 ${breakCountdownText(room)}`;
  }

  if (room.phase === "vote") {
    return "투표 진행 중";
  }

  if (room.phase === "final-guess") {
    return "라이어 마지막 추리";
  }

  if (room.phase === "result") {
    return "결과 공개";
  }

  return "시작 대기";
}

function phaseMetaText(room) {
  const activeCount = room.players.filter((player) => !player.isEliminated).length;
  const liarText = `라이어 ${room.settings.liarCount || 1}명`;
  const parts =
    room.settings.voteMode === "elimination"
      ? [`생존 ${activeCount}/${room.players.length}명`, liarText, "라운드별 지목"]
      : [
          `${room.players.length}명`,
          liarText,
          `${room.settings.discussionRounds}라운드`,
          `수다 ${formatBreakSeconds(room.settings.breakSeconds)}`,
          VOTE_MODE_TEXT[room.settings.voteMode] || "최종 지목"
        ];

  if (room.phase === "discussion") {
    parts.push(
      room.discussion.maxRounds
        ? `발언 ${room.discussion.round}/${room.discussion.maxRounds}`
        : `발언 ${room.discussion.round}`
    );
  }

  if (room.phase === "break") {
    parts.push(`다음 ${room.break.nextRound}/${room.discussion.maxRounds}`);
    parts.push(breakCountdownText(room));
  }

  if (room.phase === "vote") {
    parts.push(`투표 ${room.votes.total}/${room.votes.required || room.players.length}`);
  }

  if (room.phase === "final-guess") {
    parts.push("라이어 최종 추리");
  }

  return parts.join(" · ");
}

function derivedStatus(room) {
  if (state.flashStatus) {
    return state.flashStatus;
  }

  if (room.phase === "vote") {
    if (room.votes.submitted) {
      return room.votes.round > 1 ? "재투표를 제출했습니다" : "투표를 제출했습니다";
    }

    return room.votes.round > 1
      ? "동점입니다. 해당 플레이어끼리 재투표하세요"
      : room.settings.voteMode === "elimination"
        ? "라이어 같은 사람을 투표하세요"
        : "목록에서 라이어를 지목하세요";
  }

  if (room.phase === "lobby") {
    if (room.hostId !== room.me.id) {
      return "호스트가 시작할 때까지 기다리세요";
    }

    return room.settings.voteMode === "elimination"
      ? "라운드별 지목은 3명부터 시작할 수 있습니다"
      : `${MIN_PLAYERS}명부터 시작할 수 있습니다`;
  }

  if (room.phase === "discussion") {
    return room.activeTurnPlayer === room.me.id
      ? room.liarGuess.available
        ? state.turnModalMode === "guess"
          ? "답 맞추기에 정답을 입력하세요"
          : state.turnModalMode === "opinion"
            ? "의견 제출에 내용을 입력하세요"
            : "의견 제출 또는 답 맞추기를 고르세요"
        : "발언 팝업에서 내용을 입력하세요"
      : `${playerNameById(room.activeTurnPlayer)} 발언 중`;
  }

  if (room.phase === "break") {
    return `자유 채팅 시간 ${breakCountdownText(room)}`;
  }

  if (room.phase === "vote") {
    return room.votes.submitted
      ? "투표를 제출했습니다"
      : room.settings.voteMode === "elimination"
        ? "라이어 같은 사람을 투표하세요"
        : "목록에서 라이어를 지목하세요";
  }

  if (room.phase === "final-guess") {
    return room.liarGuess.finalAvailable
      ? "지목됐습니다. 마지막 정답을 제출하세요"
      : "라이어가 마지막 정답을 고르는 중";
  }

  return "결과가 공개됐습니다";
}

function seatTags(room, player) {
  const tags = [];

  if (player.id === room.me.id) {
    tags.push("나");
  }

  if (player.isBot) {
    tags.push("BOT");
  }

  if (player.isEliminated) {
    tags.push("탈락");
  }

  if (room.phase === "discussion" && room.activeTurnPlayer === player.id) {
    tags.push("차례");
  }

  if (room.phase === "vote" && room.votes.targetId === player.id) {
    tags.push("선택");
  }

  if ((room.phase === "final-guess" || room.phase === "result") && room.accusedId === player.id) {
    tags.push("지목");
  }

  if (room.phase === "result" && resultLiarIds(room.result).includes(player.id)) {
    tags.push("라이어");
  }

  return tags.join(" · ");
}

function voteCountForPlayer(room, playerId) {
  return Number(room.votes?.counts?.[playerId] || 0);
}

function shouldShowVoteCounts(room) {
  if (!["vote", "final-guess", "result"].includes(room.phase)) {
    return false;
  }

  return Object.values(room.votes?.counts || {}).some((count) => count > 0);
}

function currentChatBubbles(room) {
  const now = Date.now();
  const bubbles = new Map();

  room.messages.forEach((message) => {
    if (message.kind !== "chat") {
      return;
    }

    if (!message.playerId || typeof message.createdAt !== "number") {
      return;
    }

    if (now - message.createdAt > CHAT_BUBBLE_TTL) {
      return;
    }

    const previous = bubbles.get(message.playerId);
    if (!previous || previous.createdAt < message.createdAt) {
      bubbles.set(message.playerId, message);
    }
  });

  return bubbles;
}

function scheduleBubbleRefresh(room) {
  if (state.bubbleTimerId) {
    clearTimeout(state.bubbleTimerId);
    state.bubbleTimerId = null;
  }

  const now = Date.now();
  let nextExpiry = null;

  room.messages.forEach((message) => {
    if (message.kind !== "chat" || typeof message.createdAt !== "number") {
      return;
    }

    const expiry = message.createdAt + CHAT_BUBBLE_TTL;

    if (expiry <= now) {
      return;
    }

    if (nextExpiry === null || expiry < nextExpiry) {
      nextExpiry = expiry;
    }
  });

  if (nextExpiry === null) {
    return;
  }

  state.bubbleTimerId = window.setTimeout(() => {
    renderSeatMap();
    renderSeatChatComposer();

    if (state.room) {
      scheduleBubbleRefresh(state.room);
    }
  }, Math.max(nextExpiry - now, 0) + 20);
}

function schedulePhaseClock(room) {
  if (state.phaseClockTimerId) {
    clearTimeout(state.phaseClockTimerId);
    state.phaseClockTimerId = null;
  }

  if (room.phase !== "break" || !room.break?.endsAt) {
    return;
  }

  const remainingMs = breakRemainingMs(room);

  if (remainingMs <= 0) {
    return;
  }

  state.phaseClockTimerId = window.setTimeout(() => {
    if (!state.room) {
      return;
    }

    renderHeader();
    renderBriefing();
    renderStatus();
    schedulePhaseClock(state.room);
  }, Math.min(remainingMs, 1000));
}

async function sendReaction(targetId, reaction) {
  const response = await emitWithAck("reaction:send", {
    code: state.roomCode,
    targetId,
    reaction
  });

  if (!response?.ok) {
    setFlashStatus(response?.message || "이모지 전송 실패");
    return;
  }

  clearFlashStatus();
}

function renderReactionPicker(room, players) {
  const targetId = state.reactionPickerPlayerId;

  if (!targetId || targetId === room.me.id) {
    return;
  }

  const index = players.findIndex((player) => player.id === targetId);

  if (index < 0) {
    state.reactionPickerPlayerId = null;
    return;
  }

  const position = seatPosition(index, players.length);
  const picker = document.createElement("div");
  picker.className = "reaction-picker";
  picker.style.left = `${position.x}%`;
  picker.style.top = `${position.y}%`;

  if (position.y < 28) {
    picker.classList.add("is-below");
  }

  picker.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  REACTION_OPTIONS.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reaction-button";
    button.textContent = option.emoji;
    button.setAttribute("aria-label", option.label);
    button.addEventListener("click", () => {
      sendReaction(targetId, option.key);
    });
    picker.appendChild(button);
  });

  elements.seatMap.appendChild(picker);
}

function showReactionFlight(payload) {
  if (!state.room || !payload?.fromId || !payload?.targetId || !payload?.emoji) {
    return;
  }

  const fromPosition = playerSeatPosition(state.room, payload.fromId);
  const targetPosition = playerSeatPosition(state.room, payload.targetId);

  if (!fromPosition || !targetPosition) {
    return;
  }

  const reaction = document.createElement("span");
  reaction.className = "reaction-flight";
  reaction.textContent = payload.emoji;
  reaction.style.left = `${fromPosition.x}%`;
  reaction.style.top = `${fromPosition.y}%`;
  elements.seatMap.appendChild(reaction);

  const animation = reaction.animate(
    [
      {
        left: `${fromPosition.x}%`,
        top: `${fromPosition.y}%`,
        opacity: 0,
        transform: "translate(-50%, -50%) scale(0.72)"
      },
      {
        left: `${(fromPosition.x + targetPosition.x) / 2}%`,
        top: `${Math.min(fromPosition.y, targetPosition.y) - 8}%`,
        opacity: 1,
        transform: "translate(-50%, -50%) scale(1.18)"
      },
      {
        left: `${targetPosition.x}%`,
        top: `${targetPosition.y}%`,
        opacity: 0,
        transform: "translate(-50%, -50%) scale(0.88)"
      }
    ],
    {
      duration: REACTION_ANIMATION_TTL,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
    }
  );

  animation.finished
    .catch(() => {})
    .finally(() => {
      reaction.remove();
    });
}

function renderSeatMap() {
  const room = state.room;
  const players = orderedPlayers(room);
  const bubbles = currentChatBubbles(room);
  elements.seatMap.innerHTML = "";

  players.forEach((player, index) => {
    const position = seatPosition(index, players.length);
    const bubble = bubbles.get(player.id);
    const seat = document.createElement("div");
    const isSelf = player.id === room.me.id;
    const isTurn = room.phase === "discussion" && room.activeTurnPlayer === player.id;
    const isSelected = room.phase === "vote" && room.votes.targetId === player.id;
    const isAccused =
      (room.phase === "final-guess" || room.phase === "result") && room.accusedId === player.id;
    const isLiar = room.phase === "result" && resultLiarIds(room.result).includes(player.id);
    const isEliminated = player.isEliminated;
    const voteCount = shouldShowVoteCounts(room) ? voteCountForPlayer(room, player.id) : 0;

    seat.className = "seat";
    seat.style.left = `${position.x}%`;
    seat.style.top = `${position.y}%`;

    if (position.y < 18) {
      seat.classList.add("is-near-top");
    }

    if (isSelf) {
      seat.classList.add("is-self");
    }

    if (isTurn) {
      seat.classList.add("is-turn");
    }

    if (isSelected) {
      seat.classList.add("is-selected");
    }

    if (isAccused) {
      seat.classList.add("is-accused");
    }

    if (isLiar) {
      seat.classList.add("is-liar");
    }

    if (isEliminated) {
      seat.classList.add("is-eliminated");
    }

    seat.innerHTML = `
      <button class="seat-name seat-name-button" type="button" ${
        isSelf ? "disabled" : ""
      }>${escapeHtml(player.name)}</button>
      <span class="seat-meta">${escapeHtml(seatTags(room, player))}</span>
      ${voteCount > 0 ? `<span class="seat-vote-count">🗳 ${voteCount}</span>` : ""}
      ${bubble ? `<span class="chat-bubble">${escapeHtml(bubble.text)}</span>` : ""}
    `;

    const seatNameButton = seat.querySelector(".seat-name-button");

    seatNameButton.addEventListener("click", (event) => {
      event.stopPropagation();

      if (isSelf) {
        return;
      }

      state.reactionPickerPlayerId =
        state.reactionPickerPlayerId === player.id ? null : player.id;
      renderSeatMap();
    });

    elements.seatMap.appendChild(seat);
  });

  renderReactionPicker(room, players);
}

function renderSeatChatComposer() {
  const room = state.room;

  if (!room || room.phase === "lobby" || room.me.isEliminated) {
    elements.seatChatComposer.hidden = true;
    return;
  }

  const position = mySeatPosition(room);
  elements.seatChatComposer.hidden = false;
  elements.seatChatComposer.style.left = `${position.x}%`;
  elements.seatChatComposer.style.top = "auto";
  elements.seatChatComposer.style.bottom = "16px";
}

function renderMessages() {
  const room = state.room;
  const turnMessages = room.messages.filter((message) => message.kind === "turn");
  elements.messageList.innerHTML = "";

  if (!turnMessages.length) {
    const item = document.createElement("li");
    item.className = "message-item";
    item.innerHTML = `
      <div class="message-head">
        <span class="message-name">LOG</span>
        <span class="message-kind">-</span>
      </div>
      <div class="message-text">-</div>
    `;
    elements.messageList.appendChild(item);
    return;
  }

  turnMessages.forEach((message) => {
    const item = document.createElement("li");
    item.className = "message-item";
    item.innerHTML = `
      <div class="message-head">
        <span class="message-name">${escapeHtml(message.name)}</span>
        <span class="message-kind">TURN ${escapeHtml(message.round || "-")}</span>
      </div>
      <div class="message-text">${escapeHtml(message.text)}</div>
    `;
    elements.messageList.appendChild(item);
  });

  const feed = elements.messageList.parentElement;
  feed.scrollTop = feed.scrollHeight;
}

function renderChatLog() {
  const room = state.room;
  const chatMessages = room.messages.filter((message) => message.kind === "chat");
  elements.chatLogList.innerHTML = "";

  if (!chatMessages.length) {
    const item = document.createElement("li");
    item.className = "message-item";
    item.innerHTML = `
      <div class="message-head">
        <span class="message-name">CHAT</span>
        <span class="message-kind">-</span>
      </div>
      <div class="message-text">-</div>
    `;
    elements.chatLogList.appendChild(item);
    return;
  }

  chatMessages.forEach((message) => {
    const item = document.createElement("li");
    item.className = "message-item";
    item.innerHTML = `
      <div class="message-head">
        <span class="message-name">${escapeHtml(message.name)}</span>
        <span class="message-kind">CHAT</span>
      </div>
      <div class="message-text">${escapeHtml(message.text)}</div>
    `;
    elements.chatLogList.appendChild(item);
  });

  const feed = elements.chatLogList.parentElement;
  feed.scrollTop = feed.scrollHeight;
}

function renderVoteList() {
  const room = state.room;
  const visible = room.phase === "vote";
  elements.voteArea.hidden = !visible;

  if (!visible) {
    elements.voteList.innerHTML = "";
    return;
  }

  elements.voteTitle.textContent = room.votes.submitted
    ? room.votes.round > 1
      ? "재투표를 제출했습니다"
      : "투표를 제출했습니다"
    : room.votes.round > 1
      ? "동점입니다. 해당 플레이어끼리 재투표하세요"
      : room.settings.voteMode === "elimination"
        ? "라이어 같은 사람을 투표하세요"
        : "의심되는 플레이어를 선택하세요";

  elements.voteList.innerHTML = "";

  if (room.me.isEliminated) {
    elements.voteTitle.textContent = "탈락한 플레이어는 투표할 수 없습니다";
    return;
  }

  orderedPlayers(room)
    .filter(
      (player) =>
        player.id !== room.me.id &&
        !player.isEliminated &&
        (!room.votes.candidateIds || room.votes.candidateIds.includes(player.id))
    )
    .forEach((player) => {
      const button = document.createElement("button");
      const isSelected = room.votes.targetId === player.id;

      button.type = "button";
      button.className = "vote-button";
      button.textContent = player.isBot ? `${player.name} · BOT` : player.name;
      button.disabled = room.votes.submitted;

      if (isSelected) {
        button.classList.add("is-selected");
      }

      button.addEventListener("click", async () => {
        const response = await emitWithAck("vote:submit", {
          code: state.roomCode,
          targetId: player.id
        });

        if (!response?.ok) {
          setFlashStatus(response?.message || "투표 실패");
          return;
        }

        clearFlashStatus();
      });

      elements.voteList.appendChild(button);
    });
}

function renderStatus() {
  if (!state.room) {
    elements.globalStatus.textContent = "";
    return;
  }

  elements.globalStatus.textContent = derivedStatus(state.room);
}

function renderResult() {
  const room = state.room;
  const visible = room.phase === "result" && room.result;
  elements.resultPanel.hidden = !visible;

  if (!visible) {
    return;
  }

  const result = room.result;
  elements.winnerLabel.textContent = result.winner === "liar" ? "라이어" : "시민";
  elements.answerLabel.textContent = result.word || "-";
  elements.liarLabel.textContent = playerNamesByIds(resultLiarIds(result));
  elements.accusedLabel.textContent = result.accusedId ? playerNameById(result.accusedId) : "-";
  elements.guessLabel.textContent = result.guess || "-";
  elements.reasonLabel.textContent = result.reason || "-";
}

function shouldShowRoleModal(room) {
  return (
    room.phase !== "lobby" &&
    room.phase !== "result" &&
    state.roleModalRound === room.round &&
    state.dismissedRoleModalRound !== room.round
  );
}

function currentTurnModalKey(room) {
  if (room.phase !== "discussion" || room.activeTurnPlayer !== room.me.id) {
    return null;
  }

  return [
    room.round,
    room.discussion.round,
    room.turnIndex,
    room.activeTurnPlayer,
    room.liarGuess.available ? "guess" : "opinion"
  ].join(":");
}

function syncTurnModalMode(room) {
  const nextKey = currentTurnModalKey(room);

  if (!nextKey) {
    state.turnModalKey = null;
    state.turnModalMode = null;
    return;
  }

  if (state.turnModalKey !== nextKey) {
    state.turnModalKey = nextKey;
    state.turnModalMode = room.liarGuess.available ? null : "opinion";
    return;
  }

  if (!room.liarGuess.available) {
    state.turnModalMode = "opinion";
  }
}

function renderControls() {
  const room = state.room;
  const isHost = room.hostId === room.me.id;
  const isMyTurn = room.phase === "discussion" && room.activeTurnPlayer === room.me.id;
  const canTurnGuess = room.liarGuess.available;
  const canFinalGuess = room.liarGuess.finalAvailable;
  const isEliminated = room.me.isEliminated;
  const showTurnModal = isMyTurn && !shouldShowRoleModal(room);
  const showTurnModePicker = showTurnModal && canTurnGuess;
  const showOpinionSection = showTurnModal && (!canTurnGuess || state.turnModalMode === "opinion");
  const showGuessSection = showTurnModal && canTurnGuess && state.turnModalMode === "guess";

  elements.startRoundButton.hidden = !(isHost && room.phase === "lobby");
  elements.resetRoundButton.hidden = !(isHost && room.phase === "result");

  elements.chatInput.disabled = room.phase === "lobby" || isEliminated;
  elements.sendChatButton.disabled = room.phase === "lobby" || isEliminated;

  elements.turnModal.hidden = !showTurnModal;
  elements.turnModalCurrentLabel.textContent = turnText(room);
  elements.turnModePicker.hidden = !showTurnModePicker;
  elements.turnOpinionSection.hidden = !showOpinionSection;
  elements.turnGuessSection.hidden = !showGuessSection;
  elements.opinionInput.disabled = !showOpinionSection;
  elements.sendOpinionButton.disabled = !showOpinionSection;
  elements.turnGuessInput.disabled = !showGuessSection;
  elements.submitTurnGuessButton.disabled = !showGuessSection;
  elements.selectOpinionModeButton.classList.toggle("is-active", state.turnModalMode === "opinion");
  elements.selectGuessModeButton.classList.toggle("is-active", state.turnModalMode === "guess");
  elements.selectOpinionModeButton.disabled = !showTurnModePicker;
  elements.selectGuessModeButton.disabled = !showTurnModePicker;
  elements.finalGuessModal.hidden = !canFinalGuess;
  elements.finalGuessInput.disabled = !canFinalGuess;
  elements.submitFinalGuessButton.disabled = !canFinalGuess;
}

function renderHeader() {
  const room = state.room;
  elements.roomBadge.textContent = room.code;
  elements.phaseBadge.textContent = PHASE_TEXT[room.phase] || "-";
  elements.roundBadge.textContent = `ROUND ${room.round || 0}`;
  elements.phaseMeta.textContent = phaseMetaText(room);
}

function renderBriefing() {
  const room = state.room;
  elements.roleLabel.textContent = briefingTitle(room);
  elements.topicLabel.textContent = topicText(room);
  elements.wordLabel.textContent = wordText(room);
  elements.turnLabel.textContent = turnText(room);
  elements.settingsLabel.textContent = roomSettingsText(room);
}

function modalWordText(room) {
  return room.role === "liar" ? "공개되지 않습니다" : room.word || "-";
}

function renderRoleModal() {
  if (!state.room) {
    elements.roleModal.hidden = true;
    return;
  }

  const room = state.room;
  elements.roleModal.hidden = !shouldShowRoleModal(room);
  elements.modalRoleTitle.textContent =
    room.role === "liar" ? "당신은 라이어입니다" : "당신은 라이어가 아닙니다";
  elements.modalTopicLabel.textContent = topicText(room);
  elements.modalWordLabel.textContent = modalWordText(room);
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
  renderBriefing();
  renderSeatMap();
  renderSeatChatComposer();
  renderChatLog();
  renderMessages();
  renderVoteList();
  renderStatus();
  renderControls();
  renderResult();
  renderRoleModal();
  scheduleBubbleRefresh(state.room);
  schedulePhaseClock(state.room);
}

function resetLocalRoomState(message = "방을 나갔습니다") {
  appSession.clearRoom();

  if (state.bubbleTimerId) {
    clearTimeout(state.bubbleTimerId);
    state.bubbleTimerId = null;
  }

  if (state.phaseClockTimerId) {
    clearTimeout(state.phaseClockTimerId);
    state.phaseClockTimerId = null;
  }

  state.room = null;
  state.roomCode = "";
  state.flashStatus = "";
  state.roleModalRound = null;
  state.dismissedRoleModalRound = null;
  state.turnModalMode = null;
  state.turnModalKey = null;
  state.reactionPickerPlayerId = null;
  elements.roomInput.value = "";
  elements.turnModal.hidden = true;
  elements.finalGuessModal.hidden = true;
  elements.roleModal.hidden = true;
  renderRoom();
  setEntryStatus(message);
  navigateToEntry();
}

async function createRoom() {
  const response = await emitWithAck("room:create", {
    name: currentName(),
    settings: currentSettings()
  });

  if (!response?.ok) {
    setEntryStatus(response?.message || "실패");
    return;
  }

  state.roomCode = response.code;
  elements.roomInput.value = response.code;
  rememberSessionRoom(response.code);
  setEntryStatus("");
  navigateToPlay();
}

async function submitLiarGuess(value, fallbackMessage) {
  const response = await emitWithAck("liar:guess", {
    code: state.roomCode,
    guess: value
  });

  if (!response?.ok) {
    setFlashStatus(response?.message || fallbackMessage);
    return false;
  }

  clearFlashStatus();
  return true;
}

async function joinRoom() {
  const response = await emitWithAck("room:join", {
    code: currentRoomInput(),
    name: currentName()
  });

  if (!response?.ok) {
    setEntryStatus(response?.message || "실패");
    return;
  }

  state.roomCode = response.code;
  rememberSessionRoom(response.code);
  setEntryStatus("");
  navigateToPlay();
}

async function leaveRoom() {
  const response = await emitWithAck("room:leave", {
    code: state.roomCode
  });

  if (!response?.ok) {
    setFlashStatus(response?.message || "방 나가기에 실패했습니다");
    return;
  }

  resetLocalRoomState();
}

async function restoreSavedRoom() {
  if (state.restoreAttempted || state.room) {
    return;
  }

  const saved = appSession.getSavedRoom();
  if (!isPlayRoute()) {
    return;
  }

  if (!saved?.roomCode) {
    navigateToEntry();
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
    navigateToEntry();
  } else {
    state.roomCode = response.code;
    rememberSessionRoom(response.code, currentName());
  }
}

socket.on("room:update", (room) => {
  const previousRound = state.room?.round || null;

  clearFlashStatus();
  state.room = room;
  state.roomCode = room.code;
  rememberSessionRoom(room.code, room.me?.name || currentName());
  syncTurnModalMode(room);

  if (room.phase !== "lobby" && room.phase !== "result" && room.round !== previousRound) {
    state.roleModalRound = room.round;
    state.dismissedRoleModalRound = null;
  }

  if (room.phase === "lobby") {
    state.roleModalRound = null;
    state.dismissedRoleModalRound = null;
  }

  if (room.phase !== "discussion" || room.activeTurnPlayer !== room.me.id) {
    elements.opinionInput.value = "";
  }

  if (!room.liarGuess.available) {
    elements.turnGuessInput.value = "";
  }

  if (!room.liarGuess.finalAvailable) {
    elements.finalGuessInput.value = "";
  }

  renderRoom();
});

socket.on("connect", () => {
  if (!state.room) {
    return;
  }

  clearFlashStatus();
  renderStatus();
});

socket.on("reaction:show", (payload) => {
  showReactionFlight(payload);
});

elements.createRoomButton.addEventListener("click", createRoom);
elements.joinRoomButton.addEventListener("click", joinRoom);
elements.leaveButton.addEventListener("click", leaveRoom);
elements.seatMap.addEventListener("click", () => {
  if (!state.reactionPickerPlayerId) {
    return;
  }

  state.reactionPickerPlayerId = null;
  renderSeatMap();
});
elements.selectOpinionModeButton.addEventListener("click", () => {
  state.turnModalMode = "opinion";
  renderControls();
  renderStatus();
});
elements.selectGuessModeButton.addEventListener("click", () => {
  state.turnModalMode = "guess";
  renderControls();
  renderStatus();
});

elements.startRoundButton.addEventListener("click", async () => {
  const response = await emitWithAck("round:start", { code: state.roomCode });

  if (!response?.ok) {
    setFlashStatus(response?.message || "시작 실패");
    return;
  }

  clearFlashStatus();
});

elements.resetRoundButton.addEventListener("click", async () => {
  const response = await emitWithAck("round:reset", { code: state.roomCode });

  if (!response?.ok) {
    setFlashStatus(response?.message || "초기화 실패");
    return;
  }

  clearFlashStatus();
});

elements.sendChatButton.addEventListener("click", async () => {
  const response = await emitWithAck("chat:send", {
    code: state.roomCode,
    text: elements.chatInput.value
  });

  if (!response?.ok) {
    setFlashStatus(response?.message || "채팅 전송 실패");
    return;
  }

  elements.chatInput.value = "";
  clearFlashStatus();
});

elements.sendOpinionButton.addEventListener("click", async () => {
  const response = await emitWithAck("discussion:submit", {
    code: state.roomCode,
    text: elements.opinionInput.value
  });

  if (!response?.ok) {
    setFlashStatus(response?.message || "발언 전송 실패");
    return;
  }

  elements.opinionInput.value = "";
  clearFlashStatus();
});

elements.submitTurnGuessButton.addEventListener("click", async () => {
  const ok = await submitLiarGuess(elements.turnGuessInput.value, "답 맞추기 실패");

  if (!ok) {
    return;
  }

  elements.turnGuessInput.value = "";
});

elements.submitFinalGuessButton.addEventListener("click", async () => {
  const ok = await submitLiarGuess(elements.finalGuessInput.value, "답 맞추기 실패");

  if (!ok) {
    return;
  }

  elements.finalGuessInput.value = "";
});

elements.closeRoleModalButton.addEventListener("click", () => {
  if (!state.room) {
    return;
  }

  state.dismissedRoleModalRound = state.room.round;
  renderRoleModal();
  renderControls();
});

elements.nameInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  if (currentRoomInput()) {
    joinRoom();
    return;
  }

  createRoom();
});

elements.roomInput.addEventListener("input", () => {
  elements.roomInput.value = currentRoomInput();
});

elements.roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom();
  }
});

elements.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    elements.sendChatButton.click();
  }
});

elements.opinionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    elements.sendOpinionButton.click();
  }
});

elements.turnGuessInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    elements.submitTurnGuessButton.click();
  }
});

elements.finalGuessInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    elements.submitFinalGuessButton.click();
  }
});

renderRoom();

if (socket.connected) {
  restoreSavedRoom();
} else {
  socket.on("connect", restoreSavedRoom);
}
