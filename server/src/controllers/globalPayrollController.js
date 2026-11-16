import { query } from "../config/db.js";
import { Decimal, D } from "../utils/financialMath.js";
import {
  getCompanyCurrencies,
  addCompanyCurrency,
  updateCompanyCurrency,
  getCompanyExchangeRates,
  addExchangeRate,
  getExchangeRate,
  convertAmount,
  getCompanyReportingCurrency
} from "../services/currencyEngine.js";
import {
  getVerifiedTaxRules,
  calculateUnitedStatesPayroll,
  calculateUnitedKingdomPayroll,
  calculateUnitedArabEmiratesPayroll,
  calculateIndiaPayroll
} from "../services/taxCalculationEngine.js";
import { generateWpsSifFile } from "../services/wpsExportService.js";
import { logPayrollAudit } from "../services/payrollAuditService.js";

/**
 * Global Multi-Currency & International Tax Engine Controller
 */

// -------------------------------------------------------------
// 1. OVERVIEW & ANALYTICS
// -------------------------------------------------------------
export async function getGlobalPayrollOverview(req, res) {
  try {
    const isSuperAdmin = req.user?.role?.toLowerCase() === "superadmin";
    const companyId = (isSuperAdmin && req.query.companyId) ? req.query.companyId : req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ error: "Company ID required." });
    }

    const reportingCurrency = await getCompanyReportingCurrency(companyId);

    // 1. Total employees by country
    const empByCountryRes = await query(`
      SELECT 
        COALESCE(epp.country_code, 'IN') as country_code,
        COUNT(u.id) as count
      FROM users u
      LEFT JOIN employee_payroll_profiles epp ON (u.id = epp.user_id AND u.company_id = epp.company_id)
      WHERE u.company_id = $1 AND u.role != 'superadmin'
      GROUP BY COALESCE(epp.country_code, 'IN')
    `, [companyId]);

    // 2. International profiles count
    const intlProfilesRes = await query(`
      SELECT COUNT(*) as count 
      FROM employee_payroll_profiles 
      WHERE company_id = $1 AND is_active = TRUE
    `, [companyId]);

    // 3. Runs by status (Pending, Approved, Failed, Draft)
    const runsStatusRes = await query(`
      SELECT status, COUNT(*) as count, 
             COALESCE(SUM(total_net_reporting), 0) as total_net_rep,
             COALESCE(SUM(total_gross_reporting), 0) as total_gross_rep
      FROM global_payroll_runs
      WHERE company_id = $1
      GROUP BY status
    `, [companyId]);

    // 4. Expenditure by currency
    const expByCurrRes = await query(`
      SELECT currency, 
             COUNT(id) as runs_count,
             COALESCE(SUM(total_gross), 0) as total_gross,
             COALESCE(SUM(total_net), 0) as total_net,
             COALESCE(SUM(total_employer_contributions), 0) as total_employer
      FROM global_payroll_runs
      WHERE company_id = $1 AND status IN ('APPROVED', 'COMPLETED')
      GROUP BY currency
    `, [companyId]);

    // 5. Total monthly payroll expenditure in reporting currency
    const totalExpRes = await query(`
      SELECT 
        COALESCE(SUM(total_gross_reporting), 0) as total_gross,
        COALESCE(SUM(total_net_reporting), 0) as total_net,
        COALESCE(SUM(total_employer_contributions * reporting_exchange_rate), 0) as total_employer
      FROM global_payroll_runs
      WHERE company_id = $1 AND status IN ('APPROVED', 'COMPLETED')
    `, [companyId]);

    // 6. Recent payroll activities
    const recentActivitiesRes = await query(`
      SELECT * FROM payroll_audit_logs
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [companyId]);

    res.json({
      reportingCurrency,
      employeesByCountry: empByCountryRes.rows,
      internationalProfilesCount: parseInt(intlProfilesRes.rows[0]?.count || 0, 10),
      runsByStatus: runsStatusRes.rows,
      expenditureByCurrency: expByCurrRes.rows,
      totalExpenditureReporting: {
        totalGross: new Decimal(totalExpRes.rows[0]?.total_gross || 0).toFixed(2),
        totalNet: new Decimal(totalExpRes.rows[0]?.total_net || 0).toFixed(2),
        totalEmployer: new Decimal(totalExpRes.rows[0]?.total_employer || 0).toFixed(2),
        currency: reportingCurrency.code
      },
      recentActivities: recentActivitiesRes.rows
    });
  } catch (err) {
    console.error("getGlobalPayrollOverview error:", err);
    res.status(500).json({ error: "Failed to load global payroll overview." });
  }
}

// -------------------------------------------------------------
// 2. CURRENCY & EXCHANGE RATES
// -------------------------------------------------------------
export async function getCurrencies(req, res) {
  try {
    const isSuperAdmin = req.user?.role?.toLowerCase() === "superadmin";
    const companyId = (isSuperAdmin && req.query.companyId) ? req.query.companyId : req.user.companyId;
    const currencies = await getCompanyCurrencies(companyId);
    res.json(currencies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function addCurrency(req, res) {
  try {
    const companyId = req.user.companyId;
    const currency = await addCompanyCurrency(companyId, req.body, req.user);
    res.status(201).json(currency);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateCurrency(req, res) {
  try {
    const companyId = req.user.companyId;
    const currency = await updateCompanyCurrency(companyId, req.params.id, req.body, req.user);
    res.json(currency);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getExchangeRates(req, res) {
  try {
    const companyId = req.user.companyId;
    const rates = await getCompanyExchangeRates(companyId, req.query);
    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createExchangeRate(req, res) {
  try {
    const companyId = req.user.companyId;
    const rate = await addExchangeRate(companyId, req.body, req.user);
    res.status(201).json(rate);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function convertCurrencyAmount(req, res) {
  try {
    const companyId = req.user.companyId;
    const { amount, from, to, date } = req.body;
    if (!amount || !from || !to) {
      return res.status(400).json({ error: "amount, from, and to currencies are required." });
    }
    const result = await convertAmount(companyId, amount, from, to, date);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// -------------------------------------------------------------
// 3. COUNTRY CONFIGURATION
// -------------------------------------------------------------
export async function getCountryConfigs(req, res) {
  try {
    const companyId = req.user.companyId;
    const result = await query(`
      SELECT * FROM country_payroll_configs 
      WHERE company_id = $1 
      ORDER BY country_name ASC
    `, [companyId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateCountryConfig(req, res) {
  try {
    const companyId = req.user.companyId;
    const code = req.params.code.toUpperCase();
    const { wpsEnabled, wpsEmployerEid, wpsBankCode, supportedFrequencies, settings, isActive } = req.body;

    const existing = await query(`SELECT * FROM country_payroll_configs WHERE company_id = $1 AND country_code = $2`, [companyId, code]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Country config not found." });
    }

    const updated = await query(`
      UPDATE country_payroll_configs
      SET wps_enabled = COALESCE($1, wps_enabled),
          wps_employer_eid = COALESCE($2, wps_employer_eid),
          wps_bank_code = COALESCE($3, wps_bank_code),
          supported_frequencies = COALESCE($4, supported_frequencies),
          settings = COALESCE($5, settings),
          is_active = COALESCE($6, is_active),
          updated_at = CURRENT_TIMESTAMP
      WHERE company_id = $7 AND country_code = $8
      RETURNING *
    `, [
      wpsEnabled,
      wpsEmployerEid,
      wpsBankCode,
      supportedFrequencies ? JSON.stringify(supportedFrequencies) : null,
      settings ? JSON.stringify(settings) : null,
      isActive,
      companyId,
      code
    ]);

    await logPayrollAudit({
      companyId,
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: "COUNTRY_CONFIG_UPDATE",
      entityType: "country_config",
      entityId: code,
      previousValues: existing.rows[0],
      updatedValues: updated.rows[0]
    });

    res.json(updated.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// -------------------------------------------------------------
// 4. TAX RULES
// -------------------------------------------------------------
export async function getTaxRules(req, res) {
  try {
    const companyId = req.user.companyId;
    const { country, year, type } = req.query;
    let sql = `SELECT * FROM tax_rules WHERE company_id = $1`;
    const params = [companyId];

    if (country) {
      params.push(country.toUpperCase());
      sql += ` AND country_code = $${params.length}`;
    }
    if (year) {
      params.push(Number(year));
      sql += ` AND tax_year = $${params.length}`;
    }
    if (type) {
      params.push(type);
      sql += ` AND tax_type = $${params.length}`;
    }

    sql += ` ORDER BY country_code ASC, tax_year DESC, tax_type ASC`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createTaxRule(req, res) {
  try {
    const companyId = req.user.companyId;
    const { countryCode, taxType, stateOrRegion = "all", taxYear, effectiveStartDate, description, rulesData, status = "verified" } = req.body;

    if (!countryCode || !taxType || !taxYear || !rulesData) {
      return res.status(400).json({ error: "countryCode, taxType, taxYear, and rulesData are required." });
    }

    const id = `tax_${companyId}_${countryCode.toLowerCase()}_${taxType}_${taxYear}_${Date.now()}`;
    const result = await query(`
      INSERT INTO tax_rules (id, company_id, country_code, tax_type, state_or_region, tax_year, status, effective_start_date, description, rules_data, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      id, companyId, countryCode.toUpperCase(), taxType, stateOrRegion,
      Number(taxYear), status, effectiveStartDate || '2026-01-01', description,
      JSON.stringify(rulesData), req.user.id
    ]);

    await logPayrollAudit({
      companyId,
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: "TAX_RULE_CREATE",
      entityType: "tax_rule",
      entityId: id,
      updatedValues: result.rows[0]
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateTaxRule(req, res) {
  try {
    const companyId = req.user.companyId;
    const ruleId = req.params.id;
    const { status, description, rulesData, effectiveEndDate } = req.body;

    // Check if tax rule has already been used in an APPROVED payroll run
    const checkUsed = await query(`
      SELECT 1 FROM global_payroll_items gpi
      JOIN global_payroll_runs gpr ON gpi.payroll_run_id = gpr.id
      WHERE gpi.company_id = $1 AND gpr.status = 'APPROVED'
        AND gpi.tax_rules_used::text LIKE $2
      LIMIT 1
    `, [companyId, `%${ruleId}%`]);

    if (checkUsed.rows.length > 0) {
      return res.status(403).json({
        error: "Cannot modify a tax rule that has already been used in an approved payroll run. Create a new effective-dated tax rule version instead."
      });
    }

    const existing = await query(`SELECT * FROM tax_rules WHERE id = $1 AND company_id = $2`, [ruleId, companyId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Tax rule not found." });
    }

    const updated = await query(`
      UPDATE tax_rules
      SET status = COALESCE($1, status),
          description = COALESCE($2, description),
          rules_data = COALESCE($3, rules_data),
          effective_end_date = COALESCE($4, effective_end_date),
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 AND company_id = $6
      RETURNING *
    `, [
      status, description, rulesData ? JSON.stringify(rulesData) : null,
      effectiveEndDate, ruleId, companyId
    ]);

    await logPayrollAudit({
      companyId,
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: "TAX_RULE_UPDATE",
      entityType: "tax_rule",
      entityId: ruleId,
      previousValues: existing.rows[0],
      updatedValues: updated.rows[0]
    });

    res.json(updated.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// -------------------------------------------------------------
// 5. EMPLOYEE PAYROLL CONFIGURATION (ADMIN ONLY)
// -------------------------------------------------------------
export async function getEmployeesPayrollProfiles(req, res) {
  try {
    const companyId = req.user.companyId;
    const result = await query(`
      SELECT u.id as user_id, u.name, u.email, u.department, u.designation, u.employee_id as employee_code,
             epp.id as profile_id, epp.country_code, epp.employment_classification, epp.salary_currency,
             epp.annual_salary, epp.monthly_base_salary, epp.pay_frequency, epp.allowances, epp.deductions,
             epp.tax_profile, epp.bank_details, epp.is_active, epp.effective_date
      FROM users u
      LEFT JOIN employee_payroll_profiles epp ON (u.id = epp.user_id AND u.company_id = epp.company_id)
      WHERE u.company_id = $1 AND u.role != 'superadmin'
      ORDER BY u.name ASC
    `, [companyId]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getEmployeePayrollProfile(req, res) {
  try {
    const companyId = req.user.companyId;
    const userId = req.params.id;

    const result = await query(`
      SELECT u.id as user_id, u.name, u.email, u.department, u.designation,
             epp.*
      FROM users u
      LEFT JOIN employee_payroll_profiles epp ON (u.id = epp.user_id AND u.company_id = epp.company_id)
      WHERE u.company_id = $1 AND u.id = $2
    `, [companyId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found." });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function saveEmployeePayrollProfile(req, res) {
  try {
    const companyId = req.user.companyId;
    const userId = req.params.id;
    const {
      countryCode,
      employmentClassification,
      salaryCurrency,
      annualSalary,
      monthlyBaseSalary,
      payFrequency = "monthly",
      allowances = [],
      deductions = [],
      taxProfile = {},
      bankDetails = {},
      isActive = true,
      effectiveDate
    } = req.body;

    if (!countryCode || !employmentClassification || !salaryCurrency) {
      return res.status(400).json({ error: "countryCode, employmentClassification, and salaryCurrency are required." });
    }

    const id = `epp_${companyId}_${userId}`;
    const numAnnual = new Decimal(annualSalary || 0);
    const numMonthly = monthlyBaseSalary !== undefined ? new Decimal(monthlyBaseSalary) : numAnnual.div(12).round(2);

    const existing = await query(`SELECT * FROM employee_payroll_profiles WHERE user_id = $1 AND company_id = $2`, [userId, companyId]);

    const result = await query(`
      INSERT INTO employee_payroll_profiles (
        id, company_id, user_id, country_code, employment_classification, salary_currency,
        annual_salary, monthly_base_salary, pay_frequency, allowances, deductions,
        tax_profile, bank_details, is_active, effective_date, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
      ON CONFLICT (company_id, user_id) DO UPDATE SET
        country_code = EXCLUDED.country_code,
        employment_classification = EXCLUDED.employment_classification,
        salary_currency = EXCLUDED.salary_currency,
        annual_salary = EXCLUDED.annual_salary,
        monthly_base_salary = EXCLUDED.monthly_base_salary,
        pay_frequency = EXCLUDED.pay_frequency,
        allowances = EXCLUDED.allowances,
        deductions = EXCLUDED.deductions,
        tax_profile = EXCLUDED.tax_profile,
        bank_details = EXCLUDED.bank_details,
        is_active = EXCLUDED.is_active,
        effective_date = EXCLUDED.effective_date,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      id, companyId, userId, countryCode.toUpperCase(), employmentClassification, salaryCurrency.toUpperCase(),
      numAnnual.toFixed(2), numMonthly.toFixed(2), payFrequency, JSON.stringify(allowances),
      JSON.stringify(deductions), JSON.stringify(taxProfile), JSON.stringify(bankDetails),
      isActive, effectiveDate || new Date().toISOString().split("T")[0]
    ]);

    await logPayrollAudit({
      companyId,
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: "EMPLOYEE_PAYROLL_PROFILE_SAVE",
      entityType: "employee_payroll_profile",
      entityId: userId,
      previousValues: existing.rows[0] || null,
      updatedValues: result.rows[0]
    });

    res.status(200).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// -------------------------------------------------------------
// 6. GLOBAL PAYROLL CALCULATION, PROCESSING & APPROVAL
// -------------------------------------------------------------
export async function calculateGlobalPayroll(req, res) {
  try {
    const companyId = req.user.companyId;
    const { countryCode, currency, periodStart, periodEnd, payDate, payFrequency = "monthly", employeeIds = [] } = req.body;

    if (!countryCode || !periodStart || !periodEnd) {
      return res.status(400).json({ error: "countryCode, periodStart, and periodEnd are required." });
    }

    const country = countryCode.toUpperCase();
    const reportingCurrency = await getCompanyReportingCurrency(companyId);

    // 1. Fetch reporting exchange rate for this run's currency
    const runCurrency = (currency || (country === "US" ? "USD" : country === "GB" ? "GBP" : country === "AE" ? "AED" : "INR")).toUpperCase();
    const rateToReporting = await getExchangeRate(companyId, runCurrency, reportingCurrency.code, periodEnd);
    const exchangeRateReportingDec = new Decimal(rateToReporting.rate);

    // 2. Fetch verified tax rules for this country and year
    const taxYear = new Date(periodEnd).getFullYear() || 2026;
    const taxRules = await getVerifiedTaxRules(companyId, country, taxYear);

    // 3. Fetch eligible employees
    let empSql = `
      SELECT u.id, u.name, u.email, u.gross_salary,
             epp.country_code, epp.employment_classification, epp.salary_currency,
             epp.annual_salary, epp.monthly_base_salary, epp.allowances, epp.deductions,
             epp.tax_profile, epp.bank_details
      FROM users u
      LEFT JOIN employee_payroll_profiles epp ON (u.id = epp.user_id AND u.company_id = epp.company_id)
      WHERE u.company_id = $1 AND u.role != 'superadmin'
        AND COALESCE(epp.country_code, 'IN') = $2
    `;
    const empParams = [companyId, country];
    if (Array.isArray(employeeIds) && employeeIds.length > 0) {
      empParams.push(employeeIds);
      empSql += ` AND u.id = ANY($${empParams.length})`;
    }

    const employees = await query(empSql, empParams);
    if (employees.rows.length === 0) {
      return res.status(400).json({ error: `No active employees found for country ${country}.` });
    }

    // 4. Calculate line items per employee with strict decimal precision
    const runNumber = `RUN_${country}_${periodStart.replace(/-/g, "")}_${Date.now().toString().slice(-4)}`;
    const runId = `run_${companyId}_${country}_${periodStart}_${periodEnd}_${payFrequency}`;

    let totalGrossDec = new Decimal(0);
    let totalStatutoryDec = new Decimal(0);
    let totalOtherDeductionsDec = new Decimal(0);
    let totalNetDec = new Decimal(0);
    let totalEmployerDec = new Decimal(0);

    const calculatedItems = [];

    for (const emp of employees.rows) {
      const classification = emp.employment_classification || (country === "US" ? "w2" : country === "GB" ? "standard_uk" : country === "AE" ? "wps_uae" : "india_regular");
      const baseMonthly = emp.monthly_base_salary ? new Decimal(emp.monthly_base_salary) : new Decimal(emp.gross_salary || 30000);
      const allowances = Array.isArray(emp.allowances) ? emp.allowances : [];
      const deductions = Array.isArray(emp.deductions) ? emp.deductions : [];
      const taxProfile = emp.tax_profile || {};

      let itemCalc;
      if (country === "US") {
        let totalAllowances = new Decimal(0);
        for (const a of allowances) totalAllowances = totalAllowances.add(new Decimal(a.amount || 0));
        const totalGross = baseMonthly.add(totalAllowances);

        itemCalc = calculateUnitedStatesPayroll({
          grossSalary: totalGross.toFixed(2),
          payFrequency,
          classification,
          taxProfile,
          taxRules,
          preTaxDeductions: deductions.filter(d => d.type === "pre_tax"),
          postTaxDeductions: deductions.filter(d => d.type !== "pre_tax")
        });
        itemCalc.basicSalary = baseMonthly.toFixed(2);
        itemCalc.allowances = totalAllowances.toFixed(2);
      } else if (country === "GB") {
        let totalAllowances = new Decimal(0);
        for (const a of allowances) totalAllowances = totalAllowances.add(new Decimal(a.amount || 0));
        const totalGross = baseMonthly.add(totalAllowances);

        itemCalc = calculateUnitedKingdomPayroll({
          grossSalary: totalGross.toFixed(2),
          payFrequency,
          taxProfile,
          taxRules,
          deductions
        });
        itemCalc.basicSalary = baseMonthly.toFixed(2);
        itemCalc.allowances = totalAllowances.toFixed(2);
      } else if (country === "AE") {
        const housing = allowances.find(a => a.name?.toLowerCase().includes("house") || a.name?.toLowerCase().includes("housing"))?.amount || 0;
        const transport = allowances.find(a => a.name?.toLowerCase().includes("transport"))?.amount || 0;
        const otherAll = allowances.filter(a => !a.name?.toLowerCase().includes("house") && !a.name?.toLowerCase().includes("transport")).reduce((sum, a) => sum + Number(a.amount || 0), 0);

        itemCalc = calculateUnitedArabEmiratesPayroll({
          basicSalary: baseMonthly.toFixed(2),
          housingAllowance: housing,
          transportAllowance: transport,
          otherAllowances: otherAll,
          deductions
        });
      } else {
        // India
        itemCalc = calculateIndiaPayroll({
          grossSalary: baseMonthly.toFixed(2),
          paidDays: 30,
          workingDays: 30
        });
      }

      const grossDec = new Decimal(itemCalc.grossSalary);
      const statDec = new Decimal(itemCalc.statutoryDeductions);
      const otherDec = new Decimal(itemCalc.otherDeductions);
      const netDec = new Decimal(itemCalc.netSalary);
      const employerDec = new Decimal(itemCalc.employerContributions);

      totalGrossDec = totalGrossDec.add(grossDec);
      totalStatutoryDec = totalStatutoryDec.add(statDec);
      totalOtherDeductionsDec = totalOtherDeductionsDec.add(otherDec);
      totalNetDec = totalNetDec.add(netDec);
      totalEmployerDec = totalEmployerDec.add(employerDec);

      calculatedItems.push({
        id: `item_${runId}_${emp.id}`,
        userId: emp.id,
        employeeName: emp.name,
        employeeEmail: emp.email,
        countryCode: country,
        currency: runCurrency,
        reportingCurrency: reportingCurrency.code,
        exchangeRate: exchangeRateReportingDec.toFixed(6),
        employmentClassification: classification,
        basicSalary: itemCalc.basicSalary || baseMonthly.toFixed(2),
        allowances: itemCalc.allowances || "0.00",
        grossSalary: grossDec.toFixed(2),
        statutoryDeductions: statDec.toFixed(2),
        taxBreakdown: itemCalc.taxBreakdown,
        otherDeductions: otherDec.toFixed(2),
        employerContributions: employerDec.toFixed(2),
        employerBreakdown: itemCalc.employerBreakdown,
        netSalary: netDec.toFixed(2),
        grossReporting: grossDec.mul(exchangeRateReportingDec).round(2).toFixed(2),
        netReporting: netDec.mul(exchangeRateReportingDec).round(2).toFixed(2),
        taxRulesUsed: itemCalc.taxRulesUsed
      });
    }

    const totalGrossReporting = totalGrossDec.mul(exchangeRateReportingDec).round(2);
    const totalNetReporting = totalNetDec.mul(exchangeRateReportingDec).round(2);

    res.json({
      runId,
      runNumber,
      countryCode: country,
      currency: runCurrency,
      reportingCurrency: reportingCurrency.code,
      reportingExchangeRate: exchangeRateReportingDec.toFixed(6),
      periodStart,
      periodEnd,
      payDate: payDate || periodEnd,
      payFrequency,
      employeeCount: calculatedItems.length,
      totalGross: totalGrossDec.toFixed(2),
      totalStatutoryDeductions: totalStatutoryDec.toFixed(2),
      totalOtherDeductions: totalOtherDeductionsDec.toFixed(2),
      totalNet: totalNetDec.toFixed(2),
      totalEmployerContributions: totalEmployerDec.toFixed(2),
      totalGrossReporting: totalGrossReporting.toFixed(2),
      totalNetReporting: totalNetReporting.toFixed(2),
      items: calculatedItems
    });
  } catch (err) {
    console.error("calculateGlobalPayroll error:", err);
    res.status(400).json({ error: err.message });
  }
}

export async function processGlobalPayrollRun(req, res) {
  try {
    const companyId = req.user.companyId;
    const { runData } = req.body;

    if (!runData || !runData.runId || !runData.items) {
      return res.status(400).json({ error: "Complete runData with calculated items required." });
    }

    // Prevent duplicate processing of already approved run
    const existing = await query(`
      SELECT id, status FROM global_payroll_runs 
      WHERE id = $1 AND company_id = $2
    `, [runData.runId, companyId]);

    if (existing.rows.length > 0 && existing.rows[0].status === "APPROVED") {
      return res.status(400).json({ error: "This payroll run has already been approved and locked." });
    }

    // Save or update run in PENDING_APPROVAL status
    await query(`
      INSERT INTO global_payroll_runs (
        id, company_id, run_number, country_code, currency, reporting_currency,
        reporting_exchange_rate, period_start, period_end, pay_date, pay_frequency,
        status, total_gross, total_statutory_deductions, total_other_deductions, total_net,
        total_employer_contributions, total_gross_reporting, total_net_reporting,
        employee_count, created_by, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING_APPROVAL', $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        run_number = EXCLUDED.run_number,
        status = 'PENDING_APPROVAL',
        total_gross = EXCLUDED.total_gross,
        total_statutory_deductions = EXCLUDED.total_statutory_deductions,
        total_other_deductions = EXCLUDED.total_other_deductions,
        total_net = EXCLUDED.total_net,
        total_employer_contributions = EXCLUDED.total_employer_contributions,
        total_gross_reporting = EXCLUDED.total_gross_reporting,
        total_net_reporting = EXCLUDED.total_net_reporting,
        employee_count = EXCLUDED.employee_count,
        updated_at = CURRENT_TIMESTAMP
    `, [
      runData.runId, companyId, runData.runNumber, runData.countryCode, runData.currency,
      runData.reportingCurrency, runData.reportingExchangeRate, runData.periodStart,
      runData.periodEnd, runData.payDate, runData.payFrequency, runData.totalGross,
      runData.totalStatutoryDeductions, runData.totalOtherDeductions, runData.totalNet,
      runData.totalEmployerContributions, runData.totalGrossReporting, runData.totalNetReporting,
      runData.employeeCount, req.user.id
    ]);

    // Insert line items
    for (const item of runData.items) {
      await query(`
        INSERT INTO global_payroll_items (
          id, payroll_run_id, company_id, user_id, employee_name, employee_email,
          country_code, currency, reporting_currency, exchange_rate, employment_classification,
          basic_salary, allowances, gross_salary, statutory_deductions, tax_breakdown,
          other_deductions, employer_contributions, employer_breakdown, net_salary,
          gross_reporting, net_reporting, tax_rules_used, status, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 'PENDING_APPROVAL', CURRENT_TIMESTAMP)
        ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET
          basic_salary = EXCLUDED.basic_salary,
          allowances = EXCLUDED.allowances,
          gross_salary = EXCLUDED.gross_salary,
          statutory_deductions = EXCLUDED.statutory_deductions,
          tax_breakdown = EXCLUDED.tax_breakdown,
          other_deductions = EXCLUDED.other_deductions,
          employer_contributions = EXCLUDED.employer_contributions,
          employer_breakdown = EXCLUDED.employer_breakdown,
          net_salary = EXCLUDED.net_salary,
          gross_reporting = EXCLUDED.gross_reporting,
          net_reporting = EXCLUDED.net_reporting,
          status = 'PENDING_APPROVAL',
          updated_at = CURRENT_TIMESTAMP
      `, [
        item.id, runData.runId, companyId, item.userId, item.employeeName, item.employeeEmail,
        item.countryCode, item.currency, item.reportingCurrency, item.exchangeRate,
        item.employmentClassification, item.basicSalary, item.allowances, item.grossSalary,
        item.statutoryDeductions, JSON.stringify(item.taxBreakdown), item.otherDeductions,
        item.employerContributions, JSON.stringify(item.employerBreakdown), item.netSalary,
        item.grossReporting, item.netReporting, JSON.stringify(item.taxRulesUsed)
      ]);
    }

    await logPayrollAudit({
      companyId,
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: "GLOBAL_PAYROLL_SUBMITTED_FOR_APPROVAL",
      entityType: "payroll_run",
      entityId: runData.runId,
      updatedValues: { runNumber: runData.runNumber, employeeCount: runData.employeeCount, totalNet: runData.totalNet }
    });

    res.status(201).json({ message: "Payroll run submitted for approval.", runId: runData.runId, status: "PENDING_APPROVAL" });
  } catch (err) {
    console.error("processGlobalPayrollRun error:", err);
    res.status(400).json({ error: err.message });
  }
}

export async function approveGlobalPayrollRun(req, res) {
  try {
    const companyId = req.user.companyId;
    const runId = req.params.id;

    const runRes = await query(`SELECT * FROM global_payroll_runs WHERE id = $1 AND company_id = $2`, [runId, companyId]);
    if (runRes.rows.length === 0) {
      return res.status(404).json({ error: "Payroll run not found." });
    }

    const run = runRes.rows[0];
    if (run.status === "APPROVED" || run.status === "COMPLETED") {
      return res.status(400).json({ error: "Payroll run is already approved." });
    }

    // Approve run and publish payslips
    await query(`
      UPDATE global_payroll_runs
      SET status = 'APPROVED',
          approved_by = $1,
          approved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND company_id = $3
    `, [req.user.id, runId, companyId]);

    await query(`
      UPDATE global_payroll_items
      SET status = 'APPROVED',
          is_published = TRUE,
          updated_at = CURRENT_TIMESTAMP
      WHERE payroll_run_id = $1 AND company_id = $2
    `, [runId, companyId]);

    await logPayrollAudit({
      companyId,
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: "GLOBAL_PAYROLL_APPROVED",
      entityType: "payroll_run",
      entityId: runId,
      updatedValues: { approvedBy: req.user.id, approvedAt: new Date().toISOString() }
    });

    res.json({ message: "Payroll run approved successfully. Payslips published.", runId, status: "APPROVED" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function reverseGlobalPayrollRun(req, res) {
  try {
    const companyId = req.user.companyId;
    const runId = req.params.id;
    const { reversalReason } = req.body;

    if (!reversalReason) {
      return res.status(400).json({ error: "Reversal reason is mandatory for audit compliance." });
    }

    const runRes = await query(`SELECT * FROM global_payroll_runs WHERE id = $1 AND company_id = $2`, [runId, companyId]);
    if (runRes.rows.length === 0) {
      return res.status(404).json({ error: "Payroll run not found." });
    }

    await query(`
      UPDATE global_payroll_runs
      SET status = 'REVERSED',
          reversal_reason = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND company_id = $3
    `, [reversalReason, runId, companyId]);

    await query(`
      UPDATE global_payroll_items
      SET status = 'REVERSED',
          is_published = FALSE,
          updated_at = CURRENT_TIMESTAMP
      WHERE payroll_run_id = $1 AND company_id = $2
    `, [runId, companyId]);

    await logPayrollAudit({
      companyId,
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: "GLOBAL_PAYROLL_REVERSED",
      entityType: "payroll_run",
      entityId: runId,
      updatedValues: { reversalReason, reversedAt: new Date().toISOString() }
    });

    res.json({ message: "Payroll run reversed successfully.", runId, status: "REVERSED" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getGlobalPayrollRuns(req, res) {
  try {
    const isSuperAdmin = req.user?.role?.toLowerCase() === "superadmin";
    const companyId = (isSuperAdmin && req.query.companyId) ? req.query.companyId : req.user.companyId;
    const { country, status, year } = req.query;

    let sql = `SELECT * FROM global_payroll_runs WHERE company_id = $1`;
    const params = [companyId];

    if (country) {
      params.push(country.toUpperCase());
      sql += ` AND country_code = $${params.length}`;
    }
    if (status) {
      params.push(status.toUpperCase());
      sql += ` AND status = $${params.length}`;
    }
    if (year) {
      params.push(Number(year));
      sql += ` AND EXTRACT(YEAR FROM period_start) = $${params.length}`;
    }

    sql += ` ORDER BY period_start DESC, created_at DESC`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getGlobalPayrollRunDetails(req, res) {
  try {
    const companyId = req.user.companyId;
    const runId = req.params.id;

    const runRes = await query(`SELECT * FROM global_payroll_runs WHERE id = $1 AND company_id = $2`, [runId, companyId]);
    if (runRes.rows.length === 0) {
      return res.status(404).json({ error: "Payroll run not found." });
    }

    const itemsRes = await query(`
      SELECT * FROM global_payroll_items 
      WHERE payroll_run_id = $1 AND company_id = $2
      ORDER BY employee_name ASC
    `, [runId, companyId]);

    res.json({
      ...runRes.rows[0],
      items: itemsRes.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// -------------------------------------------------------------
// 7. PAYSLIPS (ADMIN & EMPLOYEE)
// -------------------------------------------------------------
export async function getAdminPayslips(req, res) {
  try {
    const companyId = req.user.companyId;
    const { country, currency, month, year, search } = req.query;

    let sql = `
      SELECT gpi.*, gpr.period_start, gpr.period_end, gpr.pay_date, gpr.run_number
      FROM global_payroll_items gpi
      JOIN global_payroll_runs gpr ON gpi.payroll_run_id = gpr.id
      WHERE gpi.company_id = $1
    `;
    const params = [companyId];

    if (country) {
      params.push(country.toUpperCase());
      sql += ` AND gpi.country_code = $${params.length}`;
    }
    if (currency) {
      params.push(currency.toUpperCase());
      sql += ` AND gpi.currency = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (gpi.employee_name ILIKE $${params.length} OR gpi.employee_email ILIKE $${params.length})`;
    }

    sql += ` ORDER BY gpr.period_start DESC, gpi.employee_name ASC LIMIT 100`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getMyEmployeePayslips(req, res) {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;

    // Strict access control: employees can ONLY view their own published payslips!
    const result = await query(`
      SELECT gpi.*, gpr.period_start, gpr.period_end, gpr.pay_date, gpr.run_number
      FROM global_payroll_items gpi
      JOIN global_payroll_runs gpr ON gpi.payroll_run_id = gpr.id
      WHERE gpi.user_id = $1 AND gpi.company_id = $2 AND gpi.is_published = TRUE
      ORDER BY gpr.period_start DESC
    `, [userId, companyId]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// -------------------------------------------------------------
// 8. REPORTS & EXPORTS
// -------------------------------------------------------------
export async function getGlobalPayrollReports(req, res) {
  try {
    const companyId = req.user.companyId;
    const { country, currency, startDate, endDate } = req.query;

    const reportingCurrency = await getCompanyReportingCurrency(companyId);

    let sql = `
      SELECT 
        gpi.country_code,
        gpi.currency,
        COUNT(gpi.id) as payslip_count,
        SUM(gpi.gross_salary) as total_gross,
        SUM(gpi.statutory_deductions) as total_tax_deductions,
        SUM(gpi.other_deductions) as total_other_deductions,
        SUM(gpi.employer_contributions) as total_employer_contributions,
        SUM(gpi.net_salary) as total_net,
        SUM(gpi.gross_reporting) as total_gross_reporting,
        SUM(gpi.net_reporting) as total_net_reporting
      FROM global_payroll_items gpi
      JOIN global_payroll_runs gpr ON gpi.payroll_run_id = gpr.id
      WHERE gpi.company_id = $1 AND gpr.status IN ('APPROVED', 'COMPLETED')
    `;
    const params = [companyId];

    if (country) {
      params.push(country.toUpperCase());
      sql += ` AND gpi.country_code = $${params.length}`;
    }
    if (currency) {
      params.push(currency.toUpperCase());
      sql += ` AND gpi.currency = $${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      sql += ` AND gpr.period_start >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      sql += ` AND gpr.period_end <= $${params.length}`;
    }

    sql += ` GROUP BY gpi.country_code, gpi.currency ORDER BY gpi.country_code ASC`;
    const result = await query(sql, params);

    res.json({
      reportingCurrency,
      breakdown: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// -------------------------------------------------------------
// 9. WPS EXPORT
// -------------------------------------------------------------
export async function exportWpsSif(req, res) {
  try {
    const companyId = req.user.companyId;
    const runId = req.params.id;
    const { employerEid, bankRoutingCode } = req.body;

    const sifData = await generateWpsSifFile({
      companyId,
      payrollRunId: runId,
      employerEid,
      bankRoutingCode,
      adminUser: req.user
    });

    res.json(sifData);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// -------------------------------------------------------------
// 10. AUDIT LOGS
// -------------------------------------------------------------
export async function getPayrollAuditLogs(req, res) {
  try {
    const isSuperAdmin = req.user?.role?.toLowerCase() === "superadmin";
    const companyId = (isSuperAdmin && req.query.companyId) ? req.query.companyId : req.user.companyId;
    const { action, limit = 100 } = req.query;

    let sql = `SELECT * FROM payroll_audit_logs WHERE company_id = $1`;
    const params = [companyId];

    if (action) {
      params.push(action);
      sql += ` AND action = $${params.length}`;
    }

    params.push(Number(limit));
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

