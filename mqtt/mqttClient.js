const mqtt = require("mqtt");
const Device = require("../models/Device");
const Alert = require("../models/Alert");
const { sendNotification } = require("../services/notificationService");

function startMQTT(io) {

    const client = mqtt.connect(process.env.MQTT_URL);

    // Notification cooldown per device
    const notificationCooldown = {};

    // 5 Minutes
    const COOLDOWN = 1 * 60 * 1000;


    // =========================================================
    // MQTT CONNECT
    // =========================================================

    client.on("connect", () => {

        console.log("✅ MQTT Connected");

        client.subscribe("sensor/+/gas");
        client.subscribe("sensor/+/relay");
        client.subscribe("sensor/+/mode");
        client.subscribe("sensor/+/temp");
        client.subscribe("sensor/+/ack");
        client.subscribe("sensor/+/valve");

        console.log("Subscribed : sensor/+/gas");
        console.log("Subscribed : sensor/+/relay");
        console.log("Subscribed : sensor/+/mode");
        console.log("Subscribed : sensor/+/temp");
        console.log("Subscribed : sensor/+/ack");

    });


    // =========================================================
    // MQTT MESSAGE
    // =========================================================

    client.on("message", async (topic, message) => {

        try {

            // -------------------------------------------------
            // Parse JSON
            // -------------------------------------------------

            const data = JSON.parse(message.toString());


            // -------------------------------------------------
            // Extract Device ID and Topic Type
            // Example:
            // sensor/68FE7180C554/gas
            // -------------------------------------------------

            const topicParts = topic.split("/");

            const deviceId = topicParts[1];
            const topicType = topicParts[2];


            console.log("--------------------------------");
            console.log("Topic   :", topic);
            console.log("Device  :", deviceId);
            console.log("Type    :", topicType);
            console.log("Payload :", data);


            // -------------------------------------------------
            // Find Registered Device
            // -------------------------------------------------

            const device = await Device.findOne({
                deviceId
            });


            if (!device) {

                console.log(
                    `❌ Unknown Device : ${deviceId}`
                );

                return;
            }

            // =================================================
            // VALVE STATUS
            // =================================================

            if (topicType === "valve") {

                const valveValue = Boolean(data.valve);

                device.valve = valveValue;
                device.status = "online";
                device.lastSeen = new Date();

                await device.save();

                io.to(device.userId.toString()).emit(
                    "valve-status",
                    {
                        deviceId: device.deviceId,
                        valve: device.valve,
                        status: "online",
                        lastSeen: device.lastSeen
                    }
                );

                console.log(
                    "✅ Valve Status Updated from MQTT:",
                    device.valve
                );

                return;
            }
            // =================================================
            // RELAY STATUS
            // =================================================

            if (topicType === "relay") {

                device.relay = data.relay;
                device.status = "online";
                device.lastSeen = new Date();

                await device.save();


                io.to(device.userId.toString()).emit(
                    "gas-data",
                    {
                        deviceId: device.deviceId,

                        relay: device.relay,

                        gas: device.gas,

                        temperature: device.lastHeat,

                        valve: device.valve,

                        mode: device.mode,

                        status: "online",

                        lastSeen: device.lastSeen
                    }
                );


                console.log(
                    "✅ Relay Status Updated:",
                    device.relay
                );


                return;
            }


            // =================================================
            // MODE STATUS
            // =================================================

            if (topicType === "mode") {

                if (
                    data.mode !== "AUTO" &&
                    data.mode !== "MANUAL"
                ) {

                    console.log(
                        "❌ Invalid Mode:",
                        data.mode
                    );

                    return;
                }


                device.mode = data.mode;
                device.status = "online";
                device.lastSeen = new Date();

                await device.save();


                io.to(device.userId.toString()).emit(
                    "gas-data",
                    {
                        deviceId: device.deviceId,

                        mode: device.mode,

                        gas: device.gas,

                        temperature: device.lastHeat,

                        relay: device.relay,



                        status: "online",

                        lastSeen: device.lastSeen
                    }
                );


                console.log(
                    "✅ ESP32 Mode Updated:",
                    device.mode
                );


                return;
            }


            // =================================================
            // TEMPERATURE
            // =================================================

            if (topicType === "temp") {

                const temperature =
                    Number(data.temperature);


                if (isNaN(temperature)) {

                    console.log(
                        "❌ Invalid Temperature:",
                        data.temperature
                    );

                    return;
                }


                device.lastHeat = temperature;
                device.status = "online";
                device.lastSeen = new Date();

                await device.save();


                console.log(
                    "🌡️ Temperature Received:",
                    temperature,
                    "°C"
                );


                io.to(device.userId.toString()).emit(
                    "gas-data",
                    {
                        deviceId: device.deviceId,

                        temperature: temperature,

                        gas: device.gas,

                        relay: device.relay,


                        status: "online",

                        lastSeen: device.lastSeen
                    }
                );


                console.log(
                    "📱 Temperature sent to Socket"
                );


                return;
            }


            // =================================================
            // ESP32 ACK
            // =================================================

            if (topicType === "ack") {

                console.log("================================");
                console.log("📩 ESP32 ACK RECEIVED");
                console.log("Device :", deviceId);
                console.log("ACK    :", data);

                // ---------------------------------------------
                // Validate ACK
                // ---------------------------------------------

                if (!data.action) {
                    console.log("❌ ACK missing action");
                    return;
                }

                // ---------------------------------------------
                // Update MongoDB ONLY after successful ACK
                // ---------------------------------------------

                if (data.success === true) {

                    const update = {};

                    if (data.mode !== undefined) {
                        update.mode = data.mode;
                    }

                    if (data.valve !== undefined) {
                        update.valve = data.valve;
                    }

                    if (data.relay !== undefined) {
                        update.relay = data.relay;
                    }

                    if (Object.keys(update).length > 0) {

                        update.status = "online";
                        update.lastSeen = new Date();

                        await Device.findOneAndUpdate(
                            { deviceId: deviceId },
                            { $set: update }
                        );

                        console.log(
                            "✅ Device state updated from ACK:",
                            update
                        );
                    }
                }

                // ---------------------------------------------
                // Send ACK to Mobile App
                // ---------------------------------------------

                io.to(device.userId.toString()).emit(
                    "device-ack",
                    {
                        deviceId: device.deviceId,
                        action: data.action,
                        success: data.success === true,
                        mode: data.mode,
                        valve: data.valve,
                        relay: data.relay,
                        message: data.message
                    }
                );

                console.log("📱 ACK sent to Socket.IO");

                return;
            }

            // =================================================
            // GAS SENSOR
            // =================================================

            if (topicType === "gas") {

                const gasValue = Number(data.gas);


                // ---------------------------------------------
                // Validate Gas
                // ---------------------------------------------

                if (isNaN(gasValue)) {

                    console.log(
                        "❌ Invalid Gas Value:",
                        data.gas
                    );

                    return;
                }


                // ---------------------------------------------
                // Update Device
                // ---------------------------------------------

                device.gas = gasValue;

                device.status = "online";

                device.lastSeen = new Date();


                await device.save();


                console.log(
                    "🔥 Gas Received:",
                    gasValue
                );


                // ---------------------------------------------
                // Send Live Gas Data to Mobile
                // ---------------------------------------------

                io.to(device.userId.toString()).emit(
                    "gas-data",
                    {
                        deviceId: device.deviceId,

                        gas: gasValue,

                        temperature:
                            device.lastHeat,

                        relay:
                            device.relay,

                        valve:
                            device.valve,

                        mode:
                            device.mode,

                        status: "online",

                        lastSeen:
                            device.lastSeen
                    }
                );


                console.log(
                    "📱 Gas data sent to Socket"
                );


                // ---------------------------------------------
                // Determine Alert Level & Abnormal Cycle Logic
                // ---------------------------------------------

                let currentState = "Normal";

                if (gasValue >= 900) {
                    currentState = "Critical";
                } else if (gasValue > 500) {
                    currentState = "Warning";
                }

                // Always update current alertState on Device model
                device.alertState = currentState;

                if (currentState === "Normal") {

                    // Reset both notification flags when device returns to Normal
                    device.warningNotificationSent = false;
                    device.criticalNotificationSent = false;

                } else if (currentState === "Warning") {

                    if (!device.warningNotificationSent) {

                        await Alert.create({
                            deviceId: device.deviceId,
                            gas: gasValue,
                            level: "Warning"
                        });

                        await sendNotification(
                            device.deviceId,
                            gasValue,
                            "Warning"
                        );

                        device.warningNotificationSent = true;
                        console.log(`⚠️ Warning Alert Saved & Notification Sent for ${device.deviceId}`);
                    }

                } else if (currentState === "Critical") {

                    if (!device.criticalNotificationSent) {

                        await Alert.create({
                            deviceId: device.deviceId,
                            gas: gasValue,
                            level: "Critical"
                        });

                        await sendNotification(
                            device.deviceId,
                            gasValue,
                            "Critical"
                        );

                        device.criticalNotificationSent = true;
                        device.warningNotificationSent = true;
                        console.log(`🚨 Critical Alert Saved & Notification Sent for ${device.deviceId}`);
                    }

                }

                await device.save();
                return;
            }


            // =================================================
            // UNKNOWN TOPIC
            // =================================================

            console.log(
                "⚠️ Unknown MQTT Topic:",
                topic
            );

        }
        catch (err) {

            console.log(
                "❌ MQTT Error:",
                err.message
            );

        }

    });


    // =========================================================
    // MQTT ERROR
    // =========================================================

    client.on("error", (err) => {

        console.log(
            "❌ MQTT Connection Error:",
            err.message
        );

    });

}


module.exports = startMQTT;