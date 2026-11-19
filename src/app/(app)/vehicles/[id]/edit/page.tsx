import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { getVehicle } from "@/modules/core";
import { PageHeader } from "@/components/shared/page-header";
import { saveVehicleAction } from "../../actions";
import { VehicleForm } from "../../vehicle-form";
import { vehicleFormOptions } from "../../form-data";

export const metadata = { title: "Edit vehicle" };

const euros = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const { sites } = await getRequestContext();
  const [v, opts] = await Promise.all([
    query((ctx) => getVehicle(ctx, id), { resource: "vehicle", action: "edit" }),
    query(vehicleFormOptions),
  ]);
  return (
    <div>
      <PageHeader title={`${t("vehicle.edit")} · ${v.make} ${v.model}`} backHref={`/vehicles/${id}`} />
      <VehicleForm
        action={saveVehicleAction.bind(null, id)}
        initial={{
          ...v,
          firstRegistration: isoDate(v.firstRegistration),
          stockInDate: isoDate(v.stockInDate),
          listPriceEuros: euros(v.listPriceCents),
          stockValueEuros: euros(v.stockValueCents),
        }}
        sites={sites}
        brands={opts.brands}
        customers={opts.customers}
        isEdit
        submitLabel={t("common.save")}
        cancelHref={`/vehicles/${id}`}
      />
    </div>
  );
}
