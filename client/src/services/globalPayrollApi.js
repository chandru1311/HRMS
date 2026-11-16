import { apiFetch } from "../firebase";

/**
 * Global Multi-Currency & International Tax Engine - Frontend API Client
 */

export const fetchGlobalPayrollOverview = (companyId) => {
  return apiFetch(`/admin/global-payroll/overview?companyId=${companyId || ""}`);
};

export const fetchCurrencies = (companyId) => {
  return apiFetch(`/admin/global-payroll/currencies?companyId=${companyId || ""}`);
};

export const createCurrency = (payload) => {
  return apiFetch("/admin/global-payroll/currencies", {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const updateCurrency = (id, payload) => {
  return apiFetch(`/admin/global-payroll/currencies/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
};

export const fetchExchangeRates = (companyId, params = {}) => {
  const query = new URLSearchParams({ companyId: companyId || "", ...params }).toString();
  return apiFetch(`/admin/global-payroll/exchange-rates?${query}`);
};

export const createExchangeRate = (payload) => {
  return apiFetch("/admin/global-payroll/exchange-rates", {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const convertCurrencyAmount = (payload) => {
  return apiFetch("/admin/global-payroll/convert", {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const fetchCountryConfigs = (companyId) => {
  return apiFetch(`/admin/global-payroll/countries?companyId=${companyId || ""}`);
};

export const updateCountryConfig = (code, payload) => {
  return apiFetch(`/admin/global-payroll/countries/${code}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
};

export const fetchTaxRules = (companyId, params = {}) => {
  const query = new URLSearchParams({ companyId: companyId || "", ...params }).toString();
  return apiFetch(`/admin/global-payroll/tax-rules?${query}`);
};

export const createTaxRule = (payload) => {
  return apiFetch("/admin/global-payroll/tax-rules", {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const updateTaxRule = (id, payload) => {
  return apiFetch(`/admin/global-payroll/tax-rules/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
};

export const fetchEmployeesPayrollProfiles = (companyId) => {
  return apiFetch(`/admin/global-payroll/employees?companyId=${companyId || ""}`);
};

export const fetchEmployeePayrollProfile = (userId) => {
  return apiFetch(`/admin/global-payroll/employees/${userId}`);
};

export const saveEmployeePayrollProfile = (userId, payload) => {
  return apiFetch(`/admin/global-payroll/employees/${userId}/profile`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const calculateGlobalPayroll = (payload) => {
  return apiFetch("/admin/global-payroll/calculate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const processGlobalPayrollRun = (payload) => {
  return apiFetch("/admin/global-payroll/process", {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const approveGlobalPayrollRun = (runId) => {
  return apiFetch(`/admin/global-payroll/runs/${runId}/approve`, {
    method: "POST"
  });
};

export const reverseGlobalPayrollRun = (runId, reversalReason) => {
  return apiFetch(`/admin/global-payroll/runs/${runId}/reverse`, {
    method: "POST",
    body: JSON.stringify({ reversalReason })
  });
};

export const fetchGlobalPayrollRuns = (companyId, params = {}) => {
  const query = new URLSearchParams({ companyId: companyId || "", ...params }).toString();
  return apiFetch(`/admin/global-payroll/runs?${query}`);
};

export const fetchGlobalPayrollRunDetails = (runId) => {
  return apiFetch(`/admin/global-payroll/runs/${runId}`);
};

export const fetchAdminPayslips = (companyId, params = {}) => {
  const query = new URLSearchParams({ companyId: companyId || "", ...params }).toString();
  return apiFetch(`/admin/global-payroll/payslips?${query}`);
};

export const fetchMyEmployeePayslips = () => {
  return apiFetch("/global-payroll/my-payslips");
};

export const fetchGlobalPayrollReports = (companyId, params = {}) => {
  const query = new URLSearchParams({ companyId: companyId || "", ...params }).toString();
  return apiFetch(`/admin/global-payroll/reports?${query}`);
};

export const exportWpsSif = (runId, payload = {}) => {
  return apiFetch(`/admin/global-payroll/runs/${runId}/wps-export`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const fetchPayrollAuditLogs = (companyId, params = {}) => {
  const query = new URLSearchParams({ companyId: companyId || "", ...params }).toString();
  return apiFetch(`/admin/global-payroll/audit-logs?${query}`);
};

