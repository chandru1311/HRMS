import express from "express";
import { authenticateToken, requireAdmin } from "../middlewares/auth.js";
import {
  getGlobalPayrollOverview,
  getCurrencies,
  addCurrency,
  updateCurrency,
  getExchangeRates,
  createExchangeRate,
  convertCurrencyAmount,
  getCountryConfigs,
  updateCountryConfig,
  getTaxRules,
  createTaxRule,
  updateTaxRule,
  getEmployeesPayrollProfiles,
  getEmployeePayrollProfile,
  saveEmployeePayrollProfile,
  calculateGlobalPayroll,
  processGlobalPayrollRun,
  approveGlobalPayrollRun,
  reverseGlobalPayrollRun,
  getGlobalPayrollRuns,
  getGlobalPayrollRunDetails,
  getAdminPayslips,
  getMyEmployeePayslips,
  getGlobalPayrollReports,
  exportWpsSif,
  getPayrollAuditLogs
} from "../controllers/globalPayrollController.js";

const router = express.Router();

// -------------------------------------------------------------
// EMPLOYEE-FACING SECURE ROUTE (Read-only own published payslips)
// -------------------------------------------------------------
router.get("/global-payroll/my-payslips", authenticateToken, getMyEmployeePayslips);

// -------------------------------------------------------------
// ADMIN-ONLY GLOBAL PAYROLL ROUTES (Strictly protected by requireAdmin)
// -------------------------------------------------------------
const admin = [authenticateToken, requireAdmin];

// 1. Overview
router.get("/admin/global-payroll/overview", ...admin, getGlobalPayrollOverview);

// 2. Currencies
router.get("/admin/global-payroll/currencies", ...admin, getCurrencies);
router.post("/admin/global-payroll/currencies", ...admin, addCurrency);
router.put("/admin/global-payroll/currencies/:id", ...admin, updateCurrency);

// 3. Exchange Rates
router.get("/admin/global-payroll/exchange-rates", ...admin, getExchangeRates);
router.post("/admin/global-payroll/exchange-rates", ...admin, createExchangeRate);
router.post("/admin/global-payroll/convert", ...admin, convertCurrencyAmount);

// 4. Country Configuration
router.get("/admin/global-payroll/countries", ...admin, getCountryConfigs);
router.get("/admin/global-payroll/countries/:code", ...admin, async (req, res) => {
  req.params.code = req.params.code.toUpperCase();
  const all = await getCountryConfigs(req, { json: (data) => {
    const item = data.find(c => c.country_code === req.params.code);
    if (!item) return res.status(404).json({ error: "Country not found." });
    res.json(item);
  }, status: () => res });
});
router.put("/admin/global-payroll/countries/:code", ...admin, updateCountryConfig);

// 5. Tax Rules
router.get("/admin/global-payroll/tax-rules", ...admin, getTaxRules);
router.post("/admin/global-payroll/tax-rules", ...admin, createTaxRule);
router.put("/admin/global-payroll/tax-rules/:id", ...admin, updateTaxRule);

// 6. Employee Payroll Profiles
router.get("/admin/global-payroll/employees", ...admin, getEmployeesPayrollProfiles);
router.get("/admin/global-payroll/employees/:id", ...admin, getEmployeePayrollProfile);
router.post("/admin/global-payroll/employees/:id/profile", ...admin, saveEmployeePayrollProfile);
router.put("/admin/global-payroll/employees/:id/profile", ...admin, saveEmployeePayrollProfile);

// 7. Global Payroll Runs & Calculation
router.post("/admin/global-payroll/calculate", ...admin, calculateGlobalPayroll);
router.post("/admin/global-payroll/process", ...admin, processGlobalPayrollRun);
router.post("/admin/global-payroll/runs/:id/approve", ...admin, approveGlobalPayrollRun);
router.post("/admin/global-payroll/:id/approve", ...admin, approveGlobalPayrollRun);
router.post("/admin/global-payroll/runs/:id/reverse", ...admin, reverseGlobalPayrollRun);
router.post("/admin/global-payroll/:id/reverse", ...admin, reverseGlobalPayrollRun);
router.get("/admin/global-payroll/runs", ...admin, getGlobalPayrollRuns);
router.get("/admin/global-payroll/history", ...admin, getGlobalPayrollRuns);
router.get("/admin/global-payroll/runs/:id", ...admin, getGlobalPayrollRunDetails);
router.get("/admin/global-payroll/:id", ...admin, getGlobalPayrollRunDetails);

// 8. Payslips Management (Admin)
router.get("/admin/global-payroll/payslips", ...admin, getAdminPayslips);

// 9. WPS SIF Export
router.post("/admin/global-payroll/runs/:id/wps-export", ...admin, exportWpsSif);

// 10. Reports
router.get("/admin/global-payroll/reports", ...admin, getGlobalPayrollReports);

// 11. Audit Logs
router.get("/admin/global-payroll/audit-logs", ...admin, getPayrollAuditLogs);

export default router;
