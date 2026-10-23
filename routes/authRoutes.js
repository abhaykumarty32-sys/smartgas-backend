const express = require("express");

const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
  register,
  login,
  forgotPassword,
  verifyOTP,
  resetPassword,
  logout,
  firebaseLogin,
  preparePasswordReset,
} = require("../controllers/authController");

// Authentication Endpoints
router.post("/register", register);
router.post("/login", login);
router.post("/firebase-login", firebaseLogin);
router.post("/prepare-reset", preparePasswordReset);
router.post("/forgot-password", forgotPassword);
router.post("/verify-otp", verifyOTP);
router.post("/reset-password", resetPassword);
router.post("/logout", authMiddleware, logout);

module.exports = router;