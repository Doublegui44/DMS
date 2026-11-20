import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { parseListParams, type SearchParams } from "@/lib/list";
import { isoDate } from "@/lib/dates";
import { listInvoices } from "@/modules/accounting";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = parseListParams(await searchParams, { sort: "createdAt", dir: "desc" });
  const t = await getTranslations("accounting");
  const { actor, sites } = await getRequestContext();
  const data = await query((ctx) => listInvoices(ctx, p), { resource: "accounting.invoice", action: "view" });
  const today = await query(async (ctx) => ctx.businessDate);

  const rows: Row[] = data.rows.map((i) => {
    const overdue = i.kind === "INVOICE" && (i.status === "ISSUED" || i.status === "PARTIALLY_PAID") && i.dueDate && i.dueDate < today;
    return {
      id: i.id,
      number: { kind: "link", href: `/accounting/invoices/${i.id}`, label: i.number ?? t("statuses.DRAFT") },
      kind: { kind: "badge", status: i.kind, label: t(`kinds.${i.kind}`) },
      customer: { kind: "link", href: `/customers/${i.customer.id}`, label: i.customer.displayName },
      issueDate: { kind: "date", iso: i.issueDate ? isoDate(i.issueDate) : null },
      dueDate: { kind: "date", iso: i.dueDate ? isoDate(i.dueDate) : null },
      total: { kind: "money", cents: i.totalInclVatCents },
      due: { kind: "money", cents: i.status === "DRAFT" ? null : i.totalInclVatCents - i.paidCents },
      status: {
        kind: "badges",
        items: [
          { status: i.status, label: t(`statuses.${i.status}`) },
          ...(overdue ? [{ status: "overdue", label: t("overdue") }] : []),
        ],
      },
      source: i.sourceType && t.has(`sources.${i.sourceType}`) ? t(`sources.${i.sourceType}`) : i.sourceType,
      site: i.site.code,
    };
  });

  return (
    <div>
      <PageHeader
        title={t("invoices")}
        actions={
          can(actor.permissions, "accounting.invoice", "create") && (
            <Button asChild size="sm">
              <Link href="/accounting/invoices/new">
                <Plus /> {t("newInvoice")}
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
        exportHref="/api/export/invoices"
        columns={[
          { key: "number", header: t("number"), sortable: true },
          { key: "kind", header: t("kind") },
          { key: "customer", header: t("customer") },
          { key: "issueDate", header: t("issueDate"), sortable: true },
          { key: "dueDate", header: t("dueDate"), sortable: true },
          { key: "total", header: t("totalIncl"), align: "right" },
          { key: "due", header: t("due"), align: "right" },
          { key: "status", header: t("status") },
          { key: "source", header: t("source") },
          { key: "site", header: t("site") },
        ]}
        filters={[
          { key: "status", label: t("status"), options: ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID"].map((s) => ({ value: s, label: t(`statuses.${s}`) })) },
          { key: "kind", label: t("kind"), options: ["INVOICE", "CREDIT_NOTE"].map((s) => ({ value: s, label: t(`kinds.${s}`) })) },
          { key: "overdue", label: t("overdue"), options: [{ value: "1", label: t("overdue") }] },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
