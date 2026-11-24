import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listMovements } from "@/modules/parts";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { fmtQty, pmpCents } from "../../format";
import { sourceHref } from "../source-link";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("partsMovements");

const KINDS = ["OPENING", "RECEIPT", "COUNTER_SALE", "TRANSFER_OUT", "TRANSFER_IN", "ADJUSTMENT", "ISSUE_RO"] as const;

export default async function MovementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("parts");
  const { sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "createdAt", dir: "desc" });
  const data = await query((ctx) => listMovements(ctx, p), { resource: "parts.stock", action: "view" });
  const rows: Row[] = data.rows.map((m) => {
    const href = sourceHref(m.sourceType, m.sourceId);
    return {
      id: m.id,
      businessDate: { kind: "date", iso: isoDate(m.businessDate) },
      kind: { kind: "badge", status: m.kind, label: t(`movementKinds.${m.kind}`) },
      part: { kind: "link", href: `/parts/stock/${m.stockItem.id}`, label: m.stockItem.part.partNumber, sub: m.stockItem.part.description },
      site: m.stockItem.site.code,
      reference: href && m.reference ? { kind: "link", href, label: m.reference } : m.reference,
      qty: fmtQty(m.qty),
      unitCost: { kind: "money", cents: pmpCents(m.unitCostCents) },
      valueCents: { kind: "money", cents: m.valueCents },
      qtyAfter: fmtQty(m.qtyAfter),
    };
  });
  return (
    <div>
      <PageHeader title={t("movements")} subtitle={t("movementsHint")} backHref="/parts/stock" />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        exportHref="/api/export/parts-movements"
        columns={[
          { key: "businessDate", header: t("date"), sortable: true },
          { key: "kind", header: t("movement") },
          { key: "part", header: t("partNumber") },
          { key: "site", header: t("site") },
          { key: "reference", header: t("reference") },
          { key: "qty", header: t("qty"), align: "right" },
          { key: "unitCost", header: t("unitCost"), align: "right" },
          { key: "valueCents", header: t("value"), align: "right", sortable: true },
          { key: "qtyAfter", header: t("qtyAfter"), align: "right" },
        ]}
        filters={[
          { key: "kind", label: t("movement"), options: KINDS.map((k) => ({ value: k, label: t(`movementKinds.${k}`) })) },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
