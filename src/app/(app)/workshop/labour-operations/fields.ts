import type { FieldSpec } from "@/components/shared/spec-form";

type T = (key: string) => string;

export function operationFields(t: T, brands: { value: string; label: string }[], op?: { code: string; label: string; category: string; brandId: string | null; standardCentiHours: number; active: boolean }): FieldSpec[] {
  return [
    { name: "code", label: t("code"), defaultValue: op?.code, placeholder: "OIL-SVC" },
    { name: "category", label: t("category"), defaultValue: op?.category, placeholder: "SERVICE" },
    { name: "label", label: t("description"), defaultValue: op?.label, wide: true },
    { name: "brandId", label: t("brand"), type: "select", options: brands, empty: t("allMakes"), defaultValue: op?.brandId ?? "" },
    { name: "standardCentiHours", label: t("standardHours"), defaultValue: op ? String(op.standardCentiHours / 100) : "", placeholder: "0.8" },
    { name: "active", label: t("status"), type: "checkboxes", options: [{ value: "on", label: t("active") }], defaultValues: !op || op.active ? ["on"] : [] },
  ];
}
