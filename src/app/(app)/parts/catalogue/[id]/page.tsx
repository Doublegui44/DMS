import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { query } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { formatDate, isoDate } from "@/lib/dates";
import { getPart, netUnitPrice, PRICE_CLASSES } from "@/modules/parts";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { SpecForm } from "@/components/shared/spec-form";
import { ActionButton } from "@/components/shared/action-button";
import { Button } from "@/components/ui/button";
import { removeSupersessionAction, setStockLevelsAction, supersedePartAction } from "../../actions";
import { bpToPercent, fmtQty, pmpCents, qtyInput } from "../../format";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("part");

export default async function PartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("parts");
  const d = await query((ctx) => getPart(ctx, id), { resource: "parts.part", action: "view" });
  const { part } = d;
  return (
    <div className="space-y-4">
      <PageHeader
        title={part.partNumber}
        subtitle={`${part.description} · ${part.family}`}
        backHref="/parts/catalogue"
        badges={
          <>
            {part.brand ? <StatusBadge status="OEM" label={part.brand.name} /> : <StatusBadge status="NONE" label={t("aftermarket")} />}
            {!part.active && <StatusBadge status="INACTIVE" label={t("inactive")} />}
            {part.replacedBy && <StatusBadge status="REPLACED" tone="amber" label={t("replacedBy", { number: part.replacedBy.newPart.partNumber })} />}
          </>
        }
        actions={
          d.canEdit && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/parts/catalogue/${id}/edit`}>
                <Pencil /> {t("edit")}
              </Link>
            </Button>
          )
        }
      />

      {d.currentPart && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {t("sellInstead")}{" "}
          <Link className="font-medium underline" href={`/parts/catalogue/${d.currentPart.id}`}>
            {d.currentPart.partNumber}
          </Link>
        </p>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Section title={t("stockBySite")}>
            <table className="w-full text-[13px]" data-testid="part-stock">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-3 font-medium">{t("site")}</th>
                  <th className="py-1.5 pr-3 font-medium">{t("bin")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("onHand")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("reserved")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("minMax")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("pmp")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("value")}</th>
                  <th className="py-1.5 font-medium">{t("lastMovement")}</th>
                </tr>
              </thead>
              <tbody>
                {d.stock.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-3 text-center text-muted-foreground">
                      {t("notStocked")}
                    </td>
                  </tr>
                )}
                {d.stock.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">
                      <Link className="text-primary hover:underline" href={`/parts/stock/${s.id}`}>
                        {s.site.code}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{s.bin ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(s.qtyOnHand)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(s.qtyReserved)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {fmtQty(s.minQty)} / {fmtQty(s.maxQty)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(pmpCents(s.pmpCents))}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(s.valueCents)}</td>
                    <td className="py-1.5 tabular-nums">{s.lastMovementOn ? formatDate(s.lastMovementOn) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {d.levelSites.length > 0 && (
            <Section title={t("levels")}>
              <p className="mb-3 text-xs text-muted-foreground">{t("levelsHint")}</p>
              <div className="space-y-3">
                {d.levelSites.map((s) => (
                  <div key={s.id}>
                    <div className="mb-1 text-xs font-medium">{s.name}</div>
                    <SpecForm
                      action={setStockLevelsAction}
                      submitLabel={t("save")}
                      inline
                      fields={[
                        { name: "siteId", label: "", type: "hidden", defaultValue: s.id },
                        { name: "partId", label: "", type: "hidden", defaultValue: part.id },
                        { name: "bin", label: t("bin"), defaultValue: s.item?.bin ?? "", placeholder: "A-01-03" },
                        { name: "minQty", label: t("minQty"), type: "number", defaultValue: qtyInput(s.item?.minQty ?? 0) },
                        { name: "maxQty", label: t("maxQty"), type: "number", defaultValue: qtyInput(s.item?.maxQty ?? 0) },
                      ]}
                    />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {d.onOrder.length > 0 && (
            <Section title={t("onOrder")}>
              <table className="w-full text-[13px]">
                <tbody>
                  {d.onOrder.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">
                        <Link className="text-primary hover:underline" href={`/parts/purchasing/${l.purchaseOrder.id}`}>
                          {l.purchaseOrder.number}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">{l.purchaseOrder.site.code}</span>
                      </td>
                      <td className="py-1.5 pr-3">
                        <StatusBadge status={l.purchaseOrder.status} label={t(`poStatuses.${l.purchaseOrder.status}`)} />
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {fmtQty(l.qtyReceived)} / {fmtQty(l.qtyOrdered)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{l.purchaseOrder.expectedOn ? formatDate(l.purchaseOrder.expectedOn) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </div>

        <div className="space-y-4">
          <Section title={t("part")}>
            <Fields
              items={[
                { label: t("supplier"), value: part.supplier.name },
                { label: t("unit"), value: t(`units.${part.unit}`) },
                { label: t("retailPriceExcl"), value: formatMoney(part.retailPriceCents) },
                { label: t("listCostExcl"), value: formatMoney(part.listCostCents) },
                { label: t("discountCode"), value: `${part.discountCode.code} — ${part.discountCode.label}` },
                { label: t("vatRate"), value: part.vatRateCode },
              ]}
            />
          </Section>

          <Section title={t("pricesByClass")}>
            <table className="w-full text-[13px]">
              <tbody>
                {PRICE_CLASSES.map((c) => (
                  <tr key={c} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">{t(`priceClasses.${c}`)}</td>
                    <td className="py-1.5 pr-3 text-right text-muted-foreground tabular-nums">{bpToPercent(d.rates[c])}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(netUnitPrice(part.retailPriceCents, d.rates[c]))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title={t("supersession")}>
            {part.replaces.length > 0 && (
              <p className="mb-2 text-[13px]">
                {t("replaces")}{" "}
                {part.replaces.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ", "}
                    <Link className="text-primary hover:underline" href={`/parts/catalogue/${r.oldPart.id}`}>
                      {r.oldPart.partNumber}
                    </Link>
                  </span>
                ))}
              </p>
            )}
            {part.replacedBy ? (
              <div className="space-y-2 text-[13px]">
                <p>
                  {t("replacedFrom", { date: formatDate(part.replacedBy.effectiveOn) })}{" "}
                  <Link className="text-primary hover:underline" href={`/parts/catalogue/${part.replacedBy.newPart.id}`}>
                    {part.replacedBy.newPart.partNumber}
                  </Link>
                </p>
                {d.canEdit && <ActionButton action={removeSupersessionAction.bind(null, part.id)} label={t("removeSupersession")} variant="outline" confirm={t("removeSupersessionConfirm")} />}
              </div>
            ) : d.canEdit ? (
              <SpecForm
                action={supersedePartAction.bind(null, part.id)}
                submitLabel={t("supersede")}
                columns={1}
                fields={[
                  { name: "newPartNumber", label: t("replacementNumber"), placeholder: "1609438180" },
                  { name: "effectiveOn", label: t("effectiveOn"), type: "date", hint: t("effectiveOnHint") },
                ]}
              />
            ) : (
              <p className="text-[13px] text-muted-foreground">{t("notSuperseded")}</p>
            )}
          </Section>
          <p className="text-xs text-muted-foreground">{t("createdOn", { date: isoDate(part.createdAt) })}</p>
        </div>
      </div>
    </div>
  );
}
