/** Base class for business-rule violations. `code` maps to a translated message. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly params: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(resource: string, action: string, siteId?: string | null) {
    super("forbidden", `Not allowed: ${resource}:${action}${siteId ? ` on site ${siteId}` : ""}`, {
      resource,
      action,
      siteId,
    });
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super("not_found", `${entity} ${id} not found`, { entity, id });
    this.name = "NotFoundError";
  }
}

export class ValidationError extends DomainError {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[] | undefined> = {},
  ) {
    super("validation", message, { fieldErrors });
    this.name = "ValidationError";
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super("invalid_transition", `${entity}: cannot go from ${from} to ${to}`, { entity, from, to });
    this.name = "InvalidTransitionError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, params: Record<string, unknown> = {}) {
    super("conflict", message, params);
    this.name = "ConflictError";
  }
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string[] | undefined> } };

/** Convert any thrown value into a serialisable action error. */
export function toActionError(err: unknown): Extract<ActionResult<never>, { ok: false }> {
  if (err instanceof ValidationError) {
    return { ok: false, error: { code: err.code, message: err.message, fieldErrors: err.fieldErrors } };
  }
  if (err instanceof DomainError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  // Prisma unique constraint
  if (typeof err === "object" && err && "code" in err && (err as { code: string }).code === "P2002") {
    const target = (err as { meta?: { target?: string[] } }).meta?.target?.join(", ") ?? "field";
    return { ok: false, error: { code: "conflict", message: `A record with this ${target} already exists` } };
  }
  console.error(err);
  return { ok: false, error: { code: "internal", message: "Unexpected error" } };
}
