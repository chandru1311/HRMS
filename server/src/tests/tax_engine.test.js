import test from "node:test";
import assert from "node:assert";
import {
  calculateUnitedStatesPayroll,
  calculateUnitedKingdomPayroll,
  calculateUnitedArabEmiratesPayroll,
  calculateIndiaPayroll
} from "../services/taxCalculationEngine.js";

test("International Tax Engine - Country-Specific Statutory Calculations", async (t) => {
  await t.test("US W-2 Payroll Calculation: FIT, FICA SS, Medicare, and Employer Contributions", () => {
    const result = calculateUnitedStatesPayroll({
      grossSalary: "10000.00",
      payFrequency: "monthly",
      classification: "w2",
      taxProfile: { state: "CA", filingStatus: "single" },
      preTaxDeductions: [{ name: "401(k)", amount: "500.00" }],
      postTaxDeductions: [{ name: "Life Insurance", amount: "50.00" }]
    });

    assert.strictEqual(result.countryCode, "US");
    assert.strictEqual(result.currency, "USD");
    assert.strictEqual(result.grossSalary, "10000.00");
    // SS 6.2% of $10,000 = $620.00
    assert.strictEqual(result.taxBreakdown.socialSecurity, "620.00");
    // Medicare 1.45% of $10,000 = $145.00
    assert.strictEqual(result.taxBreakdown.medicare, "145.00");
    // Employer SS 6.2% ($620) + Employer Med 1.45% ($145) = $765.00
    assert.strictEqual(result.employerContributions, "765.00");
    // Net salary must NOT subtract employer contributions!
    const net = parseFloat(result.netSalary);
    assert.ok(net > 0 && net < 10000, "Net salary is positive and after employee deductions only");
  });

  await t.test("US 1099 Contractor Workflow: Zero W-2 Tax Withholding", () => {
    const result = calculateUnitedStatesPayroll({
      grossSalary: "7500.00",
      classification: "1099",
      postTaxDeductions: [{ name: "Contractor Service Fee", amount: "150.00" }]
    });

    assert.strictEqual(result.classification, "1099");
    assert.strictEqual(result.statutoryDeductions, "0.00");
    assert.strictEqual(result.taxBreakdown.socialSecurity, "0.00");
    assert.strictEqual(result.taxBreakdown.federalIncomeTax, "0.00");
    assert.strictEqual(result.employerContributions, "0.00");
    assert.strictEqual(result.netSalary, "7350.00");
  });

  await t.test("UK PAYE & NIC Calculation: Personal Allowance, NIC Class 1, Pension", () => {
    const result = calculateUnitedKingdomPayroll({
      grossSalary: "4000.00",
      payFrequency: "monthly",
      taxProfile: { taxCode: "1257L", niCategory: "A" }
    });

    assert.strictEqual(result.countryCode, "GB");
    assert.strictEqual(result.currency, "GBP");
    assert.strictEqual(result.grossSalary, "4000.00");
    // Employee NIC between £1,048 and £4,000 at 8% = (4000 - 1048) * 0.08 = 2952 * 0.08 = 236.16
    assert.strictEqual(result.taxBreakdown.employeeNIC, "236.16");
    // Employer NIC above £758 at 13.8% = (4000 - 758) * 0.138 = 3242 * 0.138 = 447.40
    assert.strictEqual(result.employerBreakdown.employerNIC, "447.40");
    // Net salary should be calculated accurately
    const net = parseFloat(result.netSalary);
    assert.ok(net > 2500 && net < 4000);
  });

  await t.test("UAE WPS Payroll: 0% Personal Tax, Basic/Housing Allowance Ratio, EOSB Accrual", () => {
    const result = calculateUnitedArabEmiratesPayroll({
      basicSalary: "12000.00",
      housingAllowance: "6000.00",
      transportAllowance: "2000.00",
      yearsOfService: 3
    });

    assert.strictEqual(result.countryCode, "AE");
    assert.strictEqual(result.currency, "AED");
    assert.strictEqual(result.grossSalary, "20000.00");
    assert.strictEqual(result.basicSalary, "12000.00");
    assert.strictEqual(result.statutoryDeductions, "0.00");
    // WPS Basic ratio 12000 / 20000 = 60%
    assert.strictEqual(result.taxBreakdown.wpsCompliant, true);
    // Net salary is 100% of gross if no other deductions
    assert.strictEqual(result.netSalary, "20000.00");
    // EOSB accrual (21 days / year / 12) * (12000 / 30) = (12000 / 30) * 21 / 12 = 400 * 1.75 = 700.00
    assert.strictEqual(result.employerBreakdown.monthlyEosbAccrual, "700.00");
  });

  await t.test("India Payroll: PF, ESI, PT, and Net Salary", () => {
    const result = calculateIndiaPayroll({
      grossSalary: "50000.00",
      paidDays: 30,
      workingDays: 30
    });

    assert.strictEqual(result.countryCode, "IN");
    assert.strictEqual(result.currency, "INR");
    assert.strictEqual(result.grossSalary, "50000.00");
    // PF 12% of basic (25000) = 3000.00
    assert.strictEqual(result.taxBreakdown.pf, "3000.00");
    // PT for > 45000 = 155.00
    assert.strictEqual(result.taxBreakdown.pt, "155.00");
    // Net salary = 50000 - 3000 - 155 = 46845.00
    assert.strictEqual(result.netSalary, "46845.00");
  });
});

