import { cn } from "@/lib/utils";

export type Tone = "gray" | "blue" | "indigo" | "amber" | "green" | "red" | "violet" | "teal";

const TONE_CLASSES: Record<Tone, string> = {
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  blue: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30",
  indigo: "bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30",
  amber: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
  red: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30",
  violet: "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30",
  teal: "bg-teal-50 text-teal-800 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/30",
};

/** One colour per lifecycle stage, shared by every module. */
export const STATUS_TONES: Record<string, Tone> = {
  // vehicles
  ORDERED: "violet",
  IN_TRANSIT: "indigo",
  IN_STOCK: "blue",
  INTAKE: "amber",
  RECONDITIONING: "amber",
  FOR_SALE: "blue",
  RESERVED: "teal",
  SOLD: "green",
  DELIVERED: "gray",
  CUSTOMER: "gray",
  // stock types / kinds
  VN: "indigo",
  VO: "amber",
  NONE: "gray",
  INDIVIDUAL: "gray",
  COMPANY: "blue",
  OEM: "violet",
  // ageing
  ok: "green",
  watch: "amber",
  warning: "amber",
  critical: "red",
  // accounting
  DRAFT: "gray",
  ISSUED: "blue",
  PARTIALLY_PAID: "amber",
  PAID: "green",
  INVOICE: "gray",
  CREDIT_NOTE: "violet",
  OPEN: "green",
  LOCKED: "gray",
  IN: "green",
  OUT: "amber",
  MANUAL: "indigo",
  REVERSAL: "red",
  OPENING: "violet",
  overdue: "red",
  // generic
  ACTIVE: "green",
  INACTIVE: "gray",
};

export function StatusBadge({ status, label, tone, className }: { status: string; label?: string; tone?: Tone; className?: string }) {
  const t = tone ?? STATUS_TONES[status] ?? "gray";
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        TONE_CLASSES[t],
        className,
      )}
      data-status={status}
    >
      {label ?? status}
    </span>
  );
}
