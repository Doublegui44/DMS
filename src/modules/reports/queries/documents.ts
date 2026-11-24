import { formatKm } from "@/lib/format-locale";
import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { getSetting } from "@/modules/core";
import { getInvoice } from "@/modules/accounting";
import { getOrder } from "@/modules/sales";
import { getRepairOrder, getWarrantyClaim } from "@/modules/workshop";
import {
  addressLines,
  hoursQty,
  invoiceBody,
  NO_MENTIONS,
  qtyText,
  vatBreakdown,
  type DocumentKind,
  type LegalMentions,
  type PrintDoc,
  type PrintField,
  type PrintLine,
  type PrintParty,
  type PrintSection,
} from "../domain/documents";

type SiteLike = { id: string; name: string; address: string; postalCode: string; city: string; phone: string | null; siret: string | null };
type CustomerLike = { number: string; displayName: string; address: string | null; postalCode: string | null; city: string | null; vatNumber: string | null };

/** Builds the printable form of a document. Permissions are those of the document's own screen. */
export async function getPrintableDocument(ctx: ServiceContext, kind: DocumentKind, id: string): Promise<PrintDoc> {
  switch (kind) {
    case "invoice":
      return invoiceDoc(ctx, id);
    case "order":
      return orderDoc(ctx, id);
    case "repair-order":
      return repairOrderDoc(ctx, id);
    case "warranty-claim":
      return warrantyClaimDoc(ctx, id);
    default:
      throw new NotFoundError("Document", kind);
  }
}

async function letterhead(ctx: ServiceContext, site: SiteLike) {
  const group = await ctx.tx.group.findFirstOrThrow();
  const mentions = await getSetting<LegalMentions>(ctx.tx, "documents.legalMentions", site.id, NO_MENTIONS);
  const marginMention = await getSetting<string>(ctx.tx, "accounting.marginSchemeMention", site.id, "");
  const ids: { key: string; value: string }[] = [];
  if (site.siret) ids.push({ key: "siret", value: site.siret });
  if (group.siren) ids.push({ key: "siren", value: group.siren });
  if (group.vatNumber) ids.push({ key: "vatNumber", value: group.vatNumber });
  const issuer: PrintParty = { name: group.legalName, lines: [site.name, ...addressLines(site), ...(site.phone ? [site.phone] : [])], ids };
  return { issuer, mentions, marginMention };
}

function recipient(c: CustomerLike): PrintParty {
  const ids = [{ key: "customerNumber", value: c.number }];
  if (c.vatNumber) ids.push({ key: "vatNumber", value: c.vatNumber });
  return { name: c.displayName, lines: addressLines(c), ids };
}

const vehicleText = (v: { make: string; model: string; version: string }) => `${v.make} ${v.model} ${v.version}`.trim();

async function invoiceDoc(ctx: ServiceContext, id: string): Promise<PrintDoc> {
  const inv = await getInvoice(ctx, id);
  const { issuer, mentions, marginMention } = await letterhead(ctx, inv.site);
  const body = invoiceBody(inv.lines, inv.totalInclVatCents, inv.paidCents);
  const credit = inv.kind === "CREDIT_NOTE";
  const fields: PrintField[] = [
    { key: "issueDate", date: inv.issueDate },
    ...(credit ? [] : [{ key: "dueDate", date: inv.dueDate }]),
    ...(inv.creditedInvoice ? [{ key: "creditedInvoice", text: inv.creditedInvoice.number ?? "—" }] : []),
  ];
  return {
    kind: "invoice",
    title: credit ? "creditNote" : "invoice",
    number: inv.number ?? "DRAFT",
    date: inv.issueDate,
    issuer,
    recipient: recipient(inv.customer),
    fields,
    amounts: "excl",
    sections: [{ lines: body.lines }],
    totals: body.totals,
    vat: body.vat,
    notes: inv.notes ? [inv.notes] : [],
    signatures: [],
    mentions: [...(body.hasMargin && marginMention ? [marginMention] : []), ...(credit ? [] : mentions.invoice)],
  };
}

async function orderDoc(ctx: ServiceContext, id: string): Promise<PrintDoc> {
  const o = await getOrder(ctx, id);
  const { issuer, mentions, marginMention } = await letterhead(ctx, o.site);
  const v = o.vehicle;
  const q = o.quote;
  const lines: PrintLine[] = q.lines.map((l) => ({
    label: l.label,
    qty: String(l.quantity),
    vatRateBp: l.vatMode === "STANDARD" ? l.vatRateBp : null,
    amountCents: l.lineInclVatCents,
  }));
  const margin = q.lines.some((l) => l.vatMode === "MARGIN");
  const fields: PrintField[] = [
    { key: "orderDate", date: o.orderDate },
    { key: "quote", text: q.number },
    { key: "vehicle", text: vehicleText(v) },
    { key: "vin", text: v.vin },
    ...(v.registration ? [{ key: "registration", text: v.registration }] : []),
    ...(v.colour ? [{ key: "colour", text: v.colour }] : []),
    ...(o.expectedDeliveryDate ? [{ key: "expectedDelivery", date: o.expectedDeliveryDate }] : []),
    ...(o.salesperson ? [{ key: "salesperson", text: `${o.salesperson.firstName} ${o.salesperson.lastName}` }] : []),
  ];
  const notes: string[] = [];
  if (q.tradeIn) notes.push(`${vehicleText(q.tradeIn)} · ${q.tradeIn.registration ?? q.tradeIn.vin} · ${formatKm(q.tradeIn.mileage)}`);
  if (q.financing) notes.push(`${q.financing.lender} · ${q.financing.months} × ${(q.financing.monthlyPaymentCents / 100).toFixed(2)}`);
  if (q.notes) notes.push(q.notes);
  return {
    kind: "order",
    title: "orderForm",
    number: o.number,
    date: o.orderDate,
    issuer,
    recipient: recipient(o.customer),
    fields,
    amounts: "incl",
    sections: [{ lines }],
    totals: [
      { key: "totalInclVat", cents: o.totalInclVatCents, strong: true },
      { key: "ofWhichVat", cents: q.vatCents },
      ...(o.tradeInCents ? [{ key: "tradeIn", cents: -o.tradeInCents }] : []),
      ...(o.financedCents ? [{ key: "financed", cents: -o.financedCents }] : []),
      { key: "balanceAtDelivery", cents: q.balanceDueCents, strong: true },
    ],
    vat: vatBreakdown(q.lines.filter((l) => l.vatMode === "STANDARD").map((l) => ({ vatRateBp: l.vatRateBp, baseCents: l.lineExclVatCents, vatCents: l.vatCents }))),
    notes,
    signatures: [{ key: "customer" }, { key: "dealer" }],
    mentions: [...(margin && marginMention ? [marginMention] : []), ...mentions.orderForm],
  };
}

async function repairOrderDoc(ctx: ServiceContext, id: string): Promise<PrintDoc> {
  const { ro, jobs, invoices } = await getRepairOrder(ctx, id);
  const { issuer, mentions } = await letterhead(ctx, ro.site);
  const sections: PrintSection[] = jobs.map((j) => ({
    title: `${j.lineNo}. ${j.description}`,
    badge: j.payer,
    note: j.payerCustomer?.displayName,
    lines: [
      ...j.labourLines.map((l) => ({ label: l.label, detail: l.operation?.code, qty: hoursQty(l.billedCentiHours), unitCents: l.rateCents, discountBp: l.discountBp || undefined, amountCents: l.amountCents })),
      ...j.partLines.map((l) => ({ label: l.part.description, detail: l.part.partNumber, qty: qtyText(l.qty), unitCents: l.unitPriceCents, discountBp: l.discountBp || undefined, amountCents: l.amountCents })),
      ...j.subletLines.map((l) => ({ label: l.label, qty: "1", unitCents: l.priceCents, amountCents: l.priceCents })),
    ],
    subtotalCents: j.totalCents,
  }));
  const v = ro.vehicle;
  const fields: PrintField[] = [
    { key: "openedOn", date: ro.openedOn },
    ...(ro.promisedOn ? [{ key: "promisedOn", date: ro.promisedOn }] : []),
    { key: "vehicle", text: vehicleText(v) },
    { key: "vin", text: v.vin },
    ...(v.registration ? [{ key: "registration", text: v.registration }] : []),
    { key: "mileageIn", text: formatKm(ro.mileageIn) },
    { key: "fuelLevel", text: `${ro.fuelLevelPct} %` },
    ...(ro.advisor ? [{ key: "advisor", text: `${ro.advisor.firstName} ${ro.advisor.lastName}` }] : []),
  ];
  const notes: string[] = [];
  if (invoices.length) notes.push(invoices.map((i) => `${i.number ?? "—"} (${i.customer.displayName})`).join(" · "));
  if (ro.notes) notes.push(ro.notes);
  const customer = ro.customer;
  return {
    kind: "repair-order",
    title: "repairOrder",
    number: ro.number,
    date: ro.openedOn,
    issuer,
    recipient: customer ? recipient(customer) : { name: ro.site.name, lines: [] },
    fields,
    amounts: "excl",
    sections,
    totals: [{ key: "estimateExclVat", cents: jobs.reduce((s, j) => s + j.totalCents, 0), strong: true }],
    vat: [],
    notes,
    signatures: [{ key: "customer", name: ro.signedBy }, { key: "advisor", name: ro.advisor ? `${ro.advisor.firstName} ${ro.advisor.lastName}` : null }],
    mentions: mentions.repairOrder,
  };
}

async function warrantyClaimDoc(ctx: ServiceContext, id: string): Promise<PrintDoc> {
  const c = await getWarrantyClaim(ctx, id);
  const { issuer, mentions } = await letterhead(ctx, c.site);
  const body = invoiceBody(c.invoice.lines, c.invoice.totalInclVatCents, 0);
  const v = c.ro.vehicle;
  const fields: PrintField[] = [
    { key: "submittedOn", date: c.submittedOn },
    { key: "brand", text: c.brand.name },
    { key: "repairOrder", text: c.ro.number },
    { key: "invoice", text: c.invoice.number ?? "—" },
    { key: "vehicle", text: vehicleText(v) },
    { key: "vin", text: v.vin },
    ...(v.firstRegistration ? [{ key: "firstRegistration", date: v.firstRegistration }] : []),
    { key: "mileageIn", text: formatKm(c.ro.mileageIn) },
    { key: "status", text: c.status },
    ...(c.job.technician ? [{ key: "technician", text: `${c.job.technician.firstName} ${c.job.technician.lastName}` }] : []),
  ];
  return {
    kind: "warranty-claim",
    title: "warrantyClaim",
    number: c.number,
    date: c.submittedOn,
    issuer,
    recipient: recipient(c.invoice.customer),
    fields,
    amounts: "excl",
    sections: [{ title: c.job.description, lines: body.lines }],
    totals: [{ key: "claimed", cents: c.claimedCents, strong: true }, ...body.totals.filter((t) => t.key !== "totalExclVat")],
    vat: body.vat,
    notes: c.notes ? [c.notes] : [],
    signatures: [],
    mentions: mentions.warrantyClaim,
  };
}
