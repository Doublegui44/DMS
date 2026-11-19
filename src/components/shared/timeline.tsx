import { formatDate, formatDateTime } from "@/lib/dates";

export interface TimelineEntry {
  id: string;
  at: Date;
  businessDate: Date;
  kind: "event" | "audit";
  title: string;
  userName: string | null;
}

/** Vertical activity timeline (domain events + audit entries). */
export function Timeline({ items, empty = "No activity yet." }: { items: TimelineEntry[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="relative space-y-3 border-l pl-4">
      {items.map((i) => (
        <li key={i.id} className="relative">
          <span
            className={`absolute -left-[21px] top-1 size-2.5 rounded-full ring-2 ring-background ${
              i.kind === "event" ? "bg-primary" : "bg-muted-foreground/50"
            }`}
          />
          <div className="text-[13px] font-medium">{humanise(i.title)}</div>
          <div className="text-xs text-muted-foreground">
            {formatDate(i.businessDate)} · {i.userName ?? "System"}
            <span className="ml-1 opacity-60">({formatDateTime(i.at)})</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** "VehicleStatusChanged" → "Vehicle status changed"; "customer.contact.add" → "Customer contact add". */
function humanise(s: string): string {
  const spaced = s.replace(/\./g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
