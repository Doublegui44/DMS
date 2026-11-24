import { getTranslations } from "next-intl/server";
import { formatDate, formatDateTime } from "@/lib/dates";

export interface TimelineEntry {
  id: string;
  at: Date;
  businessDate: Date;
  kind: "event" | "audit";
  title: string;
  userName: string | null;
}

/** Vertical activity timeline (domain events + audit entries), labelled in the UI language. */
export async function Timeline({ items, empty }: { items: TimelineEntry[]; empty?: string }) {
  const t = await getTranslations("activity");
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty ?? t("empty")}</p>;
  return (
    <ol className="relative space-y-3 border-l pl-4">
      {items.map((i) => (
        <li key={i.id} className="relative">
          <span
            className={`absolute -left-[21px] top-1 size-2.5 rounded-full ring-2 ring-background ${
              i.kind === "event" ? "bg-primary" : "bg-muted-foreground/50"
            }`}
          />
          <div className="text-[13px] font-medium">{activityLabel(t, i.title)}</div>
          <div className="text-xs text-muted-foreground">
            {formatDate(i.businessDate)} · {i.userName ?? t("system")}
            <span className="ml-1 opacity-60">({formatDateTime(i.at)})</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** An event type or audit action in the UI language; unknown ones are spelled out in English. */
export function activityLabel(t: { has: (key: string) => boolean; (key: string): string }, code: string): string {
  const key = code.replace(/\./g, "__");
  return t.has(key) ? t(key) : humanise(code);
}

/** "VehicleStatusChanged" → "Vehicle status changed"; "factory_order.ship" → "Factory order ship". */
function humanise(s: string): string {
  const spaced = s.replace(/[._]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
