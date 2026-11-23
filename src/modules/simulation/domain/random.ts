/**
 * Deterministic randomness for the runner (D-071). Two kinds:
 *  - a stream (`rng`) for what happens on a day: how many leads, which customer;
 *  - a draw tied to one record (`unit(seed, id, salt)`), so a decision about a quote or an
 *    invoice is the same whichever day the runner looks at it, without keeping any state.
 */

export type Rng = () => number;

/** 32-bit FNV-1a hash of a string. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 generator: floats in [0, 1). */
export function rng(seed: number | string): Rng {
  let a = typeof seed === "number" ? seed >>> 0 : hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A float in [0, 1) fixed for this record, seed and purpose. */
export function unit(seed: number, id: string, salt: string): number {
  return rng(`${seed}|${id}|${salt}`)();
}

/** An integer in [min, max] fixed for this record. */
export function unitInt(seed: number, id: string, salt: string, min: number, max: number): number {
  return min + Math.floor(unit(seed, id, salt) * (max - min + 1));
}

export const chance = (r: Rng, p: number) => r() < p;
export const between = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
export const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];

export function weighted<T>(r: Rng, list: readonly { value: T; weight: number }[]): T {
  const total = list.reduce((t, x) => t + x.weight, 0);
  let x = r() * total;
  for (const item of list) {
    x -= item.weight;
    if (x < 0) return item.value;
  }
  return list[list.length - 1].value;
}

/** Number of events in a day for a mean rate (Poisson, Knuth's method; fine for small means). */
export function poisson(r: Rng, mean: number): number {
  if (mean <= 0) return 0;
  const limit = Math.exp(-mean);
  let k = 0;
  let p = r();
  while (p > limit) {
    k++;
    p *= r();
  }
  return k;
}

/** A weekly rate spread over the six open days. */
export const perOpenDay = (perWeek: number) => perWeek / 6;

/** The dealership is closed on Sundays. */
export const isOpenDay = (d: Date) => d.getUTCDay() !== 0;
