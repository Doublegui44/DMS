import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { PageHeader, Section } from "@/components/shared/page-header";
import { AccountForm } from "../account-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("newAccount");

export default async function NewAccountPage() {
  const t = await getTranslations("accounting");
  await query(async () => null, { resource: "accounting.chart", action: "create" });
  return (
    <div>
      <PageHeader title={t("newAccount")} backHref="/accounting/chart" />
      <Section>
        <AccountForm />
      </Section>
    </div>
  );
}
