import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { FUELS, getVoFormData } from "@/modules/sales";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { purchaseVoAction } from "../../actions";

export const metadata = { title: "Buy a used car" };

export default async function VoPurchasePage() {
  const t = await getTranslations("sales");
  const { sites, siteId } = await getRequestContext();
  const data = await query((ctx) => getVoFormData(ctx), { resource: "sales.vo_stock", action: "create" });
  return (
    <div className="max-w-4xl">
      <PageHeader title={t("buyUsedCar")} subtitle={t("buyUsedCarHint")} backHref="/sales/vo-stock" />
      <Section>
        <SpecForm
          action={purchaseVoAction}
          submitLabel={t("recordPurchase")}
          successMessage={t("purchaseRecorded")}
          cancelHref="/sales/vo-stock"
          columns={3}
          fields={[
            { name: "siteId", label: t("site"), type: "select", options: sites.map((s) => ({ value: s.id, label: s.name })), defaultValue: siteId ?? sites[0]?.id },
            { name: "source", label: t("seller"), type: "select", options: ["PRIVATE", "PROFESSIONAL"].map((s) => ({ value: s, label: t(`purchaseSources.${s}`) })), defaultValue: "PRIVATE" },
            { name: "vatRegime", label: t("resaleRegime"), type: "select", options: ["MARGIN", "STANDARD"].map((r) => ({ value: r, label: t(`vatRegimes.${r}`) })), defaultValue: "MARGIN", hint: t("resaleRegimeHint") },
            { name: "customerId", label: t("privateSeller"), type: "select", options: data.sellers, empty: "—", hint: t("privateSellerHint") },
            { name: "supplierId", label: t("professionalSeller"), type: "select", options: data.suppliers, empty: "—" },
            { name: "supplierReference", label: t("supplierInvoiceRef"), placeholder: t("optional") },
            { name: "priceCents", label: t("purchasePriceExcl"), type: "money", testId: "vo-price" },
            { name: "paymentMethod", label: t("paymentToSeller"), type: "select", options: ["TRANSFER", "CHEQUE"].map((m) => ({ value: m, label: t(`paymentMethods.${m}`) })), defaultValue: "TRANSFER" },
            { name: "listPriceCents", label: t("askingPriceIncl"), type: "money", placeholder: t("optional") },
            { name: "vehicle.vin", label: "VIN", testId: "vo-vin" },
            { name: "vehicle.registration", label: t("registration"), placeholder: "AB-123-CD" },
            { name: "vehicle.brandId", label: t("brand"), type: "select", options: data.brands, empty: t("otherBrand") },
            { name: "vehicle.make", label: t("make"), testId: "vo-make" },
            { name: "vehicle.model", label: t("model"), testId: "vo-model" },
            { name: "vehicle.version", label: t("version") },
            { name: "vehicle.firstRegistration", label: t("firstRegistration"), type: "date" },
            { name: "vehicle.mileage", label: t("mileage"), type: "number", testId: "vo-mileage" },
            { name: "vehicle.fuel", label: t("fuel"), type: "select", options: FUELS.map((f) => ({ value: f, label: t(`fuels.${f}`) })), defaultValue: "DIESEL" },
            { name: "vehicle.co2", label: "CO₂ (g/km)", type: "number" },
            { name: "vehicle.powerHp", label: t("power"), type: "number" },
            { name: "vehicle.colour", label: t("colour") },
          ]}
        />
      </Section>
    </div>
  );
}
