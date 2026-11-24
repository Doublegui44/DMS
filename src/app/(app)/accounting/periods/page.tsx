import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getUiLocale } from "@/i18n/current";
import { translateServerMessage } from "@/i18n/server-messages";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatDate, isoDate } from "@/lib/dates";
import { getPeriodChecklist, listPeriods, periodLabel } from "@/modules/accounting";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { cn } from "@/lib/utils";
import { lockPeriodAction } from "../actions";
import { ReopenForm } from "./reopen-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("fiscalPeriods");

/** The reports an accountant reviews before locking a month. */
function closePack(p: { year: number; month: number; startDate: Date; endDate: Date }) {
  const from = isoDate(p.startDate);
  const to = isoDate(p.endDate);
  const period = `${p.year}-${String(p.month).padStart(2, "0")}`;
  return [
    { key: "trialBalance", label: "trialBalance", href: `/accounting/trial-balance?from=${from}&to=${to}` },
    { key: "pnl", label: "profitAndLoss", href: `/accounting/reports/pnl?from=${from}&to=${to}` },
    { key: "vat", label: "vatReturn", href: `/accounting/reports/vat?period=${period}` },
    { key: "receivables", label: "receivablesAgeing", href: "/accounting/reports/ageing?type=receivables" },
  ] as const;
}

export default async function PeriodsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations("accounting");
  const tu = await getTranslations("ui");
  const { actor } = await getRequestContext();
  const periods = await query((ctx) => listPeriods(ctx), { resource: "accounting.period", action: "view" });
  // Default selection: the earliest open period that has ended.
  const selectedId = sp.period ?? [...periods].reverse().find((p) => p.status === "OPEN" && p.entryCount > 0)?.id;
  const selected = periods.find((p) => p.id === selectedId);
  const locale = await getUiLocale();
  const checklist = selected ? await query((ctx) => getPeriodChecklist(ctx, selected.id)) : null;

  return (
    <div>
      <PageHeader title={t("periods")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Section>
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-3">{t("period")}</th>
                <th className="py-1.5 pr-3">{t("status")}</th>
                <th className="py-1.5 pr-3 text-right">{t("entriesCount")}</th>
                <th className="py-1.5">{t("lockedAt")}</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className={cn("border-b last:border-0", p.id === selectedId && "bg-muted/60")}>
                  <td className="py-1.5 pr-3">
                    <Link href={`?period=${p.id}`} className="font-medium text-primary hover:underline">
                      {periodLabel(p)}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3">
                    <StatusBadge status={p.status} label={t(`statuses.${p.status}`)} />
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{p.entryCount}</td>
                  <td className="py-1.5">{p.lockedAt ? formatDate(p.lockedAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title={selected ? `${t("checklist")} — ${periodLabel(selected)}` : t("checklist")}>
          {!selected || !checklist ? (
            <p className="text-sm text-muted-foreground">{t("selectPeriod")}</p>
          ) : (
            <div className="space-y-4">
              <ul className="space-y-2 text-sm" data-testid="close-checklist">
                {checklist.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    ) : c.blocking ? (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    )}
                    <span>
                      {translateServerMessage(c.message, locale)}
                      {!c.ok && <span className="ml-1 text-xs text-muted-foreground">({c.blocking ? t("blocking") : t("warning")})</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <div data-testid="close-pack">
                <div className="text-xs font-medium text-muted-foreground">{t("closePack")}</div>
                <p className="mb-1.5 text-xs text-muted-foreground">{t("closePackHint")}</p>
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {closePack(selected).map((l) => (
                    <li key={l.key}>
                      <Link href={l.href} className="text-primary hover:underline" data-testid={`close-pack-${l.key}`}>
                        {t(l.label)} →
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              {selected.status === "OPEN" && can(actor.permissions, "accounting.period", "validate") && (
                <ActionButton
                  action={lockPeriodAction.bind(null, selected.id)}
                  label={t("lock")}
                  successMessage={tu("periodLocked")}
                  confirm={`Lock ${periodLabel(selected)}? No entry can be posted in it afterwards.`}
                />
              )}
              {selected.status === "LOCKED" && can(actor.permissions, "accounting.period", "delete") && <ReopenForm periodId={selected.id} />}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
