import { runCommand, runQuery, SYSTEM_ACTOR, type Actor } from "@/lib/context";
import { addDays, isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { ensurePeriods } from "@/modules/accounting";
import { advanceBusinessDay } from "@/modules/core";
import { getStockValueReport } from "@/modules/reports";
import { simulationInputSchema, simulationRatesSchema, type SimulationInput, type SimulationRates } from "../domain/config";
import { isOpenDay, rng } from "../domain/random";
import { accountingDay } from "./accounting";
import { partsDay } from "./parts";
import { salesDay } from "./sales";
import { loadCast, makeSim, type Skipped } from "./shared";
import { workshopDay } from "./workshop";

export interface SimulationInvariants {
  /** Every journal line together: debit = credit. */
  debitCents: number;
  creditCents: number;
  balanced: boolean;
  /** Stock accounts (37x) equal the vehicle and parts sub-ledgers. */
  stockReconciled: boolean;
  stockDifferences: { kind: string; differenceCents: number | null }[];
}

export interface SimulationReport {
  from: string;
  to: string;
  days: number;
  site: string | null;
  rates: SimulationRates;
  counts: Record<string, number>;
  skipped: Skipped[];
  invariants: SimulationInvariants;
  /** An unexpected failure that stopped the run (the days before it are kept). */
  error: string | null;
  ok: boolean;
}

declare module "@/lib/events" {
  interface DomainEventMap {
    SimulationRun: { from: string; to: string; days: number; site: string | null; ok: boolean; counts: Record<string, number>; skippedCount: number; skipped: Skipped[]; invariants: SimulationInvariants; error: string | null; rates: SimulationRates };
  }
}

/** Does the journal balance and does every stock account equal its sub-ledger? */
export async function checkSimulationInvariants(): Promise<SimulationInvariants> {
  const sums = await db.journalLine.aggregate({ _sum: { debitCents: true, creditCents: true } });
  const stock = await runQuery({ actor: SYSTEM_ACTOR, siteId: null }, (ctx) => getStockValueReport(ctx));
  const debitCents = sums._sum.debitCents ?? 0;
  const creditCents = sums._sum.creditCents ?? 0;
  return {
    debitCents,
    creditCents,
    balanced: debitCents === creditCents,
    stockReconciled: stock.reconciled,
    stockDifferences: stock.totals.map((t) => ({ kind: t.kind, differenceCents: t.differenceCents })),
  };
}

/**
 * The scenario runner (D-071). From the current business date, for `days` days: on each open day
 * every site's accounts, sales, workshop and parts desks act through the services, as the site's
 * own users; then the clock moves to the next day, which runs the end-of-day jobs (reservation
 * and quote expiry). Each step is its own transaction: a step the business rules refuse is
 * recorded and skipped; an unexpected error stops the run and is reported.
 * Decisions about an existing record (accept this quote? pay this invoice late?) are drawn from
 * the record's id and the seed, so the runner keeps no state and can stop and resume anywhere.
 */
export async function runSimulation(starter: Actor, input: SimulationInput | Record<string, unknown>, opts: { onDay?: (day: Date, counts: Record<string, number>) => void } = {}): Promise<SimulationReport> {
  const data = parseInput(simulationInputSchema, input);
  const rates = simulationRatesSchema.parse(data.rates);
  const start = await runQuery({ actor: starter, siteId: null, permission: { resource: "admin.simulation", action: "edit" } }, async (ctx) => ctx.businessDate);
  const cast = await loadCast(data.site || null);
  if (data.site && !cast.sites.length) throw new ValidationError("Unknown site", { site: ["Unknown site"] });

  const counts: Record<string, number> = {};
  const skipped: Skipped[] = [];
  const stream = rng(`${rates.seed}|${isoDate(start)}`);
  let day = start;
  let error: string | null = null;
  try {
    for (let i = 0; i < data.days; i++) {
      // The year's periods exist before anything is posted on its first day.
      await runCommand({ actor: starter, siteId: null, businessDate: day }, (ctx) => ensurePeriods(ctx.tx, day, addDays(day, 31)));
      if (isOpenDay(day)) {
        const sim = makeSim(rates, cast, day, stream, counts, skipped);
        for (const site of cast.sites) {
          await accountingDay(sim, site);
          await salesDay(sim, site);
          await workshopDay(sim, site);
          await partsDay(sim, site);
        }
      }
      day = await runCommand({ actor: starter, siteId: null, businessDate: day }, (ctx) => advanceBusinessDay(ctx));
      counts["day"] = (counts["day"] ?? 0) + 1;
      opts.onDay?.(day, counts);
    }
  } catch (e) {
    error = `${isoDate(day)}: ${e instanceof Error ? e.message : String(e)}`;
  }

  const invariants = await checkSimulationInvariants();
  const report: SimulationReport = {
    from: isoDate(start),
    to: isoDate(day),
    days: counts["day"] ?? 0,
    site: data.site ? cast.sites.map((s) => s.code).join(",") : null,
    rates,
    counts,
    skipped,
    invariants,
    error,
    ok: !error && invariants.balanced && invariants.stockReconciled,
  };
  await runCommand({ actor: starter, siteId: null, businessDate: day }, async (ctx) => {
    await ctx.audit({ action: "simulation.run", entityType: "Simulation", entityId: report.from, after: { from: report.from, to: report.to, days: report.days, site: report.site, ok: report.ok } });
    await ctx.emit({
      type: "SimulationRun",
      aggregateType: "Simulation",
      aggregateId: report.from,
      payload: { ...report, skippedCount: skipped.length, skipped: skipped.slice(0, 50) },
    });
  });
  return report;
}

