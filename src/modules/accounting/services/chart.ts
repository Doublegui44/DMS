import type { ServiceContext } from "@/lib/context";
import type { Tx } from "@/lib/db";
import { ConflictError, DomainError, NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { accountClass } from "../domain/default-chart";
import type { AccountInfo, AccountRef } from "../domain/entry";
import { accountInputSchema, type AccountInput } from "../schemas/accounting";

function normalise(data: ReturnType<typeof accountInputSchema.parse>) {
  const cls = accountClass(data.code);
  return { ...data, class: cls, requiresAnalytic: data.requiresAnalytic ?? (cls === 6 || cls === 7) };
}

export async function createAccount(ctx: ServiceContext, input: AccountInput) {
  ctx.require("accounting.chart", "create");
  const data = normalise(parseInput(accountInputSchema, input));
  if (await ctx.tx.account.findUnique({ where: { code: data.code } })) throw new ConflictError(`Account ${data.code} already exists`);
  const account = await ctx.tx.account.create({ data });
  await ctx.audit({ action: "account.create", entityType: "Account", entityId: account.code, after: account });
  return account;
}

/** The code cannot change once created (lines reference it). */
export async function updateAccount(ctx: ServiceContext, code: string, input: AccountInput) {
  ctx.require("accounting.chart", "edit");
  const before = await ctx.tx.account.findUnique({ where: { code } });
  if (!before) throw new NotFoundError("Account", code);
  const data = normalise(parseInput(accountInputSchema, { ...input, code }));
  const used = await ctx.tx.journalLine.count({ where: { accountCode: code } });
  if (used && (before.isReceivable !== data.isReceivable || before.isPayable !== data.isPayable)) {
    throw new DomainError("account_in_use", "Receivable/payable flags cannot change once the account has postings");
  }
  const after = await ctx.tx.account.update({ where: { code }, data });
  await ctx.audit({ action: "account.update", entityType: "Account", entityId: code, before, after });
  return after;
}

/** Point a posting key to an account (global, per site and/or per brand). */
export async function setAccountMapping(
  ctx: ServiceContext,
  input: { key: string; accountCode: string; siteId?: string | null; brandId?: string | null },
) {
  ctx.require("accounting.chart", "edit");
  const account = await ctx.tx.account.findUnique({ where: { code: input.accountCode } });
  if (!account?.postable) throw new DomainError("not_postable", `Account ${input.accountCode} cannot be posted to`);
  const where = { key: input.key, siteId: input.siteId ?? null, brandId: input.brandId ?? null };
  const existing = await ctx.tx.accountMapping.findFirst({ where });
  const mapping = existing
    ? await ctx.tx.accountMapping.update({ where: { id: existing.id }, data: { accountCode: input.accountCode } })
    : await ctx.tx.accountMapping.create({ data: { ...where, accountCode: input.accountCode } });
  await ctx.audit({ action: "account_mapping.set", entityType: "AccountMapping", entityId: mapping.id, before: existing, after: mapping });
  return mapping;
}

/**
 * Resolve posting keys to account codes. Most specific mapping wins:
 * site + brand → site → brand → global.
 */
export async function resolveAccountRefs(
  tx: Tx,
  refs: AccountRef[],
  scope: { siteId: string; brandId?: string | null },
): Promise<Map<string, string>> {
  const keys = [...new Set(refs.filter((r): r is { key: string } => "key" in r).map((r) => r.key))];
  const out = new Map<string, string>();
  if (!keys.length) return out;
  const mappings = await tx.accountMapping.findMany({ where: { key: { in: keys } } });
  const score = (m: { siteId: string | null; brandId: string | null }) => {
    if (m.siteId && m.siteId !== scope.siteId) return -1;
    if (m.brandId && m.brandId !== scope.brandId) return -1;
    return (m.siteId ? 2 : 0) + (m.brandId ? 1 : 0);
  };
  for (const key of keys) {
    const best = mappings
      .filter((m) => m.key === key && score(m) >= 0)
      .sort((a, b) => score(b) - score(a))[0];
    if (!best) throw new DomainError("mapping_missing", `No account is mapped to posting key ${key}`, { key });
    out.set(key, best.accountCode);
  }
  return out;
}

export async function loadAccountInfo(tx: Tx, codes: string[]): Promise<Map<string, AccountInfo>> {
  const accounts = await tx.account.findMany({ where: { code: { in: [...new Set(codes)] } } });
  return new Map(accounts.map((a) => [a.code, a]));
}
