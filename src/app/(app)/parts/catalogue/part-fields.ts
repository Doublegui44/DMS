import type { FieldSpec } from "@/components/shared/spec-form";
import { centsToInput } from "../format";

type Option = { value: string; label: string };
type Translate = (key: string) => string;

/** Fields of the part form (create and edit share them; the number is fixed once created). */
export function partFields(
  t: Translate,
  form: { brands: Option[]; suppliers: Option[]; discountCodes: Option[]; families: string[]; units: string[] },
  part?: { partNumber: string; description: string; family: string; brandId: string | null; supplierId: string; discountCodeId: string; unit: string; retailPriceCents: number; listCostCents: number; active: boolean },
): FieldSpec[] {
  return [
    part
      ? { name: "partNumber", label: t("partNumber"), type: "hidden", defaultValue: part.partNumber }
      : { name: "partNumber", label: t("partNumber"), placeholder: "1609438180", hint: t("partNumberHint"), testId: "part-number" },
    { name: "description", label: t("description"), defaultValue: part?.description, testId: "part-description" },
    { name: "family", label: t("family"), defaultValue: part?.family, placeholder: form.families.slice(0, 3).join(", "), hint: t("familyHint") },
    { name: "brandId", label: t("brand"), type: "select", options: form.brands, empty: t("aftermarket"), defaultValue: part?.brandId ?? "" },
    { name: "supplierId", label: t("supplier"), type: "select", options: form.suppliers, empty: "—", defaultValue: part?.supplierId ?? "" },
    { name: "discountCodeId", label: t("discountCode"), type: "select", options: form.discountCodes, empty: "—", defaultValue: part?.discountCodeId ?? "" },
    { name: "unit", label: t("unit"), type: "select", options: form.units.map((u) => ({ value: u, label: t(`units.${u}`) })), defaultValue: part?.unit ?? "EA" },
    { name: "retailPriceCents", label: t("retailPriceExcl"), type: "money", defaultValue: centsToInput(part?.retailPriceCents), testId: "part-retail" },
    { name: "listCostCents", label: t("listCostExcl"), type: "money", defaultValue: centsToInput(part?.listCostCents), testId: "part-cost" },
    ...(part ? [{ name: "active", label: t("activeLabel"), type: "checkboxes" as const, options: [{ value: "on", label: t("activeHint") }], defaultValues: part.active ? ["on"] : [] }] : []),
  ];
}
