import type { ServiceContext } from "@/lib/context";
import { parseInput } from "@/lib/validation";
import { supplierInputSchema, type SupplierInput } from "../schemas/supplier";
import { nextDocumentNumber } from "./numbering";

declare module "@/lib/events" {
  interface DomainEventMap {
    SupplierCreated: { supplierId: string; number: string };
  }
}

/** Suppliers are group-wide third parties (OEMs, parts wholesalers, sublet garages…). */
export async function createSupplier(ctx: ServiceContext, input: SupplierInput) {
  ctx.require("accounting.chart", "create");
  const data = parseInput(supplierInputSchema, input);
  const number = await nextDocumentNumber(ctx, { docType: "SUPPLIER", scope: "GROUP" });
  const supplier = await ctx.tx.supplier.create({ data: { ...data, number, accountCode: `401${number}` } });
  await ctx.audit({ action: "supplier.create", entityType: "Supplier", entityId: supplier.id, after: supplier });
  await ctx.emit({
    type: "SupplierCreated",
    aggregateType: "Supplier",
    aggregateId: supplier.id,
    payload: { supplierId: supplier.id, number },
  });
  return supplier;
}
