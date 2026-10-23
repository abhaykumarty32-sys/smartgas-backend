const Device = require("../models/Device");
const { publishCommand } = require("../mqtt/mqttPublisher");
exports.registerDevice = async (req, res) => {

  try {

    const { deviceId, deviceName, location } = req.body;

    if (!deviceId || !deviceName) {
      return res.status(400).json({
        message: "Device ID and Device Name are required"
      });
    }

    const alreadyExists = await Device.findOne({ deviceId });

    if (alreadyExists) {
      return res.status(400).json({
        message: "Device already registered"
      });
    }

    const device = await Device.create({

      deviceId,
      deviceName,
      userId: req.user.id,
      location: location || "",

    });

    res.status(201).json({
      success: true,
      device
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      message: err.message
    });

  }

};
exports.getMyDevices = async (req, res) => {

  try {

    const devices = await Device.find({

      userId: req.user.id

    });

    res.json(devices);

  } catch (err) {

    res.status(500).json({

      message: err.message

    });

  }

};
exports.renameDevice = async (req, res) => {

  try {

    const { deviceName } = req.body;

    const device = await Device.findOneAndUpdate(

      {
        _id: req.params.id,
        userId: req.user.id
      },

      {
        deviceName
      },

      {
        new: true
      }

    );

    if (!device) {

      return res.status(404).json({

        message: "Device not found"

      });

    }

    res.json(device);

  } catch (err) {

    res.status(500).json({

      message: err.message

    });

  }

};
exports.deleteDevice = async (req, res) => {

  try {

    const device = await Device.findOneAndDelete({

      _id: req.params.id,
      userId: req.user.id

    });

    if (!device) {

      return res.status(404).json({

        message: "Device not found"

      });

    }

    res.json({

      message: "Device deleted"

    });

  } catch (err) {

    res.status(500).json({

      message: err.message

    });

  }

};
// exports.sendCommand = async (req, res) => {
// try{
//     const { deviceId } = req.params;

//     const command = req.body;

//     const topic = `sensor/${deviceId}/command`;

//     mqttClient.publish(
//         topic,
//         JSON.stringify(command)
//     );

//     res.json({
//         success:true,
//         message:"Command Sent"
//     });
// } catch (err) {

//         res.status(500).json({

//             message: err.message

//         });

//     }
// };
exports.getDeviceById = async (req, res) => {
  try {

    const device = await Device.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found"
      });
    }

    res.status(200).json(device);

  } catch (err) {

    res.status(500).json({
      success: false,
      message: err.message
    });

  }
};
exports.controlDevice = async (req, res) => {
  try {

    const { action } = req.body;

    const validActions = [
      "relay-on",
      "silence",
      "valve-open",
      "valve-close",
      "mode-auto",
      "mode-manual"
    ];

    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action"
      });
    }

    const device = await Device.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found"
      });
    }

    // ==========================================
    // UPDATE DATABASE STATE
    // ==========================================

    if (action === "mode-auto") {
      device.mode = "AUTO";
    }

    if (action === "mode-manual") {
      device.mode = "MANUAL";
    }

    if (action === "valve-open") {
      device.valve = true;
    }

    if (action === "valve-close") {
      device.valve = false;
    }

    if (action === "relay-on") {
      device.relay = true;
    }

    if (action === "silence") {
      device.relay = false;
    }

    await device.save();

    console.log("💾 Database updated:", {
      deviceId: device.deviceId,
      mode: device.mode,
      valve: device.valve,
      relay: device.relay
    });

    // ==========================================
    // SEND COMMAND TO ESP32
    // ==========================================

    const command = {
      action
    };

    await publishCommand(
      device.deviceId,
      command
    );

    console.log("📤 Command sent to ESP32:", command);

    res.json({
      success: true,
      message: "Command sent and database updated",
      action,
      device
    });

  } catch (err) {

    console.log("❌ Control Error:", err.message);

    res.status(500).json({
      success: false,
      message: err.message
    });

  }
};
exports.changeMode = async (req, res) => {
  try {

    const { mode } = req.body;

    if (!["AUTO", "MANUAL"].includes(mode)) {
      return res.status(400).json({
        message: "Invalid mode"
      });
    }

    const device = await Device.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user.id
      },
      {
        mode
      },
      {
        new: true
      }
    );

    if (!device) {
      return res.status(404).json({
        message: "Device not found"
      });
    }

    res.json(device);

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
};
exports.updateSettings = async (req, res) => {

  try {

    const device = await Device.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!device) {
      return res.status(404).json({
        message: "Device not found"
      });
    }

    const {
      warningThreshold,
      criticalThreshold,
      location,
      deviceId
    } = req.body;

    if (warningThreshold !== undefined)
      device.warningThreshold = warningThreshold;

    if (criticalThreshold !== undefined)
      device.criticalThreshold = criticalThreshold;
    if (deviceId)
      device.deviceId = deviceId.trim().toUpperCase();

    if (location)
      device.location = location;

    await device.save();

    res.json(device);

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }

};