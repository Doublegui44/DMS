import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Percent, Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { parseListParams, type SearchParams } from "@/lib/list";
import { getPartFormData, listParts } from "@/modules/parts";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { fmtQty } from "../format";

export const metadata = { title: "Parts catalogue" };

export default async function PartsCataloguePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("parts");
  const { actor, sites, siteId } = await getRequestContext();
  const p = parseListParams(sp, { sort: "partNumber", dir: "asc" });
  const [data, form] = await Promise.all([
    query((ctx) => listParts(ctx, p), { resource: "parts.part", action: "view" }),
    query((ctx) => getPartFormData(ctx)),
  ]);
  const here = sites.find((s) => s.id === siteId)?.code ?? "";
  const rows: Row[] = data.rows.map((r) => ({
    id: r.id,
    partNumber: { kind: "link", href: `/parts/catalogue/${r.id}`, label: r.partNumber },
    description: r.description,
    family: r.family,
    brand: r.brand?.name ?? t("aftermarket"),
    supplier: r.supplier.name,
    discountCode: { kind: "mono", value: r.discountCode.code },
    retailPriceCents: { kind: "money", cents: r.retailPriceCents },
    listCostCents: { kind: "money", cents: r.listCostCents },
    available: fmtQty(r.availableHere),
    group: fmtQty(r.onHandGroup),
    status: r.replacedBy
      ? { kind: "badge", status: "REPLACED", label: t("replacedBy", { number: r.replacedBy.newPart.partNumber }), tone: "amber" }
      : r.active
        ? null
        : { kind: "badge", status: "INACTIVE", label: t("inactive") },
  }));
  return (
    <div>
      <PageHeader
        title={t("catalogue")}
        subtitle={t("catalogueHint")}
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/parts/catalogue/discounts">
                <Percent /> {t("discountMatrix")}
              </Link>
            </Button>
            {can(actor.permissions, "parts.part", "create") && (
              <Button asChild size="sm">
                <Link href="/parts/catalogue/new">
                  <Plus /> {t("newPart")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        exportHref="/api/export/parts"
        columns={[
          { key: "partNumber", header: t("partNumber"), sortable: true },
          { key: "description", header: t("description"), sortable: true },
          { key: "family", header: t("family"), sortable: true },
          { key: "brand", header: t("brand") },
          { key: "supplier", header: t("supplier") },
          { key: "discountCode", header: t("discountCode") },
          { key: "retailPriceCents", header: t("retailPrice"), align: "right", sortable: true },
          { key: "listCostCents", header: t("listCost"), align: "right", sortable: true },
          { key: "available", header: t("availableAt", { site: here }), align: "right" },
          { key: "group", header: t("onHandGroup"), align: "right" },
          { key: "status", header: t("status") },
        ]}
        filters={[
          { key: "family", label: t("family"), options: form.families.map((f) => ({ value: f, label: f })) },
          { key: "brand", label: t("brand"), options: [...form.brands, { value: "AFTERMARKET", label: t("aftermarket") }] },
          { key: "supplier", label: t("supplier"), options: form.suppliers },
          {
            key: "active",
            label: t("status"),
            options: [
              { value: "0", label: t("inactive") },
              { value: "all", label: t("allParts") },
            ],
          },
          { key: "superseded", label: t("supersession"), options: [{ value: "1", label: t("supersededOnly") }] },
        ]}
      />
    </div>
  );
}
