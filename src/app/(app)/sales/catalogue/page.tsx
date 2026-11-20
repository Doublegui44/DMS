import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { formatBp, formatMoney, inclFromExcl, ratioBp } from "@/lib/money";
import { getCatalogue } from "@/modules/sales";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";

export const metadata = { title: "Catalogue" };

export default async function CataloguePage() {
  const t = await getTranslations("sales");
  const { models, addOns, rateBp } = await query((ctx) => getCatalogue(ctx), { resource: "sales.catalogue", action: "view" });
  return (
    <div className="space-y-4">
      <PageHeader title={t("catalogue")} subtitle={t("catalogueHint")} />
      {models.map((m) => (
        <Section key={m.id} title={`${m.brand.name} ${m.name}`} actions={!m.active ? <StatusBadge status="INACTIVE" label={t("inactive")} /> : undefined}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-3 font-medium">{t("version")}</th>
                  <th className="py-1.5 pr-3 font-medium">{t("fuel")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">CO₂</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("listPriceExcl")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("listPriceIncl")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("dealerCost")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("dealerMargin")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("oemIncentive")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("leadTime")}</th>
                  <th className="py-1.5 font-medium">{t("options")}</th>
                </tr>
              </thead>
              <tbody>
                {m.versions.map((v) => (
                  <tr key={v.id} className="border-b align-top last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{v.name}</td>
                    <td className="py-1.5 pr-3">{t(`fuels.${v.fuel}`)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{v.co2 ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(v.listPriceExclVatCents)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(inclFromExcl(v.listPriceExclVatCents, rateBp))}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(v.dealerCostCents)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatBp(ratioBp(v.listPriceExclVatCents - v.dealerCostCents, v.listPriceExclVatCents), 1)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{v.oemIncentiveCents ? formatMoney(v.oemIncentiveCents) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{t("days", { count: v.leadTimeDays })}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{v.options.map((o) => `${o.label} ${formatMoney(o.listPriceExclVatCents, { decimals: false })}`).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
      <Section title={t("addOns")}>
        <table className="w-full text-[13px]">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 pr-3 font-medium">{t("product")}</th>
              <th className="py-1.5 pr-3 font-medium">{t("type")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("months")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("priceExclVat")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("cost")}</th>
              <th className="py-1.5 text-right font-medium">{t("dealerMargin")}</th>
            </tr>
          </thead>
          <tbody>
            {addOns.map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="py-1.5 pr-3 font-medium">{a.name}</td>
                <td className="py-1.5 pr-3">{t(`addOnKinds.${a.kind}`)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{a.months ?? "—"}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(a.priceExclVatCents)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(a.costCents)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(a.priceExclVatCents - a.costCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
