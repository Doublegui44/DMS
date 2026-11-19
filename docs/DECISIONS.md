# Technical decisions

Short ADR-style log. Newest at the bottom. Format: context → decision → consequences.

## D-001 — PostgreSQL locally, no SQLite
A PostgreSQL 17 server already runs locally (Homebrew). Using it in dev and tests avoids SQLite gaps (no native enums in older Prisma, weak `Decimal`, no partial unique indexes, no triggers). Databases: `dms_dev`, `dms_test`. Connection via `DATABASE_URL`.

## D-002 — Server Actions + service layer, no REST API for mutations
UI mutations go through Next.js Server Actions that only parse input and call `runCommand`. Route handlers are used for file outputs (PDF, CSV, FEC). The service layer has no Next.js dependency, so the CLI simulator and tests call it directly.

## D-003 — Money in integer cents; PMP in Decimal
Amounts are `Int` cents. Rounding is half-up and lives only in `lib/money.ts`. PMP unit cost is `Decimal(18,4)` (cents) to prevent drift over many receipts; posted values are rounded to cents. Parts quantities `Decimal(12,3)`. Labour time in integer centi-hours. `Int` limits a single amount to ~€21M, which is enough for one document line; aggregates are computed in JS numbers or SQL `bigint`.

## D-004 — Synchronous in-process event bus inside the transaction
Modules publish typed events; subscribers run inside the same Prisma transaction. Gives decoupling without eventual consistency, and any downstream failure (unbalanced entry, locked period) rolls back the whole command. Events are persisted to `DomainEvent` for timelines and debugging. Trade-off: long handler chains lengthen transactions; acceptable at simulator scale.

## D-005 — Perpetual inventory in the general ledger
Stock accounts (37x) are kept equal to the stock sub-ledgers by posting stock entries/exits through 603x at each movement. This makes "VN stock value goes down / VO stock value goes up" visible immediately and lets us reconcile GL vs. sub-ledger as an invariant. Purchases still go through 60x as the PCG requires. (Business assumption, see CLAUDE.md.)

## D-006 — Auth.js v5, credentials, JWT sessions
No external IdP needed for a simulator. Passwords bcrypt-hashed. Session token carries `userId`; roles and scopes are reloaded per request (cheap, and role switches apply instantly). Demo role switcher is an admin-only impersonation action, gated by `DEMO_MODE=true`.

## D-007 — Gap-free numbering via locked counter row
`UPDATE document_sequence … RETURNING` inside the business transaction. Rollback restores the counter, so no gaps. Numbers are assigned only when a document is issued.

## D-008 — Period lock enforced twice
Service check for a clean error message, plus a Postgres trigger on journal inserts as a hard guarantee (protects against future code paths and the simulator).

## D-009 — Business clock instead of system time
All business dates come from `BusinessClock`. A lint rule bans `new Date()` in `modules/*/domain` and `services`, except via `ctx.businessDate` / `ctx.now()`.

## D-010 — Seed history generated through the scenario runner
The 6 months of history are produced by running the simulator from a past business date, rather than inserting fabricated rows. Slower seed, but every historical document and entry obeys the business rules and the books balance by construction. Until Phase 7 exists, each phase's seeder calls the relevant services directly.

## D-011 — next-intl for i18n, English only at first
All UI strings go through `t()` from day one; only `en.json` is written until translations are requested.

## D-012 — npm, single package
No monorepo; one Next.js app with modules as folders. pnpm is not installed and the gain is small.

## D-013 — One `Invoice` model for all sales invoices
VN, VO, RO, counter sale and warranty invoices share a single `Invoice` table (in accounting) with a `sourceType`. Gap-free numbering per site applies across all of them, which matches the French legal requirement of one chronological invoice series per entity (series per site are allowed).

## D-014 — Library majors pinned to known-stable versions
Prisma 6 (not 7: driver-adapter migration), TanStack Table 8, Zod 3, Vitest 3, `@hookform/resolvers` 5, `next-auth` 5 beta. Next.js 15.5. Upgrades are a separate, deliberate task.

## D-015 — Own reset script instead of `prisma migrate reset`
`scripts/db-reset.ts` runs `migrate deploy`, truncates every table and reseeds. It refuses any database that is not local and named `dms_*`. Prisma blocks `migrate reset` when run by an AI agent; resetting `dms_dev` still needs the user's go-ahead.

## D-016 — Three local databases
`dms_dev` (manual use), `dms_test` (Vitest integration, wiped per test), `dms_e2e` (Playwright, reset + seeded at server start). The e2e dev server uses `distDir=.next-e2e` so it can run next to `npm run dev`.

## D-017 — Demo role switcher as a second credentials provider
A `demo` credentials provider signs in any active user by email, enabled only when `DEMO_MODE=true`. Used by the login page shortcuts and the top-bar switcher. Must be off for any shared deployment.

## D-018 — Forms use native inputs/selects with server actions
Forms post `FormData` to server actions (`ActionForm`, `useActionState`); field errors come back from the service's Zod validation, so there is a single source of validation. shadcn (radix-nova preset) is used for buttons, menus, tables, dialogs. TanStack Table runs in manual mode: sorting/filtering/paging are URL params handled server-side.

## D-019 — Forbidden reads redirect to /forbidden
`query()` turns a `ForbiddenError` into a redirect to `/forbidden`, so typing a URL to a screen the role cannot see shows a clear page instead of a 500.
