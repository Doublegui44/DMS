import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listWarrantyClaims } from "@/modules/workshop";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { SpecForm } from "@/components/shared/spec-form";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/shared/form";
import { decideClaimAction, warrantyRemittanceAction } from "../actions";

export const metadata = { title: "Warranty claims" };

const STATUSES = ["SUBMITTED", "ACCEPTED", "REJECTED", "PAID"] as const;

export default async function WarrantyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("workshop");
  const { siteId, sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "submittedOn", dir: "desc", pageSize: 50 });
  const d = await query((ctx) => listWarrantyClaims(ctx, p), { resource: "workshop.warranty", action: "view" });
  const payable = d.rows.filter((c) => (c.status === "SUBMITTED" || c.status === "ACCEPTED") && c.siteId === (p.filters.site ?? siteId));
  return (
    <div className="space-y-4">
      <PageHeader title={t("warranty")} subtitle={t("warrantyHint", { count: d.openCount, amount: formatMoney(d.openCents) })} />
      <Section>
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          <input name="q" defaultValue={p.q} placeholder={t("searchClaim")} className={`${inputClass} max-w-56`} />
          <select name="status" defaultValue={p.filters.status ?? ""} className={`${inputClass} max-w-44`}>
            <option value="">{t("allStatuses")}</option>
            <option value="OPEN">{t("openClaims")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`claimStatuses.${s}`)}
              </option>
            ))}
          </select>
          <select name="site" defaultValue={p.filters.site ?? ""} className={`${inputClass} max-w-44`}>
            <option value="">{t("allSites")}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline">
            {t("show")}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/api/export/warranty-claims" prefetch={false}>
              {t("exportCsv")}
            </Link>
          </Button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" data-testid="claims">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-3 font-medium">{t("number")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("submittedOn")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("brand")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("repairOrder")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("job")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("invoice")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("claimed")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("status")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("site")}</th>
                {d.canValidate && <th />}
              </tr>
            </thead>
            <tbody>
              {d.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-3 text-center text-muted-foreground">
                    {t("noClaims")}
                  </td>
                </tr>
              )}
              {d.rows.map((c) => (
                <tr key={c.id} className="border-b last:border-0" data-claim={c.number}>
                  <td className="py-1.5 pr-3 font-mono text-xs">
                    <Link href={`/api/pdf/warranty-claim/${c.id}`} target="_blank" prefetch={false} className="text-primary hover:underline" title="PDF">
                      {c.number}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatDate(c.submittedOn)}</td>
                  <td className="py-1.5 pr-3">{c.brand.name}</td>
                  <td className="py-1.5 pr-3">
                    <Link className="text-primary hover:underline" href={`/workshop/repair-orders/${c.ro.id}`}>
                      {c.ro.number}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {c.ro.vehicle.make} {c.ro.vehicle.model} {c.ro.vehicle.registration ?? ""}
                    </div>
                  </td>
                  <td className="py-1.5 pr-3">{c.job.description}</td>
                  <td className="py-1.5 pr-3">
                    <Link className="text-primary hover:underline" href={`/accounting/invoices/${c.invoice.id}`}>
                      {c.invoice.number}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(c.claimedCents)}</td>
                  <td className="py-1.5 pr-3">
                    <StatusBadge status={c.status} label={t(`claimStatuses.${c.status}`)} />
                  </td>
                  <td className="py-1.5 pr-3">{c.site.code}</td>
                  {d.canValidate && (
                    <td className="py-1 text-right whitespace-nowrap">
                      {c.status === "SUBMITTED" && (
                        <span className="flex justify-end gap-1">
                          <ActionButton action={decideClaimAction.bind(null, c.id, "ACCEPTED")} label={t("accept")} variant="outline" />
                          <ActionButton action={decideClaimAction.bind(null, c.id, "REJECTED")} label={t("reject")} variant="ghost" confirm={t("rejectConfirm")} />
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.total > d.rows.length && <p className="mt-2 text-xs text-muted-foreground">{t("showingFirst", { shown: d.rows.length, total: d.total })}</p>}
      </Section>
      {d.canValidate && payable.length > 0 && (
        <Section title={t("remittance")}>
          <p className="mb-3 text-xs text-muted-foreground">{t("remittanceHint")}</p>
          <div data-testid="remittance">
            <SpecForm
              action={warrantyRemittanceAction}
              submitLabel={t("recordRemittance")}
              columns={1}
              fields={[
                { name: "siteId", label: "", type: "hidden", defaultValue: payable[0].siteId },
                { name: "claimIds", label: t("claims"), type: "checkboxes", options: payable.map((c) => ({ value: c.id, label: `${c.number} · ${c.brand.name} · ${formatMoney(c.invoice.totalInclVatCents - c.invoice.paidCents)}` })) },
                { name: "reference", label: t("reference"), placeholder: t("optional") },
              ]}
            />
          </div>
        </Section>
      )}
    </div>
  );
}
