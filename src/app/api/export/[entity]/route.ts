import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/session";
import { parseListParams } from "@/lib/list";
import { centsToCsv, toCsv } from "@/lib/csv";
import { DomainError } from "@/lib/errors";
import { listCustomers, listVehicles } from "@/modules/core";
import { listAuditLog, listUsers } from "@/modules/admin";
import { listAccounts, listEntries, listInvoices, listPayments } from "@/modules/accounting";
import { isoDate } from "@/lib/dates";

type Exporter = (sp: Record<string, string>) => Promise<{ rows: Record<string, unknown>[]; columns: { key: string; header: string }[] }>;

/** CSV export for every list view; reuses the list query without pagination. */
const EXPORTERS: Record<string, Exporter> = {
  async customers(sp) {
    const { rows } = await query((ctx) => listCustomers(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((c) => ({ ...c, homeSite: c.homeSite?.code })),
      columns: [
        { key: "number", header: "Number" },
        { key: "kind", header: "Type" },
        { key: "displayName", header: "Name" },
        { key: "siren", header: "SIREN" },
        { key: "vatNumber", header: "VAT number" },
        { key: "email", header: "Email" },
        { key: "phone", header: "Phone" },
        { key: "address", header: "Address" },
        { key: "postalCode", header: "Postal code" },
        { key: "city", header: "City" },
        { key: "priceClass", header: "Price class" },
        { key: "accountCode", header: "Account" },
        { key: "homeSite", header: "Site" },
        { key: "consentEmail", header: "Consent email" },
        { key: "consentSms", header: "Consent SMS" },
      ],
    };
  },
  async vehicles(sp) {
    const { rows } = await query((ctx) => listVehicles(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((v) => ({
        ...v,
        site: v.site?.code,
        owner: v.owner?.displayName,
        listPrice: centsToCsv(v.listPriceCents),
        stockValue: centsToCsv(v.stockValueCents),
      })),
      columns: [
        { key: "vin", header: "VIN" },
        { key: "registration", header: "Registration" },
        { key: "make", header: "Make" },
        { key: "model", header: "Model" },
        { key: "version", header: "Version" },
        { key: "fuel", header: "Fuel" },
        { key: "mileage", header: "Mileage" },
        { key: "stockType", header: "Stock" },
        { key: "status", header: "Status" },
        { key: "site", header: "Site" },
        { key: "owner", header: "Owner" },
        { key: "listPrice", header: "Price incl. VAT" },
        { key: "stockValue", header: "Stock value" },
        { key: "stockInDate", header: "In stock since" },
        { key: "vatRegime", header: "VAT regime" },
      ],
    };
  },
  async users(sp) {
    const { rows } = await query((ctx) => listUsers(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((u) => ({ ...u, roles: u.roles.map((r) => `${r.role.name}@${r.site?.code ?? "ALL"}`).join(", ") })),
      columns: [
        { key: "email", header: "Email" },
        { key: "firstName", header: "First name" },
        { key: "lastName", header: "Last name" },
        { key: "roles", header: "Roles" },
        { key: "active", header: "Active" },
      ],
    };
  },
  async entries(sp) {
    const { rows } = await query((ctx) => listEntries(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((e) => ({ ...e, entryDate: isoDate(e.entryDate), site: e.site.code, total: centsToCsv(e.totalCents), reversedBy: e.reversedBy?.number })),
      columns: [
        { key: "number", header: "Number" },
        { key: "entryDate", header: "Date" },
        { key: "journalCode", header: "Journal" },
        { key: "label", header: "Label" },
        { key: "sourceType", header: "Source" },
        { key: "site", header: "Site" },
        { key: "total", header: "Total" },
        { key: "reversedBy", header: "Reversed by" },
      ],
    };
  },
  async invoices(sp) {
    const { rows } = await query((ctx) => listInvoices(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((i) => ({
        ...i,
        issueDate: i.issueDate ? isoDate(i.issueDate) : "",
        dueDate: i.dueDate ? isoDate(i.dueDate) : "",
        customer: i.customer.displayName,
        customerNumber: i.customer.number,
        site: i.site.code,
        excl: centsToCsv(i.totalExclVatCents),
        vat: centsToCsv(i.vatCents),
        incl: centsToCsv(i.totalInclVatCents),
        paid: centsToCsv(i.paidCents),
      })),
      columns: [
        { key: "number", header: "Number" },
        { key: "kind", header: "Type" },
        { key: "status", header: "Status" },
        { key: "issueDate", header: "Issue date" },
        { key: "dueDate", header: "Due date" },
        { key: "customerNumber", header: "Customer no." },
        { key: "customer", header: "Customer" },
        { key: "excl", header: "Total excl. VAT" },
        { key: "vat", header: "VAT" },
        { key: "incl", header: "Total incl. VAT" },
        { key: "paid", header: "Paid" },
        { key: "sourceType", header: "Source" },
        { key: "site", header: "Site" },
      ],
    };
  },
  async payments(sp) {
    const { rows } = await query((ctx) => listPayments(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((x) => ({
        ...x,
        businessDate: isoDate(x.businessDate),
        party: x.customer?.displayName ?? x.supplier?.name,
        site: x.site.code,
        amount: centsToCsv(x.amountCents),
        allocated: centsToCsv(x.allocatedCents),
      })),
      columns: [
        { key: "number", header: "Number" },
        { key: "businessDate", header: "Date" },
        { key: "direction", header: "Direction" },
        { key: "method", header: "Method" },
        { key: "party", header: "Party" },
        { key: "reference", header: "Reference" },
        { key: "amount", header: "Amount" },
        { key: "allocated", header: "Allocated" },
        { key: "site", header: "Site" },
      ],
    };
  },
  async accounts(sp) {
    const { rows } = await query((ctx) => listAccounts(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((a) => ({ ...a, balance: centsToCsv(a.balanceCents) })),
      columns: [
        { key: "code", header: "Code" },
        { key: "label", header: "Label" },
        { key: "class", header: "Class" },
        { key: "type", header: "Type" },
        { key: "postable", header: "Postable" },
        { key: "requiresAnalytic", header: "Analytic" },
        { key: "balance", header: "Balance" },
      ],
    };
  },
  async audit(sp) {
    const { rows } = await query((ctx) => listAuditLog(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((a) => ({
        ...a,
        at: a.at.toISOString(),
        user: a.user ? `${a.user.firstName} ${a.user.lastName}` : "System",
        site: a.site?.code,
      })),
      columns: [
        { key: "at", header: "At" },
        { key: "businessDate", header: "Business date" },
        { key: "user", header: "User" },
        { key: "site", header: "Site" },
        { key: "action", header: "Action" },
        { key: "entityType", header: "Entity" },
        { key: "entityId", header: "Entity id" },
      ],
    };
  },
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  const exporter = EXPORTERS[entity];
  if (!exporter) return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  try {
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    delete sp.page;
    const { rows, columns } = await exporter(sp);
    return new NextResponse(toCsv(rows, columns), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${entity}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof DomainError && err.code === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }
}
