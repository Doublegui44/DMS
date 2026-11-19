# DMS Simulator

Web simulator of a French multi-site car dealer group's Dealer Management System (VN/VO sales, workshop, parts, accounting, admin). For demos, training and workflow testing. **Every operational action must have its downstream effects** (stock, invoice, journal entries, KPIs), in one transaction.

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)
- Technical decisions: [docs/DECISIONS.md](docs/DECISIONS.md) — log every new technical choice there

## Current phase

**Phase 1 done** (setup, auth, RBAC, shared core, app shell, seed v1). **Next: Phase 2 — accounting engine.**

What exists: `src/lib` (money, context/runCommand, event bus, rbac, list params, csv, session), `src/modules/core` (customers, vehicles, numbering, clock, timeline, dashboard), `src/modules/admin` (roles matrix, users, audit), screens for dashboard, customers, vehicles, admin users/roles/settings/audit. Later-phase screens show a placeholder (`src/app/(app)/[...placeholder]`).

## Stack

Next.js 15 (App Router, Server Actions) · TypeScript strict · Tailwind v4 + shadcn/ui · TanStack Table · Recharts · Prisma 6 + PostgreSQL 17 (local Homebrew) · Auth.js v5 credentials · Zod · next-intl · @react-pdf/renderer · Faker (fr) · Vitest · Playwright · npm · Node 24

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app on http://localhost:3000 |
| `npm run db:migrate` | `prisma migrate dev` (new migration) |
| `npm run db:seed` | Seed an empty database |
| `npm run db:reset` | Migrate, truncate all tables and reseed (`scripts/db-reset.ts`; refuses anything but a local `dms_*` DB) |
| `npm test` | Vitest unit + integration (integration wipes `dms_test`) |
| `npm run test:e2e` | Playwright; resets + seeds `dms_e2e`, runs a dev server on :3100 (`.next-e2e`) |
| `npm run lint` / `npm run typecheck` | ESLint (incl. module-boundary + no-wall-clock rules) / `tsc --noEmit` |
| `npm run simulate -- --days 30 --site nantes` | Scenario runner (Phase 7, not built yet) |

Databases (local Homebrew Postgres 17, socket `/tmp`): `dms_dev` (.env), `dms_test` (.env.test), `dms_e2e` (.env.e2e).
`prisma migrate reset` is blocked for AI agents by Prisma; use `npm run db:reset`, and ask the user before resetting `dms_dev`.

Demo users: every seeded user's password is `demo1234` (dev only). Emails: `admin@dms.test`, `dealer.principal@dms.test`, `accountant@dms.test`, `sales.manager.<site>@dms.test`, `salesperson{1,2}.<site>`, `service.manager.<site>`, `service.advisor.<site>`, `technician{1,2}.<site>`, `parts.manager.<site>`, `parts.advisor.nantes` (site = nantes | rennes | angers). With `DEMO_MODE=true` the login page and top bar offer one-click user switching.

## How to add a feature (pattern)

1. Pure rules in `modules/<m>/domain/*.ts` + unit test in `tests/unit`.
2. Zod schema in `modules/<m>/schemas`, service in `modules/<m>/services` taking `ctx: ServiceContext` (`ctx.require`, `ctx.tx`, `ctx.audit`, `ctx.emit`). Declare events with `declare module "@/lib/events" { interface DomainEventMap {…} }`.
3. Export from `modules/<m>/index.ts`.
4. Page = server component using `query(fn, permission)`; mutation = server action using `command(fn)` returning `ActionResult`; lists use `parseListParams` + `DataTable` + an exporter in `src/app/api/export/[entity]/route.ts`.
5. Add the screen to `src/components/shell/nav.ts` (remove its `phase`) and strings to `messages/en.json`.

## Coding conventions

- **Business logic lives only in `src/modules/<module>/services` and `domain`.** Never in React components, server actions or route handlers. Actions: parse with Zod → `runCommand(...)` → return `{ ok, data | error }`.
- `domain/` = pure functions, no Prisma, no I/O, no `new Date()`. Every calculation there has a unit test.
- Modules import each other only through `index.ts`. Cross-module side effects go through domain events (`ctx.emit`) or an explicit public service call. Accounting never imports sales/workshop/parts.
- Every mutation: Zod-validated server-side, permission-checked (`runCommand(session, 'module.resource', action, fn)`), audited (`ctx.audit`), and run in `ctx.tx`.
- Money: `Int` cents, fields suffixed `Cents`. Never use floats for money; round only via `lib/money.ts`. Rates in basis points (`2000` = 20 %). Labour time in centi-hours. Parts qty and PMP as `Decimal`.
- Dates: business dates from `ctx.businessDate` (the simulated clock). `new Date()` only for technical timestamps.
- Nothing country-specific in code: VAT rates, accounts (via `AccountMapping` keys), number formats and legal mentions come from settings.
- Invoices and journal entries are immutable once issued/posted; correct with credit notes / reversals.
- UI strings via next-intl `t()`. English only for now.
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
