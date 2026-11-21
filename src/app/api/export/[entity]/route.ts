import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/session";
import { parseListParams } from "@/lib/list";
import { centsToCsv, toCsv } from "@/lib/csv";
import { DomainError } from "@/lib/errors";
import { listCustomers, listVehicles } from "@/modules/core";
import { listAuditLog, listUsers } from "@/modules/admin";
import { AGEING_BUCKETS, getPayablesAgeing, getReceivablesAgeing, listAccounts, listEntries, listInvoices, listPayments } from "@/modules/accounting";
import { listLeads, listOrders, listPoliceRegister, listVnStock, listVoStock } from "@/modules/sales";
import { listCounterSales, listMovements, listObsoleteStock, listParts, listPurchaseOrders, listStockItems, listSupplierInvoices } from "@/modules/parts";
import { listLabourOperations, listRepairOrders, listWarrantyClaims } from "@/modules/workshop";
import { isoDate } from "@/lib/dates";

type Exporter = (sp: Record<string, string>) => Promise<{ rows: Record<string, unknown>[]; columns: { key: string; header: string }[] }>;

function ageingCsv(data: Awaited<ReturnType<typeof getReceivablesAgeing>>) {
  return {
    rows: data.rows.map((r) => ({
      accountCode: r.accountCode,
      name: r.name,
      ...Object.fromEntries(AGEING_BUCKETS.map((b) => [b, centsToCsv(r[b])])),
      total: centsToCsv(r.totalCents),
      unapplied: centsToCsv(r.unappliedCents),
      balance: centsToCsv(r.balanceCents),
    })),
    columns: [
      { key: "accountCode", header: "Account" },
      { key: "name", header: "Name" },
      { key: "current", header: "Not due" },
      { key: "d1_30", header: "1-30 days" },
      { key: "d31_60", header: "31-60 days" },
      { key: "d61_90", header: "61-90 days" },
      { key: "d90plus", header: "Over 90 days" },
      { key: "total", header: "Open documents" },
      { key: "unapplied", header: "Unapplied" },
      { key: "balance", header: "Balance" },
    ],
  };
}

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
  async leads(sp) {
    const { rows } = await query((ctx) => listLeads(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((l) => ({
        number: l.leadNumber,
        openedOn: isoDate(l.openedOn),
        customer: l.customer.name,
        interest: l.interest,
        source: l.source,
        vehicle: l.vehicle,
        stage: l.stage,
        quote: l.quote?.number,
        order: l.order?.number,
        amount: centsToCsv(l.order?.totalInclVatCents ?? l.quote?.totalInclVatCents ?? null),
        salesperson: l.salesperson,
        site: l.site,
      })),
      columns: [
        { key: "number", header: "Lead" },
        { key: "openedOn", header: "Opened on" },
        { key: "customer", header: "Customer" },
        { key: "interest", header: "Interest" },
        { key: "source", header: "Source" },
        { key: "vehicle", header: "Vehicle" },
        { key: "stage", header: "Stage" },
        { key: "quote", header: "Quote" },
        { key: "order", header: "Order" },
        { key: "amount", header: "Amount incl. VAT" },
        { key: "salesperson", header: "Salesperson" },
        { key: "site", header: "Site" },
      ],
    };
  },
  async orders(sp) {
    const { rows } = await query((ctx) => listOrders(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((o) => ({
        number: o.number,
        orderDate: isoDate(o.orderDate),
        status: o.status,
        stockType: o.stockType,
        customer: o.customer.displayName,
        vehicle: `${o.vehicle.make} ${o.vehicle.model} ${o.vehicle.version}`,
        vin: o.vehicle.vin,
        total: centsToCsv(o.totalInclVatCents),
        tradeIn: centsToCsv(o.tradeInCents),
        financed: centsToCsv(o.financedCents),
        frontEnd: centsToCsv(o.frontEndMarginCents),
        backEnd: centsToCsv(o.backEndMarginCents),
        invoice: o.invoice?.number,
        expected: o.expectedDeliveryDate ? isoDate(o.expectedDeliveryDate) : "",
        delivered: o.deliveredOn ? isoDate(o.deliveredOn) : "",
        salesperson: o.salesperson ? `${o.salesperson.firstName} ${o.salesperson.lastName}` : "",
        site: o.site.code,
      })),
      columns: [
        { key: "number", header: "Order" },
        { key: "orderDate", header: "Date" },
        { key: "status", header: "Status" },
        { key: "stockType", header: "Type" },
        { key: "customer", header: "Customer" },
        { key: "vehicle", header: "Vehicle" },
        { key: "vin", header: "VIN" },
        { key: "total", header: "Total incl. VAT" },
        { key: "tradeIn", header: "Trade-in" },
        { key: "financed", header: "Financed" },
        { key: "frontEnd", header: "Front-end margin" },
        { key: "backEnd", header: "Back-end margin" },
        { key: "invoice", header: "Invoice" },
        { key: "expected", header: "Expected delivery" },
        { key: "delivered", header: "Delivered on" },
        { key: "salesperson", header: "Salesperson" },
        { key: "site", header: "Site" },
      ],
    };
  },
  async "vn-stock"(sp) {
    const { rows } = await query((ctx) => listVnStock(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((v) => ({
        vin: v.vin,
        make: v.make,
        model: v.model,
        version: v.version,
        colour: v.colour,
        status: v.status,
        factoryOrder: v.factoryOrder?.number,
        eta: v.factoryOrder && !v.stockInDate ? isoDate(v.factoryOrder.expectedOn) : "",
        stockInDate: v.stockInDate ? isoDate(v.stockInDate) : "",
        days: v.daysInStock,
        listPrice: centsToCsv(v.listPriceCents),
        stockValue: v.stockInDate ? centsToCsv(v.stockValueCents) : "",
        customer: v.salesOrders[0]?.customer.displayName ?? v.reservations[0]?.customer.displayName,
        site: v.site?.code,
      })),
      columns: [
        { key: "vin", header: "VIN" },
        { key: "make", header: "Make" },
        { key: "model", header: "Model" },
        { key: "version", header: "Version" },
        { key: "colour", header: "Colour" },
        { key: "status", header: "Status" },
        { key: "factoryOrder", header: "Factory order" },
        { key: "eta", header: "ETA" },
        { key: "stockInDate", header: "In stock since" },
        { key: "days", header: "Days in stock" },
        { key: "listPrice", header: "Price incl. VAT" },
        { key: "stockValue", header: "Stock value" },
        { key: "customer", header: "Customer" },
        { key: "site", header: "Site" },
      ],
    };
  },
  async "vo-stock"(sp) {
    const { rows } = await query((ctx) => listVoStock(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((v) => ({
        vin: v.vin,
        registration: v.registration,
        make: v.make,
        model: v.model,
        version: v.version,
        mileage: v.mileage,
        status: v.status,
        vatRegime: v.vatRegime,
        stockInDate: v.stockInDate ? isoDate(v.stockInDate) : "",
        days: v.daysInStock,
        ageing: v.ageing,
        purchase: centsToCsv(v.purchasePriceCents),
        stockValue: centsToCsv(v.stockValueCents),
        listPrice: centsToCsv(v.listPriceCents),
        margin: centsToCsv(v.expectedMarginCents),
        site: v.site?.code,
      })),
      columns: [
        { key: "vin", header: "VIN" },
        { key: "registration", header: "Registration" },
        { key: "make", header: "Make" },
        { key: "model", header: "Model" },
        { key: "version", header: "Version" },
        { key: "mileage", header: "Mileage" },
        { key: "status", header: "Status" },
        { key: "vatRegime", header: "VAT regime" },
        { key: "stockInDate", header: "In stock since" },
        { key: "days", header: "Days in stock" },
        { key: "ageing", header: "Ageing" },
        { key: "purchase", header: "Purchase price" },
        { key: "stockValue", header: "Stock value" },
        { key: "listPrice", header: "Price incl. VAT" },
        { key: "margin", header: "Expected margin" },
        { key: "site", header: "Site" },
      ],
    };
  },
  async "police-register"(sp) {
    const { rows } = await query((ctx) => listPoliceRegister(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((e) => ({
        number: e.number,
        inDate: isoDate(e.inDate),
        description: e.description,
        vin: e.vin,
        registration: e.registration,
        seller: e.sellerName,
        sellerAddress: e.sellerAddress,
        purchase: centsToCsv(e.purchasePriceCents),
        outDate: e.outDate ? isoDate(e.outDate) : "",
        buyer: e.buyerName,
        buyerAddress: e.buyerAddress,
        sale: centsToCsv(e.salePriceCents),
        saleReference: e.saleReference,
        site: e.site.code,
      })),
      columns: [
        { key: "number", header: "Entry" },
        { key: "inDate", header: "In" },
        { key: "description", header: "Vehicle" },
        { key: "vin", header: "VIN" },
        { key: "registration", header: "Registration" },
        { key: "seller", header: "Seller" },
        { key: "sellerAddress", header: "Seller address" },
        { key: "purchase", header: "Purchase price" },
        { key: "outDate", header: "Out" },
        { key: "buyer", header: "Buyer" },
        { key: "buyerAddress", header: "Buyer address" },
        { key: "sale", header: "Sale price" },
        { key: "saleReference", header: "Sale invoice" },
        { key: "site", header: "Site" },
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
  async parts(sp) {
    const { rows } = await query((ctx) => listParts(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((p) => ({
        ...p,
        brand: p.brand?.name,
        supplier: p.supplier.name,
        discountCode: p.discountCode.code,
        replacedBy: p.replacedBy?.newPart.partNumber,
        retailPrice: centsToCsv(p.retailPriceCents),
        listCost: centsToCsv(p.listCostCents),
        onHandGroup: p.onHandGroup.toString(),
      })),
      columns: [
        { key: "partNumber", header: "Part number" },
        { key: "description", header: "Description" },
        { key: "family", header: "Family" },
        { key: "brand", header: "Brand" },
        { key: "supplier", header: "Supplier" },
        { key: "discountCode", header: "Discount code" },
        { key: "unit", header: "Unit" },
        { key: "retailPrice", header: "Retail price excl. VAT" },
        { key: "listCost", header: "List cost" },
        { key: "onHandGroup", header: "On hand (group)" },
        { key: "replacedBy", header: "Replaced by" },
        { key: "active", header: "Active" },
      ],
    };
  },
  async "parts-stock"(sp) {
    const { rows } = await query((ctx) => listStockItems(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((i) => ({
        site: i.site.code,
        partNumber: i.part.partNumber,
        description: i.part.description,
        family: i.part.family,
        bin: i.bin,
        onHand: i.qtyOnHand.toString(),
        reserved: i.qtyReserved.toString(),
        available: i.available.toString(),
        min: i.minQty.toString(),
        max: i.maxQty.toString(),
        pmp: centsToCsv(Math.round(Number(i.pmpCents))),
        value: centsToCsv(i.valueCents),
        lastMovementOn: i.lastMovementOn ? isoDate(i.lastMovementOn) : "",
      })),
      columns: [
        { key: "site", header: "Site" },
        { key: "partNumber", header: "Part number" },
        { key: "description", header: "Description" },
        { key: "family", header: "Family" },
        { key: "bin", header: "Bin" },
        { key: "onHand", header: "On hand" },
        { key: "reserved", header: "Reserved" },
        { key: "available", header: "Available" },
        { key: "min", header: "Min" },
        { key: "max", header: "Max" },
        { key: "pmp", header: "PMP" },
        { key: "value", header: "Value" },
        { key: "lastMovementOn", header: "Last movement" },
      ],
    };
  },
  async "parts-movements"(sp) {
    const { rows } = await query((ctx) => listMovements(ctx, parseListParams(sp, { sort: "createdAt", dir: "desc" }), { all: true }));
    return {
      rows: rows.map((m) => ({
        businessDate: isoDate(m.businessDate),
        site: m.stockItem.site.code,
        partNumber: m.stockItem.part.partNumber,
        kind: m.kind,
        reference: m.reference,
        qty: m.qty.toString(),
        unitCost: centsToCsv(Math.round(Number(m.unitCostCents))),
        value: centsToCsv(m.valueCents),
        qtyAfter: m.qtyAfter.toString(),
        pmpAfter: centsToCsv(Math.round(Number(m.pmpAfterCents))),
      })),
      columns: [
        { key: "businessDate", header: "Date" },
        { key: "site", header: "Site" },
        { key: "partNumber", header: "Part number" },
        { key: "kind", header: "Movement" },
        { key: "reference", header: "Reference" },
        { key: "qty", header: "Qty" },
        { key: "unitCost", header: "Unit cost" },
        { key: "value", header: "Value" },
        { key: "qtyAfter", header: "Qty after" },
        { key: "pmpAfter", header: "PMP after" },
      ],
    };
  },
  async "parts-obsolete"(sp) {
    const { rows } = await query((ctx) => listObsoleteStock(ctx, parseListParams(sp), { all: true }));
    return {
      rows: rows.map((i) => ({
        site: i.site.code,
        partNumber: i.part.partNumber,
        description: i.part.description,
        family: i.part.family,
        bin: i.bin,
        onHand: i.qtyOnHand.toString(),
        value: centsToCsv(i.valueCents),
        lastMovementOn: i.lastMovementOn ? isoDate(i.lastMovementOn) : "",
      })),
      columns: [
        { key: "site", header: "Site" },
        { key: "partNumber", header: "Part number" },
        { key: "description", header: "Description" },
        { key: "family", header: "Family" },
        { key: "bin", header: "Bin" },
        { key: "onHand", header: "On hand" },
        { key: "value", header: "Value" },
        { key: "lastMovementOn", header: "Last movement" },
      ],
    };
  },
  async "purchase-orders"(sp) {
    const { rows } = await query((ctx) => listPurchaseOrders(ctx, parseListParams(sp, { sort: "createdOn", dir: "desc" }), { all: true }));
    return {
      rows: rows.map((po) => ({
        number: po.number,
        createdOn: isoDate(po.createdOn),
        site: po.site.code,
        supplier: po.supplier.name,
        kind: po.kind,
        status: po.status,
        lines: po.lineCount,
        value: centsToCsv(po.valueCents),
        expectedOn: po.expectedOn ? isoDate(po.expectedOn) : "",
      })),
      columns: [
        { key: "number", header: "Number" },
        { key: "createdOn", header: "Date" },
        { key: "site", header: "Site" },
        { key: "supplier", header: "Supplier" },
        { key: "kind", header: "Kind" },
        { key: "status", header: "Status" },
        { key: "lines", header: "Lines" },
        { key: "value", header: "Value" },
        { key: "expectedOn", header: "Expected" },
      ],
    };
  },
  async "supplier-invoices"(sp) {
    const { rows } = await query((ctx) => listSupplierInvoices(ctx, parseListParams(sp, { sort: "invoiceDate", dir: "desc" }), { all: true }));
    return {
      rows: rows.map((i) => ({
        number: i.number,
        supplierReference: i.supplierReference,
        invoiceDate: isoDate(i.invoiceDate),
        dueDate: isoDate(i.dueDate),
        site: i.site.code,
        supplier: i.supplier.name,
        status: i.status,
        totalExcl: centsToCsv(i.totalExclVatCents),
        vat: centsToCsv(i.vatCents),
        totalIncl: centsToCsv(i.totalInclVatCents),
        variance: centsToCsv(i.varianceCents),
      })),
      columns: [
        { key: "number", header: "Number" },
        { key: "supplierReference", header: "Supplier reference" },
        { key: "invoiceDate", header: "Date" },
        { key: "dueDate", header: "Due" },
        { key: "site", header: "Site" },
        { key: "supplier", header: "Supplier" },
        { key: "status", header: "Status" },
        { key: "totalExcl", header: "Total excl. VAT" },
        { key: "vat", header: "VAT" },
        { key: "totalIncl", header: "Total incl. VAT" },
        { key: "variance", header: "Variance" },
      ],
    };
  },
  async "counter-sales"(sp) {
    const { rows } = await query((ctx) => listCounterSales(ctx, parseListParams(sp, { sort: "createdOn", dir: "desc" }), { all: true }));
    return {
      rows: rows.map((s) => ({
        number: s.number,
        createdOn: isoDate(s.createdOn),
        site: s.site.code,
        customer: s.customer.displayName,
        priceClass: s.priceClass,
        status: s.status,
        lines: s._count.lines,
        totalExcl: centsToCsv(s.totalExclVatCents),
        cost: s.status === "INVOICED" ? centsToCsv(s.costCents) : "",
        invoice: s.invoice?.number,
      })),
      columns: [
        { key: "number", header: "Number" },
        { key: "createdOn", header: "Date" },
        { key: "site", header: "Site" },
        { key: "customer", header: "Customer" },
        { key: "priceClass", header: "Price class" },
        { key: "status", header: "Status" },
        { key: "lines", header: "Lines" },
        { key: "totalExcl", header: "Total excl. VAT" },
        { key: "cost", header: "Cost" },
        { key: "invoice", header: "Invoice" },
      ],
    };
  },
  async "repair-orders"(sp) {
    const { rows } = await query((ctx) => listRepairOrders(ctx, parseListParams(sp, { sort: "openedOn", dir: "desc" }), { all: true }));
    return {
      rows: rows.map((r) => ({
        number: r.number,
        openedOn: isoDate(r.openedOn),
        site: r.site.code,
        kind: r.kind,
        customer: r.customer?.displayName ?? "",
        vehicle: `${r.vehicle.make} ${r.vehicle.model}`,
        registration: r.vehicle.registration ?? r.vehicle.vin,
        status: r.status,
        jobs: r._count.jobs,
        totalExcl: centsToCsv(r.totalExclVatCents),
        invoicedOn: isoDate(r.invoicedOn),
      })),
      columns: [
        { key: "number", header: "Number" },
        { key: "openedOn", header: "Opened" },
        { key: "site", header: "Site" },
        { key: "kind", header: "Kind" },
        { key: "customer", header: "Customer" },
        { key: "vehicle", header: "Vehicle" },
        { key: "registration", header: "Registration" },
        { key: "status", header: "Status" },
        { key: "jobs", header: "Jobs" },
        { key: "totalExcl", header: "Total excl. VAT" },
        { key: "invoicedOn", header: "Invoiced" },
      ],
    };
  },
  async "receivables-ageing"(sp) {
    return ageingCsv(await query((ctx) => getReceivablesAgeing(ctx, parseListParams(sp), { all: true })));
  },
  async "payables-ageing"(sp) {
    return ageingCsv(await query((ctx) => getPayablesAgeing(ctx, parseListParams(sp), { all: true })));
  },
  async "warranty-claims"(sp) {
    const { rows } = await query((ctx) => listWarrantyClaims(ctx, parseListParams(sp, { sort: "submittedOn", dir: "desc" }), { all: true }));
    return {
      rows: rows.map((c) => ({
        number: c.number,
        submittedOn: isoDate(c.submittedOn),
        site: c.site.code,
        brand: c.brand.name,
        ro: c.ro.number,
        job: c.job.description,
        invoice: c.invoice.number,
        claimed: centsToCsv(c.claimedCents),
        status: c.status,
      })),
      columns: [
        { key: "number", header: "Number" },
        { key: "submittedOn", header: "Submitted" },
        { key: "site", header: "Site" },
        { key: "brand", header: "Make" },
        { key: "ro", header: "Repair order" },
        { key: "job", header: "Job" },
        { key: "invoice", header: "Invoice" },
        { key: "claimed", header: "Claimed incl. VAT" },
        { key: "status", header: "Status" },
      ],
    };
  },
  async "labour-operations"(sp) {
    const { rows } = await query((ctx) => listLabourOperations(ctx, parseListParams(sp, { sort: "code", dir: "asc" }), { all: true }));
    return {
      rows: rows.map((o) => ({ code: o.code, label: o.label, category: o.category, brand: o.brand?.name ?? "", hours: (o.standardCentiHours / 100).toFixed(2), active: o.active ? "yes" : "no" })),
      columns: [
        { key: "code", header: "Code" },
        { key: "label", header: "Label" },
        { key: "category", header: "Category" },
        { key: "brand", header: "Make" },
        { key: "hours", header: "Standard hours" },
        { key: "active", header: "Active" },
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
