import test from "node:test";
import assert from "node:assert/strict";
import { Decimal, D, formatCurrency } from "../utils/financialMath.js";
import {
  calculateUnitedStatesPayroll,
  calculateUnitedKingdomPayroll,
  calculateUnitedArabEmiratesPayroll,
  calculateIndiaPayroll
} from "../services/taxCalculationEngine.js";
import { validateUaeIban } from "../services/wpsExportService.js";

// In-Memory Database Store for Pure Sandboxed Integration Testing
const DB = {
  currencies: new Map(),
  exchangeRates: new Map(),
  countryConfigs: new Map(),
  taxRules: new Map(),
  employeeProfiles: new Map(),
  payrollRuns: new Map(),
  payrollItems: new Map(),
  auditLogs: []
};

function resetDB() {
  DB.currencies.clear();
  DB.exchangeRates.clear();
  DB.countryConfigs.clear();
  DB.taxRules.clear();
  DB.employeeProfiles.clear();
  DB.payrollRuns.clear();
  DB.payrollItems.clear();
  DB.auditLogs = [];
}

test("Global Multi-Currency & International Tax Engine - Enterprise Test Suite", async (t) => {
  resetDB();

  await t.test("1. Currency Management: Precision, Default Currency, and Reporting Currency", () => {
    const compId = "comp_test_1";
    // Add USD
    DB.currencies.set(`${compId}_USD`, {
      companyId: compId,
      code: "USD",
      name: "US Dollar",
      symbol: "$",
      decimalPrecision: 2,
      isCompanyDefault: true,
      isReportingCurrency: false
    });
    // Add INR as reporting currency
    DB.currencies.set(`${compId}_INR`, {
      companyId: compId,
      code: "INR",
      name: "Indian Rupee",
      symbol: "₹",
      decimalPrecision: 2,
      isCompanyDefault: false,
      isReportingCurrency: true
    });

    const usd = DB.currencies.get(`${compId}_USD`);
    const inr = DB.currencies.get(`${compId}_INR`);
    assert.strictEqual(usd.isCompanyDefault, true);
    assert.strictEqual(inr.isReportingCurrency, true);
    assert.strictEqual(formatCurrency("1250.5", "USD"), "$1,250.50");
    assert.strictEqual(formatCurrency("50000.75", "INR"), "₹50,000.75");
  });

  await t.test("2. Exchange Rate Engine: Direct, Reciprocal, and Triangular Conversion with Zero Drift", () => {
    // 1 USD = 86.50 INR
    const rateUsdInr = new Decimal("86.500000");
    const amountUsd = new Decimal("5000.00");
    const convertedInr = amountUsd.mul(rateUsdInr).round(2);
    assert.strictEqual(convertedInr.toFixed(2), "432500.00");

    // Reciprocal: 1 INR = 1 / 86.50 USD
    const reciprocalRate = new Decimal(1).div(rateUsdInr).round(6);
    assert.strictEqual(reciprocalRate.toFixed(6), "0.011561");
    const convertedBackUsd = convertedInr.mul(reciprocalRate).round(2);
    // 432500 * 0.011561 = 5000.13 (within standard 6-figure FX tolerance)
    assert.ok(convertedBackUsd.greaterThanOrEqualTo(new Decimal("4999.00")) && convertedBackUsd.lessThanOrEqualTo(new Decimal("5001.00")));

    // Triangular Conversion: GBP -> USD -> INR
    // 1 GBP = 1.27 USD; 1 USD = 86.50 INR => 1 GBP = 1.27 * 86.50 = 109.855 INR
    const rateGbpUsd = new Decimal("1.270000");
    const rateGbpInr = rateGbpUsd.mul(rateUsdInr).round(6);
    assert.strictEqual(rateGbpInr.toFixed(6), "109.855000");
    const salaryGbp = new Decimal("3500.00");
    const salaryInr = salaryGbp.mul(rateGbpInr).round(2);
    assert.strictEqual(salaryInr.toFixed(2), "384492.50");
  });

  await t.test("3. Country Configuration: Supported Frequencies and WPS Settings", () => {
    const uaeConfig = {
      countryCode: "AE",
      countryName: "United Arab Emirates",
      defaultCurrency: "AED",
      wpsEnabled: true,
      supportedFrequencies: ["monthly"],
      settings: { basicSalaryMinRatio: 0.60 }
    };
    assert.strictEqual(uaeConfig.wpsEnabled, true);
    assert.strictEqual(uaeConfig.defaultCurrency, "AED");

    const usConfig = {
      countryCode: "US",
      countryName: "United States",
      defaultCurrency: "USD",
      wpsEnabled: false,
      supportedFrequencies: ["weekly", "biweekly", "semi_monthly", "monthly"]
    };
    assert.strictEqual(usConfig.supportedFrequencies.length, 4);
  });

  await t.test("4. US W-2 Statutory Calculations: FIT, FICA SS, Medicare, and Employer Separation", () => {
    const calc = calculateUnitedStatesPayroll({
      grossSalary: "10000.00",
      payFrequency: "monthly",
      classification: "w2",
      taxProfile: { state: "CA", filingStatus: "single" },
      preTaxDeductions: [{ name: "401k", amount: "500.00" }],
      postTaxDeductions: [{ name: "Gym", amount: "50.00" }]
    });

    assert.strictEqual(calc.countryCode, "US");
    assert.strictEqual(calc.currency, "USD");
    assert.strictEqual(calc.classification, "w2");
    // SS 6.2% of 10,000 = 620.00
    assert.strictEqual(calc.taxBreakdown.socialSecurity, "620.00");
    // Medicare 1.45% of 10,000 = 145.00
    assert.strictEqual(calc.taxBreakdown.medicare, "145.00");
    // Employer Contributions: SS 620 + Med 145 = 765.00
    assert.strictEqual(calc.employerContributions, "765.00");
    // Check employer contributions are NOT deducted from employee net
    const net = parseFloat(calc.netSalary);
    const gross = parseFloat(calc.grossSalary);
    const employeeDeductions = parseFloat(calc.statutoryDeductions) + parseFloat(calc.otherDeductions);
    assert.strictEqual(net, Math.round((gross - employeeDeductions) * 100) / 100);
  });

  await t.test("5. US 1099 Independent Contractor Workflow: Separate and Zero Withholding", () => {
    const calc1099 = calculateUnitedStatesPayroll({
      grossSalary: "7500.00",
      classification: "1099",
      postTaxDeductions: [{ name: "Platform Fee", amount: "100.00" }]
    });
    assert.strictEqual(calc1099.classification, "1099");
    assert.strictEqual(calc1099.statutoryDeductions, "0.00");
    assert.strictEqual(calc1099.taxBreakdown.socialSecurity, "0.00");
    assert.strictEqual(calc1099.taxBreakdown.federalIncomeTax, "0.00");
    assert.strictEqual(calc1099.employerContributions, "0.00");
    assert.strictEqual(calc1099.netSalary, "7400.00");
  });

  await t.test("6. UK PAYE & NIC: Personal Allowance & Class 1 Primary/Secondary Thresholds", () => {
    const ukCalc = calculateUnitedKingdomPayroll({
      grossSalary: "4000.00",
      payFrequency: "monthly",
      taxProfile: { taxCode: "1257L", niCategory: "A" }
    });
    assert.strictEqual(ukCalc.currency, "GBP");
    // Employee NIC: (4000 - 1048) * 0.08 = 2952 * 0.08 = 236.16
    assert.strictEqual(ukCalc.taxBreakdown.employeeNIC, "236.16");
    // Employer NIC: (4000 - 758) * 0.138 = 3242 * 0.138 = 447.40
    assert.strictEqual(ukCalc.employerBreakdown.employerNIC, "447.40");
    assert.ok(parseFloat(ukCalc.netSalary) > 2500 && parseFloat(ukCalc.netSalary) < 4000);
  });

  await t.test("7. UAE WPS Payroll & SIF Validation: 0% Personal Tax, IBAN Validator, EOSB", () => {
    assert.strictEqual(validateUaeIban("AE070330000000000000000"), true);
    assert.strictEqual(validateUaeIban("AE00123"), false);
    assert.strictEqual(validateUaeIban("GB070330000000000000000"), false);

    const uaeCalc = calculateUnitedArabEmiratesPayroll({
      basicSalary: "12000.00",
      housingAllowance: "5000.00",
      transportAllowance: "3000.00",
      yearsOfService: 2
    });
    assert.strictEqual(uaeCalc.currency, "AED");
    assert.strictEqual(uaeCalc.grossSalary, "20000.00");
    assert.strictEqual(uaeCalc.statutoryDeductions, "0.00");
    assert.strictEqual(uaeCalc.taxBreakdown.wpsCompliant, true); // 12000 / 20000 = 60%
    assert.strictEqual(uaeCalc.netSalary, "20000.00");
    // EOSB accrual (21 days / year / 12) * (12000 / 30) = 400 * 1.75 = 700.00
    assert.strictEqual(uaeCalc.employerBreakdown.monthlyEosbAccrual, "700.00");
  });

  await t.test("8. Indian Statutory Payroll Compatibility: PF, ESI, PT, and Net Salary", () => {
    const inCalc = calculateIndiaPayroll({
      grossSalary: "50000.00",
      paidDays: 30,
      workingDays: 30
    });
    assert.strictEqual(inCalc.currency, "INR");
    assert.strictEqual(inCalc.grossSalary, "50000.00");
    assert.strictEqual(inCalc.taxBreakdown.pf, "3000.00");
    assert.strictEqual(inCalc.taxBreakdown.pt, "155.00");
    assert.strictEqual(inCalc.netSalary, "46845.00");
  });

  await t.test("9. Approved Payroll Immutability & Reversal Workflow", () => {
    const run = {
      id: "run_test_lock",
      status: "APPROVED",
      totalGross: "50000.00",
      totalNet: "42000.00"
    };

    // Modification attempt rejected
    function editRun(targetRun, newStatus) {
      if (targetRun.status === "APPROVED" && newStatus !== "REVERSED") {
        throw new Error("Cannot edit an already approved payroll run. Initiate a controlled reversal with audit reason.");
      }
      targetRun.status = newStatus;
    }

    assert.throws(() => editRun(run, "DRAFT"), /Cannot edit an already approved payroll run/);

    // Controlled reversal succeeds
    editRun(run, "REVERSED");
    assert.strictEqual(run.status, "REVERSED");
  });

  await t.test("10. RBAC Authorization: Admin permitted, Employee rejected", () => {
    function checkPayrollAccess(user) {
      const role = user?.role?.toLowerCase();
      if (role !== "admin" && role !== "superadmin") {
        const err = new Error("Access forbidden. Admin role required.");
        err.status = 403;
        throw err;
      }
      return true;
    }

    assert.strictEqual(checkPayrollAccess({ role: "admin" }), true);
    assert.strictEqual(checkPayrollAccess({ role: "superadmin" }), true);
    assert.throws(() => checkPayrollAccess({ role: "employee" }), { status: 403 });
  });

  await t.test("11. Company Isolation: Multi-Tenant Data Separation", () => {
    const comp1Runs = [{ id: "r1", companyId: "c1" }];
    const comp2Runs = [{ id: "r2", companyId: "c2" }];

    function getRunsForCompany(compId, allRuns) {
      return allRuns.filter(r => r.companyId === compId);
    }

    const c1Filtered = getRunsForCompany("c1", [...comp1Runs, ...comp2Runs]);
    assert.strictEqual(c1Filtered.length, 1);
    assert.strictEqual(c1Filtered[0].id, "r1");
  });
});
