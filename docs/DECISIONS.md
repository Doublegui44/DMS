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

## D-020 — Balance and immutability also enforced in Postgres
A deferred constraint trigger (`journal_entry_balanced`, checked at commit) rejects any entry with fewer than two lines or debit ≠ credit; a `CHECK` keeps each line one-sided and non-negative. Row triggers make `journal_entry` immutable and allow only `letteringCode` to change on `journal_line`; inserts and deletes into a locked period raise `PERIOD_LOCKED`. The service still validates first (clear messages, all errors at once); the database is the backstop for raw SQL, future code paths and the simulator.

## D-021 — Collective GL accounts with party on the line
Customers post to collective accounts (411000, 411100 for OEMs) and suppliers to 401000 / 401100; the auxiliary ledger is `partyType` + `partyId` on each line, and receivable/payable accounts refuse a line without the right party. `Customer.accountCode` / `Supplier.accountCode` are the auxiliary codes used for display and, later, the FEC `CompAuxNum` column. No per-customer account rows, so the chart stays small.

## D-022 — Number series
Journal entries: one gap-free series per journal and fiscal year, group-wide (`VE-2026-000001`), year taken from the entry date. Invoices and credit notes: per site (`NTE-FA-2026-…`, `NTE-AV-2026-…`), numbered at issue. Receipts `RC` and disbursements `RG` per site. Suppliers `F00001`. All through `nextDocumentNumber` (D-007), so a rolled-back command leaves no gap.

## D-023 — Invoices post directly; operational modules call accounting
`issueInvoice` takes the number, posts the sales entry through `postEntry` and links it, all in the caller's transaction; it then emits `InvoiceIssued` for other modules. No event handler is involved because posting is inside the accounting module. Sales/workshop/parts will call `createAndIssueInvoice(ctx, input, { trusted: true })` after checking their own permission (a salesperson delivering a car cannot hold `accounting.invoice:validate`). The first cross-module *handler* (and its registration module) is still to come with Phase 3.

## D-024 — Supplier is a core party
`Supplier` sits next to `Customer` in core (group-wide, created with `createSupplier`); each brand points to its OEM as a customer (warranty receivables) and as a supplier (vehicle and parts purchases).

## D-025 — Corrections: reversal for manual entries, credit note for invoices
`reverseEntry` mirrors a manual or opening entry at the business date and links both ways; generated entries (invoices, payments) cannot be reversed directly. `creditInvoice` issues a full credit note that offsets what is still due on the invoice; any surplus stays open on the credit note and is refunded with an `OUT` payment allocated to it.

## D-026 — Lettering
Lettering follows settlement: after a payment allocation or a credit note, `letterSettlement` walks the settlement group (invoices ↔ allocated payments ↔ credit notes) and, once every document in it is fully settled, letters the group's receivable lines together (codes A…Z, AA…, per account and party). One unpaid invoice therefore never blocks lettering of the others, and lettering always matches invoice status. Accountants can letter any zero-sum selection by hand (e.g. supplier lines, payments on account) and unletter a code. Lettering is not a posting, so it is allowed in locked periods.

## D-027 — Periods and close
Monthly periods are created on first use (`ensurePeriod`) and by the seed. Locking requires: period open, every earlier period that holds entries locked, the business date past month end, and the period's trial balance balanced; draft invoices only warn. `lockedAt` records the business date. Reopening needs `accounting.period:delete` (admin only), a reason, and no later locked period.

## D-028 — Accounting seed: opening entry plus light history
Until vehicle purchases are posted (Phase 3) and the simulator generates history (Phase 7, D-010), the seed posts an opening entry per site (journal AN) at the start of the six-month window: current VN/VO stock values on 371000/372000 (so 37x equals the vehicle sub-ledger), bank and capital, difference to 110000. It then generates workshop and warranty invoices, receipts, rent and salaries day by day through the services, and locks every month except the last finished one. The stock part is superseded by D-044: the opening entry now holds only the stock present at the opening.

## D-029 — Dynamic-line forms call server actions with plain objects
Manual entries, invoices and payments have a variable number of lines, so these forms are client components that pass a typed object to the server action instead of `FormData`. The action only converts euro strings to cents (`parseEuros`); validation stays in the service (D-018 still applies to fixed forms).

## D-030 — Preview against the e2e database
`.claude/launch.json` has a `dms-e2e-preview` server (`.next-preview`, `.env.e2e`) to look at screens with seeded data without resetting `dms_dev`. Playwright resets `dms_e2e` on every run, so stop the preview before running e2e tests.

## D-031 — Cross-module handlers and one registration module
Handlers registered with `on(type, handler)` run inside the emitting command's transaction. Every module's registrations live in `src/modules/register.ts`, imported for its side effect by `src/lib/session.ts`, the seed, CLI scripts and the integration tests. `runCommand` refuses to run before that import has happened, so a missing import fails loudly instead of silently skipping postings. First handlers: accounting turns `VehicleStockMoved` into 37x/603x entries, and sales expires reservations and quotes on `BusinessDayAdvanced`.

## D-032 — Vehicle stock values move only through core
`moveVehicleStock` (core) is the only way a stock value changes. `IN` sets the value (arrival or purchase cost), `COST` adds a capitalised cost (reconditioning, transport), and `OUT` books the current value as cost of sale. It publishes `VehicleStockMoved`, which accounting posts (D-031). Sales never writes 37x directly, so the GL stock accounts equal the stock sub-ledger by construction (`expectStockLedgerMatchesGl` in the integration tests).

## D-033 — Trade-in: a VO purchase at signature, settled at invoicing
When the customer signs, the trade-in enters VO stock (INTAKE, margin regime, police register) and is booked as a purchase from the customer at the offer: Dr 607200 / Cr 467400 (party = customer), and Dr 372000 / Cr 603720. At invoicing, a `TRADE_IN` payment (Dr 467400 / Cr 411000) settles that much of the invoice, so the customer's account shows the real flows. If the order is cancelled before invoicing and the car is untouched, everything is reversed and the car goes back to its owner. An offer above market value minus repairs (over-allowance) counts as discount for approval.

## D-034 — VAT per invoice line, margin regime, pass-through lines
Each invoice line carries its own VAT treatment, so one invoice can mix a taxable car, add-ons and pass-through fees:
- **Standard rate:** the usual case.
- **Margin regime:** used cars bought without VAT. VAT = (price incl. VAT − purchase cost) × rate / (1 + rate), and reconditioning is not deducted (assumption 5).
- **No VAT:** amounts passed through to the state, such as the registration certificate (467100) and the eco malus (447100).

## D-035 — OEM incentive, financing, add-on costs
- **OEM incentive:** optionally passed to the customer as a negative line on the VN deal, and claimed from the OEM on a separate invoice (411100 / 707100) when the order is invoiced.
- **Financing:** at invoicing, a `FINANCE_COMPANY` payment moves the financed amount from the customer (411000) to the lender (467300). The dealer's commission is booked as back-end revenue (Dr 467300 / Cr 706600).
- **Add-ons and accessories:** their costs are accrued at invoicing (Dr 604100 / 607400, Cr 408100) until the provider's invoice arrives.

## D-036 — Discount approval
Approval rules are data (`ApprovalRule`: threshold in basis points and approver role), seeded from assumption 7: above 5 % the Sales Manager, above 10 % the Dealer Principal. The effective discount is the dealer discount plus the trade-in over-allowance, over the list price incl. VAT. A quote above a threshold goes to PENDING_APPROVAL instead of SENT. The approver can be the rule's role, any role with a higher threshold, or an admin, but never the requester. Revising the quote withdraws the request.

## D-037 — Reservations and double-sale prevention
A stock vehicle can be reserved for a quote. A partial unique index allows one ACTIVE reservation per vehicle, and reservations expire after the `sales.reservationDays` setting (default 7) through the day-change handler. A vehicle also has at most one open order (CONFIRMED or INVOICED), checked in `acceptQuote` and enforced by a second partial unique index, so concurrent commands cannot sell it twice. Cancelling an order puts the vehicle back on sale.

## D-038 — Factory orders
A configured VN is ordered from the OEM when the customer signs. `placeFactoryOrder` creates the vehicle (ORDERED) and the factory order (CU series), with ETA = order date + the version's lead time; stock orders take the same path without a customer. The OEM reference is derived from our number. On arrival, `receiveVehicle` books the OEM invoice (Dr 607100 + 445660 / Cr 401100) and the stock entry. Until then the order cannot be invoiced (`canInvoiceOrder` requires the car to be physically in stock).

## D-039 — Purchases book the supplier side directly
VN arrivals, VO purchases from traders and capitalised VO costs book the supplier's invoice from the operational event, with the supplier reference stored on the purchase or cost line. There is no separate supplier-invoice document yet: supplier invoices and their matching arrive with purchasing in Phase 4.

## D-040 — Police register
Every VO entry (trade-in, private seller, trader) creates a police-register entry, numbered per site, with the seller's identity. The VO sale invoice fills in the exit: buyer, date, price and invoice number. The register is read-only in the UI and exports to CSV.

## D-041 — Deposits are payments on account
A deposit is a customer payment on account (`sourceType` SALES_ORDER) that is allocated to the invoice when the order is invoiced; a cancelled order leaves it on account for a refund. Recording money from the order screen needs `accounting.payment:create` on top of `sales.order:edit`.

## D-042 — Quote builder: a client draft priced on the server
The builder is a client component that holds a draft. Each change triggers `previewQuoteAction` (debounced 350 ms), which runs the same pricing service as saving inside a command that writes nothing. The totals, margins and approval level shown are therefore exactly what will be saved. Helpers shared with server pages live in `quotes/draft.ts` (no `"use client"`), because server components cannot call functions exported from a client module.

## D-043 — Pipeline board without drag-and-drop
A card's column is derived from the lead stage and the quote and order status. Every move is a business action with guards (approval, reservation, payment), so cards link to the lead or order instead of being draggable.

## D-044 — Sales seed inside the accounting history
- **Interleaving:** the sales history runs inside the accounting seed's day loop through `HistoryHooks`, so document numbers stay chronological.
- **Determinism:** it uses its own Faker instance (seed 4242), so earlier seed data stays identical, plus deterministic VIN and plate generators.
- **Real permissions:** commands run as the sites' own users, so permissions, approvals and commissions are real. A refused business step is skipped and counted.
- **Open pipeline:** tasks dated on or after the business date never run, which leaves a live pipeline.
- **Seed v1 stock:** it becomes history. Cars on order get their factory order on their order date. Cars that arrived or were bought after the opening are booked on their stock-in date through seed-only services (`registerPastArrival`, `registerPastVoPurchase`). The opening balance therefore holds only stock present at the opening (none with the current data), and share capital is €300k so 110000 stays a credit balance. This supersedes the stock part of D-028.

## D-045 — Settings merge order
`getSetting(key, siteId)` merges objects key by key: code default, then group value, then site override. A site can override one field of a group setting without restating the others.

## D-046 — Field errors carry their full path
`parseInput` reports nested errors under their full path (for example `tradeIn.offerCents`), so forms with nested sections show each error next to its own field.

## D-047 — Stale sessions after a reseed
A JWT can outlive its user, for example after a reseed. The login page redirects to the dashboard only if the session's user still exists and is active; otherwise it shows the form. This breaks the /login ↔ /dashboard redirect loop.

## D-048 — Stock cars move only through their business flow
Until Phase 3, the vehicle screens could set a VN to IN_STOCK by hand. Now that an arrival books the OEM invoice and the stock entry, that shortcut would put a car on the books with no entry behind it, and 37x would drift from the stock sub-ledger. So:
- **Creation:** `createVehicle` called from a screen accepts only customer cars. New cars enter stock through a factory order, used cars through a purchase or a trade-in. The seed creates its v1 stock as a trusted caller and books it as history (D-044).
- **Status and commercial data:** `changeVehicleStatus` and `patchVehicle` refuse callers that are not `trusted` (ConflictError). Only the sales flows call them, in the command that books the matching effects. The vehicle page keeps the status history and links a stock car to its sales page.
- **Edits:** `updateVehicle` still corrects descriptive fields (VIN, plate, version, mileage…). On a stock car it keeps the site, brand, owner, list price and VAT regime, which drive the per-site stock accounts, the OEM account, the VAT treatment and the discount approvals (D-036). VO prices change through repricing. Moving a car to another site needs a transfer flow, deferred.

## D-049 — Parts stock: perpetual, value-based PMP, one ledger
- **Valuation:** each stock item (part × site) holds its quantity, value and PMP. A receipt adds its value; an issue takes `qty × PMP` out, and the last unit takes the remaining value, so no rounding residue stays in stock. PMP is kept to 4 decimals of a cent (`Decimal(18,4)`), and amounts are whole cents.
- **Ledger:** every change goes through `moveStock`, which locks the row (`SELECT … FOR UPDATE`) and writes a `PartMovement` (signed qty and value, qty and PMP after). Movements are immutable (trigger), and a CHECK constraint forbids negative stock (assumption 12).
- **Books:** each movement posts in the same command. The parts stock account 373000 therefore always equals the sum of the stock items, per site (checked by the seed and the integration tests).
- **Units:** quantities are `Decimal(12,3)`. Parts sold by the unit (`EA`) must be whole; litres and metres may be fractional. Screens accept a comma as decimal separator.

## D-050 — Goods received not invoiced, then three-way match
- **Receipt:** stock in (Dr 373000 / Cr 603730), and the purchase is accrued (Dr 607300 / Cr 408100, party = supplier), both at the order price.
- **Supplier invoice:** it bills receipt lines (partially if needed). Dr 408100 at the receipt value, the price difference to 607300, deductible VAT 445660, Cr 401 (401100 for OEMs, else 401000). 408100 returns to zero for that receipt.
- **Tolerance:** the setting `parts.invoiceTolerance` is max(€5, 1 %) of the receipt value by default. Within it, the invoice is MATCHED and posted at once. Above it, the invoice waits in VARIANCE until someone with `parts.purchase_order:validate` approves it (posted then) or rejects it (with a reason; the receipt lines become billable again).
- **Variance goes to purchases, not to stock.** The goods may already be sold, and revaluing the PMP after the fact would break the ledger.
- **Payment:** `paySupplierInvoice` records the outgoing payment and letters it with the invoice line on 401. This also closes the Phase 3 gap for OEM parts (D-039 stays for vehicles).

## D-051 — Inter-site transfers through a liaison account
Sites are one legal entity, so a transfer is not a sale. It moves stock at the sending site's PMP. Each site posts its own side through 181000 (`SITE_LIAISON`): the sender Cr 373000 / Dr 181000, the receiver Dr 373000 / Cr 181000. Group-wide, 181000 nets to zero.

## D-052 — Supersessions
A supersession (old → new, effective date) applies from its date. Counter sales and orders asked for the old number use the successor, and the line keeps the number asked for. Stock already held under the old number is still sold, counted and transferred under it. Replenishment skips superseded parts, and loops are refused.

## D-053 — Counter sale lifecycle
- **QUOTE:** reserves nothing.
- **CONFIRMED:** reserves the quantity (`qtyReserved`), so available stock = on hand − reserved.
- **INVOICED:** takes the parts out at PMP and issues the invoice through accounting. The price comes from the retail price less the discount for the part's discount code × the sale's price class, which defaults to the customer's. Revenue goes to 707300 / 707400 / 707500 (retail and trade / warranty / internal) by price class.
- **Payment:** individuals pay at the counter. Companies with terms go on account (assumption 11). Taking money needs `accounting.payment:create`.

## D-054 — Parts seed: opening stock in the opening entry, then history
- **Reference data:** about 2,000 references are created directly as reference data: two makes with their numbering style, an aftermarket range from the regional distributor, five discount codes and 40 supersessions dated during the history.
- **Opening stock:** `registerOpeningStock` (system actor only, bulk inserts, OPENING movements, no posting) creates each site's stock. A new `opening` history hook runs it before the accounting opening entry, which now carries 373000 per site.
- **History:** six months run inside the accounting day loop (`composeHooks(sales, parts)`) as the parts managers, the Nantes advisor and the accountant. This covers counter sales, weekly suggested orders (some lines short and received later), supplier invoices (a few variances approved or rejected and re-invoiced), payments at due date, emergency orders, transfers and monthly cycle counts. The current week's orders and the current month's counts are left open for the demo, and some items have had no movement for 14–20 months for the obsolescence report.
- **Determinism:** the seed uses its own Faker (seed 4343). It adds about 30 s to the seed (≈ 100 s in total).

## D-055 — Entry links follow the entry permission
Parts screens show journal entry numbers to everyone who can see the document, but link them only for users with `accounting.entry:view` (`EntryLink`). Managers outside accounting therefore never land on /forbidden.
