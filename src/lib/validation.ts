import type { z } from "zod";
import { ValidationError } from "./errors";

/** Parse with Zod; throw a ValidationError with field errors on failure. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const flat = result.error.flatten();
    const message = flat.formErrors[0] ?? Object.values(flat.fieldErrors).flat()[0] ?? "Invalid input";
    throw new ValidationError(String(message), flat.fieldErrors as Record<string, string[] | undefined>);
  }
  return result.data;
}

/** FormData → plain object (repeated keys become arrays). */
export function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("$ACTION")) continue;
    const v = typeof value === "string" ? value : value.name;
    if (key in out) {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else {
      out[key] = v;
    }
  }
  return out;
}
