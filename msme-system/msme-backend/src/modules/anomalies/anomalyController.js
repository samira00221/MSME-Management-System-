const axios            = require('axios');
const { query }        = require('../config/database');
const { AppError, catchAsync } = require('../utils/errors');
const { success }      = require('../utils/response');
const { auditLog }     = require('../utils/audit');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

// ── GET /api/anomalies ────────────────────────────────────────────────────
const getAnomalies = catchAsync(async (req, res) => {
  const { status, severity, type } = req.query;

  let where  = ['a.supplier_id = $1'];
  const params = [req.user.supplier_id];
  let i = 2;

  if (status)   { where.push(`a.resolution_status = $${i++}`); params.push(status); }
  if (severity) { where.push(`a.severity_level = $${i++}`);    params.push(severity); }
  if (type)     { where.push(`a.anomaly_type = $${i++}`);      params.push(type); }

  const { rows } = await query(
    `SELECT
       a.*,
       u.full_name AS resolved_by_name
     FROM anomalies a
     LEFT JOIN users u ON u.user_id = a.resolved_by
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE a.severity_level
         WHEN 'critical' THEN 1
         WHEN 'high'     THEN 2
         WHEN 'medium'   THEN 3
         ELSE 4
       END,
       a.detected_at DESC`,
    params
  );

  success(res, rows);
});

// ── GET /api/anomalies/:id ────────────────────────────────────────────────
const getAnomaly = catchAsync(async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.full_name AS resolved_by_name
     FROM anomalies a
     LEFT JOIN users u ON u.user_id = a.resolved_by
     WHERE a.anomaly_id = $1 AND a.supplier_id = $2`,
    [req.params.id, req.user.supplier_id]
  );

  if (!rows[0]) throw new AppError('Anomaly not found', 404);
  success(res, rows[0]);
});

// ── PUT /api/anomalies/:id/resolve ────────────────────────────────────────
const resolveAnomaly = catchAsync(async (req, res) => {
  const { notes } = req.body;
  if (!notes) throw new AppError('Resolution notes are required', 422);

  const { rows } = await query(
    `UPDATE anomalies
     SET resolution_status = 'reviewed',
         resolved_by       = $1,
         resolution_notes  = $2,
         resolved_at       = NOW()
     WHERE anomaly_id = $3 AND supplier_id = $4
     RETURNING *`,
    [req.user.user_id, notes, req.params.id, req.user.supplier_id]
  );

  if (!rows[0]) throw new AppError('Anomaly not found', 404);

  await auditLog({
    userId:        req.user.user_id,
    action:        'ANOMALY_RESOLVED',
    tableAffected: 'anomalies',
    recordId:      req.params.id,
    newValue:      { resolution_status: 'reviewed', notes },
    ipAddress:     req.ip,
  });

  success(res, rows[0], 'Anomaly resolved');
});

// ── PUT /api/anomalies/:id/dismiss ───────────────────────────────────────
const dismissAnomaly = catchAsync(async (req, res) => {
  const { notes } = req.body;

  const { rows } = await query(
    `UPDATE anomalies
     SET resolution_status = 'dismissed',
         resolved_by       = $1,
         resolution_notes  = $2,
         resolved_at       = NOW()
     WHERE anomaly_id = $3 AND supplier_id = $4
     RETURNING *`,
    [req.user.user_id, notes || 'Dismissed by admin', req.params.id, req.user.supplier_id]
  );

  if (!rows[0]) throw new AppError('Anomaly not found', 404);

  await auditLog({
    userId:        req.user.user_id,
    action:        'ANOMALY_DISMISSED',
    tableAffected: 'anomalies',
    recordId:      req.params.id,
    newValue:      { resolution_status: 'dismissed' },
    ipAddress:     req.ip,
  });

  success(res, rows[0], 'Anomaly dismissed');
});

// ── PUT /api/anomalies/:id/escalate ──────────────────────────────────────
const escalateAnomaly = catchAsync(async (req, res) => {
  const { rows } = await query(
    `UPDATE anomalies
     SET resolution_status = 'escalated',
         resolved_by       = $1,
         resolved_at       = NOW()
     WHERE anomaly_id = $2 AND supplier_id = $3
     RETURNING *`,
    [req.user.user_id, req.params.id, req.user.supplier_id]
  );

  if (!rows[0]) throw new AppError('Anomaly not found', 404);

  await auditLog({
    userId:        req.user.user_id,
    action:        'ANOMALY_ESCALATED',
    tableAffected: 'anomalies',
    recordId:      req.params.id,
    ipAddress:     req.ip,
  });

  success(res, rows[0], 'Anomaly escalated');
});

// ── POST /api/anomalies/scan ──────────────────────────────────────────────
// Manual end-of-day scan — sends all today's transactions to the AI
// service and saves any detected anomalies to the database
const runAnomalyScan = catchAsync(async (req, res) => {
  const today      = new Date().toISOString().split('T')[0];
  const supplierId = req.user.supplier_id;

  // 1. Collect today's weight/invoice signals from deliveries
  const { rows: deliverySignals } = await query(
    `SELECT
       di.delivery_item_id AS ref_id,
       di.quantity_dispatched,
       di.quantity_delivered,
       di.unit_price,
       di.unit_price * di.quantity_dispatched AS expected_invoice_amount,
       di.unit_price * COALESCE(di.quantity_delivered, di.quantity_dispatched)
                                              AS invoice_amount
     FROM delivery_items di
     JOIN delivery_stops ds ON ds.stop_id  = di.stop_id
     JOIN deliveries d      ON d.delivery_id = ds.delivery_id
     WHERE d.supplier_id = $1
       AND DATE(d.created_at) = $2
       AND di.quantity_delivered IS NOT NULL`,
    [supplierId, today]
  );

  // 2. Collect price variance signals from buy list items
  const { rows: priceSignals } = await query(
    `SELECT
       bli.item_id AS ref_id,
       bli.product_id,
       bli.actual_unit_cost  AS unit_price_paid,
       p.default_selling_price * 0.6 AS average_market_price
     FROM buy_list_items bli
     JOIN market_buy_lists mbl ON mbl.buy_list_id = bli.buy_list_id
     JOIN products p           ON p.product_id    = bli.product_id
     WHERE mbl.supplier_id = $1
       AND DATE(mbl.buy_date) = $2
       AND bli.actual_unit_cost IS NOT NULL`,
    [supplierId, today]
  );

  // 3. Build signal batch for AI service
  const signals = [
    ...deliverySignals.map((s) => ({
      supplier_id:              supplierId,
      signal_type:              'weight_invoice_ratio',
      quantity_dispatched_kg:   s.quantity_dispatched,
      quantity_delivered_kg:    s.quantity_delivered,
      invoice_amount:           s.invoice_amount,
      expected_invoice_amount:  s.expected_invoice_amount,
    })),
    ...priceSignals.map((s) => ({
      supplier_id:           supplierId,
      signal_type:           'price_variance',
      product_id:            s.product_id,
      unit_price_paid:       s.unit_price_paid,
      average_market_price:  s.average_market_price,
    })),
  ];

  if (signals.length === 0) {
    return success(res, { scanned: 0, anomalies_found: 0 }, 'No signals to scan');
  }

  // 4. Call Python AI service
  let anomaliesFound = 0;
  try {
    const { data } = await axios.post(`${AI_URL}/api/anomaly/analyse-batch`, { signals });
    const results   = data.results || [];

    // 5. Save flagged anomalies to database
    for (let idx = 0; idx < results.length; idx++) {
      const result = results[idx];
      if (!result.is_anomaly) continue;

      const sourceSignal = signals[idx];
      await query(
        `INSERT INTO anomalies
           (supplier_id, anomaly_type, severity_level, detection_type,
            confidence_score, reference_table)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING`,
        [
          supplierId,
          result.anomaly_type,
          result.severity_level,
          result.explanation,
          result.confidence_score,
          sourceSignal.signal_type === 'price_variance' ? 'buy_list_items' : 'delivery_items',
        ]
      );
      anomaliesFound++;
    }
  } catch (err) {
    // AI service unreachable — return partial result
    return success(res, {
      scanned:        signals.length,
      anomalies_found: 0,
      warning:        'AI service unavailable. Scan incomplete.',
    });
  }

  await auditLog({
    userId:        req.user.user_id,
    action:        'ANOMALY_SCAN_RUN',
    tableAffected: 'anomalies',
    recordId:      null,
    newValue:      { scanned: signals.length, anomalies_found: anomaliesFound },
    ipAddress:     req.ip,
  });

  success(res, {
    scanned:         signals.length,
    anomalies_found: anomaliesFound,
  }, 'Scan complete');
});

module.exports = {
  getAnomalies,
  getAnomaly,
  resolveAnomaly,
  dismissAnomaly,
  escalateAnomaly,
  runAnomalyScan,
};
