import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { query, getRequestContext } from "@/lib/session";
import { can } from "@/lib/rbac";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listCustomers } from "@/modules/core";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = parseListParams(await searchParams, { sort: "displayName", dir: "asc" });
  const t = await getTranslations("customer");
  const { actor, sites } = await getRequestContext();
  const data = await query((ctx) => listCustomers(ctx, p), { resource: "customer", action: "view" });

  const rows: Row[] = data.rows.map((c) => ({
    id: c.id,
    number: { kind: "mono", value: c.number },
    displayName: { kind: "link", href: `/customers/${c.id}`, label: c.displayName },
    kind: { kind: "badge", status: c.kind, label: t(`kinds.${c.kind}`) },
    city: c.city,
    phone: c.phone,
    email: c.email,
    priceClass: t(`priceClasses.${c.priceClass}`),
    vehicles: c._count.vehicles,
    site: c.homeSite?.code ?? null,
  }));

  const canCreate = can(actor.permissions, "customer", "create");
  return (
    <div>
      <PageHeader
        title={t("title")}
        actions={
          canCreate && (
            <Button asChild size="sm">
              <Link href="/customers/new">
                <Plus /> {t("new")}
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
        exportHref="/api/export/customers"
        columns={[
          { key: "number", header: t("number"), sortable: true },
          { key: "displayName", header: t("name"), sortable: true },
          { key: "kind", header: t("kind"), sortable: true },
          { key: "city", header: t("city"), sortable: true },
          { key: "phone", header: t("phone") },
          { key: "email", header: t("email") },
          { key: "priceClass", header: t("priceClass") },
          { key: "vehicles", header: t("vehicles"), align: "right" },
          { key: "site", header: t("homeSite") },
        ]}
        filters={[
          {
            key: "kind",
            label: t("kind"),
            options: (["INDIVIDUAL", "COMPANY", "OEM"] as const).map((k) => ({ value: k, label: t(`kinds.${k}`) })),
          },
          {
            key: "priceClass",
            label: t("priceClass"),
            options: (["RETAIL", "TRADE", "INTERNAL", "WARRANTY"] as const).map((k) => ({ value: k, label: t(`priceClasses.${k}`) })),
          },
          { key: "site", label: t("homeSite"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
