import { on } from "@/lib/events";
import { toDateOnly } from "@/lib/dates";
import { expireQuotes } from "./services/quotes";
import { expireReservations } from "./services/reservations";

/** Sales end-of-day jobs, run when the business clock moves on (registered by `src/modules/register.ts`). */
export function registerSalesHandlers(): void {
  on("BusinessDayAdvanced", async (ctx, e) => {
    const today = toDateOnly(e.payload.to);
    await expireReservations(ctx, today);
    await expireQuotes(ctx, today);
  });
}
