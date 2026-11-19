import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";

export const metadata = { title: "Access denied" };

export default async function ForbiddenPage() {
  const t = await getTranslations();
  return (
    <div className="grid place-items-center rounded-lg border border-dashed bg-card px-6 py-16 text-center" data-testid="forbidden">
      <ShieldAlert className="mb-3 size-8 text-muted-foreground" />
      <p className="text-sm font-medium">{t("errors.forbidden")}</p>
      <Link href="/dashboard" className="mt-2 text-sm text-primary hover:underline">
        {t("nav.dashboard")}
      </Link>
    </div>
  );
}
