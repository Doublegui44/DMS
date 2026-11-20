# DMS Simulator — Roadmap

Each phase ends with: migrations applied, seed updated, tests green, app running, a summary, `CLAUDE.md` updated, and **one conventional commit**.

## Phase 0 — Plan ✅
- [x] `docs/ARCHITECTURE.md` (stack, structure, module boundaries, ERDs, posting rules)
- [x] `docs/ROADMAP.md`
- [x] `docs/DECISIONS.md`
- [x] `CLAUDE.md`
- [x] Plan approved, business assumptions confirmed

## Phase 1 — Setup, auth, RBAC, shared core ✅
- [x] `git init`, Next.js 15 + TS strict, Tailwind v4, shadcn/ui, ESLint (module boundary rule), Prettier
- [x] Prisma + PostgreSQL (`dms_dev`, `dms_test`), first migration
- [x] `lib/`: money, errors, context (`runCommand` / `runQuery`), event bus, rbac, pagination, csv
- [x] Business clock, document numbering service, audit log, domain event store
- [x] Org: group, sites, brands, departments, countries, VAT rates, settings
- [x] Auth.js credentials login, session with user + roles + site scopes
- [x] Roles, permissions, user-role-site assignments; seeded permission matrix for the 10 roles
- [x] App shell: sidebar filtered by permission, site switcher, business-date chip, user menu
- [x] Shared `DataTable` (search, filters, sort, pagination, CSV export), `StatusBadge`, `Timeline`
- [x] Customers (individual / company / OEM): list, detail, create/edit, contacts, consents, timeline
- [x] Vehicles: master record per VIN, list, detail, status lifecycle with history
- [x] Seed v1: group, 3 sites, 2 brands, ~25 users, ~300 customers, ~150 vehicles
- [x] Tests: money, numbering format, rbac `can()`, vehicle status transitions; e2e login per role
- **Done when:** you can log in with each role and menus are filtered by permission → verified by `tests/e2e/auth-rbac.spec.ts` (18 tests)
- Deferred: Admin settings are read-only (editing arrives with the modules that use each setting); user create/edit UI (service exists, used by seed).

## Phase 2 — Accounting engine ✅
- [x] Chart of accounts (PCG seed, configurable), journals, fiscal periods, account mapping (site + brand → site → brand → global)
- [x] Posting service: balance check, analytic check, party check, period check (+ DB triggers), gap-free entry numbers, reversal
- [x] Invoice + credit note issuing service (generic, numbering at issue, standard and margin VAT)
- [x] Payments and allocation, automatic and manual lettering, customer/supplier ledgers
- [x] Period lock/reopen with checklist
- [x] Screens: invoices (list, detail, new, credit note), payments (list, detail, record + allocate), journal entries (list, detail, manual OD with live balance, reversal), ledgers + statements with lettering, trial balance, chart of accounts (list, detail, create/edit), periods; account summary on the customer page; CSV exports
- [x] Seed: chart, journals, mappings, periods, suppliers, opening balances, six months of workshop/warranty invoices, receipts and overheads; earlier months locked
- [x] Tests: every entry builder balances (incl. 200 random invoices); unbalanced rejected; locked period rejected (service + DB); e2e invoice → payment → paid, manual OD balance, period lock
- **Done when:** unit tests prove every entry balances and locked periods reject postings → `tests/unit/accounting-domain.test.ts`, `tests/integration/accounting.test.ts`, `tests/e2e/accounting.spec.ts`
- Deferred: account-mapping editor UI (service `setAccountMapping` exists), supplier invoices (arrive with purchasing in Phases 3–4), FEC/VAT reports (Phase 6), payment cancellation.

## Phase 3 — VN / VO sales ✅
- [x] OEM catalogue (models, versions, options, fictional list prices, dealer cost, OEM incentive, lead time), configurator in the quote builder
- [x] Lead → Quote → Order → Invoice → Delivery; pipeline board (derived stages, D-043) + list, orders list, CSV exports
- [x] Deal structure: options, accessories, add-on products, discount, OEM incentive, eco bonus (advanced by the dealer) / malus, registration certificate (pass-through, no VAT)
- [x] Financing (loan / lease with residual): monthly payment, cost of credit, dealer commission booked at invoicing
- [x] Front-end / back-end margins and salesperson commission (assumption 9), shown in the builder's dealer view and on the order
- [x] Discount approval: rules as data, effective discount incl. trade-in over-allowance, no self-approval (D-036)
- [x] Reservation with expiry, double-sale prevention (partial unique indexes), cancellation releases the vehicle and hands the trade-in back, delivery requires a settled invoice
- [x] Factory orders (customer and stock) with ETA, shipping, arrival booking the OEM invoice and the stock entry
- [x] Trade-in → VO intake at signature, VO purchases (private / trader, margin or standard VAT), police register
- [x] VO stock: capitalised costs, reconditioning → for sale, ageing alerts 60/90/120, repricing with history, sale under margin VAT
- [x] Stock cars move only through the sales flows: the vehicle screens register customers' cars and correct descriptive data (D-048)
- [x] Postings: sale invoices, cost of sale through `VehicleStockMoved` (D-031/D-032), trade-in, deposits, finance company, finance commission, OEM incentive claim, add-on cost accruals
- [x] Dashboard sales KPIs; screens: pipeline, lead, quote builder (live server-side preview, D-042), quote, order, VN stock + vehicle, VO stock + vehicle + purchase, police register, catalogue
- [x] Seed: catalogue, add-ons, VO suppliers; six months of deals, stock orders, VO purchases and reconditioning run inside the accounting history (D-044); seed v1 stock replayed so the books match the stock on every date
- [x] Tests: pricing, VAT, margin VAT, margins, APR, commission, fees, workflow guards (unit); Flow 1, double sale, reservations, approvals, factory orders, VO purchases, cancellation, settings, seed replay (integration); **e2e Flow 1**
- **Done when:** Flow 1 e2e passes → `tests/e2e/sales.spec.ts` (lead → quote with trade-in → order → invoice → payment → delivery; trade-in in VO intake; VN stock down by its cost and VO stock up by the offer on the trial balance; sale, cost-of-sale, trade-in and receipt entries present)
- Deferred: supplier invoices and payments (OEM and traders stay unpaid in 401, D-039 → Phase 4), lender payout clearing 467300, order and invoice PDFs (Phase 6), VO reconditioning through workshop repair orders (Phase 5), sales and stock reports (Phase 6), editing approval rules and catalogue in the UI, transferring a stock car to another site (D-048).

## Phase 4 — Parts ✅
- [x] Catalogue (OEM per make + aftermarket), supersessions (D-052), discount codes × price class matrix
- [x] Stock per site/bin, value-based PMP, min/max, immutable movements ledger (D-049), obsolescence report (6–24 months)
- [x] Purchasing: suggested orders from min/max net of what is on order, stock vs. emergency orders, receipts with backorders, close/cancel
- [x] Goods received not invoiced and supplier invoice matching with tolerance and approval (D-050), supplier payment and lettering
- [x] Counter sales: quote → confirm (reservation) → invoice at PMP, price class discounts, paid at the counter or on account (D-053)
- [x] Inter-site transfers through 181000 (D-051), cycle counts with variance posting
- [x] Dashboard parts KPIs; screens: catalogue, part, discount matrix, stock, stock item, movements, obsolete stock, transfers, purchase orders, suggestions, supplier invoices, counter sales, cycle counts; CSV exports
- [x] Seed: ~2,000 references, opening stock in the opening entry, six months of parts activity (D-054)
- [x] Tests: PMP, pricing, replenishment, tolerance, postings (unit); receipts/PMP, matching, variance, payment, counter, transfers, counts, opening stock, 373000 = sub-ledger (integration); **e2e Flow 5**
- **Done when:** Flow 5 e2e passes → `tests/e2e/parts.spec.ts` (item raised below min → suggested order → sent → received → PMP recalculated → supplier invoice matched → paid; 373000 up by the receipt and 408100 back where it was on the trial balance; invoice entry with 408100, 445660 and 401)
- Deferred: issues to repair orders (Phase 5), supplier returns and customer returns (movement kinds exist), parts reports (Phase 6), editing the tolerance and lead times in the UI.

## Phase 5 — After-sales (workshop)
- [ ] Labour operation catalogue (standard times), labour rates per site
- [ ] Planner by technician and bay, capacity per day
- [ ] RO lifecycle with check-in (mileage, fuel, damage, signature)
- [ ] Jobs: labour, parts issue from stock, sublet, consumables; payer per job
- [ ] Additional work estimates with customer approval
- [ ] Clocking on/off; productivity and efficiency
- [ ] Invoicing per payer; warranty claims → OEM receivable; internal RO → VO stock value
- [ ] Vehicle service history
- [ ] Tests: labour billing, efficiency, payer split; **e2e flows 2, 3, 4**
- **Done when:** Flows 2, 3 and 4 e2e pass

## Phase 6 — Reports, dashboards, PDFs
- [ ] Trial balance, general ledger, P&L and gross margin by department, stock value, VAT report, ageing balance
- [ ] FEC export
- [ ] Role dashboards with KPIs (units sold, VN/VO gross margin, stock ageing, workshop productivity, parts turnover, ageing balance)
- [ ] PDFs: order form, invoice, credit note, repair order, warranty claim
- [ ] **e2e flow 6** (month-end close)
- **Done when:** Flow 6 passes and each role's dashboard shows correct seeded figures

## Phase 7 — Simulation engine
- [ ] Scenario runner (service-layer only) with configurable rates; CLI + admin page
- [ ] Simulated clock with end-of-day jobs (reservation expiry, ageing, overdue, reorder suggestions)
- [ ] Role switcher (demo mode)
- [ ] One-command reset; seed history generated via the runner (6 months)
- [ ] Invariant test: trial balance and stock/sub-ledger reconciliation after 30 days
- **Done when:** 30 simulated days run with no errors and the trial balance still balances

## Later (not scheduled)
- French and Spanish translations
- Interactive VO market price feed, OEM order portal mock
- Multi-currency
