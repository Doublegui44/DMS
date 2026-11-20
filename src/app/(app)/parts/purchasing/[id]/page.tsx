import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Send, X } from "lucide-react";
import { query } from "@/lib/session";
import { EntryLink } from "../../entry-link";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getPurchaseOrder } from "@/modules/parts";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { SpecForm } from "@/components/shared/spec-form";
import { ActionButton } from "@/components/shared/action-button";
import { TableForm } from "../../table-form";
import { addPurchaseLineAction, cancelPurchaseOrderAction, closePurchaseOrderAction, receivePurchaseOrderAction, removePurchaseLineAction, sendPurchaseOrderAction } from "../../actions";
import { fmtQty, qtyInput } from "../../format";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("parts");
  const d = await query((ctx) => getPurchaseOrder(ctx, id));
  const { po } = d;
  const draft = po.status === "DRAFT";
  const receiving = po.status === "SENT" || po.status === "PARTIAL";
  const open = d.lines.filter((l) => l.backorder.gt(0));
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("order")} ${po.number}`}
        subtitle={`${po.supplier.name} · ${po.site.name}`}
        backHref="/parts/purchasing"
        badges={
          <>
            <StatusBadge status={po.status} label={t(`poStatuses.${po.status}`)} />
            <StatusBadge status={po.kind} label={t(`poKinds.${po.kind}`)} />
          </>
        }
        actions={
          d.canEdit && (
            <>
              {draft && <ActionButton action={sendPurchaseOrderAction.bind(null, po.id)} label={t("sendOrder")} icon={<Send />} successMessage={t("orderSent")} />}
              {po.status === "PARTIAL" && (
                <ActionButton action={closePurchaseOrderAction.bind(null, po.id)} label={t("closeOrder")} variant="outline" confirm={t("closeOrderConfirm")} />
              )}
              {(draft || po.status === "SENT") && (
                <ActionButton action={cancelPurchaseOrderAction.bind(null, po.id)} label={t("cancelOrder")} variant="outline" icon={<X />} confirm={t("cancelOrderConfirm")} />
              )}
            </>
          )
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Section title={t("lines")}>
            <table className="w-full text-[13px]" data-testid="po-lines">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-3 font-medium">#</th>
                  <th className="py-1.5 pr-3 font-medium">{t("partNumber")}</th>
                  <th className="py-1.5 pr-3 font-medium">{t("description")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("ordered")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("received")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("unitCost")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("value")}</th>
                  {draft && d.canEdit && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {d.lines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-3 text-center text-muted-foreground">
                      {t("noLines")}
                    </td>
                  </tr>
                )}
                {d.lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0" data-part={l.part.partNumber}>
                    <td className="py-1.5 pr-3 text-muted-foreground tabular-nums">{l.lineNo}</td>
                    <td className="py-1.5 pr-3">
                      <Link className="text-primary hover:underline" href={`/parts/catalogue/${l.part.id}`}>
                        {l.part.partNumber}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">{l.part.description}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(l.qtyOrdered)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(l.qtyReceived)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.unitCostCents)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.valueCents)}</td>
                    {draft && d.canEdit && (
                      <td className="py-1 text-right">
                        <ActionButton action={removePurchaseLineAction.bind(null, po.id, l.id)} label="" icon={<X />} variant="ghost" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td colSpan={6} className="pt-2 font-medium">
                    {t("totalExcl")}
                  </td>
                  <td className="pt-2 pr-3 text-right font-semibold tabular-nums" data-testid="po-total">
                    {formatMoney(d.valueCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
            {draft && d.canEdit && (
              <div className="mt-4 border-t pt-4">
                <SpecForm
                  action={addPurchaseLineAction.bind(null, po.id)}
                  submitLabel={t("addLine")}
                  inline
                  fields={[
                    { name: "partNumber", label: t("partNumber"), placeholder: "1609438180", testId: "po-line-part" },
                    { name: "qty", label: t("qty"), type: "number", defaultValue: "1", testId: "po-line-qty" },
                    { name: "unitCostCents", label: t("unitCostOptional"), type: "money", placeholder: t("listCost") },
                  ]}
                />
              </div>
            )}
          </Section>

          {receiving && d.canEdit && (
            <Section title={t("receiveGoods")}>
              <p className="mb-3 text-xs text-muted-foreground">{t("receiveHint")}</p>
              <TableForm
                action={receivePurchaseOrderAction.bind(null, po.id)}
                submitLabel={t("receive")}
                fields={[{ name: "deliveryNote", label: t("deliveryNote"), placeholder: t("optional"), testId: "receipt-note" }]}
                headers={[t("partNumber"), t("description"), t("ordered"), t("received"), t("stillExpected")]}
                rightAligned={[2, 3, 4]}
                inputHeaders={[t("receivedNow")]}
                rows={open.map((l) => ({
                  id: l.id,
                  cells: [l.part.partNumber, l.part.description, fmtQty(l.qtyOrdered), fmtQty(l.qtyReceived), fmtQty(l.backorder)],
                  inputs: [{ name: "qty", defaultValue: qtyInput(l.backorder), testId: `receive-${l.part.partNumber}` }],
                }))}
              />
            </Section>
          )}

          {po.receipts.length > 0 && (
            <Section title={t("receipts")}>
              <table id="receipts" className="w-full text-[13px]" data-testid="po-receipts">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">{t("number")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("date")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("deliveryNote")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("lines")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("value")}</th>
                    <th className="py-1.5 font-medium">{t("entries")}</th>
                  </tr>
                </thead>
                <tbody>
                  {po.receipts.map((r) => (
                    <tr key={r.id} className="border-b last:border-0" data-receipt={r.number}>
                      <td className="py-1.5 pr-3 font-medium">{r.number}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{formatDate(r.receivedOn)}</td>
                      <td className="py-1.5 pr-3">{r.deliveryNote ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{r.lines.length}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(r.valueCents)}</td>
                      <td className="py-1.5">
                        {d.entries
                          .filter((e) => e.sourceId === r.id)
                          .map((e, i) => (
                            <span key={e.id}>
                              {i > 0 && ", "}
                              <EntryLink id={e.id} number={e.number} />
                            </span>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </div>

        <Section title={t("order")}>
          <Fields
            items={[
              { label: t("supplier"), value: <span data-testid="po-supplier">{po.supplier.name}</span> },
              { label: t("site"), value: po.site.name },
              { label: t("date"), value: formatDate(po.createdOn) },
              { label: t("sentOn"), value: po.sentOn ? formatDate(po.sentOn) : null },
              { label: t("expectedOn"), value: po.expectedOn ? formatDate(po.expectedOn) : null },
              { label: t("closedOn"), value: po.closedOn ? formatDate(po.closedOn) : null },
              { label: t("notes"), value: po.notes },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
