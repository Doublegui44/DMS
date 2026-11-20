-- CreateEnum
CREATE TYPE "CatalogueOptionKind" AS ENUM ('PAINT', 'PACK', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "AddOnKind" AS ENUM ('WARRANTY', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WALK_IN', 'PHONE', 'WEB', 'REFERRAL', 'RETURNING', 'EVENT');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DealLineKind" AS ENUM ('VEHICLE', 'OPTION', 'ACCESSORY', 'DISCOUNT', 'OEM_INCENTIVE', 'ECO_BONUS', 'ECO_MALUS', 'REGISTRATION_FEE', 'ADDON');

-- CreateEnum
CREATE TYPE "DealVatMode" AS ENUM ('STANDARD', 'MARGIN', 'NONE');

-- CreateEnum
CREATE TYPE "FinancingKind" AS ENUM ('LOAN', 'LEASE');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('CONFIRMED', 'INVOICED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FactoryOrderStatus" AS ENUM ('ORDERED', 'IN_TRANSIT', 'ARRIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'EXPIRED', 'RELEASED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('EARNED', 'PAID');

-- CreateEnum
CREATE TYPE "VoPurchaseSource" AS ENUM ('TRADE_IN', 'PRIVATE', 'PROFESSIONAL', 'OPENING');

-- CreateEnum
CREATE TYPE "VehicleCostKind" AS ENUM ('RECONDITIONING', 'TRANSPORT', 'OTHER');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'TRADE_IN';

-- AlterTable
ALTER TABLE "brand" ADD COLUMN     "wmi" TEXT;

-- AlterTable
ALTER TABLE "invoice_line" ADD COLUMN     "vatRegime" "VatRegime" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- CreateTable
CREATE TABLE "catalogue_model" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "catalogue_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogue_version" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fuel" "FuelType" NOT NULL,
    "co2" INTEGER NOT NULL,
    "powerHp" INTEGER NOT NULL,
    "listPriceExclVatCents" INTEGER NOT NULL,
    "dealerCostCents" INTEGER NOT NULL,
    "oemIncentiveCents" INTEGER NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 45,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "catalogue_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogue_option" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "CatalogueOptionKind" NOT NULL,
    "listPriceExclVatCents" INTEGER NOT NULL,
    "dealerCostCents" INTEGER NOT NULL,

    CONSTRAINT "catalogue_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "add_on_product" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "AddOnKind" NOT NULL,
    "name" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "priceExclVatCents" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "add_on_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "salespersonId" TEXT,
    "source" "LeadSource" NOT NULL,
    "interest" "StockType" NOT NULL,
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "description" TEXT,
    "lostReason" TEXT,
    "openedOn" DATE NOT NULL,
    "closedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "salespersonId" TEXT,
    "stockType" "StockType" NOT NULL,
    "vehicleId" TEXT,
    "catalogueVersionId" TEXT,
    "colour" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "vatRegime" "VatRegime" NOT NULL DEFAULT 'STANDARD',
    "createdOn" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "listPriceInclVatCents" INTEGER NOT NULL DEFAULT 0,
    "discountInclVatCents" INTEGER NOT NULL DEFAULT 0,
    "discountBp" INTEGER NOT NULL DEFAULT 0,
    "totalExclVatCents" INTEGER NOT NULL DEFAULT 0,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "totalInclVatCents" INTEGER NOT NULL DEFAULT 0,
    "tradeInCents" INTEGER NOT NULL DEFAULT 0,
    "financedCents" INTEGER NOT NULL DEFAULT 0,
    "balanceDueCents" INTEGER NOT NULL DEFAULT 0,
    "frontEndMarginCents" INTEGER NOT NULL DEFAULT 0,
    "backEndMarginCents" INTEGER NOT NULL DEFAULT 0,
    "commissionCents" INTEGER NOT NULL DEFAULT 0,
    "sentOn" DATE,
    "decidedOn" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_line" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "kind" "DealLineKind" NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "purchasePriceCents" INTEGER,
    "vatMode" "DealVatMode" NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "lineExclVatCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "lineInclVatCents" INTEGER NOT NULL,
    "catalogueOptionId" TEXT,
    "addOnProductId" TEXT,

    CONSTRAINT "deal_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_in_appraisal" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "vin" TEXT NOT NULL,
    "registration" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "firstRegistration" DATE,
    "mileage" INTEGER NOT NULL,
    "fuel" "FuelType" NOT NULL,
    "marketValueCents" INTEGER NOT NULL,
    "estimatedRepairCents" INTEGER NOT NULL DEFAULT 0,
    "offerCents" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "trade_in_appraisal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financing_plan" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "kind" "FinancingKind" NOT NULL,
    "lender" TEXT NOT NULL,
    "depositCents" INTEGER NOT NULL,
    "principalCents" INTEGER NOT NULL,
    "aprBp" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "residualCents" INTEGER NOT NULL DEFAULT 0,
    "monthlyPaymentCents" INTEGER NOT NULL,
    "totalCostCents" INTEGER NOT NULL,
    "totalPayableCents" INTEGER NOT NULL,
    "dealerCommissionCents" INTEGER NOT NULL,

    CONSTRAINT "financing_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "salespersonId" TEXT,
    "vehicleId" TEXT NOT NULL,
    "stockType" "StockType" NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "orderDate" DATE NOT NULL,
    "expectedDeliveryDate" DATE,
    "totalInclVatCents" INTEGER NOT NULL,
    "tradeInCents" INTEGER NOT NULL DEFAULT 0,
    "financedCents" INTEGER NOT NULL DEFAULT 0,
    "frontEndMarginCents" INTEGER NOT NULL DEFAULT 0,
    "backEndMarginCents" INTEGER NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "invoicedOn" DATE,
    "deliveredOn" DATE,
    "deliveryMileage" INTEGER,
    "cancelledOn" DATE,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "catalogueVersionId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "oemReference" TEXT NOT NULL,
    "status" "FactoryOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "orderedOn" DATE NOT NULL,
    "expectedOn" DATE NOT NULL,
    "shippedOn" DATE,
    "arrivedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "quoteId" TEXT,
    "customerId" TEXT NOT NULL,
    "reservedById" TEXT,
    "previousStatus" "VehicleStatus" NOT NULL,
    "reservedOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "closedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "frontEndCents" INTEGER NOT NULL,
    "addOnCents" INTEGER NOT NULL,
    "financeCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "earnedOn" DATE NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'EARNED',

    CONSTRAINT "commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vo_purchase" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "source" "VoPurchaseSource" NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "salesOrderId" TEXT,
    "priceCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "vatRegime" "VatRegime" NOT NULL,
    "purchaseDate" DATE NOT NULL,
    "supplierReference" TEXT,
    "cancelledOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vo_purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "police_register_entry" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "voPurchaseId" TEXT NOT NULL,
    "inDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "registration" TEXT,
    "sellerName" TEXT NOT NULL,
    "sellerAddress" TEXT,
    "purchasePriceCents" INTEGER NOT NULL,
    "outDate" DATE,
    "buyerName" TEXT,
    "buyerAddress" TEXT,
    "salePriceCents" INTEGER,
    "saleReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "police_register_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_cost_line" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "kind" "VehicleCostKind" NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "supplierId" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "businessDate" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_cost_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vo_price_change" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "oldPriceCents" INTEGER,
    "newPriceCents" INTEGER NOT NULL,
    "reason" TEXT,
    "businessDate" DATE NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vo_price_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalogue_model_brandId_name_key" ON "catalogue_model"("brandId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "catalogue_version_code_key" ON "catalogue_version"("code");

-- CreateIndex
CREATE UNIQUE INDEX "catalogue_option_versionId_code_key" ON "catalogue_option"("versionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "add_on_product_code_key" ON "add_on_product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lead_number_key" ON "lead"("number");

-- CreateIndex
CREATE INDEX "lead_siteId_stage_idx" ON "lead"("siteId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "quote_number_key" ON "quote"("number");

-- CreateIndex
CREATE INDEX "quote_siteId_status_idx" ON "quote"("siteId", "status");

-- CreateIndex
CREATE INDEX "quote_leadId_idx" ON "quote"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "deal_line_quoteId_lineNo_key" ON "deal_line"("quoteId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "trade_in_appraisal_quoteId_key" ON "trade_in_appraisal"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "financing_plan_quoteId_key" ON "financing_plan"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_number_key" ON "sales_order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_quoteId_key" ON "sales_order"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_invoiceId_key" ON "sales_order"("invoiceId");

-- CreateIndex
CREATE INDEX "sales_order_siteId_status_idx" ON "sales_order"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "factory_order_number_key" ON "factory_order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "factory_order_vehicleId_key" ON "factory_order"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "factory_order_salesOrderId_key" ON "factory_order"("salesOrderId");

-- CreateIndex
CREATE INDEX "factory_order_siteId_status_idx" ON "factory_order"("siteId", "status");

-- CreateIndex
CREATE INDEX "reservation_status_expiresOn_idx" ON "reservation"("status", "expiresOn");

-- CreateIndex
CREATE INDEX "reservation_vehicleId_idx" ON "reservation"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "commission_salesOrderId_key" ON "commission"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "vo_purchase_number_key" ON "vo_purchase"("number");

-- CreateIndex
CREATE INDEX "vo_purchase_vehicleId_idx" ON "vo_purchase"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "police_register_entry_number_key" ON "police_register_entry"("number");

-- CreateIndex
CREATE UNIQUE INDEX "police_register_entry_voPurchaseId_key" ON "police_register_entry"("voPurchaseId");

-- CreateIndex
CREATE INDEX "police_register_entry_siteId_inDate_idx" ON "police_register_entry"("siteId", "inDate");

-- CreateIndex
CREATE INDEX "vehicle_cost_line_vehicleId_idx" ON "vehicle_cost_line"("vehicleId");

-- CreateIndex
CREATE INDEX "vo_price_change_vehicleId_idx" ON "vo_price_change"("vehicleId");

-- CreateIndex
CREATE INDEX "payment_sourceType_sourceId_idx" ON "payment"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "catalogue_model" ADD CONSTRAINT "catalogue_model_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue_version" ADD CONSTRAINT "catalogue_version_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "catalogue_model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue_option" ADD CONSTRAINT "catalogue_option_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "catalogue_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_catalogueVersionId_fkey" FOREIGN KEY ("catalogueVersionId") REFERENCES "catalogue_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_line" ADD CONSTRAINT "deal_line_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_in_appraisal" ADD CONSTRAINT "trade_in_appraisal_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_in_appraisal" ADD CONSTRAINT "trade_in_appraisal_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing_plan" ADD CONSTRAINT "financing_plan_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_order" ADD CONSTRAINT "factory_order_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_order" ADD CONSTRAINT "factory_order_catalogueVersionId_fkey" FOREIGN KEY ("catalogueVersionId") REFERENCES "catalogue_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_order" ADD CONSTRAINT "factory_order_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_order" ADD CONSTRAINT "factory_order_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission" ADD CONSTRAINT "commission_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission" ADD CONSTRAINT "commission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission" ADD CONSTRAINT "commission_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vo_purchase" ADD CONSTRAINT "vo_purchase_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vo_purchase" ADD CONSTRAINT "vo_purchase_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vo_purchase" ADD CONSTRAINT "vo_purchase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vo_purchase" ADD CONSTRAINT "vo_purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vo_purchase" ADD CONSTRAINT "vo_purchase_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "police_register_entry" ADD CONSTRAINT "police_register_entry_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "police_register_entry" ADD CONSTRAINT "police_register_entry_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "police_register_entry" ADD CONSTRAINT "police_register_entry_voPurchaseId_fkey" FOREIGN KEY ("voPurchaseId") REFERENCES "vo_purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_cost_line" ADD CONSTRAINT "vehicle_cost_line_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_cost_line" ADD CONSTRAINT "vehicle_cost_line_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vo_price_change" ADD CONSTRAINT "vo_price_change_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────
-- Hand-written (not expressible in the Prisma schema): double-sale prevention.
-- A vehicle has at most one ACTIVE reservation and is on at most one open sales order.
-- Prisma does not model partial indexes; `prisma migrate diff` leaves them alone (checked).
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "reservation_one_active_per_vehicle" ON "reservation" ("vehicleId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "sales_order_one_open_per_vehicle" ON "sales_order" ("vehicleId") WHERE "status" IN ('CONFIRMED', 'INVOICED');
