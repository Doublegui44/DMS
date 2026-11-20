-- CreateEnum
CREATE TYPE "PartMovementKind" AS ENUM ('OPENING', 'RECEIPT', 'ISSUE_RO', 'COUNTER_SALE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'RETURN_SUPPLIER', 'RETURN_CUSTOMER');

-- CreateEnum
CREATE TYPE "PurchaseOrderKind" AS ENUM ('STOCK', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('VARIANCE', 'MATCHED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "CounterSaleStatus" AS ENUM ('QUOTE', 'CONFIRMED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CycleCountStatus" AS ENUM ('OPEN', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "discount_code" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "discount_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_rate" (
    "id" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "priceClass" "PriceClass" NOT NULL,
    "discountBp" INTEGER NOT NULL,

    CONSTRAINT "discount_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part" (
    "id" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "brandId" TEXT,
    "supplierId" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "retailPriceCents" INTEGER NOT NULL,
    "listCostCents" INTEGER NOT NULL,
    "vatRateCode" TEXT NOT NULL DEFAULT 'STANDARD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_supersession" (
    "id" TEXT NOT NULL,
    "oldPartId" TEXT NOT NULL,
    "newPartId" TEXT NOT NULL,
    "effectiveOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_supersession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_item" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "bin" TEXT,
    "qtyOnHand" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "qtyReserved" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "valueCents" INTEGER NOT NULL DEFAULT 0,
    "pmpCents" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "minQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "maxQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "lastMovementOn" DATE,
    "lastCountedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_movement" (
    "id" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" "PartMovementKind" NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitCostCents" DECIMAL(18,4) NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "qtyAfter" DECIMAL(12,3) NOT NULL,
    "valueAfterCents" INTEGER NOT NULL,
    "pmpAfterCents" DECIMAL(18,4) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "reference" TEXT,
    "businessDate" DATE NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" "PurchaseOrderKind" NOT NULL DEFAULT 'STOCK',
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "createdOn" DATE NOT NULL,
    "sentOn" DATE,
    "expectedOn" DATE,
    "closedOn" DATE,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_line" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "partId" TEXT NOT NULL,
    "qtyOrdered" DECIMAL(12,3) NOT NULL,
    "qtyReceived" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unitCostCents" INTEGER NOT NULL,

    CONSTRAINT "purchase_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "deliveryNote" TEXT,
    "valueCents" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_line" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "poLineId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitCostCents" INTEGER NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "qtyInvoiced" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "goods_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierReference" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "SupplierInvoiceStatus" NOT NULL,
    "totalExclVatCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "totalInclVatCents" INTEGER NOT NULL,
    "receiptValueCents" INTEGER NOT NULL,
    "varianceCents" INTEGER NOT NULL,
    "entryId" TEXT,
    "paymentId" TEXT,
    "decidedById" TEXT,
    "decidedOn" DATE,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_line" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "receiptLineId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitCostCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "receiptValueCents" INTEGER NOT NULL,
    "varianceCents" INTEGER NOT NULL,

    CONSTRAINT "supplier_invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter_sale" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "priceClass" "PriceClass" NOT NULL,
    "status" "CounterSaleStatus" NOT NULL DEFAULT 'QUOTE',
    "reference" TEXT,
    "createdOn" DATE NOT NULL,
    "confirmedOn" DATE,
    "invoicedOn" DATE,
    "cancelledOn" DATE,
    "invoiceId" TEXT,
    "totalExclVatCents" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counter_sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter_sale_line" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "partId" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "discountBp" INTEGER NOT NULL,
    "lineExclVatCents" INTEGER NOT NULL,
    "unitCostCents" DECIMAL(18,4),
    "costCents" INTEGER,
    "requestedNumber" TEXT,

    CONSTRAINT "counter_sale_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "fromSiteId" TEXT NOT NULL,
    "toSiteId" TEXT NOT NULL,
    "transferredOn" DATE NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_line" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitCostCents" DECIMAL(18,4) NOT NULL,
    "valueCents" INTEGER NOT NULL,

    CONSTRAINT "stock_transfer_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_count" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "CycleCountStatus" NOT NULL DEFAULT 'OPEN',
    "label" TEXT NOT NULL,
    "createdOn" DATE NOT NULL,
    "postedOn" DATE,
    "varianceValueCents" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "postedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycle_count_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_count_line" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "expectedQty" DECIMAL(12,3) NOT NULL,
    "countedQty" DECIMAL(12,3),
    "varianceQty" DECIMAL(12,3),
    "varianceValueCents" INTEGER,

    CONSTRAINT "cycle_count_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_code_code_key" ON "discount_code"("code");

-- CreateIndex
CREATE UNIQUE INDEX "discount_rate_discountCodeId_priceClass_key" ON "discount_rate"("discountCodeId", "priceClass");

-- CreateIndex
CREATE UNIQUE INDEX "part_partNumber_key" ON "part"("partNumber");

-- CreateIndex
CREATE INDEX "part_brandId_idx" ON "part"("brandId");

-- CreateIndex
CREATE INDEX "part_family_idx" ON "part"("family");

-- CreateIndex
CREATE UNIQUE INDEX "part_supersession_oldPartId_key" ON "part_supersession"("oldPartId");

-- CreateIndex
CREATE INDEX "part_supersession_newPartId_idx" ON "part_supersession"("newPartId");

-- CreateIndex
CREATE INDEX "stock_item_siteId_idx" ON "stock_item"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_item_partId_siteId_key" ON "stock_item"("partId", "siteId");

-- CreateIndex
CREATE INDEX "part_movement_stockItemId_createdAt_idx" ON "part_movement"("stockItemId", "createdAt");

-- CreateIndex
CREATE INDEX "part_movement_siteId_businessDate_idx" ON "part_movement"("siteId", "businessDate");

-- CreateIndex
CREATE INDEX "part_movement_sourceType_sourceId_idx" ON "part_movement"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_number_key" ON "purchase_order"("number");

-- CreateIndex
CREATE INDEX "purchase_order_siteId_status_idx" ON "purchase_order"("siteId", "status");

-- CreateIndex
CREATE INDEX "purchase_order_supplierId_idx" ON "purchase_order"("supplierId");

-- CreateIndex
CREATE INDEX "purchase_order_line_partId_idx" ON "purchase_order_line"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_line_purchaseOrderId_lineNo_key" ON "purchase_order_line"("purchaseOrderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_number_key" ON "goods_receipt"("number");

-- CreateIndex
CREATE INDEX "goods_receipt_supplierId_siteId_idx" ON "goods_receipt"("supplierId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_number_key" ON "supplier_invoice"("number");

-- CreateIndex
CREATE INDEX "supplier_invoice_siteId_status_idx" ON "supplier_invoice"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_supplierId_supplierReference_key" ON "supplier_invoice"("supplierId", "supplierReference");

-- CreateIndex
CREATE UNIQUE INDEX "counter_sale_number_key" ON "counter_sale"("number");

-- CreateIndex
CREATE UNIQUE INDEX "counter_sale_invoiceId_key" ON "counter_sale"("invoiceId");

-- CreateIndex
CREATE INDEX "counter_sale_siteId_status_idx" ON "counter_sale"("siteId", "status");

-- CreateIndex
CREATE INDEX "counter_sale_customerId_idx" ON "counter_sale"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "counter_sale_line_saleId_lineNo_key" ON "counter_sale_line"("saleId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_number_key" ON "stock_transfer"("number");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_count_number_key" ON "cycle_count"("number");

-- CreateIndex
CREATE INDEX "cycle_count_siteId_status_idx" ON "cycle_count"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_count_line_countId_stockItemId_key" ON "cycle_count_line"("countId", "stockItemId");

-- AddForeignKey
ALTER TABLE "discount_rate" ADD CONSTRAINT "discount_rate_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_code"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part" ADD CONSTRAINT "part_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part" ADD CONSTRAINT "part_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part" ADD CONSTRAINT "part_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_supersession" ADD CONSTRAINT "part_supersession_oldPartId_fkey" FOREIGN KEY ("oldPartId") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_supersession" ADD CONSTRAINT "part_supersession_newPartId_fkey" FOREIGN KEY ("newPartId") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_partId_fkey" FOREIGN KEY ("partId") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_movement" ADD CONSTRAINT "part_movement_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_partId_fkey" FOREIGN KEY ("partId") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "purchase_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_line" ADD CONSTRAINT "supplier_invoice_line_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_line" ADD CONSTRAINT "supplier_invoice_line_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "goods_receipt_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_sale" ADD CONSTRAINT "counter_sale_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_sale" ADD CONSTRAINT "counter_sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_sale" ADD CONSTRAINT "counter_sale_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_sale_line" ADD CONSTRAINT "counter_sale_line_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "counter_sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_sale_line" ADD CONSTRAINT "counter_sale_line_partId_fkey" FOREIGN KEY ("partId") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_fromSiteId_fkey" FOREIGN KEY ("fromSiteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_toSiteId_fkey" FOREIGN KEY ("toSiteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "stock_transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_partId_fkey" FOREIGN KEY ("partId") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count" ADD CONSTRAINT "cycle_count_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_line" ADD CONSTRAINT "cycle_count_line_countId_fkey" FOREIGN KEY ("countId") REFERENCES "cycle_count"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_line" ADD CONSTRAINT "cycle_count_line_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────
-- Hand-written guards (Phase 4): the services enforce these rules, the database re-checks them.
-- ─────────────────────────────────────────────────────────────

-- Negative parts stock is not allowed (assumption 12), and an empty bin holds no value.
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_qty_check"
  CHECK ("qtyOnHand" >= 0 AND "qtyReserved" >= 0 AND "valueCents" >= 0 AND ("qtyOnHand" > 0 OR "valueCents" = 0));

-- Nothing is received beyond the order, nor invoiced beyond the receipt.
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_qty_check"
  CHECK ("qtyOrdered" > 0 AND "qtyReceived" >= 0 AND "qtyReceived" <= "qtyOrdered");
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_qty_check"
  CHECK ("qty" > 0 AND "qtyInvoiced" >= 0 AND "qtyInvoiced" <= "qty");

-- The stock ledger is append-only: a wrong movement is corrected by another movement.
CREATE OR REPLACE FUNCTION dms_part_movement_guard() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'MOVEMENT_IMMUTABLE: parts movements cannot be modified, record a correcting movement' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER part_movement_guard
  BEFORE UPDATE OR DELETE ON "part_movement"
  FOR EACH ROW EXECUTE FUNCTION dms_part_movement_guard();
