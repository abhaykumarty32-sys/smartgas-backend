const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema({

    deviceId: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },

    deviceName: {
        type: String,
        required: true,
        trim: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // Latest Sensor Data
    gas: {
        type: Number,
        default: 0
    },

    lastHeat: {
        type: Number,
        default: 0
    },

    // Device Mode
    mode: {
        type: String,
        enum: ["AUTO", "MANUAL"],
        default: "AUTO"
    },

    // Output Status
    relay: {
        type: Boolean,
        default: false
    },

    valve: {
        type: Boolean,
        default: true
    },

    // Alarm Status
    alert: {
        type: Boolean,
        default: false
    },
    alertState: {
        type: String,
        enum: ["Normal", "Warning", "Critical"],
        default: "Normal"
    },
    warningNotificationSent: {
        type: Boolean,
        default: false
    },
    criticalNotificationSent: {
        type: Boolean,
        default: false
    },
    location: {
        type: String,
        default: "",
    },

    // Online / Offline
    status: {
        type: String,
        enum: ["online", "offline"],
        default: "offline"
    },

    lastSeen: {
        type: Date,
        default: null
    }

}, {
    timestamps: true
});

module.exports = mongoose.model("Device", deviceSchema);