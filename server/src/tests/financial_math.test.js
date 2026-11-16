import test from "node:test";
import assert from "node:assert";
import { Decimal, D, formatCurrency } from "../utils/financialMath.js";

test("Financial Math - Precision & Zero Floating Point Errors", async (t) => {
  await t.test("0.1 + 0.2 strictly equals 0.30 without floating drift", () => {
    const a = new Decimal("0.1");
    const b = new Decimal("0.2");
    const res = a.add(b);
    assert.strictEqual(res.toFixed(2), "0.30");
    assert.strictEqual(res.toFixed(4), "0.3000");
  });

  await t.test("High-precision salary and deduction calculation", () => {
    const salary = new Decimal("85000.50");
    const socialSecurityRate = new Decimal("0.062");
    const ssDeduction = salary.mul(socialSecurityRate).round(2);
    // 85000.50 * 0.062 = 5270.031 -> 5270.03
    assert.strictEqual(ssDeduction.toFixed(2), "5270.03");
  });

  await t.test("Division with half-up rounding", () => {
    const total = new Decimal("1000.00");
    const threeWays = total.div(3).round(2);
    assert.strictEqual(threeWays.toFixed(2), "333.33");
  });

  await t.test("Comparison and bounds (min / max)", () => {
    const cap = new Decimal("176100.00");
    const wage1 = new Decimal("150000.00");
    const wage2 = new Decimal("200000.00");
    assert.strictEqual(Decimal.min(wage1, cap).toFixed(2), "150000.00");
    assert.strictEqual(Decimal.min(wage2, cap).toFixed(2), "176100.00");
  });

  await t.test("Currency formatting", () => {
    assert.strictEqual(formatCurrency("1250000.75", "INR"), "₹1,250,000.75");
    assert.strictEqual(formatCurrency("5400.5", "USD"), "$5,400.50");
    assert.strictEqual(formatCurrency("3500.00", "GBP"), "£3,500.00");
    assert.strictEqual(formatCurrency("15000.00", "AED"), "AED 15,000.00");
  });
});

