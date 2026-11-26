# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# DMS Simulator

Web simulator of a French multi-site car dealer group's Dealer Management System (VN/VO sales, workshop, parts, accounting, admin). For demos, training and workflow testing. **Every operational action must have its downstream effects** (stock, invoice, journal entries, KPIs), in one transaction.

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)
- Technical decisions: [docs/DECISIONS.md](docs/DECISIONS.md) — log every new technical choice there

## Current phase

**Phase 12 in progress** (desktop app for Mac and Windows, D-087): installers for macOS (arm64, x64) and Windows x64 are built and smoke-tested by `.github/workflows/desktop.yml`; left: the first Release (tag `v0.1.0`) and a hand test of its Windows installer on a real PC. See `docs/ROADMAP.md`. The README's demo script names screens and buttons: keep it in step when they change.

Built so far: `src/modules/core` (customers, suppliers, vehicles, numbering, clock, timeline, dashboard), `src/modules/admin` (role matrix, users, audit), `src/modules/accounting` (chart, mappings, posting, periods, invoices/credit notes, payments, lettering, ledgers, trial balance) `src/modules/sales` (catalogue, leads, quotes with approvals, reservations, orders, factory orders, trade-ins, VO purchases and costs, police register) and `src/modules/parts` (catalogue, supersessions, discount matrix, stock per site/bin at PMP, purchasing and receipts, supplier invoice matching, counter sales, transfers, cycle counts, obsolescence) `src/modules/workshop` (labour catalogue and rates, planner and appointments, check-in, repair orders with jobs per payer, parts issue, sublets, additional-work approval, clocking, productivity, invoicing per payer, warranty claims, internal ROs into VO stock, service history) `src/modules/reports` (role dashboards, stock value, printable documents), plus the accounting reports (P&L by department, VAT return, ageing, FEC), and `src/modules/simulation` (scenario runner, CLI and `/admin/simulation`).

## Stack

Next.js 15 (App Router, Server Actions) · TypeScript strict · Tailwind v4 + shadcn/ui (radix-nova) · TanStack Table 8 · Prisma 6 + PostgreSQL 17 (local Homebrew) · Auth.js v5 beta (credentials) · Zod 3 · next-intl · Faker (fr) · Vitest 3 · Playwright · npm · Node 24. Recharts 3 (charts) · @react-pdf/renderer 4 (PDFs, server only). Majors are pinned on purpose (D-014).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app on http://localhost:3000 |
| `npm run db:migrate` | `prisma migrate dev` (new migration) |
| `npm run db:seed` | Seed an empty database |
| `npm run db:reset` | Migrate, truncate all tables and reseed (`scripts/db-reset.ts`; refuses anything but a local `dms_*` DB) |
| `npm test` | Vitest unit + integration (integration wipes `dms_test`) |
| `npm run test:e2e` | Playwright; resets + seeds `dms_e2e` while building the app, then serves the production build on :3100 (`.next-e2e-build`, `scripts/e2e-server.sh`). `E2E_DEV=1` uses the dev server instead |
| `npm run lint` / `npm run typecheck` | ESLint (incl. module-boundary + no-wall-clock rules) / `tsc --noEmit` |
| `npm run simulate -- --days 30 --site nantes` | Scenario runner on the DB of `.env` (moves its clock; one flag per rate, e.g. `--leads-per-day 1.5 --seed 3`) |
| `cd desktop && npm run build:dump && npm run build:server && npm run dist:mac && npm run test:smoke` | Desktop app (D-087): demo dump (needs `pg_dump` 17), standalone server, `.dmg` for this Mac, Playwright smoke tests on the packaged app. `desktop/` is its own npm package, excluded from the root tsconfig and ESLint |

Single tests:
- `npx vitest run tests/unit/money.test.ts` · `npx vitest run -t "gap-free"` (integration files need local Postgres; `tests/integration/global-setup.ts` runs `prisma migrate deploy` on `dms_test` first)
- `npx playwright test -g "TECHNICIAN"`, `npx playwright test tests/e2e/sales.spec.ts` (Flow 1), `tests/e2e/parts.spec.ts` (Flow 5), `tests/e2e/workshop.spec.ts` (Flows 2, 3, 4), `tests/e2e/close.spec.ts` (Flow 6, which locks the last finished month of `dms_e2e`) `tests/e2e/i18n.spec.ts` (Flow 8, French), `tests/e2e/integrations.spec.ts` (Flow 9, market feed and OEM portal) or `tests/e2e/zz-simulation.spec.ts` (Flow 7, named to run last because it moves the clock). Playwright always restarts its own server on :3100 and reseeds `dms_e2e` first (~4 min with the seed, the build runs alongside). For a quick loop on one spec, `E2E_DEV=1 npx playwright test …` skips the build.
- CI (`.github/workflows/ci.yml`, D-077) runs typecheck, lint, Vitest, then Playwright, on GitHub Actions with a Postgres 17 service; it writes its own `.env.test` / `.env.e2e`.
- After editing `prisma/schema.prisma`: `npm run db:migrate -- --name <name>` (regenerates the client).

Databases (local Homebrew Postgres 17, socket `/tmp`): `dms_dev` (.env), `dms_test` (.env.test), `dms_e2e` (.env.e2e).
`prisma migrate reset` is blocked for AI agents by Prisma; use `npm run db:reset`, and ask the user before resetting `dms_dev`.
`prisma migrate dev` needs an interactive terminal. Non-interactively, generate the SQL with `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://$USER@localhost:5432/dms_shadow?host=/tmp" --script > prisma/migrations/<timestamp>_<name>/migration.sql` (append hand-written triggers there), then `npx prisma migrate deploy` per database (`DATABASE_URL` override) and `npx prisma generate`.
To look at screens with seeded data without touching `dms_dev`, start the `dms-e2e-preview` launch config (`.env.e2e`, `.next-preview`); stop it before `npm run test:e2e`, which resets `dms_e2e`.

Demo users: every seeded user's password is `demo1234` (dev only). Emails: `admin@dms.test`, `dealer.principal@dms.test`, `accountant@dms.test`, `sales.manager.<site>@dms.test`, `salesperson{1,2}.<site>`, `service.manager.<site>`, `service.advisor.<site>`, `technician{1,2}.<site>`, `parts.manager.<site>`, `parts.advisor.nantes` (site = nantes | rennes | angers). With `DEMO_MODE=true` the login page and top bar offer one-click user switching.

## Architecture (big picture)

Read `docs/ARCHITECTURE.md` for the ERDs, posting rules and module map. The parts that span several files:

- **Request flow.** `src/lib/session.ts` is the only bridge between Next.js and the service layer: `getRequestContext()` (cached per request) reads the Auth.js session, loads the `Actor` (roles → `PermissionSet` via `src/lib/actor.ts`) and the active site from the `dms_site` cookie. Pages call `query(fn, permission?)` (a `ForbiddenError` redirects to `/forbidden`). Server actions call `command(fn, permission?)`, which returns an `ActionResult` and never throws domain errors to the client.
- **ServiceContext** (`src/lib/context.ts`). `runCommand({ actor, siteId, permission?, businessDate? }, fn)` opens one Prisma interactive transaction and hands `fn` a `ctx` with `tx`, `businessDate` (read from `BusinessClock`), `require/can`, `audit()` and `emit()`. Seed, tests and the future simulator use `SYSTEM_ACTOR`, which bypasses permission checks. They can pass `businessDate` to act on another day.
- **Events.** `ctx.emit()` writes a `DomainEvent` row, then runs the handlers registered with `on(type, handler)` **synchronously inside the same transaction**, so a throwing handler rolls back the whole command. Event types are declared by module augmentation of `DomainEventMap`. All handlers are registered in `src/modules/register.ts` (D-031), which `src/lib/session.ts`, the seed, scripts and the integration tests import; `runCommand` throws if it was never imported. Accounting posts `VehicleStockMoved` (37x/603x); sales expires reservations and quotes on `BusinessDayAdvanced`. Parts posts its own stock entries in the command (`postStockValue`), not through events.
- **Accounting posting** (`modules/accounting`). Pure builders in `domain/entry.ts` (`buildInvoiceEntry`, `buildPaymentEntry`, `buildReversal`, `buildOpeningEntry`) produce drafts whose lines use mapping keys (`{ key: "REVENUE_LABOUR" }`) or codes. `postEntry(ctx, draft)` resolves keys via `AccountMapping` (site+brand → site → brand → global), validates (`validateEntry`), checks the period and numbers per journal (`VE-2026-000001`). Postgres triggers re-check balance (deferred, at commit), locked periods and immutability, so raw SQL cannot bypass them. Other modules invoice through `createAndIssueInvoice(ctx, input, { trusted: true })` and record money through `recordPayment`; lines name a `revenueKey` + `departmentCode`. Default chart/journals/mappings live in `domain/default-chart.ts` (`installDefaultChart`). Vehicle stock values change only through core `moveVehicleStock` (IN / COST / OUT), whose event accounting posts, so 37x always equals the stock sub-ledger. Stock cars are created, moved and repriced only by the sales flows, which call `createVehicle` / `changeVehicleStatus` / `patchVehicle` with `{ trusted: true }`; the last two refuse any other caller, and the vehicle screens handle customers' cars and descriptive fields (D-048).
- **Sales** (`modules/sales`). `acceptQuote` turns a quote into an order in one transaction: vehicle off sale (or factory order placed), trade-in into VO intake with its purchase posting, reservation converted, lead won. `invoiceOrder` issues the invoice and settles it: cost of sale, trade-in and finance-company payments, deposits allocated, finance commission, OEM incentive claim, add-on accruals, police-register exit. `deliverOrder` needs a settled invoice. Quote pricing is one pure function (`domain/pricing.ts`) used by both `previewQuote` (the builder's live preview, nothing saved) and save; guards and approval levels are in `domain/workflow.ts`. Partial unique indexes block a double sale (one open order and one active reservation per vehicle). Services named `registerOpening*` / `registerPast*` are seed-only: they replay seed v1 stock as history.
- **Parts** (`modules/parts`). All stock changes go through `services/shared.ts` `moveStock` (row lock, PMP to 4 dp, immutable `PartMovement`, posting in the same command), so 373000 always equals the stock items (D-049). A receipt accrues 408100; `recordSupplierInvoice` clears it at the receipt value and sends any price difference to 607300. Above the `parts.invoiceTolerance` setting, the invoice waits in VARIANCE for `parts.purchase_order:validate` (D-050). Transfers post through 181000 for each site (D-051). Counter sales reserve stock when confirmed and invoice through `createAndIssueInvoice` (D-053). Parts screens share `app/(app)/parts/table-form.tsx` (row inputs named `<field>__<rowId>`, regrouped by `rowsFrom` in `actions.ts`) and link entries via `EntryLink` (D-055).
- **Workshop** (`modules/workshop`). A repair order holds jobs, each with one payer that sets its labour rate, parts price class and revenue accounts (`domain/pricing.ts`, D-056). Parts lines call parts `issuePartsToRepairOrder` at once unless the job awaits approval (D-057). `invoiceRepairOrder` issues one invoice per payer: customer, one per insurer, and one per warranty job to `brand.oemCustomerId` with a `WarrantyClaim`. Internal ROs post an OD entry (604000 VO / internal revenue) and call sales `capitaliseRepairOrder`, so 372000 still equals the VO sub-ledger (D-058, D-059). Productivity = clocked ÷ available, efficiency = billed ÷ clocked (D-060).
- **Reports** (D-062). Journal-only reports live in accounting (`queries/reports.ts`, pure rules in `domain/reports.ts`). `modules/reports` is a read-only layer over the other modules' public APIs. Role dashboards (`getRoleDashboard`): widgets per role are data in `domain/dashboards.ts` and reuse the report queries, so the dashboard cannot disagree with the reports (D-067). Printable documents: `getPrintableDocument` builds one neutral `PrintDoc` and `components/pdf/print-document.tsx` lays it out. The money rules are in the pure `invoiceBody`: margin-scheme lines show no VAT. Served at `GET /api/pdf/<invoice|order|repair-order|warranty-claim>/<id>` (D-069). Legal mentions come from the `documents.legalMentions` setting. Charts are client components in `components/charts` using `--chart-1..4` (VN, VO, workshop, parts; D-068), with a table beside each chart.
- **Simulation** (`modules/simulation`, D-071–D-075). `runSimulation(starter, { days, site?, rates })` loops day by day: on open days each site's `accountingDay`, `salesDay`, `workshopDay`, `partsDay` (in `services/`) call other modules' public services as the site's own users (`loadCast`), each step in its own transaction via `sim.step(name, actor, siteId, fn)` (a `DomainError` is recorded as skipped, anything else stops the run); then `advanceBusinessDay`. Stateless: it reads open records each day, and per-record decisions use `unit(seed, id, purpose)` from `domain/random.ts`. New activity = a function in the matching `services/<desk>.ts` that queries open records and calls services through `sim.step`; new rates go in `domain/config.ts` (the form and CLI flags follow). Runs end with a `SimulationRun` event holding the report and invariants. The admin screen starts it as an in-memory background job (`services/jobs.ts`, one at a time, polled by `job-panel.tsx`, stopped between days; D-079) through `longCommand` (not `command`) because the runner opens its own transactions. Accounting pays suppliers on Fridays with `runSupplierPayments` (D-078). Running it on a DB moves that DB's clock: try it on `dms_e2e` (`set -a; . ./.env.e2e; set +a; npx tsx scripts/simulate.ts --days 3`) before `dms_dev`.
- **i18n** (D-081, D-082). Locale = `dms_locale` cookie (no URL prefix), read by `getUiLocale()`; `messages/fr.json` must keep exactly the keys of `en.json` (`tests/unit/i18n.test.ts`). `formatMoney`/`formatDate`/`formatKm` default to the UI locale (`src/lib/format-locale.ts`); pass `"en-GB"` when the text is stored. Services throw English; `command()` translates errors through `messages/server/fr.json` (English template with `{}` → French), and the same test fails when a new service message has no French entry. Page titles: `export const generateMetadata = pageTitle("key")` (`titles` namespace). Timeline labels: `activity` namespace, dots as `__`. Stored data, CSV headers and audit codes stay English.
- **Integrations (mocks).** Sales `getMarketValuation` (pure `domain/market.ts`, deterministic, D-083) feeds `MarketValuation` in the quote builder and the VO purchase form; `/sales/oem-portal` derives the plant stage from dates (`domain/oem-portal.ts`) and can ship or delay a factory order (D-084).
- **Desktop app** (`desktop/`, D-087). Electron main (`src/main.ts`) starts Postgres via `initdb`/`pg_ctl` (`src/postgres.ts`, binaries from `@embedded-postgres/*`), restores `build/demo/demo.sql.gz` on first launch (`src/lib/dump.ts`, pure), forks the Next.js standalone server (`NEXT_STANDALONE=1` → `.next-desktop`) with `utilityProcess`, and loads `http://127.0.0.1:<port>/`. Reseed forks `reseed.cjs`, bundled from `scripts/desktop-reseed.ts`. A new migration changes the shipped dump; the app replaces older data with it. When a code path reads files at run time, check it is traced into the standalone build (as the pdfkit fonts are in `next.config.ts`). The icon is `assets/icon.svg`; after changing it, `npm run build:icons` renders the committed PNGs that electron-builder turns into `.icns` and `.ico`.
- **Timelines** (`modules/core/queries/timeline.ts`) merge `DomainEvent` and `AuditLog` rows by `aggregateType/aggregateId` = `entityType/entityId`. Use the same entity name ("Customer", "Vehicle") in `emit` and `audit`.
- **Numbering** (`modules/core/services/numbering.ts`) is raw SQL upsert-and-increment in the command's transaction (gap-free, rolled back with it). Series definitions live in `domain/numbering.ts`. Note: tables are `@@map`ped to snake_case but **columns keep Prisma's camelCase**, so raw SQL must quote them (`"nextValue"`).
- **Menus and placeholders.** `src/components/shell/nav.ts` is the single menu definition. Items are shown only if the actor has `view` on their resource. Items with a `phase` render through the catch-all `src/app/(app)/[...placeholder]/page.tsx`. The e2e test derives the expected menu of every role from `DEFAULT_ROLE_MATRIX` + `NAV`, so changing either changes what the test expects.
- **RBAC data** lives in `src/lib/rbac.ts` (resource catalogue, `can`) and `modules/admin/domain/role-matrix.ts` (default grants per role, seeded by `seedRolesAndPermissions`). Adding a resource means adding it to `RESOURCES` and to the matrix, then reseeding.
- **Lists.** `DataTable` is a client component fed **serializable** cells (`CellValue`: link/badge/money/date/mono…) built in the server page. Sorting, filtering and paging are URL params parsed by `parseListParams` and whitelisted with `orderBy()`. CSV export reuses the same list query through `src/app/api/export/[entity]/route.ts`.
- **Auth** (`src/auth.ts`). Two credentials providers: `credentials` (bcrypt) and `demo` (email only, active only when `DEMO_MODE=true`; powers the login shortcuts and the top-bar role switcher).
- **Seed** (`prisma/seed/index.ts`; accounting in `accounting.ts`; sales in `sales.ts`, parts in `parts.ts` and the workshop in `workshop.ts`, run inside the accounting day loop through `HistoryHooks` combined by `composeHooks`) creates reference data directly but all business objects through services. It is deterministic (`faker.seed(42)`, plus separate Faker instances seeded 4242 for sales, 4343 for parts and 4444 for the workshop), so do not reorder faker calls casually; append new generators at the end. It takes ~200 s (≈1,000 repair orders and ≈50 warranty claims, ≈165 sales orders, ≈640 counter sales, ≈180 parts orders; months before the last finished one are locked); `SEED_PROFILE=1` prints per-step timings and skipped steps. Seed v1 stock is replayed as history (D-044), so the opening balance holds only the vehicles present at the opening; parts opening stock is created by the `opening` hook before the opening entry, which values it in 373000 (D-054).
- **Tests.** `tests/integration/helpers.ts` gives `resetWithMinimalOrg()` (truncate + 2 sites + roles), `resetWithAccounting()` (+ VAT rates and default chart), `resetWithSales()` (+ catalogue version, add-on, OEM/bodyshop/auction suppliers, a customer), `resetWithParts()` (+ parts suppliers, discount codes A/B, four parts incl. a supersession, a retail and a trade customer), `resetWithWorkshop()` (+ parts stock, two labour operations, an insurer, a customer car, technician/advisor/manager actors), `partsStockValue(siteId?)`, `balanceOf(account, { siteId?, partyId? })`, `sys()` (system command at a fixed business date, 2026-03-15) and `makeActor(role, siteId)`. Vitest runs files serially because they share `dms_test`.

## How to add a feature (pattern)

1. Pure rules in `modules/<m>/domain/*.ts` + unit test in `tests/unit`.
2. Zod schema in `modules/<m>/schemas`, service in `modules/<m>/services` taking `ctx: ServiceContext` (`ctx.require`, `ctx.tx`, `ctx.audit`, `ctx.emit`). Declare events with `declare module "@/lib/events" { interface DomainEventMap {…} }`.
3. Export from `modules/<m>/index.ts`.
4. Page = server component using `query(fn, permission)`; mutation = server action using `command(fn)` returning `ActionResult`; lists use `parseListParams` + `DataTable` + an exporter in `src/app/api/export/[entity]/route.ts`.
5. Add the screen to `src/components/shell/nav.ts` (remove its `phase`), strings to `messages/en.json` **and** `messages/fr.json`, its title to `titles`, and any new service message to `messages/server/fr.json`.

## Coding conventions

- **Business logic lives only in `src/modules/<module>/services` and `domain`.** Never in React components, server actions or route handlers. Actions just turn `FormData` into an object and call `command()`. The **service** validates with `parseInput(schema, input)`, so CLI callers get the same validation and field errors flow back to `ActionForm`.
- `domain/` = pure functions, no Prisma, no I/O, no `new Date()`. Every calculation there has a unit test.
- Modules import each other only through `index.ts`. Cross-module side effects go through domain events (`ctx.emit`) or an explicit public service call. Accounting never imports sales/workshop/parts.
- Every mutation: Zod-validated in the service, permission-checked with `ctx.require("module.resource", action, siteId)` (site-scoped where the object has a site), audited (`ctx.audit`), and run in `ctx.tx`.
- Money: `Int` cents, fields suffixed `Cents`. Never use floats for money; round only via `lib/money.ts`. Rates in basis points (`2000` = 20 %). Labour time in centi-hours. Parts qty and PMP as `Decimal`.
- Dates: business dates from `ctx.businessDate` (the simulated clock). `new Date()` only for technical timestamps.
- Nothing country-specific in code: VAT rates, accounts (via `AccountMapping` keys), number formats and legal mentions come from settings.
- Invoices and journal entries are immutable once issued/posted; correct with credit notes / reversals.
- UI strings via next-intl `t()`, in English and French.
- Customers are group-wide (one CRM shared by all sites); stock vehicles are site-scoped; customer-owned vehicles are visible to all sites.
- A VN gets a `stockInDate` only when it reaches `IN_STOCK`; a VO from intake (ageing starts then).
- Names: files `kebab-case.ts`, components `PascalCase.tsx`, DB tables via Prisma `@@map` in `snake_case`.
- One conventional commit per phase (`feat(sales): …`), ending with the Co-Authored-By line.

## Domain glossary

| Term | Meaning |
|---|---|
| VN (New Vehicle) | New car sales, ordered from the manufacturer (OEM) or taken from stock |
| VO (Used Vehicle) | Used car sales, sourced from trade-ins, auctions or buy-backs |
| Trade-in (Reprise) | A customer's vehicle taken in part-payment |
| Order form (Bon de commande) | A signed customer order, which turns into an invoice on delivery |
| RO (Repair Order / OR) | A workshop job card: customer, vehicle, jobs, labour, parts |
| Labour time (Temps barème) | Standard time per operation; billed hours vs. hours actually clocked |
| PR (Parts / Pièces de rechange) | Spare parts and accessories |
| VAT on margin (TVA sur marge) | VAT regime for used cars bought from private individuals: VAT charged on the margin only |
| PCG | French chart of accounts (Plan Comptable Général) |
| Site | A dealership location. A group has several sites and brands |
| PMP | Weighted average cost (prix moyen pondéré) used to value parts stock |
| Front-end / back-end margin | Margin on the vehicle itself / margin on financing and add-on products |
| Police register (Livre de police) | Mandatory register of used vehicles bought and sold |
| FEC | Fichier des écritures comptables, the French standard accounting export |
| OD | Miscellaneous journal (opérations diverses) |

## Business assumptions (approved with the Phase 0 plan)

1. **Sites:** Nantes (NTE), Rennes (REN), Angers (ANG); one legal entity, invoice series per site.
2. **Brands:** two real makes with *fictional* catalogue prices (default Peugeot + Renault); trade-ins can be any make.
3. **Inventory:** perpetual (37x always equals the stock sub-ledgers), see D-005.
4. **Fiscal year** = calendar year, monthly periods.
5. **VAT:** France 20 % standard (10 % / 5.5 % configured but unused). Margin VAT base = sale price incl. VAT − purchase price; reconditioning not deducted.
6. **Eco bonus/malus and registration fees:** configurable tables with illustrative values, not the exact legal scale.
7. **Discount approval:** > 5 % of list price → Sales Manager; > 10 % → Dealer Principal.
8. **Reservations** expire after 7 days. **Stock ageing alerts** at 60/90/120 days.
9. **Commission:** 10 % of front-end margin + €50 per add-on product + 20 % of financing commission.
10. **Labour rates:** customer €95/h excl. VAT, warranty rate per brand €80/h, internal €60/h (per site, editable).
11. **Payment terms:** individuals pay at delivery/collection; companies 30 days; OEM warranty 45 days.
12. **Negative parts stock** not allowed by default.
13. **History window:** seed generates the 6 months before the current business date; initial business date = today.
