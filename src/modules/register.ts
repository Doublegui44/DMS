/**
 * Registers every module's domain-event handlers (D-031). Imported for its side effect by each
 * entry point that runs commands: the Next.js app (`src/lib/session.ts`), the seed and CLI scripts,
 * and the integration tests. `runCommand` refuses to run until this has happened, so a missing
 * import fails loudly instead of silently skipping postings.
 */
import { registerHandlersOnce } from "@/lib/events";
import { registerAccountingHandlers } from "@/modules/accounting";
import { registerSalesHandlers } from "@/modules/sales";

export function registerAllHandlers(): void {
  registerHandlersOnce("accounting", registerAccountingHandlers);
  registerHandlersOnce("sales", registerSalesHandlers);
}

registerAllHandlers();
