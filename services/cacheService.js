const { getRedisClient, isRedisAvailable } = require("../config/redis");

const memoryCache = {
  deviceLatest: new Map(),
  userDevices: new Map(),
  alertCycles: new Map(),
  commandLocks: new Map(),
};

const CACHE_TTL = {
  DEVICE_LATEST: 86400,
  USER_DEVICES: 120,
  ALERT_CYCLE: 86400,
  COMMAND_LOCK: 10,
};

const keyDeviceLatest = (deviceId) => `device:${deviceId}:latest`;
const keyUserDevices = (userId) => `user:${userId}:devices`;
const keyAlertCycle = (deviceId, level) => `alert:cycle:${deviceId}:${level}`;
const keyCommandLock = (deviceId) => `command:lock:${deviceId}`;

async function setDeviceLatest(deviceId, telemetryData) {
  if (!deviceId || !telemetryData) return;

  const nowMs = telemetryData.lastTelemetryAt
    ? new Date(telemetryData.lastTelemetryAt).getTime()
    : Date.now();

  const payload = {
    ...telemetryData,
    deviceId,
    lastTelemetryAt: new Date(nowMs).toISOString(),
    _timestampMs: nowMs,
  };

  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      const key = keyDeviceLatest(deviceId);
      const existingRaw = await client.get(key);
      if (existingRaw) {
        try {
          const existing = JSON.parse(existingRaw);
          if (existing && existing._timestampMs && existing._timestampMs > nowMs) {
            return;
          }
        } catch (_) {}
      }
      await client.set(key, JSON.stringify(payload), { EX: CACHE_TTL.DEVICE_LATEST });
      return;
    } catch (err) {
      console.warn(`[CacheService] setDeviceLatest Redis error: ${err.message}`);
    }
  }

  const existing = memoryCache.deviceLatest.get(deviceId);
  if (!existing || existing._timestampMs <= nowMs) {
    memoryCache.deviceLatest.set(deviceId, payload);
  }
}

async function getDeviceLatest(deviceId) {
  if (!deviceId) return null;

  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      const raw = await client.get(keyDeviceLatest(deviceId));
      if (raw) return JSON.parse(raw);
      return null;
    } catch (err) {
      console.warn(`[CacheService] getDeviceLatest Redis error: ${err.message}`);
    }
  }

  return memoryCache.deviceLatest.get(deviceId) || null;
}

async function getUserDevices(userId) {
  if (!userId) return null;

  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      const raw = await client.get(keyUserDevices(userId));
      if (raw) return JSON.parse(raw);
      return null;
    } catch (err) {
      console.warn(`[CacheService] getUserDevices Redis error: ${err.message}`);
    }
  }

  const cached = memoryCache.userDevices.get(String(userId));
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  return null;
}

async function setUserDevices(userId, devices, ttlSeconds = CACHE_TTL.USER_DEVICES) {
  if (!userId || !devices) return;

  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      await client.set(keyUserDevices(userId), JSON.stringify(devices), { EX: ttlSeconds });
      return;
    } catch (err) {
      console.warn(`[CacheService] setUserDevices Redis error: ${err.message}`);
    }
  }

  memoryCache.userDevices.set(String(userId), {
    data: devices,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

async function invalidateUserDevices(userId) {
  if (!userId) return;

  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      await client.del(keyUserDevices(userId));
    } catch (err) {
      console.warn(`[CacheService] invalidateUserDevices Redis error: ${err.message}`);
    }
  }

  memoryCache.userDevices.delete(String(userId));
}

async function isAlertInCycle(deviceId, level) {
  const key = keyAlertCycle(deviceId, String(level).toLowerCase());

  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      const val = await client.get(key);
      return val !== null;
    } catch (err) {
      console.warn(`[CacheService] isAlertInCycle Redis error: ${err.message}`);
    }
  }

  const memVal = memoryCache.alertCycles.get(key);
  return Boolean(memVal && memVal.expiresAt > Date.now());
}

async function setAlertInCycle(deviceId, level, ttlSeconds = CACHE_TTL.ALERT_CYCLE) {
  const key = keyAlertCycle(deviceId, String(level).toLowerCase());

  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      await client.set(key, "1", { EX: ttlSeconds });
      return;
    } catch (err) {
      console.warn(`[CacheService] setAlertInCycle Redis error: ${err.message}`);
    }
  }

  memoryCache.alertCycles.set(key, { active: true, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function clearAlertCycles(deviceId) {
  const warnKey = keyAlertCycle(deviceId, "warning");
  const critKey = keyAlertCycle(deviceId, "critical");

  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      await client.del([warnKey, critKey]);
    } catch (err) {
      console.warn(`[CacheService] clearAlertCycles Redis error: ${err.message}`);
    }
  }

  memoryCache.alertCycles.delete(warnKey);
  memoryCache.alertCycles.delete(critKey);
}

async function acquireCommandLock(deviceId, commandType, ttlSeconds = CACHE_TTL.COMMAND_LOCK) {
  const key = keyCommandLock(deviceId);
  const payload = JSON.stringify({ commandType, acquiredAt: Date.now() });

  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      const result = await client.set(key, payload, { NX: true, EX: ttlSeconds });
      return result === "OK";
    } catch (err) {
      console.warn(`[CacheService] acquireCommandLock Redis error: ${err.message}`);
    }
  }

  const existing = memoryCache.commandLocks.get(deviceId);
  if (existing && existing.expiresAt > Date.now()) {
    return false;
  }

  memoryCache.commandLocks.set(deviceId, {
    commandType,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  return true;
}

async function releaseCommandLock(deviceId) {
  const key = keyCommandLock(deviceId);

  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      await client.del(key);
    } catch (err) {
      console.warn(`[CacheService] releaseCommandLock Redis error: ${err.message}`);
    }
  }

  memoryCache.commandLocks.delete(deviceId);
}

async function isCommandLocked(deviceId) {
  const key = keyCommandLock(deviceId);

  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      const val = await client.get(key);
      return val !== null;
    } catch (err) {
      console.warn(`[CacheService] isCommandLocked Redis error: ${err.message}`);
    }
  }

  const existing = memoryCache.commandLocks.get(deviceId);
  return Boolean(existing && existing.expiresAt > Date.now());
}

module.exports = {
  setDeviceLatest,
  getDeviceLatest,
  getUserDevices,
  setUserDevices,
  invalidateUserDevices,
  isAlertInCycle,
  setAlertInCycle,
  clearAlertCycles,
  acquireCommandLock,
  releaseCommandLock,
  isCommandLocked,
  _memoryCache: memoryCache,
};
