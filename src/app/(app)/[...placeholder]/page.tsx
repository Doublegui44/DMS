import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Construction } from "lucide-react";
import { getRequestContext } from "@/lib/session";
import { can } from "@/lib/rbac";
import { findNavItem } from "@/components/shell/nav";
import { PageHeader } from "@/components/shared/page-header";

/** Screens planned in later phases: visible in the menu (permission-filtered), with a placeholder. */
export default async function PlaceholderPage({ params }: { params: Promise<{ placeholder: string[] }> }) {
  const { placeholder } = await params;
  const path = `/${placeholder.join("/")}`;
  const found = findNavItem(path);
  if (!found || !found.item.phase) notFound();
  const { actor } = await getRequestContext();
  if (!can(actor.permissions, found.item.resource, "view")) notFound();

  const t = await getTranslations();
  return (
    <div>
      <PageHeader title={t(`nav.${found.item.key}`)} subtitle={t(`nav.${found.group.key}`)} />
      <div className="grid place-items-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
        <Construction className="mb-3 size-8 text-muted-foreground" />
        <p className="text-sm font-medium">{t("common.comingSoon", { phase: found.item.phase })}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {t("common.comingSoonBody", { module: t(`nav.${found.group.key}`), phase: found.item.phase })}
        </p>
      </div>
    </div>
  );
}
