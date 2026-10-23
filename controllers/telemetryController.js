const Device = require("../models/Device");
const TelemetryHistory = require("../models/TelemetryHistory");

exports.getDeviceHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const { range = "24h", limit = 100 } = req.query;

    const device = await Device.findOne({
      _id: id,
      userId: req.user.id,
    });

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found or unauthorized",
      });
    }

    const now = Date.now();
    let windowMs = 24 * 60 * 60 * 1000;
    if (range === "1h") windowMs = 1 * 60 * 60 * 1000;
    else if (range === "6h") windowMs = 6 * 60 * 60 * 1000;
    else if (range === "12h") windowMs = 12 * 60 * 60 * 1000;
    else if (range === "24h") windowMs = 24 * 60 * 60 * 1000;
    else if (range === "7d") windowMs = 7 * 24 * 60 * 60 * 1000;

    const startTime = new Date(now - windowMs);

    const history = await TelemetryHistory.find({
      deviceId: device.deviceId,
      timestamp: { $gte: startTime },
    })
      .sort({ timestamp: 1 })
      .lean();

    let formattedData = history.map((item) => ({
      timestamp: item.timestamp,
      gas: item.gas,
      temperature: item.temperature,
      alertState: item.alertState,
      relay: item.relay,
      valve: item.valve,
    }));

    if (formattedData.length === 0 && device.gas !== undefined) {
      formattedData = [
        {
          timestamp: device.lastSeen || new Date(),
          gas: device.gas || 0,
          temperature: device.lastHeat || 0,
          alertState: device.alertState || "Normal",
          relay: device.relay || false,
          valve: device.valve !== undefined ? device.valve : true,
        },
      ];
    }

    const maxPoints = Math.min(Math.max(parseInt(limit, 10) || 50, 10), 200);
    if (formattedData.length > maxPoints) {
      const step = Math.ceil(formattedData.length / maxPoints);
      const sampled = [];
      for (let i = 0; i < formattedData.length; i += step) {
        sampled.push(formattedData[i]);
      }
      if (sampled[sampled.length - 1] !== formattedData[formattedData.length - 1]) {
        sampled.push(formattedData[formattedData.length - 1]);
      }
      formattedData = sampled;
    }

    res.json({
      success: true,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      range,
      count: formattedData.length,
      history: formattedData,
    });
  } catch (err) {
    console.error("❌ Telemetry history error:", err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
