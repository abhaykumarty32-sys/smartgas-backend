const cacheService = require("../services/cacheService");
const { getAlertState, THRESHOLDS } = require("../config/thresholds");

describe("Thresholds Business Logic", () => {
  test("correctly categorizes Normal gas levels (<= 500)", () => {
    expect(getAlertState(0)).toBe("Normal");
    expect(getAlertState(250)).toBe("Normal");
    expect(getAlertState(500)).toBe("Normal");
  });

  test("correctly categorizes Warning gas levels (501 to 899)", () => {
    expect(getAlertState(501)).toBe("Warning");
    expect(getAlertState(750)).toBe("Warning");
    expect(getAlertState(899)).toBe("Warning");
  });

  test("correctly categorizes Critical gas levels (>= 900)", () => {
    expect(getAlertState(900)).toBe("Critical");
    expect(getAlertState(1200)).toBe("Critical");
  });
});

describe("CacheService (Resilient Fallback & Key Operations)", () => {
  const testDeviceId = "TEST_DEV_001";
  const testUserId = "user_12345";

  beforeEach(() => {
    cacheService._memoryCache.deviceLatest.clear();
    cacheService._memoryCache.userDevices.clear();
    cacheService._memoryCache.alertCycles.clear();
    cacheService._memoryCache.commandLocks.clear();
  });

  test("sets and gets device latest telemetry", async () => {
    const payload = {
      gas: 220,
      temperature: 25.5,
      relay: false,
      valve: true,
      mode: "AUTO",
      status: "online",
      lastTelemetryAt: new Date().toISOString(),
    };

    await cacheService.setDeviceLatest(testDeviceId, payload);
    const retrieved = await cacheService.getDeviceLatest(testDeviceId);

    expect(retrieved).not.toBeNull();
    expect(retrieved.gas).toBe(220);
    expect(retrieved.temperature).toBe(25.5);
    expect(retrieved.mode).toBe("AUTO");
  });

  test("rejects out-of-order older telemetry updates", async () => {
    const newerDate = new Date("2026-10-23T10:00:00Z");
    const olderDate = new Date("2026-10-23T09:59:00Z");

    await cacheService.setDeviceLatest(testDeviceId, {
      gas: 300,
      lastTelemetryAt: newerDate.toISOString(),
    });

    await cacheService.setDeviceLatest(testDeviceId, {
      gas: 150,
      lastTelemetryAt: olderDate.toISOString(),
    });

    const retrieved = await cacheService.getDeviceLatest(testDeviceId);
    expect(retrieved.gas).toBe(300);
  });

  test("caches and invalidates user devices list", async () => {
    const devicesList = [
      { deviceId: "DEV_1", deviceName: "Kitchen Sensor" },
      { deviceId: "DEV_2", deviceName: "Balcony Sensor" },
    ];

    await cacheService.setUserDevices(testUserId, devicesList);
    const cached = await cacheService.getUserDevices(testUserId);
    expect(cached).toHaveLength(2);
    expect(cached[0].deviceName).toBe("Kitchen Sensor");

    await cacheService.invalidateUserDevices(testUserId);
    const afterInvalidate = await cacheService.getUserDevices(testUserId);
    expect(afterInvalidate).toBeNull();
  });

  test("handles alert cycle deduplication and reset", async () => {
    let inCycle = await cacheService.isAlertInCycle(testDeviceId, "warning");
    expect(inCycle).toBe(false);

    await cacheService.setAlertInCycle(testDeviceId, "warning");
    inCycle = await cacheService.isAlertInCycle(testDeviceId, "warning");
    expect(inCycle).toBe(true);

    await cacheService.clearAlertCycles(testDeviceId);
    inCycle = await cacheService.isAlertInCycle(testDeviceId, "warning");
    expect(inCycle).toBe(false);
  });

  test("handles command locks to prevent duplicate concurrent actions", async () => {
    const lock1 = await cacheService.acquireCommandLock(testDeviceId, "valve-close", 5);
    expect(lock1).toBe(true);

    const lock2 = await cacheService.acquireCommandLock(testDeviceId, "valve-open", 5);
    expect(lock2).toBe(false);

    const isLocked = await cacheService.isCommandLocked(testDeviceId);
    expect(isLocked).toBe(true);

    await cacheService.releaseCommandLock(testDeviceId);

    const afterRelease = await cacheService.isCommandLocked(testDeviceId);
    expect(afterRelease).toBe(false);

    const lock3 = await cacheService.acquireCommandLock(testDeviceId, "valve-open", 5);
    expect(lock3).toBe(true);
  });
});
