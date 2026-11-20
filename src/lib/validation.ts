import type { z } from "zod";
import { ValidationError } from "./errors";

/** Parse with Zod; throw a ValidationError with field errors on failure. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const flat = result.error.flatten();
    const message = flat.formErrors[0] ?? Object.values(flat.fieldErrors).flat()[0] ?? "Invalid input";
    // flatten() keys errors by the first path segment only; nested fields also get their full
    // path ("tradeIn.offerCents") so forms can show the error next to the right input.
    const fieldErrors = { ...flat.fieldErrors } as Record<string, string[] | undefined>;
    for (const issue of result.error.issues) {
      if (issue.path.length > 1) (fieldErrors[issue.path.join(".")] ??= []).push(issue.message);
    }
    throw new ValidationError(String(message), fieldErrors);
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
