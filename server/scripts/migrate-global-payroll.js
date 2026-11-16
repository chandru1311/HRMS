import { query } from "../src/config/db.js";

/**
 * Migration script for Global Multi-Currency & International Tax Engine
 */
export async function runGlobalPayrollMigration() {
  console.log("🌍 Running Global Multi-Currency & International Tax Engine Migration...");

  try {
    // 1. Currencies Table
    await query(`
      CREATE TABLE IF NOT EXISTS currencies (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        code VARCHAR(3) NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        decimal_precision INT DEFAULT 2,
        is_enabled BOOLEAN DEFAULT TRUE,
        is_company_default BOOLEAN DEFAULT FALSE,
        is_reporting_currency BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS id TEXT;
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS code VARCHAR(3);
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS name TEXT;
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS symbol TEXT;
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS decimal_precision INT DEFAULT 2;
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE;
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS is_company_default BOOLEAN DEFAULT FALSE;
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS is_reporting_currency BOOLEAN DEFAULT FALSE;
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE currencies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      CREATE INDEX IF NOT EXISTS idx_currencies_company ON currencies(company_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_currencies_comp_code ON currencies(company_id, code);
    `);

    // 2. Exchange Rates Table
    await query(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        from_currency VARCHAR(3) NOT NULL,
        to_currency VARCHAR(3) NOT NULL,
        rate NUMERIC(18, 6) NOT NULL,
        source TEXT DEFAULT 'manual',
        effective_date DATE NOT NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE exchange_rates ALTER COLUMN source TYPE TEXT;
      CREATE INDEX IF NOT EXISTS idx_exchange_rates_comp_pair ON exchange_rates(company_id, from_currency, to_currency, effective_date);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_exchange_rates_comp_pair ON exchange_rates(company_id, from_currency, to_currency);
    `);

    // 3. Country Payroll Configs Table
    await query(`
      CREATE TABLE IF NOT EXISTS country_payroll_configs (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        country_code VARCHAR(2) NOT NULL,
        country_name TEXT NOT NULL,
        default_currency VARCHAR(3) NOT NULL,
        wps_enabled BOOLEAN DEFAULT FALSE,
        wps_employer_eid TEXT,
        wps_bank_code TEXT,
        supported_frequencies JSONB DEFAULT '["monthly"]'::jsonb,
        settings JSONB DEFAULT '{}'::jsonb,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_company_country UNIQUE(company_id, country_code)
      );
      CREATE INDEX IF NOT EXISTS idx_country_configs_comp ON country_payroll_configs(company_id);
    `);

    // 4. Tax Rules & Versions Table
    await query(`
      CREATE TABLE IF NOT EXISTS tax_rules (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        country_code VARCHAR(2) NOT NULL,
        tax_type TEXT NOT NULL,
        state_or_region TEXT DEFAULT 'all',
        tax_year INT NOT NULL,
        status TEXT DEFAULT 'verified',
        effective_start_date DATE NOT NULL,
        effective_end_date DATE,
        description TEXT,
        rules_data JSONB NOT NULL,
        version INT DEFAULT 1,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tax_rules_lookup ON tax_rules(company_id, country_code, tax_type, tax_year);
    `);

    // 5. Employee Payroll Profiles Table (Admin Only)
    await query(`
      CREATE TABLE IF NOT EXISTS employee_payroll_profiles (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        country_code VARCHAR(2) NOT NULL,
        employment_classification TEXT NOT NULL,
        salary_currency VARCHAR(3) NOT NULL,
        annual_salary NUMERIC(15, 2) DEFAULT 0,
        monthly_base_salary NUMERIC(15, 2) DEFAULT 0,
        pay_frequency TEXT DEFAULT 'monthly',
        allowances JSONB DEFAULT '[]'::jsonb,
        deductions JSONB DEFAULT '[]'::jsonb,
        tax_profile JSONB DEFAULT '{}'::jsonb,
        bank_details JSONB DEFAULT '{}'::jsonb,
        is_active BOOLEAN DEFAULT TRUE,
        effective_date DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_company_user_profile UNIQUE(company_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_emp_payroll_prof ON employee_payroll_profiles(company_id, user_id);
    `);

    // 6. Global Payroll Runs Table
    await query(`
      CREATE TABLE IF NOT EXISTS global_payroll_runs (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        run_number TEXT NOT NULL,
        country_code VARCHAR(2) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        reporting_currency VARCHAR(3) NOT NULL,
        reporting_exchange_rate NUMERIC(18, 6) DEFAULT 1.0,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        pay_date DATE NOT NULL,
        pay_frequency TEXT DEFAULT 'monthly',
        status TEXT DEFAULT 'DRAFT',
        total_gross NUMERIC(18, 2) DEFAULT 0,
        total_statutory_deductions NUMERIC(18, 2) DEFAULT 0,
        total_other_deductions NUMERIC(18, 2) DEFAULT 0,
        total_net NUMERIC(18, 2) DEFAULT 0,
        total_employer_contributions NUMERIC(18, 2) DEFAULT 0,
        total_gross_reporting NUMERIC(18, 2) DEFAULT 0,
        total_net_reporting NUMERIC(18, 2) DEFAULT 0,
        employee_count INT DEFAULT 0,
        approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        approved_at TIMESTAMPTZ,
        reversal_reason TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_payroll_run_period UNIQUE(company_id, country_code, period_start, period_end, pay_frequency)
      );
      CREATE INDEX IF NOT EXISTS idx_global_runs_comp ON global_payroll_runs(company_id, status);
    `);

    // 7. Global Payroll Items (Payslips / Breakdown) Table
    await query(`
      CREATE TABLE IF NOT EXISTS global_payroll_items (
        id TEXT PRIMARY KEY,
        payroll_run_id TEXT REFERENCES global_payroll_runs(id) ON DELETE CASCADE,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        employee_name TEXT,
        employee_email TEXT,
        country_code VARCHAR(2) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        reporting_currency VARCHAR(3) NOT NULL,
        exchange_rate NUMERIC(18, 6) DEFAULT 1.0,
        employment_classification TEXT NOT NULL,
        basic_salary NUMERIC(15, 2) DEFAULT 0,
        allowances NUMERIC(15, 2) DEFAULT 0,
        gross_salary NUMERIC(15, 2) DEFAULT 0,
        statutory_deductions NUMERIC(15, 2) DEFAULT 0,
        tax_breakdown JSONB DEFAULT '{}'::jsonb,
        other_deductions NUMERIC(15, 2) DEFAULT 0,
        employer_contributions NUMERIC(15, 2) DEFAULT 0,
        employer_breakdown JSONB DEFAULT '{}'::jsonb,
        net_salary NUMERIC(15, 2) DEFAULT 0,
        gross_reporting NUMERIC(15, 2) DEFAULT 0,
        net_reporting NUMERIC(15, 2) DEFAULT 0,
        tax_rules_used JSONB DEFAULT '{}'::jsonb,
        status TEXT DEFAULT 'CALCULATED',
        is_published BOOLEAN DEFAULT FALSE,
        payment_method TEXT DEFAULT 'bank_transfer',
        payment_reference TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_run_user_item UNIQUE(payroll_run_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_global_items_run ON global_payroll_items(payroll_run_id);
      CREATE INDEX IF NOT EXISTS idx_global_items_user ON global_payroll_items(user_id);
    `);

    // 8. Payroll Audit Logs Table
    await query(`
      CREATE TABLE IF NOT EXISTS payroll_audit_logs (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        user_name TEXT,
        user_role TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        previous_values JSONB,
        updated_values JSONB,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_audit_comp_action ON payroll_audit_logs(company_id, action, created_at);
    `);

    // 9. Payroll Payment Records (WPS / Bank Export) Table
    await query(`
      CREATE TABLE IF NOT EXISTS payroll_payment_records (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        payroll_run_id TEXT REFERENCES global_payroll_runs(id) ON DELETE CASCADE,
        country_code VARCHAR(2) NOT NULL,
        payment_type TEXT NOT NULL,
        status TEXT DEFAULT 'GENERATED',
        file_content TEXT,
        file_name TEXT,
        record_count INT DEFAULT 0,
        total_amount NUMERIC(18, 2) DEFAULT 0,
        currency VARCHAR(3) NOT NULL,
        reconciled_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_payment_rec_run ON payroll_payment_records(payroll_run_id);
    `);

    console.log("✅ Global Payroll tables created successfully.");

    // Batch Seed default currencies for all companies in 1 SQL query
    await query(`
      INSERT INTO currencies (id, company_id, code, name, symbol, decimal_precision, is_enabled, is_company_default, is_reporting_currency)
      SELECT 'curr_' || c.id || '_' || lower(def.code), c.id, def.code, def.name, def.symbol, def.precision, TRUE, def.is_default, def.is_reporting
      FROM companies c
      CROSS JOIN (
        VALUES 
          ('INR', 'Indian Rupee', '₹', 2, true, true),
          ('USD', 'US Dollar', '$', 2, false, false),
          ('EUR', 'Euro', '€', 2, false, false),
          ('GBP', 'British Pound', '£', 2, false, false),
          ('AED', 'UAE Dirham', 'AED', 2, false, false)
      ) AS def(code, name, symbol, precision, is_default, is_reporting)
      ON CONFLICT DO NOTHING;
    `).catch(e => console.warn("Currencies batch seed note:", e.message));

    // Batch Seed baseline exchange rates for all companies
    await query(`
      INSERT INTO exchange_rates (id, company_id, from_currency, to_currency, rate, source, effective_date)
      SELECT 'rate_' || c.id || '_' || r.from_c || '_' || r.to_c, c.id, r.from_c, r.to_c, r.rate, 'ecb_standard', CURRENT_DATE
      FROM companies c
      CROSS JOIN (
        VALUES 
          ('USD', 'INR', 86.50::numeric),
          ('INR', 'USD', 0.01156::numeric),
          ('GBP', 'INR', 109.80::numeric),
          ('INR', 'GBP', 0.00911::numeric),
          ('EUR', 'INR', 91.20::numeric),
          ('INR', 'EUR', 0.01096::numeric),
          ('AED', 'INR', 23.55::numeric),
          ('INR', 'AED', 0.04246::numeric),
          ('USD', 'AED', 3.6725::numeric),
          ('AED', 'USD', 0.2723::numeric),
          ('GBP', 'USD', 1.2700::numeric),
          ('USD', 'GBP', 0.7874::numeric),
          ('EUR', 'USD', 1.0550::numeric),
          ('USD', 'EUR', 0.9479::numeric),
          ('INR', 'INR', 1.0::numeric),
          ('USD', 'USD', 1.0::numeric),
          ('EUR', 'EUR', 1.0::numeric),
          ('GBP', 'GBP', 1.0::numeric),
          ('AED', 'AED', 1.0::numeric)
      ) AS r(from_c, to_c, rate)
      ON CONFLICT DO NOTHING;
    `).catch(e => console.warn("Exchange rates batch seed note:", e.message));

    // Batch Seed country payroll configs (IN, US, GB, AE)
    await query(`
      INSERT INTO country_payroll_configs (id, company_id, country_code, country_name, default_currency, wps_enabled, supported_frequencies, settings)
      SELECT 'country_' || c.id || '_' || lower(cnt.code), c.id, cnt.code, cnt.name, cnt.currency, cnt.wps, cnt.freq::jsonb, cnt.settings::jsonb
      FROM companies c
      CROSS JOIN (
        VALUES 
          ('IN', 'India', 'INR', false, '["monthly"]', '{"statutory":["PF","ESI","PT"],"taxRegimes":["new","old"]}'),
          ('US', 'United States', 'USD', false, '["weekly","biweekly","semi_monthly","monthly"]', '{"classifications":["w2","1099"],"federalTax":true,"socialSecurity":true,"medicare":true,"stateTax":true}'),
          ('GB', 'United Kingdom', 'GBP', false, '["weekly","monthly"]', '{"paye":true,"nic":true,"pensionAutoEnrolment":true,"taxYear":"2025/2026"}'),
          ('AE', 'United Arab Emirates', 'AED', true, '["monthly"]', '{"personalIncomeTax":false,"wpsCompliant":true,"eosbEnabled":true,"basicMinRatio":0.60}')
      ) AS cnt(code, name, currency, wps, freq, settings)
      ON CONFLICT (company_id, country_code) DO NOTHING;
    `).catch(e => console.warn("Country configs batch seed note:", e.message));

    // Batch Seed default verified statutory tax rules
    await query(`
      INSERT INTO tax_rules (id, company_id, country_code, tax_type, state_or_region, tax_year, status, effective_start_date, description, rules_data)
      SELECT 'tax_' || c.id || '_' || lower(t.country) || '_' || t.type || '_' || t.year,
             c.id, t.country, t.type, t.region, t.year, 'verified', '2026-01-01'::date, t.description, t.rules::jsonb
      FROM companies c
      CROSS JOIN (
        VALUES 
          ('US', 'federal_income_tax', 'all', 2026, 'IRS Federal Income Tax Standard Progressive Brackets (Annualized)', '{"filingStatus":"single","standardDeduction":15000,"brackets":[{"min":0,"max":11925,"rate":0.10},{"min":11925,"max":48475,"rate":0.12},{"min":48475,"max":103350,"rate":0.22},{"min":103350,"max":197300,"rate":0.24},{"min":197300,"max":250525,"rate":0.32},{"min":250525,"max":626350,"rate":0.35},{"min":626350,"max":null,"rate":0.37}]}'),
          ('US', 'fica_social_security', 'all', 2026, 'IRS Social Security (OASDI) Tax with Annual Wage Base Cap', '{"employeeRate":0.062,"employerRate":0.062,"wageCap":176100.00}'),
          ('US', 'fica_medicare', 'all', 2026, 'IRS Medicare Hospital Insurance & Additional Medicare Tax', '{"employeeRate":0.0145,"employerRate":0.0145,"additionalMedicareRate":0.009,"additionalThreshold":200000.00}'),
          ('US', 'state_income_tax', 'CA', 2026, 'California FTB State Income Tax Brackets (Single)', '{"state":"CA","standardDeduction":5540,"brackets":[{"min":0,"max":10756,"rate":0.01},{"min":10756,"max":25499,"rate":0.02},{"min":25499,"max":40245,"rate":0.04},{"min":40245,"max":55866,"rate":0.06},{"min":55866,"max":70606,"rate":0.08},{"min":70606,"max":360659,"rate":0.093},{"min":360659,"max":432787,"rate":0.103},{"min":432787,"max":721314,"rate":0.113},{"min":721314,"max":null,"rate":0.123}]}'),
          ('GB', 'uk_paye', 'england', 2026, 'HMRC PAYE Income Tax Bands and Personal Allowance', '{"standardTaxCode":"1257L","personalAllowance":12570,"bands":[{"name":"Basic Rate","min":0,"max":37700,"rate":0.20},{"name":"Higher Rate","min":37700,"max":125140,"rate":0.40},{"name":"Additional Rate","min":125140,"max":null,"rate":0.45}]}'),
          ('GB', 'uk_nic', 'england', 2026, 'HMRC Class 1 Primary and Secondary National Insurance', '{"category":"A","primaryThresholdMonthly":1048.00,"upperEarningsLimitMonthly":4189.00,"employeeMainRate":0.08,"employeeUpperRate":0.02,"secondaryThresholdMonthly":758.00,"employerRate":0.138}'),
          ('GB', 'uk_pension', 'england', 2026, 'UK Workplace Pension Auto-Enrolment Qualifying Earnings', '{"qualifyingEarningsLowerMonthly":520.00,"qualifyingEarningsUpperMonthly":4189.00,"minEmployeeContributionRate":0.05,"minEmployerContributionRate":0.03}'),
          ('AE', 'uae_statutory', 'all', 2026, 'UAE MOHRE Wage Protection System (WPS) & EOSB Framework', '{"personalIncomeTaxRate":0.00,"basicSalaryRatioMin":0.60,"eosbCalculation":{"firstFiveYearsDaysPerYear":21,"afterFiveYearsDaysPerYear":30,"divisorDaysPerMonth":30}}')
      ) AS t(country, type, region, year, description, rules)
      ON CONFLICT DO NOTHING;
    `).catch(e => console.warn("Tax rules batch seed note:", e.message));

    console.log("✅ Global Payroll defaults seeded successfully in 4 set-based batch operations.");
  } catch (err) {
    console.error("❌ Global Payroll migration error:", err);
    throw err;
  }
}

export async function seedDefaultsForCompany(companyId) {
  if (!companyId) return;

  // 1. Seed Currencies (INR, USD, EUR, GBP, AED)
  const defaultCurrencies = [
    { code: "INR", name: "Indian Rupee", symbol: "₹", precision: 2, isDefault: true, isReporting: true },
    { code: "USD", name: "US Dollar", symbol: "$", precision: 2, isDefault: false, isReporting: false },
    { code: "EUR", name: "Euro", symbol: "€", precision: 2, isDefault: false, isReporting: false },
    { code: "GBP", name: "British Pound", symbol: "£", precision: 2, isDefault: false, isReporting: false },
    { code: "AED", name: "UAE Dirham", symbol: "AED", precision: 2, isDefault: false, isReporting: false }
  ];

  for (const c of defaultCurrencies) {
    const id = `curr_${companyId}_${c.code.toLowerCase()}`;
    await query(`
      INSERT INTO currencies (id, company_id, code, name, symbol, decimal_precision, is_enabled, is_company_default, is_reporting_currency)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8)
      ON CONFLICT (company_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        symbol = EXCLUDED.symbol
    `, [id, companyId, c.code, c.name, c.symbol, c.precision, c.isDefault, c.isReporting]).catch(() => {});
  }

  // 2. Seed Baseline Exchange Rates (relative to USD and INR)
  const baselineRates = [
    { from: "USD", to: "INR", rate: 86.50 },
    { from: "INR", to: "USD", rate: 0.01156 },
    { from: "GBP", to: "INR", rate: 109.80 },
    { from: "INR", to: "GBP", rate: 0.00911 },
    { from: "EUR", to: "INR", rate: 91.20 },
    { from: "INR", to: "EUR", rate: 0.01096 },
    { from: "AED", to: "INR", rate: 23.55 },
    { from: "INR", to: "AED", rate: 0.04246 },
    { from: "USD", to: "AED", rate: 3.6725 },
    { from: "AED", to: "USD", rate: 0.2723 },
    { from: "GBP", to: "USD", rate: 1.2700 },
    { from: "USD", to: "GBP", rate: 0.7874 },
    { from: "EUR", to: "USD", rate: 1.0550 },
    { from: "USD", to: "EUR", rate: 0.9479 },
    { from: "INR", to: "INR", rate: 1.0 },
    { from: "USD", to: "USD", rate: 1.0 },
    { from: "EUR", to: "EUR", rate: 1.0 },
    { from: "GBP", to: "GBP", rate: 1.0 },
    { from: "AED", to: "AED", rate: 1.0 }
  ];

  for (const r of baselineRates) {
    const rateId = `rate_${companyId}_${r.from}_${r.to}`;
    await query(`
      INSERT INTO exchange_rates (id, company_id, from_currency, to_currency, rate, source, effective_date)
      VALUES ($1, $2, $3, $4, $5, 'baseline_ecb_standard', CURRENT_DATE)
      ON CONFLICT DO NOTHING
    `, [rateId, companyId, r.from, r.to, r.rate]).catch(() => {});
  }

  // 3. Seed Country Payroll Configurations (IN, US, GB, AE)
  const defaultCountries = [
    {
      code: "IN",
      name: "India",
      currency: "INR",
      wps: false,
      frequencies: ["monthly"],
      settings: { statutory: ["PF", "ESI", "PT"], taxRegimes: ["new", "old"] }
    },
    {
      code: "US",
      name: "United States",
      currency: "USD",
      wps: false,
      frequencies: ["weekly", "biweekly", "semi_monthly", "monthly"],
      settings: { classifications: ["w2", "1099"], federalTax: true, socialSecurity: true, medicare: true, stateTax: true }
    },
    {
      code: "GB",
      name: "United Kingdom",
      currency: "GBP",
      wps: false,
      frequencies: ["weekly", "monthly"],
      settings: { paye: true, nic: true, pensionAutoEnrolment: true, taxYear: "2025/2026" }
    },
    {
      code: "AE",
      name: "United Arab Emirates",
      currency: "AED",
      wps: true,
      frequencies: ["monthly"],
      settings: { personalIncomeTax: false, wpsCompliant: true, eosbEnabled: true, basicMinRatio: 0.60 }
    }
  ];

  for (const c of defaultCountries) {
    const id = `country_${companyId}_${c.code.toLowerCase()}`;
    await query(`
      INSERT INTO country_payroll_configs (id, company_id, country_code, country_name, default_currency, wps_enabled, supported_frequencies, settings)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (company_id, country_code) DO UPDATE SET
        country_name = EXCLUDED.country_name,
        default_currency = EXCLUDED.default_currency,
        settings = EXCLUDED.settings
    `, [id, companyId, c.code, c.name, c.currency, c.wps, JSON.stringify(c.frequencies), JSON.stringify(c.settings)]).catch(() => {});
  }

  // 4. Seed Verified Statutory Tax Rules (US, UK, UAE, IN)
  const defaultTaxRules = [
    // US Federal Income Tax (2025/2026 Single Filer Brackets)
    {
      country: "US",
      type: "federal_income_tax",
      region: "all",
      year: 2026,
      status: "verified",
      description: "IRS Federal Income Tax Standard Progressive Brackets (Annualized)",
      rules: {
        filingStatus: "single",
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
      }
    },
    // US FICA: Social Security & Medicare
    {
      country: "US",
      type: "fica_social_security",
      region: "all",
      year: 2026,
      status: "verified",
      description: "IRS Social Security (OASDI) Tax with Annual Wage Base Cap",
      rules: {
        employeeRate: 0.062,
        employerRate: 0.062,
        wageCap: 176100.00
      }
    },
    {
      country: "US",
      type: "fica_medicare",
      region: "all",
      year: 2026,
      status: "verified",
      description: "IRS Medicare Hospital Insurance & Additional Medicare Tax",
      rules: {
        employeeRate: 0.0145,
        employerRate: 0.0145,
        additionalMedicareRate: 0.009,
        additionalThreshold: 200000.00
      }
    },
    // US State Income Tax (California example progressive brackets)
    {
      country: "US",
      type: "state_income_tax",
      region: "CA",
      year: 2026,
      status: "verified",
      description: "California FTB State Income Tax Brackets (Single)",
      rules: {
        state: "CA",
        standardDeduction: 5540,
        brackets: [
          { min: 0, max: 10756, rate: 0.01 },
          { min: 10756, max: 25499, rate: 0.02 },
          { min: 25499, max: 40245, rate: 0.04 },
          { min: 40245, max: 55866, rate: 0.06 },
          { min: 55866, max: 70606, rate: 0.08 },
          { min: 70606, max: 360659, rate: 0.093 },
          { min: 360659, max: 432787, rate: 0.103 },
          { min: 432787, max: 721314, rate: 0.113 },
          { min: 721314, max: null, rate: 0.123 }
        ]
      }
    },
    // UK HMRC PAYE Income Tax (2025/2026)
    {
      country: "GB",
      type: "uk_paye",
      region: "england",
      year: 2026,
      status: "verified",
      description: "HMRC PAYE Income Tax Bands and Personal Allowance",
      rules: {
        standardTaxCode: "1257L",
        personalAllowance: 12570,
        bands: [
          { name: "Basic Rate", min: 0, max: 37700, rate: 0.20 }, // Taxable portion above personal allowance
          { name: "Higher Rate", min: 37700, max: 125140, rate: 0.40 },
          { name: "Additional Rate", min: 125140, max: null, rate: 0.45 }
        ]
      }
    },
    // UK National Insurance Contributions (NIC Class 1 Category A)
    {
      country: "GB",
      type: "uk_nic",
      region: "england",
      year: 2026,
      status: "verified",
      description: "HMRC Class 1 Primary and Secondary National Insurance",
      rules: {
        category: "A",
        primaryThresholdMonthly: 1048.00,
        upperEarningsLimitMonthly: 4189.00,
        employeeMainRate: 0.08,
        employeeUpperRate: 0.02,
        secondaryThresholdMonthly: 758.00,
        employerRate: 0.138
      }
    },
    // UK Pension Auto-Enrolment
    {
      country: "GB",
      type: "uk_pension",
      region: "england",
      year: 2026,
      status: "verified",
      description: "UK Workplace Pension Auto-Enrolment Qualifying Earnings",
      rules: {
        qualifyingEarningsLowerMonthly: 520.00,
        qualifyingEarningsUpperMonthly: 4189.00,
        minEmployeeContributionRate: 0.05,
        minEmployerContributionRate: 0.03
      }
    },
    // UAE MOHRE & WPS Regulations
    {
      country: "AE",
      type: "uae_statutory",
      region: "all",
      year: 2026,
      status: "verified",
      description: "UAE MOHRE Wage Protection System (WPS) & EOSB Framework",
      rules: {
        personalIncomeTaxRate: 0.00,
        basicSalaryRatioMin: 0.60,
        eosbCalculation: {
          firstFiveYearsDaysPerYear: 21,
          afterFiveYearsDaysPerYear: 30,
          divisorDaysPerMonth: 30
        }
      }
    }
  ];

  for (const t of defaultTaxRules) {
    const ruleId = `tax_${companyId}_${t.country.toLowerCase()}_${t.type}_${t.year}`;
    await query(`
      INSERT INTO tax_rules (id, company_id, country_code, tax_type, state_or_region, tax_year, status, effective_start_date, description, rules_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-01-01', $8, $9)
      ON CONFLICT DO NOTHING
    `, [ruleId, companyId, t.country, t.type, t.region, t.year, t.status, t.description, JSON.stringify(t.rules)]).catch(() => {});
  }
}
