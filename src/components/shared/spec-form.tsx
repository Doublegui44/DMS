"use client";

import {
  ActionForm,
  Field,
  NativeSelect,
  TextInput,
  inputClass,
  type FormState,
} from "./form";
import { cn } from "@/lib/utils";

/** A form field described by plain data, so server pages can declare simple forms. */
export interface FieldSpec {
  name: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "date"
    | "money"
    | "select"
    | "textarea"
    | "checkboxes"
    | "hidden";
  options?: { value: string; label: string }[];
  defaultValue?: string;
  /** checkboxes: values checked initially. */
  defaultValues?: string[];
  placeholder?: string;
  /** select: label of the empty choice (none when omitted). */
  empty?: string;
  hint?: string;
  /** Spans the whole row of a multi-column form. */
  wide?: boolean;
  testId?: string;
}

const GRID: Record<1 | 2 | 3, string> = {
  1: "grid gap-3",
  2: "grid gap-3 sm:grid-cols-2",
  3: "grid gap-3 sm:grid-cols-3",
};

function Input({ f, invalid }: { f: FieldSpec; invalid: boolean }) {
  switch (f.type) {
    case "select":
      return (
        <NativeSelect
          name={f.name}
          options={f.options ?? []}
          defaultValue={f.defaultValue}
          placeholder={f.empty}
          invalid={invalid}
          data-testid={f.testId}
        />
      );
    case "textarea":
      return (
        <textarea
          id={f.name}
          name={f.name}
          defaultValue={f.defaultValue}
          placeholder={f.placeholder}
          rows={3}
          aria-invalid={invalid || undefined}
          className={cn(inputClass, "h-auto py-1.5")}
          data-testid={f.testId}
        />
      );
    case "checkboxes":
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
          {(f.options ?? []).map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-1.5 text-[13px]"
            >
              <input
                type="checkbox"
                name={f.name}
                value={o.value}
                defaultChecked={f.defaultValues?.includes(o.value)}
                className="size-3.5"
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    default:
      return (
        <TextInput
          name={f.name}
          type={f.type === "money" ? "text" : (f.type ?? "text")}
          inputMode={
            f.type === "money"
              ? "decimal"
              : f.type === "number"
                ? "numeric"
                : undefined
          }
          defaultValue={f.defaultValue}
          placeholder={
            f.placeholder ?? (f.type === "money" ? "0.00" : undefined)
          }
          invalid={invalid}
          data-testid={f.testId}
        />
      );
  }
}

/** ActionForm whose fields come from `FieldSpec`s; field errors are matched by name. */
export function SpecForm({
  action,
  fields,
  submitLabel,
  successMessage,
  cancelHref,
  columns = 2,
  inline = false,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  fields: FieldSpec[];
  submitLabel: string;
  successMessage?: string;
  cancelHref?: string;
  columns?: 1 | 2 | 3;
  /** Fields and button on one wrapping row (short forms inside a section). */
  inline?: boolean;
}) {
  return (
    <ActionForm
      action={action}
      submitLabel={submitLabel}
      successMessage={successMessage}
      cancelHref={cancelHref}
      className={
        inline
          ? "flex flex-wrap items-end gap-3 space-y-0 [&>div:last-child]:pt-0"
          : undefined
      }
    >
      {(errors) => (
        <div className={inline ? "contents" : GRID[columns]}>
          {fields.map((f) =>
            f.type === "hidden" ? (
              <input
                key={f.name}
                type="hidden"
                name={f.name}
                value={f.defaultValue ?? ""}
              />
            ) : (
              <Field
                key={f.name}
                label={f.label}
                name={f.name}
                error={errors[f.name]}
                className={cn(
                  inline
                    ? "min-w-40 flex-1"
                    : f.wide && columns > 1
                      ? "sm:col-span-full"
                      : undefined,
                )}
              >
                <Input f={f} invalid={!!errors[f.name]?.length} />
                {f.hint && (
                  <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                )}
              </Field>
            ),
          )}
        </div>
      )}
    </ActionForm>
  );
}
