import { query } from "@/lib/session";
import { getAccount } from "@/modules/accounting";
import { PageHeader, Section } from "@/components/shared/page-header";
import { AccountForm } from "../../account-form";

export default async function EditAccountPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const a = await query((ctx) => getAccount(ctx, code), { resource: "accounting.chart", action: "edit" });
  return (
    <div>
      <PageHeader title={`${a.code} ${a.label}`} backHref={`/accounting/chart/${code}`} />
      <Section>
        <AccountForm initial={a} />
      </Section>
    </div>
  );
}
