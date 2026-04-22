const { getRedisClient, isRedisConfigured } = require("./redis-client");

const DEFAULT_ROOM_TTL_SECONDS = Math.max(
  3600,
  Number.parseInt(process.env.ROOM_STORE_TTL_SECONDS, 10) || 60 * 60 * 24 * 7
);

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase();
}

function snapshotRoom(room, runtimeState = {}) {
  return JSON.parse(JSON.stringify({ ...room, ...runtimeState }));
}

function createRoomStore({ gameKey, serializeRoom = (room) => room, ttlSeconds = DEFAULT_ROOM_TTL_SECONDS }) {
  const indexKey = `gamebni:rooms:${gameKey}`;
  let queue = Promise.resolve();

  function roomKey(code) {
    return `${indexKey}:${normalizeRoomCode(code)}`;
  }

  function enqueue(task) {
    queue = queue
      .then(async () => {
        const client = await getRedisClient();
        if (!client) {
          return null;
        }

        return task(client);
      })
      .catch((error) => {
        console.error(`[room-store:${gameKey}]`, error);
        return null;
      });

    return queue;
  }

  async function restoreAll() {
    let client;

    try {
      client = await getRedisClient();
    } catch (error) {
      console.error(`[room-store:${gameKey}] restore skipped`, error);
      return [];
    }

    if (!client) {
      return [];
    }

    try {
      const codes = (await client.sMembers(indexKey))
        .map(normalizeRoomCode)
        .filter(Boolean);
      const snapshots = [];
      const missingCodes = [];

      for (const code of codes) {
        const raw = await client.get(roomKey(code));
        if (!raw) {
          missingCodes.push(code);
          continue;
        }

        try {
          snapshots.push(JSON.parse(raw));
        } catch (error) {
          console.error(`[room-store:${gameKey}] invalid snapshot for ${code}`, error);
          missingCodes.push(code);
        }
      }

      if (missingCodes.length) {
        await client.sRem(indexKey, ...missingCodes);
      }

      return snapshots;
    } catch (error) {
      console.error(`[room-store:${gameKey}] restore failed`, error);
      return [];
    }
  }

  function save(room) {
    const code = normalizeRoomCode(room?.code);
    if (!code) {
      return Promise.resolve(null);
    }

    const payload = {
      ...serializeRoom(room),
      code,
      updatedAt: Date.now()
    };

    return enqueue(async (client) => {
      await client.set(roomKey(code), JSON.stringify(payload), {
        EX: ttlSeconds
      });
      await client.sAdd(indexKey, code);
      return code;
    });
  }

  function remove(code) {
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      return Promise.resolve(null);
    }

    return enqueue(async (client) => {
      await client.del(roomKey(normalized));
      await client.sRem(indexKey, normalized);
      return normalized;
    });
  }

  async function flushPending() {
    await queue;
  }

  return {
    flushPending,
    isEnabled: isRedisConfigured(),
    remove,
    restoreAll,
    save
  };
}

module.exports = {
  createRoomStore,
  normalizeRoomCode,
  snapshotRoom
};
