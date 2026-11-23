import { z } from "zod";

/**
 * Rates of the scenario runner (D-071). Counts are per site and per open day (Monday–Saturday)
 * unless the name says otherwise; shares are between 0 and 1.
 */
export const simulationRatesSchema = z.object({
  /** New sales leads. */
  leadsPerDay: z.coerce.number().min(0).max(20).default(0.6),
  /** Share of leads interested in a new car (the rest want a used car). */
  vnShare: z.coerce.number().min(0).max(1).default(0.55),
  /** Leads lost after the first contact, before any quote. */
  lostEarlyRate: z.coerce.number().min(0).max(1).default(0.12),
  /** Sent quotes the customer accepts (the rest are declined or expire). */
  conversionRate: z.coerce.number().min(0).max(1).default(0.7),
  /** Quotes with a trade-in, and quotes with financing. */
  tradeInRate: z.coerce.number().min(0).max(1).default(0.3),
  financingRate: z.coerce.number().min(0).max(1).default(0.45),
  /** Signed orders cancelled within the cooling-off days. */
  cancellationRate: z.coerce.number().min(0).max(1).default(0.03),
  /** Used cars bought from the trade, per site and per week. */
  voPurchasesPerWeek: z.coerce.number().min(0).max(20).default(1),
  /** New cars in stock or on order per brand below which a stock order is placed. */
  vnStockTarget: z.coerce.number().int().min(0).max(100).default(18),
  /** Workshop visits (appointments booked ahead plus walk-ins). */
  workshopVisitsPerDay: z.coerce.number().min(0).max(30).default(2.2),
  /** Share of visits booked ahead as appointments. */
  bookedShare: z.coerce.number().min(0).max(1).default(0.7),
  /** Visits where the technician finds more work to quote. */
  additionalWorkRate: z.coerce.number().min(0).max(1).default(0.15),
  /** Used cars prepared by the workshop, per site and per week. */
  internalRepairsPerWeek: z.coerce.number().min(0).max(20).default(1.6),
  /** Parts counter sales. */
  counterSalesPerDay: z.coerce.number().min(0).max(30).default(1.6),
  /** Company invoices paid late (the rest are paid on their due date). */
  latePaymentRate: z.coerce.number().min(0).max(1).default(0.15),
  /** Random seed: the same seed on the same data gives the same run. */
  seed: z.coerce.number().int().min(0).default(7),
});

export type SimulationRates = z.infer<typeof simulationRatesSchema>;
export const DEFAULT_RATES: SimulationRates = simulationRatesSchema.parse({});

export const simulationInputSchema = z.object({
  days: z.coerce.number().int().min(1).max(366),
  /** One site's slug or id, or every site. */
  site: z.string().trim().optional().nullable(),
  rates: simulationRatesSchema.partial().default({}),
});
export type SimulationInput = z.input<typeof simulationInputSchema>;
