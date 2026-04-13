const axios            = require('axios');
const { query }        = require('../config/database');
const { AppError, catchAsync } = require('../utils/errors');
const { success, created }     = require('../utils/response');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

// ── GET /api/forecasts ─────────────────────────────────────────────────────
const getForecasts = catchAsync(async (req, res) => {
  const { client_id, product_id, week } = req.query;

  let where  = ['df.supplier_id = $1'];
  const params = [req.user.supplier_id];
  let i = 2;

  if (client_id)  { where.push(`df.client_id = $${i++}`);             params.push(client_id); }
  if (product_id) { where.push(`df.product_id = $${i++}`);            params.push(product_id); }
  if (week)       { where.push(`df.forecast_week_start = $${i++}`);   params.push(week); }

  const { rows } = await query(
    `SELECT
       df.*,
       c.client_name,
       p.product_name,
       p.unit_of_measure
     FROM demand_forecasts df
     JOIN clients  c ON c.client_id  = df.client_id
     JOIN products p ON p.product_id = df.product_id
     WHERE ${where.join(' AND ')}
     ORDER BY df.forecast_week_start DESC, c.client_name`,
    params
  );

  success(res, rows);
});

// ── POST /api/forecasts/predict ───────────────────────────────────────────
// Request a fresh prediction from the Python AI service
// and persist it to the database
const requestForecast = catchAsync(async (req, res) => {
  const {
    client_id,
    product_id,
    forecast_week_start,
    season,
    is_school_term_week,
    user_override_qty,
  } = req.body;

  if (!client_id || !product_id || !forecast_week_start) {
    throw new AppError('client_id, product_id, and forecast_week_start are required', 422);
  }

  // Call Python forecasting service
  let forecastData;
  try {
    const { data } = await axios.post(`${AI_URL}/api/forecast/predict`, {
      supplier_id:         req.user.supplier_id,
      client_id,
      product_id,
      forecast_week_start,
      season:              season              || _getCurrentSeason(),
      is_school_term_week: is_school_term_week ?? _isSchoolTermWeek(),
      user_override_qty:   user_override_qty   || null,
    });
    forecastData = data.data || data;
  } catch (err) {
    // AI service down — return a simple rolling average from DB
    forecastData = await _getRollingAverageFallback(
      req.user.supplier_id, client_id, product_id
    );
  }

  // Upsert forecast — one record per supplier+client+product+week
  const { rows } = await query(
    `INSERT INTO demand_forecasts
       (supplier_id, client_id, product_id, forecast_week_start,
        predicted_quantity, confidence_score, model_version,
        data_points_used, external_signals)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (supplier_id, client_id, product_id, forecast_week_start)
     DO UPDATE SET
       predicted_quantity = EXCLUDED.predicted_quantity,
       confidence_score   = EXCLUDED.confidence_score,
       model_version      = EXCLUDED.model_version,
       data_points_used   = EXCLUDED.data_points_used,
       external_signals   = EXCLUDED.external_signals
     RETURNING *`,
    [
      req.user.supplier_id,
      client_id,
      product_id,
      forecast_week_start,
      forecastData.predicted_quantity_kg     || forecastData.predicted_quantity || 0,
      forecastData.confidence_score          || 0,
      forecastData.model_version             || 'fallback',
      forecastData.data_points_used          || 0,
      JSON.stringify(forecastData.external_signals_used || []),
    ]
  );

  success(res, {
    ...rows[0],
    is_cold_start: forecastData.is_cold_start ?? false,
  }, 'Forecast generated');
});

// ── POST /api/forecasts/actual ────────────────────────────────────────────
// Record what actually happened — feeds progressive model retraining
const recordActual = catchAsync(async (req, res) => {
  const { client_id, product_id, forecast_week_start, actual_quantity_kg } = req.body;

  if (!client_id || !product_id || !forecast_week_start || actual_quantity_kg == null) {
    throw new AppError('All fields are required', 422);
  }

  const { rows } = await query(
    `UPDATE demand_forecasts
     SET actual_quantity = $1,
         variance        = ABS(predicted_quantity - $1)
     WHERE supplier_id          = $2
       AND client_id             = $3
       AND product_id            = $4
       AND forecast_week_start   = $5
     RETURNING *`,
    [
      actual_quantity_kg,
      req.user.supplier_id,
      client_id,
      product_id,
      forecast_week_start,
    ]
  );

  if (!rows[0]) {
    throw new AppError('No forecast found for this supplier/client/product/week', 404);
  }

  // Also notify the Python service so it can factor this into retraining
  axios.post(`${AI_URL}/api/forecast/record-actual`, {
    supplier_id:         req.user.supplier_id,
    client_id,
    product_id,
    forecast_week_start,
    actual_quantity_kg,
  }).catch(() => {
    // Non-fatal — the DB record is already saved
    console.warn('[forecast] Could not notify AI service of actual quantity');
  });

  success(res, rows[0], 'Actual quantity recorded');
});

// ── POST /api/forecasts/train ─────────────────────────────────────────────
// Manually trigger model retraining (admin only)
const triggerRetraining = catchAsync(async (req, res) => {
  try {
    const { data } = await axios.post(`${AI_URL}/api/forecast/train`);
    success(res, data, 'Retraining triggered');
  } catch (err) {
    throw new AppError('AI service unavailable for retraining', 503);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────
function _getCurrentSeason() {
  const m = new Date().getMonth() + 1;
  if ([3, 4, 5, 10, 11].includes(m)) return 'rainy_season';
  if ([6, 7, 8].includes(m))         return 'harvest_season';
  return 'dry_season';
}

// Rwanda school terms roughly: Jan-Apr, May-Aug (with breaks), Sep-Nov
function _isSchoolTermWeek() {
  const m = new Date().getMonth() + 1;
  return [1, 2, 3, 5, 6, 9, 10, 11].includes(m);
}

async function _getRollingAverageFallback(supplierId, clientId, productId) {
  const { rows } = await query(
    `SELECT COALESCE(
       AVG(oi.quantity_ordered), 5
     ) AS avg_qty
     FROM client_orders co
     JOIN order_items oi ON oi.order_id   = co.order_id
     WHERE co.supplier_id = $1
       AND co.client_id   = $2
       AND oi.product_id  = $3
       AND co.status IN ('delivered','completed')
       AND co.order_date >= NOW() - INTERVAL '8 weeks'`,
    [supplierId, clientId, productId]
  );

  return {
    predicted_quantity_kg: parseFloat(rows[0]?.avg_qty || 5),
    confidence_score:      0.40,
    model_version:         'db_rolling_avg_fallback',
    data_points_used:      0,
    is_cold_start:         true,
    external_signals_used: [],
  };
}

module.exports = {
  getForecasts,
  requestForecast,
  recordActual,
  triggerRetraining,
};
