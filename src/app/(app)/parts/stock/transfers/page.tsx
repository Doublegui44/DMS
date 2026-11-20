import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listTransfers } from "@/modules/parts";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Stock transfers" };

export default async function TransfersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("parts");
  const { actor, sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "transferredOn", dir: "desc" });
  const data = await query((ctx) => listTransfers(ctx, p), { resource: "parts.stock", action: "view" });
  const rows: Row[] = data.rows.map((r) => ({
    id: r.id,
    number: { kind: "link", href: `/parts/stock/transfers/${r.id}`, label: r.number },
    transferredOn: { kind: "date", iso: isoDate(r.transferredOn) },
    from: r.fromSite.code,
    to: r.toSite.code,
    lines: r._count.lines,
    valueCents: { kind: "money", cents: r.valueCents },
    notes: r.notes,
  }));
  const canTransfer = sites.some((s) => can(actor.permissions, "parts.stock", "edit", s.id));
  return (
    <div>
      <PageHeader
        title={t("transfers")}
        subtitle={t("transfersHint")}
        backHref="/parts/stock"
        actions={
          canTransfer && (
            <Button asChild size="sm">
              <Link href="/parts/stock/transfers/new">
                <Plus /> {t("newTransfer")}
              </Link>
            </Button>
          )
        }
      />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        columns={[
          { key: "number", header: t("number"), sortable: true },
          { key: "transferredOn", header: t("date"), sortable: true },
          { key: "from", header: t("fromSite") },
          { key: "to", header: t("toSite") },
          { key: "lines", header: t("lines"), align: "right" },
          { key: "valueCents", header: t("value"), align: "right", sortable: true },
          { key: "notes", header: t("notes") },
        ]}
        filters={[{ key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) }]}
      />
    </div>
  );
}
