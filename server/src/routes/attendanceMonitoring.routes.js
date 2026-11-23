import express from "express";
import {
  getAttendanceMonitoringSummary,
  getAttendanceMonitoringRecords,
  getLiveAttendanceMonitoring,
  getEmployeeAttendanceProfile,
  getAttendanceAnalytics,
  reviewAttendanceRecord
} from "../controllers/attendanceMonitoringController.js";
import { updateRegularizationStatus } from "../controllers/regularizationController.js";
import { authenticateToken, requireManagerOrAdmin } from "../middlewares/auth.js";

const router = express.Router();

// Enforce authentication and administrative permissions across all monitoring endpoints
router.use(authenticateToken);
router.use(requireManagerOrAdmin);

// Monitoring Summary Statistics
router.get("/summary", getAttendanceMonitoringSummary);

// Detailed Employee Attendance Table Records
router.get("/records", getAttendanceMonitoringRecords);

// Real-Time Live Attendance Pulse
router.get("/live", getLiveAttendanceMonitoring);

// Individual Employee Detailed Attendance Profile
router.get("/employee/:userId", getEmployeeAttendanceProfile);

// Analytics, Charts, and Trend Reports
router.get("/analytics", getAttendanceAnalytics);

// Admin Action: Review/Remark/Unlock Attendance Record
router.post("/record/:id/review", reviewAttendanceRecord);

// Admin Action: Review Attendance Regularization Request
router.patch("/regularization/:id/action", updateRegularizationStatus);

export default router;
