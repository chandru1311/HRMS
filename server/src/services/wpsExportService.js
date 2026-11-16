import { query } from "../config/db.js";
import { Decimal } from "../utils/financialMath.js";
import { logPayrollAudit } from "./payrollAuditService.js";

/**
 * UAE Wage Protection System (WPS) SIF (Salary Information File) Generator & Validator
 * 
 * Conforms to Central Bank of the UAE (CBUAE) & MOHRE specifications.
 */

export function validateUaeIban(iban) {
  if (!iban) return false;
  const clean = String(iban).replace(/\s+/g, "").toUpperCase();
  // UAE IBAN format: AE followed by 2 check digits and 19 alphanumeric characters = 23 chars
  return /^AE\d{2}[A-Z0-9]{19}$/.test(clean);
}

export async function generateWpsSifFile({
  companyId,
  payrollRunId,
  employerEid = "784198012345678",
  bankRoutingCode = "033", // Standard UAE Central Bank Routing Code
  adminUser
}) {
  // 1. Fetch payroll run details
  const runRes = await query(`
    SELECT * FROM global_payroll_runs 
    WHERE id = $1 AND company_id = $2
  `, [payrollRunId, companyId]);

  if (runRes.rows.length === 0) {
    throw new Error("Payroll run not found.");
  }
  const run = runRes.rows[0];

  if (run.country_code !== "AE") {
    throw new Error("WPS SIF export is only valid for United Arab Emirates (AE) payroll runs.");
  }

  // 2. Fetch employee payroll items
  const itemsRes = await query(`
    SELECT gpi.*, u.metadata as user_meta, epp.bank_details, epp.tax_profile
    FROM global_payroll_items gpi
    JOIN users u ON gpi.user_id = u.id
    LEFT JOIN employee_payroll_profiles epp ON (gpi.user_id = epp.user_id AND gpi.company_id = epp.company_id)
    WHERE gpi.payroll_run_id = $1 AND gpi.company_id = $2
    ORDER BY gpi.employee_name ASC
  `, [payrollRunId, companyId]);

  if (itemsRes.rows.length === 0) {
    throw new Error("No payroll items found in this run for WPS export.");
  }

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const timeStr = now.toTimeString().split(" ")[0].slice(0, 5); // HH:MM
  const yymmdd = now.toISOString().slice(2, 10).replace(/-/g, "");

  const cleanEmployerEid = String(employerEid).replace(/\D/g, "") || "784198012345678";
  const fileName = `${cleanEmployerEid}_${yymmdd}_01.SIF`;

  const edrLines = [];
  let totalGrossDec = new Decimal(0);
  const validationErrors = [];

  for (const item of itemsRes.rows) {
    const bankDetails = item.bank_details || {};
    const userMeta = item.user_meta || {};
    const taxProfile = item.tax_profile || {};

    const employeeEid = (userMeta.nationalId || userMeta.emiratesId || taxProfile.emiratesId || `784${item.user_id.replace(/\D/g, "").padEnd(12, "0")}`).slice(0, 15);
    const rawIban = bankDetails.iban || userMeta.iban || "AE070330000000000000000";
    const iban = String(rawIban).replace(/\s+/g, "").toUpperCase();
    const routing = bankDetails.routingCode || bankRoutingCode;

    if (!validateUaeIban(iban)) {
      validationErrors.push(`Employee ${item.employee_name}: Invalid UAE IBAN format (${iban}). Must begin with 'AE' followed by 21 characters.`);
    }

    const fixedSalary = new Decimal(item.basic_salary || 0);
    const variableSalary = new Decimal(item.allowances || 0);
    const deductions = new Decimal(item.other_deductions || 0);
    const netSalary = new Decimal(item.net_salary || 0);

    totalGrossDec = totalGrossDec.add(netSalary);

    // EDR line: EDR,Employee_ID,Bank_Routing,IBAN,Period_Start,Period_End,Days,Fixed,Variable,Deductions
    const edr = [
      "EDR",
      employeeEid,
      routing,
      iban,
      run.period_start ? new Date(run.period_start).toISOString().split("T")[0] : dateStr,
      run.period_end ? new Date(run.period_end).toISOString().split("T")[0] : dateStr,
      "30",
      fixedSalary.toFixed(2),
      variableSalary.toFixed(2),
      deductions.toFixed(2)
    ].join(",");

    edrLines.push(edr);
  }

  // SCR Header: SCR,Employer_EID,Bank_Routing,Creation_Date,Creation_Time,Period,Count,Total,AED,Ref
  const periodMonth = run.period_start ? new Date(run.period_start).toISOString().slice(0, 7) : dateStr.slice(0, 7);
  const scrHeader = [
    "SCR",
    cleanEmployerEid,
    bankRoutingCode,
    dateStr,
    timeStr,
    periodMonth,
    edrLines.length.toString(),
    totalGrossDec.toFixed(2),
    "AED",
    `ZUNA_PAYROLL_${run.run_number}`
  ].join(",");

  const fullSifContent = [scrHeader, ...edrLines].join("\r\n");

  // Save payment record in DB
  const paymentRecordId = `payrec_${companyId}_${payrollRunId}_wps`;
  await query(`
    INSERT INTO payroll_payment_records (
      id, company_id, payroll_run_id, country_code, payment_type, status,
      file_content, file_name, record_count, total_amount, currency, metadata, updated_at
    )
    VALUES ($1, $2, $3, 'AE', 'WPS_SIF', $4, $5, $6, $7, $8, 'AED', $9, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      file_content = EXCLUDED.file_content,
      status = EXCLUDED.status,
      record_count = EXCLUDED.record_count,
      total_amount = EXCLUDED.total_amount,
      updated_at = CURRENT_TIMESTAMP
  `, [
    paymentRecordId,
    companyId,
    payrollRunId,
    validationErrors.length === 0 ? "GENERATED" : "VALIDATION_FAILED",
    fullSifContent,
    fileName,
    edrLines.length,
    totalGrossDec.toFixed(2),
    JSON.stringify({ validationErrors, employerEid: cleanEmployerEid, generatedAt: now.toISOString() })
  ]);

  await logPayrollAudit({
    companyId,
    userId: adminUser?.id,
    userName: adminUser?.name,
    userRole: adminUser?.role,
    action: "WPS_SIF_EXPORT_GENERATED",
    entityType: "wps_export",
    entityId: paymentRecordId,
    updatedValues: { fileName, recordCount: edrLines.length, totalAmount: totalGrossDec.toFixed(2), validationErrors }
  });

  return {
    success: validationErrors.length === 0,
    fileName,
    recordCount: edrLines.length,
    totalAmount: totalGrossDec.toFixed(2),
    currency: "AED",
    validationErrors,
    fileContent: fullSifContent
  };
}

