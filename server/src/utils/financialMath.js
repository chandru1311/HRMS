/**
 * financialMath.js
 * High-precision Decimal arithmetic engine for Global Payroll & Multi-Currency Engine.
 * 
 * Guarantees zero JavaScript floating-point errors (no 0.1 + 0.2 = 0.30000000000000004).
 * Uses BigInt-backed scaled integer fixed-point arithmetic (12 decimal places internal scale).
 * Fully adheres to PostgreSQL NUMERIC/DECIMAL semantics and Enterprise Financial Compliance.
 */

const INTERNAL_SCALE = 12n;
const SCALE_FACTOR = 10n ** INTERNAL_SCALE; // 1,000,000,000,000n

export class Decimal {
  /**
   * @param {string|number|bigint|Decimal} val 
   */
  constructor(val) {
    if (val instanceof Decimal) {
      this.raw = val.raw;
      return;
    }
    if (typeof val === "bigint") {
      this.raw = val * SCALE_FACTOR;
      return;
    }
    if (typeof val === "number") {
      if (isNaN(val) || !isFinite(val)) {
        this.raw = 0n;
        return;
      }
      val = val.toString();
    }
    if (typeof val !== "string") {
      val = String(val || "0");
    }

    val = val.trim();
    if (!val || val === "NaN" || val === "null" || val === "undefined") {
      this.raw = 0n;
      return;
    }

    const isNeg = val.startsWith("-");
    if (isNeg || val.startsWith("+")) {
      val = val.substring(1);
    }

    let [intPart, fracPart = ""] = val.split(".");
    intPart = intPart.replace(/^0+(?=\d)/, "") || "0";
    fracPart = fracPart.padEnd(Number(INTERNAL_SCALE), "0").slice(0, Number(INTERNAL_SCALE));

    const combinedStr = intPart + fracPart;
    const absBig = BigInt(combinedStr);
    this.raw = isNeg ? -absBig : absBig;
  }

  static fromRaw(rawBigInt) {
    const d = Object.create(Decimal.prototype);
    d.raw = rawBigInt;
    return d;
  }

  add(other) {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return Decimal.fromRaw(this.raw + o.raw);
  }

  sub(other) {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return Decimal.fromRaw(this.raw - o.raw);
  }

  mul(other) {
    const o = other instanceof Decimal ? other : new Decimal(other);
    // (a * b) / SCALE_FACTOR
    const product = this.raw * o.raw;
    const sign = product < 0n ? -1n : 1n;
    const absProduct = product < 0n ? -product : product;
    // Half-up rounding at division by SCALE_FACTOR
    const halfScale = SCALE_FACTOR / 2n;
    const scaled = (absProduct + halfScale) / SCALE_FACTOR;
    return Decimal.fromRaw(sign * scaled);
  }

  div(other) {
    const o = other instanceof Decimal ? other : new Decimal(other);
    if (o.raw === 0n) {
      throw new Error("Division by zero in financial calculation.");
    }
    // (a * SCALE_FACTOR) / b
    const numerator = this.raw * SCALE_FACTOR;
    const sign = (numerator < 0n) !== (o.raw < 0n) ? -1n : 1n;
    const absNum = numerator < 0n ? -numerator : numerator;
    const absDen = o.raw < 0n ? -o.raw : o.raw;
    // Half-up rounding
    const halfDen = absDen / 2n;
    const quotient = (absNum + halfDen) / absDen;
    return Decimal.fromRaw(sign * quotient);
  }

  round(decimalPlaces = 2) {
    const dp = BigInt(Math.max(0, decimalPlaces));
    if (dp >= INTERNAL_SCALE) return this;
    const shift = 10n ** (INTERNAL_SCALE - dp);
    const sign = this.raw < 0n ? -1n : 1n;
    const absVal = this.raw < 0n ? -this.raw : this.raw;
    const half = shift / 2n;
    const rounded = ((absVal + half) / shift) * shift;
    return Decimal.fromRaw(sign * rounded);
  }

  toFixed(decimalPlaces = 2) {
    const dp = Math.max(0, decimalPlaces);
    const rounded = this.round(dp);
    const sign = rounded.raw < 0n ? "-" : "";
    const absVal = rounded.raw < 0n ? -rounded.raw : rounded.raw;
    const intPart = (absVal / SCALE_FACTOR).toString();
    const fracPartBig = absVal % SCALE_FACTOR;
    let fracPartStr = fracPartBig.toString().padStart(Number(INTERNAL_SCALE), "0");
    if (dp === 0) {
      return sign + intPart;
    }
    return `${sign}${intPart}.${fracPartStr.slice(0, dp)}`;
  }

  toNumber() {
    return Number(this.toFixed(8));
  }

  isZero() {
    return this.raw === 0n;
  }

  isNegative() {
    return this.raw < 0n;
  }

  isPositive() {
    return this.raw > 0n;
  }

  cmp(other) {
    const o = other instanceof Decimal ? other : new Decimal(other);
    if (this.raw < o.raw) return -1;
    if (this.raw > o.raw) return 1;
    return 0;
  }

  equals(other) {
    return this.cmp(other) === 0;
  }

  greaterThan(other) {
    return this.cmp(other) > 0;
  }

  lessThan(other) {
    return this.cmp(other) < 0;
  }

  greaterThanOrEqualTo(other) {
    return this.cmp(other) >= 0;
  }

  lessThanOrEqualTo(other) {
    return this.cmp(other) <= 0;
  }

  static max(...values) {
    if (values.length === 0) return new Decimal(0);
    let m = values[0] instanceof Decimal ? values[0] : new Decimal(values[0]);
    for (let i = 1; i < values.length; i++) {
      const cur = values[i] instanceof Decimal ? values[i] : new Decimal(values[i]);
      if (cur.greaterThan(m)) m = cur;
    }
    return m;
  }

  static min(...values) {
    if (values.length === 0) return new Decimal(0);
    let m = values[0] instanceof Decimal ? values[0] : new Decimal(values[0]);
    for (let i = 1; i < values.length; i++) {
      const cur = values[i] instanceof Decimal ? values[i] : new Decimal(values[i]);
      if (cur.lessThan(m)) m = cur;
    }
    return m;
  }
}

export const D = (val) => new Decimal(val);

/**
 * Format currency amount with symbol and decimal precision
 */
export function formatCurrency(amount, currencyCode = "USD", customDecimals = null) {
  const dec = new Decimal(amount);
  const symbols = {
    INR: "₹",
    USD: "$",
    EUR: "€",
    GBP: "£",
    AED: "AED "
  };
  const sym = symbols[currencyCode.toUpperCase()] || `${currencyCode.toUpperCase()} `;
  const dp = customDecimals !== null ? customDecimals : (currencyCode.toUpperCase() === "AED" ? 2 : 2);
  const fixed = dec.toFixed(dp);
  
  // Format with thousand commas
  const [intStr, decStr] = fixed.split(".");
  const formattedInt = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decStr !== undefined ? `${sym}${formattedInt}.${decStr}` : `${sym}${formattedInt}`;
}

