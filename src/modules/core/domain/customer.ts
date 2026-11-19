/** Customer rules (pure). */

export type CustomerKind = "INDIVIDUAL" | "COMPANY" | "OEM";

export function customerDisplayName(c: {
  kind: CustomerKind;
  title?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}): string {
  if (c.kind === "INDIVIDUAL") {
    const name = [c.firstName, c.lastName?.toUpperCase()].filter(Boolean).join(" ");
    return name || "Unnamed customer";
  }
  return c.companyName?.trim() || "Unnamed company";
}

/** Auxiliary receivable account for a customer, from the configured collective account (default 411). */
export function customerAccountCode(customerNumber: string, collective = "411"): string {
  return `${collective}${customerNumber}`;
}

/** SIREN: 9 digits with a valid Luhn checksum. */
export function isValidSiren(siren: string): boolean {
  const s = siren.replace(/\s/g, "");
  if (!/^\d{9}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(s[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** French intra-EU VAT number derived from a SIREN: FR + 2-digit key + SIREN. */
export function frenchVatNumber(siren: string): string {
  const s = siren.replace(/\s/g, "");
  const key = (12 + 3 * (Number(s) % 97)) % 97;
  return `FR${String(key).padStart(2, "0")}${s}`;
}

export function isValidFrenchVatNumber(vat: string): boolean {
  const v = vat.replace(/\s/g, "").toUpperCase();
  const m = /^FR(\d{2})(\d{9})$/.exec(v);
  if (!m) return false;
  return frenchVatNumber(m[2]) === v;
}
