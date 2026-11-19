import type { ServiceContext } from "@/lib/context";
import { DomainError } from "@/lib/errors";
import { accountClass, DEFAULT_ACCOUNTS, DEFAULT_JOURNALS, DEFAULT_MAPPINGS } from "../domain/default-chart";
import { buildOpeningEntry, type AccountRef, type PartyType } from "../domain/entry";
import { postEntry } from "./posting";

/** Load the default chart, journals and global mappings (idempotent). Used by the seed and tests. */
export async function installDefaultChart(ctx: ServiceContext) {
  ctx.require("accounting.chart", "create");
  for (const a of DEFAULT_ACCOUNTS) {
    const cls = accountClass(a.code);
    await ctx.tx.account.upsert({
      where: { code: a.code },
      update: {},
      create: {
        code: a.code,
        label: a.label,
        type: a.type,
        class: cls,
        requiresAnalytic: cls === 6 || cls === 7,
        isReceivable: !!a.receivable,
        isPayable: !!a.payable,
      },
    });
  }
  for (const j of DEFAULT_JOURNALS) {
    await ctx.tx.journal.upsert({ where: { code: j.code }, update: {}, create: { ...j, accountCode: "accountCode" in j ? j.accountCode : null } });
  }
  for (const [key, accountCode] of Object.entries(DEFAULT_MAPPINGS)) {
    const existing = await ctx.tx.accountMapping.findFirst({ where: { key, siteId: null, brandId: null } });
    if (!existing) await ctx.tx.accountMapping.create({ data: { key, accountCode } });
  }
  await ctx.audit({ action: "accounting.install_chart", entityType: "Account", entityId: "default", after: { accounts: DEFAULT_ACCOUNTS.length } });
}

/** Post the opening balances of a site (journal AN). Positive = debit balance. */
export async function postOpeningBalances(
  ctx: ServiceContext,
  args: {
    siteId: string;
    date: Date;
    balances: { account: AccountRef; amountCents: number; label: string; partyType?: PartyType; partyId?: string }[];
    /** Takes the difference; defaults to the OPENING_BALANCE mapping (890000). */
    balancingAccount?: AccountRef;
  },
) {
  ctx.require("accounting.entry", "validate", args.siteId);
  const existing = await ctx.tx.journalEntry.count({ where: { siteId: args.siteId, sourceType: "OPENING" } });
  if (existing) throw new DomainError("opening_exists", "Opening balances were already posted for this site");
  return postEntry(ctx, buildOpeningEntry({ ...args, balancingAccount: args.balancingAccount ?? { key: "OPENING_BALANCE" } }));
}
