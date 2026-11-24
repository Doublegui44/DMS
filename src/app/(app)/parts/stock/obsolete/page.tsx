import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { daysBetween, formatDate, isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { getPartFormData, listObsoleteStock } from "@/modules/parts";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { fmtQty, pmpCents } from "../../format";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("obsoleteStock");

export default async function ObsoleteStockPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("parts");
  const { sites } = await getRequestContext();
  const p = parseListParams(sp);
  const [data, form] = await Promise.all([query((ctx) => listObsoleteStock(ctx, p), { resource: "parts.stock", action: "view" }), query((ctx) => getPartFormData(ctx))]);
  const today = data.today;
  const rows: Row[] = data.rows.map((r) => ({
    id: r.id,
    partNumber: { kind: "link", href: `/parts/stock/${r.id}`, label: r.part.partNumber },
    description: r.part.description,
    family: r.part.family,
    site: r.site.code,
    bin: { kind: "mono", value: r.bin },
    qtyOnHand: fmtQty(r.qtyOnHand),
    pmp: { kind: "money", cents: pmpCents(r.pmpCents) },
    valueCents: { kind: "money", cents: r.valueCents },
    lastMovementOn: { kind: "date", iso: r.lastMovementOn ? isoDate(r.lastMovementOn) : null },
    idle: r.lastMovementOn ? t("months", { count: Math.floor(daysBetween(r.lastMovementOn, today) / 30.4) }) : null,
  }));
  return (
    <div>
      <PageHeader
        title={t("obsolete")}
        subtitle={t("obsoleteHint", { months: data.months, date: formatDate(data.before), value: formatMoney(data.valueCents), count: data.total })}
        backHref="/parts/stock"
      />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        exportHref="/api/export/parts-obsolete"
        columns={[
          { key: "partNumber", header: t("partNumber") },
          { key: "description", header: t("description") },
          { key: "family", header: t("family") },
          { key: "site", header: t("site") },
          { key: "bin", header: t("bin") },
          { key: "qtyOnHand", header: t("onHand"), align: "right" },
          { key: "pmp", header: t("pmp"), align: "right" },
          { key: "valueCents", header: t("value"), align: "right" },
          { key: "lastMovementOn", header: t("lastMovement") },
          { key: "idle", header: t("idleFor"), align: "right" },
        ]}
        filters={[
          { key: "months", label: t("noMovementFor"), options: [6, 12, 18, 24].map((m) => ({ value: String(m), label: t("months", { count: m }) })) },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
          { key: "family", label: t("family"), options: form.families.map((f) => ({ value: f, label: f })) },
        ]}
      />
    </div>
  );
}
