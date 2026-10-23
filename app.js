const express = require("express");

const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const deviceRoutes = require("./routes/deviceRoutes");
const commandRoutes = require("./routes/commandRoutes");
const alertRoutes = require("./routes/alertRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const alexaRoutes = require("./routes/alexaRoutes");
const oauthRoutes = require("./routes/oauthRoutes");
const googleRoutes = require("./routes/googleRoutes");
const healthRoutes = require("./routes/healthRoutes");
const app = express();

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/health", healthRoutes);
app.use("/health", healthRoutes);
app.use(
    "/api/dashboard",
    dashboardRoutes
);

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/device", deviceRoutes);
// app.use("/api/alerts", alertRoutes);
app.use("/api/device/command", commandRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/alexa", alexaRoutes);
app.use("/oauth", oauthRoutes);
app.use("/api/google", googleRoutes);
module.exports = app;