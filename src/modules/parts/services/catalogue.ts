/** Parts catalogue: references, supersessions and the discount matrix. */
import type { ServiceContext } from "@/lib/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { resolveReplacement } from "../domain/catalogue";
import {
  discountRatesInputSchema,
  partInputSchema,
  supersessionInputSchema,
  type DiscountRatesInput,
  type PartInput,
  type SupersessionInput,
} from "../schemas/parts";
import { partByNumber } from "./shared";

async function checkReferences(ctx: ServiceContext, data: { supplierId: string; discountCodeId: string; brandId?: string | null }) {
  if (!(await ctx.tx.supplier.findUnique({ where: { id: data.supplierId }, select: { id: true } }))) {
    throw new ValidationError("Unknown supplier", { supplierId: ["Choose a supplier"] });
  }
  if (!(await ctx.tx.discountCode.findUnique({ where: { id: data.discountCodeId }, select: { id: true } }))) {
    throw new ValidationError("Unknown discount code", { discountCodeId: ["Choose a discount code"] });
  }
  if (data.brandId && !(await ctx.tx.brand.findUnique({ where: { id: data.brandId }, select: { id: true } }))) {
    throw new ValidationError("Unknown brand", { brandId: ["Choose a brand"] });
  }
}

export async function createPart(ctx: ServiceContext, input: PartInput) {
  const data = parseInput(partInputSchema, input);
  ctx.require("parts.part", "create");
  if (await ctx.tx.part.findUnique({ where: { partNumber: data.partNumber }, select: { id: true } })) {
    throw new ValidationError(`${data.partNumber} is already in the catalogue`, { partNumber: ["Already in the catalogue"] });
  }
  await checkReferences(ctx, data);
  const part = await ctx.tx.part.create({ data: { ...data, brandId: data.brandId ?? null } });
  await ctx.audit({ action: "part.create", entityType: "Part", entityId: part.id, after: data, siteId: null });
  return part;
}

/** Edit a reference. Its number is its identity: a new number is a new part, superseding this one. */
export async function updatePart(ctx: ServiceContext, id: string, input: PartInput) {
  const before = await ctx.tx.part.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Part", id);
  const data = parseInput(partInputSchema, { ...input, partNumber: before.partNumber });
  ctx.require("parts.part", "edit");
  await checkReferences(ctx, data);
  const rest: Omit<typeof data, "partNumber"> & { partNumber?: string } = { ...data };
  delete rest.partNumber;
  const part = await ctx.tx.part.update({ where: { id }, data: { ...rest, brandId: rest.brandId ?? null } });
  await ctx.audit({ action: "part.update", entityType: "Part", entityId: id, before, after: rest, siteId: null });
  return part;
}

/**
 * Record that a part is replaced by another from a date. Counter sales and orders then use the
 * successor; stock already held under the old number is still sold and counted under it.
 */
export async function supersedePart(ctx: ServiceContext, oldPartId: string, input: SupersessionInput) {
  const data = parseInput(supersessionInputSchema, input);
  ctx.require("parts.part", "edit");
  const old = await ctx.tx.part.findUnique({ where: { id: oldPartId } });
  if (!old) throw new NotFoundError("Part", oldPartId);
  const next = await partByNumber(ctx.tx, data.newPartNumber, "newPartNumber");
  if (next.id === old.id) throw new ValidationError("A part cannot replace itself", { newPartNumber: ["Choose another part"] });
  const effectiveOn = data.effectiveOn ?? ctx.businessDate;
  const links = await ctx.tx.partSupersession.findMany({ where: { oldPartId: { not: old.id } }, select: { oldPartId: true, newPartId: true } });
  const byOld = new Map(links.map((l) => [l.oldPartId, { newPartId: l.newPartId, effectiveOn: new Date(0) }]));
  const chain = resolveReplacement(next.id, (pid) => byOld.get(pid), new Date(8.64e15)).chain;
  if (chain.includes(old.id)) throw new ValidationError(`${next.partNumber} is already replaced by ${old.partNumber}`, { newPartNumber: ["This would make a loop"] });
  const link = await ctx.tx.partSupersession.upsert({
    where: { oldPartId: old.id },
    create: { oldPartId: old.id, newPartId: next.id, effectiveOn },
    update: { newPartId: next.id, effectiveOn },
  });
  await ctx.audit({ action: "part.supersede", entityType: "Part", entityId: old.id, after: { replacedBy: next.partNumber, effectiveOn }, siteId: null });
  return link;
}

export async function removeSupersession(ctx: ServiceContext, oldPartId: string) {
  ctx.require("parts.part", "edit");
  const link = await ctx.tx.partSupersession.findUnique({ where: { oldPartId } });
  if (!link) throw new NotFoundError("Supersession", oldPartId);
  await ctx.tx.partSupersession.delete({ where: { oldPartId } });
  await ctx.audit({ action: "part.unsupersede", entityType: "Part", entityId: oldPartId, before: link, siteId: null });
}

/** Save rows of the discount matrix (discount code × price class). */
export async function setDiscountRates(ctx: ServiceContext, input: DiscountRatesInput) {
  const data = parseInput(discountRatesInputSchema, input);
  ctx.require("parts.part", "edit");
  const before = await ctx.tx.discountRate.findMany({ where: { discountCodeId: { in: [...new Set(data.rates.map((r) => r.discountCodeId))] } } });
  for (const r of data.rates) {
    await ctx.tx.discountRate.upsert({
      where: { discountCodeId_priceClass: { discountCodeId: r.discountCodeId, priceClass: r.priceClass } },
      create: r,
      update: { discountBp: r.discountBp },
    });
  }
  await ctx.audit({
    action: "discount.update",
    entityType: "DiscountMatrix",
    entityId: "parts",
    before: before.map((r) => ({ discountCodeId: r.discountCodeId, priceClass: r.priceClass, discountBp: r.discountBp })),
    after: data.rates,
    siteId: null,
  });
  return data.rates.length;
}
