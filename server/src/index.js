import http from "http";
import app from "./app.js";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { setSecuritySocketIO } from "./services/securityDetector.js";
import { ensureFaceService, stopFaceServiceProcess } from "./services/faceServiceManager.js";
import { runGeofenceDefaultsMigration } from "../scripts/migrate-geofence-defaults.js";
import { runAttendanceSessionsMigration } from "../scripts/migrate-attendance-sessions.js";
import { runFaceReenrollmentMigration } from "../scripts/migrate-face-reenrollment.js";
import { runCleanDuplicateNotifications } from "../scripts/clean-duplicate-notifications.js";
import { runGlobalPayrollMigration } from "../scripts/migrate-global-payroll.js";
import { runUnlockAllAccounts } from "../scripts/unlock-all-accounts.js";
import { startComplianceSupervisor } from "./services/complianceSupervisor.js";

dotenv.config();

let PORT = parseInt(process.env.PORT || "5001", 10);
const server = http.createServer(app);

// Socket.io for live updates
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
app.set("io", io);
setSecuritySocketIO(io);

io.on("connection", (socket) => {
  console.log(`⚡ Socket client connected: ${socket.id}`);

  socket.on("join_company", (companyId) => {
    socket.join(`company_${companyId}`);
  });

  socket.on("join_user", (userId) => {
    socket.join(`user_${userId}`);
  });

  socket.on("typing_start", ({ threadId, userId, userName }) => {
    socket.to(`channel_${threadId}`).emit("user_typing", { threadId, userId, userName });
  });

  socket.on("typing_stop", ({ threadId, userId }) => {
    socket.to(`channel_${threadId}`).emit("user_stopped_typing", { threadId, userId });
  });

  socket.on("disconnect", () => {
    console.log(`🔌 Socket client disconnected: ${socket.id}`);
  });
});

export { io };

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // Port 5002 is reserved for Python Face Verification microservice, skip it
    const nextPort = PORT === 5001 ? 5003 : PORT + 1;
    console.warn(`⚠️ Port ${PORT} is in use, attempting to use port ${nextPort}...`);
    PORT = nextPort;
    server.listen(PORT, () => {
      console.log(`🚀 HRMS Backend Server running on fallback port ${PORT}`);
      console.log(`📡 Health check available at: http://localhost:${PORT}/api/health`);
      startComplianceSupervisor(io);
    });
  } else {
    console.error("Server error:", err);
  }
});

let isShuttingDown = false;
async function handleShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("\n[Server] Graceful shutdown initiated...");
  
  // Stop Python Face Verification microservice
  try {
    await stopFaceServiceProcess();
  } catch (e) {}

  server.close(() => {
    console.log("[Server] HTTP and Socket.io server closed.");
    process.exit(0);
  });
  
  setTimeout(() => {
    console.warn("[Server] Force exiting after timeout.");
    process.exit(1);
  }, 5000).unref();
}

process.once("SIGINT", handleShutdown);
process.once("SIGTERM", handleShutdown);

async function startServer() {
  // 1. Ensure Python FastAPI Face Verification microservice is running or start it
  try {
    await ensureFaceService();
  } catch (faceErr) {
    console.error(`❌ [FaceService] Failed to initialize face verification microservice: ${faceErr.message}`);
    console.warn(`⚠️ [FaceService] Biometric attendance operations will fail-closed (503) until the service is restored.`);
  }

  // 2. Run database migrations (non-blocking, individual fault tolerance)
  try { await runGeofenceDefaultsMigration(); } catch (e) { console.warn("Geofence migration note:", e.message); }
  try { await runAttendanceSessionsMigration(); } catch (e) { console.warn("Attendance migration note:", e.message); }
  try { await runFaceReenrollmentMigration(); } catch (e) { console.warn("Face reenrollment migration note:", e.message); }
  try { await runCleanDuplicateNotifications(); } catch (e) { console.warn("Clean notifications note:", e.message); }
  try { await runGlobalPayrollMigration(); } catch (e) { console.warn("Global payroll migration note:", e.message); }
  try { await runUnlockAllAccounts(io); } catch (e) { console.warn("Auto-unlock note:", e.message); }

  // 3. Start Express server
  server.listen(PORT, async () => {
    console.log(`🚀 HRMS Backend Server running on port ${PORT}`);
    console.log(`📡 Health check available at: http://localhost:${PORT}/api/health`);
    startComplianceSupervisor(io);
    // Ensure all accounts are unlocked on server ready
    try {
      await runUnlockAllAccounts(io);
    } catch (e) {
      console.warn("Post-listen auto-unlock note:", e.message);
    }
  });
}

startServer();
