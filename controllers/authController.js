const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendOTP } = require("../services/emailService");

/**
 * Register a new user
 */
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: cleanEmail });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword,
    });

    return res.status(201).json({
      success: true,
      message: "User Registered",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Authenticate user and issue JWT token
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and Password are required",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid Email or Password",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid Email or Password",
      });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || "default_jwt_secret",
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login Successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Request Password Reset OTP
 * - Enforces cryptographically random 6-digit OTP
 * - Hashes OTP with SHA-256 before storage
 * - Enforces 60-second resend cooldown
 * - Prevents user enumeration attacks with generic safe response
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!/\S+@\S+\.\S+/.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    console.log(`📩 [Auth] Forgot password request received for: ${cleanEmail}`);

    const user = await User.findOne({ email: cleanEmail });
    console.log(`🔍 [Auth] Database lookup completed for: ${cleanEmail} (User found: ${!!user})`);

    // Protect against user enumeration: return success even if email is not found
    if (!user) {
      console.log(`📤 [Auth] Response returned to frontend (200 OK - Safe non-enumeration response)`);
      return res.status(200).json({
        success: true,
        message: "If an account with this email exists, a verification code has been sent.",
      });
    }

    // Rate Limiting & Cooldown: enforce 60 seconds between OTP requests
    if (user.otpLastSentAt) {
      const elapsedMs = Date.now() - new Date(user.otpLastSentAt).getTime();
      const COOLDOWN_MS = 60 * 1000;
      if (elapsedMs < COOLDOWN_MS) {
        const remainingSecs = Math.ceil((COOLDOWN_MS - elapsedMs) / 1000);
        console.log(`📤 [Auth] Response returned to frontend (429 Cooldown active: ${remainingSecs}s remaining)`);
        return res.status(429).json({
          success: false,
          cooldown: true,
          remainingSeconds: remainingSecs,
          message: `Please wait ${remainingSecs} seconds before requesting a new code.`,
        });
      }
    }

    // Generate cryptographically secure random 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();

    // Store SHA-256 hash of OTP to prevent database leak exposure
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    user.otp = hashedOtp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
    user.otpLastSentAt = new Date();
    user.otpAttempts = 0;
    user.resetPasswordToken = "";
    user.resetPasswordExpires = null;
    await user.save();

    // Deliver OTP via Resend HTTPS (or SMTP fallback)
    const providerName = process.env.RESEND_API_KEY ? "Resend HTTPS" : "SMTP";
    console.log(`⏳ [Auth] Email sending started for: ${user.email} (Provider: ${providerName})`);
    const emailResult = await sendOTP(user.email, otp);

    if (!emailResult.success) {
      console.error(`❌ [Auth] Email sending failed: ${emailResult.error}`);
      console.log(`📤 [Auth] Response returned to frontend (502 Delivery Failed)`);
      return res.status(502).json({
        success: false,
        message: emailResult.error || "Failed to deliver OTP email. Please try again later.",
      });
    }

    console.log(`✅ [Auth] Email sending succeeded for: ${user.email}`);
    console.log(`📤 [Auth] Response returned to frontend (200 OK)`);
    return res.status(200).json({
      success: true,
      message: "A 6-digit verification code has been sent to your email.",
    });
  } catch (err) {
    console.error("❌ Forgot Password Controller Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while processing your request.",
    });
  }
};

/**
 * Verify 6-digit OTP Code
 * - Checks expiry and brute-force attempt limits
 * - Generates single-use reset token and invalidates OTP to prevent replay
 */
const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.toString().trim();

    if (!/^\d{6}$/.test(cleanOtp)) {
      return res.status(400).json({
        success: false,
        message: "OTP must be a 6-digit numeric code",
      });
    }

    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP code.",
      });
    }

    // Brute-force protection: max 5 failed attempts per OTP cycle
    if (user.otpAttempts >= 5) {
      user.otp = "";
      user.otpExpiry = null;
      await user.save();
      return res.status(429).json({
        success: false,
        message: "Too many failed attempts. Please request a new verification code.",
      });
    }

    // Expiry check
    if (!user.otp || !user.otpExpiry || new Date() > new Date(user.otpExpiry)) {
      return res.status(400).json({
        success: false,
        message: "OTP code has expired. Please request a new code.",
      });
    }

    // Hash comparison
    const hashedIncomingOtp = crypto.createHash("sha256").update(cleanOtp).digest("hex");

    if (user.otp !== hashedIncomingOtp) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      await user.save();
      const remaining = 5 - user.otpAttempts;
      return res.status(400).json({
        success: false,
        message: `Invalid OTP code. ${remaining > 0 ? `${remaining} attempt(s) remaining.` : "Please request a new code."}`,
      });
    }

    // Success! Invalidate OTP immediately to prevent reuse
    // Issue single-use cryptographically secure reset token (15-min validity)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedResetToken = crypto.createHash("sha256").update(resetToken).digest("hex");

    user.otp = "";
    user.otpExpiry = null;
    user.otpAttempts = 0;
    user.resetPasswordToken = hashedResetToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully.",
      resetToken,
    });
  } catch (err) {
    console.error("❌ Verify OTP Controller Error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Reset User Password
 * - Requires either single-use resetToken (recommended) OR verified OTP
 * - Enforces minimum password strength
 * - Invalidates all reset tokens and updates password
 */
const resetPassword = async (req, res) => {
  try {
    const { email, otp, resetToken, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and new password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    let isAuthorized = false;

    // 1. Check resetToken authorization
    if (resetToken && user.resetPasswordToken && user.resetPasswordExpires) {
      const hashedIncomingToken = crypto.createHash("sha256").update(resetToken.trim()).digest("hex");
      if (
        user.resetPasswordToken === hashedIncomingToken &&
        new Date() < new Date(user.resetPasswordExpires)
      ) {
        isAuthorized = true;
      }
    }

    // 2. Fallback check: Direct OTP verification (backwards-compatibility)
    if (!isAuthorized && otp && user.otp && user.otpExpiry) {
      const hashedIncomingOtp = crypto.createHash("sha256").update(otp.toString().trim()).digest("hex");
      if (
        user.otp === hashedIncomingOtp &&
        new Date() < new Date(user.otpExpiry)
      ) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized or expired password reset session. Please verify your OTP code again.",
      });
    }

    // Hash new password and clear all authentication tokens
    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.otp = "";
    user.otpExpiry = null;
    user.otpAttempts = 0;
    user.resetPasswordToken = "";
    user.resetPasswordExpires = null;

    await user.save();

    console.log(`🔒 Password reset successfully for ${cleanEmail}`);

    return res.status(200).json({
      success: true,
      message: "Password reset successfully. You can now login with your new password.",
    });
  } catch (err) {
    console.error("❌ Reset Password Controller Error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Logout user and clear push tokens
 */
const logout = async (req, res) => {
  try {
    const { expoPushToken } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (expoPushToken) {
      user.expoPushTokens = user.expoPushTokens.filter((token) => token !== expoPushToken);
      await user.save();
    }

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    console.error("Logout Error:", err);
    res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};

module.exports = {
  register,
  login,
  forgotPassword,
  verifyOTP,
  resetPassword,
  logout,
};