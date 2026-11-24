import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/shared/page-header";
import { saveVehicleAction } from "../actions";
import { VehicleForm } from "../vehicle-form";
import { vehicleFormOptions } from "../form-data";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("newCustomerVehicle");

export default async function NewVehiclePage() {
  const t = await getTranslations();
  const { actor, sites, siteId } = await getRequestContext();
  const opts = await query(vehicleFormOptions, { resource: "vehicle", action: "create" });
  return (
    <div>
      <PageHeader title={t("vehicle.new")} backHref="/vehicles" />
      <VehicleForm
        action={saveVehicleAction.bind(null, null)}
        initial={{ stockType: "NONE", status: "CUSTOMER", siteId, fuel: "PETROL" }}
        stockLinks={{
          vn: can(actor.permissions, "sales.vn_stock", "create", siteId),
          vo: can(actor.permissions, "sales.vo_stock", "create", siteId),
        }}
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
