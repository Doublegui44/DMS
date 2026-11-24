import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { getStockOrderFormData } from "@/modules/sales";
import { inputClass } from "@/components/shared/form";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { Button } from "@/components/ui/button";
import { orderForStockAction } from "../../actions";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("orderForStock");

/** Two steps without client code: pick the version (GET), then its options and the site. */
export default async function OrderForStockPage({ searchParams }: { searchParams: Promise<{ version?: string }> }) {
  const { version: versionId } = await searchParams;
  const t = await getTranslations("sales");
  const { sites, siteId } = await getRequestContext();
  const data = await query((ctx) => getStockOrderFormData(ctx), { resource: "sales.vn_stock", action: "create" });
  const version = data.versions.find((v) => v.id === versionId) ?? null;
  const sellingSites = version ? sites.filter((s) => data.siteBrands.some((b) => b.siteId === s.id && b.brandId === version.brandId)) : [];

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={t("orderForStock")} subtitle={t("orderForStockHint")} backHref="/sales/vn-stock" />
      <Section title={t("version")}>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <select name="version" defaultValue={versionId ?? ""} className={`${inputClass} max-w-md`} aria-label={t("version")} data-testid="stock-version">
            <option value="">{t("chooseVersion")}</option>
            {data.versions.map((v) => (
              <option key={v.id} value={v.id}>
                {`${v.label} — ${formatMoney(v.listPriceExclVatCents, { decimals: false })} ${t("exclVatShort")}`}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline">
            {t("continue")}
          </Button>
        </form>
      </Section>
      {version && (
        <Section title={version.label}>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("stockOrderFacts", { cost: formatMoney(version.dealerCostCents), days: version.leadTimeDays })}
          </p>
          {sellingSites.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSiteSellsBrand")}</p>
          ) : (
            <SpecForm
              action={orderForStockAction}
              submitLabel={t("placeFactoryOrder")}
              successMessage={t("factoryOrderPlaced")}
              cancelHref="/sales/vn-stock"
              fields={[
                { name: "catalogueVersionId", label: "", type: "hidden", defaultValue: version.id },
                {
                  name: "siteId",
                  label: t("site"),
                  type: "select",
                  options: sellingSites.map((s) => ({ value: s.id, label: s.name })),
                  defaultValue: sellingSites.find((s) => s.id === siteId)?.id ?? sellingSites[0].id,
                },
                { name: "colour", label: t("colour"), placeholder: t("colourPlaceholder") },
                {
                  name: "optionIds",
                  label: t("options"),
                  type: "checkboxes",
                  wide: true,
                  options: version.options.map((o) => ({ value: o.id, label: `${o.label} (${formatMoney(o.listPriceExclVatCents, { decimals: false })})` })),
                  hint: t("onePaintOnly"),
                },
              ]}
            />
          )}
        </Section>
      )}
    </div>
  );
}
