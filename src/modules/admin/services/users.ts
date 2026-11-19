import bcrypt from "bcryptjs";
import { z } from "zod";
import type { ServiceContext } from "@/lib/context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";

export const userInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().optional().nullable(),
  isTechnician: z.boolean().default(false),
  password: z.string().min(8),
  roles: z
    .array(z.object({ roleKey: z.string(), siteId: z.string().nullable() }))
    .min(1, "A user needs at least one role"),
});
export type UserInput = z.input<typeof userInputSchema>;

export async function createUser(ctx: ServiceContext, input: UserInput) {
  ctx.require("admin.user", "create");
  const data = parseInput(userInputSchema, input);
  const exists = await ctx.tx.user.findUnique({ where: { email: data.email } });
  if (exists) throw new ConflictError(`User ${data.email} already exists`);
  const roles = await ctx.tx.role.findMany({ where: { key: { in: data.roles.map((r) => r.roleKey) } } });
  const roleId = new Map(roles.map((r) => [r.key, r.id]));
  for (const r of data.roles) if (!roleId.has(r.roleKey)) throw new NotFoundError("Role", r.roleKey);

  const user = await ctx.tx.user.create({
    data: {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone ?? null,
      isTechnician: data.isTechnician,
      passwordHash: await bcrypt.hash(data.password, 8),
      roles: { create: data.roles.map((r) => ({ roleId: roleId.get(r.roleKey)!, siteId: r.siteId })) },
    },
  });
  const { passwordHash: _omit, ...safe } = user;
  void _omit;
  await ctx.audit({ action: "user.create", entityType: "User", entityId: user.id, after: { ...safe, roles: data.roles } });
  return user;
}

export async function setUserActive(ctx: ServiceContext, userId: string, active: boolean) {
  ctx.require("admin.user", "edit");
  const user = await ctx.tx.user.update({ where: { id: userId }, data: { active } });
  await ctx.audit({ action: active ? "user.activate" : "user.deactivate", entityType: "User", entityId: userId });
  return user;
}

export async function verifyCredentials(tx: ServiceContext["tx"], email: string, password: string) {
  const user = await tx.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.active) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}
