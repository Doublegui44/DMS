import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { X } from "lucide-react";
import { query } from "@/lib/session";
import { EntryLink } from "../../entry-link";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getCycleCount } from "@/modules/parts";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { TableForm } from "../../table-form";
import { cancelCycleCountAction, saveCountsAction } from "../../actions";
import { fmtQty, qtyInput } from "../../format";

export const metadata = { title: "Cycle count" };

export default async function CycleCountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("parts");
  const d = await query((ctx) => getCycleCount(ctx, id));
  const { count } = d;
  const open = count.status === "OPEN";
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("cycleCount")} ${count.number}`}
        subtitle={`${count.label} · ${count.site.name}`}
        backHref="/parts/inventory"
        badges={<StatusBadge status={count.status} label={t(`countStatuses.${count.status}`)} />}
        actions={
          open &&
          d.canEdit && <ActionButton action={cancelCycleCountAction.bind(null, count.id)} label={t("cancelCount")} variant="outline" icon={<X />} confirm={t("cancelCountConfirm")} />
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Section title={t("countSheet")}>
          {open && d.canEdit ? (
            <>
              <p className="mb-3 text-xs text-muted-foreground">{t("countSheetHint")}</p>
              <TableForm
                action={saveCountsAction.bind(null, count.id)}
                submitLabel={t("saveCounts")}
                successMessage={t("countsSaved")}
                fields={d.canPost ? [{ name: "intent", label: t("postAfterSave"), type: "checkbox", defaultValue: "post", testId: "count-post" }] : []}
                headers={[t("bin"), t("partNumber"), t("description"), t("expected")]}
                rightAligned={[3]}
                inputHeaders={[t("counted")]}
                rows={d.lines.map((l) => ({
                  id: l.id,
                  cells: [l.stockItem.bin, l.stockItem.part.partNumber, l.stockItem.part.description, fmtQty(l.expectedQty)],
                  inputs: [{ name: "counted", defaultValue: l.countedQty === null ? "" : qtyInput(l.countedQty), testId: `counted-${l.stockItem.part.partNumber}` }],
                }))}
              />
            </>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" data-testid="count-lines">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">{t("bin")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("partNumber")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("description")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("expected")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("counted")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("varianceQty")}</th>
                    <th className="py-1.5 text-right font-medium">{t("variance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-xs">{l.stockItem.bin ?? "—"}</td>
                      <td className="py-1.5 pr-3">
                        <Link className="text-primary hover:underline" href={`/parts/stock/${l.stockItemId}`}>
                          {l.stockItem.part.partNumber}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3">{l.stockItem.part.description}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(l.expectedQty)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{l.countedQty === null ? "—" : fmtQty(l.countedQty)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{l.varianceQty === null ? "—" : fmtQty(l.varianceQty)}</td>
                      <td className="py-1.5 text-right tabular-nums">{l.varianceValueCents === null ? "—" : formatMoney(l.varianceValueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title={t("cycleCount")}>
          <Fields
            items={[
              { label: t("site"), value: count.site.name },
              { label: t("date"), value: formatDate(count.createdOn) },
              { label: t("progress"), value: `${d.counted} / ${d.lines.length}` },
              { label: t("postedOn"), value: count.postedOn ? formatDate(count.postedOn) : null },
              { label: t("variance"), value: count.status === "POSTED" ? <span data-testid="count-variance">{formatMoney(count.varianceValueCents)}</span> : null },
              {
                label: t("entry"),
                value: d.entry ? (
                  <EntryLink id={d.entry.id} number={d.entry.number} />
                ) : null,
              },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
