import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getStockItem } from "@/modules/parts";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { SpecForm } from "@/components/shared/spec-form";
import { setStockLevelsAction } from "../../actions";
import { fmtQty, pmpCents, qtyInput } from "../../format";
import { sourceHref } from "../source-link";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("stockItem");

export default async function StockItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("parts");
  const d = await query((ctx) => getStockItem(ctx, id));
  const { item } = d;
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${item.part.partNumber} · ${item.site.code}`}
        subtitle={item.part.description}
        backHref="/parts/stock"
        badges={d.belowMin ? <StatusBadge status="warning" tone="amber" label={t("belowMin")} /> : undefined}
      />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="stock-figures">
        {[
          [t("onHand"), fmtQty(item.qtyOnHand), "stock-on-hand"],
          [t("reserved"), fmtQty(item.qtyReserved), "stock-reserved"],
          [t("available"), fmtQty(d.available), "stock-available"],
          [t("onOrder"), fmtQty(d.onOrder), "stock-on-order"],
          [t("pmp"), formatMoney(pmpCents(item.pmpCents)), "stock-pmp"],
          [t("value"), formatMoney(item.valueCents), "stock-value"],
        ].map(([label, value, testId]) => (
          <div key={label} className="rounded-lg border bg-card px-3 py-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold tabular-nums" data-testid={testId}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Section title={t("ledger")}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" data-testid="stock-ledger">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-3 font-medium">{t("date")}</th>
                  <th className="py-1.5 pr-3 font-medium">{t("movement")}</th>
                  <th className="py-1.5 pr-3 font-medium">{t("reference")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("qty")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("unitCost")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("value")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("qtyAfter")}</th>
                  <th className="py-1.5 text-right font-medium">{t("pmpAfter")}</th>
                </tr>
              </thead>
              <tbody>
                {d.movements.map((m) => {
                  const href = sourceHref(m.sourceType, m.sourceId);
                  return (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 tabular-nums">{formatDate(m.businessDate)}</td>
                      <td className="py-1.5 pr-3">
                        <StatusBadge status={m.kind} label={t(`movementKinds.${m.kind}`)} />
                      </td>
                      <td className="py-1.5 pr-3">
                        {href ? (
                          <Link className="text-primary hover:underline" href={href}>
                            {m.reference}
                          </Link>
                        ) : (
                          m.reference
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(m.qty)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(pmpCents(m.unitCostCents))}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(m.valueCents)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(m.qtyAfter)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatMoney(pmpCents(m.pmpAfterCents))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="space-y-4">
          <Section title={t("part")}>
            <Fields
              items={[
                { label: t("partNumber"), value: <Link className="text-primary hover:underline" href={`/parts/catalogue/${item.part.id}`}>{item.part.partNumber}</Link> },
                { label: t("site"), value: item.site.name },
                { label: t("bin"), value: item.bin },
                { label: t("minMax"), value: `${fmtQty(item.minQty)} / ${fmtQty(item.maxQty)}` },
                { label: t("supplier"), value: item.part.supplier.name },
                { label: t("lastCounted"), value: item.lastCountedOn ? formatDate(item.lastCountedOn) : null },
              ]}
            />
          </Section>
          {d.canEdit && (
            <Section title={t("levels")}>
              <SpecForm
                action={setStockLevelsAction}
                submitLabel={t("save")}
                columns={3}
                fields={[
                  { name: "siteId", label: "", type: "hidden", defaultValue: item.siteId },
                  { name: "partId", label: "", type: "hidden", defaultValue: item.partId },
                  { name: "bin", label: t("bin"), defaultValue: item.bin ?? "" },
                  { name: "minQty", label: t("minQty"), type: "number", defaultValue: qtyInput(item.minQty), testId: "levels-min" },
                  { name: "maxQty", label: t("maxQty"), type: "number", defaultValue: qtyInput(item.maxQty), testId: "levels-max" },
                ]}
              />
            </Section>
          )}
          {d.reservations.length > 0 && (
            <Section title={t("reservedFor")}>
              <ul className="space-y-1 text-[13px]">
                {d.reservations.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3">
                    <Link className="text-primary hover:underline" href={`/parts/counter/${r.sale.id}`}>
                      {r.sale.number} · {r.sale.customer.displayName}
                    </Link>
                    <span className="tabular-nums">{fmtQty(r.qty)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
