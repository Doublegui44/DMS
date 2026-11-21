import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/shared/form";

type Field = { name: string; label: string; type: "date" | "month" | "select"; value: string; options?: { value: string; label: string }[]; testId?: string };

/** GET form of a report: changing a field and applying reloads the page with the new URL. */
export async function ReportFilters({ fields, hidden = {} }: { fields: Field[]; hidden?: Record<string, string> }) {
  const t = await getTranslations("reports");
  return (
    <form className="flex flex-wrap items-end gap-3 text-sm" data-testid="report-filters">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => (
        <label key={f.name} className="space-y-1">
          <span className="block text-xs text-muted-foreground">{f.label}</span>
          {f.type === "select" ? (
            <select name={f.name} defaultValue={f.value} className={inputClass} data-testid={f.testId}>
              {f.options!.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input type={f.type} name={f.name} defaultValue={f.value} className={inputClass} data-testid={f.testId} />
          )}
        </label>
      ))}
      <Button type="submit" size="sm" variant="outline" data-testid="report-apply">
        {t("apply")}
      </Button>
    </form>
  );
}
