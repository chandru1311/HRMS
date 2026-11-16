import { query } from "../config/db.js";
import { Decimal, D } from "../utils/financialMath.js";

/**
 * Global Multi-Country Statutory Tax Calculation Engine
 * 
 * Supports:
 * - United States (W-2 & 1099, FIT, FICA Social Security, Medicare, State Tax)
 * - United Kingdom (PAYE, NIC Class 1 Primary & Secondary, Workplace Pension)
 * - United Arab Emirates (WPS Salary structure, Allowances, No Income Tax, EOSB)
 * - India (PF, ESI, PT, TDS)
 */

export async function getVerifiedTaxRules(companyId, countryCode, taxYear = 2026) {
  const res = await query(`
    SELECT * FROM tax_rules 
    WHERE company_id = $1 
      AND country_code = $2 
      AND tax_year = $3 
      AND status = 'verified'
    ORDER BY created_at DESC
  `, [companyId, countryCode.toUpperCase(), taxYear]);
  return res.rows;
}

/**
 * 1. United States Tax Calculation (USD)
 */
export function calculateUnitedStatesPayroll({
  grossSalary,
  payFrequency = "monthly", // "weekly" | "biweekly" | "semi_monthly" | "monthly"
  classification = "w2",   // "w2" | "1099"
  taxProfile = {},
  taxRules = [],
  preTaxDeductions = [],
  postTaxDeductions = []
}) {
  const gross = new Decimal(grossSalary);
  const periodsPerYear = {
    weekly: 52,
    biweekly: 26,
    semi_monthly: 24,
    monthly: 12
  }[payFrequency] || 12;

  // --- 1099 CONTRACTOR WORKFLOW ---
  if (classification === "1099") {
    // 1099 contractors receive 100% gross contractor compensation without statutory W-2 withholdings
    let otherDeductionsTotal = new Decimal(0);
    const itemizedOtherDeductions = [];

    for (const d of postTaxDeductions) {
      const amt = new Decimal(d.amount || 0);
      otherDeductionsTotal = otherDeductionsTotal.add(amt);
      itemizedOtherDeductions.push({ name: d.name || "Contractor Adjustment", amount: amt.toFixed(2) });
    }

    const netSalary = Decimal.max(new Decimal(0), gross.sub(otherDeductionsTotal));

    return {
      countryCode: "US",
      currency: "USD",
      classification: "1099",
      grossSalary: gross.toFixed(2),
      statutoryDeductions: "0.00",
      taxBreakdown: {
        federalIncomeTax: "0.00",
        socialSecurity: "0.00",
        medicare: "0.00",
        additionalMedicare: "0.00",
        stateIncomeTax: "0.00",
        note: "1099 Independent Contractor - Statutory taxes not withheld"
      },
      otherDeductions: otherDeductionsTotal.toFixed(2),
      itemizedOtherDeductions,
      employerContributions: "0.00",
      employerBreakdown: {
        employerSocialSecurity: "0.00",
        employerMedicare: "0.00",
        futa: "0.00"
      },
      netSalary: netSalary.toFixed(2),
      taxRulesUsed: { classification: "1099_independent_contractor" }
    };
  }

  // --- W-2 EMPLOYEE WORKFLOW ---
  // A. Pre-tax deductions (e.g. 401k, health insurance)
  let preTaxTotal = new Decimal(0);
  const itemizedPreTax = [];
  for (const d of preTaxDeductions) {
    const amt = new Decimal(d.amount || 0);
    preTaxTotal = preTaxTotal.add(amt);
    itemizedPreTax.push({ name: d.name || "Pre-Tax Deduction", amount: amt.toFixed(2) });
  }

  // Taxable wage base for Federal Income Tax
  const taxableFederalWage = Decimal.max(new Decimal(0), gross.sub(preTaxTotal));

  // Find tax rules
  const fitRule = taxRules.find(r => r.tax_type === "federal_income_tax")?.rules_data || {
    standardDeduction: 15000,
    brackets: [
      { min: 0, max: 11925, rate: 0.10 },
      { min: 11925, max: 48475, rate: 0.12 },
      { min: 48475, max: 103350, rate: 0.22 },
      { min: 103350, max: 197300, rate: 0.24 },
      { min: 197300, max: 250525, rate: 0.32 },
      { min: 250525, max: 626350, rate: 0.35 },
      { min: 626350, max: null, rate: 0.37 }
    ]
  };

  const ssRule = taxRules.find(r => r.tax_type === "fica_social_security")?.rules_data || {
    employeeRate: 0.062,
    employerRate: 0.062,
    wageCap: 176100.00
  };

  const medRule = taxRules.find(r => r.tax_type === "fica_medicare")?.rules_data || {
    employeeRate: 0.0145,
    employerRate: 0.0145,
    additionalMedicareRate: 0.009,
    additionalThreshold: 200000.00
  };

  const stateRule = taxRules.find(r => r.tax_type === "state_income_tax" && (r.state_or_region === taxProfile.state || r.state_or_region === "all"))?.rules_data || null;

  // 1. Social Security (OASDI): 6.2% up to annual cap (per period cap = wageCap / periodsPerYear)
  const periodSsCap = new Decimal(ssRule.wageCap || 176100).div(periodsPerYear);
  const ssSubjectWage = Decimal.min(gross, periodSsCap);
  const employeeSS = ssSubjectWage.mul(ssRule.employeeRate || 0.062).round(2);
  const employerSS = ssSubjectWage.mul(ssRule.employerRate || 0.062).round(2);

  // 2. Medicare: 1.45% on all wages, + 0.9% additional over annual threshold ($200k)
  const periodMedThreshold = new Decimal(medRule.additionalThreshold || 200000).div(periodsPerYear);
  const employeeMedBase = gross.mul(medRule.employeeRate || 0.0145).round(2);
  const employerMed = gross.mul(medRule.employerRate || 0.0145).round(2);
  let employeeMedAdd = new Decimal(0);
  if (gross.greaterThan(periodMedThreshold)) {
    employeeMedAdd = gross.sub(periodMedThreshold).mul(medRule.additionalMedicareRate || 0.009).round(2);
  }
  const employeeTotalMed = employeeMedBase.add(employeeMedAdd);

  // 3. Federal Income Tax (FIT): Progressive annualized bracket calculation
  const annualizedWage = taxableFederalWage.mul(periodsPerYear);
  const stdDeduction = new Decimal(fitRule.standardDeduction || 15000);
  const annualTaxableIncome = Decimal.max(new Decimal(0), annualizedWage.sub(stdDeduction));

  let annualFitTax = new Decimal(0);
  const brackets = fitRule.brackets || [];
  for (const b of brackets) {
    const min = new Decimal(b.min);
    const max = b.max !== null && b.max !== undefined ? new Decimal(b.max) : null;
    const rate = new Decimal(b.rate);

    if (annualTaxableIncome.greaterThan(min)) {
      const taxableInBracket = max ? Decimal.min(annualTaxableIncome, max).sub(min) : annualTaxableIncome.sub(min);
      if (taxableInBracket.greaterThan(0)) {
        annualFitTax = annualFitTax.add(taxableInBracket.mul(rate));
      }
    }
  }
  const periodFit = annualFitTax.div(periodsPerYear).round(2);

  // 4. State Income Tax (SIT)
  let periodSit = new Decimal(0);
  if (stateRule && stateRule.brackets) {
    const annualStateTaxable = Decimal.max(new Decimal(0), annualizedWage.sub(new Decimal(stateRule.standardDeduction || 0)));
    let annualSitTax = new Decimal(0);
    for (const b of stateRule.brackets) {
      const min = new Decimal(b.min);
      const max = b.max !== null && b.max !== undefined ? new Decimal(b.max) : null;
      const rate = new Decimal(b.rate);
      if (annualStateTaxable.greaterThan(min)) {
        const taxableInBracket = max ? Decimal.min(annualStateTaxable, max).sub(min) : annualStateTaxable.sub(min);
        if (taxableInBracket.greaterThan(0)) {
          annualSitTax = annualSitTax.add(taxableInBracket.mul(rate));
        }
      }
    }
    periodSit = annualSitTax.div(periodsPerYear).round(2);
  }

  // 5. Total Statutory Deductions (Employee side)
  const totalStatutory = periodFit.add(employeeSS).add(employeeTotalMed).add(periodSit);

  // 6. Post-tax deductions
  let postTaxTotal = new Decimal(0);
  const itemizedPostTax = [];
  for (const d of postTaxDeductions) {
    const amt = new Decimal(d.amount || 0);
    postTaxTotal = postTaxTotal.add(amt);
    itemizedPostTax.push({ name: d.name || "Post-Tax Deduction", amount: amt.toFixed(2) });
  }

  const otherDeductionsTotal = preTaxTotal.add(postTaxTotal);

  // 7. Employer Contributions (Separate, NEVER deducted from employee net!)
  const totalEmployerContributions = employerSS.add(employerMed);

  // 8. Net Salary = Gross - PreTax - Statutory - PostTax
  const netSalary = Decimal.max(new Decimal(0), gross.sub(preTaxTotal).sub(totalStatutory).sub(postTaxTotal));

  return {
    countryCode: "US",
    currency: "USD",
    classification: "w2",
    grossSalary: gross.toFixed(2),
    statutoryDeductions: totalStatutory.toFixed(2),
    taxBreakdown: {
      federalIncomeTax: periodFit.toFixed(2),
      socialSecurity: employeeSS.toFixed(2),
      medicare: employeeMedBase.toFixed(2),
      additionalMedicare: employeeMedAdd.toFixed(2),
      totalMedicare: employeeTotalMed.toFixed(2),
      stateIncomeTax: periodSit.toFixed(2),
      state: taxProfile.state || "Federal"
    },
    otherDeductions: otherDeductionsTotal.toFixed(2),
    itemizedOtherDeductions: [...itemizedPreTax, ...itemizedPostTax],
    employerContributions: totalEmployerContributions.toFixed(2),
    employerBreakdown: {
      employerSocialSecurity: employerSS.toFixed(2),
      employerMedicare: employerMed.toFixed(2)
    },
    netSalary: netSalary.toFixed(2),
    taxRulesUsed: {
      fitYear: fitRule.taxYear || 2026,
      ssCap: ssRule.wageCap,
      filingStatus: taxProfile.filingStatus || "single"
    }
  };
}

/**
 * 2. United Kingdom Tax Calculation (GBP - PAYE & NIC)
 */
export function calculateUnitedKingdomPayroll({
  grossSalary,
  payFrequency = "monthly", // "weekly" | "monthly"
  taxProfile = {}, // { taxCode: "1257L", niCategory: "A", pensionRate: 0.05, studentLoanPlan: null }
  taxRules = [],
  deductions = []
}) {
  const gross = new Decimal(grossSalary);
  const periodsPerYear = payFrequency === "weekly" ? 52 : 12;

  const payeRule = taxRules.find(r => r.tax_type === "uk_paye")?.rules_data || {
    personalAllowance: 12570,
    bands: [
      { name: "Basic Rate", min: 0, max: 37700, rate: 0.20 },
      { name: "Higher Rate", min: 37700, max: 125140, rate: 0.40 },
      { name: "Additional Rate", min: 125140, max: null, rate: 0.45 }
    ]
  };

  const nicRule = taxRules.find(r => r.tax_type === "uk_nic")?.rules_data || {
    category: "A",
    primaryThresholdMonthly: 1048.00,
    upperEarningsLimitMonthly: 4189.00,
    employeeMainRate: 0.08,
    employeeUpperRate: 0.02,
    secondaryThresholdMonthly: 758.00,
    employerRate: 0.138
  };

  const pensionRule = taxRules.find(r => r.tax_type === "uk_pension")?.rules_data || {
    qualifyingEarningsLowerMonthly: 520.00,
    qualifyingEarningsUpperMonthly: 4189.00,
    minEmployeeContributionRate: 0.05,
    minEmployerContributionRate: 0.03
  };

  // 1. HMRC PAYE Income Tax Calculation
  // Standard tax code 1257L = £12,570 personal allowance. Pro-rated per period:
  let personalAllowance = new Decimal(payeRule.personalAllowance || 12570);
  // Parse tax code allowance if custom code provided e.g. 1100L -> £11,000
  if (taxProfile.taxCode) {
    const codeMatch = String(taxProfile.taxCode).trim().match(/^(\d+)[A-Z]?$/i);
    if (codeMatch) {
      personalAllowance = new Decimal(parseInt(codeMatch[1], 10) * 10);
    }
  }

  const periodAllowance = personalAllowance.div(periodsPerYear);
  const annualizedGross = gross.mul(periodsPerYear);
  // Taper personal allowance by £1 for every £2 earned above £100,000
  let adjustedAnnualAllowance = personalAllowance;
  if (annualizedGross.greaterThan(100000)) {
    const reduction = annualizedGross.sub(100000).div(2);
    adjustedAnnualAllowance = Decimal.max(new Decimal(0), personalAllowance.sub(reduction));
  }
  const effectivePeriodAllowance = adjustedAnnualAllowance.div(periodsPerYear);
  const periodTaxableIncome = Decimal.max(new Decimal(0), gross.sub(effectivePeriodAllowance));

  let periodPayeTax = new Decimal(0);
  const bands = payeRule.bands || [];
  for (const b of bands) {
    const min = new Decimal(b.min).div(periodsPerYear);
    const max = b.max !== null && b.max !== undefined ? new Decimal(b.max).div(periodsPerYear) : null;
    const rate = new Decimal(b.rate);

    if (periodTaxableIncome.greaterThan(min)) {
      const taxableInBand = max ? Decimal.min(periodTaxableIncome, max).sub(min) : periodTaxableIncome.sub(min);
      if (taxableInBand.greaterThan(0)) {
        periodPayeTax = periodPayeTax.add(taxableInBand.mul(rate));
      }
    }
  }
  periodPayeTax = periodPayeTax.round(2);

  // 2. Class 1 National Insurance Contributions (NIC)
  const ptPeriod = (payFrequency === "weekly" ? new Decimal(nicRule.primaryThresholdMonthly).mul(12).div(52) : new Decimal(nicRule.primaryThresholdMonthly)).round(2);
  const uelPeriod = (payFrequency === "weekly" ? new Decimal(nicRule.upperEarningsLimitMonthly).mul(12).div(52) : new Decimal(nicRule.upperEarningsLimitMonthly)).round(2);
  const stPeriod = (payFrequency === "weekly" ? new Decimal(nicRule.secondaryThresholdMonthly).mul(12).div(52) : new Decimal(nicRule.secondaryThresholdMonthly)).round(2);

  let employeeNic = new Decimal(0);
  if (gross.greaterThan(ptPeriod)) {
    const mainBandEarnings = Decimal.min(gross, uelPeriod).sub(ptPeriod);
    const mainNic = mainBandEarnings.mul(nicRule.employeeMainRate || 0.08);
    let upperNic = new Decimal(0);
    if (gross.greaterThan(uelPeriod)) {
      upperNic = gross.sub(uelPeriod).mul(nicRule.employeeUpperRate || 0.02);
    }
    employeeNic = mainNic.add(upperNic).round(2);
  }

  // Employer Secondary NIC (13.8% above Secondary Threshold)
  let employerNic = new Decimal(0);
  if (gross.greaterThan(stPeriod)) {
    employerNic = gross.sub(stPeriod).mul(nicRule.employerRate || 0.138).round(2);
  }

  // 3. Workplace Pension Auto-Enrolment
  const qeLower = (payFrequency === "weekly" ? new Decimal(pensionRule.qualifyingEarningsLowerMonthly).mul(12).div(52) : new Decimal(pensionRule.qualifyingEarningsLowerMonthly)).round(2);
  const qeUpper = (payFrequency === "weekly" ? new Decimal(pensionRule.qualifyingEarningsUpperMonthly).mul(12).div(52) : new Decimal(pensionRule.qualifyingEarningsUpperMonthly)).round(2);

  let employeePension = new Decimal(0);
  let employerPension = new Decimal(0);
  if (gross.greaterThan(qeLower)) {
    const qualEarnings = Decimal.min(gross, qeUpper).sub(qeLower);
    const empRate = new Decimal(taxProfile.pensionEmployeeRate || pensionRule.minEmployeeContributionRate || 0.05);
    const empyrRate = new Decimal(taxProfile.pensionEmployerRate || pensionRule.minEmployerContributionRate || 0.03);
    employeePension = qualEarnings.mul(empRate).round(2);
    employerPension = qualEarnings.mul(empyrRate).round(2);
  }

  // 4. Student Loan deductions
  let studentLoanDeduction = new Decimal(0);
  if (taxProfile.studentLoanPlan === "plan1" && gross.greaterThan(1834)) {
    studentLoanDeduction = gross.sub(1834).mul(0.09).round(2);
  } else if (taxProfile.studentLoanPlan === "plan2" && gross.greaterThan(2274)) {
    studentLoanDeduction = gross.sub(2274).mul(0.09).round(2);
  }

  // Total Statutory Deductions
  const totalStatutory = periodPayeTax.add(employeeNic);

  // Other Employee Deductions (Pension + Student Loan + custom deductions)
  let otherDeductionsTotal = employeePension.add(studentLoanDeduction);
  const itemizedOtherDeductions = [
    { name: "Workplace Pension (Employee 5%)", amount: employeePension.toFixed(2) }
  ];
  if (studentLoanDeduction.greaterThan(0)) {
    itemizedOtherDeductions.push({ name: `Student Loan (${taxProfile.studentLoanPlan})`, amount: studentLoanDeduction.toFixed(2) });
  }

  for (const d of deductions) {
    const amt = new Decimal(d.amount || 0);
    otherDeductionsTotal = otherDeductionsTotal.add(amt);
    itemizedOtherDeductions.push({ name: d.name || "Deduction", amount: amt.toFixed(2) });
  }

  // Employer Contributions (Employer NIC + Employer Pension)
  const totalEmployerContributions = employerNic.add(employerPension);

  // Net Salary = Gross - Statutory - OtherDeductions
  const netSalary = Decimal.max(new Decimal(0), gross.sub(totalStatutory).sub(otherDeductionsTotal));

  return {
    countryCode: "GB",
    currency: "GBP",
    classification: "standard_uk",
    grossSalary: gross.toFixed(2),
    statutoryDeductions: totalStatutory.toFixed(2),
    taxBreakdown: {
      payeTax: periodPayeTax.toFixed(2),
      employeeNIC: employeeNic.toFixed(2),
      taxCode: taxProfile.taxCode || "1257L",
      niCategory: nicRule.category || "A",
      personalAllowanceUsed: effectivePeriodAllowance.toFixed(2)
    },
    otherDeductions: otherDeductionsTotal.toFixed(2),
    itemizedOtherDeductions,
    employerContributions: totalEmployerContributions.toFixed(2),
    employerBreakdown: {
      employerNIC: employerNic.toFixed(2),
      employerPension: employerPension.toFixed(2)
    },
    netSalary: netSalary.toFixed(2),
    taxRulesUsed: {
      taxYear: "2025/2026",
      payeAllowance: personalAllowance.toFixed(2),
      nicThresholds: { pt: ptPeriod.toFixed(2), uel: uelPeriod.toFixed(2) }
    }
  };
}

/**
 * 3. United Arab Emirates Tax Calculation (AED - WPS Compliant)
 */
export function calculateUnitedArabEmiratesPayroll({
  basicSalary,
  housingAllowance = 0,
  transportAllowance = 0,
  otherAllowances = 0,
  yearsOfService = 1,
  deductions = []
}) {
  const basic = new Decimal(basicSalary || 0);
  const housing = new Decimal(housingAllowance || 0);
  const transport = new Decimal(transportAllowance || 0);
  const other = new Decimal(otherAllowances || 0);

  const totalAllowances = housing.add(transport).add(other);
  const gross = basic.add(totalAllowances);

  // In the UAE, there is 0% Personal Income Tax for employees
  const statutoryDeductions = new Decimal(0);

  // Other Deductions (e.g. advance recovery, disciplinary fine)
  let otherDeductionsTotal = new Decimal(0);
  const itemizedOtherDeductions = [];
  for (const d of deductions) {
    const amt = new Decimal(d.amount || 0);
    otherDeductionsTotal = otherDeductionsTotal.add(amt);
    itemizedOtherDeductions.push({ name: d.name || "Deduction", amount: amt.toFixed(2) });
  }

  // End of Service Benefit (EOSB) Accrual Calculation (Employer Liability, NOT deducted from employee)
  // MOHRE Law: 21 days basic salary per year for first 5 years; 30 days per year thereafter.
  const serviceYears = Number(yearsOfService) || 1;
  const daysPerYear = serviceYears <= 5 ? 21 : 30;
  const annualEosb = basic.div(30).mul(daysPerYear);
  const monthlyEosbAccrual = annualEosb.div(12).round(2);

  // WPS Compliance Validation: Basic salary should be at least 60% of gross salary
  const basicRatio = gross.greaterThan(0) ? basic.div(gross).round(4) : new Decimal(1);
  const isWpsValidRatio = basicRatio.greaterThanOrEqualTo(new Decimal("0.60"));

  const netSalary = Decimal.max(new Decimal(0), gross.sub(otherDeductionsTotal));

  return {
    countryCode: "AE",
    currency: "AED",
    classification: "wps_uae",
    basicSalary: basic.toFixed(2),
    allowances: totalAllowances.toFixed(2),
    allowanceBreakdown: {
      housing: housing.toFixed(2),
      transport: transport.toFixed(2),
      other: other.toFixed(2)
    },
    grossSalary: gross.toFixed(2),
    statutoryDeductions: statutoryDeductions.toFixed(2),
    taxBreakdown: {
      personalIncomeTax: "0.00",
      wpsRatio: basicRatio.toFixed(2),
      wpsCompliant: isWpsValidRatio
    },
    otherDeductions: otherDeductionsTotal.toFixed(2),
    itemizedOtherDeductions,
    employerContributions: monthlyEosbAccrual.toFixed(2),
    employerBreakdown: {
      monthlyEosbAccrual: monthlyEosbAccrual.toFixed(2),
      eosbDaysPerYear: daysPerYear
    },
    netSalary: netSalary.toFixed(2),
    taxRulesUsed: {
      jurisdiction: "MOHRE_UAE",
      incomeTaxRate: "0%",
      wpsBasicRatioStandard: "60%"
    }
  };
}

/**
 * 4. India Statutory Tax Calculation (INR - Reusing existing verified statutory parameters)
 */
export function calculateIndiaPayroll({
  grossSalary,
  paidDays = 30,
  workingDays = 30,
  companySettings = { pf: true, esi: true, pt: true }
}) {
  const gross = new Decimal(grossSalary || 30000);
  const wDays = Number(workingDays) || 30;
  const pDays = Number(paidDays) || 30;

  const actualGross = gross.div(wDays).mul(pDays).round(2);
  const lopAmount = gross.sub(actualGross).round(2);

  const basic = gross.mul(0.5).round(2);
  const hra = basic.mul(0.4).round(2);
  const special = Decimal.max(new Decimal(0), gross.sub(basic).sub(hra)).round(2);

  const actualBasic = actualGross.mul(0.5).round(2);
  const pf = companySettings?.pf ? actualBasic.mul(0.12).round(2) : new Decimal(0);
  const esi = (companySettings?.esi && actualGross.lessThanOrEqualTo(21000)) ? actualGross.mul(0.0075).round(2) : new Decimal(0);

  // Professional Tax (PT)
  let pt = new Decimal(0);
  if (companySettings?.pt) {
    if (actualGross.greaterThan(75000)) pt = new Decimal("208.33");
    else if (actualGross.greaterThan(60000)) pt = new Decimal("170.83");
    else if (actualGross.greaterThan(45000)) pt = new Decimal("155.00");
    else if (actualGross.greaterThan(30000)) pt = new Decimal("70.83");
    else if (actualGross.greaterThan(21000)) pt = new Decimal("30.00");
  }

  // TDS estimate
  const tds = actualGross.greaterThan(50000) ? actualGross.sub(pf).sub(pt).mul(0.05).round(2) : new Decimal(0);

  const totalStatutory = pf.add(esi).add(pt).add(tds);
  const otherDeductionsTotal = lopAmount;

  // Employer PF (12%) & Employer ESI (3.25%)
  const employerPF = companySettings?.pf ? actualBasic.mul(0.12).round(2) : new Decimal(0);
  const employerESI = (companySettings?.esi && actualGross.lessThanOrEqualTo(21000)) ? actualGross.mul(0.0325).round(2) : new Decimal(0);
  const totalEmployerContributions = employerPF.add(employerESI);

  const netSalary = Decimal.max(new Decimal(0), actualGross.sub(totalStatutory));

  return {
    countryCode: "IN",
    currency: "INR",
    classification: "india_regular",
    basicSalary: basic.toFixed(2),
    hra: hra.toFixed(2),
    allowances: special.toFixed(2),
    grossSalary: actualGross.toFixed(2),
    statutoryDeductions: totalStatutory.toFixed(2),
    taxBreakdown: {
      pf: pf.toFixed(2),
      esi: esi.toFixed(2),
      pt: pt.toFixed(2),
      tds: tds.toFixed(2)
    },
    otherDeductions: otherDeductionsTotal.toFixed(2),
    itemizedOtherDeductions: [
      { name: "Loss of Pay (LOP)", amount: lopAmount.toFixed(2) }
    ],
    employerContributions: totalEmployerContributions.toFixed(2),
    employerBreakdown: {
      employerPF: employerPF.toFixed(2),
      employerESI: employerESI.toFixed(2)
    },
    netSalary: netSalary.toFixed(2),
    taxRulesUsed: {
      statutory: "EPFO_ESIC_PT_INDIA",
      paidDays: pDays,
      workingDays: wDays
    }
  };
}

