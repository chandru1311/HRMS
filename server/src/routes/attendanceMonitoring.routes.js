import express from "express";
import {
  getMonitoringSummary,
  getMonitoringRecords,
  getMonitoringLive,
  getEmployeeAttendanceProfile,
  getMonitoringAnalytics,
  reviewRegularization,
  unlockAttendance,
  manualCorrectAttendance,
  exportAttendanceCsv,
  resolveAddressEndpoint
} from "../controllers/attendanceMonitoringController.js";
import { authenticateToken } from "../middlewares/auth.js";

const router = express.Router();

router.use(authenticateToken);

// Monitoring Overview & Records
router.get("/summary", getMonitoringSummary);
router.get("/records", getMonitoringRecords);
router.get("/live", getMonitoringLive);
router.get("/employee/:userId", getEmployeeAttendanceProfile);
router.get("/analytics", getMonitoringAnalytics);
router.get("/export", exportAttendanceCsv);
router.get("/export-csv", exportAttendanceCsv);

// Admin Actions
router.post("/regularize/:id/review", reviewRegularization);
router.post("/regularization/:id/review", reviewRegularization);
router.post("/unlock", unlockAttendance);
router.post("/unlock/:attendanceId", unlockAttendance);
router.post("/manual-correct", manualCorrectAttendance);
router.post("/reverse-geocode", resolveAddressEndpoint);

export default router;
