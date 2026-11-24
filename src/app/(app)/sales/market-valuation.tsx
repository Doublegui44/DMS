"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Gauge, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatKm } from "@/lib/format-locale";
import { formatMoney } from "@/lib/money";
import type { MarketQueryInput } from "@/modules/sales";
import { marketValuationAction } from "./actions";

type Result = Extract<Awaited<ReturnType<typeof marketValuationAction>>, { ok: true }>["data"];

/**
 * "Market price" button and its answer: the trade estimate, its range and the listings behind it
 * (mock feed, D-083). `query` reads the car from the form when clicked; `onUse` takes the estimate.
 */
export function MarketValuation({ query, onUse, useLabel, testId = "market" }: { query: () => MarketQueryInput; onUse: (cents: number) => void; useLabel?: string; testId?: string }) {
  const t = useTranslations("sales.market");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();

  const ask = () =>
    start(async () => {
      const r = await marketValuationAction(query());
      if (r.ok) setResult(r.data);
      else toast.error(r.error.message);
    });

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="outline" onClick={ask} disabled={pending} data-testid={`${testId}-ask`}>
        {pending ? <Loader2 className="animate-spin" /> : <Gauge />} {t("ask")}
      </Button>
      {result && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-[13px]" data-testid={`${testId}-result`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-xs text-muted-foreground">{t("estimate")}</div>
              <div className="text-lg font-semibold tabular-nums" data-testid={`${testId}-estimate`}>
                {formatMoney(result.estimateCents, { decimals: false })}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("range", { low: formatMoney(result.lowCents, { decimals: false }), high: formatMoney(result.highCents, { decimals: false }) })} ·{" "}
                {t("retail", { amount: formatMoney(result.retailCents, { decimals: false }) })}
              </div>
            </div>
            <Button type="button" size="sm" onClick={() => onUse(result.estimateCents)} data-testid={`${testId}-use`}>
              {useLabel ?? t("use")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(result.fromCatalogue ? "basisCatalogue" : "basisFallback", { price: formatMoney(result.newPriceCents, { decimals: false }), years: result.ageYears })}
          </p>
          <table className="w-full text-xs">
            <caption className="sr-only">{t("comparables")}</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-medium">{t("listing")}</th>
                <th className="py-1 text-right font-medium">{t("year")}</th>
                <th className="py-1 text-right font-medium">{t("mileage")}</th>
                <th className="py-1 text-right font-medium">{t("asking")}</th>
                <th className="py-1 text-right font-medium">{t("listed")}</th>
              </tr>
            </thead>
            <tbody>
              {result.comparables.map((c) => (
                <tr key={c.ref} className="border-t">
                  <td className="py-1 font-mono">
                    {c.ref} <span className="font-sans text-muted-foreground">· {t(`sellers.${c.seller}`)}</span>
                  </td>
                  <td className="py-1 text-right tabular-nums">{c.year}</td>
                  <td className="py-1 text-right tabular-nums">{formatKm(c.mileage)}</td>
                  <td className="py-1 text-right tabular-nums">{formatMoney(c.priceCents, { decimals: false })}</td>
                  <td className="py-1 text-right tabular-nums">{t("days", { count: c.daysListed })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
