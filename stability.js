const { randomUUID } = require("crypto");

const DEFAULT_DISCONNECT_GRACE_MS = Math.max(
  5000,
  Number.parseInt(process.env.DISCONNECT_GRACE_MS, 10) || 90000
);

function normalizePlayerSessionId(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,120}$/.test(normalized) ? normalized : null;
}

function createPlayerSessionId() {
  return `player_${randomUUID().replace(/-/g, "")}`;
}

function registerSessionNamespace(namespace) {
  namespace.use((socket, next) => {
    socket.data.playerSessionId =
      normalizePlayerSessionId(socket.handshake?.auth?.playerSessionId) || createPlayerSessionId();
    next();
  });
}

function getSocketPlayerId(socket) {
  return socket?.data?.playerSessionId || null;
}

function createPresenceState(socketId = null) {
  return {
    socketId: socketId || null,
    disconnectedAt: null,
    disconnectDeadlineAt: null
  };
}

function cancelDisconnect(disconnectTimers, playerId) {
  const timer = disconnectTimers.get(playerId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  disconnectTimers.delete(playerId);
}

function bindPlayerSocket(namespace, player, socket, disconnectTimers) {
  cancelDisconnect(disconnectTimers, player.id);

  if (player.socketId && player.socketId !== socket.id) {
    const previousSocket = namespace.sockets.get(player.socketId);
    if (previousSocket) {
      previousSocket.leave(player.id);
    }
  }

  player.socketId = socket.id;
  player.disconnectedAt = null;
  player.disconnectDeadlineAt = null;
  socket.data.playerId = player.id;
  socket.join(player.id);
}

function schedulePlayerDisconnect(player, disconnectTimers, onExpire, graceMs = DEFAULT_DISCONNECT_GRACE_MS) {
  cancelDisconnect(disconnectTimers, player.id);

  const now = Date.now();
  player.socketId = null;
  player.disconnectedAt = now;
  player.disconnectDeadlineAt = now + graceMs;

  const timer = setTimeout(() => {
    disconnectTimers.delete(player.id);
    onExpire(player.id);
  }, graceMs);

  disconnectTimers.set(player.id, timer);
}

function restoreRoomPresence(room, disconnectTimers, onExpire, graceMs = DEFAULT_DISCONNECT_GRACE_MS) {
  const now = Date.now();

  (room?.players || []).forEach((player) => {
    cancelDisconnect(disconnectTimers, player.id);

    if (player.isBot) {
      player.socketId = null;
      player.disconnectedAt = null;
      player.disconnectDeadlineAt = null;
      return;
    }

    player.socketId = null;

    if (!Number.isFinite(player.disconnectDeadlineAt) || player.disconnectDeadlineAt <= now) {
      player.disconnectedAt = now;
      player.disconnectDeadlineAt = now + graceMs;
    } else if (!Number.isFinite(player.disconnectedAt)) {
      player.disconnectedAt = Math.max(now - graceMs, 0);
    }

    const remainingMs = Math.max(player.disconnectDeadlineAt - now, 0);
    const timer = setTimeout(() => {
      disconnectTimers.delete(player.id);
      onExpire(player.id);
    }, remainingMs);

    disconnectTimers.set(player.id, timer);
  });
}

function isPlayerConnected(player) {
  return Boolean(player?.isBot || player?.socketId);
}

function getDisconnectGraceMs() {
  return DEFAULT_DISCONNECT_GRACE_MS;
}

module.exports = {
  bindPlayerSocket,
  cancelDisconnect,
  createPresenceState,
  getDisconnectGraceMs,
  getSocketPlayerId,
  isPlayerConnected,
  registerSessionNamespace,
  restoreRoomPresence,
  schedulePlayerDisconnect
};
