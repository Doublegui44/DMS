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

## Phase 3 — VN / VO sales
- [ ] OEM catalogue (models, versions, options, list prices), configurator
- [ ] Lead → Quote → Order → Delivery → Invoice; kanban + list
- [ ] Deal structure: options, accessories, discount, OEM incentives, eco bonus/malus, registration fees, add-ons
- [ ] Financing/lease calculator (monthly payment, total cost), dealer commission
- [ ] Front-end / back-end margin, salesperson commission
- [ ] Approval thresholds on discounts
- [ ] Reservation with expiry, double-sale prevention, cancellation releases the vehicle, delivery payment check
- [ ] Factory order with ETA; VN stock arrival
- [ ] Trade-in appraisal → VO `intake`, VO purchase (private / professional), police register
- [ ] VO stock: cost build-up, ageing alerts 60/90/120, repricing; VO sale under margin VAT
- [ ] Posting handlers for all sales events
- [ ] Tests: pricing, VAT, margin VAT, margins, APR, commission; **e2e flow 1**
- **Done when:** Flow 1 e2e passes

## Phase 4 — Parts
- [ ] Catalogue, supersessions, discount codes × price class
- [ ] Stock per site/bin, PMP valuation, min/max, movements ledger
- [ ] Purchasing: suggested PO from min/max, stock vs. emergency orders, receipt, backorders
- [ ] Supplier invoice matching (qty/price variance)
- [ ] Counter sales: quote → sale → invoice
- [ ] Inter-site transfer, cycle counts with variance posting, obsolescence report (≥ 12 months)
- [ ] Seed: ~2,000 references with stock
- [ ] Tests: PMP, discount resolution, variance entries; **e2e flow 5**
- **Done when:** Flow 5 e2e passes

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
