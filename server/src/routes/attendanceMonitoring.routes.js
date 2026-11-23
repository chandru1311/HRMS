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
  exportAttendanceReport,
  exportAttendanceCsv,
  exportAttendanceExcel,
  exportAttendancePdf,
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
router.get("/export", exportAttendanceReport);
router.get("/export-csv", exportAttendanceCsv);
router.get("/export-excel", exportAttendanceExcel);
router.get("/export-xlsx", exportAttendanceExcel);
router.get("/export-pdf", exportAttendancePdf);

// Admin Actions
router.post("/regularize/:id/review", reviewRegularization);
router.post("/regularization/:id/review", reviewRegularization);
router.post("/unlock", unlockAttendance);
router.post("/unlock/:attendanceId", unlockAttendance);
router.post("/manual-correct", manualCorrectAttendance);
router.post("/reverse-geocode", resolveAddressEndpoint);

export default router;
