/**
 * Service context: the single entry point for every business command.
 * UI server actions, the CLI simulator, the seed and the tests all go through `runCommand`.
 */
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "./db";
import { ForbiddenError } from "./errors";
import { handlersFor, handlersRegistered, type DomainEventEnvelope, type EventType } from "./events";
import { can, type Action, type PermissionSet } from "./rbac";
import { toDateOnly, localToday } from "./dates";

export interface Actor {
  userId: string | null;
  name: string;
  isSystem: boolean;
  permissions: PermissionSet;
  /** "ALL" or the site ids the actor can access at all. */
  siteIds: "ALL" | string[];
  roleKeys: string[];
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  siteId?: string | null;
}

export interface ServiceContext {
  readonly tx: Tx;
  readonly actor: Actor;
  /** Active site for the command (may be null for group-wide actions). */
  readonly siteId: string | null;
  /** Current business date from the simulated clock. */
  readonly businessDate: Date;
  /** Throws ForbiddenError unless allowed. */
  require(resource: string, action: Action, siteId?: string | null): void;
  can(resource: string, action: Action, siteId?: string | null): boolean;
  emit<T extends EventType>(event: DomainEventEnvelope<T>): Promise<void>;
  audit(input: AuditInput): Promise<void>;
}

export interface CommandOptions {
  actor: Actor;
  siteId?: string | null;
  /** Permission checked before the command runs. */
  permission?: { resource: string; action: Action; siteId?: string | null };
  /** Override the business date (simulator only). */
  businessDate?: Date;
}

const MAX_EVENT_DEPTH = 10;

async function readBusinessDate(tx: Tx): Promise<Date> {
  const clock = await tx.businessClock.findUnique({ where: { id: 1 } });
  return clock ? toDateOnly(clock.currentDate) : localToday();
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function buildContext(tx: Tx, opts: CommandOptions, businessDate: Date): ServiceContext {
  const { actor } = opts;
  let depth = 0;
  const ctx: ServiceContext = {
    tx,
    actor,
    siteId: opts.siteId ?? null,
    businessDate,
    can: (resource, action, siteId) => actor.isSystem || can(actor.permissions, resource, action, siteId),
    require(resource, action, siteId) {
      if (!ctx.can(resource, action, siteId)) throw new ForbiddenError(resource, action, siteId);
    },
    async emit(event) {
      await tx.domainEvent.create({
        data: {
          type: event.type,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          siteId: event.siteId ?? ctx.siteId,
          payload: toJson(event.payload) ?? {},
          businessDate,
          userId: actor.userId,
        },
      });
      if (++depth > MAX_EVENT_DEPTH) throw new Error(`Event cascade too deep at ${event.type}`);
      try {
        for (const handler of handlersFor(event.type)) {
          await handler(ctx, event as unknown as DomainEventEnvelope<EventType>);
        }
      } finally {
        depth--;
      }
    },
    async audit(input) {
      await tx.auditLog.create({
        data: {
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          before: toJson(input.before),
          after: toJson(input.after),
          siteId: input.siteId ?? ctx.siteId,
          userId: actor.userId,
          businessDate,
        },
      });
    },
  };
  return ctx;
}

/** Run a mutation in a transaction with permission check, audit and events. */
export async function runCommand<T>(opts: CommandOptions, fn: (ctx: ServiceContext) => Promise<T>): Promise<T> {
  // Without the cross-module handlers, postings (e.g. stock entries) would silently be skipped.
  if (!handlersRegistered()) {
    throw new Error('Domain event handlers are not registered: import "@/modules/register" in this entry point');
  }
  return db.$transaction(
    async (tx) => {
      const businessDate = opts.businessDate ? toDateOnly(opts.businessDate) : await readBusinessDate(tx);
      const ctx = buildContext(tx, opts, businessDate);
      if (opts.permission) ctx.require(opts.permission.resource, opts.permission.action, opts.permission.siteId);
      return fn(ctx);
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** Run a read-only query with the same context (no transaction). */
export async function runQuery<T>(opts: CommandOptions, fn: (ctx: ServiceContext) => Promise<T>): Promise<T> {
  const businessDate = opts.businessDate ? toDateOnly(opts.businessDate) : await readBusinessDate(db);
  const ctx = buildContext(db, opts, businessDate);
  if (opts.permission) ctx.require(opts.permission.resource, opts.permission.action, opts.permission.siteId);
  return fn(ctx);
}

/** Actor used by the seed, CLI simulator and scheduled jobs. Bypasses permission checks. */
export const SYSTEM_ACTOR: Actor = {
  userId: null,
  name: "System",
  isSystem: true,
  permissions: new Map(),
  siteIds: "ALL",
  roleKeys: ["SYSTEM"],
};

/** Prisma `where` fragment restricting a site-scoped table to the actor's sites. */
export function siteScopeWhere(actor: Actor): { siteId?: { in: string[] } } {
  return actor.siteIds === "ALL" ? {} : { siteId: { in: actor.siteIds } };
}
