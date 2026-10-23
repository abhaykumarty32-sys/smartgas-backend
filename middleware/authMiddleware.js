const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { verifyFirebaseToken } = require("../config/firebase");

/**
 * Dual Authentication Middleware
 * Supports both:
 * 1. Backend JWT tokens (issued upon login/register)
 * 2. Firebase ID tokens (issued by Firebase Auth client SDK)
 * Always sets req.user = { id: user._id, ... } for consistency across all controllers
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Token Missing",
      });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Token Format Invalid",
      });
    }

    // 1. Try standard Backend JWT verification first (fast, synchronous)
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "default_jwt_secret");
      req.user = decoded;
      return next();
    } catch (jwtErr) {
      // If not a valid local JWT, attempt Firebase ID token verification
    }

    // 2. Try Firebase ID Token verification via Firebase Admin SDK
    try {
      const decodedFirebase = await verifyFirebaseToken(token);
      if (decodedFirebase && decodedFirebase.uid) {
        let user = await User.findOne({
          $or: [
            { firebaseUid: decodedFirebase.uid },
            { email: decodedFirebase.email?.toLowerCase() },
          ],
        });

        if (!user && decodedFirebase.email) {
          // Provision MongoDB profile on-the-fly for verified Firebase user
          user = await User.create({
            name: decodedFirebase.name || decodedFirebase.email.split("@")[0],
            email: decodedFirebase.email.toLowerCase(),
            firebaseUid: decodedFirebase.uid,
          });
        }

        if (user) {
          if (!user.firebaseUid) {
            user.firebaseUid = decodedFirebase.uid;
            await user.save();
          }
          req.user = {
            id: user._id.toString(),
            email: user.email,
            firebaseUid: decodedFirebase.uid,
          };
          return next();
        }
      }
    } catch (fbErr) {
      // Both verifications failed
    }

    return res.status(401).json({
      success: false,
      message: "Invalid Token",
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Authentication Failed",
    });
  }
};

module.exports = authMiddleware;