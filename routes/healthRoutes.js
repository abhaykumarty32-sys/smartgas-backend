const express = require("express");
const mongoose = require("mongoose");
const { isRedisAvailable } = require("../config/redis");
const { isSubscriberConnected } = require("../mqtt/mqttClient");
const { isPublisherConnected } = require("../mqtt/mqttPublisher");

const router = express.Router();

router.get("/", (req, res) => {
  const mongoConnected = mongoose.connection.readyState === 1;
  const redisHealthy = isRedisAvailable();
  const mqttSubHealthy = isSubscriberConnected ? isSubscriberConnected() : false;
  const mqttPubHealthy = isPublisherConnected ? isPublisherConnected() : false;

  const isDegraded = !mongoConnected;

  const healthPayload = {
    status: isDegraded ? "degraded" : "healthy",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    services: {
      server: "healthy",
      mongodb: mongoConnected ? "connected" : "disconnected",
      redis: redisHealthy ? "connected" : "fallback_mode",
      mqttSubscriber: mqttSubHealthy ? "connected" : "disconnected",
      mqttPublisher: mqttPubHealthy ? "connected" : "disconnected",
    },
  };

  const statusCode = mongoConnected ? 200 : 503;
  res.status(statusCode).json(healthPayload);
});

module.exports = router;
