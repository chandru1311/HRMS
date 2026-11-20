import { query } from "../config/db.js";
import { sendPayslipNotification } from "../services/emailService.js";

export const getPayroll = async (req, res) => {
  try {
    const { companyId, month, year, userId, employeeId } = req.query;
    const isSuperAdmin = req.user?.role?.toLowerCase() === "superadmin";
    const targetCompanyId = (isSuperAdmin && companyId) ? companyId : req.user?.companyId;
    const targetEmpId = userId || employeeId;

    let sql = `
      SELECT p.*,
             u.name as employee_name, u.name as "employeeName",
             u.email as employee_email, u.email as "employeeEmail",
             u.department, u.designation, u.employee_id as "employeeCode",
             u.phone as "employeePhone", u.avatar_url as "avatarUrl",
             u.metadata as "userMetadata"
      FROM payroll p
      LEFT JOIN users u ON p.employee_id = u.id
      WHERE 1=1
    `;
    const params = [];


    if (targetCompanyId) {
      params.push(targetCompanyId);
      sql += ` AND p.company_id = $${params.length}`;
    }
    if (month) {
      params.push(month);
      sql += ` AND p.month = $${params.length}`;
    }
    if (year) {
      params.push(Number(year));
      sql += ` AND p.year = $${params.length}`;
    }
    if (req.user?.role === "employee") {
      params.push(req.user.id);
      sql += ` AND p.employee_id = $${params.length}`;
    } else if (targetEmpId) {
      params.push(targetEmpId);
      sql += ` AND p.employee_id = $${params.length}`;
    }

    sql += " ORDER BY COALESCE(u.name, p.employee_id) ASC";
    const result = await query(sql, params);

    const mappedRows = result.rows.map(row => {
      const meta = (typeof row.metadata === "object" && row.metadata !== null) ? row.metadata : {};
      const gross = Number(row.gross_salary || 0);
      const basic = Number(row.basic_salary || 0);
      const hra = Number(row.hra || 0);
      const allowances = Number(row.allowances !== null && row.allowances !== undefined ? row.allowances : (meta.otherAllowance !== undefined ? meta.otherAllowance : (meta.special || 0)));
      const otherAllowance = allowances;
      const basicPercentageSnapshot = meta.basicPercentageSnapshot !== undefined ? Number(meta.basicPercentageSnapshot) : 50;
      const otherAllowancePercentageSnapshot = meta.otherAllowancePercentageSnapshot !== undefined ? Number(meta.otherAllowancePercentageSnapshot) : 30;
      const pfPercentageSnapshot = meta.pfPercentageSnapshot !== undefined ? Number(meta.pfPercentageSnapshot) : 12;
      const esiPercentageSnapshot = meta.esiPercentageSnapshot !== undefined ? Number(meta.esiPercentageSnapshot) : 0.75;
      const pf = Number(row.pf_deduction || 0);
      const esi = Number(row.esi_deduction || 0);
      const pt = Number(row.tax_deduction || 0);
      const totalDeductions = Number(row.total_deductions || 0);
      const net = Number(row.net_salary || 0);
      const paidDays = Number(row.paid_days !== null && row.paid_days !== undefined ? row.paid_days : 30);
      const presentDays = Number(row.present_days !== null && row.present_days !== undefined ? row.present_days : 30);
      const workingDays = Number(meta.workingDays !== undefined ? meta.workingDays : 30);
      const lopAmount = Number(meta.lopAmount || 0);
      const lopsDays = Number(meta.lopsDays || 0);
      const tds = Number(meta.tds || 0);
      const insurance = Number(meta.insurance || 0);
      const special = otherAllowance;
      const effectiveDate = meta.effectiveDate || "";
      const userMeta = (typeof row.userMetadata === "object" && row.userMetadata !== null) ? row.userMetadata : {};
      const bankAccountNumber = userMeta.bankAccountNumber || userMeta.bankAccount || "";
      const panNumber = userMeta.panNumber || userMeta.pan || "";
      const pfNumber = userMeta.pfNumber || userMeta.pfUan || "";
      const esiNumber = userMeta.esiNumber || "";
      const joiningDate = userMeta.joiningDate || userMeta.doj || "";

      return {
        ...meta,
        ...row,
        id: row.id,
        _id: row.id,
        companyId: row.company_id,
        company_id: row.company_id,
        employeeId: row.employee_id,
        employee_id: row.employee_id,
        userId: row.employee_id,
        month: row.month,
        year: Number(row.year),
        grossSalary: gross,
        gross: gross,
        basicSalary: basic,
        basicPay: basic,
        basic: basic,
        hra: hra,
        allowances: otherAllowance,
        otherAllowance: otherAllowance,
        special: special,
        basicPercentageSnapshot,
        otherAllowancePercentageSnapshot,
        pfPercentageSnapshot,
        esiPercentageSnapshot,
        effectiveDate,
        pf: pf,
        esi: esi,
        pt: pt,
        tds: tds,
        insurance: insurance,
        lopAmount: lopAmount,
        lopsDays: lopsDays,
        workingDays: workingDays,
        totalDeductions: totalDeductions,
        netSalary: net,
        net: net,
        paidDays: paidDays,
        presentDays: presentDays,
        status: row.status || "generated",
        bankAccountNumber,
        panNumber,
        pfNumber,
        esiNumber,
        joiningDate
      };
    });

    res.json(mappedRows);
  } catch (err) {
    console.error("getPayroll error:", err);
    res.status(500).json({ error: "Failed to fetch payroll records." });
  }
};

export const savePayroll = async (req, res) => {
  try {
    const {
      userId,
      employeeId,
      month,
      year,
      grossSalary,
      gross,
      basicSalary,
      basic,
      basicPay,
      basicPercentage,
      basicPayPercentage,
      otherAllowancePercentage,
      otherAllowance,
      hra = 0,
      allowances,
      special,
      pf,
      esi,
      pt,
      tds = 0,
      insurance,
      lopAmount = 0,
      lopsDays = 0,
      totalDeductions,
      netSalary,
      net,
      paidDays = 30,
      presentDays = 30,
      workingDays = 30,
      status = "generated",
      effectiveDate,
      companyId
    } = req.body;

    const targetEmpId = userId || employeeId;
    const targetCompanyId = companyId || req.user?.companyId;

    if (!targetEmpId || !month || !year) {
      return res.status(400).json({ error: "Employee ID, month, and year are required." });
    }

    // Fetch company settings to resolve default percentages and statutory deductions if not provided
    let companySettings = {};
    if (targetCompanyId) {
      const compRes = await query("SELECT settings FROM companies WHERE id = $1", [targetCompanyId]).catch(() => ({ rows: [] }));
      companySettings = compRes.rows[0]?.settings?.payrollSettings || {};
    }

    const numBasicPercentage = Number(
      basicPercentage !== undefined ? basicPercentage :
      (basicPayPercentage !== undefined ? basicPayPercentage :
      (companySettings.basicPercentage !== undefined ? companySettings.basicPercentage : 50))
    );
    const numOtherAllowancePercentage = Number(
      otherAllowancePercentage !== undefined ? otherAllowancePercentage :
      (companySettings.otherAllowancePercentage !== undefined ? companySettings.otherAllowancePercentage : 30)
    );

    const numGross = Number(grossSalary !== undefined ? grossSalary : (gross !== undefined ? gross : 0));
    const numBasic = Number(
      basicSalary !== undefined ? basicSalary :
      (basicPay !== undefined ? basicPay :
      (basic !== undefined ? basic : Math.round((numGross * (numBasicPercentage / 100)) * 100) / 100))
    );
    const numOtherAllowance = Number(
      otherAllowance !== undefined ? otherAllowance :
      (allowances !== undefined ? allowances :
      (special !== undefined ? special : Math.round((numGross * (numOtherAllowancePercentage / 100)) * 100) / 100))
    );
    const numHra = Number(hra || 0);

    const isPfEnabled = companySettings.pf !== false;
    const isEsiEnabled = companySettings.esi !== false;

    const numPf = pf !== undefined ? Number(pf) : (isPfEnabled ? Math.round((numBasic * 0.12) * 100) / 100 : 0);
    const numEsi = esi !== undefined ? Number(esi) : ((isEsiEnabled && numGross <= 21000) ? Math.round((numGross * 0.0075) * 100) / 100 : 0);
    const numPt = 0;
    const numTds = 0;
    const numInsurance = 0;
    const numLopAmount = Number(lopAmount || 0);
    const numLopsDays = Number(lopsDays || 0);
    const numPaidDays = Number(paidDays !== undefined ? paidDays : 30);
    const numPresentDays = Number(presentDays !== undefined ? presentDays : 30);
    const numWorkingDays = Number(workingDays !== undefined ? workingDays : (companySettings.workingDays || 30));

    const calculatedDeductions = Math.round((numOtherAllowance + numPf + numEsi + numLopAmount) * 100) / 100;
    const numTotalDeductions = Number(totalDeductions !== undefined ? totalDeductions : calculatedDeductions);
    const calculatedNet = Math.round((numGross - numOtherAllowance - numPf - numEsi) * 100) / 100;
    if (calculatedNet < 0) {
      return res.status(400).json({ error: "Net Salary cannot be negative. Deductions exceed gross earnings." });
    }
    const numNet = Number(netSalary !== undefined ? netSalary : (net !== undefined ? net : Math.max(0, calculatedNet)));

    const id = `payroll_${targetEmpId}_${month}_${year}`;

    const metadata = {
      workingDays: numWorkingDays,
      lopAmount: numLopAmount,
      lopsDays: numLopsDays,
      tds: numTds,
      insurance: numInsurance,
      otherAllowance: numOtherAllowance,
      special: numOtherAllowance,
      basicPercentageSnapshot: numBasicPercentage,
      otherAllowancePercentageSnapshot: numOtherAllowancePercentage,
      pfPercentageSnapshot: 12,
      esiPercentageSnapshot: 0.75,
      effectiveDate: effectiveDate || new Date().toISOString().split("T")[0],
      calculatedAt: new Date().toISOString()
    };

    const result = await query(
      `INSERT INTO payroll (id, company_id, employee_id, month, year, basic_salary, hra, allowances, gross_salary, pf_deduction, esi_deduction, tax_deduction, total_deductions, net_salary, paid_days, present_days, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (id) DO UPDATE SET
         company_id = EXCLUDED.company_id,
         basic_salary = EXCLUDED.basic_salary,
         hra = EXCLUDED.hra,
         allowances = EXCLUDED.allowances,
         gross_salary = EXCLUDED.gross_salary,
         pf_deduction = EXCLUDED.pf_deduction,
         esi_deduction = EXCLUDED.esi_deduction,
         tax_deduction = EXCLUDED.tax_deduction,
         total_deductions = EXCLUDED.total_deductions,
         net_salary = EXCLUDED.net_salary,
         paid_days = EXCLUDED.paid_days,
         present_days = EXCLUDED.present_days,
         status = EXCLUDED.status,
         metadata = EXCLUDED.metadata,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        id, targetCompanyId, targetEmpId, month, Number(year), numBasic, numHra,
        numOtherAllowance, numGross, numPf, numEsi, numPt,
        numTotalDeductions, numNet, numPaidDays, numPresentDays, status,
        JSON.stringify(metadata)
      ]
    );

    const row = result.rows[0];

    // Synchronize employee's permanent gross_salary in users table so subsequent months and directory stay updated
    if (numGross > 0) {
      await query(
        "UPDATE users SET gross_salary = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [numGross, targetEmpId]
      ).catch(e => console.warn("Failed to update users.gross_salary in savePayroll:", e.message));
    }

    res.status(201).json({
      ...metadata,
      ...row,
      id: row.id,
      _id: row.id,
      companyId: row.company_id,
      employeeId: row.employee_id,
      userId: row.employee_id,
      grossSalary: Number(row.gross_salary),
      gross: Number(row.gross_salary),
      basicSalary: Number(row.basic_salary),
      basicPay: Number(row.basic_salary),
      basic: Number(row.basic_salary),
      otherAllowance: numOtherAllowance,
      allowances: numOtherAllowance,
      special: numOtherAllowance,
      basicPercentageSnapshot: numBasicPercentage,
      otherAllowancePercentageSnapshot: numOtherAllowancePercentage,
      pfPercentageSnapshot: 12,
      esiPercentageSnapshot: 0.75,
      netSalary: Number(row.net_salary),
      net: Number(row.net_salary),
      pf: Number(row.pf_deduction),
      esi: Number(row.esi_deduction),
      pt: Number(row.tax_deduction),
      totalDeductions: Number(row.total_deductions),
      paidDays: Number(row.paid_days),
      workingDays: numWorkingDays
    });
  } catch (err) {
    console.error("savePayroll error:", err);
    res.status(500).json({ error: "Failed to save payroll record." });
  }
};

export const deletePayroll = async (req, res) => {
  try {
    const { id } = req.params;
    const { companyId, employeeId, userId, month, year } = req.query;

    let result;
    if (id && id !== "undefined" && id !== "null") {
      result = await query("DELETE FROM payroll WHERE id = $1 RETURNING id", [id]);
    } else {
      const targetEmp = userId || employeeId;
      const targetComp = companyId || req.user?.companyId;
      let sql = "DELETE FROM payroll WHERE 1=1";
      const params = [];
      if (targetComp) {
        params.push(targetComp);
        sql += ` AND company_id = $${params.length}`;
      }
      if (targetEmp) {
        params.push(targetEmp);
        sql += ` AND employee_id = $${params.length}`;
      }
      if (month) {
        params.push(month);
        sql += ` AND month = $${params.length}`;
      }
      if (year) {
        params.push(Number(year));
        sql += ` AND year = $${params.length}`;
      }
      sql += " RETURNING id";
      result = await query(sql, params);
    }

    if (!result || result.rows.length === 0) {
      return res.status(404).json({ error: "Payroll record not found." });
    }
    res.json({ message: "Payroll record deleted successfully.", id: result.rows[0].id });
  } catch (err) {
    console.error("deletePayroll error:", err);
    res.status(500).json({ error: "Failed to delete payroll record." });
  }
};

export const wipeAllPayrolls = async (req, res) => {
  try {
    const { companyId, month, year } = req.query;
    const isSuperAdmin = req.user?.role?.toLowerCase() === "superadmin";
    const targetComp = (isSuperAdmin && companyId) ? companyId : req.user?.companyId;

    if (!targetComp && !isSuperAdmin) {
      return res.status(400).json({ error: "Company ID is required to wipe payroll." });
    }

    let sql = "DELETE FROM payroll WHERE 1=1";
    const params = [];

    if (targetComp) {
      params.push(targetComp);
      sql += ` AND company_id = $${params.length}`;
    }
    if (month) {
      params.push(month);
      sql += ` AND month = $${params.length}`;
    }
    if (year) {
      params.push(Number(year));
      sql += ` AND year = $${params.length}`;
    }
    sql += " RETURNING id";

    const result = await query(sql, params);
    res.json({ message: `Wiped ${result.rows.length} payroll records.`, count: result.rows.length });
  } catch (err) {
    console.error("wipeAllPayrolls error:", err);
    res.status(500).json({ error: "Failed to wipe payroll records." });
  }
};

export const calculatePayrollBatch = async (req, res) => {
  try {
    const { companyId, month, year, workingDays } = req.body;
    const isSuperAdmin = req.user?.role?.toLowerCase() === "superadmin";
    const targetCompanyId = (isSuperAdmin && companyId) ? companyId : req.user?.companyId;

    if (!month || !year) {
      return res.status(400).json({ error: "Month and Year are required for payroll calculation." });
    }

    // Fetch company payroll settings
    let companySettings = {};
    if (targetCompanyId) {
      const compRes = await query("SELECT settings FROM companies WHERE id = $1", [targetCompanyId]).catch(() => ({ rows: [] }));
      companySettings = compRes.rows[0]?.settings?.payrollSettings || {};
    }

    const basicPct = Number(companySettings.basicPercentage !== undefined ? companySettings.basicPercentage : 50);
    const otherPct = Number(companySettings.otherAllowancePercentage !== undefined ? companySettings.otherAllowancePercentage : 30);
    const pfEnabled = companySettings.pf !== false;
    const esiEnabled = companySettings.esi !== false;
    const ptEnabled = companySettings.pt !== false;
    const insEnabled = Boolean(companySettings.insurance);
    const insAmount = Number(companySettings.insuranceAmount || 0);
    const wDays = Number(workingDays || companySettings.workingDays || 30);

    // 1. Fetch all active employees in this company
    let userSql = "SELECT id, name, email, gross_salary, metadata FROM users WHERE role != 'superadmin' AND (metadata->>'status' IS NULL OR metadata->>'status' != 'inactive')";
    const userParams = [];
    if (targetCompanyId) {
      userParams.push(targetCompanyId);
      userSql += ` AND company_id = $${userParams.length}`;
    }
    const employees = await query(userSql, userParams);

    if (employees.rows.length === 0) {
      return res.status(400).json({ error: "No active employees found for this company." });
    }

    const calculatedRecords = [];

    for (const emp of employees.rows) {
      const gross = Number(emp.gross_salary || 30000);

      const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      let mIdx = monthNames.indexOf(String(month).toLowerCase());
      let monthNumberStr = mIdx !== -1 ? String(mIdx + 1).padStart(2, '0') : String(month).padStart(2, '0');
      const datePrefix = `${year}-${monthNumberStr}`;

      const attRes = await query(
        `SELECT COUNT(*) as count, status FROM attendance 
         WHERE user_id = $1 
           AND (
             TO_CHAR(date AT TIME ZONE 'UTC', 'YYYY-MM') = $2 
             OR id LIKE $3
           )
         GROUP BY status`,
        [emp.id, datePrefix, `${emp.id}_${datePrefix}%`]
      ).catch(() => ({ rows: [] }));

      const leaveRes = await query(
        `SELECT COALESCE(SUM(total_days::numeric), 0) as approved_leave_days 
         FROM leave_requests 
         WHERE user_id = $1 
           AND status = 'approved'
           AND (
             TO_CHAR(start_date AT TIME ZONE 'UTC', 'YYYY-MM') = $2 
             OR TO_CHAR(end_date AT TIME ZONE 'UTC', 'YYYY-MM') = $2
           )`,
        [emp.id, datePrefix]
      ).catch(() => ({ rows: [{ approved_leave_days: 0 }] }));

      let presentCount = 0;
      let halfDayCount = 0;
      let onLeaveCount = Number(leaveRes.rows[0]?.approved_leave_days || 0);
      let absentCount = 0;

      attRes.rows.forEach(r => {
        const count = Number(r.count || 0);
        const st = String(r.status || "").toLowerCase();
        if (st === "present" || st === "completed" || st === "checked-in" || st === "checked-out" || st === "in-progress" || st === "on-break") {
          presentCount += count;
        } else if (st === "half-day") {
          halfDayCount += count;
        } else if (st === "on-leave") {
          onLeaveCount += count;
        } else if (st === "absent") {
          absentCount += count;
        }
      });

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonthIdx = now.getMonth();
      const currentDay = now.getDate();

      const isCurrentMonth = Number(year) === currentYear && mIdx === currentMonthIdx;
      const isPastMonth = Number(year) < currentYear || (Number(year) === currentYear && (mIdx !== -1 && mIdx < currentMonthIdx));
      const totalDaysInMonth = mIdx !== -1 ? new Date(Number(year), mIdx + 1, 0).getDate() : 30;

      let elapsedDays = 0;
      if (isPastMonth) {
        elapsedDays = Math.min(wDays, totalDaysInMonth);
      } else if (isCurrentMonth) {
        elapsedDays = Math.min(currentDay, Math.min(wDays, totalDaysInMonth));
      }

      const accounted = presentCount + (halfDayCount * 0.5) + onLeaveCount;
      const unrecordedAbsent = Math.max(0, Math.round((elapsedDays - accounted) * 10) / 10);
      const finalAbsentCount = Math.max(absentCount, unrecordedAbsent);

      // Loss of Pay (LOP) Days = absent days + 0.5 of half-days
      const lopsDays = Math.round((finalAbsentCount + (halfDayCount * 0.5)) * 10) / 10;
      const paidDays = Math.max(0, Math.round((wDays - lopsDays) * 10) / 10);

      const actualGross = Math.round(((gross / wDays) * paidDays) * 100) / 100;
      const lopAmount = Math.round((gross - actualGross) * 100) / 100;

      // Master Prompt Formulas:
      // Basic Pay = Gross Salary * Basic Pay Percentage / 100
      // Other Allowance = Gross Salary * Other Allowance Percentage / 100
      const basic = Math.round((gross * (basicPct / 100)) * 100) / 100;
      const otherAllowance = Math.round((gross * (otherPct / 100)) * 100) / 100;
      const actualBasic = Math.round((actualGross * (basicPct / 100)) * 100) / 100;

      // Employee PF = Basic Pay * 12 / 100 when enabled
      const pf = pfEnabled ? Math.round((actualBasic * 0.12) * 100) / 100 : 0;

      // Employee ESI = Gross Salary * 0.75 / 100 when enabled and Gross <= 21,000 wage ceiling
      const esi = (esiEnabled && actualGross <= 21000) ? Math.round((actualGross * 0.0075) * 100) / 100 : 0;

      const pt = 0;
      const insurance = 0;
      const tds = 0;
      const totalDeductions = Math.round((actualOtherAllowance + pf + esi + lopAmount) * 100) / 100;
      const netSalary = Math.round(Math.max(0, actualGross - actualOtherAllowance - pf - esi) * 100) / 100;

      const metadata = {
        workingDays: wDays,
        lopAmount,
        lopsDays,
        tds,
        insurance,
        otherAllowance,
        special: otherAllowance,
        basicPercentageSnapshot: basicPct,
        otherAllowancePercentageSnapshot: otherPct,
        pfPercentageSnapshot: 12,
        esiPercentageSnapshot: 0.75,
        calculatedAt: new Date().toISOString()
      };

      const recordId = `payroll_${emp.id}_${month}_${year}`;
      await query(
        `INSERT INTO payroll (id, company_id, employee_id, month, year, basic_salary, hra, allowances, gross_salary, pf_deduction, esi_deduction, tax_deduction, total_deductions, net_salary, paid_days, present_days, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'draft', $17)
         ON CONFLICT (id) DO UPDATE SET
           company_id = EXCLUDED.company_id,
           basic_salary = EXCLUDED.basic_salary,
           hra = EXCLUDED.hra,
           allowances = EXCLUDED.allowances,
           gross_salary = EXCLUDED.gross_salary,
           pf_deduction = EXCLUDED.pf_deduction,
           esi_deduction = EXCLUDED.esi_deduction,
           tax_deduction = EXCLUDED.tax_deduction,
           total_deductions = EXCLUDED.total_deductions,
           net_salary = EXCLUDED.net_salary,
           paid_days = EXCLUDED.paid_days,
           present_days = EXCLUDED.present_days,
           status = 'draft',
           metadata = EXCLUDED.metadata,
           updated_at = CURRENT_TIMESTAMP`,
        [
          recordId, targetCompanyId, emp.id, month, Number(year),
          basic, 0, otherAllowance, gross, pf, esi, pt, totalDeductions, netSalary,
          paidDays, presentCount || paidDays, JSON.stringify(metadata)
        ]
      );

      calculatedRecords.push({
        id: recordId,
        employeeId: emp.id,
        employeeName: emp.name,
        month,
        year: Number(year),
        grossSalary: gross,
        netSalary,
        basicSalary: basic,
        basicPay: basic,
        otherAllowance,
        basicPercentageSnapshot: basicPct,
        otherAllowancePercentageSnapshot: otherPct,
        pf,
        esi,
        totalDeductions,
        paidDays,
        status: "draft"
      });
    }

    res.json({
      message: `Calculated payroll for ${calculatedRecords.length} employees.`,
      count: calculatedRecords.length,
      payrolls: calculatedRecords
    });
  } catch (err) {
    console.error("calculatePayrollBatch error:", err);
    res.status(500).json({ error: "Failed to calculate payroll batch." });
  }
};

export const approvePayrollBatch = async (req, res) => {
  try {
    const { companyId, month, year } = req.body;
    const isSuperAdmin = req.user?.role?.toLowerCase() === "superadmin";
    const targetCompanyId = (isSuperAdmin && companyId) ? companyId : req.user?.companyId;

    if (!month || !year) {
      return res.status(400).json({ error: "Month and Year are required to approve payroll." });
    }

    // 1. Fetch matching draft payroll records with employee details
    let sql = `
      SELECT p.*, u.name as employee_name, u.email as employee_email
      FROM payroll p
      LEFT JOIN users u ON p.employee_id = u.id
      WHERE p.month = $1 AND p.year = $2
    `;
    const params = [month, Number(year)];
    if (targetCompanyId) {
      params.push(targetCompanyId);
      sql += ` AND p.company_id = $${params.length}`;
    }

    const records = await query(sql, params);
    if (records.rows.length === 0) {
      return res.status(404).json({ error: "No payroll records found for the specified period." });
    }

    // 2. Update status to 'paid'
    let updateSql = "UPDATE payroll SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE month = $1 AND year = $2";
    const updateParams = [month, Number(year)];
    if (targetCompanyId) {
      updateParams.push(targetCompanyId);
      updateSql += ` AND company_id = $${updateParams.length}`;
    }
    await query(updateSql, updateParams);

    const io = req.app?.get("io");

    // 3. For each employee, create in-app notification & dispatch email
    for (const r of records.rows) {
      const notifId = "notif_" + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
      const title = `Payslip Available: ${r.month} ${r.year}`;
      const message = `Your salary payslip for ${r.month} ${r.year} is approved. Net Pay: ₹${Number(r.net_salary).toLocaleString("en-IN")}.`;
      
      await query(
        `INSERT INTO notifications (id, user_id, title, message, type, read, link)
         VALUES ($1, $2, $3, $4, 'payroll', false, '/dashboard?tab=payroll')
         ON CONFLICT (id) DO NOTHING`,
        [notifId, r.employee_id, title, message]
      ).catch(() => {});

      if (io) {
        io.emit(`notification_${r.employee_id}`, {
          id: notifId,
          userId: r.employee_id,
          title,
          message,
          type: "payroll",
          read: false,
          link: "/dashboard?tab=payroll",
          createdAt: new Date().toISOString()
        });
      }

      if (r.employee_email) {
        sendPayslipNotification({
          email: r.employee_email,
          name: r.employee_name || "Employee",
          month: r.month,
          year: r.year,
          netSalary: r.net_salary,
          grossSalary: r.gross_salary,
          totalDeductions: r.total_deductions,
          paidDays: r.paid_days || 30
        }).catch(emailErr => console.warn("Payslip email dispatch non-blocking error:", emailErr.message));
      }
    }

    res.json({
      message: `Approved and processed ${records.rows.length} payslips.`,
      count: records.rows.length
    });
  } catch (err) {
    console.error("approvePayrollBatch error:", err);
    res.status(500).json({ error: "Failed to approve payroll batch." });
  }
};

/**
 * Automatically calculate an employee's attendance days, LOP (Loss of Pay) days,
 * and paid days for a specific payroll month and year directly from daily attendance logs & leave requests.
 */
export const getEmployeeAttendancePayrollSummary = async (req, res) => {
  try {
    const { userId, employeeId, month, year, companyId, workingDays = 30 } = req.query;
    const targetUserId = userId || employeeId;
    if (!targetUserId || !month || !year) {
      return res.status(400).json({ error: "userId, month, and year are required." });
    }

    const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    let mIdx = monthNames.indexOf(String(month).toLowerCase());
    let monthNumberStr = mIdx !== -1 ? String(mIdx + 1).padStart(2, '0') : String(month).padStart(2, '0');
    const datePrefix = `${year}-${monthNumberStr}`;
    const wDays = Number(workingDays) || 30;

    // 0. Check if a saved payroll record already exists for this employee for this month/year
    const savedPayrollRes = await query(
      `SELECT * FROM payroll WHERE employee_id = $1 AND month = $2 AND year = $3 LIMIT 1`,
      [targetUserId, month, Number(year)]
    ).catch(() => ({ rows: [] }));

    const savedPayroll = savedPayrollRes.rows[0];

    // 1. Fetch attendance records for this month (supporting both local date & UTC date)
    const attRes = await query(
      `SELECT id, date, status, check_in, check_out, duration_minutes 
       FROM attendance 
       WHERE user_id = $1 
         AND (
           TO_CHAR(date, 'YYYY-MM') = $2 
           OR TO_CHAR(date AT TIME ZONE 'UTC', 'YYYY-MM') = $2 
           OR id LIKE $3
         )
       ORDER BY date ASC`,
      [targetUserId, datePrefix, `${targetUserId}_${datePrefix}%`]
    ).catch(() => ({ rows: [] }));

    // 2. Fetch approved leaves for this month
    const leaveRes = await query(
      `SELECT COALESCE(SUM(total_days::numeric), 0) as approved_leave_days 
       FROM leave_requests 
       WHERE user_id = $1 
         AND status = 'approved'
         AND (
           TO_CHAR(start_date, 'YYYY-MM') = $2 
           OR TO_CHAR(end_date, 'YYYY-MM') = $2
           OR TO_CHAR(start_date AT TIME ZONE 'UTC', 'YYYY-MM') = $2 
           OR TO_CHAR(end_date AT TIME ZONE 'UTC', 'YYYY-MM') = $2
         )`,
      [targetUserId, datePrefix]
    ).catch(() => ({ rows: [{ approved_leave_days: 0 }] }));

    const approvedLeaveDays = Number(leaveRes.rows[0]?.approved_leave_days || 0);

    // Deduplicate attendance by distinct date (YYYY-MM-DD)
    const dateMap = new Map();
    attRes.rows.forEach(r => {
      let dateKey = null;
      if (typeof r.id === "string") {
        const idMatch = r.id.match(/\d{4}-\d{2}-\d{2}/);
        if (idMatch) dateKey = idMatch[0];
      }
      if (!dateKey && r.date) {
        const d = new Date(r.date);
        dateKey = !isNaN(d.getTime()) ? new Date(d.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split("T")[0] : String(r.date).split("T")[0];
      }
      if (!dateKey) dateKey = r.id;
      const st = String(r.status || "").toLowerCase();
      // If day was present, prioritize present over other status
      if (!dateMap.has(dateKey) || st === "present" || st === "completed" || st === "checked-in" || st === "checked-out" || st === "in-progress" || st === "on-break") {
        dateMap.set(dateKey, st);
      }
    });

    let presentDays = 0;
    let halfDays = 0;
    let explicitAbsentDays = 0;
    let onLeaveDays = 0;

    dateMap.forEach(st => {
      if (st === "present" || st === "completed" || st === "checked-in" || st === "checked-out" || st === "in-progress" || st === "on-break") {
        presentDays += 1;
      } else if (st === "half-day") {
        halfDays += 1;
      } else if (st === "on-leave") {
        onLeaveDays += 1;
      } else if (st === "absent") {
        explicitAbsentDays += 1;
      }
    });

    const totalApprovedLeave = onLeaveDays + approvedLeaveDays;

    // Calculate elapsed days for accurate absent & LOP calculation
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIdx = now.getMonth();
    const currentDay = now.getDate();

    const isCurrentMonth = Number(year) === currentYear && mIdx === currentMonthIdx;
    const isPastMonth = Number(year) < currentYear || (Number(year) === currentYear && (mIdx !== -1 && mIdx < currentMonthIdx));
    const totalDaysInMonth = mIdx !== -1 ? new Date(Number(year), mIdx + 1, 0).getDate() : 30;

    let elapsedDays = 0;
    if (isPastMonth) {
      elapsedDays = Math.min(wDays, totalDaysInMonth);
    } else if (isCurrentMonth) {
      // Elapsed days up to today (e.g. on 20.11.2026, 20 days elapsed)
      elapsedDays = Math.min(currentDay, Math.min(wDays, totalDaysInMonth));
    }

    const accountedDays = presentDays + (halfDays * 0.5) + totalApprovedLeave;
    const unrecordedAbsentDays = Math.max(0, Math.round((elapsedDays - accountedDays) * 10) / 10);
    const calculatedAbsentDays = Math.max(explicitAbsentDays, unrecordedAbsentDays);

    const calculatedLopDays = Math.round((calculatedAbsentDays + (halfDays * 0.5)) * 10) / 10;
    const calculatedPaidDays = Math.max(0, Math.round((wDays - calculatedLopDays) * 10) / 10);

    res.json({
      userId: targetUserId,
      month,
      year: Number(year),
      workingDays: wDays,
      presentDays,
      halfDays,
      onLeaveDays: totalApprovedLeave,
      absentDays: calculatedAbsentDays,
      lopDays: calculatedLopDays,
      paidDays: calculatedPaidDays,
      isSaved: Boolean(savedPayroll),
      totalLogs: attRes.rows.length,
      logs: attRes.rows
    });
  } catch (err) {
    console.error("getEmployeeAttendancePayrollSummary error:", err);
    res.status(500).json({ error: "Failed to calculate employee attendance summary." });
  }
};



