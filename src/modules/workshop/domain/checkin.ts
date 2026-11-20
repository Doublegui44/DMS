/** Check-in record: damages noted on the car when the customer leaves it (pure). */

export const DAMAGE_ZONES = ["FRONT", "REAR", "LEFT", "RIGHT", "ROOF", "WINDSCREEN", "WHEELS", "INTERIOR"] as const;
export type DamageZone = (typeof DAMAGE_ZONES)[number];

export interface Damage {
  zone: DamageZone;
  note: string;
}

/** Parse "FRONT: scratch on bumper" lines (or a zone alone) into damages. */
export function parseDamages(text: string): Damage[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [zone, ...rest] = l.split(":");
      const z = zone.trim().toUpperCase() as DamageZone;
      if (!DAMAGE_ZONES.includes(z)) throw new RangeError(`Unknown zone ${zone.trim()}`);
      return { zone: z, note: rest.join(":").trim() };
    });
}
