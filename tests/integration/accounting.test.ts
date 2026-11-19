import { beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "@/lib/context";
import { clearHandlers } from "@/lib/events";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { createCustomer, createSupplier } from "@/modules/core";
import {
  creditInvoice,
  createAndIssueInvoice,
  createInvoice,
  ensurePeriods,
  getTrialBalance,
  issueInvoice,
  letterLines,
  lockPeriod,
  postEntry,
  postManualEntry,
  postOpeningBalances,
  recordPayment,
  reopenPeriod,
  reverseEntry,
  setAccountMapping,
} from "@/modules/accounting";
import { db, makeActor, resetWithAccounting, sys } from "./helpers";

let org: Awaited<ReturnType<typeof resetWithAccounting>>;
let customerId: string;

beforeEach(async () => {
  clearHandlers();
  org = await resetWithAccounting();
  const c = await sys((ctx) => createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Jeanne", lastName: "Martin", homeSiteId: org.siteA.id }));
  customerId = c.id;
});

const od = (siteId: string, debitCents = 10_000, creditCents = debitCents, date = "2026-03-10") => ({
  journalCode: "OD",
  siteId,
  entryDate: date,
  label: "Rent March",
  lines: [
    { accountCode: "613200", debitCents, departmentCode: "OVERHEAD" },
    { accountCode: "512100", creditCents },
  ],
});

const workshopInvoice = () => ({
  siteId: org.siteA.id,
  customerId,
  lines: [
    { label: "Service labour", quantity: 1.5, unitPriceExclVatCents: 9_500, departmentCode: "WORKSHOP" as const, revenueKey: "REVENUE_LABOUR" },
    { label: "Oil filter", quantity: 1, unitPriceExclVatCents: 1_250, departmentCode: "PARTS" as const, revenueKey: "REVENUE_PARTS" },
  ],
});

async function sumsFor(entryId: string) {
  const s = await db.journalLine.aggregate({ where: { entryId }, _sum: { debitCents: true, creditCents: true } });
  return [s._sum.debitCents, s._sum.creditCents];
}

describe("posting", () => {
  it("posts a balanced manual entry with a gap-free number per journal", async () => {
    const a = await sys((ctx) => postManualEntry(ctx, od(org.siteA.id)));
    const b = await sys((ctx) => postManualEntry(ctx, od(org.siteB.id)));
    expect([a.number, b.number]).toEqual(["OD-2026-000001", "OD-2026-000002"]);
    expect(await sumsFor(a.id)).toEqual([10_000, 10_000]);
  });

  it("rejects an unbalanced entry in the service", async () => {
    await expect(sys((ctx) => postManualEntry(ctx, od(org.siteA.id, 10_000, 9_000)))).rejects.toThrow(/does not balance/);
    expect(await db.journalEntry.count()).toBe(0);
  });

  it("rejects missing analytic, unknown accounts and missing parties", async () => {
    const base = od(org.siteA.id);
    await expect(sys((ctx) => postManualEntry(ctx, { ...base, lines: [{ ...base.lines[0], departmentCode: "" }, base.lines[1]] }))).rejects.toThrow(/department/);
    await expect(sys((ctx) => postManualEntry(ctx, { ...base, lines: [{ ...base.lines[0], accountCode: "999999" }, base.lines[1]] }))).rejects.toThrow(/unknown account/);
    await expect(sys((ctx) => postManualEntry(ctx, { ...base, lines: [{ accountCode: "411000", debitCents: 10_000 }, base.lines[1]] }))).rejects.toThrow(/customer/);
  });

  it("the database rejects an unbalanced entry even if the service is bypassed", async () => {
    await sys((ctx) => ensurePeriods(ctx.tx, new Date("2026-03-01"), new Date("2026-03-31")));
    const period = await db.fiscalPeriod.findFirstOrThrow({ where: { year: 2026, month: 3 } });
    await expect(
      db.$transaction(async (tx) => {
        await tx.journalEntry.create({
          data: {
            number: "OD-HACK-1",
            journalCode: "OD",
            periodId: period.id,
            siteId: org.siteA.id,
            entryDate: new Date("2026-03-10"),
            label: "hack",
            lines: {
              create: [
                { lineNo: 1, accountCode: "512100", debitCents: 100, label: "x", siteId: org.siteA.id, entryDate: new Date("2026-03-10") },
                { lineNo: 2, accountCode: "530000", creditCents: 90, label: "x", siteId: org.siteA.id, entryDate: new Date("2026-03-10") },
              ],
            },
          },
        });
      }),
    ).rejects.toThrow(/UNBALANCED_ENTRY/);
    expect(await db.journalEntry.count()).toBe(0);
  });

  it("posted entries are immutable in the database", async () => {
    const e = await sys((ctx) => postManualEntry(ctx, od(org.siteA.id)));
    await expect(db.journalEntry.update({ where: { id: e.id }, data: { label: "changed" } })).rejects.toThrow(/ENTRY_IMMUTABLE/);
    await expect(db.journalLine.updateMany({ where: { entryId: e.id }, data: { debitCents: 1 } })).rejects.toThrow(/ENTRY_IMMUTABLE/);
  });

  it("resolves the most specific mapping (site beats global)", async () => {
    await sys((ctx) => setAccountMapping(ctx, { key: "TREASURY_TRANSFER", accountCode: "530000", siteId: org.siteB.id }));
    const draft = (siteId: string) => ({
      journalCode: "OD",
      siteId,
      entryDate: new Date("2026-03-10"),
      label: "t",
      sourceType: "TEST",
      lines: [
        { account: { key: "TREASURY_TRANSFER" }, debitCents: 100, creditCents: 0, label: "t" },
        { account: { code: "471000" }, debitCents: 0, creditCents: 100, label: "t" },
      ],
    });
    const a = await sys((ctx) => postEntry(ctx, draft(org.siteA.id)));
    const b = await sys((ctx) => postEntry(ctx, draft(org.siteB.id)));
    const acc = async (id: string) => (await db.journalLine.findFirstOrThrow({ where: { entryId: id, lineNo: 1 } })).accountCode;
    expect([await acc(a.id), await acc(b.id)]).toEqual(["512100", "530000"]);
  });

  it("reverses a manual entry once", async () => {
    const e = await sys((ctx) => postManualEntry(ctx, od(org.siteA.id)));
    const r = await sys((ctx) => reverseEntry(ctx, e.id, "wrong amount"), new Date("2026-03-20"));
    const lines = await db.journalLine.findMany({ where: { entryId: r.id }, orderBy: { lineNo: "asc" } });
    expect(lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["613200", 0, 10_000],
      ["512100", 10_000, 0],
    ]);
    await expect(sys((ctx) => reverseEntry(ctx, e.id, "again"))).rejects.toThrow(/already reversed/);
  });
});

describe("periods", () => {
  it("rejects postings into a locked period, in the service and in the database", async () => {
    await sys((ctx) => ensurePeriods(ctx.tx, new Date("2026-01-01"), new Date("2026-03-31")));
    const e = await sys((ctx) => postManualEntry(ctx, od(org.siteA.id, 500, 500, "2026-02-10")), new Date("2026-02-10"));
    await sys(async (ctx) => {
      const jan = await ctx.tx.fiscalPeriod.findFirstOrThrow({ where: { year: 2026, month: 1 } });
      await lockPeriod(ctx, jan.id);
      const feb = await ctx.tx.fiscalPeriod.findFirstOrThrow({ where: { year: 2026, month: 2 } });
      await lockPeriod(ctx, feb.id);
    });
    await expect(sys((ctx) => postManualEntry(ctx, od(org.siteA.id, 500, 500, "2026-02-15")))).rejects.toThrow(/locked/);
    // Direct SQL bypassing the service is refused by the trigger.
    const feb = await db.fiscalPeriod.findFirstOrThrow({ where: { year: 2026, month: 2 } });
    await expect(
      db.journalEntry.create({
        data: { number: "X-1", journalCode: "OD", periodId: feb.id, siteId: org.siteA.id, entryDate: new Date("2026-02-15"), label: "x" },
      }),
    ).rejects.toThrow(/PERIOD_LOCKED/);
    await expect(db.journalEntry.delete({ where: { id: e.id } })).rejects.toThrow(/PERIOD_LOCKED|ENTRY_IMMUTABLE/);
  });

  it("locks in order, only after month end, and reopens latest first (admin)", async () => {
    await sys((ctx) => ensurePeriods(ctx.tx, new Date("2026-01-01"), new Date("2026-03-31")));
    await sys((ctx) => postManualEntry(ctx, od(org.siteA.id, 500, 500, "2026-01-10")));
    const [jan, feb, mar] = await db.fiscalPeriod.findMany({ orderBy: [{ year: "asc" }, { month: "asc" }] });
    await sys((ctx) => postManualEntry(ctx, od(org.siteA.id, 500, 500, "2026-02-10")));
    await expect(sys((ctx) => lockPeriod(ctx, feb.id))).rejects.toThrow(/earlier periods/);
    await expect(sys((ctx) => lockPeriod(ctx, mar.id), new Date("2026-03-15"))).rejects.toThrow(/not ended/);
    await sys((ctx) => lockPeriod(ctx, jan.id));
    await sys((ctx) => lockPeriod(ctx, feb.id));
    await expect(sys((ctx) => reopenPeriod(ctx, jan.id, "fix"))).rejects.toThrow(/later periods/);

    const accountant = await makeActor("ACCOUNTANT", null);
    await expect(runCommand({ actor: accountant, businessDate: new Date("2026-03-15") }, (ctx) => reopenPeriod(ctx, feb.id, "fix"))).rejects.toThrow(ForbiddenError);
    await sys((ctx) => reopenPeriod(ctx, feb.id, "late supplier invoice"));
    expect((await db.fiscalPeriod.findUniqueOrThrow({ where: { id: feb.id } })).status).toBe("OPEN");
  });
});

describe("invoices, credit notes and payments", () => {
  it("issues an invoice: number at issue, totals, balanced sales entry", async () => {
    const draft = await sys((ctx) => createInvoice(ctx, workshopInvoice()));
    expect(draft).toMatchObject({ number: null, status: "DRAFT", totalExclVatCents: 15_500, vatCents: 3_100, totalInclVatCents: 18_600 });
    const inv = await sys((ctx) => issueInvoice(ctx, draft.id));
    expect(inv).toMatchObject({ number: "NTE-FA-2026-000001", status: "ISSUED" });
    expect(inv.dueDate?.toISOString().slice(0, 10)).toBe("2026-03-15"); // individual pays at collection
    const lines = await db.journalLine.findMany({ where: { entryId: inv.journalEntryId! }, orderBy: { lineNo: "asc" } });
    expect(lines.map((l) => [l.accountCode, l.debitCents, l.creditCents, l.departmentCode])).toEqual([
      ["411000", 18_600, 0, null],
      ["706100", 0, 14_250, "WORKSHOP"],
      ["445710", 0, 3_100, null],
      ["707300", 0, 1_250, "PARTS"],
    ]);
    await expect(sys((ctx) => issueInvoice(ctx, draft.id))).rejects.toThrow(/already issued/);
  });

  it("an invoice failing to post leaves no number consumed", async () => {
    const draft = await sys((ctx) => createInvoice(ctx, { ...workshopInvoice(), lines: [{ ...workshopInvoice().lines[0], revenueKey: "NOPE" }] }));
    await expect(sys((ctx) => issueInvoice(ctx, draft.id))).rejects.toThrow(/NOPE/);
    const ok = await sys((ctx) => createAndIssueInvoice(ctx, workshopInvoice()));
    expect(ok.number).toBe("NTE-FA-2026-000001");
  });

  it("margin-regime used car: VAT on the margin to 445715", async () => {
    const inv = await sys((ctx) =>
      createAndIssueInvoice(ctx, {
        siteId: org.siteA.id,
        customerId,
        vatRegime: "MARGIN",
        lines: [{ label: "Clio V", unitPriceExclVatCents: 1_360_000, purchasePriceCents: 1_000_000, departmentCode: "VO", revenueKey: "REVENUE_VO" }],
      }),
    );
    expect(inv).toMatchObject({ totalInclVatCents: 1_360_000, vatCents: 60_000 });
    const vat = await db.journalLine.findFirstOrThrow({ where: { entryId: inv.journalEntryId!, accountCode: "445715" } });
    expect(vat.creditCents).toBe(60_000);
  });

  it("payment settles the invoice and letters the customer account", async () => {
    const inv = await sys((ctx) => createAndIssueInvoice(ctx, workshopInvoice()));
    const part = await sys((ctx) =>
      recordPayment(ctx, { siteId: org.siteA.id, method: "CARD", customerId, amountCents: 10_000, allocations: [{ invoiceId: inv.id, amountCents: 10_000 }] }),
    );
    expect(part.number).toBe("NTE-RC-2026-000001");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PARTIALLY_PAID");
    await sys((ctx) => recordPayment(ctx, { siteId: org.siteA.id, method: "CASH", customerId, amountCents: 8_600, allocations: [{ invoiceId: inv.id, amountCents: 8_600 }] }));
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    const receivable = await db.journalLine.findMany({ where: { accountCode: "411000", partyId: customerId } });
    expect(receivable).toHaveLength(3);
    expect(new Set(receivable.map((l) => l.letteringCode))).toEqual(new Set(["A"]));
    const cash = await db.journalLine.findFirstOrThrow({ where: { accountCode: "530000" } });
    expect(cash.debitCents).toBe(8_600);
    // Over-allocation is refused.
    await expect(
      sys((ctx) => recordPayment(ctx, { siteId: org.siteA.id, method: "CARD", customerId, amountCents: 100, allocations: [{ invoiceId: inv.id, amountCents: 100 }] })),
    ).rejects.toThrow(/due/);
  });

  it("letters each settled invoice even while another one is still open", async () => {
    const open = await sys((ctx) => createAndIssueInvoice(ctx, workshopInvoice()));
    const settled = await sys((ctx) => createAndIssueInvoice(ctx, workshopInvoice()));
    await sys((ctx) =>
      recordPayment(ctx, { siteId: org.siteA.id, method: "TRANSFER", customerId, amountCents: 18_600, allocations: [{ invoiceId: settled.id, amountCents: 18_600 }] }),
    );
    const line = (entryId: string) => db.journalLine.findFirstOrThrow({ where: { entryId, accountCode: "411000" } });
    expect((await line(settled.journalEntryId!)).letteringCode).toBe("A");
    expect((await line(open.journalEntryId!)).letteringCode).toBeNull();
    // A payment covering two invoices letters all three lines together once both are settled.
    const third = await sys((ctx) => createAndIssueInvoice(ctx, workshopInvoice()));
    await sys((ctx) =>
      recordPayment(ctx, {
        siteId: org.siteA.id,
        method: "TRANSFER",
        customerId,
        amountCents: 37_200,
        allocations: [
          { invoiceId: open.id, amountCents: 18_600 },
          { invoiceId: third.id, amountCents: 18_600 },
        ],
      }),
    );
    expect((await line(open.journalEntryId!)).letteringCode).toBe("B");
    expect((await line(third.journalEntryId!)).letteringCode).toBe("B");
  });

  it("credit note mirrors the invoice and settles it", async () => {
    const inv = await sys((ctx) => createAndIssueInvoice(ctx, workshopInvoice()));
    const cn = await sys((ctx) => creditInvoice(ctx, inv.id, "goodwill"));
    expect(cn).toMatchObject({ number: "NTE-AV-2026-000001", kind: "CREDIT_NOTE", status: "PAID" });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    const tb = await sys((ctx) => getTrialBalance(ctx, {}));
    expect(tb.rows.every((r) => r.balanceCents === 0)).toBe(true);
    await expect(sys((ctx) => creditInvoice(ctx, inv.id, "again"))).rejects.toThrow(/already/);
  });

  it("supplier payment and manual lettering", async () => {
    const s = await sys((ctx) => createSupplier(ctx, { name: "Parts Ouest" }));
    const pay = await sys((ctx) => recordPayment(ctx, { siteId: org.siteA.id, direction: "OUT", method: "TRANSFER", supplierId: s.id, amountCents: 5_000 }));
    expect(pay.number).toBe("NTE-RG-2026-000001");
    const bill = await sys((ctx) =>
      postEntry(ctx, {
        journalCode: "AC",
        siteId: org.siteA.id,
        entryDate: new Date("2026-03-15"),
        label: "Supplier invoice",
        sourceType: "TEST",
        lines: [
          { account: { code: "602200" }, debitCents: 5_000, creditCents: 0, label: "x", departmentCode: "WORKSHOP" },
          { account: { key: "PAYABLE_SUPPLIER" }, debitCents: 0, creditCents: 5_000, label: "x", partyType: "SUPPLIER", partyId: s.id },
        ],
      }),
    );
    const lines = await db.journalLine.findMany({ where: { accountCode: "401000" } });
    expect(lines).toHaveLength(2);
    const code = await sys((ctx) => letterLines(ctx, lines.map((l) => l.id)));
    expect(code).toBe("A");
    expect(bill.number).toBe("AC-2026-000001");
  });

  it("opening balances post once and balance through 890000", async () => {
    await sys((ctx) =>
      postOpeningBalances(ctx, {
        siteId: org.siteA.id,
        date: new Date("2026-01-01"),
        balances: [
          { account: { key: "STOCK_VN" }, amountCents: 3_000_000, label: "VN stock" },
          { account: { code: "512100" }, amountCents: 500_000, label: "Bank" },
        ],
      }),
    );
    const tb = await sys((ctx) => getTrialBalance(ctx, {}));
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.accountCode === "890000")?.balanceCents).toBe(-3_500_000);
    await expect(sys((ctx) => postOpeningBalances(ctx, { siteId: org.siteA.id, date: new Date("2026-01-01"), balances: [] }))).rejects.toThrow(DomainError);
  });

  it("enforces site-scoped permissions", async () => {
    const advisor = await makeActor("SERVICE_ADVISOR", org.siteA.id);
    await runCommand({ actor: advisor, siteId: org.siteA.id, businessDate: new Date("2026-03-15") }, (ctx) => createInvoice(ctx, workshopInvoice()));
    await expect(
      runCommand({ actor: advisor, siteId: org.siteB.id, businessDate: new Date("2026-03-15") }, (ctx) => createInvoice(ctx, { ...workshopInvoice(), siteId: org.siteB.id })),
    ).rejects.toThrow(ForbiddenError);
    await expect(runCommand({ actor: advisor, siteId: org.siteA.id }, (ctx) => postManualEntry(ctx, od(org.siteA.id)))).rejects.toThrow(ForbiddenError);
  });
});
