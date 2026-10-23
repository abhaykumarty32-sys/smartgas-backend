const path = require("path");
const fs = require("fs");

let firebaseApp = null;
let firebaseAuth = null;
let isInitialized = false;

function getFirebaseModules() {
  const { initializeApp, getApps, cert } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");
  return { initializeApp, getApps, cert, getAuth };
}

function initFirebaseAdmin() {
  if (isInitialized && firebaseApp && firebaseAuth) {
    return { app: firebaseApp, auth: firebaseAuth };
  }

  try {
    const { initializeApp, getApps, cert, getAuth } = getFirebaseModules();

    const existingApps = getApps();
    if (existingApps.length > 0) {
      firebaseApp = existingApps[0];
      firebaseAuth = getAuth(firebaseApp);
      isInitialized = true;
      return { app: firebaseApp, auth: firebaseAuth };
    }

    // 1. Try JSON string from environment variable (Recommended for Render)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } catch (parseErr) {
        const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf8");
        serviceAccount = JSON.parse(decoded);
      }

      firebaseApp = initializeApp({
        credential: cert(serviceAccount),
      });
      firebaseAuth = getAuth(firebaseApp);
      isInitialized = true;
      console.log("🔥 [Firebase Admin] Initialized via FIREBASE_SERVICE_ACCOUNT env var");
      return { app: firebaseApp, auth: firebaseAuth };
    }

    // 2. Try individual environment variables
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
      firebaseApp = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        }),
      });
      firebaseAuth = getAuth(firebaseApp);
      isInitialized = true;
      console.log("🔥 [Firebase Admin] Initialized via individual FIREBASE_* env vars");
      return { app: firebaseApp, auth: firebaseAuth };
    }

    // 3. Try local service account file if path specified or in standard location
    const potentialPaths = [
      process.env.FIREBASE_CREDENTIALS_PATH,
      path.join(__dirname, "../config/firebase-service-account.json"),
      path.join(__dirname, "../../mobile/smart-gas-monitoring-96c0a-firebase-adminsdk-fbsvc-8fef82011d.json"),
    ].filter(Boolean);

    for (const filePath of potentialPaths) {
      if (fs.existsSync(filePath)) {
        const fileContent = JSON.parse(fs.readFileSync(filePath, "utf8"));
        firebaseApp = initializeApp({
          credential: cert(fileContent),
        });
        firebaseAuth = getAuth(firebaseApp);
        isInitialized = true;
        console.log(`🔥 [Firebase Admin] Initialized via local service account file: ${path.basename(filePath)}`);
        return { app: firebaseApp, auth: firebaseAuth };
      }
    }

    // 4. Fallback initialization with Project ID
    const projectId = process.env.FIREBASE_PROJECT_ID || "smart-gas-monitoring-96c0a";
    firebaseApp = initializeApp({ projectId });
    firebaseAuth = getAuth(firebaseApp);
    isInitialized = true;
    console.warn("⚠️ [Firebase Admin] Initialized with projectId fallback (certificate credentials not loaded).");
    return { app: firebaseApp, auth: firebaseAuth };
  } catch (error) {
    console.error("❌ [Firebase Admin] Initialization failed:", error.message);
    return null;
  }
}

/**
 * Verify a Firebase ID Token submitted by client
 * @param {string} idToken
 * @returns {Promise<import("firebase-admin/auth").DecodedIdToken>}
 */
async function verifyFirebaseToken(idToken) {
  if (!idToken) throw new Error("Firebase ID token is required");
  const instance = initFirebaseAdmin();
  if (!instance || !instance.auth) throw new Error("Firebase Admin SDK is not initialized");
  return await instance.auth.verifyIdToken(idToken);
}

/**
 * Ensure user exists in Firebase Auth
 * Creates the user in Firebase Auth if not already present
 * @param {string} email
 * @param {string} [displayName]
 * @returns {Promise<import("firebase-admin/auth").UserRecord>}
 */
async function ensureFirebaseUser(email, displayName = "") {
  const cleanEmail = email.trim().toLowerCase();
  const instance = initFirebaseAdmin();
  if (!instance || !instance.auth) throw new Error("Firebase Admin SDK is not initialized");

  try {
    return await instance.auth.getUserByEmail(cleanEmail);
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      console.log(`👤 [Firebase Admin] Provisioning new user in Firebase Auth: ${cleanEmail}`);
      return await instance.auth.createUser({
        email: cleanEmail,
        displayName: displayName || undefined,
        emailVerified: false,
      });
    }
    throw err;
  }
}

module.exports = {
  initFirebaseAdmin,
  verifyFirebaseToken,
  ensureFirebaseUser,
};
