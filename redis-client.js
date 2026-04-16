const { createClient } = require("redis");

let redisClientPromise = null;
let redisClient = null;

function isRedisConfigured() {
  return Boolean(String(process.env.REDIS_URL || "").trim());
}

async function getRedisClient() {
  if (!isRedisConfigured()) {
    return null;
  }

  if (!redisClientPromise) {
    const client = createClient({
      url: process.env.REDIS_URL
    });

    client.on("error", (error) => {
      console.error("[redis] client error", error);
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
