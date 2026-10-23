const { createClient } = require("redis");

let redisClient = null;
let isConnected = false;
let hasWarnedError = false;

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

function initRedisClient() {
  if (redisClient) return redisClient;

  redisClient = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 4000,
      reconnectStrategy: (retries) => {
        if (retries > 3) {
          if (!hasWarnedError) {
            console.warn("ℹ️ [Redis] Local Redis server not detected. Continuing with MongoDB fallback.");
            hasWarnedError = true;
          }
          return false;
        }
        return Math.min(retries * 500, 2000);
      },
    },
  });

  redisClient.on("connect", () => {
    console.log("🔄 [Redis] Connecting to Redis...");
  });

  redisClient.on("ready", () => {
    isConnected = true;
    hasWarnedError = false;
    console.log("✅ [Redis] Connected successfully to", redisUrl.replace(/\/\/[^@]*@/, "//***@"));
  });

  redisClient.on("error", (err) => {
    isConnected = false;
    if (!hasWarnedError) {
      console.warn(`⚠️ [Redis] Connection notice (${err.code || err.message}). Operating in MongoDB fallback mode.`);
      hasWarnedError = true;
    }
  });

  redisClient.on("end", () => {
    isConnected = false;
  });

  return redisClient;
}

const connectRedis = async () => {
  if (process.env.REDIS_ENABLED === "false") {
    console.log("ℹ️ [Redis] REDIS_ENABLED=false. Operating in pure MongoDB mode.");
    return null;
  }

  const client = initRedisClient();
  try {
    await client.connect();
    return client;
  } catch (error) {
    if (!hasWarnedError) {
      console.warn(`⚠️ [Redis] Initial connection notice (${error.message}). Operating in MongoDB fallback mode.`);
      hasWarnedError = true;
    }
    return null;
  }
};

const isRedisAvailable = () => {
  return Boolean(redisClient && redisClient.isReady && isConnected);
};

const getRedisClient = () => {
  return redisClient;
};

const quitRedis = async () => {
  if (redisClient && redisClient.isOpen) {
    try {
      await redisClient.quit();
      console.log("🛑 [Redis] Disconnected cleanly.");
    } catch (e) {
      console.warn("⚠️ [Redis] Error during quit:", e.message);
    }
  }
};

module.exports = {
  connectRedis,
  isRedisAvailable,
  getRedisClient,
  quitRedis,
};
