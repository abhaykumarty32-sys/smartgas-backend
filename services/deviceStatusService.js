const Device = require("../models/Device");

function startDeviceStatusService(io) {

  setInterval(async () => {

    try {

      const timeout = new Date(Date.now() - 60000);

      const offlineDevices = await Device.find({
        lastSeen: { $lt: timeout },
        status: "online"
      });

      for (const device of offlineDevices) {

        device.status = "offline";
        await device.save();

        io.to(device.userId.toString()).emit("deviceOffline", {
          deviceId: device.deviceId
        });

        console.log(`${device.deviceId} marked offline`);

      }

    } catch (err) {

      console.log(err.message);

    }

  }, 30000);

}

module.exports = startDeviceStatusService;