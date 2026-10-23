require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const app = require("./app");
const connectDB = require("./config/db");
const { connectRedis, quitRedis } = require("./config/redis");
const startMQTT = require("./mqtt/mqttClient");
const startDeviceStatusService = require("./services/deviceStatusService");

connectDB();
connectRedis().catch((err) => console.warn("Redis startup notice:", err.message));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
io.use((socket, next) => {

  try {

    const token = socket.handshake.auth.token;

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    socket.userId = decoded.id;

    next();

  } catch (err) {

    next(new Error("Unauthorized"));

  }

});

/* Join User Room */
io.on("connection", (socket) => {

  socket.join(socket.userId);

  console.log(`User Connected : ${socket.userId}`);

  socket.on("disconnect", () => {

    console.log(`User Disconnected : ${socket.userId}`);

  });

});

// Start MQTT
startMQTT(io);
startDeviceStatusService(io);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server Running on Port ${PORT}`);
});