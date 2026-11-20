/**
 * Seed — accounting (Phase 2): chart, journals, mappings, periods, suppliers, opening balances
 * and a light six-month history of manual invoices, receipts and monthly overheads.
 * Everything goes through the accounting services. Faker calls happen after seed v1 so the
 * earlier data stays identical.
 */
import { faker } from "@faker-js/faker/locale/fr";
import { db } from "@/lib/db";
import { runCommand, SYSTEM_ACTOR, type ServiceContext } from "@/lib/context";
import { addDays } from "@/lib/dates";
import { createSupplier } from "@/modules/core";
import {
  ensurePeriods,
  installDefaultChart,
  lockPeriod,
  postManualEntry,
  postOpeningBalances,
  recordPayment,
  periodOf,
} from "@/modules/accounting";
import { BRANDS, SITES } from "./data";

const sys = <T>(fn: (ctx: ServiceContext) => Promise<T>, businessDate?: Date) =>
  runCommand({ actor: SYSTEM_ACTOR, siteId: null, businessDate }, fn);

const firstOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const monthsBack = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));

/** Other modules' history, run inside the accounting one so document numbers stay chronological. */
export interface HistoryHooks {
  /** Before the opening balances (stock that the opening entry must value). */
  opening?: (opening: Date) => Promise<void>;
  /** After the opening balances, before the first day. */
  before?: (opening: Date) => Promise<void>;
  /** At the end of each day of history. */
  day?: (day: Date) => Promise<void>;
  /** After the last day, before the months are locked. */
  after?: () => Promise<void>;
}

/** Run several modules' hooks in order at each point of the history. */
export function composeHooks(...all: HistoryHooks[]): HistoryHooks {
  return {
    opening: async (d) => {
      for (const h of all) await h.opening?.(d);
    },
    before: async (d) => {
      for (const h of all) await h.before?.(d);
    },
    day: async (d) => {
      for (const h of all) await h.day?.(d);
    },
    after: async () => {
      for (const h of all) await h.after?.();
    },
  };
}

export async function seedAccounting(
  today: Date,
  sites: Map<string, string>,
  brands: Map<string, string>,
  customerIds: string[],
  hooks: HistoryHooks = {},
) {
  await sys((ctx) => installDefaultChart(ctx));
  const opening = monthsBack(today, 6);
  await sys((ctx) => ensurePeriods(ctx.tx, opening, new Date(Date.UTC(today.getUTCFullYear(), 11, 31))));

  // Suppliers: OEMs (vehicle & parts purchases) + overhead suppliers.
  for (const b of BRANDS) {
    const s = await sys((ctx) => createSupplier(ctx, { name: b.oemName.replace("(OEM)", "— Distribution"), isOem: true, paymentTermsDays: 30, city: "Paris" }));
    await db.brand.update({ where: { id: brands.get(b.code)! }, data: { oemSupplierId: s.id } });
  }
  const landlord = await sys((ctx) => createSupplier(ctx, { name: "SCI Les Hangars de l'Ouest", paymentTermsDays: 0, city: "Nantes" }));
  for (const name of ["Ouest Pièces Distribution", "Carrosserie Peinture Atlantique", "Énergie Ouest Services"]) {
    await sys((ctx) => createSupplier(ctx, { name, paymentTermsDays: 30, city: faker.location.city() }));
  }

  await hooks.opening?.(opening);

  // Opening balances per site: stock sub-ledgers (perpetual inventory), bank, capital. Only the cars
  // held when the books are opened: later arrivals are booked on their stock-in date (sales seed).
  const stock = await db.vehicle.groupBy({
    by: ["siteId", "stockType"],
    where: {
      stockType: { in: ["VN", "VO"] },
      status: { in: ["IN_STOCK", "RESERVED", "INTAKE", "RECONDITIONING", "FOR_SALE"] },
      stockInDate: { lte: opening },
    },
    _sum: { stockValueCents: true },
  });
  const parts = await db.stockItem.groupBy({ by: ["siteId"], _sum: { valueCents: true } });
  for (const s of SITES) {
    const siteId = sites.get(s.code)!;
    const v = (t: "VN" | "VO") => stock.find((x) => x.siteId === siteId && x.stockType === t)?._sum.stockValueCents ?? 0;
    await sys((ctx) =>
      postOpeningBalances(ctx, {
        siteId,
        date: opening,
        balances: [
          { account: { key: "STOCK_VN" }, amountCents: v("VN"), label: "VN stock at opening" },
          { account: { key: "STOCK_VO" }, amountCents: v("VO"), label: "VO stock at opening" },
          { account: { key: "STOCK_PARTS" }, amountCents: parts.find((x) => x.siteId === siteId)?._sum.valueCents ?? 0, label: "Parts stock at opening" },
          { account: { code: "512100" }, amountCents: 35_000_000, label: "Bank at opening" },
          { account: { key: "CAPITAL" }, amountCents: -30_000_000, label: "Share capital" },
        ],
        balancingAccount: { code: "110000" },
      }),
    );
  }

  await hooks.before?.(opening);

  // Six months of overheads, day by day; the modules' hooks add their own activity each day.

  for (let day = opening; day < today; day = addDays(day, 1)) {
    const monthStart = day.getUTCDate() === 1;
    for (const s of SITES) {
      const siteId = sites.get(s.code)!;
      if (monthStart) {
        await sys((ctx) =>
          postManualEntry(ctx, {
            journalCode: "OD",
            siteId,
            entryDate: day,
            label: `Rent ${day.toISOString().slice(0, 7)}`,
            lines: [
              { accountCode: "613200", debitCents: 400_000, departmentCode: "OVERHEAD" },
              { accountCode: "401000", creditCents: 400_000, partyType: "SUPPLIER", partyId: landlord.id },
            ],
          }),
        day);
        await sys((ctx) => recordPayment(ctx, { siteId, direction: "OUT", method: "TRANSFER", supplierId: landlord.id, amountCents: 400_000, reference: "Rent" }), day);
      }
      if (day.getUTCDate() === 28) {
        const lines = [
          { dept: "VN", cents: 450_000 },
          { dept: "VO", cents: 300_000 },
          { dept: "WORKSHOP", cents: 650_000 },
          { dept: "PARTS", cents: 250_000 },
          { dept: "OVERHEAD", cents: 350_000 },
        ];
        const total = lines.reduce((t, l) => t + l.cents, 0);
        await sys((ctx) =>
          postManualEntry(ctx, {
            journalCode: "OD",
            siteId,
            entryDate: day,
            label: `Salaries ${day.toISOString().slice(0, 7)}`,
            lines: [
              ...lines.map((l) => ({ accountCode: "641000", debitCents: l.cents, departmentCode: l.dept })),
              { accountCode: "512100", creditCents: total },
            ],
          }),
        day);
      }
    }
    await hooks.day?.(day);
  }
  await hooks.after?.();

  // Close every month except the last finished one (left open to demo the month-end close).
  const lastFinished = periodOf(monthsBack(today, 1));
  const periods = await db.fiscalPeriod.findMany({ orderBy: [{ year: "asc" }, { month: "asc" }] });
  for (const p of periods) {
    if (p.year > lastFinished.year || (p.year === lastFinished.year && p.month >= lastFinished.month)) break;
    if (p.startDate < firstOfMonth(opening)) continue;
    await sys((ctx) => lockPeriod(ctx, p.id), today);
  }
  return { invoices: await db.invoice.count(), payments: await db.payment.count(), entries: await db.journalEntry.count() };
}
