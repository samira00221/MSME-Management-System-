-- ============================================================
--  MSME Supply Chain Management System — Database Schema
--  Run: node src/config/migrate.js
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone_number  VARCHAR(20),
  role          VARCHAR(20) NOT NULL CHECK (role IN ('admin','sales_staff','field_staff')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login    TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── SUPPLIERS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES users(user_id),
  business_name        VARCHAR(150) NOT NULL,
  supplier_type        VARCHAR(20) NOT NULL CHECK (supplier_type IN ('raw_produce','cooked_food','mixed')),
  phone                VARCHAR(20),
  email                VARCHAR(150),
  address              TEXT,
  district             VARCHAR(50),
  performance_rating   DECIMAL(3,2) DEFAULT 0,
  credit_limit         DECIMAL(12,2) DEFAULT 0,
  on_time_delivery_rate DECIMAL(5,2)  DEFAULT 0,
  weight_accuracy_rate  DECIMAL(5,2)  DEFAULT 0,
  total_deliveries      INTEGER DEFAULT 0,
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── CLIENTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  client_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name            VARCHAR(150) NOT NULL,
  client_type            VARCHAR(20)  NOT NULL CHECK (client_type IN ('school','hotel','hospital','restaurant','retail','other')),
  contact_person         VARCHAR(100),
  phone                  VARCHAR(20),
  email                  VARCHAR(150),
  address                TEXT,
  gps_latitude           DECIMAL(10,7),
  gps_longitude          DECIMAL(10,7),
  credit_limit           DECIMAL(12,2) DEFAULT 0,
  credit_balance         DECIMAL(12,2) DEFAULT 0,
  preferred_delivery_time TIME,
  preferred_order_channel VARCHAR(20) DEFAULT 'manual',
  is_active              BOOLEAN DEFAULT TRUE,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── PRODUCTS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  product_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name         VARCHAR(100) NOT NULL,
  category             VARCHAR(30)  NOT NULL,
  unit_of_measure      VARCHAR(20)  NOT NULL DEFAULT 'kg',
  default_selling_price DECIMAL(10,2),
  reorder_point        DECIMAL(10,2) DEFAULT 0,
  average_shrinkage_rate DECIMAL(5,2) DEFAULT 15,
  is_perishable        BOOLEAN DEFAULT TRUE,
  shelf_life_hours     INTEGER,
  is_active            BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── CLIENT ORDERS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_orders (
  order_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(client_id),
  supplier_id   UUID REFERENCES suppliers(supplier_id),
  created_by    UUID REFERENCES users(user_id),
  order_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  delivery_date DATE NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','consolidated','dispatched','delivered','cancelled')),
  source        VARCHAR(20) NOT NULL DEFAULT 'manual'
                CHECK (source IN ('manual','whatsapp','pdf','excel','photo')),
  total_amount  DECIMAL(12,2) DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── ORDER ITEMS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  order_item_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES client_orders(order_id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(product_id),
  quantity_ordered DECIMAL(10,2) NOT NULL,
  unit_price       DECIMAL(10,2) NOT NULL DEFAULT 0,
  subtotal         DECIMAL(12,2) GENERATED ALWAYS AS (quantity_ordered * unit_price) STORED
);

-- ── MARKET BUY LISTS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_buy_lists (
  buy_list_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id          UUID NOT NULL REFERENCES suppliers(supplier_id),
  created_by           UUID REFERENCES users(user_id),
  buy_date             DATE NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','active','completed')),
  total_estimated_cost DECIMAL(12,2) DEFAULT 0,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── BUY LIST ITEMS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buy_list_items (
  item_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buy_list_id           UUID NOT NULL REFERENCES market_buy_lists(buy_list_id) ON DELETE CASCADE,
  product_id            UUID NOT NULL REFERENCES products(product_id),
  total_ordered_qty     DECIMAL(10,2) NOT NULL,
  recommended_buy_qty   DECIMAL(10,2) NOT NULL,
  predicted_shrinkage_rate DECIMAL(5,2) DEFAULT 0,
  actual_bought_qty     DECIMAL(10,2),
  actual_unit_cost      DECIMAL(10,2),
  vendor_name           VARCHAR(100),
  created_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── INVENTORY ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  inventory_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buy_list_item_id          UUID REFERENCES buy_list_items(item_id),
  product_id                UUID NOT NULL REFERENCES products(product_id),
  supplier_id               UUID REFERENCES suppliers(supplier_id),
  batch_number              VARCHAR(50),
  season                    VARCHAR(20) DEFAULT 'dry_season',
  quantity_purchased        DECIMAL(10,2) NOT NULL,
  quantity_after_processing DECIMAL(10,2),
  shrinkage_amount          DECIMAL(10,2) GENERATED ALWAYS AS
                            (quantity_purchased - COALESCE(quantity_after_processing, quantity_purchased)) STORED,
  predicted_shrinkage       DECIMAL(5,2) DEFAULT 0,
  unit_cost                 DECIMAL(10,2),
  warehouse_location        VARCHAR(50),
  stock_status              VARCHAR(20) NOT NULL DEFAULT 'available'
                            CHECK (stock_status IN ('available','reserved','depleted')),
  expiry_date               TIMESTAMP,
  created_at                TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── VEHICLES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  vehicle_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   UUID REFERENCES suppliers(supplier_id),
  plate_number  VARCHAR(20) UNIQUE NOT NULL,
  vehicle_type  VARCHAR(20) NOT NULL CHECK (vehicle_type IN ('van','motorbike','truck','bicycle')),
  capacity_kg   DECIMAL(8,2),
  is_available  BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── DELIVERIES ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliveries (
  delivery_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buy_list_id       UUID REFERENCES market_buy_lists(buy_list_id),
  driver_id         UUID REFERENCES users(user_id),
  vehicle_id        UUID REFERENCES vehicles(vehicle_id),
  supplier_id       UUID REFERENCES suppliers(supplier_id),
  planned_departure TIMESTAMP,
  actual_departure  TIMESTAMP,
  status            VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','in_progress','completed','partial','failed')),
  total_stops       INTEGER DEFAULT 0,
  completed_stops   INTEGER DEFAULT 0,
  notes             TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── DELIVERY STOPS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_stops (
  stop_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id      UUID NOT NULL REFERENCES deliveries(delivery_id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(client_id),
  order_id         UUID REFERENCES client_orders(order_id),
  stop_sequence    INTEGER NOT NULL,
  planned_arrival  TIMESTAMP,
  actual_arrival   TIMESTAMP,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','arrived','completed','skipped','failed')),
  skip_reason      TEXT
);

-- ── DELIVERY ITEMS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_items (
  delivery_item_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_id             UUID NOT NULL REFERENCES delivery_stops(stop_id) ON DELETE CASCADE,
  order_item_id       UUID REFERENCES order_items(order_item_id),
  inventory_id        UUID REFERENCES inventory(inventory_id),
  quantity_dispatched DECIMAL(10,2) NOT NULL,
  quantity_delivered  DECIMAL(10,2),
  quantity_rejected   DECIMAL(10,2) DEFAULT 0,
  rejection_reason    TEXT,
  unit_price          DECIMAL(10,2),
  confirmed_at        TIMESTAMP
);

-- ── PROOF OF DELIVERY ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proof_of_delivery (
  pod_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_id            UUID NOT NULL UNIQUE REFERENCES delivery_stops(stop_id),
  digital_signature  TEXT,
  photo_evidence     TEXT,
  geo_tag_latitude   DECIMAL(10,7),
  geo_tag_longitude  DECIMAL(10,7),
  confirmed_by       VARCHAR(100),
  is_offline_captured BOOLEAN DEFAULT FALSE,
  synced_at          TIMESTAMP,
  confirmed_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── INVOICES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  invoice_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID REFERENCES client_orders(order_id),
  client_id       UUID NOT NULL REFERENCES clients(client_id),
  supplier_id     UUID REFERENCES suppliers(supplier_id),
  generated_by    UUID REFERENCES users(user_id),
  invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE,
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_rate        DECIMAL(5,2)  DEFAULT 0,
  tax_amount      DECIMAL(12,2) DEFAULT 0,
  discount_amount DECIMAL(12,2) DEFAULT 0,
  total_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','paid','partial','overdue','disputed')),
  payment_method  VARCHAR(20)  DEFAULT 'cash',
  sent_via_whatsapp BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── PAYMENTS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  payment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(invoice_id),
  recorded_by     UUID REFERENCES users(user_id),
  amount_paid     DECIMAL(12,2) NOT NULL,
  payment_type    VARCHAR(20) NOT NULL CHECK (payment_type IN ('full','partial','advance','credit')),
  transaction_ref VARCHAR(100),
  payment_channel VARCHAR(20) DEFAULT 'cash',
  payment_date    TIMESTAMP NOT NULL DEFAULT NOW(),
  notes           TEXT
);

-- ── FINANCIAL RECORDS (ledger) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_records (
  record_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id    UUID REFERENCES suppliers(supplier_id),
  ledger_type    VARCHAR(20) NOT NULL CHECK (ledger_type IN ('receivable','payable','expense','revenue')),
  reference_id   UUID,
  reference_type VARCHAR(50),
  amount         DECIMAL(12,2) NOT NULL,
  running_balance DECIMAL(14,2) DEFAULT 0,
  entry_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  description    TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── ANOMALIES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anomalies (
  anomaly_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       UUID REFERENCES suppliers(supplier_id),
  detected_by       VARCHAR(50) DEFAULT 'ai_model',
  anomaly_type      VARCHAR(50) NOT NULL,
  severity_level    VARCHAR(20) NOT NULL CHECK (severity_level IN ('low','medium','high','critical')),
  detection_type    TEXT,
  confidence_score  DECIMAL(5,2) DEFAULT 0,
  reference_id      UUID,
  reference_table   VARCHAR(50),
  resolution_status VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (resolution_status IN ('pending','reviewed','dismissed','escalated')),
  resolved_by       UUID REFERENCES users(user_id),
  resolution_notes  TEXT,
  detected_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMP
);

-- ── DEMAND FORECASTS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demand_forecasts (
  forecast_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id          UUID REFERENCES suppliers(supplier_id),
  client_id            UUID REFERENCES clients(client_id),
  product_id           UUID REFERENCES products(product_id),
  forecast_week_start  DATE NOT NULL,
  predicted_quantity   DECIMAL(10,2),
  confidence_score     DECIMAL(5,2) DEFAULT 0,
  model_version        VARCHAR(30),
  data_points_used     INTEGER DEFAULT 0,
  external_signals     JSONB,
  actual_quantity      DECIMAL(10,2),
  variance             DECIMAL(10,2),
  created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── NOTIFICATIONS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(user_id),
  trigger_event   VARCHAR(100),
  channel_type    VARCHAR(20) NOT NULL CHECK (channel_type IN ('in_app','whatsapp','sms','email')),
  title           VARCHAR(150),
  message         TEXT,
  reference_id    UUID,
  reference_table VARCHAR(50),
  is_read         BOOLEAN DEFAULT FALSE,
  sent_at         TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── AUDIT LOG (insert-only) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(user_id),
  action         VARCHAR(100) NOT NULL,
  table_affected VARCHAR(50),
  record_id      UUID,
  old_value      JSONB,
  new_value      JSONB,
  ip_address     VARCHAR(45),
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Prevent any UPDATE or DELETE on audit_logs
CREATE OR REPLACE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE OR REPLACE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_client      ON client_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_status      ON client_orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date        ON client_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_inventory_product  ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_status   ON inventory(stock_status);
CREATE INDEX IF NOT EXISTS idx_invoices_client    ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status    ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_anomalies_status   ON anomalies(resolution_status);
CREATE INDEX IF NOT EXISTS idx_anomalies_severity ON anomalies(severity_level);
CREATE INDEX IF NOT EXISTS idx_deliveries_status  ON deliveries(status);
CREATE INDEX IF NOT EXISTS idx_audit_user         ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_table        ON audit_logs(table_affected);
