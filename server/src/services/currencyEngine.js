import { query } from "../config/db.js";
import { Decimal, D } from "../utils/financialMath.js";
import { logPayrollAudit } from "./payrollAuditService.js";

/**
 * Currency & Exchange Rate Management Engine
 */

export async function getCompanyCurrencies(companyId) {
  const res = await query(`
    SELECT * FROM currencies 
    WHERE company_id = $1 
    ORDER BY is_company_default DESC, is_reporting_currency DESC, code ASC
  `, [companyId]);
  return res.rows;
}

export async function addCompanyCurrency(companyId, { code, name, symbol, decimalPrecision = 2, isCompanyDefault = false, isReportingCurrency = false }, adminUser) {
  if (!code || !name || !symbol) {
    throw new Error("Currency code, name, and symbol are required.");
  }
  const cleanCode = code.toUpperCase().trim();
  const id = `curr_${companyId}_${cleanCode.toLowerCase()}`;

  // If setting default or reporting, clear previous flags for this company
  if (isCompanyDefault) {
    await query(`UPDATE currencies SET is_company_default = FALSE WHERE company_id = $1`, [companyId]);
  }
  if (isReportingCurrency) {
    await query(`UPDATE currencies SET is_reporting_currency = FALSE WHERE company_id = $1`, [companyId]);
  }

  const res = await query(`
    INSERT INTO currencies (id, company_id, code, name, symbol, decimal_precision, is_enabled, is_company_default, is_reporting_currency, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, CURRENT_TIMESTAMP)
    ON CONFLICT (company_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      symbol = EXCLUDED.symbol,
      decimal_precision = EXCLUDED.decimal_precision,
      is_enabled = TRUE,
      is_company_default = EXCLUDED.is_company_default,
      is_reporting_currency = EXCLUDED.is_reporting_currency,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [id, companyId, cleanCode, name, symbol, decimalPrecision, isCompanyDefault, isReportingCurrency]);

  await logPayrollAudit({
    companyId,
    userId: adminUser?.id,
    userName: adminUser?.name,
    userRole: adminUser?.role,
    action: "CURRENCY_ADD_OR_UPDATE",
    entityType: "currency",
    entityId: id,
    updatedValues: res.rows[0]
  });

  return res.rows[0];
}

export async function updateCompanyCurrency(companyId, currencyId, updates, adminUser) {
  const existing = await query(`SELECT * FROM currencies WHERE id = $1 AND company_id = $2`, [currencyId, companyId]);
  if (existing.rows.length === 0) {
    throw new Error("Currency not found.");
  }
  const prev = existing.rows[0];

  if (updates.isCompanyDefault) {
    await query(`UPDATE currencies SET is_company_default = FALSE WHERE company_id = $1`, [companyId]);
  }
  if (updates.isReportingCurrency) {
    await query(`UPDATE currencies SET is_reporting_currency = FALSE WHERE company_id = $1`, [companyId]);
  }

  const res = await query(`
    UPDATE currencies 
    SET name = COALESCE($1, name),
        symbol = COALESCE($2, symbol),
        decimal_precision = COALESCE($3, decimal_precision),
        is_enabled = COALESCE($4, is_enabled),
        is_company_default = COALESCE($5, is_company_default),
        is_reporting_currency = COALESCE($6, is_reporting_currency),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $7 AND company_id = $8
    RETURNING *
  `, [
    updates.name,
    updates.symbol,
    updates.decimalPrecision,
    updates.isEnabled,
    updates.isCompanyDefault,
    updates.isReportingCurrency,
    currencyId,
    companyId
  ]);

  await logPayrollAudit({
    companyId,
    userId: adminUser?.id,
    userName: adminUser?.name,
    userRole: adminUser?.role,
    action: "CURRENCY_UPDATE",
    entityType: "currency",
    entityId: currencyId,
    previousValues: prev,
    updatedValues: res.rows[0]
  });

  return res.rows[0];
}

export async function getCompanyExchangeRates(companyId, { from, to, date } = {}) {
  let sql = `SELECT * FROM exchange_rates WHERE company_id = $1`;
  const params = [companyId];

  if (from) {
    params.push(from.toUpperCase());
    sql += ` AND from_currency = $${params.length}`;
  }
  if (to) {
    params.push(to.toUpperCase());
    sql += ` AND to_currency = $${params.length}`;
  }
  if (date) {
    params.push(date);
    sql += ` AND effective_date <= $${params.length}`;
  }

  sql += ` ORDER BY effective_date DESC, created_at DESC LIMIT 100`;
  const res = await query(sql, params);
  return res.rows;
}

export async function addExchangeRate(companyId, { fromCurrency, toCurrency, rate, effectiveDate, source = "manual" }, adminUser) {
  if (!fromCurrency || !toCurrency || rate === undefined || rate === null) {
    throw new Error("fromCurrency, toCurrency, and rate are required.");
  }
  const from = fromCurrency.toUpperCase().trim();
  const to = toCurrency.toUpperCase().trim();
  const numRate = new Decimal(rate);

  if (numRate.lessThanOrEqualTo(0)) {
    throw new Error("Exchange rate must be strictly positive.");
  }

  const effDate = effectiveDate || new Date().toISOString().split("T")[0];
  const id = `rate_${companyId}_${from}_${to}_${effDate}_${Date.now()}`;

  const res = await query(`
    INSERT INTO exchange_rates (id, company_id, from_currency, to_currency, rate, source, effective_date, created_by, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
    RETURNING *
  `, [id, companyId, from, to, numRate.toFixed(6), source, effDate, adminUser?.id]);

  // Also auto-insert reciprocal inverse rate if not manually defined for today
  if (from !== to) {
    const inverseRate = new Decimal(1).div(numRate).round(6);
    const invId = `rate_${companyId}_${to}_${from}_${effDate}_${Date.now()}`;
    await query(`
      INSERT INTO exchange_rates (id, company_id, from_currency, to_currency, rate, source, effective_date, created_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'reciprocal_auto', $6, $7, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING
    `, [invId, companyId, to, from, inverseRate.toFixed(6), effDate, adminUser?.id]).catch(() => {});
  }

  await logPayrollAudit({
    companyId,
    userId: adminUser?.id,
    userName: adminUser?.name,
    userRole: adminUser?.role,
    action: "EXCHANGE_RATE_ADD",
    entityType: "exchange_rate",
    entityId: id,
    updatedValues: res.rows[0]
  });

  return res.rows[0];
}

/**
 * High-precision currency conversion engine
 */
export async function getExchangeRate(companyId, fromCurrency, toCurrency, effectiveDate = null) {
  const from = fromCurrency.toUpperCase().trim();
  const to = toCurrency.toUpperCase().trim();

  if (from === to) {
    return {
      fromCurrency: from,
      toCurrency: to,
      rate: "1.000000",
      source: "identity",
      effectiveDate: effectiveDate || new Date().toISOString().split("T")[0]
    };
  }

  const targetDate = effectiveDate || new Date().toISOString().split("T")[0];

  // 1. Direct rate lookup
  const directRes = await query(`
    SELECT rate, source, effective_date 
    FROM exchange_rates 
    WHERE company_id = $1 AND from_currency = $2 AND to_currency = $3 AND effective_date <= $4
    ORDER BY effective_date DESC, created_at DESC 
    LIMIT 1
  `, [companyId, from, to, targetDate]);

  if (directRes.rows.length > 0) {
    const r = directRes.rows[0];
    return {
      fromCurrency: from,
      toCurrency: to,
      rate: new Decimal(r.rate).toFixed(6),
      source: r.source,
      effectiveDate: r.effective_date
    };
  }

  // 2. Inverse rate lookup
  const inverseRes = await query(`
    SELECT rate, source, effective_date 
    FROM exchange_rates 
    WHERE company_id = $1 AND from_currency = $2 AND to_currency = $3 AND effective_date <= $4
    ORDER BY effective_date DESC, created_at DESC 
    LIMIT 1
  `, [companyId, to, from, targetDate]);

  if (inverseRes.rows.length > 0) {
    const r = inverseRes.rows[0];
    const invRate = new Decimal(1).div(new Decimal(r.rate)).round(6);
    return {
      fromCurrency: from,
      toCurrency: to,
      rate: invRate.toFixed(6),
      source: `derived_inverse_${r.source}`,
      effectiveDate: r.effective_date
    };
  }

  // 3. Triangular conversion via USD
  const fromToUsd = await query(`
    SELECT rate, source, effective_date 
    FROM exchange_rates 
    WHERE company_id = $1 AND from_currency = $2 AND to_currency = 'USD' AND effective_date <= $3
    ORDER BY effective_date DESC, created_at DESC LIMIT 1
  `, [companyId, from, targetDate]);

  const usdToTarget = await query(`
    SELECT rate, source, effective_date 
    FROM exchange_rates 
    WHERE company_id = $1 AND from_currency = 'USD' AND to_currency = $2 AND effective_date <= $3
    ORDER BY effective_date DESC, created_at DESC LIMIT 1
  `, [companyId, to, targetDate]);

  if (fromToUsd.rows.length > 0 && usdToTarget.rows.length > 0) {
    const rate1 = new Decimal(fromToUsd.rows[0].rate);
    const rate2 = new Decimal(usdToTarget.rows[0].rate);
    const crossRate = rate1.mul(rate2).round(6);
    return {
      fromCurrency: from,
      toCurrency: to,
      rate: crossRate.toFixed(6),
      source: "derived_triangular_usd",
      effectiveDate: targetDate
    };
  }

  throw new Error(`No validated exchange rate found between ${from} and ${to} for date ${targetDate}.`);
}

/**
 * Convert an amount between currencies with zero floating-point error
 */
export async function convertAmount(companyId, amount, fromCurrency, toCurrency, effectiveDate = null) {
  const decAmount = new Decimal(amount);
  const rateInfo = await getExchangeRate(companyId, fromCurrency, toCurrency, effectiveDate);
  const rateDec = new Decimal(rateInfo.rate);
  const convertedDec = decAmount.mul(rateDec).round(2);

  return {
    originalAmount: decAmount.toFixed(2),
    convertedAmount: convertedDec.toFixed(2),
    fromCurrency: rateInfo.fromCurrency,
    toCurrency: rateInfo.toCurrency,
    exchangeRate: rateInfo.rate,
    source: rateInfo.source,
    effectiveDate: rateInfo.effectiveDate
  };
}

/**
 * Get reporting currency for company (default is INR if not configured)
 */
export async function getCompanyReportingCurrency(companyId) {
  const res = await query(`
    SELECT code, symbol, decimal_precision 
    FROM currencies 
    WHERE company_id = $1 AND is_reporting_currency = TRUE 
    LIMIT 1
  `, [companyId]);

  if (res.rows.length > 0) {
    return res.rows[0];
  }
  return { code: "INR", symbol: "₹", decimal_precision: 2 };
}

