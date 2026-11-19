import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { PageHeader } from "@/components/shared/page-header";
import { saveVehicleAction } from "../actions";
import { VehicleForm } from "../vehicle-form";
import { vehicleFormOptions } from "../form-data";

export const metadata = { title: "New vehicle" };

export default async function NewVehiclePage() {
  const t = await getTranslations();
  const { sites, siteId } = await getRequestContext();
  const opts = await query(vehicleFormOptions, { resource: "vehicle", action: "create" });
  return (
    <div>
      <PageHeader title={t("vehicle.new")} backHref="/vehicles" />
      <VehicleForm
        action={saveVehicleAction.bind(null, null)}
        initial={{ stockType: "VN", status: "ORDERED", siteId, fuel: "PETROL" }}
        sites={sites}
        brands={opts.brands}
        customers={opts.customers}
        isEdit={false}
        submitLabel={t("common.create")}
        cancelHref="/vehicles"
      />
    </div>
  );
}
