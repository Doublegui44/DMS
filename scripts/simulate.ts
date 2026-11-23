/**
 * Scenario runner from the command line (Phase 7). Moves the business clock of the database in
 * DATABASE_URL (.env → dms_dev) forward day by day, the sites' staff acting through the services.
 *
 *   npm run simulate -- --days 30
 *   npm run simulate -- --days 7 --site nantes --seed 3 --leads-per-day 1.5 --late-payment-rate 0.3
 *
 * Every rate of the admin screen has a flag: its name in kebab-case (see `simulationRatesSchema`).
 * Exits with 1 when the run stopped on an error or the books do not reconcile.
 */
import "@/modules/register";
import { SYSTEM_ACTOR } from "@/lib/context";
import { db } from "@/lib/db";
import { DEFAULT_RATES, runSimulation } from "@/modules/simulation";

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const euros = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Unexpected argument "${a}"`);
    const [k, inline] = a.slice(2).split("=", 2);
    const v = inline ?? argv[++i];
    if (v === undefined) throw new Error(`Missing value for --${k}`);
    flags.set(k, v);
  }
  const rateKeys = new Map(Object.keys(DEFAULT_RATES).map((k) => [kebab(k), k]));
  const rates: Record<string, string> = {};
  let days = "1";
  let site: string | null = null;
  for (const [k, v] of flags) {
    if (k === "days") days = v;
    else if (k === "site") site = v;
    else if (rateKeys.has(k)) rates[rateKeys.get(k)!] = v;
    else throw new Error(`Unknown flag --${k}. Rates: ${[...rateKeys.keys()].map((r) => `--${r}`).join(", ")}`);
  }
  return { days, site, rates };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const report = await runSimulation(SYSTEM_ACTOR, input, {
    onDay: (day, counts) => process.stdout.write(`\r${day.toISOString().slice(0, 10)} · ${counts.day} day(s) · ${Object.values(counts).reduce((a, b) => a + b, 0) - counts.day} steps`),
  });
  process.stdout.write("\n");
  console.log(`Simulated ${report.days} day(s), ${report.from} → ${report.to}${report.site ? ` (${report.site})` : ""} in ${Math.round((Date.now() - started) / 1000)} s`);
  console.table(Object.entries(report.counts).filter(([k]) => k !== "day").sort(([a], [b]) => a.localeCompare(b)).map(([step, n]) => ({ step, n })));
  if (report.skipped.length) {
    const bySteps = new Map<string, number>();
    for (const s of report.skipped) bySteps.set(`${s.step}: ${s.message}`, (bySteps.get(`${s.step}: ${s.message}`) ?? 0) + 1);
    console.log(`${report.skipped.length} step(s) refused by the business rules:`);
    for (const [k, n] of [...bySteps].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n} × ${k}`);
  }
  const inv = report.invariants;
  console.log(`Journal: debit ${euros(inv.debitCents)} / credit ${euros(inv.creditCents)} → ${inv.balanced ? "balanced" : "NOT BALANCED"}`);
  console.log(`Stock accounts vs sub-ledgers: ${inv.stockReconciled ? "reconciled" : `DIFFERENCES ${JSON.stringify(inv.stockDifferences)}`}`);
  if (report.error) console.error(`Stopped: ${report.error}`);
  process.exitCode = report.ok ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
