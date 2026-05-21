/**
 * P21-B — Decimal-safe money (BigInt minor units — no parseFloat)
 */

export type RoundingMode = "half_up" | "down" | "up";

const STORAGE_SCALE = 4;

function parseToMinor(input: string, scale: number): bigint {
  const trimmed = input.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid money value: ${input}`);
  }
  const negative = trimmed.startsWith("-");
  const abs = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ""] = abs.split(".");
  const fracPadded = (frac + "0".repeat(scale)).slice(0, scale);
  const minor = BigInt(whole) * BigInt(10 ** scale) + BigInt(fracPadded || "0");
  return negative ? -minor : minor;
}

function minorToString(minor: bigint, scale: number, displayScale?: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const divisor = BigInt(10 ** scale);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const fracStr = frac.toString().padStart(scale, "0");
  const outScale = displayScale ?? scale;
  const fracOut =
    outScale <= scale ? fracStr.slice(0, outScale) : fracStr + "0".repeat(outScale - scale);
  const base = `${whole}.${fracOut}`;
  return negative ? `-${base}` : base;
}

function roundMinor(minor: bigint, scale: number, mode: RoundingMode): bigint {
  if (scale <= 0) return minor;
  const factor = BigInt(10 ** scale);
  const half = factor / 2n;
  if (mode === "down") {
    return (minor >= 0n ? minor : minor - factor + 1n) / factor * factor;
  }
  if (mode === "up") {
    return (minor >= 0n ? minor + factor - 1n : minor) / factor * factor;
  }
  // half_up
  if (minor >= 0n) return (minor + half) / factor * factor;
  return (minor - half) / factor * factor;
}

export class Money {
  private readonly minor: bigint;
  readonly currency: string;
  readonly scale: number;

  private constructor(minor: bigint, currency: string, scale: number) {
    this.minor = minor;
    this.currency = currency;
    this.scale = scale;
  }

  static zero(currency = "SAR", scale = 2): Money {
    return new Money(0n, currency, scale);
  }

  static fromString(input: string | null | undefined, currency = "SAR", scale = 2): Money {
    return new Money(parseToMinor(input ?? "0", scale), currency, scale);
  }

  static fromDb(value: string | null | undefined, currency = "SAR"): Money {
    return Money.fromString(value ?? "0", currency, STORAGE_SCALE);
  }

  add(other: Money): Money {
    Money.assertSameCurrency(this, other);
    const scale = Math.max(this.scale, other.scale);
    const a = Money.alignMinor(this, scale);
    const b = Money.alignMinor(other, scale);
    return new Money(a + b, this.currency, scale);
  }

  sub(other: Money): Money {
    Money.assertSameCurrency(this, other);
    const scale = Math.max(this.scale, other.scale);
    const a = Money.alignMinor(this, scale);
    const b = Money.alignMinor(other, scale);
    return new Money(a - b, this.currency, scale);
  }

  mul(factor: string): Money {
    const [w, f = ""] = factor.split(".");
    const factorScale = f.length;
    const factorMinor = parseToMinor(factor, factorScale);
    const combined = this.minor * factorMinor;
    return new Money(combined, this.currency, this.scale + factorScale);
  }

  div(divisor: string): Money {
    const d = parseToMinor(divisor, STORAGE_SCALE);
    if (d === 0n) throw new Error("Division by zero");
    const combinedScale = this.scale + STORAGE_SCALE;
    const num = this.minor * BigInt(10 ** STORAGE_SCALE);
    return new Money(num / d, this.currency, combinedScale);
  }

  round(mode: RoundingMode = "half_up", displayScale?: number): Money {
    const target = displayScale ?? this.scale;
    const aligned = roundMinor(this.minor, this.scale - target, mode);
    return new Money(aligned, this.currency, target);
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  compare(other: Money): number {
    Money.assertSameCurrency(this, other);
    const scale = Math.max(this.scale, other.scale);
    const a = Money.alignMinor(this, scale);
    const b = Money.alignMinor(other, scale);
    if (a === b) return 0;
    return a > b ? 1 : -1;
  }

  toStorageString(): string {
    return minorToString(this.minor, this.scale, STORAGE_SCALE);
  }

  toDisplayString(): string {
    return minorToString(this.minor, this.scale, this.scale);
  }

  toJSON(): string {
    return this.toStorageString();
  }

  private static alignMinor(m: Money, targetScale: number): bigint {
    if (m.scale === targetScale) return m.minor;
    if (m.scale < targetScale) {
      return m.minor * BigInt(10 ** (targetScale - m.scale));
    }
    return m.minor / BigInt(10 ** (m.scale - targetScale));
  }

  private static assertSameCurrency(a: Money, b: Money): void {
    if (a.currency !== b.currency) {
      throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
    }
  }
}

export function sumMoney(items: Money[], currency = "SAR", scale = 2): Money {
  return items.reduce((acc, m) => acc.add(m), Money.zero(currency, scale));
}

export function aggregateMoneyStrings(values: string[]): string {
  return values
    .reduce((acc, v) => acc.add(Money.fromDb(v)), Money.fromDb("0"))
    .toStorageString();
}
