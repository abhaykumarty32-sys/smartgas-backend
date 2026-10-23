const mongoose = require("mongoose");

const telemetryHistorySchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    gas: {
      type: Number,
      required: true,
    },
    temperature: {
      type: Number,
      default: 0,
    },
    alertState: {
      type: String,
      enum: ["Normal", "Warning", "Critical"],
      default: "Normal",
    },
    relay: {
      type: Boolean,
      default: false,
    },
    valve: {
      type: Boolean,
      default: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

telemetryHistorySchema.index({ deviceId: 1, timestamp: -1 });

module.exports = mongoose.model("TelemetryHistory", telemetryHistorySchema);
