/** Labour operation catalogue (standard times) and technicians' capacity. */
import type { ServiceContext } from "@/lib/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { labourOperationInputSchema, technicianInputSchema, type LabourOperationInput, type TechnicianInput } from "../schemas/workshop";

export async function createLabourOperation(ctx: ServiceContext, input: LabourOperationInput) {
  const data = parseInput(labourOperationInputSchema, input);
  ctx.require("workshop.labour_catalogue", "create");
  if (await ctx.tx.labourOperation.findUnique({ where: { code: data.code } })) throw new ValidationError("Code already used", { code: ["Already in the catalogue"] });
  const op = await ctx.tx.labourOperation.create({
    data: { code: data.code, label: data.label, category: data.category, brandId: data.brandId ?? null, standardCentiHours: data.standardCentiHours, active: data.active ?? true },
  });
  await ctx.audit({ action: "labour_operation.create", entityType: "LabourOperation", entityId: op.id, after: op });
  return op;
}

export async function updateLabourOperation(ctx: ServiceContext, id: string, input: LabourOperationInput) {
  const data = parseInput(labourOperationInputSchema, input);
  ctx.require("workshop.labour_catalogue", "edit");
  const before = await ctx.tx.labourOperation.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("LabourOperation", id);
  if (data.code !== before.code) throw new ConflictError("An operation's code cannot change");
  const op = await ctx.tx.labourOperation.update({
    where: { id },
    data: { label: data.label, category: data.category, brandId: data.brandId ?? null, standardCentiHours: data.standardCentiHours, active: data.active ?? false },
  });
  await ctx.audit({ action: "labour_operation.update", entityType: "LabourOperation", entityId: id, before, after: op });
  return op;
}

/** Make a user a technician of a site's workshop, or change their daily capacity. */
export async function setTechnician(ctx: ServiceContext, input: TechnicianInput) {
  const data = parseInput(technicianInputSchema, input);
  ctx.require("workshop.appointment", "validate", data.siteId);
  const user = await ctx.tx.user.findUnique({ where: { id: data.userId } });
  if (!user) throw new NotFoundError("User", data.userId);
  const before = await ctx.tx.technician.findUnique({ where: { userId: data.userId } });
  const values = { siteId: data.siteId, dailyCapacityCentiHours: data.dailyCapacityCentiHours, active: data.active ?? true };
  const tech = await ctx.tx.technician.upsert({ where: { userId: data.userId }, create: { userId: data.userId, ...values }, update: values });
  await ctx.audit({ action: "technician.set", entityType: "User", entityId: data.userId, before, after: tech, siteId: data.siteId });
  return tech;
}
