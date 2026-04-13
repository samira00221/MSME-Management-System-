const { query }        = require('../config/database');
const { AppError, catchAsync } = require('../utils/errors');
const { success }      = require('../utils/response');

// ── GET /api/financial/summary ────────────────────────────────────────────
const getSummary = catchAsync(async (req, res) => {
  const { from, to } = req.query;
  const supplierId   = req.user.supplier_id;

  const startDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const endDate   = to   || new Date().toISOString().split('T')[0];

  const [revenue, expenses, outstanding, performance] = await Promise.all([

    // Total revenue (paid invoices)
    query(
      `SELECT
         COALESCE(SUM(p.amount_paid), 0)                            AS total_revenue,
         COALESCE(SUM(p.amount_paid) FILTER (
           WHERE p.payment_channel = 'mobile_money'), 0)            AS mobile_money_revenue,
         COALESCE(SUM(p.amount_paid) FILTER (
           WHERE p.payment_channel = 'cash'), 0)                    AS cash_revenue,
         COUNT(DISTINCT inv.invoice_id)                             AS invoices_paid
       FROM payments p
       JOIN invoices inv ON inv.invoice_id = p.invoice_id
       WHERE inv.supplier_id = $1
         AND DATE(p.payment_date) BETWEEN $2 AND $3`,
      [supplierId, startDate, endDate]
    ),

    // Total procurement spend
    query(
      `SELECT
         COALESCE(SUM(bli.actual_unit_cost * bli.actual_bought_qty), 0) AS total_spend,
         COUNT(DISTINCT mbl.buy_list_id) AS market_trips
       FROM buy_list_items bli
       JOIN market_buy_lists mbl ON mbl.buy_list_id = bli.buy_list_id
       WHERE mbl.supplier_id  = $1
         AND mbl.buy_date BETWEEN $2 AND $3
         AND bli.actual_unit_cost IS NOT NULL`,
      [supplierId, startDate, endDate]
    ),

    // Outstanding receivables
    query(
      `SELECT
         COALESCE(SUM(inv.total_amount - COALESCE(paid.total_paid, 0)), 0) AS outstanding,
         COUNT(*) FILTER (WHERE inv.status = 'overdue')                    AS overdue_count
       FROM invoices inv
       LEFT JOIN LATERAL (
         SELECT SUM(amount_paid) AS total_paid
         FROM payments
         WHERE invoice_id = inv.invoice_id
       ) paid ON TRUE
       WHERE inv.supplier_id = $1
         AND inv.status NOT IN ('paid','cancelled')`,
      [supplierId]
    ),

    // Supplier performance KPIs
    query(
      `SELECT
         ROUND(
           COUNT(*) FILTER (WHERE ds.status = 'completed' AND ds.actual_arrival <= ds.planned_arrival)
           * 100.0 / NULLIF(COUNT(*) FILTER (WHERE ds.status IN ('completed','failed')), 0),
         2) AS on_time_delivery_rate,
         ROUND(
           AVG(
             CASE WHEN i.quantity_after_processing IS NOT NULL
             THEN ABS(i.quantity_after_processing / NULLIF(i.quantity_purchased, 0) - 1) * 100
             END
           ), 2
         ) AS avg_weight_accuracy
       FROM delivery_stops ds
       JOIN deliveries d ON d.delivery_id = ds.delivery_id
       LEFT JOIN delivery_items di ON di.stop_id = ds.stop_id
       LEFT JOIN inventory i ON i.inventory_id = di.inventory_id
       WHERE d.supplier_id = $1
         AND DATE(d.created_at) BETWEEN $2 AND $3`,
      [supplierId, startDate, endDate]
    ),
  ]);

  const rev       = revenue.rows[0];
  const exp       = expenses.rows[0];
  const out       = outstanding.rows[0];
  const perf      = performance.rows[0];
  const totalRev  = parseFloat(rev.total_revenue);
  const totalSpend= parseFloat(exp.total_spend);

  success(res, {
    period:             { from: startDate, to: endDate },
    revenue: {
      total:            totalRev,
      mobile_money:     parseFloat(rev.mobile_money_revenue),
      cash:             parseFloat(rev.cash_revenue),
      invoices_paid:    Number(rev.invoices_paid),
    },
    expenses: {
      total_spend:      totalSpend,
      market_trips:     Number(exp.market_trips),
    },
    gross_profit:       totalRev - totalSpend,
    gross_margin_pct:   totalRev > 0
                          ? parseFloat(((totalRev - totalSpend) / totalRev * 100).toFixed(2))
                          : 0,
    outstanding: {
      amount:           parseFloat(out.outstanding),
      overdue_count:    Number(out.overdue_count),
    },
    performance: {
      on_time_delivery_rate: parseFloat(perf.on_time_delivery_rate || 0),
      avg_weight_accuracy:   parseFloat(perf.avg_weight_accuracy   || 0),
    },
  });
});

// ── GET /api/financial/ledger ─────────────────────────────────────────────
const getLedger = catchAsync(async (req, res) => {
  const { type, from, to, page = 1, limit = 30 } = req.query;
  const offset = (page - 1) * limit;

  let where  = ['fr.supplier_id = $1'];
  const params = [req.user.supplier_id];
  let i = 2;

  if (type) { where.push(`fr.ledger_type = $${i++}`); params.push(type); }
  if (from) { where.push(`fr.entry_date >= $${i++}`); params.push(from); }
  if (to)   { where.push(`fr.entry_date <= $${i++}`); params.push(to); }

  const countRes = await query(
    `SELECT COUNT(*) FROM financial_records fr WHERE ${where.join(' AND ')}`,
    params
  );

  const { rows } = await query(
    `SELECT fr.*
     FROM financial_records fr
     WHERE ${where.join(' AND ')}
     ORDER BY fr.entry_date DESC, fr.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );

  success(res, {
    records:    rows,
    pagination: {
      page:       Number(page),
      limit:      Number(limit),
      total:      Number(countRes.rows[0].count),
      totalPages: Math.ceil(countRes.rows[0].count / limit),
    },
  });
});

// ── GET /api/financial/client-balances ────────────────────────────────────
// Shows outstanding amounts per client — accounts receivable view
const getClientBalances = catchAsync(async (req, res) => {
  const { rows } = await query(
    `SELECT
       c.client_id,
       c.client_name,
       c.client_type,
       c.phone,
       COUNT(inv.invoice_id)                                         AS total_invoices,
       COALESCE(SUM(inv.total_amount), 0)                           AS total_billed,
       COALESCE(SUM(paid.amount_paid), 0)                           AS total_paid,
       COALESCE(SUM(inv.total_amount), 0) -
         COALESCE(SUM(paid.amount_paid), 0)                         AS balance_due,
       COUNT(inv.invoice_id) FILTER (WHERE inv.status = 'overdue')  AS overdue_invoices
     FROM clients c
     LEFT JOIN invoices inv ON inv.client_id = c.client_id
       AND inv.supplier_id = $1
     LEFT JOIN LATERAL (
       SELECT SUM(amount_paid) AS amount_paid
       FROM payments
       WHERE invoice_id = inv.invoice_id
     ) paid ON TRUE
     GROUP BY c.client_id, c.client_name, c.client_type, c.phone
     HAVING COUNT(inv.invoice_id) > 0
     ORDER BY balance_due DESC`,
    [req.user.supplier_id]
  );

  success(res, rows);
});

// ── GET /api/financial/shrinkage-analytics ────────────────────────────────
// Predicted vs actual shrinkage by product — for the Intelligence module
const getShrinkageAnalytics = catchAsync(async (req, res) => {
  const { from, to } = req.query;
  const startDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const endDate   = to   || new Date().toISOString().split('T')[0];

  const { rows } = await query(
    `SELECT
       p.product_name,
       p.category,
       COUNT(i.inventory_id)              AS batch_count,
       ROUND(AVG(i.predicted_shrinkage), 2) AS avg_predicted_pct,
       ROUND(AVG(
         CASE WHEN i.quantity_after_processing IS NOT NULL
         THEN (1 - i.quantity_after_processing / NULLIF(i.quantity_purchased, 0)) * 100
         END
       ), 2)                              AS avg_actual_pct,
       ROUND(AVG(
         CASE WHEN i.quantity_after_processing IS NOT NULL
         THEN ABS(
           (1 - i.quantity_after_processing / NULLIF(i.quantity_purchased, 0)) * 100
           - i.predicted_shrinkage
         )
         END
       ), 2)                              AS avg_variance_pct,
       ROUND(SUM(i.quantity_purchased - COALESCE(i.quantity_after_processing,
             i.quantity_purchased)), 2)   AS total_kg_lost
     FROM inventory i
     JOIN products p ON p.product_id = i.product_id
     WHERE i.supplier_id = $1
       AND DATE(i.created_at) BETWEEN $2 AND $3
     GROUP BY p.product_name, p.category
     ORDER BY avg_variance_pct DESC NULLS LAST`,
    [req.user.supplier_id, startDate, endDate]
  );

  success(res, rows);
});

module.exports = {
  getSummary,
  getLedger,
  getClientBalances,
  getShrinkageAnalytics,
};
