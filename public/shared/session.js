(function attachGamebniSession(global) {
  const STORAGE_PREFIX = "gamebni:session";
  const memoryStore = new Map();

  function getStorage() {
    try {
      const probeKey = `${STORAGE_PREFIX}:probe`;
      global.sessionStorage.setItem(probeKey, "1");
      global.sessionStorage.removeItem(probeKey);
      return global.sessionStorage;
    } catch (_error) {
      return {
        getItem(key) {
          return memoryStore.has(key) ? memoryStore.get(key) : null;
        },
        setItem(key, value) {
          memoryStore.set(key, String(value));
        },
        removeItem(key) {
          memoryStore.delete(key);
        }
      };
    }
  }

  function createId() {
    if (global.crypto?.randomUUID) {
      return global.crypto.randomUUID();
    }

    return `player_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }

  function normalizeRoomCode(value) {
    return String(value || "").trim().toUpperCase();
  }

  function normalizeName(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 32);
  }

  function parseJson(value) {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  function createClient(scope) {
    const storage = getStorage();
    const playerIdKey = `${STORAGE_PREFIX}:${scope}:player-id`;
    const roomKey = `${STORAGE_PREFIX}:${scope}:room`;

    let playerSessionId = storage.getItem(playerIdKey);
    if (!playerSessionId) {
      playerSessionId = createId();
      storage.setItem(playerIdKey, playerSessionId);
    }

    function getSavedRoom() {
      const saved = parseJson(storage.getItem(roomKey)) || {};
      const roomCode = normalizeRoomCode(saved.roomCode);
      const name = normalizeName(saved.name);

      if (!roomCode) {
        return null;
      }

      return {
        roomCode,
        name
      };
    }

    return {
      playerSessionId,
      hydrateEntry({ nameInput, roomInput } = {}) {
        const saved = getSavedRoom();
        if (!saved) {
          return;
        }

        if (nameInput && !nameInput.value.trim() && saved.name) {
          nameInput.value = saved.name;
        }

        if (roomInput && !roomInput.value.trim() && saved.roomCode) {
          roomInput.value = saved.roomCode;
        }
      },
      getSavedRoom,
      rememberRoom(name, roomCode) {
        const normalizedRoomCode = normalizeRoomCode(roomCode);
        if (!normalizedRoomCode) {
          return;
        }

        storage.setItem(
          roomKey,
          JSON.stringify({
            roomCode: normalizedRoomCode,
            name: normalizeName(name)
          })
        );
      },
      clearRoom() {
        storage.removeItem(roomKey);
      }
    };
  }

  global.GamebniSession = {
    createClient
  };
})(window);
