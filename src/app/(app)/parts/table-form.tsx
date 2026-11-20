"use client";

import { ActionForm, Field, NativeSelect, TextInput, type FormState } from "@/components/shared/form";
import { cn } from "@/lib/utils";

/** Inputs are named `<name>__<row id>`; the server action regroups them per row. */
export interface TableFormInput {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  testId?: string;
  /** Narrow numeric box (default) or a wider text box. */
  wide?: boolean;
}

export interface TableFormRow {
  id: string;
  cells: (string | number | null)[];
  inputs: TableFormInput[];
  /** A tick box named `check` with the row id as value (e.g. "bill this receipt line"). */
  check?: { name: string; defaultChecked?: boolean; testId?: string };
}

export interface TableFormField {
  name: string;
  label: string;
  type?: "text" | "date" | "select" | "hidden" | "checkbox";
  defaultValue?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  testId?: string;
}

/** A table of rows with inputs, plus header fields, posted to one server action. */
export function TableForm({
  action,
  submitLabel,
  headers,
  inputHeaders,
  rows,
  fields = [],
  rightAligned = [],
  checkHeader,
  empty,
  successMessage,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  submitLabel: string;
  headers: string[];
  inputHeaders: string[];
  rows: TableFormRow[];
  fields?: TableFormField[];
  /** Indexes of the read-only columns to right-align (numbers). */
  rightAligned?: number[];
  checkHeader?: string;
  empty?: string;
  successMessage?: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} successMessage={successMessage}>
      {(errors) => (
        <>
          {fields.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {fields.map((f) =>
                f.type === "hidden" ? (
                  <input key={f.name} type="hidden" name={f.name} value={f.defaultValue ?? ""} />
                ) : f.type === "checkbox" ? (
                  <label key={f.name} className="flex items-center gap-2 self-end pb-1.5 text-[13px] sm:col-span-full">
                    <input type="checkbox" name={f.name} value={f.defaultValue ?? "on"} className="size-3.5" data-testid={f.testId} />
                    {f.label}
                  </label>
                ) : (
                  <Field key={f.name} label={f.label} name={f.name} error={errors[f.name]}>
                    {f.type === "select" ? (
                      <NativeSelect name={f.name} options={f.options ?? []} defaultValue={f.defaultValue} invalid={!!errors[f.name]} data-testid={f.testId} />
                    ) : (
                      <TextInput
                        name={f.name}
                        type={f.type === "date" ? "date" : "text"}
                        defaultValue={f.defaultValue}
                        placeholder={f.placeholder}
                        invalid={!!errors[f.name]}
                        data-testid={f.testId}
                      />
                    )}
                  </Field>
                ),
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  {checkHeader !== undefined && <th className="w-8 py-1.5 pr-2 font-medium">{checkHeader}</th>}
                  {headers.map((h, i) => (
                    <th key={h} className={cn("py-1.5 pr-3 font-medium", rightAligned.includes(i) && "text-right")}>
                      {h}
                    </th>
                  ))}
                  {inputHeaders.map((h) => (
                    <th key={h} className="py-1.5 pr-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={headers.length + inputHeaders.length + 1} className="py-4 text-center text-muted-foreground">
                      {empty ?? "—"}
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    {checkHeader !== undefined && (
                      <td className="py-1 pr-2">
                        {r.check && <input type="checkbox" name={r.check.name} value={r.id} defaultChecked={r.check.defaultChecked} className="size-3.5" data-testid={r.check.testId} />}
                      </td>
                    )}
                    {r.cells.map((c, i) => (
                      <td key={i} className={cn("py-1 pr-3", rightAligned.includes(i) && "text-right tabular-nums")}>
                        {c === null || c === "" ? <span className="text-muted-foreground">—</span> : c}
                      </td>
                    ))}
                    {r.inputs.map((input) => (
                      <td key={input.name} className="py-1 pr-2">
                        <TextInput
                          name={`${input.name}__${r.id}`}
                          defaultValue={input.defaultValue}
                          placeholder={input.placeholder}
                          inputMode={input.wide ? undefined : "decimal"}
                          className={input.wide ? "w-40" : "w-24 text-right tabular-nums"}
                          data-testid={input.testId}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ActionForm>
  );
}
