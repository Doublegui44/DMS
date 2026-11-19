import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { isoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getParty, getPartyStatement } from "@/modules/accounting";
import { PageHeader, Section } from "@/components/shared/page-header";
import { Statement } from "./statement";

export default async function PartyLedgerPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  if (type !== "customer" && type !== "supplier") notFound();
  const partyType = type === "customer" ? "CUSTOMER" : "SUPPLIER";
  const t = await getTranslations("accounting");
  const { actor } = await getRequestContext();
  const [lines, party] = await Promise.all([
    query((ctx) => getPartyStatement(ctx, partyType, id)),
    query((ctx) => getParty(ctx, partyType, id)),
  ]);
  if (!party) notFound();
  const balance = lines.at(-1)?.runningCents ?? 0;
  return (
    <div>
      <PageHeader
        title={party.name}
        subtitle={`${t("statement")} · ${party.accountCode} · ${t("balance")} ${formatMoney(balance)}`}
        backHref={`/accounting/ledgers?type=${type}`}
        actions={
          partyType === "CUSTOMER" && (
            <Link href={`/customers/${id}`} className="text-sm text-primary hover:underline">
              {t("customer")} →
            </Link>
          )
        }
      />
      <Section>
        <Statement
          canLetter={can(actor.permissions, "accounting.entry", "edit")}
          partyId={id}
          lines={lines.map((l) => ({
            id: l.id,
            date: isoDate(l.entryDate),
            entryId: l.entry.id,
            entryNumber: l.entry.number,
            accountCode: l.accountCode,
            label: l.label,
            debitCents: l.debitCents,
            creditCents: l.creditCents,
            runningCents: l.runningCents,
            letteringCode: l.letteringCode,
          }))}
        />
      </Section>
    </div>
  );
}
