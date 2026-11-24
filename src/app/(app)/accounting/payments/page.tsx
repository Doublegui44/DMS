import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { parseListParams, type SearchParams } from "@/lib/list";
import { isoDate } from "@/lib/dates";
import { listPayments } from "@/modules/accounting";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("payments");

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = parseListParams(await searchParams, { sort: "businessDate", dir: "desc" });
  const t = await getTranslations("accounting");
  const { actor, sites } = await getRequestContext();
  const data = await query((ctx) => listPayments(ctx, p), { resource: "accounting.payment", action: "view" });

  const rows: Row[] = data.rows.map((x) => ({
    id: x.id,
    number: { kind: "link", href: `/accounting/payments/${x.id}`, label: x.number },
    businessDate: { kind: "date", iso: isoDate(x.businessDate) },
    direction: { kind: "badge", status: x.direction, label: t(`directions.${x.direction}`) },
    method: t(`methods.${x.method}`),
    party: x.customer
      ? { kind: "link", href: `/customers/${x.customer.id}`, label: x.customer.displayName }
      : x.supplier
        ? { kind: "link", href: `/accounting/ledgers/supplier/${x.supplier.id}`, label: x.supplier.name }
        : null,
    reference: x.reference,
    amountCents: { kind: "money", cents: x.amountCents },
    unallocated: { kind: "money", cents: x.customerId ? x.amountCents - x.allocatedCents : null },
    site: x.site.code,
  }));

  return (
    <div>
      <PageHeader
        title={t("payments")}
        actions={
          can(actor.permissions, "accounting.payment", "create") && (
            <Button asChild size="sm">
              <Link href="/accounting/payments/new">
                <Plus /> {t("newPayment")}
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
        exportHref="/api/export/payments"
        columns={[
          { key: "number", header: t("number"), sortable: true },
          { key: "businessDate", header: t("date"), sortable: true },
          { key: "direction", header: t("direction") },
          { key: "method", header: t("method") },
          { key: "party", header: t("party") },
          { key: "reference", header: t("reference") },
          { key: "amountCents", header: t("amount"), sortable: true, align: "right" },
          { key: "unallocated", header: t("unallocated"), align: "right" },
          { key: "site", header: t("site") },
        ]}
        filters={[
          { key: "direction", label: t("direction"), options: ["IN", "OUT"].map((d) => ({ value: d, label: t(`directions.${d}`) })) },
          { key: "method", label: t("method"), options: ["TRANSFER", "CARD", "CHEQUE", "CASH", "FINANCE_COMPANY"].map((m) => ({ value: m, label: t(`methods.${m}`) })) },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
