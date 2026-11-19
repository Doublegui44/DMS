import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { getCustomer, getTimeline } from "@/modules/core";
import { getCustomerAccount } from "@/modules/accounting";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Timeline } from "@/components/shared/timeline";
import { Button } from "@/components/ui/button";
import { ContactsPanel } from "./contacts-panel";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const { actor } = await getRequestContext();
  const [c, timeline, account] = await Promise.all([
    query((ctx) => getCustomer(ctx, id)),
    query((ctx) => getTimeline(ctx, "Customer", id)),
    query((ctx) => getCustomerAccount(ctx, id)),
  ]);
  const canEdit = can(actor.permissions, "customer", "edit");
  const yes = t("common.yes");
  const no = t("common.no");

  return (
    <div>
      <PageHeader
        title={c.displayName}
        subtitle={`${c.number} · ${t("customer.account")} ${c.accountCode}`}
        backHref="/customers"
        badges={
          <>
            <StatusBadge status={c.kind} label={t(`customer.kinds.${c.kind}`)} />
            <StatusBadge status="gray" tone="gray" label={t(`customer.priceClasses.${c.priceClass}`)} />
          </>
        }
        actions={
          canEdit && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/customers/${id}/edit`}>
                <Pencil /> {t("common.edit")}
              </Link>
            </Button>
          )
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Section title={t("common.details")}>
            <Fields
              items={[
                ...(c.kind === "INDIVIDUAL"
                  ? [{ label: t("customer.name"), value: [c.title, c.firstName, c.lastName].filter(Boolean).join(" ") }]
                  : [
                      { label: t("customer.siren"), value: c.siren },
                      { label: t("customer.vatNumber"), value: c.vatNumber },
                    ]),
                { label: t("customer.email"), value: c.email },
                { label: t("customer.phone"), value: c.phone },
                { label: t("customer.address"), value: [c.address, `${c.postalCode ?? ""} ${c.city ?? ""}`.trim(), c.countryCode].filter(Boolean).join(", ") },
                { label: t("customer.homeSite"), value: c.homeSite?.name },
                { label: t("customer.paymentTerms"), value: c.paymentTermsDays },
                {
                  label: t("customer.consents"),
                  value: `${t("customer.consentEmail")}: ${c.consentEmail ? yes : no} · ${t("customer.consentSms")}: ${c.consentSms ? yes : no} · ${t("customer.consentPhone")}: ${c.consentPhone ? yes : no}`,
                },
                ...(c.notes ? [{ label: t("customer.notes"), value: c.notes }] : []),
              ]}
            />
          </Section>

          {c.kind !== "INDIVIDUAL" && (
            <Section title={t("customer.contacts")}>
              <ContactsPanel
                customerId={c.id}
                canEdit={canEdit}
                contacts={c.contacts.map((ct) => ({
                  id: ct.id,
                  name: `${ct.firstName} ${ct.lastName}`,
                  role: ct.role,
                  email: ct.email,
                  phone: ct.phone,
                  isPrimary: ct.isPrimary,
                }))}
              />
            </Section>
          )}

          <Section title={`${t("customer.vehicles")} (${c.vehicles.length})`}>
            {c.vehicles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("common.noResults")}</p>
            ) : (
              <ul className="divide-y text-[13px]">
                {c.vehicles.map((v) => (
                  <li key={v.id} className="flex items-center justify-between py-1.5">
                    <Link href={`/vehicles/${v.id}`} className="font-medium text-primary hover:underline">
                      {v.make} {v.model} <span className="font-normal text-muted-foreground">{v.version}</span>
                    </Link>
                    <span className="flex items-center gap-3 text-muted-foreground">
                      <span className="font-mono text-xs">{v.registration ?? v.vin}</span>
                      <span className="tabular-nums">{v.mileage.toLocaleString("en-GB")} km</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="space-y-4">
          {account && (
            <Section
              title={t("accounting.accountSummary")}
              actions={
                <Link href={`/accounting/ledgers/customer/${c.id}`} className="text-xs text-primary hover:underline">
                  {t("accounting.statement")} →
                </Link>
              }
            >
              <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("accounting.receivable")}</dt>
                  <dd className="font-semibold tabular-nums" data-testid="customer-balance">{formatMoney(account.balanceCents)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("accounting.overdueAmount")}</dt>
                  <dd className={`font-semibold tabular-nums ${account.overdueCents > 0 ? "text-destructive" : ""}`}>{formatMoney(account.overdueCents)}</dd>
                </div>
              </dl>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t("accounting.recentInvoices")}</h3>
              {account.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("common.noResults")}</p>
              ) : (
                <ul className="divide-y text-[13px]">
                  {account.recent.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 py-1">
                      <Link href={`/accounting/invoices/${i.id}`} className="font-mono text-xs text-primary hover:underline">
                        {i.number}
                      </Link>
                      <span className="text-xs text-muted-foreground">{formatDate(i.issueDate)}</span>
                      <StatusBadge status={i.status} label={t(`accounting.statuses.${i.status}`)} />
                      <span className="tabular-nums">{formatMoney(i.kind === "CREDIT_NOTE" ? -i.totalInclVatCents : i.totalInclVatCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          <Section title={t("common.timeline")}>
            <Timeline items={timeline} />
          </Section>
        </div>
      </div>
    </div>
  );
}
