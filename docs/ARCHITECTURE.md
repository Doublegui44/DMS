# DMS Simulator — Architecture

> Status: **Phase 0 draft, awaiting approval.**
> Companion docs: [ROADMAP.md](ROADMAP.md) · [DECISIONS.md](DECISIONS.md) · [../CLAUDE.md](../CLAUDE.md)

## 1. Purpose and guiding principles

A web DMS simulator for a French multi-site, multi-brand dealer group: VN/VO sales, workshop, parts, accounting, admin. Used for demos, training and workflow testing.

1. **Every operational action has its downstream effects.** A sale changes stock, issues an invoice, posts journal entries and moves KPIs, all in **one database transaction**.
2. **One service layer, many callers.** The UI (server actions), API routes, the seed script, the scenario runner (CLI and admin page) and the tests all call the same services. Nothing writes business tables directly.
3. **Pure domain functions for every calculation** (pricing, VAT, margin, PMP, labour time, journal entry building). They take plain values and return plain values, so they can be unit-tested without a database.
4. **Nothing country-specific is hard-coded.** VAT rates, chart of accounts, posting account mapping, document number formats and legal mentions come from settings tables.
5. **Time comes from the business clock**, never from `new Date()` inside business code. This makes the simulator's day-by-day advance possible.

## 2. Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node 24, npm |
| App | Next.js 15 (App Router, React 19, Server Components + Server Actions), TypeScript `strict` |
| UI | Tailwind CSS v4, shadcn/ui (Radix), lucide icons, TanStack Table v8, Recharts |
| Forms | react-hook-form + `@hookform/resolvers/zod` |
| Validation | Zod v3, schemas shared by forms, server actions and services |
| DB | PostgreSQL 17 (local Homebrew instance) via Prisma 6 |
| Auth | Auth.js v5 (credentials provider, JWT sessions, bcrypt hashes) |
| i18n | next-intl (messages in `messages/en.json`; `fr`, `es` added later) |
| PDF | `@react-pdf/renderer`, rendered in route handlers |
| Seed / simulation data | `@faker-js/faker` with `fr` locale, deterministic seed |
| Money | integer cents + a small `money` lib (no floats); `decimal.js` only for PMP unit cost |
| Tests | Vitest (unit + service integration against `dms_test` DB), Playwright (e2e) |
| Scripts | `tsx` for CLI scripts (seed, reset, simulate) |

## 3. High-level architecture

```mermaid
flowchart LR
  subgraph Callers
    UI[Next.js pages<br/>Server Components]
    SA[Server Actions]
    API[Route handlers<br/>PDF / CSV / FEC]
    CLI[CLI: seed, reset, simulate]
    SIM[Admin scenario page]
  end
  subgraph Service layer
    CTX[ServiceContext<br/>user · site · perms · businessDate · tx]
    CORE[core] --- SALES[sales]
    SALES --- WS[workshop]
    WS --- PARTS[parts]
    PARTS --- ACC[accounting]
    ADMIN[admin]
    REP[reporting]
    BUS((In-process<br/>event bus))
  end
  DB[(PostgreSQL)]
  UI --> REP
  SA --> CTX
  API --> CTX
  CLI --> CTX
  SIM --> CTX
  CTX --> CORE & SALES & WS & PARTS & ADMIN
  SALES & WS & PARTS -- emit --> BUS
  BUS -- handlers --> ACC & PARTS & CORE
  CORE & SALES & WS & PARTS & ACC & ADMIN & REP --> DB
```

### 3.1 Request lifecycle for a mutation

1. A server action receives form data and parses it with the Zod schema.
2. `runCommand(session, 'sales.order', 'validate', fn)` builds a `ServiceContext`:
   - loads the user, their roles and site scopes, and checks the permission (throws `ForbiddenError`);
   - reads the current **business date** from `BusinessClock`;
   - opens a Prisma interactive transaction (`ctx.tx`).
3. The service runs. It loads aggregates, calls pure domain functions, writes rows, and calls `ctx.emit(event)`.
4. Event handlers run **synchronously inside the same transaction** (for example `SalesInvoiceIssued` → accounting posts the entry). If any handler throws (unbalanced entry, locked period, insufficient stock), the whole command rolls back.
5. `ctx.audit(...)` rows and the `DomainEvent` rows are written in the same transaction.
6. The action returns a typed result (`{ ok: true, data } | { ok: false, error }`) and calls `revalidatePath`.

Reads (lists, dashboards) go through module **query** functions (`modules/*/queries`) that also enforce site scope.

### 3.2 Why a synchronous in-transaction bus

Modules stay decoupled (sales does not import accounting), but there is no eventual consistency to explain during a demo: the moment an invoice exists, its journal entry exists. Events are also stored in `DomainEvent` and power the customer/vehicle timelines. See D-004.

## 4. Folder structure

```
.
├── CLAUDE.md
├── docs/                       ARCHITECTURE, ROADMAP, DECISIONS
├── messages/                   en.json (fr.json, es.json later)
├── prisma/
│   ├── schema.prisma           single schema, sections per module
│   ├── migrations/
│   └── seed/                   seed entrypoint + per-module seeders (call services)
├── scripts/                    simulate.ts, reset.ts, fec-export.ts
├── src/
│   ├── app/
│   │   ├── (auth)/login/
│   │   ├── (app)/              authenticated shell: sidebar, site switcher, business date, role switcher
│   │   │   ├── dashboard/
│   │   │   ├── customers/  vehicles/
│   │   │   ├── sales/      (leads, quotes, orders, deliveries, vo-stock, appraisals, catalogue)
│   │   │   ├── workshop/   (planner, repair-orders, clocking, warranty, labour-catalogue)
│   │   │   ├── parts/      (catalogue, stock, purchasing, counter, inventory)
│   │   │   ├── accounting/ (entries, journals, ledgers, receivables, payables, vat, periods, reports)
│   │   │   ├── reports/
│   │   │   └── admin/      (users, roles, permissions, settings, numbering, audit, simulation)
│   │   └── api/            pdf/[doc]/[id], export/csv, export/fec
│   ├── components/
│   │   ├── ui/             shadcn primitives
│   │   └── shared/         DataTable, StatusBadge, Timeline, MoneyCell, PageHeader, KpiCard
│   ├── lib/
│   │   ├── db.ts           Prisma client singleton
│   │   ├── auth.ts         Auth.js config
│   │   ├── money.ts        cents arithmetic, allocation, centralised rounding
│   │   ├── context.ts      ServiceContext, runCommand, runQuery
│   │   ├── events.ts       typed event bus + registry
│   │   ├── errors.ts       DomainError, ForbiddenError, ValidationError, PeriodLockedError…
│   │   ├── rbac.ts         permission keys + can()
│   │   └── csv.ts, pagination.ts, i18n.ts
│   └── modules/
│       ├── core/           org, customers, vehicles, numbering, audit, clock, settings
│       ├── accounting/
│       ├── sales/          vn, vo, deals, financing, commissions
│       ├── parts/
│       ├── workshop/
│       ├── admin/          users, roles, approvals
│       ├── reporting/      KPI + report queries (read-only)
│       └── simulation/     scenario runner, generators, rates config
└── tests/
    ├── unit/               mirrors modules/*/domain
    ├── integration/        service tests against dms_test
    └── e2e/                Playwright, one spec per critical flow
```

Every module has the same internal layout:

```
modules/<name>/
  domain/      pure functions and types (no Prisma, no I/O) → unit tested
  services/    use cases: take ctx + validated input, use ctx.tx, emit events
  queries/     read models for pages and reports
  schemas/     Zod schemas (shared with forms)
  handlers/    subscribers to other modules' events
  events.ts    events this module publishes (typed)
  ui/          module-specific React components
  index.ts     public API: the only file other modules may import
```

**Module boundary rule:** a module may import another module's `index.ts` (services, queries, types) but never its internals. Accounting never imports sales; it subscribes to events. An ESLint `no-restricted-imports` rule enforces this.

## 5. Cross-cutting design

### 5.1 Money, quantities, time
- All amounts are `Int` **cents**, named `*Cents` (`unitPriceCents`, `totalExclVatCents`).
- `lib/money.ts` is the only place that rounds: half-up (`ROUND_HALF_UP`) to the cent, with largest-remainder allocation when a total is split across lines (so VAT per line adds up to VAT on the document).
- VAT is calculated **per line on the excl.-VAT amount**, then summed per rate (configurable later).
- PMP (weighted average cost) is stored as `Decimal(18,4)` cents per unit to avoid drift; every *posted* value is rounded to cents.
- Parts quantities: `Decimal(12,3)` (litres of oil, metres of hose).
- Labour time: `Int` **centi-hours** (`150` = 1.50 h), for both standard time and clocked time.
- Dates: business documents carry a `businessDate` (`Date`, no time) from the business clock, plus `createdAt` (real timestamp) for auditing.

### 5.2 Document numbering (gap-free)
`DocumentSequence(siteId, docType, fiscalYear, prefix, nextValue, padding)`. A number is taken with `UPDATE … SET next_value = next_value + 1 … RETURNING` inside the business transaction, so the row is locked until commit and rolled back with it. Numbers are assigned **only at issue** (a draft invoice has no number). Format from settings, e.g. `NTE-FA-2026-000123`. Invoices are never deleted; corrections go through a credit note.

### 5.3 Audit trail
`AuditLog(at, userId, siteId, action, entityType, entityId, before JSON, after JSON, businessDate)` written by `ctx.audit()` in every service. The activity log viewer reads it; entity pages show it as a timeline next to the `DomainEvent` stream.

### 5.4 RBAC
- Permission key = `module.resource` × action (`view | create | edit | validate | delete`), e.g. `sales.order:validate`.
- `Role` ↔ `Permission` many-to-many. `UserRole(userId, roleId, siteId | null)`: `null` means all sites.
- `can(ctx, key, action, siteId?)` used in `runCommand` and in queries; the sidebar is built from the same check.
- **Approval thresholds**: `ApprovalRule(key, thresholdPct|thresholdCents, approverRoleId)`. A service that breaches a rule creates an `ApprovalRequest` and leaves the document in `pending_approval`.

### 5.5 Business clock and simulation
- `BusinessClock` (single row): `currentDate`. `ctx.businessDate` is read once per command.
- `clock.advanceDay()` runs end-of-day jobs through services: expire reservations, refresh stock ageing alerts, flag overdue receivables, auto-suggest parts POs.
- The scenario runner (`modules/simulation`) loops day by day, draws activity from configurable rates (Poisson-like with a seeded RNG), calls services as a system user per site, and advances the clock. It logs a run report (events, errors, trial balance check).

### 5.6 Validation and errors
Zod at the edge (action) **and** inside the service (defence in depth for CLI callers). Business rule violations raise typed `DomainError(code, params)` mapped to translated messages in the UI.

### 5.7 Lists
A shared `DataTable` (TanStack) driven by URL search params (`?q=&status=&sort=&page=`), server-side filtering/pagination via a generic `paginate()` helper, and a CSV export route reusing the same query.

## 6. Domain model

The schema is a single Prisma file; diagrams are split by module for readability. Common columns (`id` cuid, `createdAt`, `updatedAt`, `createdById`) are omitted. `siteId` is on every operational table.

### 6.1 Context map

```mermaid
flowchart TB
  CORE["Core<br/>Group · Site · Brand · Department<br/>Customer · Vehicle · Numbering · Audit · Clock · Settings"]
  ADMIN["Admin<br/>User · Role · Permission · ApprovalRule"]
  SALES["Sales VN/VO<br/>Catalogue · Lead · Quote · Order · TradeIn · Delivery"]
  WS["Workshop<br/>Appointment · RepairOrder · Job · Clocking · WarrantyClaim"]
  PARTS["Parts<br/>Part · StockItem · Movement · PO · Receipt · CounterSale"]
  ACC["Accounting<br/>Account · Journal · Entry · Invoice · Payment · Period · VAT"]
  SALES -->|Vehicle status, TradeIn → VO| CORE
  WS -->|issue parts| PARTS
  WS -->|internal RO cost| SALES
  SALES -->|InvoiceIssued, VehiclePurchased, PaymentReceived| ACC
  WS -->|InvoiceIssued, WarrantyClaimSubmitted| ACC
  PARTS -->|StockMoved, SupplierInvoiceMatched| ACC
  ADMIN -.->|permissions| CORE
```

### 6.2 Core and admin

```mermaid
erDiagram
  Group ||--o{ Site : has
  Group ||--o{ Brand : sells
  Site ||--o{ SiteBrand : carries
  Brand ||--o{ SiteBrand : "is carried by"
  Site ||--o{ Department : has
  Country ||--o{ Site : "located in"
  Country ||--o{ VatRate : defines

  User ||--o{ UserRole : has
  Role ||--o{ UserRole : "granted via"
  Site |o--o{ UserRole : "scoped to (null = all)"
  Role ||--o{ RolePermission : has
  Permission ||--o{ RolePermission : in
  Role ||--o{ ApprovalRule : approves
  ApprovalRule ||--o{ ApprovalRequest : triggers
  User ||--o{ ApprovalRequest : decides

  Customer ||--o{ Contact : has
  Customer ||--o{ Vehicle : "owns (current)"
  Vehicle ||--o{ VehicleStatusHistory : logs
  Vehicle ||--o{ VehicleOption : has
  Brand ||--o{ Vehicle : make
  Site ||--o{ Vehicle : "stocked at"

  Site ||--o{ DocumentSequence : numbers
  User ||--o{ AuditLog : performs
  Site ||--o{ DomainEvent : records

  Group {
    string id PK
    string name
  }
  Site {
    string id PK
    string groupId FK
    string code "NTE, REN, ANG"
    string name
    string countryCode FK
    int labourRateCents
  }
  Brand {
    string id PK
    string name
    string oemSupplierId FK
    string oemCustomerId FK
  }
  SiteBrand {
    string siteId FK
    string brandId FK
  }
  Department {
    string id PK
    string siteId FK
    enum code "VN VO WORKSHOP PARTS ACCOUNTING OVERHEAD"
  }
  Country {
    string code PK
    string currency
    string defaultLocale
  }
  VatRate {
    string id PK
    string countryCode FK
    string code "STANDARD REDUCED…"
    int rateBasisPoints
    date validFrom
    date validTo
  }
  User {
    string id PK
    string email UK
    string passwordHash
    string name
    bool isTechnician
    bool active
  }
  Role {
    string id PK
    string key UK
    string name
  }
  Permission {
    string id PK
    string key "sales.order"
    enum action "view create edit validate delete"
  }
  RolePermission {
    string roleId FK
    string permissionId FK
  }
  UserRole {
    string userId FK
    string roleId FK
    string siteId FK "nullable"
  }
  ApprovalRule {
    string id PK
    string key "deal.discount"
    int thresholdBasisPoints
    string approverRoleId FK
  }
  ApprovalRequest {
    string id PK
    string ruleId FK
    string entityType
    string entityId
    enum status
    string decidedById FK
  }
  Customer {
    string id PK
    enum kind "INDIVIDUAL COMPANY OEM"
    string name
    string siren
    string vatNumber
    enum priceClass "RETAIL TRADE INTERNAL WARRANTY"
    bool consentEmail
    bool consentSms
    string accountCode "411xxx"
  }
  Contact {
    string id PK
    string customerId FK
    string name
    string email
    string phone
  }
  Vehicle {
    string id PK
    string vin UK
    string registration
    string brandId FK
    string model
    string version
    date firstRegistration
    int mileage
    enum fuel
    int co2
    string colour
    enum stockType "VN VO NONE"
    enum status
    string siteId FK
    string ownerCustomerId FK
    int stockValueCents
    date stockInDate
    enum vatRegime "STANDARD MARGIN"
  }
  VehicleStatusHistory {
    string id PK
    string vehicleId FK
    enum from
    enum to
    date businessDate
  }
  VehicleOption {
    string id PK
    string vehicleId FK
    string code
    string label
    int priceCents
  }
  DocumentSequence {
    string siteId FK
    enum docType
    int fiscalYear
    string prefix
    int nextValue
  }
  AuditLog {
    string id PK
    datetime at
    string userId FK
    string action
    string entityType
    string entityId
    json before
    json after
  }
  DomainEvent {
    string id PK
    string type
    string siteId FK
    json payload
    date businessDate
    string aggregateType
    string aggregateId
  }
  BusinessClock {
    int id PK
    date currentDate
  }
  Setting {
    string key PK
    json value
    string siteId FK "nullable"
  }
```

Vehicle status lifecycle:

```mermaid
stateDiagram-v2
  [*] --> ordered: VN factory order
  ordered --> in_transit
  in_transit --> in_stock
  [*] --> intake: VO trade-in / purchase
  intake --> reconditioning
  reconditioning --> for_sale
  intake --> for_sale
  in_stock --> reserved
  for_sale --> reserved
  reserved --> in_stock: expiry / cancel (VN)
  reserved --> for_sale: expiry / cancel (VO)
  reserved --> sold: order validated
  sold --> delivered
  sold --> reserved: order cancelled → released
  delivered --> [*]
```

### 6.3 Sales VN / VO

```mermaid
erDiagram
  Brand ||--o{ CatalogueModel : offers
  CatalogueModel ||--o{ CatalogueVersion : has
  CatalogueVersion ||--o{ CatalogueOption : allows
  Customer ||--o{ Lead : raises
  User ||--o{ Lead : "assigned salesperson"
  Lead ||--o{ Quote : produces
  Quote ||--o{ DealLine : contains
  Quote |o--o| TradeInAppraisal : includes
  Quote |o--o| FinancingPlan : includes
  Quote ||--o| SalesOrder : "accepted into"
  SalesOrder ||--o{ DealLine : contains
  SalesOrder |o--o| FactoryOrder : "VN not in stock"
  SalesOrder ||--o| Reservation : holds
  Vehicle ||--o{ Reservation : "reserved by"
  SalesOrder ||--o| Delivery : "delivered by"
  SalesOrder ||--o{ Invoice : "invoiced by"
  SalesOrder ||--o| Commission : earns
  TradeInAppraisal |o--o| Vehicle : "creates VO (intake)"
  Vehicle ||--o{ VoPurchase : "acquired by"
  VoPurchase ||--o| PoliceRegisterEntry : "logged in"
  Vehicle ||--o{ VoPriceChange : repriced
  Vehicle ||--o{ VehicleCostLine : "stock value build-up"
  AddOnProduct ||--o{ DealLine : "sold as"

  CatalogueModel {
    string id PK
    string brandId FK
    string name
  }
  CatalogueVersion {
    string id PK
    string modelId FK
    string name
    int listPriceExclVatCents
    int dealerCostCents
    int co2
    enum fuel
  }
  CatalogueOption {
    string id PK
    string versionId FK
    string code
    string label
    int listPriceExclVatCents
    int dealerCostCents
  }
  Lead {
    string id PK
    string siteId FK
    string customerId FK
    string salespersonId FK
    enum source
    enum stage "NEW CONTACTED QUOTED WON LOST"
    enum stockType
  }
  Quote {
    string id PK
    string number
    string leadId FK
    string vehicleId FK "nullable"
    string catalogueVersionId FK "nullable"
    int version
    enum status "DRAFT SENT PENDING_APPROVAL ACCEPTED REJECTED EXPIRED"
    int discountCents
    date validUntil
  }
  DealLine {
    string id PK
    enum kind "VEHICLE OPTION ACCESSORY DISCOUNT OEM_INCENTIVE ECO_BONUS ECO_MALUS REGISTRATION_FEE ADDON TRADE_IN"
    string label
    int qty
    int unitPriceExclVatCents
    int costCents
    string vatRateCode
    bool vatApplicable
  }
  TradeInAppraisal {
    string id PK
    string vin
    int mileage
    int marketValueCents
    int estimatedRepairCents
    int offerCents
    enum sellerType "PRIVATE PROFESSIONAL"
    string resultingVehicleId FK
  }
  FinancingPlan {
    string id PK
    enum kind "LOAN LEASE"
    int principalCents
    int aprBasisPoints
    int months
    int depositCents
    int residualCents
    int monthlyPaymentCents
    int totalCostCents
    int dealerCommissionCents
  }
  AddOnProduct {
    string id PK
    enum kind "WARRANTY MAINTENANCE"
    string name
    int priceCents
    int costCents
  }
  SalesOrder {
    string id PK
    string number "Bon de commande"
    string siteId FK
    string customerId FK
    string vehicleId FK
    string salespersonId FK
    enum status "DRAFT PENDING_APPROVAL CONFIRMED READY_TO_DELIVER DELIVERED INVOICED CANCELLED"
    int totalInclVatCents
    int paidCents
    int financedCents
    int frontEndMarginCents
    int backEndMarginCents
  }
  FactoryOrder {
    string id PK
    string salesOrderId FK
    string oemRef
    date orderedOn
    date expectedEta
    enum status
  }
  Reservation {
    string id PK
    string vehicleId FK
    string salesOrderId FK
    date expiresOn
    enum status "ACTIVE CONVERTED EXPIRED RELEASED"
  }
  Delivery {
    string id PK
    string salesOrderId FK
    date deliveredOn
    int mileageAtDelivery
  }
  Commission {
    string id PK
    string salesOrderId FK
    string userId FK
    int amountCents
    enum status
  }
  VoPurchase {
    string id PK
    string vehicleId FK
    enum sellerType
    string sellerCustomerId FK
    int priceCents
    enum vatRegime
    string supplierInvoiceId FK "nullable"
  }
  PoliceRegisterEntry {
    string id PK
    string siteId FK
    int sequence
    string vehicleId FK
    date inDate
    date outDate
  }
  VoPriceChange {
    string id PK
    string vehicleId FK
    int oldPriceCents
    int newPriceCents
    date businessDate
  }
  VehicleCostLine {
    string id PK
    string vehicleId FK
    enum kind "PURCHASE RECONDITIONING TRANSPORT OTHER"
    int amountCents
    string sourceRef
  }
```

**As built (Phase 3).** The models match the diagram, with these differences:
- **Delivery:** there is no `Delivery` entity; delivery date and mileage are stored on `SalesOrder`, and the invoice is linked through `SalesOrder.invoiceId`.
- **Statuses:** a quote is `DRAFT → PENDING_APPROVAL / SENT → ACCEPTED / DECLINED / EXPIRED`; an order is `CONFIRMED → INVOICED → DELIVERED` or `CANCELLED`.
- **Reservations:** a reservation belongs to a quote and becomes `CONVERTED` when the customer signs.
- **Approvals:** discount approvals use the generic `ApprovalRule` / `ApprovalRequest` tables (D-036).
- **VO purchases:** `VoPurchase.source` is `TRADE_IN`, `PRIVATE`, `PROFESSIONAL` or `OPENING`, with the seller as a customer or a supplier.
- **Factory orders:** a factory order points to its vehicle and, for customer orders, to the order.
- **Vehicle record:** core keeps the vehicle, but only the sales flows create stock cars and change their status, prices and site (`trusted` calls). The vehicle screens register customers' cars and correct descriptive data (D-048).
- **Services:** `leads`, `quotes`, `reservations`, `orders`, `trade-in`, `vn-stock` and `vo-stock`. Pure rules live in `domain/pricing.ts` (deal lines, VAT, margins, commission), `fees.ts` (registration fee, eco bonus and malus), `financing.ts` (payments, APR) and `workflow.ts` (stage and status guards, approval level).

### 6.4 Workshop (after-sales)

```mermaid
erDiagram
  Site ||--o{ Bay : has
  User ||--o{ TechnicianCapacity : "technician hours/day"
  Customer ||--o{ Appointment : books
  Vehicle ||--o{ Appointment : for
  Appointment ||--o| RepairOrder : "opens"
  Vehicle ||--o{ RepairOrder : "service history"
  RepairOrder ||--o| CheckIn : "has"
  RepairOrder ||--o{ RoJob : contains
  RoJob ||--o{ RoLabourLine : bills
  RoJob ||--o{ RoPartLine : uses
  RoJob ||--o{ RoSubletLine : subcontracts
  LabourOperation ||--o{ RoLabourLine : "standard time from"
  Part ||--o{ RoPartLine : "is"
  RoJob ||--o{ Clocking : "clocked on"
  User ||--o{ Clocking : technician
  RoJob |o--o| WarrantyClaim : "payer OEM"
  RepairOrder ||--o{ Invoice : "invoiced per payer"
  RoJob |o--o| Vehicle : "internal → VO cost"

  Bay {
    string id PK
    string siteId FK
    string name
  }
  TechnicianCapacity {
    string userId FK
    string siteId FK
    int weekday
    int capacityCentiHours
  }
  Appointment {
    string id PK
    string siteId FK
    string customerId FK
    string vehicleId FK
    string technicianId FK
    string bayId FK
    datetime start
    int plannedCentiHours
    enum status
  }
  RepairOrder {
    string id PK
    string number
    string siteId FK
    string vehicleId FK
    string customerId FK
    string advisorId FK
    enum status "APPOINTMENT CHECKED_IN IN_PROGRESS QUALITY_CHECK READY INVOICED CLOSED"
    date promisedOn
  }
  CheckIn {
    string id PK
    string roId FK
    int mileage
    int fuelLevelPct
    json damages
    string signatureDataUrl
  }
  RoJob {
    string id PK
    string roId FK
    string description
    enum payer "CUSTOMER WARRANTY INTERNAL INSURANCE"
    enum approval "NOT_REQUIRED PENDING APPROVED DECLINED"
    bool isAdditional
    enum status
  }
  LabourOperation {
    string id PK
    string brandId FK "nullable"
    string code
    string label
    int standardCentiHours
  }
  RoLabourLine {
    string id PK
    string jobId FK
    string operationId FK
    int billedCentiHours
    int rateCents
    int discountBasisPoints
  }
  RoPartLine {
    string id PK
    string jobId FK
    string partId FK
    decimal qty
    int unitPriceCents
    int discountBasisPoints
    decimal unitCostCents "PMP at issue"
    string stockMovementId FK
  }
  RoSubletLine {
    string id PK
    string jobId FK
    string supplierId FK
    string label
    int costCents
    int priceCents
  }
  Clocking {
    string id PK
    string jobId FK
    string technicianId FK
    datetime clockOn
    datetime clockOff
    int clockedCentiHours
  }
  WarrantyClaim {
    string id PK
    string number
    string jobId FK
    string brandId FK
    enum status "DRAFT SUBMITTED ACCEPTED REJECTED PAID"
    int claimedCents
    int acceptedCents
  }
```

### 6.5 Parts

```mermaid
erDiagram
  Brand ||--o{ Part : "OEM parts"
  Part ||--o{ PartSupersession : "replaced by"
  Part ||--o{ StockItem : "stocked as"
  Site ||--o{ StockItem : holds
  StockItem ||--o{ StockMovement : ledger
  DiscountCode ||--o{ Part : classifies
  DiscountCode ||--o{ DiscountMatrix : "rate per price class"
  Supplier ||--o{ PurchaseOrder : receives
  PurchaseOrder ||--o{ PurchaseOrderLine : has
  PurchaseOrderLine ||--o{ GoodsReceiptLine : "received in"
  GoodsReceipt ||--o{ GoodsReceiptLine : has
  Supplier ||--o{ SupplierInvoice : issues
  SupplierInvoice ||--o{ SupplierInvoiceLine : has
  SupplierInvoiceLine }o--o| GoodsReceiptLine : "matched to"
  Customer ||--o{ CounterSale : buys
  CounterSale ||--o{ CounterSaleLine : has
  CycleCount ||--o{ CycleCountLine : has
  StockItem ||--o{ CycleCountLine : counted

  Part {
    string id PK
    string partNumber UK
    string description
    string brandId FK
    string discountCodeId FK
    int retailPriceExclVatCents
    int listCostCents
    string vatRateCode
  }
  PartSupersession {
    string oldPartId FK
    string newPartId FK
    date effectiveOn
  }
  DiscountCode {
    string id PK
    string code
  }
  DiscountMatrix {
    string discountCodeId FK
    enum priceClass
    int discountBasisPoints
  }
  StockItem {
    string id PK
    string partId FK
    string siteId FK
    string bin
    decimal qtyOnHand
    decimal qtyReserved
    decimal pmpCents
    decimal minQty
    decimal maxQty
    date lastMovementOn
  }
  StockMovement {
    string id PK
    string stockItemId FK
    enum kind "RECEIPT ISSUE_RO COUNTER_SALE TRANSFER_OUT TRANSFER_IN ADJUSTMENT RETURN_SUPPLIER RETURN_CUSTOMER"
    decimal qty
    decimal unitCostCents
    int valueCents
    decimal pmpAfterCents
    string sourceType
    string sourceId
    date businessDate
  }
  Supplier {
    string id PK
    string name
    bool isOem
    string accountCode "401xxx"
    string vatNumber
  }
  PurchaseOrder {
    string id PK
    string number
    string siteId FK
    string supplierId FK
    enum kind "STOCK EMERGENCY"
    enum status "DRAFT SENT PARTIAL RECEIVED CLOSED"
  }
  PurchaseOrderLine {
    string id PK
    string poId FK
    string partId FK
    decimal qtyOrdered
    decimal qtyReceived
    int unitCostCents
  }
  GoodsReceipt {
    string id PK
    string number
    string poId FK
    date businessDate
  }
  GoodsReceiptLine {
    string id PK
    string receiptId FK
    string poLineId FK
    decimal qty
    int unitCostCents
  }
  SupplierInvoice {
    string id PK
    string supplierRef
    string supplierId FK
    enum status "RECEIVED MATCHED VARIANCE POSTED PAID"
    int totalExclVatCents
    int vatCents
  }
  SupplierInvoiceLine {
    string id PK
    string invoiceId FK
    string receiptLineId FK
    decimal qty
    int unitCostCents
  }
  CounterSale {
    string id PK
    string number
    string siteId FK
    string customerId FK
    enum status "QUOTE CONFIRMED INVOICED CANCELLED"
  }
  CounterSaleLine {
    string id PK
    string saleId FK
    string partId FK
    decimal qty
    int unitPriceCents
    int discountBasisPoints
  }
  CycleCount {
    string id PK
    string siteId FK
    enum status "OPEN COUNTED POSTED"
    date businessDate
  }
  CycleCountLine {
    string id PK
    string countId FK
    string stockItemId FK
    decimal expectedQty
    decimal countedQty
  }
```

### 6.6 Accounting

```mermaid
erDiagram
  Account ||--o{ JournalLine : "posted to"
  Department ||--o{ JournalLine : "analytic"
  Journal ||--o{ JournalEntry : contains
  FiscalPeriod ||--o{ JournalEntry : "falls in"
  JournalEntry ||--|{ JournalLine : "≥ 2 balanced lines"
  AccountMapping }o--|| Account : "resolves to"
  Customer ||--o{ Invoice : billed
  Invoice ||--o{ InvoiceLine : has
  Invoice ||--o| JournalEntry : "posted as"
  Invoice |o--o{ Invoice : "credit note of"
  Customer ||--o{ Payment : pays
  Supplier ||--o{ Payment : "paid to"
  Payment ||--o{ PaymentAllocation : allocates
  Invoice ||--o{ PaymentAllocation : settled
  SupplierInvoice ||--o{ PaymentAllocation : settled
  Payment ||--o| JournalEntry : "posted as"

  Account {
    string code PK "PCG e.g. 7071"
    string label
    enum class "1..7"
    enum type "ASSET LIABILITY EQUITY INCOME EXPENSE"
    bool postable
    bool requiresAnalytic
    bool isReceivable
    bool isPayable
  }
  Journal {
    string code PK "VE AC BQ CA OD"
    string label
    enum kind "SALES PURCHASES BANK CASH MISC"
  }
  FiscalPeriod {
    string id PK
    int year
    int month
    date start
    date end
    enum status "OPEN LOCKED"
  }
  JournalEntry {
    string id PK
    string number "per journal, gap-free"
    string journalCode FK
    string periodId FK
    string siteId FK
    date entryDate
    string label
    string sourceType
    string sourceId
    string reversalOfId FK
  }
  JournalLine {
    string id PK
    string entryId FK
    string accountCode FK
    string departmentCode "VN VO WORKSHOP PARTS OVERHEAD"
    string partyType "CUSTOMER SUPPLIER"
    string partyId
    int debitCents
    int creditCents
    string label
    string letteringCode
  }
  AccountMapping {
    string key "REVENUE_VN, VAT_COLLECTED_STANDARD…"
    string siteId FK "nullable"
    string brandId FK "nullable"
    string accountCode FK
  }
  Invoice {
    string id PK
    string number "gap-free per site"
    enum kind "INVOICE CREDIT_NOTE"
    enum sourceType "SALES_ORDER REPAIR_ORDER COUNTER_SALE WARRANTY_CLAIM"
    string sourceId
    string siteId FK
    string customerId FK
    enum vatRegime "STANDARD MARGIN EXEMPT"
    date issueDate
    date dueDate
    int totalExclVatCents
    int vatCents
    int totalInclVatCents
    int paidCents
    enum status "DRAFT ISSUED PARTIALLY_PAID PAID"
  }
  InvoiceLine {
    string id PK
    string invoiceId FK
    string label
    decimal qty
    int unitPriceExclVatCents
    int lineExclVatCents
    string vatRateCode
    int vatCents
    string departmentCode
    string revenueMappingKey
  }
  Payment {
    string id PK
    string siteId FK
    enum direction "IN OUT"
    enum method "TRANSFER CARD CHEQUE CASH FINANCE_COMPANY"
    int amountCents
    date businessDate
    string journalCode FK
  }
  PaymentAllocation {
    string paymentId FK
    string invoiceId FK "nullable"
    string supplierInvoiceId FK "nullable"
    int amountCents
  }
```

## 7. Accounting engine

### 7.1 Posting service
Builders in `modules/accounting/domain/entry.ts` turn documents into an `EntryDraft` whose lines reference either a mapping key (`{ key: "REVENUE_LABOUR" }`) or an account code. `postEntry(ctx, draft, { brandId? })` then:
1. Resolves each key through `AccountMapping` (most specific wins: site + brand → site → brand → global); a missing key raises `mapping_missing`.
2. Validates with `validateEntry` and reports every problem at once: fewer than 2 lines, a line both debit and credit or negative, unknown / non-postable account, class 6/7 without a department, receivable/payable account without the right party, Σ debit ≠ Σ credit.
3. Finds or creates the `FiscalPeriod` for the entry date; rejects if `LOCKED`.
4. Takes the next gap-free number of the journal series (`OD-2026-000042`) and writes the entry and its lines in the command's transaction.

Postgres repeats the essential checks (D-020): a deferred trigger rejects unbalanced entries at commit, row triggers reject inserts into locked periods and any update except lettering.

Entries are immutable. Manual and opening entries are corrected by `reverseEntry` (mirrored entry, `reversalOfId`); invoices by credit notes.

### 7.2 Posting rules (default PCG mapping, all configurable)

Inventory is **perpetual** (see D-005): purchases go to class 60x, stock entries/exits go through 603x ↔ 37x so that stock accounts always equal the stock sub-ledger.

| Event | Journal | Debit | Credit |
|---|---|---|---|
| VN arrival: OEM invoice | AC | 607100 VN purchases (VN) + 445660 VAT deductible | 401100 OEM |
| VN arrival: stock entry | OD | 371000 VN stock | 603710 VN stock variation (VN) |
| VN / VO sales invoice | VE | 411000 customer | 707100 VN / 707200 VO (net of discount), 706500 add-ons, 445710 VAT or 445715 VAT on margin; pass-through lines with no VAT: 467100 registration certificate, 447100 eco malus; eco bonus advanced: Dr 443100 |
| Cost of sale (at invoice) | OD | 603710 / 603720 | 371000 / 372000 |
| Trade-in taken at signature | AC + OD | 607200 VO purchases (VO); then 372000 | 467400 private seller (party = customer); then 603720 |
| Trade-in settles the invoice | OD | 467400 | 411000 |
| Finance company takes over the financed amount | OD | 467300 finance company | 411000 |
| Dealer finance commission | OD | 467300 | 706600 finance commission (back-end) |
| OEM incentive claim | VE | 411100 OEM | 707100 + 445710 |
| Add-on and accessory costs (accrual) | AC | 604100 / 607400 | 408100 |
| VO purchase from a private seller | AC + BQ | 607200 (VO), then 467400 | 467400 (party = customer), then 512100 |
| VO purchase from a trader | AC | 607200 (VO) + 445660 if the trader charges VAT | 401000 supplier |
| VO stock entry / capitalised cost | OD | 372000 VO stock | 603720 (VO); the cost itself: Dr 604000 + 445660 / Cr 401000 |
| Deposit on an order | BQ/CA | 512100 / 530000 | 411000 (on account, allocated to the invoice when it is issued) |
| RO customer invoice | VE | 411 | 7061 labour (WORKSHOP), 7073 parts (PARTS), 7062 sublet (WORKSHOP), 44571 |
| RO warranty | VE | 4111 OEM warranty receivable | 7063 warranty labour (WORKSHOP), 7074 warranty parts (PARTS) |
| RO internal (VO reconditioning) | OD | 3712 VO stock | 7064 internal labour (WORKSHOP), 7075 internal parts (PARTS) |
| Parts issue to RO / counter | OD | 60373 (PARTS) | 3713 parts stock |
| Parts receipt (goods received not invoiced) | OD | 3713 | 60373 (PARTS); purchase side via 408 until invoice |
| Supplier invoice matched | AC | 6073 (PARTS) + 44566 | 401 (clears 408 accrual) |
| Inventory variance | OD | 60373 (PARTS) | 3713 (or reverse) |
| Customer payment | BQ/CA | 512 bank / 530 cash / 4671 finance company | 411 |
| Supplier payment | BQ | 401 | 512 |

Exact accounts are seed data in `AccountMapping`; the table above is the default for France.

### 7.3 VAT
- `VatRate` per country with validity dates; lines carry a `vatRateCode`.
- **Margin regime** (biens d'occasion, art. 297 A CGI): VAT base = (sale price incl. VAT − purchase price) × rate / (1 + rate), floored at zero; no VAT shown on the invoice; legal mention from settings. Reconditioning costs are **not** deducted from the margin base (their own input VAT is deductible). Unit-tested.
- VAT report per period: collected by rate, deductible on goods / services, margin-regime base, net due.

### 7.4 Period close
Monthly `FiscalPeriod`s. Checklist (`closeChecklist`): period open, earlier periods with entries locked, business date past month end, period trial balance balanced (blocking); draft invoices (warning). Lock → locked periods reject postings at service and database level. Only `Admin` (`accounting.period:delete`) can reopen, latest locked period first, with an audited reason.

### 7.5 Reports and exports
Trial balance, general ledger, customer/supplier ledgers with ageing (0–30/31–60/61–90/>90), P&L by department, gross margin by department, stock value (VN/VO/Parts, reconciled to 37x), VAT report, FEC export (the 18 standard columns, `|` separated).

## 8. Key domain rules (enforced in services)

- A vehicle has at most one `ACTIVE` reservation and can be on at most one non-cancelled sales order (DB partial unique index + service check).
- Reservations expire after N days (setting) at end-of-day; expiry releases the vehicle.
- Delivery requires `paidCents + financedCents ≥ totalInclVatCents`.
- Cancelling an order releases the vehicle and its reservation; if already invoiced, cancellation needs a credit note.
- Discounts above an `ApprovalRule` threshold put the quote in `PENDING_APPROVAL`.
- VO stock value = purchase price + Σ `VehicleCostLine` (reconditioning, transport).
- Stock ageing alerts at 60/90/120 days (configurable) from `stockInDate`.
- Parts issue cannot drive `qtyOnHand` below zero unless the site setting allows negative stock (default off).
- PMP on receipt: `newPmp = (qtyOnHand × pmp + qtyIn × unitCost) / (qtyOnHand + qtyIn)`; issues are valued at the current PMP.
- An RO cannot be invoiced while a job is `PENDING` approval or a technician is still clocked on.
- An RO with several payers produces one invoice per payer (customer, OEM, insurer); internal jobs produce a cost transfer, not an invoice.
- Nothing posts into a locked period.

## 9. Domain events (initial catalogue)

| Module | Event | Main subscribers |
|---|---|---|
| sales | `QuoteAccepted`, `SalesOrderConfirmed`, `SalesOrderCancelled`, `VehicleDelivered`, `TradeInReceived`, `VoPurchased`, `VehicleCostAdded` | core (vehicle status), accounting |
| core | `VehicleStatusChanged`, `InvoiceIssued`, `PaymentReceived`, `PaymentMade` | accounting, reporting timeline |
| workshop | `PartsRequestedForJob`, `RoInvoiced`, `InternalRoClosed`, `WarrantyClaimSubmitted` | parts, sales (VO cost), accounting |
| parts | `StockMoved`, `StockBelowMinimum`, `GoodsReceived`, `SupplierInvoiceMatched`, `InventoryAdjusted` | accounting, purchasing suggestions |
| accounting | `PeriodLocked` | — |
| clock | `BusinessDayAdvanced` | sales (reservation expiry, ageing), accounting (overdue), parts (reorder suggestions) |

`Invoice` lives in the accounting module (it owns receivables) and is created through `createAndIssueInvoice()` called by sales/workshop/parts services. Issuing posts the sales entry directly in the same transaction (D-023) and then emits `InvoiceIssued` for other modules. Accounting also emits `JournalEntryPosted`, `PaymentRecorded`, `PeriodLocked` and `PeriodReopened`.

## 10. UI shell and navigation

- Left sidebar grouped by module, filtered with `can(view)`. Top bar: site switcher (sites the user is scoped to), **business date** chip, demo **role switcher**, user menu, language switcher (later).
- Dense tables, sticky headers, status badges (one colour scale per lifecycle), entity pages with a header card, tabs, and a right-hand timeline (events + audit).
- Sales pipeline: kanban (dnd-kit) and list views over the same query.
- Workshop planner: day/week grid, rows = technicians or bays, load bar vs. capacity.
- Role dashboards: Dealer Principal (group KPIs), Sales Manager, Salesperson, Service Manager, Service Advisor, Technician (my jobs + clocking), Parts Manager, Accountant.

## 11. Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | every `domain/` function: money/rounding, VAT (standard + margin), deal pricing, front/back-end margin, commission, APR/monthly payment, PMP, labour billing & efficiency, journal entry builders (balance), numbering format, ageing buckets |
| Integration | Vitest + `dms_test` Postgres | services with a real transaction: posting rejects unbalanced / locked period, double-sale prevention, reservation expiry, gap-free numbering under rollback |
| E2E | Playwright | flows 1–6 from the brief, against a freshly reset DB |
| Invariant | Vitest | after seed and after `simulate --days 30`: trial balance balances, stock accounts = stock sub-ledgers, receivables = open invoices |

## 12. Seed and simulation

- `npm run db:reset` → drop, migrate, seed. Deterministic (`faker.seed(42)`).
- Seed creates: 1 group, 3 sites (Nantes, Rennes, Angers), 2 brands, ~25 users covering every role (password `demo1234`, documented in CLAUDE.md), ~300 customers, ~150 VN/VO stock vehicles, ~2,000 part references with stock per site, labour catalogue, chart of accounts and mappings, VAT rates, numbering, approval rules.
- **History** (~6 months) is generated by the scenario runner itself: the seed sets the business clock 180 days back and calls `simulate` so every past document went through the real services and posted real entries. The clock then lands on the current date.
- `npm run simulate -- --days 30 --site nantes [--rates ./rates.json]`.
