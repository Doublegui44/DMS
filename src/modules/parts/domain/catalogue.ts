/** Part numbers, supersessions and obsolescence, pure. */

/** Calendar months on a UTC business date (the 31st falls back to the month's last day). */
function addUtcMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

/** "1609 4381 80" → "1609438180": upper case, no spaces. */
export function normalisePartNumber(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

/**
 * Follow the "replaced by" chain from a part to the number to sell or order today.
 * A supersession not yet effective is ignored; a loop is a data error.
 */
export function resolveReplacement(
  partId: string,
  replacedBy: (id: string) => { newPartId: string; effectiveOn: Date } | null | undefined,
  today: Date,
): { partId: string; chain: string[] } {
  const chain = [partId];
  let current = partId;
  for (;;) {
    const next = replacedBy(current);
    if (!next || next.effectiveOn.getTime() > today.getTime()) return { partId: current, chain };
    if (chain.includes(next.newPartId)) throw new RangeError(`Supersession loop at ${next.newPartId}`);
    chain.push(next.newPartId);
    current = next.newPartId;
  }
}

/** No movement for `months` (default 12) or more: the part is obsolete stock. */
export function isObsolete(lastMovementOn: Date | null, today: Date, months = 12): boolean {
  return !lastMovementOn || lastMovementOn.getTime() <= obsoleteBefore(today, months).getTime();
}

/** Last movement date at or before which stock counts as obsolete. */
export function obsoleteBefore(today: Date, months = 12): Date {
  return addUtcMonths(today, -months);
}
