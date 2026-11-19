import type { ServiceContext } from "@/lib/context";
import { listBrands } from "@/modules/core";

/** Reference lists for the vehicle form. */
export async function vehicleFormOptions(ctx: ServiceContext) {
  const [brands, customers] = await Promise.all([
    listBrands(ctx),
    ctx.tx.customer.findMany({
      where: { kind: { not: "OEM" } },
      select: { id: true, displayName: true, number: true },
      orderBy: { displayName: "asc" },
    }),
  ]);
  return {
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
    customers: customers.map((c) => ({ id: c.id, label: `${c.displayName} (${c.number})` })),
  };
}
