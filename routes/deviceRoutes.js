const express = require("express");

const router = express.Router();

const {

    registerDevice,
    getMyDevices,
    getDeviceById,
    renameDevice,
    deleteDevice,
    sendCommand,
    controlDevice,
    changeMode,
    updateSettings
} = require("../controllers/deviceController");
const { getDeviceHistory } = require("../controllers/telemetryController");

const auth = require("../middleware/authMiddleware");

router.post("/register", auth, registerDevice);

router.get("/my-devices", auth, getMyDevices);
router.get("/:id/history", auth, getDeviceHistory);
router.get("/:id", auth, getDeviceById);
router.put("/:id", auth, renameDevice);
router.put("/:id/control", auth, controlDevice);
router.put("/:id/mode", auth, changeMode);
router.delete("/:id", auth, deleteDevice);
router.put(
    "/:id/settings",
    auth,
    updateSettings
);
router.get("/test", (req, res) => {
    res.send("Device Route Working");
});

module.exports = router;