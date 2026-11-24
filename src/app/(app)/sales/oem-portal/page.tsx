import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Factory, Truck } from "lucide-react";
import { query } from "@/lib/session";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { getOemPortal, type OemStage } from "@/modules/sales";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { SpecForm } from "@/components/shared/spec-form";
import { delayFactoryOrderAction, shipFactoryOrderAction } from "../actions";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("oemPortal");

const STAGE_TONES: Record<OemStage, Tone> = {
  RECEIVED: "gray",
  SCHEDULED: "indigo",
  IN_PRODUCTION: "violet",
  BUILT: "teal",
  SHIPPED: "blue",
  DELIVERED: "green",
  CANCELLED: "red",
};

/** The manufacturer's order portal, as a dealer sees it (mock, D-084). */
export default async function OemPortalPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations("sales.oem");
  const portal = await query((ctx) => getOemPortal(ctx, { brandId: sp.brand }), { resource: "sales.vn_stock", action: "view" });
  const tiles = [
    { label: t("open"), value: String(portal.totals.open) },
    { label: t("readyToShip"), value: String(portal.totals.readyToShip) },
    { label: t("inTransit"), value: String(portal.totals.inTransit) },
    { label: t("late"), value: String(portal.totals.late), alert: portal.totals.late > 0 },
    { label: t("toInvoice"), value: formatMoney(portal.totals.toInvoiceCents, { decimals: false }) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <nav className="flex flex-wrap gap-1.5" aria-label={t("brands")}>
        {[{ id: "", name: t("allBrands") }, ...portal.brands].map((b) => (
          <Link
            key={b.id || "all"}
            href={b.id ? `/sales/oem-portal?brand=${b.id}` : "/sales/oem-portal"}
            className={cn("rounded-md border px-2.5 py-1 text-[13px]", (sp.brand ?? "") === b.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
          >
            {b.name}
          </Link>
        ))}
      </nav>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="oem-totals">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">{x.label}</div>
            <div className={cn("text-xl font-semibold tabular-nums", x.alert && "text-red-700 dark:text-red-400")}>{x.value}</div>
          </div>
        ))}
      </div>
      <Section title={<span className="flex items-center gap-1.5"><Factory className="size-4" /> {t("orders")}</span>}>
        {portal.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" data-testid="oem-orders">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("reference")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("vehicle")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("stage")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("buildOn")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("promisedOn")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("invoice")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {portal.rows.map((r) => (
                  <tr key={r.id} className="border-b align-top last:border-0" data-testid={`oem-row-${r.number}`}>
                    <td className="px-3 py-2">
                      <div className="font-mono">{r.oemReference}</div>
                      <Link href={`/sales/vn-stock/${r.vehicleId}`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                        {r.number} · {r.site}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div>
                        {r.brand} {r.vehicle}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.colour ?? "—"} · {r.customer ? t("soldTo", { customer: r.customer, order: r.salesOrder ?? "" }) : t("forStock")}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.stage} tone={STAGE_TONES[r.stage]} label={t(`stages.${r.stage}`)} />
                      {(r.stage === "RECEIVED" || r.stage === "SCHEDULED" || r.stage === "IN_PRODUCTION" || r.stage === "BUILT") && (
                        <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={r.progressPct} aria-valuemin={0} aria-valuemax={100}>
                          <div className="h-full bg-primary" style={{ width: `${r.progressPct}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatDate(r.buildOn)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatDate(r.expectedOn)}
                      {r.late && <StatusBadge status="overdue" tone="red" label={t("lateBadge")} />}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.invoiceCents)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-end gap-1.5">
                        {r.readyToShip && (
                          <ActionButton action={shipFactoryOrderAction.bind(null, r.vehicleId, r.id)} label={t("ship")} icon={<Truck />} variant="outline" successMessage={t("shipped")} />
                        )}
                        {(r.status === "ORDERED" || r.status === "IN_TRANSIT") && (
                          <details className="w-64 text-left">
                            <summary className="cursor-pointer text-right text-xs text-muted-foreground hover:text-foreground">{t("delay")}</summary>
                            <div className="mt-2">
                              <SpecForm
                                action={delayFactoryOrderAction.bind(null, r.id)}
                                submitLabel={t("delaySubmit")}
                                successMessage={t("delayed")}
                                columns={1}
                                fields={[
                                  { name: "days", label: t("delayDays"), type: "number", defaultValue: "7" },
                                  { name: "reason", label: t("delayReason"), placeholder: t("delayReasonPlaceholder") },
                                ]}
                              />
                            </div>
                          </details>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
