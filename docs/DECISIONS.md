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

## D-056 — Repair order = jobs, one payer per job
- **Shape:** a repair order (RO) holds jobs. Each job has one payer (CUSTOMER, WARRANTY, INSURANCE or INTERNAL) and labour, part and sublet lines. A job's payer sets its labour rate (customer / warranty per make / internal, `workshop.*` settings per site), its parts price class and its revenue accounts.
- **Lifecycle:** CHECKED_IN → IN_PROGRESS (first clocking or line) → QUALITY_CHECK (automatically when every job that may proceed is done) → READY (QC passed, `workshop.repair_order:validate`) → INVOICED → CLOSED (car handed over; an individual's balance must be zero). An RO can be cancelled before invoicing only if nobody has clocked on it; its parts go back to the shelf.
- **Additional work:** a CUSTOMER job added after check-in waits in PENDING with its estimate. Its parts are issued only once the customer approves. A declined job is never invoiced.
- **One open RO per car**, checked by the service.

## D-057 — Parts on a repair order leave stock when the job may proceed
A part line issues the parts at once (`issuePartsToRepairOrder`, movement ISSUE_RO at PMP, posted in the same command), unless the job is still waiting for approval. Removing the line or cancelling the RO returns them at the cost they left with (RETURN_RO). The line keeps that cost, so the RO's margin is known before invoicing and 373000 still equals the stock items.

## D-058 — Invoicing per payer; warranty through a claim
`invoiceRepairOrder` issues, in one command:
- **Customer jobs:** one invoice to the customer. It is paid at once (card, cash…) or left on account.
- **Insurance jobs:** one invoice per insurer.
- **Warranty jobs:** one invoice per job to the make's manufacturer account (`brand.oemCustomerId`, 45-day terms) and a warranty claim (`GA` series). The receivable sits on the OEM in 411. An accepted claim waits for the monthly remittance (`recordWarrantyRemittance`, lettered). A rejected claim credits the invoice (`creditInvoice`); the dealer absorbs the cost.
- **Revenue:** labour 706100 / 706300 (warranty), parts 707300 / 707400, sublets 706200, by department WORKSHOP or PARTS.
- **Sublets:** the subcontractor's purchase (604000 + deductible VAT / 401) is posted at invoicing.

## D-059 — Internal repair order capitalised into the used car
An internal RO prepares a used car in stock (INTAKE, RECONDITIONING, FOR_SALE or RESERVED). Nothing is invoiced. At invoicing:
- An OD entry (`buildInternalWorkEntry`) charges the work at internal rates: Dr 604000 (department VO) / Cr 706400, 707500 and 706200.
- Sales `capitaliseRepairOrder` adds a RECONDITIONING cost line and moves the vehicle stock (COST), so 372000 rises by the same amount and still equals the VO sub-ledger.
- The workshop and parts departments thus earn their internal revenue, and the VO department carries the cost in the car's value until it is sold. Under the margin regime the preparation is not deducted from the VAT base (assumption 5).

## D-060 — Clocking, productivity and efficiency
- **Clocking:** a technician clocks on one job at a time. Clocking on another job closes the open one. Clocking off can mark the job done. Clocking for someone else needs `workshop.clocking:validate`.
- **Definitions** (`domain/productivity.ts`):
  - Available hours = working days (Monday–Friday) × the technician's daily capacity.
  - Productivity = clocked ÷ available.
  - Efficiency = billed ÷ clocked.
  - Utilisation = billed ÷ available.
- **Capacity:** booking an appointment refuses a technician whose booked hours for the day would exceed their capacity.

## D-061 — Workshop seed
- **Reference data:** 27 labour operations, rates, bays and one Technician row per technician user.
- **History:** six months run inside the accounting day loop (`composeHooks(sales, parts, workshop)`, own Faker seed 4444) as the advisors, technicians and service managers. It covers:
  - Customer visits with appointments, check-in, clocking, QC, invoicing and hand-over.
  - Warranty jobs on cars of the group's makes up to 3 years old.
  - Additional work, some of it declined, and insurance jobs with sublets.
  - Internal ROs twice a week on used cars already bought on that day.
  - The warranty desk: decisions on Mondays, remittances on the 15th.
- **Accounting seed:** the fake workshop invoices from Phase 2 are gone; all workshop revenue now comes from real ROs.
- **Open work for the demo:** ROs at every open stage on the last day, and appointments for the next 14 days.
- **Cost:** the seed now takes about 200 s.

## D-062 — A reports module reads across modules
- `src/modules/reports` holds the read models that need several modules: role dashboards, the stock value report and printable documents. It imports the other modules only through their `index.ts` and never writes.
- Reports that need only the journal stay in accounting (`queries/reports.ts`, pure rules in `domain/reports.ts`), so accounting still imports no operational module.

## D-063 — P&L by department from the journal
- Every P&L line already carries a `departmentCode` (posting requires it on 6/7 accounts), so the P&L is a `groupBy` on journal lines, never a recomputation from invoices.
- Sections by account prefix: 70 revenue, 60 cost of sales, other 6 expenses, other 7 other income. Gross margin = revenue − cost of sales; result = gross margin − expenses + other income. Lines without a department show as "Unallocated".
- Labour cost sits in 641 (salaries, OVERHEAD), not in workshop cost of sales, so the workshop gross margin is close to 100 %. The P&L page says so.

## D-064 — Ageing balance
- **Receivables:** open invoices and credit notes (ISSUED / PARTIALLY_PAID) aged by due date in five buckets (not due, 1–30, 31–60, 61–90, over 90). Each customer row also shows the GL balance of its 411 lines and the difference as "unapplied" (deposits and payments not yet allocated), so the report always ties to the ledger.
- **Payables:** suppliers have no open-item table, so open items are rebuilt FIFO from their 40x lines (408 excluded): payments settle the oldest documents first, and the balance sits on the newest. Due date = entry date + the supplier's payment terms.
- Payables look old in the seed because vehicle purchases from OEMs and traders are never paid (D-039).

## D-065 — VAT return
- Collected (4457x) and deductible (4456x) VAT for a month come from the journal; net due = collected − deductible.
- The same page lists sales by regime and rate from invoice lines and shows the difference between invoiced VAT and collected VAT as "unexplained", which should be zero. Flow 6 checks it.

## D-066 — FEC export
- `getFecExport(ctx, year)` returns the 18 standard columns, `|`-separated, CRLF, a header row, amounts with a decimal comma, dates as `YYYYMMDD`. File name `<SIREN>FEC<closing date>.txt`.
- Auxiliary account = the customer's or supplier's own account code and name. Piece reference = the invoice or payment number, else the entry number. Lettering date = the latest entry date of the lettering group.
- Group-wide users only: the FEC covers the legal entity, not one site.

## D-067 — Role dashboards
- Widgets per role are data (`ROLE_DASHBOARDS` in `reports/domain/dashboards.ts`). A user with several roles gets the union. A widget is shown only if the user can view its resource, and a "mine" widget (units sold for a salesperson, productivity for a technician) is restricted only if every role that grants it is restricted.
- Figures reuse the report queries (P&L, ageing, VAT, productivity), so the dashboard and the reports cannot disagree. An integration test and e2e Flow 6 check this.
- Parts turnover = cost of parts used over the last 90 days (counter sales and RO issues net of returns, at PMP), annualised, ÷ stock value today; days of cover = 365 ÷ turns.

## D-068 — Charts
- Recharts 3.10.1, client components in `src/components/charts`. Bars only (months on x, one y-axis), legend in series order, tooltip on hover, no animation.
- Four categorical slots in `--chart-1..4` with light and dark values, checked with a colour-blindness validator. Each department keeps its colour wherever it appears (VN 1, VO 2, workshop 3, parts 4). Two slots are below 3:1 contrast in light mode, so every chart has a table with the same figures next to it.

## D-069 — Printable documents (PDF)
- `@react-pdf/renderer` 4.9.0, server-side only (`serverExternalPackages`), built-in Helvetica (WinAnsi covers French accents and €).
- The reports module turns an invoice, credit note, order form, repair order or warranty claim into one neutral `PrintDoc` (`getPrintableDocument`). One A4 template (`components/pdf/print-document.tsx`) lays it out. Money rules live in the pure `invoiceBody` (unit-tested): a line under the margin scheme is printed incl. VAT, left out of the VAT summary, and the margin mention is added.
- `GET /api/pdf/<kind>/<id>` uses the same permission as the document's screen. Legal mentions come from the `documents.legalMentions` setting (per document type, site-overridable). Identifiers (SIREN, SIRET, VAT number) come from the group and the site.

## D-070 — Month-end close pack
- The periods screen links the reports to review before locking (trial balance, P&L, VAT return, receivables ageing) for the selected month.
- e2e Flow 6 (`tests/e2e/close.spec.ts`) owns the lock of the last finished month. It checks that the P&L and trial balance results agree, that the VAT has no unexplained amount, then locks the month and checks that a manual entry dated in it is refused. The lock test moved there from `accounting.spec.ts`.

## D-071 — Scenario runner: stateless, one transaction per business step
- `modules/simulation` runs day by day from the business date: on each open day (Monday–Saturday) every site's accounts, sales, workshop and parts desks act, then `advanceBusinessDay` moves the clock. Sundays only advance the clock.
- Every action is a call to another module's public service (`createLead`, `acceptQuote`, `checkIn`, `invoiceCounterSale`, `recordPayment`…), never a direct write, so each one has its usual downstream effects (stock, invoices, entries, events, audit).
- Each step runs in its own `runCommand` on the simulated day. A `DomainError` (a business rule refusing the step) is recorded in the report and the run goes on; any other error stops the run and is reported with its day. The days before it are kept.
- The runner keeps no state between days: it reads what is open in the database (leads, quotes, orders, ROs, deliveries, invoices due). Decisions about one record (accept this quote? cancel this order? pay this invoice late? how many days in the workshop?) use `unit(seed, recordId, purpose)`, a draw fixed for that record, so the answer does not depend on which day the runner looks or whether the run was split. Counts per day (new leads, visits, counter sales) use a seeded stream (Poisson for rates). The same seed on the same data gives the same run.
- Rates are a Zod schema with defaults (`domain/config.ts`), per site and per open day unless named per week. They are what the admin form and the CLI flags expose.

## D-072 — The runner acts as the sites' own users
- For each site it loads the active holders of each role (first by email): salespeople, sales manager, service advisor, service manager, parts manager, plus the group's dealer principal and accountant (`loadCast`). Each step runs as the person who would do it: the salesperson quotes, the sales manager or dealer principal approves discounts (by the D-036 thresholds), the advisor checks cars in, the service manager runs the workshop, the accountant pays and collects. Permissions are checked as for the screens.
- A role with nobody in it skips its steps. Starting a run needs `admin.simulation:edit` (admin); the CLI starts as the system actor.

## D-073 — End-of-day jobs and derived states
- `BusinessDayAdvanced` already expires reservations and quotes (sales handler). Stock ageing and overdue receivables need no job: they are computed from the business date when read (ageing report, VO ageing, dashboards), so moving the clock is enough.
- Parts reorder suggestions are placed by the runner on Mondays as the parts manager (`createSuggestedOrders` + `sendPurchaseOrder`), as a person would, rather than ordering automatically at the end of each day.
- The runner creates the accounting periods a month ahead (`ensurePeriods`) so a run can cross a year end.
- Overheads: rent on the 1st and salaries on the 28th repeat the last amounts booked, so the runner needs no figures of its own.

## D-074 — Seed history stays with the seed (roadmap deviation)
- The roadmap planned to generate the six months of seed history with the runner. The seed keeps its own per-module generators instead: they already go through the services, and they shape a demo state the runner does not aim for (months locked except the last finished one, repair orders left at every stage, cycle counts, transfers, rejected supplier invoices, a few invoices left overdue). Rewriting them would change every seeded figure and the e2e flows built on them.
- The runner continues from any seeded state, so `npm run db:reset` then `npm run simulate -- --days 30` gives a database a month further on. Workshop job templates are copied from the seed into `simulation/domain/templates.ts`; keep the two in step.

## D-075 — Run reports as events; the simulation screen
- A run ends with an audit row and a `SimulationRun` domain event carrying its report: period, counts per step, refused steps (first 50), invariants (journal debit = credit, stock accounts = sub-ledgers, D-005/D-049) and any error. No new table: `/admin/simulation` lists the latest events.
- The screen runs 1–30 days for all sites or one, with every rate editable. The server action uses `longCommand` (session) because the runner opens its own transactions; a 30-day run on the seeded database takes about a minute.
- CLI: `npm run simulate -- --days 30 --site nantes --leads-per-day 1.5` (one flag per rate, kebab-case), on the database of `.env`; exit code 1 if the run stopped or the books do not hold.
- Tests: `tests/integration/simulation.test.ts` runs 30 days on a small org and checks the invariants, that every desk acted and that no step was refused. e2e Flow 7 (`tests/e2e/zz-simulation.spec.ts`) runs one day from the screen; the file name makes it run last because it moves the e2e clock.

