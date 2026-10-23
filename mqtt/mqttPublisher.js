const mqtt = require("mqtt");

const client = mqtt.connect(process.env.MQTT_URL);

client.on("connect", () => {
  console.log("MQTT Publisher Connected");
});

function publishCommand(deviceId, command) {

  const topic = `sensor/${deviceId}/command`;

  const payload = JSON.stringify(
    command
  );

  client.publish(topic, payload, (err) => {

    if (err) {

      console.log(err.message);

    } else {

      console.log(`Command Sent -> ${topic}`);

    }

  });

}

module.exports = {
  publishCommand
};