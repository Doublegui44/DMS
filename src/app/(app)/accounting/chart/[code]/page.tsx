import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { parseListParams } from "@/lib/list";
import { isoDate } from "@/lib/dates";
import { getAccount, listAccountLines } from "@/modules/accounting";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { DataTable, type Row } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";

export default async function AccountPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string>> }) {
  const { code } = await params;
  const p = parseListParams(await searchParams, { pageSize: 50 });
  const t = await getTranslations("accounting");
  const tu = await getTranslations("ui");
  const { actor } = await getRequestContext();
  const [a, lines] = await Promise.all([query((ctx) => getAccount(ctx, code)), query((ctx) => listAccountLines(ctx, code, p))]);
  const yes = "✓";
  const rows: Row[] = lines.rows.map((l) => ({
    id: l.id,
    entryDate: { kind: "date", iso: isoDate(l.entryDate) },
    entry: { kind: "link", href: `/accounting/entries/${l.entry.id}`, label: l.entry.number },
    label: l.label,
    department: l.departmentCode ? t(`departments.${l.departmentCode}`) : null,
    debit: { kind: "money", cents: l.debitCents || null },
    credit: { kind: "money", cents: l.creditCents || null },
    lettering: { kind: "mono", value: l.letteringCode },
  }));
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${a.code} ${a.label}`}
        subtitle={`${t("class")} ${a.class} · ${t(`types.${a.type}`)}`}
        backHref="/accounting/chart"
        actions={
          can(actor.permissions, "accounting.chart", "edit") && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/accounting/chart/${code}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          )
        }
      />
      <Section title={tu("accountSettings")}>
        <Fields
          items={[
            { label: t("postable"), value: a.postable ? yes : "—" },
            { label: t("active"), value: a.active ? yes : "—" },
            { label: t("requiresAnalytic"), value: a.requiresAnalytic ? yes : "—" },
            { label: t("isReceivable"), value: a.isReceivable ? yes : "—" },
            { label: t("isPayable"), value: a.isPayable ? yes : "—" },
            { label: t("mappings"), value: a.mappings.map((m) => `${m.key}${m.site ? ` (${m.site.code})` : ""}${m.brand ? ` (${m.brand.name})` : ""}`).join(", ") || "—" },
          ]}
        />
      </Section>
      <Section title={t("recentLines")}>
        <DataTable
          rows={rows}
          total={lines.total}
          page={lines.page}
          pageSize={lines.pageSize}
          columns={[
            { key: "entryDate", header: t("date") },
            { key: "entry", header: t("entry") },
            { key: "label", header: t("label") },
            { key: "department", header: t("department") },
            { key: "debit", header: t("debit"), align: "right" },
            { key: "credit", header: t("credit"), align: "right" },
            { key: "lettering", header: t("lettering") },
          ]}
        />
      </Section>
    </div>
  );
}
