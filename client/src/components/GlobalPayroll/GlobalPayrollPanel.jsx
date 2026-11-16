import React, { useState, useEffect } from "react";
import {
  Globe2,
  Coins,
  TrendingUp,
  Landmark,
  FileText,
  Users,
  PlayCircle,
  Receipt,
  BarChart3,
  History,
  ShieldAlert,
  Plus,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Search,
  Filter,
  Download,
  ChevronRight,
  Eye,
  Check,
  X,
  FileSpreadsheet,
  Lock,
  Unlock,
  Building2,
  CreditCard,
  Percent,
  Clock
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  fetchGlobalPayrollOverview,
  fetchCurrencies,
  createCurrency,
  updateCurrency,
  fetchExchangeRates,
  createExchangeRate,
  convertCurrencyAmount,
  fetchCountryConfigs,
  updateCountryConfig,
  fetchTaxRules,
  createTaxRule,
  updateTaxRule,
  fetchEmployeesPayrollProfiles,
  saveEmployeePayrollProfile,
  calculateGlobalPayroll,
  processGlobalPayrollRun,
  approveGlobalPayrollRun,
  reverseGlobalPayrollRun,
  fetchGlobalPayrollRuns,
  fetchGlobalPayrollRunDetails,
  fetchAdminPayslips,
  fetchGlobalPayrollReports,
  exportWpsSif,
  fetchPayrollAuditLogs
} from "../../services/globalPayrollApi";

const SECTIONS = [
  { id: "overview", label: "Overview", icon: Globe2 },
  { id: "currencies", label: "Currencies", icon: Coins },
  { id: "exchange-rates", label: "Exchange Rates", icon: TrendingUp },
  { id: "countries", label: "Countries", icon: Landmark },
  { id: "tax-rules", label: "Tax Rules", icon: Percent },
  { id: "employees", label: "Employee Profiles", icon: Users },
  { id: "processing", label: "Process Payroll", icon: PlayCircle },
  { id: "payslips", label: "Payslips", icon: Receipt },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "history", label: "Run History", icon: History },
  { id: "audit-logs", label: "Audit Logs", icon: ShieldAlert }
];

export default function GlobalPayrollPanel() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [activeSection, setActiveSection] = useState("overview");
  const [loading, setLoading] = useState(false);

  // 1. Overview State
  const [overview, setOverview] = useState(null);

  // 2. Currencies State
  const [currencies, setCurrencies] = useState([]);
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  const [currencyForm, setCurrencyForm] = useState({
    code: "",
    name: "",
    symbol: "",
    decimalPrecision: 2,
    isCompanyDefault: false,
    isReportingCurrency: false
  });

  // 3. Exchange Rates State
  const [exchangeRates, setExchangeRates] = useState([]);
  const [showRateModal, setShowRateModal] = useState(false);
  const [rateForm, setRateForm] = useState({
    fromCurrency: "USD",
    toCurrency: "INR",
    rate: "",
    effectiveDate: new Date().toISOString().split("T")[0]
  });
  const [converter, setConverter] = useState({
    amount: "1000",
    from: "USD",
    to: "INR",
    result: null,
    loading: false
  });

  // 4. Countries State
  const [countryConfigs, setCountryConfigs] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [showCountryModal, setShowCountryModal] = useState(false);

  // 5. Tax Rules State
  const [taxRules, setTaxRules] = useState([]);
  const [taxCountryFilter, setTaxCountryFilter] = useState("ALL");
  const [taxYearFilter, setTaxYearFilter] = useState("2026");
  const [showTaxModal, setShowTaxModal] = useState(false);
  const [taxForm, setTaxForm] = useState({
    countryCode: "US",
    taxType: "federal_income_tax",
    stateOrRegion: "all",
    taxYear: 2026,
    status: "verified",
    description: "",
    rulesDataStr: JSON.stringify({ standardDeduction: 15000, brackets: [] }, null, 2)
  });

  // 6. Employees State
  const [employeeProfiles, setEmployeeProfiles] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({
    countryCode: "US",
    employmentClassification: "w2",
    salaryCurrency: "USD",
    annualSalary: "120000",
    monthlyBaseSalary: "10000",
    payFrequency: "monthly",
    filingStatus: "single",
    state: "CA",
    taxCode: "1257L",
    niCategory: "A",
    pensionRate: 0.05,
    housingAllowance: "0",
    transportAllowance: "0",
    iban: "",
    bankName: "",
    routingCode: ""
  });

  // 7. Processing State
  const [processingForm, setProcessingForm] = useState({
    countryCode: "US",
    currency: "USD",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    payDate: "2026-01-31",
    payFrequency: "monthly"
  });
  const [calculatedRun, setCalculatedRun] = useState(null);
  const [processingLoading, setProcessingLoading] = useState(false);

  // 8. Payslips State
  const [payslips, setPayslips] = useState([]);
  const [selectedPayslip, setSelectedPayslip] = useState(null);
  const [showPayslipModal, setShowPayslipModal] = useState(false);
  const [payslipFilterCountry, setPayslipFilterCountry] = useState("ALL");
  const [payslipSearch, setPayslipSearch] = useState("");

  // 9. Reports State
  const [reportsData, setReportsData] = useState(null);

  // 10. Run History State
  const [runsHistory, setRunsHistory] = useState([]);
  const [reversalRunId, setReversalRunId] = useState(null);
  const [reversalReason, setReversalReason] = useState("");
  const [showReversalModal, setShowReversalModal] = useState(false);
  const [selectedRunDetails, setSelectedRunDetails] = useState(null);

  // 11. Audit Logs State
  const [auditLogs, setAuditLogs] = useState([]);

  // Fetch initial data based on active section
  useEffect(() => {
    if (!currentUser?.companyId) return;

    if (activeSection === "overview") loadOverview();
    else if (activeSection === "currencies") loadCurrencies();
    else if (activeSection === "exchange-rates") loadExchangeRates();
    else if (activeSection === "countries") loadCountryConfigs();
    else if (activeSection === "tax-rules") loadTaxRules();
    else if (activeSection === "employees") loadEmployeeProfiles();
    else if (activeSection === "payslips") loadPayslips();
    else if (activeSection === "reports") loadReports();
    else if (activeSection === "history") loadRunsHistory();
    else if (activeSection === "audit-logs") loadAuditLogs();
  }, [activeSection, currentUser?.companyId]);

  // Load functions
  const loadOverview = async () => {
    setLoading(true);
    try {
      const data = await fetchGlobalPayrollOverview(currentUser.companyId);
      setOverview(data);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadCurrencies = async () => {
    setLoading(true);
    try {
      const data = await fetchCurrencies(currentUser.companyId);
      setCurrencies(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadExchangeRates = async () => {
    setLoading(true);
    try {
      const data = await fetchExchangeRates(currentUser.companyId);
      setExchangeRates(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadCountryConfigs = async () => {
    setLoading(true);
    try {
      const data = await fetchCountryConfigs(currentUser.companyId);
      setCountryConfigs(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadTaxRules = async () => {
    setLoading(true);
    try {
      const params = {};
      if (taxCountryFilter !== "ALL") params.country = taxCountryFilter;
      if (taxYearFilter) params.year = taxYearFilter;
      const data = await fetchTaxRules(currentUser.companyId, params);
      setTaxRules(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadEmployeeProfiles = async () => {
    setLoading(true);
    try {
      const data = await fetchEmployeesPayrollProfiles(currentUser.companyId);
      setEmployeeProfiles(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadPayslips = async () => {
    setLoading(true);
    try {
      const params = {};
      if (payslipFilterCountry !== "ALL") params.country = payslipFilterCountry;
      if (payslipSearch) params.search = payslipSearch;
      const data = await fetchAdminPayslips(currentUser.companyId, params);
      setPayslips(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadReports = async () => {
    setLoading(true);
    try {
      const data = await fetchGlobalPayrollReports(currentUser.companyId);
      setReportsData(data);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadRunsHistory = async () => {
    setLoading(true);
    try {
      const data = await fetchGlobalPayrollRuns(currentUser.companyId);
      setRunsHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    setLoading(true);
    try {
      const data = await fetchPayrollAuditLogs(currentUser.companyId);
      setAuditLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  // Handlers
  const handleSaveCurrency = async (e) => {
    e.preventDefault();
    try {
      await createCurrency({
        ...currencyForm,
        decimalPrecision: parseInt(currencyForm.decimalPrecision, 10)
      });
      showToast(`Currency ${currencyForm.code} saved successfully.`, "success");
      setShowCurrencyModal(false);
      loadCurrencies();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleSaveRate = async (e) => {
    e.preventDefault();
    try {
      await createExchangeRate({
        fromCurrency: rateForm.fromCurrency,
        toCurrency: rateForm.toCurrency,
        rate: parseFloat(rateForm.rate),
        effectiveDate: rateForm.effectiveDate
      });
      showToast("Exchange rate saved successfully.", "success");
      setShowRateModal(false);
      loadExchangeRates();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleTestConvert = async () => {
    if (!converter.amount || !converter.from || !converter.to) return;
    setConverter(prev => ({ ...prev, loading: true, result: null }));
    try {
      const res = await convertCurrencyAmount({
        amount: converter.amount,
        from: converter.from,
        to: converter.to
      });
      setConverter(prev => ({ ...prev, result: res }));
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setConverter(prev => ({ ...prev, loading: false }));
    }
  };

  const handleOpenEditProfile = (emp) => {
    setSelectedEmployee(emp);
    const country = emp.country_code || "US";
    const tax = emp.tax_profile || {};
    const bank = emp.bank_details || {};
    const allowances = Array.isArray(emp.allowances) ? emp.allowances : [];

    const housing = allowances.find(a => a.name?.toLowerCase().includes("house") || a.name?.toLowerCase().includes("housing"))?.amount || "0";
    const transport = allowances.find(a => a.name?.toLowerCase().includes("transport"))?.amount || "0";

    setProfileForm({
      countryCode: country,
      employmentClassification: emp.employment_classification || (country === "US" ? "w2" : country === "GB" ? "standard_uk" : country === "AE" ? "wps_uae" : "india_regular"),
      salaryCurrency: emp.salary_currency || (country === "US" ? "USD" : country === "GB" ? "GBP" : country === "AE" ? "AED" : "INR"),
      annualSalary: emp.annual_salary || "120000",
      monthlyBaseSalary: emp.monthly_base_salary || "10000",
      payFrequency: emp.pay_frequency || "monthly",
      filingStatus: tax.filingStatus || "single",
      state: tax.state || "CA",
      taxCode: tax.taxCode || "1257L",
      niCategory: tax.niCategory || "A",
      pensionRate: tax.pensionRate || 0.05,
      housingAllowance: housing.toString(),
      transportAllowance: transport.toString(),
      iban: bank.iban || "",
      bankName: bank.bankName || "",
      routingCode: bank.routingCode || ""
    });
    setShowProfileModal(true);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!selectedEmployee) return;

    try {
      const allowances = [];
      if (profileForm.countryCode === "AE") {
        if (parseFloat(profileForm.housingAllowance) > 0) {
          allowances.push({ name: "Housing Allowance", amount: parseFloat(profileForm.housingAllowance) });
        }
        if (parseFloat(profileForm.transportAllowance) > 0) {
          allowances.push({ name: "Transportation Allowance", amount: parseFloat(profileForm.transportAllowance) });
        }
      }

      const taxProfile = {};
      if (profileForm.countryCode === "US") {
        taxProfile.filingStatus = profileForm.filingStatus;
        taxProfile.state = profileForm.state;
      } else if (profileForm.countryCode === "GB") {
        taxProfile.taxCode = profileForm.taxCode;
        taxProfile.niCategory = profileForm.niCategory;
        taxProfile.pensionRate = parseFloat(profileForm.pensionRate);
      }

      const bankDetails = {};
      if (profileForm.countryCode === "AE" || profileForm.iban) {
        bankDetails.iban = profileForm.iban;
        bankDetails.bankName = profileForm.bankName;
        bankDetails.routingCode = profileForm.routingCode;
      }

      await saveEmployeePayrollProfile(selectedEmployee.user_id, {
        countryCode: profileForm.countryCode,
        employmentClassification: profileForm.employmentClassification,
        salaryCurrency: profileForm.salaryCurrency,
        annualSalary: parseFloat(profileForm.annualSalary || 0),
        monthlyBaseSalary: parseFloat(profileForm.monthlyBaseSalary || 0),
        payFrequency: profileForm.payFrequency,
        allowances,
        taxProfile,
        bankDetails
      });

      showToast(`Payroll profile for ${selectedEmployee.name} updated successfully.`, "success");
      setShowProfileModal(false);
      loadEmployeeProfiles();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleCalculatePayroll = async () => {
    setProcessingLoading(true);
    setCalculatedRun(null);
    try {
      const preview = await calculateGlobalPayroll(processingForm);
      setCalculatedRun(preview);
      showToast(`Calculated preview for ${preview.employeeCount} employees in ${preview.countryCode}.`, "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setProcessingLoading(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!calculatedRun) return;
    setProcessingLoading(true);
    try {
      await processGlobalPayrollRun({ runData: calculatedRun });
      showToast("Payroll run submitted for approval successfully.", "success");
      setCalculatedRun(null);
      setActiveSection("history");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setProcessingLoading(false);
    }
  };

  const handleApproveRun = async (runId) => {
    if (!window.confirm("Are you sure you want to approve this payroll run? This will lock calculations and publish employee payslips.")) return;
    try {
      await approveGlobalPayrollRun(runId);
      showToast("Payroll run approved! Payslips published.", "success");
      loadRunsHistory();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleInitiateReversal = (runId) => {
    setReversalRunId(runId);
    setReversalReason("");
    setShowReversalModal(true);
  };

  const handleConfirmReversal = async () => {
    if (!reversalReason.trim()) {
      return showToast("Reversal reason is mandatory for audit logs.", "warning");
    }
    try {
      await reverseGlobalPayrollRun(reversalRunId, reversalReason.trim());
      showToast("Payroll run reversed successfully.", "success");
      setShowReversalModal(false);
      loadRunsHistory();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleExportWps = async (runId) => {
    try {
      const result = await exportWpsSif(runId);
      if (result.success) {
        showToast(`WPS SIF file generated: ${result.fileName} (${result.recordCount} records, AED ${result.totalAmount})`, "success");
        // Trigger browser file download
        const blob = new Blob([result.fileContent], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = result.fileName;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        showToast(`WPS Validation Warnings: ${result.validationErrors.join("; ")}`, "warning");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleViewRunDetails = async (runId) => {
    try {
      const details = await fetchGlobalPayrollRunDetails(runId);
      setSelectedRunDetails(details);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* HEADER BANNER */}
      <div className="bg-gradient-to-r from-purple-900/40 via-purple-800/20 to-slate-900/40 border border-purple-500/20 rounded-2xl p-6 backdrop-blur-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                Enterprise Admin
              </span>
              <span className="text-xs text-slate-400">Strictly Authorized Personnel Only</span>
            </div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Globe2 className="w-7 h-7 text-purple-400" />
              Global Multi-Currency & International Tax Engine
            </h1>
            <p className="text-sm text-slate-300 mt-1">
              Statutory payroll compliance for India (INR), United States (USD W-2 & 1099), United Kingdom (GBP PAYE/NIC), and UAE (AED WPS).
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (activeSection === "overview") loadOverview();
                else if (activeSection === "currencies") loadCurrencies();
                else if (activeSection === "exchange-rates") loadExchangeRates();
                else if (activeSection === "countries") loadCountryConfigs();
                else if (activeSection === "tax-rules") loadTaxRules();
                else if (activeSection === "employees") loadEmployeeProfiles();
                else if (activeSection === "payslips") loadPayslips();
                else if (activeSection === "reports") loadReports();
                else if (activeSection === "history") loadRunsHistory();
                else if (activeSection === "audit-logs") loadAuditLogs();
              }}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 text-xs font-medium rounded-xl border border-slate-700/60 transition shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <div className="px-3.5 py-1.5 bg-purple-950/60 border border-purple-500/30 rounded-xl text-right">
              <div className="text-[10px] text-purple-300 uppercase tracking-wider font-semibold">Reporting Currency</div>
              <div className="text-sm font-bold text-white">
                {overview?.reportingCurrency?.code || "INR"} ({overview?.reportingCurrency?.symbol || "₹"})
              </div>
            </div>
          </div>
        </div>

        {/* SECTION NAV TABS */}
        <div className="flex items-center gap-1.5 mt-6 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-purple-900 border-t border-purple-500/10 pt-4">
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-600/25 border border-purple-400/40"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-white" : "text-purple-400"}`} />
                {sec.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          1. SECTION: OVERVIEW
      ───────────────────────────────────────────────────────────── */}
      {activeSection === "overview" && (
        <div className="space-y-6">
          {/* Top Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
                <span>Total Payroll Expenditure</span>
                <Landmark className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-2xl font-bold text-white">
                {overview?.reportingCurrency?.symbol || "₹"}{" "}
                {Number(overview?.totalExpenditureReporting?.totalGross || 0).toLocaleString()}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Net: {overview?.reportingCurrency?.symbol || "₹"}{" "}
                {Number(overview?.totalExpenditureReporting?.totalNet || 0).toLocaleString()} ({overview?.reportingCurrency?.code || "INR"})
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
                <span>International Profiles</span>
                <Users className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-white">
                {overview?.internationalProfilesCount || 0}
              </div>
              <div className="text-xs text-emerald-400 mt-1">
                Active global tax profiles configured
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
                <span>Payroll Runs Approved</span>
                <CheckCircle2 className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-2xl font-bold text-white">
                {overview?.runsByStatus?.find(r => r.status === "APPROVED")?.count || 0}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Pending: {overview?.runsByStatus?.find(r => r.status === "PENDING_APPROVAL")?.count || 0} runs
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
                <span>Supported Currencies</span>
                <Coins className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-white">5 Supported</div>
              <div className="text-xs text-amber-400 mt-1">
                INR, USD, EUR, GBP, AED
              </div>
            </div>
          </div>

          {/* Breakdown Grids */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Country Distribution */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Globe2 className="w-4 h-4 text-purple-400" />
                Employees by Country
              </h3>
              <div className="space-y-3">
                {overview?.employeesByCountry?.length > 0 ? (
                  overview.employeesByCountry.map((item) => {
                    const countryNames = { IN: "India (INR)", US: "United States (USD)", GB: "United Kingdom (GBP)", AE: "United Arab Emirates (AED)" };
                    return (
                      <div key={item.country_code} className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl border border-slate-700/40">
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center font-bold text-xs border border-purple-500/20">
                            {item.country_code}
                          </span>
                          <span className="text-sm text-slate-200 font-medium">
                            {countryNames[item.country_code] || item.country_code}
                          </span>
                        </div>
                        <span className="text-xs px-2.5 py-1 rounded-full bg-slate-700/60 text-slate-200 font-semibold">
                          {item.count} Employees
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-400 py-4 text-center">No employee country assignments found.</p>
                )}
              </div>
            </div>

            {/* Expenditure by Currency */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Coins className="w-4 h-4 text-purple-400" />
                Expenditure by Currency (Approved Runs)
              </h3>
              <div className="space-y-3">
                {overview?.expenditureByCurrency?.length > 0 ? (
                  overview.expenditureByCurrency.map((item) => (
                    <div key={item.currency} className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl border border-slate-700/40">
                      <div>
                        <div className="text-sm font-bold text-white">{item.currency}</div>
                        <div className="text-xs text-slate-400">Total Runs: {item.runs_count}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-emerald-400">
                          {Number(item.total_net).toLocaleString()} {item.currency}
                        </div>
                        <div className="text-[11px] text-slate-400">Gross: {Number(item.total_gross).toLocaleString()}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400 py-4 text-center">No approved payroll runs yet.</p>
                )}
              </div>
            </div>
          </div>

          {/* Recent Audit Activities */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-purple-400" />
              Recent Global Payroll Audit Events
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">User</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Entity</th>
                    <th className="p-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {overview?.recentActivities?.length > 0 ? (
                    overview.recentActivities.map((act) => (
                      <tr key={act.id} className="hover:bg-slate-800/30">
                        <td className="p-3 whitespace-nowrap text-slate-400">
                          {new Date(act.created_at).toLocaleString()}
                        </td>
                        <td className="p-3 font-medium text-white">{act.user_name} ({act.user_role})</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-300 border border-purple-500/20">
                            {act.action}
                          </span>
                        </td>
                        <td className="p-3 text-slate-400">{act.entity_type} {act.entity_id ? `(#${act.entity_id.slice(-6)})` : ""}</td>
                        <td className="p-3 max-w-xs truncate text-slate-400">
                          {act.updated_values ? JSON.stringify(act.updated_values) : "-"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" className="p-4 text-center text-slate-500">No recent audit logs.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          2. SECTION: CURRENCY MANAGEMENT
      ───────────────────────────────────────────────────────────── */}
      {activeSection === "currencies" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Supported Currencies</h2>
              <p className="text-xs text-slate-400">Configure enabled currencies, default base currency, and reporting currency.</p>
            </div>
            <button
              onClick={() => {
                setCurrencyForm({
                  code: "",
                  name: "",
                  symbol: "",
                  decimalPrecision: 2,
                  isCompanyDefault: false,
                  isReportingCurrency: false
                });
                setShowCurrencyModal(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-purple-600/20 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Currency
            </button>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3">Currency</th>
                  <th className="p-3">Code</th>
                  <th className="p-3">Symbol</th>
                  <th className="p-3">Precision</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {currencies.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/30">
                    <td className="p-3 font-semibold text-white">{c.name}</td>
                    <td className="p-3">
                      <span className="font-mono font-bold text-purple-400 bg-purple-950/40 px-2 py-0.5 rounded border border-purple-800/40">
                        {c.code}
                      </span>
                    </td>
                    <td className="p-3 font-bold text-slate-200">{c.symbol}</td>
                    <td className="p-3 text-slate-400">{c.decimal_precision} decimals</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        {c.is_company_default && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Default
                          </span>
                        )}
                        {c.is_reporting_currency && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            Reporting
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.is_enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                        {c.is_enabled ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={async () => {
                          await updateCurrency(c.id, { isEnabled: !c.is_enabled });
                          showToast(`Currency ${c.code} updated.`, "success");
                          loadCurrencies();
                        }}
                        className="text-xs text-purple-400 hover:text-purple-300 font-medium"
                      >
                        {c.is_enabled ? "Disable" : "Enable"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          3. SECTION: EXCHANGE RATES
      ───────────────────────────────────────────────────────────── */}
      {activeSection === "exchange-rates" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Exchange Rates Engine</h2>
              <p className="text-xs text-slate-400">Maintains historical rates with effective dates and strict Decimal precision.</p>
            </div>
            <button
              onClick={() => {
                setRateForm({
                  fromCurrency: "USD",
                  toCurrency: "INR",
                  rate: "",
                  effectiveDate: new Date().toISOString().split("T")[0]
                });
                setShowRateModal(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-purple-600/20 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Exchange Rate
            </button>
          </div>

          {/* Interactive Currency Conversion Tester */}
          <div className="bg-gradient-to-r from-slate-900 to-purple-950/40 border border-slate-800 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-400" />
              Live Precision Currency Converter Tester
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={converter.amount}
                  onChange={(e) => setConverter({ ...converter, amount: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">From Currency</label>
                <select
                  value={converter.from}
                  onChange={(e) => setConverter({ ...converter, from: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                >
                  {["USD", "INR", "GBP", "EUR", "AED"].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">To Currency</label>
                <select
                  value={converter.to}
                  onChange={(e) => setConverter({ ...converter, to: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                >
                  {["INR", "USD", "GBP", "EUR", "AED"].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <button
                onClick={handleTestConvert}
                disabled={converter.loading}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl transition"
              >
                {converter.loading ? "Calculating..." : "Convert Amount"}
              </button>
            </div>

            {converter.result && (
              <div className="mt-4 p-3 bg-purple-900/20 border border-purple-500/30 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">Conversion Result ({converter.result.source})</div>
                  <div className="text-lg font-bold text-white">
                    {converter.result.originalAmount} {converter.result.fromCurrency} ={" "}
                    <span className="text-emerald-400">{converter.result.convertedAmount} {converter.result.toCurrency}</span>
                  </div>
                </div>
                <div className="text-xs text-right text-slate-400 font-mono">
                  Rate: 1 {converter.result.fromCurrency} = {converter.result.exchangeRate} {converter.result.toCurrency}
                </div>
              </div>
            )}
          </div>

          {/* Rates Table */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3">Currency Pair</th>
                  <th className="p-3">Exchange Rate</th>
                  <th className="p-3">Effective Date</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Created At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {exchangeRates.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="p-3 font-bold text-white">
                      <span className="text-purple-400">{r.from_currency}</span> &rarr; <span className="text-emerald-400">{r.to_currency}</span>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-200">
                      {parseFloat(r.rate).toFixed(6)}
                    </td>
                    <td className="p-3 text-slate-400">{new Date(r.effective_date).toLocaleDateString()}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {r.source}
                      </span>
                    </td>
                    <td className="p-3 text-slate-400">{new Date(r.created_at).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          4. SECTION: COUNTRY CONFIGURATION
      ───────────────────────────────────────────────────────────── */}
      {activeSection === "countries" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-bold text-white">Country Payroll Configurations</h2>
            <p className="text-xs text-slate-400">Settings for India, United States, United Kingdom, and UAE WPS.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {countryConfigs.map((c) => (
              <div key={c.id} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 hover:border-purple-500/30 transition">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center font-bold text-sm border border-purple-500/30">
                      {c.country_code}
                    </span>
                    <div>
                      <h3 className="text-base font-bold text-white">{c.country_name}</h3>
                      <span className="text-xs text-slate-400 font-mono">Currency: {c.default_currency}</span>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${c.is_active ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                    {c.is_active ? "Active" : "Disabled"}
                  </span>
                </div>

                <div className="space-y-2 text-xs text-slate-300 my-4 border-t border-slate-800 pt-3">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Supported Frequencies:</span>
                    <span className="font-semibold text-slate-200">
                      {Array.isArray(c.supported_frequencies) ? c.supported_frequencies.join(", ") : "Monthly"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">WPS Compliance:</span>
                    <span className={`font-semibold ${c.wps_enabled ? "text-emerald-400" : "text-slate-400"}`}>
                      {c.wps_enabled ? "Enabled (MOHRE/CBUAE)" : "Not Applicable"}
                    </span>
                  </div>
                  {c.wps_enabled && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Employer EID:</span>
                      <span className="font-mono text-purple-400">{c.wps_employer_eid || "Not Configured"}</span>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => {
                    setSelectedCountry(c);
                    setShowCountryModal(true);
                  }}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-purple-300 rounded-xl transition"
                >
                  Configure Country Parameters
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          5. SECTION: INTERNATIONAL TAX CONFIGURATION
      ───────────────────────────────────────────────────────────── */}
      {activeSection === "tax-rules" && (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-white">International Tax Rules Engine</h2>
              <p className="text-xs text-slate-400">Effective-dated progressive tax brackets and statutory contribution rates.</p>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={taxCountryFilter}
                onChange={(e) => setTaxCountryFilter(e.target.value)}
                className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
              >
                <option value="ALL">All Countries</option>
                <option value="US">United States (US)</option>
                <option value="GB">United Kingdom (GB)</option>
                <option value="AE">United Arab Emirates (AE)</option>
                <option value="IN">India (IN)</option>
              </select>

              <button
                onClick={() => {
                  setTaxForm({
                    countryCode: "US",
                    taxType: "federal_income_tax",
                    stateOrRegion: "all",
                    taxYear: 2026,
                    status: "verified",
                    description: "",
                    rulesDataStr: JSON.stringify({ standardDeduction: 15000, brackets: [] }, null, 2)
                  });
                  setShowTaxModal(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Tax Rule
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {taxRules.map((rule) => (
              <div key={rule.id} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 hover:border-purple-500/30 transition flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-purple-400 bg-purple-950/40 px-2.5 py-0.5 rounded-full text-xs border border-purple-800/40">
                      {rule.country_code} • {rule.tax_year}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${rule.status === "verified" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                      {rule.status === "verified" ? "Verified" : "Pending Verification"}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white mb-1">{rule.tax_type.toUpperCase()}</h4>
                  <p className="text-xs text-slate-400 mb-3 line-clamp-2">{rule.description || "Statutory tax configuration"}</p>
                </div>

                <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/40 font-mono text-[11px] text-slate-300 max-h-32 overflow-y-auto">
                  <pre>{JSON.stringify(rule.rules_data, null, 2)}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          6. SECTION: EMPLOYEE PAYROLL PROFILES
      ───────────────────────────────────────────────────────────── */}
      {activeSection === "employees" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Employee Global Payroll Profiles</h2>
              <p className="text-xs text-slate-400">Configure salary currency, employment classification (W-2 vs 1099), tax codes, and allowances.</p>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3">Employee</th>
                  <th className="p-3">Country</th>
                  <th className="p-3">Classification</th>
                  <th className="p-3">Currency</th>
                  <th className="p-3">Annual / Monthly Base</th>
                  <th className="p-3">Frequency</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {employeeProfiles.map((emp) => (
                  <tr key={emp.user_id} className="hover:bg-slate-800/30">
                    <td className="p-3">
                      <div className="font-semibold text-white">{emp.name}</div>
                      <div className="text-[11px] text-slate-400">{emp.email}</div>
                    </td>
                    <td className="p-3 font-semibold text-purple-400">{emp.country_code || "IN"}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-200 border border-slate-700 uppercase">
                        {emp.employment_classification || "regular"}
                      </span>
                    </td>
                    <td className="p-3 font-bold text-emerald-400">{emp.salary_currency || "INR"}</td>
                    <td className="p-3 font-mono font-medium text-slate-200">
                      {emp.salary_currency || "INR"} {Number(emp.monthly_base_salary || 0).toLocaleString()} /mo
                    </td>
                    <td className="p-3 text-slate-400 capitalize">{emp.pay_frequency || "monthly"}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleOpenEditProfile(emp)}
                        className="px-3 py-1 bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white rounded-lg text-xs font-semibold transition"
                      >
                        Configure Profile
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          7. SECTION: GLOBAL PAYROLL PROCESSING
      ───────────────────────────────────────────────────────────── */}
      {activeSection === "processing" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-bold text-white">Global Payroll Calculation & Processing</h2>
            <p className="text-xs text-slate-400">Calculate statutory taxes, view preview breakdown, and submit for approval.</p>
          </div>

          {/* Configuration Form Card */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <PlayCircle className="w-4 h-4 text-purple-400" />
              1. Setup Payroll Calculation Run
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Target Country</label>
                <select
                  value={processingForm.countryCode}
                  onChange={(e) => {
                    const c = e.target.value;
                    const curr = c === "US" ? "USD" : c === "GB" ? "GBP" : c === "AE" ? "AED" : "INR";
                    setProcessingForm({ ...processingForm, countryCode: c, currency: curr });
                  }}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                >
                  <option value="US">United States (USD)</option>
                  <option value="GB">United Kingdom (GBP)</option>
                  <option value="AE">United Arab Emirates (AED)</option>
                  <option value="IN">India (INR)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Pay Currency</label>
                <input
                  type="text"
                  readOnly
                  value={processingForm.currency}
                  className="w-full px-3 py-2 bg-slate-800/60 border border-slate-700 rounded-xl text-xs font-mono font-bold text-purple-400"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Period Start</label>
                <input
                  type="date"
                  value={processingForm.periodStart}
                  onChange={(e) => setProcessingForm({ ...processingForm, periodStart: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Period End</label>
                <input
                  type="date"
                  value={processingForm.periodEnd}
                  onChange={(e) => setProcessingForm({ ...processingForm, periodEnd: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Frequency</label>
                <select
                  value={processingForm.payFrequency}
                  onChange={(e) => setProcessingForm({ ...processingForm, payFrequency: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                >
                  <option value="monthly">Monthly</option>
                  <option value="biweekly">Bi-Weekly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  onClick={handleCalculatePayroll}
                  disabled={processingLoading}
                  className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-purple-600/20 transition flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${processingLoading ? "animate-spin" : ""}`} />
                  Calculate Run
                </button>
              </div>
            </div>
          </div>

          {/* Calculation Preview Output */}
          {calculatedRun && (
            <div className="bg-slate-900/60 border border-purple-500/30 rounded-2xl p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <span className="text-xs font-mono text-purple-400 bg-purple-950/40 px-2 py-0.5 rounded border border-purple-800/40">
                    {calculatedRun.runNumber}
                  </span>
                  <h3 className="text-base font-bold text-white mt-1">
                    Payroll Preview: {calculatedRun.employeeCount} Employees ({calculatedRun.currency})
                  </h3>
                  <div className="text-xs text-slate-400">
                    Period: {calculatedRun.periodStart} to {calculatedRun.periodEnd} | FX Rate to Reporting ({calculatedRun.reportingCurrency}): {calculatedRun.reportingExchangeRate}
                  </div>
                </div>

                <button
                  onClick={handleSubmitForApproval}
                  disabled={processingLoading}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/20 transition"
                >
                  Submit Payroll Run For Approval
                </button>
              </div>

              {/* Total Run Metrics Bar */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-800/40 p-4 rounded-xl border border-slate-700/40">
                <div>
                  <div className="text-[11px] text-slate-400">Total Gross Salary</div>
                  <div className="text-base font-bold text-white">
                    {calculatedRun.currency} {Number(calculatedRun.totalGross).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Total Statutory Taxes</div>
                  <div className="text-base font-bold text-rose-400">
                    - {calculatedRun.currency} {Number(calculatedRun.totalStatutoryDeductions).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Employer Contributions</div>
                  <div className="text-base font-bold text-amber-400">
                    + {calculatedRun.currency} {Number(calculatedRun.totalEmployerContributions).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Total Net Disbursed</div>
                  <div className="text-base font-bold text-emerald-400">
                    {calculatedRun.currency} {Number(calculatedRun.totalNet).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-3">Employee</th>
                      <th className="p-3">Class</th>
                      <th className="p-3">Gross ({calculatedRun.currency})</th>
                      <th className="p-3">Statutory Taxes</th>
                      <th className="p-3">Other Deductions</th>
                      <th className="p-3">Employer Tax</th>
                      <th className="p-3">Net Pay</th>
                      <th className="p-3">Reporting ({calculatedRun.reportingCurrency})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    {calculatedRun.items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/30">
                        <td className="p-3 font-semibold text-white">{item.employeeName}</td>
                        <td className="p-3 uppercase text-[10px] text-purple-300">{item.employmentClassification}</td>
                        <td className="p-3 font-mono">{parseFloat(item.grossSalary).toFixed(2)}</td>
                        <td className="p-3 text-rose-400 font-mono">-{parseFloat(item.statutoryDeductions).toFixed(2)}</td>
                        <td className="p-3 text-slate-400 font-mono">-{parseFloat(item.otherDeductions).toFixed(2)}</td>
                        <td className="p-3 text-amber-400 font-mono">+{parseFloat(item.employerContributions).toFixed(2)}</td>
                        <td className="p-3 font-bold text-emerald-400 font-mono">{parseFloat(item.netSalary).toFixed(2)}</td>
                        <td className="p-3 text-slate-300 font-mono">{parseFloat(item.netReporting).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          8. SECTION: PAYSLIP MANAGEMENT
      ───────────────────────────────────────────────────────────── */}
      {activeSection === "payslips" && (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-white">Global Payslip Management</h2>
              <p className="text-xs text-slate-400">Browse, inspect, and export published employee payslips across countries.</p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Search employee name/email..."
                value={payslipSearch}
                onChange={(e) => setPayslipSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadPayslips()}
                className="px-3.5 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
              />
              <select
                value={payslipFilterCountry}
                onChange={(e) => {
                  setPayslipFilterCountry(e.target.value);
                  setTimeout(loadPayslips, 50);
                }}
                className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
              >
                <option value="ALL">All Countries</option>
                <option value="US">US (USD)</option>
                <option value="GB">UK (GBP)</option>
                <option value="AE">UAE (AED)</option>
                <option value="IN">India (INR)</option>
              </select>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3">Employee</th>
                  <th className="p-3">Country</th>
                  <th className="p-3">Period</th>
                  <th className="p-3">Gross Salary</th>
                  <th className="p-3">Taxes</th>
                  <th className="p-3">Employer Tax</th>
                  <th className="p-3">Net Pay</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {payslips.map((ps) => (
                  <tr key={ps.id} className="hover:bg-slate-800/30">
                    <td className="p-3 font-semibold text-white">{ps.employee_name}</td>
                    <td className="p-3 font-mono font-bold text-purple-400">{ps.country_code}</td>
                    <td className="p-3 text-slate-400">{ps.period_start ? new Date(ps.period_start).toLocaleDateString() : "-"}</td>
                    <td className="p-3 font-mono">{ps.currency} {parseFloat(ps.gross_salary).toFixed(2)}</td>
                    <td className="p-3 text-rose-400 font-mono">-{parseFloat(ps.statutory_deductions).toFixed(2)}</td>
                    <td className="p-3 text-amber-400 font-mono">+{parseFloat(ps.employer_contributions).toFixed(2)}</td>
                    <td className="p-3 font-bold text-emerald-400 font-mono">{ps.currency} {parseFloat(ps.net_salary).toFixed(2)}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ps.is_published ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                        {ps.is_published ? "Published" : "Draft"}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => {
                          setSelectedPayslip(ps);
                          setShowPayslipModal(true);
                        }}
                        className="px-2.5 py-1 bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white rounded-lg text-xs font-semibold transition"
                      >
                        Inspect Payslip
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          9. SECTION: PAYROLL REPORTS
      ───────────────────────────────────────────────────────────── */}
      {activeSection === "reports" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Global Payroll Reports & Analytics</h2>
              <p className="text-xs text-slate-400">Aggregated statutory deductions, employer liabilities, and reporting currency conversions.</p>
            </div>
            <button
              onClick={() => {
                if (!reportsData?.breakdown) return;
                const csvHeader = "Country,Currency,PayslipCount,TotalGross,TaxDeductions,EmployerContributions,NetPay,ReportingNet\n";
                const rows = reportsData.breakdown.map(b => 
                  `${b.country_code},${b.currency},${b.payslip_count},${b.total_gross},${b.total_tax_deductions},${b.total_employer_contributions},${b.total_net},${b.total_net_reporting}`
                ).join("\n");
                const blob = new Blob([csvHeader + rows], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `Global_Payroll_Report_${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {reportsData?.breakdown?.map((b) => (
              <div key={b.country_code + b.currency} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-base text-white">{b.country_code} ({b.currency})</span>
                  <span className="text-xs text-purple-400 font-semibold">{b.payslip_count} Payslips</span>
                </div>
                <div className="space-y-2 text-xs border-t border-slate-800 pt-3">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Gross:</span>
                    <span className="font-bold text-white">{Number(b.total_gross).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Tax Deductions:</span>
                    <span className="text-rose-400">-{Number(b.total_tax_deductions).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Employer Taxes:</span>
                    <span className="text-amber-400">+{Number(b.total_employer_contributions).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-1 font-bold">
                    <span className="text-slate-300">Net Disbursed:</span>
                    <span className="text-emerald-400">{Number(b.total_net).toLocaleString()} {b.currency}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 text-right">
                    Converted: {reportsData.reportingCurrency.symbol} {Number(b.total_net_reporting).toLocaleString()} ({reportsData.reportingCurrency.code})
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          10. SECTION: RUN HISTORY & APPROVALS
      ───────────────────────────────────────────────────────────── */}
      {activeSection === "history" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-bold text-white">Global Payroll Run History</h2>
            <p className="text-xs text-slate-400">Manage payroll statuses (DRAFT, PENDING_APPROVAL, APPROVED, REVERSED), approvals, and WPS exports.</p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3">Run Number</th>
                  <th className="p-3">Country</th>
                  <th className="p-3">Period</th>
                  <th className="p-3">Employees</th>
                  <th className="p-3">Total Net</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {runsHistory.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-800/30">
                    <td className="p-3 font-mono font-bold text-white">{run.run_number}</td>
                    <td className="p-3 font-bold text-purple-400">{run.country_code} ({run.currency})</td>
                    <td className="p-3 text-slate-400">
                      {new Date(run.period_start).toLocaleDateString()} &rarr; {new Date(run.period_end).toLocaleDateString()}
                    </td>
                    <td className="p-3 font-semibold text-slate-200">{run.employee_count}</td>
                    <td className="p-3 font-bold text-emerald-400 font-mono">
                      {run.currency} {parseFloat(run.total_net).toFixed(2)}
                    </td>
                    <td className="p-3">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        run.status === "APPROVED" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                        run.status === "PENDING_APPROVAL" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                        run.status === "REVERSED" ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                        "bg-slate-700/60 text-slate-300"
                      }`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="p-3 text-right space-x-2">
                      {run.status === "PENDING_APPROVAL" && (
                        <button
                          onClick={() => handleApproveRun(run.id)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition"
                        >
                          Approve
                        </button>
                      )}

                      {run.country_code === "AE" && run.status === "APPROVED" && (
                        <button
                          onClick={() => handleExportWps(run.id)}
                          className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white rounded-lg text-xs font-semibold transition"
                        >
                          Export WPS SIF
                        </button>
                      )}

                      {run.status === "APPROVED" && (
                        <button
                          onClick={() => handleInitiateReversal(run.id)}
                          className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white rounded-lg text-xs font-semibold transition"
                        >
                          Reverse
                        </button>
                      )}

                      <button
                        onClick={() => handleViewRunDetails(run.id)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          11. SECTION: AUDIT LOGS
      ───────────────────────────────────────────────────────────── */}
      {activeSection === "audit-logs" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-bold text-white">Global Payroll Audit Logs</h2>
            <p className="text-xs text-slate-400">Tamper-evident administrative audit trail with company isolation and sanitized records.</p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Admin User</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Entity Type</th>
                  <th className="p-3">Target ID</th>
                  <th className="p-3">Updated Values</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300 font-mono text-[11px]">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/30">
                    <td className="p-3 text-slate-400 whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                    <td className="p-3 text-white font-sans font-semibold">{log.user_name}</td>
                    <td className="p-3 font-bold text-purple-400">{log.action}</td>
                    <td className="p-3 text-slate-300">{log.entity_type}</td>
                    <td className="p-3 text-slate-400">{log.entity_id ? log.entity_id.slice(-8) : "-"}</td>
                    <td className="p-3 max-w-sm truncate text-slate-400">{log.updated_values ? JSON.stringify(log.updated_values) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODALS
      ───────────────────────────────────────────────────────────── */}

      {/* MODAL 1: Currency Add */}
      {showCurrencyModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Add Supported Currency</h3>
              <button onClick={() => setShowCurrencyModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleSaveCurrency} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Currency Code (3 letters)</label>
                <input
                  type="text"
                  maxLength={3}
                  required
                  placeholder="e.g. EUR"
                  value={currencyForm.code}
                  onChange={(e) => setCurrencyForm({ ...currencyForm, code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white uppercase font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Currency Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Euro"
                  value={currencyForm.name}
                  onChange={(e) => setCurrencyForm({ ...currencyForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Currency Symbol</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. €"
                  value={currencyForm.symbol}
                  onChange={(e) => setCurrencyForm({ ...currencyForm, symbol: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                />
              </div>
              <div className="flex gap-4 pt-2">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={currencyForm.isCompanyDefault}
                    onChange={(e) => setCurrencyForm({ ...currencyForm, isCompanyDefault: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-700 text-purple-600"
                  />
                  Company Default
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={currencyForm.isReportingCurrency}
                    onChange={(e) => setCurrencyForm({ ...currencyForm, isReportingCurrency: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-700 text-purple-600"
                  />
                  Reporting Currency
                </label>
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl transition mt-4"
              >
                Save Currency
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Exchange Rate Add */}
      {showRateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Add Exchange Rate Pair</h3>
              <button onClick={() => setShowRateModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleSaveRate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">From Currency</label>
                  <select
                    value={rateForm.fromCurrency}
                    onChange={(e) => setRateForm({ ...rateForm, fromCurrency: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                  >
                    {["USD", "INR", "GBP", "EUR", "AED"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">To Currency</label>
                  <select
                    value={rateForm.toCurrency}
                    onChange={(e) => setRateForm({ ...rateForm, toCurrency: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                  >
                    {["INR", "USD", "GBP", "EUR", "AED"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Exchange Rate (Strictly Positive)</label>
                <input
                  type="number"
                  step="0.000001"
                  required
                  placeholder="e.g. 86.500000"
                  value={rateForm.rate}
                  onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Effective Date</label>
                <input
                  type="date"
                  required
                  value={rateForm.effectiveDate}
                  onChange={(e) => setRateForm({ ...rateForm, effectiveDate: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl transition mt-4"
              >
                Save Exchange Rate
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Employee Payroll Profile Edit */}
      {showProfileModal && selectedEmployee && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Configure Payroll Profile</h3>
                <p className="text-xs text-slate-400">{selectedEmployee.name} ({selectedEmployee.email})</p>
              </div>
              <button onClick={() => setShowProfileModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Payroll Country</label>
                  <select
                    value={profileForm.countryCode}
                    onChange={(e) => {
                      const c = e.target.value;
                      const curr = c === "US" ? "USD" : c === "GB" ? "GBP" : c === "AE" ? "AED" : "INR";
                      const cls = c === "US" ? "w2" : c === "GB" ? "standard_uk" : c === "AE" ? "wps_uae" : "india_regular";
                      setProfileForm({ ...profileForm, countryCode: c, salaryCurrency: curr, employmentClassification: cls });
                    }}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white font-semibold"
                  >
                    <option value="US">United States (USD)</option>
                    <option value="GB">United Kingdom (GBP)</option>
                    <option value="AE">United Arab Emirates (AED)</option>
                    <option value="IN">India (INR)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Salary Currency</label>
                  <select
                    value={profileForm.salaryCurrency}
                    onChange={(e) => setProfileForm({ ...profileForm, salaryCurrency: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                  >
                    {["USD", "INR", "GBP", "EUR", "AED"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Dynamic Country Settings */}
              {profileForm.countryCode === "US" && (
                <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-700/40 space-y-3">
                  <div className="text-xs font-semibold text-purple-300">United States Classification & Withholding</div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Employment Classification</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1.5 text-xs text-slate-200">
                        <input
                          type="radio"
                          name="us_classification"
                          value="w2"
                          checked={profileForm.employmentClassification === "w2"}
                          onChange={(e) => setProfileForm({ ...profileForm, employmentClassification: e.target.value })}
                        />
                        W-2 Employee (FICA, FIT, Medicare)
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-200">
                        <input
                          type="radio"
                          name="us_classification"
                          value="1099"
                          checked={profileForm.employmentClassification === "1099"}
                          onChange={(e) => setProfileForm({ ...profileForm, employmentClassification: e.target.value })}
                        />
                        1099 Independent Contractor (Gross)
                      </label>
                    </div>
                  </div>

                  {profileForm.employmentClassification === "w2" && (
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Filing Status</label>
                        <select
                          value={profileForm.filingStatus}
                          onChange={(e) => setProfileForm({ ...profileForm, filingStatus: e.target.value })}
                          className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                        >
                          <option value="single">Single Filer</option>
                          <option value="married_joint">Married Filing Jointly</option>
                          <option value="head_of_household">Head of Household</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">State Withholding</label>
                        <input
                          type="text"
                          placeholder="e.g. CA, NY, TX"
                          value={profileForm.state}
                          onChange={(e) => setProfileForm({ ...profileForm, state: e.target.value.toUpperCase() })}
                          className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white uppercase font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {profileForm.countryCode === "GB" && (
                <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-700/40 space-y-3">
                  <div className="text-xs font-semibold text-purple-300">United Kingdom PAYE & NIC Parameters</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">HMRC Tax Code</label>
                      <input
                        type="text"
                        placeholder="e.g. 1257L"
                        value={profileForm.taxCode}
                        onChange={(e) => setProfileForm({ ...profileForm, taxCode: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">NIC Category</label>
                      <select
                        value={profileForm.niCategory}
                        onChange={(e) => setProfileForm({ ...profileForm, niCategory: e.target.value })}
                        className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                      >
                        <option value="A">Category A (Standard)</option>
                        <option value="B">Category B (Reduced Married)</option>
                        <option value="C">Category C (Over State Pension Age)</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {profileForm.countryCode === "AE" && (
                <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-700/40 space-y-3">
                  <div className="text-xs font-semibold text-purple-300">UAE MOHRE & Wage Protection System (WPS)</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">Housing Allowance (AED)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={profileForm.housingAllowance}
                        onChange={(e) => setProfileForm({ ...profileForm, housingAllowance: e.target.value })}
                        className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">Transport Allowance (AED)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={profileForm.transportAllowance}
                        onChange={(e) => setProfileForm({ ...profileForm, transportAllowance: e.target.value })}
                        className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">UAE Bank IBAN (Begins with AE...)</label>
                    <input
                      type="text"
                      placeholder="e.g. AE070330000000000000000"
                      value={profileForm.iban}
                      onChange={(e) => setProfileForm({ ...profileForm, iban: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Salary Figures */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Annual Salary</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={profileForm.annualSalary}
                    onChange={(e) => {
                      const ann = e.target.value;
                      const mo = parseFloat(ann) > 0 ? (parseFloat(ann) / 12).toFixed(2) : "0";
                      setProfileForm({ ...profileForm, annualSalary: ann, monthlyBaseSalary: mo });
                    }}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Monthly Base Salary</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={profileForm.monthlyBaseSalary}
                    onChange={(e) => setProfileForm({ ...profileForm, monthlyBaseSalary: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl transition mt-4"
              >
                Save Employee Payroll Configuration
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Detailed Payslip Modal */}
      {showPayslipModal && selectedPayslip && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-xs font-mono text-purple-400 uppercase tracking-wider font-semibold">Official Payslip</span>
                <h3 className="text-lg font-bold text-white">{selectedPayslip.employee_name}</h3>
                <p className="text-xs text-slate-400">{selectedPayslip.country_code} • {selectedPayslip.currency} • Period: {selectedPayslip.period_start?.slice(0, 10)} to {selectedPayslip.period_end?.slice(0, 10)}</p>
              </div>
              <button onClick={() => setShowPayslipModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-slate-800/40 p-3 rounded-xl space-y-2 border border-slate-700/40">
                <div className="flex justify-between font-bold text-white">
                  <span>Gross Salary:</span>
                  <span>{selectedPayslip.currency} {parseFloat(selectedPayslip.gross_salary).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400 pl-3">
                  <span>Basic Salary:</span>
                  <span>{selectedPayslip.currency} {parseFloat(selectedPayslip.basic_salary).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400 pl-3">
                  <span>Allowances:</span>
                  <span>{selectedPayslip.currency} {parseFloat(selectedPayslip.allowances).toFixed(2)}</span>
                </div>
              </div>

              <div className="bg-rose-950/20 p-3 rounded-xl space-y-2 border border-rose-900/30">
                <div className="flex justify-between font-bold text-rose-300">
                  <span>Statutory Withholdings & Deductions:</span>
                  <span>- {selectedPayslip.currency} {parseFloat(selectedPayslip.statutory_deductions).toFixed(2)}</span>
                </div>
                {selectedPayslip.tax_breakdown && typeof selectedPayslip.tax_breakdown === "object" && (
                  <div className="space-y-1 pl-3 text-slate-300 font-mono text-[11px]">
                    {Object.entries(selectedPayslip.tax_breakdown).map(([k, v]) => (
                      typeof v === "string" || typeof v === "number" ? (
                        <div key={k} className="flex justify-between">
                          <span className="capitalize">{k.replace(/([A-Z])/g, ' $1')}:</span>
                          <span>{v}</span>
                        </div>
                      ) : null
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-amber-950/20 p-3 rounded-xl space-y-1 border border-amber-900/30 text-[11px]">
                <div className="flex justify-between font-bold text-amber-300">
                  <span>Employer Contributions (Separate Liability):</span>
                  <span>{selectedPayslip.currency} {parseFloat(selectedPayslip.employer_contributions).toFixed(2)}</span>
                </div>
                <p className="text-[10px] text-amber-400/80">Employer taxes are paid directly by the company and never deducted from employee net pay.</p>
              </div>

              <div className="bg-emerald-950/30 p-4 rounded-xl border border-emerald-900/40 flex items-center justify-between">
                <div>
                  <div className="text-xs text-emerald-400 font-semibold uppercase">Net Take-Home Pay</div>
                  <div className="text-xl font-bold text-white">
                    {selectedPayslip.currency} {parseFloat(selectedPayslip.net_salary).toFixed(2)}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-400">
                  Status: <span className="text-emerald-400 font-bold">APPROVED</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => window.print()}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Print / Save PDF
            </button>
          </div>
        </div>
      )}

      {/* MODAL 5: Reversal Justification Modal */}
      {showReversalModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Initiate Controlled Reversal
              </h3>
              <button onClick={() => setShowReversalModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <p className="text-xs text-slate-300">
              Reversing an approved payroll run will unpublish payslips and log this adjustment in the audit logs.
            </p>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Mandatory Reversal Justification</label>
              <textarea
                required
                rows={3}
                placeholder="e.g. Compensation adjustment requested by HR; tax bracket corrected."
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowReversalModal(false)}
                className="w-1/2 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReversal}
                className="w-1/2 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition"
              >
                Confirm Reversal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

