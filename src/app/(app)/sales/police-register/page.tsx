import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listPoliceRegister } from "@/modules/sales";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";

export const metadata = { title: "Police register" };

export default async function PoliceRegisterPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("sales");
  const { sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "number", dir: "desc" });
  const data = await query((ctx) => listPoliceRegister(ctx, p), { resource: "sales.vo_stock", action: "view" });
  const rows: Row[] = data.rows.map((e) => ({
    id: e.id,
    number: { kind: "link", href: `/sales/vo-stock/${e.vehicleId}`, label: e.number },
    inDate: { kind: "date", iso: isoDate(e.inDate) },
    description: e.description,
    vin: { kind: "mono", value: e.vin },
    registration: { kind: "mono", value: e.registration },
    seller: { kind: "link", href: `/sales/vo-stock/${e.vehicleId}`, label: e.sellerName, sub: e.sellerAddress ?? undefined },
    purchase: { kind: "money", cents: e.purchasePriceCents },
    source: e.voPurchase ? { kind: "badge", status: e.voPurchase.source, label: t(`purchaseSources.${e.voPurchase.source}`) } : null,
    outDate: { kind: "date", iso: e.outDate ? isoDate(e.outDate) : null },
    buyer: e.buyerName,
    sale: { kind: "money", cents: e.salePriceCents },
    site: e.site.code,
  }));
  return (
    <div>
      <PageHeader title={t("policeRegister")} subtitle={t("policeRegisterHint")} />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        exportHref="/api/export/police-register"
        columns={[
          { key: "number", header: t("entry"), sortable: true },
          { key: "inDate", header: t("inDate"), sortable: true },
          { key: "description", header: t("vehicle") },
          { key: "vin", header: "VIN" },
          { key: "registration", header: t("registration") },
          { key: "seller", header: t("seller") },
          { key: "source", header: t("source") },
          { key: "purchase", header: t("purchasePrice"), align: "right" },
          { key: "outDate", header: t("outDate"), sortable: true },
          { key: "buyer", header: t("buyer") },
          { key: "sale", header: t("salePrice"), align: "right" },
          { key: "site", header: t("site") },
        ]}
        filters={[
          { key: "open", label: t("inStock"), options: [{ value: "1", label: t("stillInStock") }] },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
