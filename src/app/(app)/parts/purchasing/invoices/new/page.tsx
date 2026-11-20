import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { formatDate, isoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getInvoiceableReceipts, getSupplierInvoiceFormData } from "@/modules/parts";
import { PageHeader, Section } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { TableForm } from "../../../table-form";
import { recordSupplierInvoiceAction } from "../../../actions";
import { centsToInput, fmtQty, qtyInput } from "../../../format";

export const metadata = { title: "New supplier invoice" };

/** Step 1 (GET form): site and supplier. Step 2: tick the receipt lines the invoice bills, at the supplier's prices. */
export default async function NewSupplierInvoicePage({ searchParams }: { searchParams: Promise<{ site?: string; supplier?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations("parts");
  const { siteId: activeSite, sites } = await getRequestContext();
  const siteId = sp.site || activeSite || sites[0]?.id || "";
  const form = await query((ctx) => getSupplierInvoiceFormData(ctx, siteId), { resource: "parts.purchase_order", action: "create" });
  const supplierId = sp.supplier && form.suppliers.some((s) => s.value === sp.supplier) ? sp.supplier : "";
  const lines = supplierId ? await query((ctx) => getInvoiceableReceipts(ctx, siteId, supplierId)) : [];
  const today = isoDate(await query(async (ctx) => ctx.businessDate));
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title={t("newSupplierInvoice")} subtitle={t("newSupplierInvoiceHint")} backHref="/parts/purchasing/invoices" />
      <Section>
        <form method="get" className="flex flex-wrap items-end gap-3 text-[13px]">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t("site")}</span>
            <select name="site" defaultValue={siteId} className="h-8 rounded-md border bg-background px-2" data-testid="si-site">
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t("supplier")}</span>
            <select name="supplier" defaultValue={supplierId} className="h-8 min-w-60 rounded-md border bg-background px-2" data-testid="si-supplier">
              <option value="">—</option>
              {form.suppliers.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" variant="outline" data-testid="si-load">
            {t("showReceipts")}
          </Button>
        </form>
      </Section>

      {supplierId && (
        <Section title={t("receiptLinesToBill")}>
          <TableForm
            action={recordSupplierInvoiceAction}
            submitLabel={t("recordInvoice")}
            fields={[
              { name: "siteId", label: "", type: "hidden", defaultValue: siteId },
              { name: "supplierId", label: "", type: "hidden", defaultValue: supplierId },
              { name: "supplierReference", label: t("supplierReference"), testId: "si-reference" },
              { name: "invoiceDate", label: t("invoiceDate"), type: "date", defaultValue: today, testId: "si-date" },
              { name: "notes", label: t("notes"), placeholder: t("optional") },
            ]}
            checkHeader=""
            headers={[t("receipt"), t("date"), t("order"), t("partNumber"), t("description"), t("toBill"), t("receiptCost")]}
            rightAligned={[5, 6]}
            inputHeaders={[t("qty"), t("invoicedPrice")]}
            empty={t("nothingToBill")}
            rows={lines.map((l) => ({
              id: l.id,
              check: { name: "bill", defaultChecked: true, testId: `bill-${l.poLine.part.partNumber}` },
              cells: [l.receipt.number, formatDate(l.receipt.receivedOn), l.receipt.purchaseOrder.number, l.poLine.part.partNumber, l.poLine.part.description, fmtQty(l.remaining), formatMoney(l.unitCostCents)],
              inputs: [
                { name: "qty", defaultValue: qtyInput(l.remaining), testId: `bill-qty-${l.poLine.part.partNumber}` },
                { name: "price", defaultValue: centsToInput(l.unitCostCents), testId: `bill-price-${l.poLine.part.partNumber}` },
              ],
            }))}
          />
        </Section>
      )}
    </div>
  );
}
