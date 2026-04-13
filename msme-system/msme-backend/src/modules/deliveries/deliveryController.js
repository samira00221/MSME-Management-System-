const { query, withTransaction } = require('../config/database');
const { AppError, catchAsync }   = require('../utils/errors');
const { success, created }       = require('../utils/response');
const { auditLog }               = require('../utils/audit');

// ── GET /api/deliveries ────────────────────────────────────────────────────
const getDeliveries = catchAsync(async (req, res) => {
  const { status, date } = req.query;

  let where  = ['d.supplier_id = $1'];
  const params = [req.user.supplier_id];
  let i = 2;

  if (status) { where.push(`d.status = $${i++}`); params.push(status); }
  if (date)   { where.push(`DATE(d.created_at) = $${i++}`); params.push(date); }

  const { rows } = await query(
    `SELECT
       d.*,
       u.full_name            AS driver_name,
       v.plate_number,
       v.vehicle_type,
       COUNT(ds.stop_id)      AS total_stops,
       COUNT(ds.stop_id) FILTER (WHERE ds.status = 'completed') AS completed_stops
     FROM deliveries d
     LEFT JOIN users u     ON u.user_id    = d.driver_id
     LEFT JOIN vehicles v  ON v.vehicle_id = d.vehicle_id
     LEFT JOIN delivery_stops ds ON ds.delivery_id = d.delivery_id
     WHERE ${where.join(' AND ')}
     GROUP BY d.delivery_id, u.full_name, v.plate_number, v.vehicle_type
     ORDER BY d.created_at DESC`,
    params
  );

  success(res, rows);
});

// ── GET /api/deliveries/:id ────────────────────────────────────────────────
const getDelivery = catchAsync(async (req, res) => {
  const { rows: delivery } = await query(
    `SELECT d.*, u.full_name AS driver_name, v.plate_number, v.vehicle_type
     FROM deliveries d
     LEFT JOIN users u    ON u.user_id    = d.driver_id
     LEFT JOIN vehicles v ON v.vehicle_id = d.vehicle_id
     WHERE d.delivery_id = $1`,
    [req.params.id]
  );

  if (!delivery[0]) throw new AppError('Delivery not found', 404);

  // Fetch stops with their items
  const { rows: stops } = await query(
    `SELECT
       ds.*,
       c.client_name,
       c.address       AS client_address,
       c.gps_latitude,
       c.gps_longitude,
       c.phone         AS client_phone,
       json_agg(json_build_object(
         'delivery_item_id',  di.delivery_item_id,
         'product_name',      p.product_name,
         'quantity_dispatched', di.quantity_dispatched,
         'quantity_delivered',  di.quantity_delivered,
         'quantity_rejected',   di.quantity_rejected,
         'unit_price',          di.unit_price
       )) AS items,
       pod.digital_signature IS NOT NULL AS pod_captured
     FROM delivery_stops ds
     JOIN clients c ON c.client_id = ds.client_id
     LEFT JOIN delivery_items di ON di.stop_id = ds.stop_id
     LEFT JOIN inventory inv     ON inv.inventory_id = di.inventory_id
     LEFT JOIN products p        ON p.product_id = inv.product_id
     LEFT JOIN proof_of_delivery pod ON pod.stop_id = ds.stop_id
     WHERE ds.delivery_id = $1
     GROUP BY ds.stop_id, c.client_name, c.address, c.gps_latitude,
              c.gps_longitude, c.phone, pod.digital_signature
     ORDER BY ds.stop_sequence`,
    [req.params.id]
  );

  success(res, { ...delivery[0], stops });
});

// ── POST /api/deliveries ───────────────────────────────────────────────────
// Create a delivery run from a completed buy list
const createDelivery = catchAsync(async (req, res) => {
  const { buy_list_id, driver_id, vehicle_id, planned_departure, stops } = req.body;

  if (!stops || stops.length === 0) {
    throw new AppError('At least one delivery stop is required', 400);
  }

  const delivery = await withTransaction(async (client) => {
    // Create delivery header
    const { rows: delRows } = await client.query(
      `INSERT INTO deliveries
         (buy_list_id, driver_id, vehicle_id, supplier_id, planned_departure,
          status, total_stops)
       VALUES ($1,$2,$3,$4,$5,'scheduled',$6)
       RETURNING *`,
      [
        buy_list_id || null,
        driver_id,
        vehicle_id || null,
        req.user.supplier_id,
        planned_departure || null,
        stops.length,
      ]
    );
    const del = delRows[0];

    // Create each stop and its items
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];

      const { rows: stopRows } = await client.query(
        `INSERT INTO delivery_stops
           (delivery_id, client_id, order_id, stop_sequence, planned_arrival)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [del.delivery_id, stop.client_id, stop.order_id || null, i + 1, stop.planned_arrival || null]
      );

      // Create delivery items for each product at this stop
      if (stop.items && stop.items.length > 0) {
        for (const item of stop.items) {
          await client.query(
            `INSERT INTO delivery_items
               (stop_id, order_item_id, inventory_id,
                quantity_dispatched, unit_price)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              stopRows[0].stop_id,
              item.order_item_id || null,
              item.inventory_id  || null,
              item.quantity_dispatched,
              item.unit_price || 0,
            ]
          );
        }
      }
    }

    return del;
  });

  await auditLog({
    userId:        req.user.user_id,
    action:        'DELIVERY_CREATED',
    tableAffected: 'deliveries',
    recordId:      delivery.delivery_id,
    newValue:      { driver_id, stop_count: stops.length },
    ipAddress:     req.ip,
  });

  created(res, delivery, 'Delivery created');
});

// ── PUT /api/deliveries/:id/start ─────────────────────────────────────────
const startDelivery = catchAsync(async (req, res) => {
  const { rows } = await query(
    `UPDATE deliveries
     SET status = 'in_progress', actual_departure = NOW()
     WHERE delivery_id = $1 AND status = 'scheduled'
     RETURNING *`,
    [req.params.id]
  );

  if (!rows[0]) throw new AppError('Delivery not found or already started', 404);

  await auditLog({
    userId:        req.user.user_id,
    action:        'DELIVERY_STARTED',
    tableAffected: 'deliveries',
    recordId:      req.params.id,
    ipAddress:     req.ip,
  });

  success(res, rows[0], 'Delivery started');
});

// ── PUT /api/deliveries/stops/:stopId ─────────────────────────────────────
// Field staff confirm/adjust quantities on-site
const updateDeliveryStop = catchAsync(async (req, res) => {
  const { items, status = 'completed', skip_reason } = req.body;

  const { rows: stopRows } = await query(
    'SELECT * FROM delivery_stops WHERE stop_id = $1',
    [req.params.stopId]
  );
  if (!stopRows[0]) throw new AppError('Stop not found', 404);

  await withTransaction(async (client) => {
    // Update stop status and arrival time
    await client.query(
      `UPDATE delivery_stops
       SET status = $1, actual_arrival = NOW(), skip_reason = $2
       WHERE stop_id = $3`,
      [status, skip_reason || null, req.params.stopId]
    );

    // Update each delivered item if provided
    if (items && items.length > 0) {
      for (const item of items) {
        await client.query(
          `UPDATE delivery_items
           SET quantity_delivered = $1,
               quantity_rejected  = $2,
               rejection_reason   = $3,
               confirmed_at       = NOW()
           WHERE delivery_item_id = $4`,
          [
            item.quantity_delivered,
            item.quantity_rejected || 0,
            item.rejection_reason  || null,
            item.delivery_item_id,
          ]
        );
      }
    }

    // Increment completed stops counter on parent delivery
    if (status === 'completed' || status === 'skipped') {
      await client.query(
        `UPDATE deliveries
         SET completed_stops = completed_stops + 1
         WHERE delivery_id = $1`,
        [stopRows[0].delivery_id]
      );

      // Check if all stops are done — auto-complete the delivery
      const { rows: del } = await client.query(
        'SELECT total_stops, completed_stops FROM deliveries WHERE delivery_id = $1',
        [stopRows[0].delivery_id]
      );
      if (del[0] && del[0].completed_stops + 1 >= del[0].total_stops) {
        await client.query(
          "UPDATE deliveries SET status = 'completed' WHERE delivery_id = $1",
          [stopRows[0].delivery_id]
        );
      }
    }
  });

  await auditLog({
    userId:        req.user.user_id,
    action:        'DELIVERY_STOP_UPDATED',
    tableAffected: 'delivery_stops',
    recordId:      req.params.stopId,
    newValue:      { status, item_count: items?.length || 0 },
    ipAddress:     req.ip,
  });

  success(res, null, 'Stop updated');
});

// ── POST /api/deliveries/stops/:stopId/pod ───────────────────────────────
// Capture proof of delivery — signature, photo, geotag
const captureProofOfDelivery = catchAsync(async (req, res) => {
  const {
    digital_signature,
    photo_evidence,
    geo_tag_latitude,
    geo_tag_longitude,
    confirmed_by,
    is_offline_captured = false,
  } = req.body;

  // Check stop exists
  const { rows: stop } = await query(
    'SELECT * FROM delivery_stops WHERE stop_id = $1',
    [req.params.stopId]
  );
  if (!stop[0]) throw new AppError('Stop not found', 404);

  // Upsert POD — allow re-capture if offline sync arrives late
  const { rows } = await query(
    `INSERT INTO proof_of_delivery
       (stop_id, digital_signature, photo_evidence,
        geo_tag_latitude, geo_tag_longitude,
        confirmed_by, is_offline_captured,
        synced_at, confirmed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, $8, NOW())
     ON CONFLICT (stop_id) DO UPDATE
       SET digital_signature  = EXCLUDED.digital_signature,
           photo_evidence     = EXCLUDED.photo_evidence,
           geo_tag_latitude   = EXCLUDED.geo_tag_latitude,
           geo_tag_longitude  = EXCLUDED.geo_tag_longitude,
           confirmed_by       = EXCLUDED.confirmed_by,
           synced_at          = NOW()
     RETURNING *`,
    [
      req.params.stopId,
      digital_signature  || null,
      photo_evidence     || null,
      geo_tag_latitude   || null,
      geo_tag_longitude  || null,
      confirmed_by       || null,
      is_offline_captured,
      is_offline_captured ? new Date().toISOString() : null,
    ]
  );

  await auditLog({
    userId:        req.user.user_id,
    action:        'POD_CAPTURED',
    tableAffected: 'proof_of_delivery',
    recordId:      rows[0].pod_id,
    newValue:      { stop_id: req.params.stopId, confirmed_by, is_offline_captured },
    ipAddress:     req.ip,
  });

  success(res, rows[0], 'Proof of delivery captured');
});

// ── GET /api/vehicles ──────────────────────────────────────────────────────
const getVehicles = catchAsync(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM vehicles
     WHERE supplier_id = $1
     ORDER BY vehicle_type`,
    [req.user.supplier_id]
  );
  success(res, rows);
});

module.exports = {
  getDeliveries,
  getDelivery,
  createDelivery,
  startDelivery,
  updateDeliveryStop,
  captureProofOfDelivery,
  getVehicles,
};
