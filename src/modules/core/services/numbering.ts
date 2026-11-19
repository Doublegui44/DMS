import type { ServiceContext } from "@/lib/context";
import { formatDocumentNumber, sequenceDefinition } from "../domain/numbering";

/**
 * Take the next gap-free number in a series.
 * Runs `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the command's transaction:
 * the counter row stays locked until commit and is rolled back with the command (D-007).
 *
 * @param scope site id, or "GROUP" for group-wide series
 * @param sitePrefix optional site code prepended to the series prefix (e.g. "NTE")
 * @param date document date deciding the fiscal year (defaults to the business date)
 */
export async function nextDocumentNumber(
  ctx: ServiceContext,
  args: { docType: string; scope: string; sitePrefix?: string; date?: Date },
): Promise<string> {
  const def = sequenceDefinition(args.docType);
  if (!def) throw new Error(`Unknown document type ${args.docType}`);
  const fiscalYear = def.yearly ? (args.date ?? ctx.businessDate).getUTCFullYear() : 0;
  const prefix = args.sitePrefix ? `${args.sitePrefix}-${def.prefix}` : def.prefix;

  const rows = await ctx.tx.$queryRaw<{ value: number; prefix: string; padding: number }[]>`
    INSERT INTO document_sequence ("scope", "docType", "fiscalYear", "prefix", "padding", "nextValue")
    VALUES (${args.scope}, ${args.docType}, ${fiscalYear}, ${prefix}, ${def.padding}, 2)
    ON CONFLICT ("scope", "docType", "fiscalYear")
    DO UPDATE SET "nextValue" = document_sequence."nextValue" + 1
    RETURNING "nextValue" - 1 AS value, "prefix", "padding"`;
  const row = rows[0];
  return formatDocumentNumber({ prefix: row.prefix, padding: row.padding, fiscalYear, value: Number(row.value) });
}
