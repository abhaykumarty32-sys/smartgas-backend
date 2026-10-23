jest.mock("expo-server-sdk", () => ({
  Expo: jest.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock("../mqtt/mqttPublisher", () => ({
  publishCommand: jest.fn().mockResolvedValue(true),
  isPublisherConnected: jest.fn().mockReturnValue(true),
}));

const request = require("supertest");
const app = require("../app");

describe("Health Route API", () => {
  test("GET /api/health responds with JSON including service status", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("services");
    expect(res.body.services).toHaveProperty("server", "healthy");
    expect(res.body.services).toHaveProperty("mongodb");
    expect(res.body.services).toHaveProperty("redis");
  });

  test("GET /health also responds with health status", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toHaveProperty("status");
  });
});
