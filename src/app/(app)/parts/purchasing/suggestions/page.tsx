import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import type { SearchParams } from "@/lib/list";
import { getSuggestions } from "@/modules/parts";
import { PageHeader, Section } from "@/components/shared/page-header";
import { ActionButton } from "@/components/shared/action-button";
import { Button } from "@/components/ui/button";
import { createSuggestedOrdersAction } from "../../actions";
import { fmtQty } from "../../format";

export const metadata = { title: "Suggested orders" };

export default async function SuggestionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("parts");
  const { sites, siteId: activeSite } = await getRequestContext();
  const wanted = typeof sp.site === "string" ? sp.site : null;
  const site = sites.find((s) => s.id === wanted) ?? sites.find((s) => s.id === activeSite) ?? sites[0];
  const d = await query((ctx) => getSuggestions(ctx, site.id));
  const total = d.groups.reduce((s, g) => s + g.valueCents, 0);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("suggestions")}
        subtitle={t("suggestionsHint", { site: site.name })}
        backHref="/parts/purchasing"
        actions={
          d.canCreate &&
          d.count > 0 && (
            <ActionButton
              action={createSuggestedOrdersAction.bind(null, site.id, [])}
              label={t("createAllOrders", { count: d.groups.length })}
              confirm={t("createOrdersConfirm", { count: d.groups.length, value: formatMoney(total) })}
              successMessage={t("ordersDrafted")}
            />
          )
        }
      />
      {sites.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {sites.map((s) => (
            <Button key={s.id} asChild size="sm" variant={s.id === site.id ? "secondary" : "ghost"}>
              <Link href={`/parts/purchasing/suggestions?site=${s.id}`}>{s.name}</Link>
            </Button>
          ))}
        </div>
      )}
      {d.count === 0 && <p className="rounded-lg border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">{t("noSuggestions")}</p>}
      {d.groups.map((g) => (
        <Section
          key={g.supplier.id}
          title={`${g.supplier.name} · ${formatMoney(g.valueCents)}`}
          actions={
            d.canCreate && (
              <ActionButton
                action={createSuggestedOrdersAction.bind(null, site.id, g.rows.map((r) => r.stockItemId))}
                label={t("draftOrder")}
                variant="outline"
                successMessage={t("ordersDrafted")}
              />
            )
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" data-testid="suggestions">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-3 font-medium">{t("partNumber")}</th>
                  <th className="py-1.5 pr-3 font-medium">{t("description")}</th>
                  <th className="py-1.5 pr-3 font-medium">{t("bin")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("available")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("onOrder")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("minMax")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("toOrder")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("unitCost")}</th>
                  <th className="py-1.5 text-right font-medium">{t("value")}</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.stockItemId} className="border-b last:border-0" data-part={r.part.partNumber}>
                    <td className="py-1.5 pr-3">
                      <Link className="text-primary hover:underline" href={`/parts/stock/${r.stockItemId}`}>
                        {r.part.partNumber}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">{r.part.description}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{r.bin ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(r.onHand.minus(r.reserved))}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(r.onOrder)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {fmtQty(r.min)} / {fmtQty(r.max)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium tabular-nums">{fmtQty(r.qty)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(r.unitCostCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(r.valueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
    </div>
  );
}
