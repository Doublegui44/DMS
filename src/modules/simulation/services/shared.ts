import { loadActor } from "@/lib/actor";
import { runCommand, type Actor, type ServiceContext } from "@/lib/context";
import { isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import type { SimulationRates } from "../domain/config";
import type { Rng } from "../domain/random";

/** The people who work at a site, as the runner acts through them (never as the system). */
export interface SiteCast {
  id: string;
  code: string;
  slug: string;
  brandIds: string[];
  salespeople: Actor[];
  salesManager: Actor | null;
  advisor: Actor | null;
  serviceManager: Actor | null;
  partsManager: Actor | null;
  technicianIds: string[];
}

export interface Cast {
  sites: SiteCast[];
  dealerPrincipal: Actor | null;
  accountant: Actor | null;
}

export type Skipped = { day: string; site: string | null; step: string; message: string };

/** One run's moving parts, handed to each activity. */
export interface Sim {
  rates: SimulationRates;
  cast: Cast;
  day: Date;
  rng: Rng;
  counts: Record<string, number>;
  skipped: Skipped[];
  /**
   * Run one business step as `actor` in its own transaction, on the simulated day. A step the
   * business rules refuse (a DomainError) is recorded and skipped; anything else stops the run.
   */
  step<T>(name: string, actor: Actor | null, siteId: string | null, fn: (ctx: ServiceContext) => Promise<T>): Promise<T | undefined>;
}

export function makeSim(rates: SimulationRates, cast: Cast, day: Date, rng: Rng, counts: Record<string, number>, skipped: Skipped[]): Sim {
  return {
    rates,
    cast,
    day,
    rng,
    counts,
    skipped,
    async step(name, actor, siteId, fn) {
      if (!actor) return undefined;
      try {
        const result = await runCommand({ actor, siteId, businessDate: day }, fn);
        if (result !== undefined && result !== null && result !== false) counts[name] = (counts[name] ?? 0) + 1;
        return result;
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        skipped.push({ day: isoDate(day), site: cast.sites.find((s) => s.id === siteId)?.code ?? null, step: name, message: e.message });
        return undefined;
      }
    },
  };
}

const actor = async (userId: string | undefined) => (userId ? await loadActor(userId) : null);

/** Find, per site, the active users holding each role (the first by email when there are several). */
export async function loadCast(siteFilter: string | null): Promise<Cast> {
  const sites = await db.site.findMany({ include: { brands: true }, orderBy: { code: "asc" } });
  const grants = await db.userRole.findMany({
    where: { user: { active: true } },
    include: { role: { select: { key: true } }, user: { select: { id: true, email: true } } },
    orderBy: { user: { email: "asc" } },
  });
  const holders = (key: string, siteId: string | null) => grants.filter((g) => g.role.key === key && g.siteId === siteId).map((g) => g.user.id);
  const technicians = await db.technician.findMany({ where: { active: true }, orderBy: { userId: "asc" } });
  const chosen = siteFilter ? sites.filter((s) => s.id === siteFilter || s.slug === siteFilter || s.code === siteFilter.toUpperCase()) : sites;
  const cast: Cast = {
    sites: [],
    dealerPrincipal: await actor(holders("DEALER_PRINCIPAL", null)[0]),
    accountant: await actor(holders("ACCOUNTANT", null)[0]),
  };
  for (const s of chosen) {
    cast.sites.push({
      id: s.id,
      code: s.code,
      slug: s.slug,
      brandIds: s.brands.map((b) => b.brandId),
      salespeople: (await Promise.all(holders("SALESPERSON", s.id).map(actor))).filter((a): a is Actor => !!a),
      salesManager: await actor(holders("SALES_MANAGER", s.id)[0]),
      advisor: await actor(holders("SERVICE_ADVISOR", s.id)[0] ?? holders("SERVICE_MANAGER", s.id)[0]),
      serviceManager: await actor(holders("SERVICE_MANAGER", s.id)[0]),
      partsManager: await actor(holders("PARTS_MANAGER", s.id)[0]),
      technicianIds: technicians.filter((t) => t.siteId === s.id).map((t) => t.userId),
    });
  }
  return cast;
}

export const DAY_START = 8 * 60;
export const DAY_END = 18 * 60;
