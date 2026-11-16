import { query } from "../config/db.js";

/**
 * Log administrative payroll activities with company isolation
 */
export async function logPayrollAudit({
  companyId,
  userId,
  userName = "Admin",
  userRole = "admin",
  action,
  entityType,
  entityId = null,
  previousValues = null,
  updatedValues = null,
  ipAddress = null
}) {
  try {
    const id = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    // Mask sensitive fields like full bank account numbers, passwords, or tokens
    const sanitize = (data) => {
      if (!data || typeof data !== "object") return data;
      const clone = Array.isArray(data) ? [...data] : { ...data };
      const sensitiveKeys = ["bankAccount", "bankAccountNumber", "iban", "ssn", "password", "token"];
      for (const key in clone) {
        if (sensitiveKeys.includes(key) && typeof clone[key] === "string" && clone[key].length > 4) {
          clone[key] = `****${clone[key].slice(-4)}`;
        }
      }
      return clone;
    };

    await query(`
      INSERT INTO payroll_audit_logs (
        id, company_id, user_id, user_name, user_role, action, 
        entity_type, entity_id, previous_values, updated_values, ip_address, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
    `, [
      id,
      companyId,
      userId,
      userName,
      userRole,
      action,
      entityType,
      entityId,
      previousValues ? JSON.stringify(sanitize(previousValues)) : null,
      updatedValues ? JSON.stringify(sanitize(updatedValues)) : null,
      ipAddress
    ]);
  } catch (err) {
    console.error("⚠️ Failed to write payroll audit log:", err);
  }
}

