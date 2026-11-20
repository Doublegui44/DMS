import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftRight, Hourglass, ListOrdered } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { getPartFormData, listStockItems } from "@/modules/parts";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { fmtQty, pmpCents } from "../format";

export const metadata = { title: "Parts stock" };

export default async function PartsStockPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("parts");
  const { sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "partNumber", dir: "asc" });
  const [data, form] = await Promise.all([query((ctx) => listStockItems(ctx, p), { resource: "parts.stock", action: "view" }), query((ctx) => getPartFormData(ctx))]);
  const rows: Row[] = data.rows.map((r) => ({
    id: r.id,
    partNumber: { kind: "link", href: `/parts/stock/${r.id}`, label: r.part.partNumber },
    description: r.part.description,
    site: r.site.code,
    bin: { kind: "mono", value: r.bin },
    qtyOnHand: fmtQty(r.qtyOnHand),
    reserved: Number(r.qtyReserved) ? fmtQty(r.qtyReserved) : null,
    available: r.belowMin ? { kind: "badge", status: "warning", label: fmtQty(r.available), tone: "amber" } : fmtQty(r.available),
    levels: Number(r.minQty) || Number(r.maxQty) ? `${fmtQty(r.minQty)} / ${fmtQty(r.maxQty)}` : null,
    pmpCents: { kind: "money", cents: pmpCents(r.pmpCents) },
    valueCents: { kind: "money", cents: r.valueCents },
    lastMovementOn: { kind: "date", iso: r.lastMovementOn ? isoDate(r.lastMovementOn) : null },
  }));
  return (
    <div>
      <PageHeader
        title={t("stock")}
        subtitle={t("stockHint", { value: formatMoney(data.valueCents, { decimals: false }), count: data.total })}
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/parts/stock/movements">
                <ListOrdered /> {t("movements")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/parts/stock/transfers">
                <ArrowLeftRight /> {t("transfers")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/parts/stock/obsolete">
                <Hourglass /> {t("obsolete")}
              </Link>
            </Button>
          </>
        }
      />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        exportHref="/api/export/parts-stock"
        columns={[
          { key: "partNumber", header: t("partNumber"), sortable: true },
          { key: "description", header: t("description") },
          { key: "site", header: t("site") },
          { key: "bin", header: t("bin"), sortable: true },
          { key: "qtyOnHand", header: t("onHand"), align: "right", sortable: true },
          { key: "reserved", header: t("reserved"), align: "right" },
          { key: "available", header: t("available"), align: "right" },
          { key: "levels", header: t("minMax"), align: "right" },
          { key: "pmpCents", header: t("pmp"), align: "right", sortable: true },
          { key: "valueCents", header: t("value"), align: "right", sortable: true },
          { key: "lastMovementOn", header: t("lastMovement"), sortable: true },
        ]}
        filters={[
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
          { key: "family", label: t("family"), options: form.families.map((f) => ({ value: f, label: f })) },
          { key: "belowMin", label: t("replenishment"), options: [{ value: "1", label: t("belowMinOnly") }] },
          { key: "obsolete", label: t("obsolescence"), options: [{ value: "1", label: t("obsoleteOnly") }] },
          { key: "held", label: t("held"), options: [{ value: "all", label: t("includeEmpty") }] },
        ]}
      />
    </div>
  );
}
