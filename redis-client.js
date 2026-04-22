const { createClient } = require("redis");

let redisClientPromise = null;
let redisClient = null;
const REDIS_CONNECT_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 10) || 5000
);
const REDIS_RECONNECT_MAX_RETRIES = Math.max(
  0,
  Number.parseInt(process.env.REDIS_RECONNECT_MAX_RETRIES, 10) || 3
);
const REDIS_RECONNECT_BASE_DELAY_MS = Math.max(
  100,
  Number.parseInt(process.env.REDIS_RECONNECT_BASE_DELAY_MS, 10) || 250
);

function isRedisConfigured() {
  return Boolean(String(process.env.REDIS_URL || "").trim());
}

async function getRedisClient() {
  if (!isRedisConfigured()) {
    return null;
  }

  if (!redisClientPromise) {
    const client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        reconnectStrategy(retries, cause) {
          if (retries >= REDIS_RECONNECT_MAX_RETRIES) {
            return new Error(
              cause?.message
                ? `Redis reconnect retries exhausted: ${cause.message}`
                : "Redis reconnect retries exhausted"
            );
          }

          return Math.min(REDIS_RECONNECT_BASE_DELAY_MS * (retries + 1), 2000);
        }
      }
    });

    client.on("error", (error) => {
      console.error("[redis] client error", error);
    });

    client.on("ready", () => {
      console.log("[redis] client ready");
    });

    client.on("reconnecting", () => {
      console.warn("[redis] reconnecting");
    });

    client.on("end", () => {
      redisClient = null;
      redisClientPromise = null;
      console.warn("[redis] connection closed");
    });

    redisClientPromise = client
      .connect()
      .then(() => {
        redisClient = client;
        return client;
      })
      .catch((error) => {
        redisClient = null;
        redisClientPromise = null;
        throw error;
      });
  }

  return redisClientPromise;
}

async function closeRedisClient() {
  if (!redisClientPromise) {
    return;
  }

  try {
    const client = await redisClientPromise;
    if (client?.isOpen) {
      await client.quit();
    }
  } finally {
    redisClient = null;
    redisClientPromise = null;
  }
}

module.exports = {
  closeRedisClient,
  getRedisClient,
  isRedisConfigured
};
