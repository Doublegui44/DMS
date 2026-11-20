/**
 * Typed, synchronous, in-transaction domain event bus (see DECISIONS D-004).
 *
 * Modules declare their events by augmenting `DomainEventMap`:
 *
 *   declare module "@/lib/events" {
 *     interface DomainEventMap { CustomerCreated: { customerId: string } }
 *   }
 *
 * and register handlers with `on("CustomerCreated", handler)`. Handlers run inside
 * the publishing command's transaction; a throwing handler rolls the command back.
 */
import type { ServiceContext } from "./context";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DomainEventMap {}

export type EventType = keyof DomainEventMap & string;

export interface DomainEventEnvelope<T extends EventType = EventType> {
  type: T;
  aggregateType: string;
  aggregateId: string;
  siteId?: string | null;
  payload: DomainEventMap[T];
}

export type EventHandler<T extends EventType> = (
  ctx: ServiceContext,
  event: DomainEventEnvelope<T>,
) => Promise<void> | void;

const handlers = new Map<string, EventHandler<EventType>[]>();

export function on<T extends EventType>(type: T, handler: EventHandler<T>): void {
  const list = handlers.get(type) ?? [];
  list.push(handler as unknown as EventHandler<EventType>);
  handlers.set(type, list);
}

export function handlersFor(type: string): EventHandler<EventType>[] {
  return handlers.get(type) ?? [];
}

const registeredGroups = new Set<string>();

/**
 * Register a module's handlers once per process (idempotent across hot reloads of the caller).
 * Lives next to the handler map so both reset together if this module is re-evaluated.
 */
export function registerHandlersOnce(group: string, register: () => void): void {
  if (registeredGroups.has(group)) return;
  registeredGroups.add(group);
  register();
}

/** True once `src/modules/register.ts` has run in this process (checked by runCommand). */
export function handlersRegistered(): boolean {
  return registeredGroups.size > 0;
}

/** Test helper. */
export function clearHandlers(): void {
  handlers.clear();
  registeredGroups.clear();
}
