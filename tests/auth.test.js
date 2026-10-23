jest.mock("expo-server-sdk", () => ({
  Expo: jest.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock("../mqtt/mqttPublisher", () => ({
  publishCommand: jest.fn().mockResolvedValue(true),
  isPublisherConnected: jest.fn().mockReturnValue(true),
}));

jest.mock("../services/emailService", () => ({
  sendOTP: jest.fn().mockResolvedValue({ success: true, provider: "resend", messageId: "msg_123" }),
}));

const request = require("supertest");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const app = require("../app");
const User = require("../models/User");
const { sendOTP } = require("../services/emailService");

describe("Authentication & Secure OTP Forgot Password Flow", () => {
  const testUser = {
    _id: "507f1f77bcf86cd799439099",
    name: "Abhay Tester",
    email: "operator@factory.com",
    password: "oldPassword123",
  };

  let mockHashedPassword;

  beforeAll(async () => {
    mockHashedPassword = await bcrypt.hash(testUser.password, 10);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/auth/forgot-password", () => {
    test("rejects request missing email with 400", async () => {
      const res = await request(app).post("/api/auth/forgot-password").send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("protects against email enumeration: returns generic success for unknown emails", async () => {
      jest.spyOn(User, "findOne").mockResolvedValue(null);

      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: "unknown_user@random.com" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(sendOTP).not.toHaveBeenCalled();
    });

    test("enforces 60-second resend cooldown with HTTP 429", async () => {
      const mockDoc = {
        email: testUser.email,
        otpLastSentAt: new Date(Date.now() - 20 * 1000), // 20s ago (< 60s)
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockDoc);

      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: testUser.email });

      expect(res.status).toBe(429);
      expect(res.body.cooldown).toBe(true);
      expect(sendOTP).not.toHaveBeenCalled();
    });

    test("generates secure hashed OTP, saves 10-minute expiry, and dispatches email", async () => {
      const mockDoc = {
        email: testUser.email,
        otp: "",
        otpExpiry: null,
        otpLastSentAt: null,
        otpAttempts: 0,
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockDoc);

      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: testUser.email });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockDoc.save).toHaveBeenCalled();
      // OTP should be hashed (64-char sha256 hex string)
      expect(mockDoc.otp).toHaveLength(64);
      expect(sendOTP).toHaveBeenCalledTimes(1);
    });

    test("handles email delivery failure with HTTP 502", async () => {
      const mockDoc = {
        email: testUser.email,
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockDoc);
      sendOTP.mockResolvedValueOnce({
        success: false,
        error: "SMTP connection timeout on Render port 587",
      });

      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: testUser.email });

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/auth/verify-otp", () => {
    const rawOtp = "654321";
    const hashedOtp = crypto.createHash("sha256").update(rawOtp).digest("hex");

    test("rejects invalid or non-6-digit OTP", async () => {
      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ email: testUser.email, otp: "123" });

      expect(res.status).toBe(400);
    });

    test("rejects expired OTP", async () => {
      const mockDoc = {
        email: testUser.email,
        otp: hashedOtp,
        otpExpiry: new Date(Date.now() - 5000), // expired 5 seconds ago
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockDoc);

      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ email: testUser.email, otp: rawOtp });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/i);
    });

    test("rejects incorrect OTP and increments attempt counter", async () => {
      const mockDoc = {
        email: testUser.email,
        otp: hashedOtp,
        otpExpiry: new Date(Date.now() + 600000),
        otpAttempts: 1,
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockDoc);

      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ email: testUser.email, otp: "999999" });

      expect(res.status).toBe(400);
      expect(mockDoc.otpAttempts).toBe(2);
      expect(mockDoc.save).toHaveBeenCalled();
    });

    test("blocks and invalidates OTP after 5 failed attempts", async () => {
      const mockDoc = {
        email: testUser.email,
        otp: hashedOtp,
        otpExpiry: new Date(Date.now() + 600000),
        otpAttempts: 5, // reached max
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockDoc);

      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ email: testUser.email, otp: rawOtp });

      expect(res.status).toBe(429);
      expect(mockDoc.otp).toBe("");
    });

    test("successfully verifies valid OTP, invalidates OTP, and returns resetToken", async () => {
      const mockDoc = {
        email: testUser.email,
        otp: hashedOtp,
        otpExpiry: new Date(Date.now() + 600000),
        otpAttempts: 0,
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockDoc);

      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ email: testUser.email, otp: rawOtp });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty("resetToken");
      // OTP should be cleared to prevent reuse
      expect(mockDoc.otp).toBe("");
      expect(mockDoc.resetPasswordToken).toHaveLength(64); // SHA-256 hash of token
    });
  });

  describe("POST /api/auth/reset-password", () => {
    const rawToken = "sample_secure_reset_token_hex_string_32_bytes";
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    test("rejects password reset attempt without verification authorization", async () => {
      const mockDoc = {
        email: testUser.email,
        resetPasswordToken: "",
        otp: "",
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockDoc);

      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({ email: testUser.email, password: "newSecurePassword123" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test("successfully resets password with valid resetToken and invalidates it", async () => {
      const mockDoc = {
        email: testUser.email,
        password: mockHashedPassword,
        resetPasswordToken: hashedToken,
        resetPasswordExpires: new Date(Date.now() + 900000),
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockDoc);

      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({
          email: testUser.email,
          resetToken: rawToken,
          password: "newBrandNewPassword999",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockDoc.resetPasswordToken).toBe("");
      expect(mockDoc.save).toHaveBeenCalled();

      // Password should be hashed and different from old
      expect(mockDoc.password).not.toBe(mockHashedPassword);
      const isNewPasswordValid = await bcrypt.compare("newBrandNewPassword999", mockDoc.password);
      expect(isNewPasswordValid).toBe(true);
    });
  });

  describe("POST /api/auth/register & login", () => {
    test("registers a new user successfully", async () => {
      jest.spyOn(User, "findOne").mockResolvedValue(null);
      jest.spyOn(User, "create").mockResolvedValue({
        _id: "new_user_id_123",
        name: "New Operator",
        email: "new_operator@factory.com",
      });

      const res = await request(app).post("/api/auth/register").send({
        name: "New Operator",
        email: "new_operator@factory.com",
        password: "secretPassword123",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe("new_operator@factory.com");
    });

    test("logs in user with correct password and rejects invalid password", async () => {
      const mockDoc = {
        _id: testUser._id,
        name: testUser.name,
        email: testUser.email,
        password: mockHashedPassword,
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockDoc);

      // Wrong password
      const badRes = await request(app).post("/api/auth/login").send({
        email: testUser.email,
        password: "wrongPassword999",
      });
      expect(badRes.status).toBe(400);
      expect(badRes.body.success).toBe(false);

      // Correct password
      const goodRes = await request(app).post("/api/auth/login").send({
        email: testUser.email,
        password: testUser.password,
      });
      expect(goodRes.status).toBe(200);
      expect(goodRes.body.success).toBe(true);
      expect(goodRes.body).toHaveProperty("token");
    });
  });
});

