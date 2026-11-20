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
  createAndIssueInvoice,
  ensurePeriods,
  installDefaultChart,
  lockPeriod,
  postManualEntry,
  postOpeningBalances,
  recordPayment,
  periodOf,
  type InvoiceInput,
} from "@/modules/accounting";
import { BRANDS, SITES } from "./data";

const sys = <T>(fn: (ctx: ServiceContext) => Promise<T>, businessDate?: Date) =>
  runCommand({ actor: SYSTEM_ACTOR, siteId: null, businessDate }, fn);

const firstOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const monthsBack = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));

const WORKSHOP_JOBS = [
  { label: "Annual service — labour", hours: 1.2, parts: [{ label: "Oil filter", cents: 1_450 }, { label: "Engine oil 5W30 (5 L)", cents: 5_490 }] },
  { label: "Front brake pads replacement — labour", hours: 1.0, parts: [{ label: "Brake pad set", cents: 6_890 }] },
  { label: "Timing belt kit — labour", hours: 3.5, parts: [{ label: "Timing belt kit", cents: 24_900 }, { label: "Water pump", cents: 8_950 }] },
  { label: "Tyre fitting x2 — labour", hours: 0.6, parts: [{ label: "Tyre 205/55 R16", cents: 9_800 }, { label: "Tyre 205/55 R16", cents: 9_800 }] },
  { label: "Air-conditioning recharge — labour", hours: 0.8, parts: [{ label: "Refrigerant R1234yf", cents: 4_500 }] },
  { label: "Diagnostic — labour", hours: 0.5, parts: [] },
];

/** Other modules' history, run inside the accounting one so document numbers stay chronological. */
export interface HistoryHooks {
  /** After the opening balances, before the first day. */
  before?: (opening: Date) => Promise<void>;
  /** At the end of each day of history. */
  day?: (day: Date) => Promise<void>;
  /** After the last day, before the months are locked. */
  after?: () => Promise<void>;
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
          { account: { code: "512100" }, amountCents: 35_000_000, label: "Bank at opening" },
          { account: { key: "CAPITAL" }, amountCents: -30_000_000, label: "Share capital" },
        ],
        balancingAccount: { code: "110000" },
      }),
    );
  }

  await hooks.before?.(opening);

  // Six months of activity, day by day: workshop/parts invoices, warranty claims, receipts, overheads.
  const individuals = await db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, homeSiteId: true, kind: true } });
  const oemCustomers = await db.brand.findMany({ select: { code: true, oemCustomerId: true } });
  let invoices = 0;
  let payments = 0;
  const unpaidCompany: { id: string; siteId: string; customerId: string; total: number; due: Date }[] = [];

  for (let day = opening; day < today; day = addDays(day, 1)) {
    const weekday = day.getUTCDay();
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
        payments++;
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
      if (weekday === 0) continue; // closed on Sundays
      const count = faker.number.int({ min: 0, max: weekday === 6 ? 1 : 3 });
      for (let i = 0; i < count; i++) {
        const local = individuals.filter((c) => c.homeSiteId === siteId);
        const customer = faker.helpers.arrayElement(local.length ? local : individuals);
        const job = faker.helpers.arrayElement(WORKSHOP_JOBS);
        const input: InvoiceInput = {
          siteId,
          customerId: customer.id,
          lines: [
            { label: job.label, quantity: job.hours, unitPriceExclVatCents: s.labourRateCents, departmentCode: "WORKSHOP", revenueKey: "REVENUE_LABOUR" },
            ...job.parts.map((p) => ({ label: p.label, quantity: 1, unitPriceExclVatCents: p.cents, departmentCode: "PARTS" as const, revenueKey: "REVENUE_PARTS" })),
          ],
        };
        const inv = await sys((ctx) => createAndIssueInvoice(ctx, input), day);
        invoices++;
        if (customer.kind === "COMPANY") {
          unpaidCompany.push({ id: inv.id, siteId, customerId: customer.id, total: inv.totalInclVatCents, due: inv.dueDate! });
        } else if (faker.datatype.boolean(0.97)) {
          const method = faker.helpers.weightedArrayElement([
            { value: "CARD" as const, weight: 7 },
            { value: "CHEQUE" as const, weight: 1 },
            { value: "CASH" as const, weight: 1 },
            { value: "TRANSFER" as const, weight: 1 },
          ]);
          await sys((ctx) => recordPayment(ctx, { siteId, method, customerId: customer.id, amountCents: inv.totalInclVatCents, allocations: [{ invoiceId: inv.id, amountCents: inv.totalInclVatCents }] }), day);
          payments++;
        }
      }
      // A warranty claim to the OEM about once a week per site.
      if (weekday === 3) {
        const brandCode = faker.helpers.arrayElement(s.brands);
        const oem = oemCustomers.find((b) => b.code === brandCode)!.oemCustomerId!;
        const inv = await sys(
          (ctx) =>
            createAndIssueInvoice(ctx, {
              siteId,
              customerId: oem,
              sourceType: "WARRANTY_CLAIM",
              lines: [
                { label: "Warranty labour", quantity: faker.number.float({ min: 0.5, max: 4, fractionDigits: 1 }), unitPriceExclVatCents: 8_000, departmentCode: "WORKSHOP", revenueKey: "REVENUE_WARRANTY_LABOUR" },
                { label: "Warranty parts", quantity: 1, unitPriceExclVatCents: faker.number.int({ min: 3_000, max: 60_000 }), departmentCode: "PARTS", revenueKey: "REVENUE_WARRANTY_PARTS" },
              ],
            }),
          day,
        );
        invoices++;
        unpaidCompany.push({ id: inv.id, siteId, customerId: oem, total: inv.totalInclVatCents, due: inv.dueDate! });
      }
    }
    // Companies and OEMs pay by transfer around their due date (most of them).
    const dueToday = unpaidCompany.filter((u) => u.due.getTime() <= day.getTime());
    for (const u of dueToday) {
      unpaidCompany.splice(unpaidCompany.indexOf(u), 1);
      if (!faker.datatype.boolean(0.85)) continue; // some stay overdue for the demo
      await sys((ctx) => recordPayment(ctx, { siteId: u.siteId, method: "TRANSFER", customerId: u.customerId, amountCents: u.total, allocations: [{ invoiceId: u.id, amountCents: u.total }] }), day);
      payments++;
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
  return { invoices, payments, entries: await db.journalEntry.count() };
}
