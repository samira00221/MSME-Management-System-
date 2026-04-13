const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');

const { authenticate, authorize } = require('../middleware/auth');
const { validate,
        loginSchema,
        createOrderSchema,
        generateBuyListSchema,
        updateBuyListItemSchema,
        createInventorySchema,
        updateShrinkageSchema,
        createClientSchema,
        createInvoiceSchema,
        recordPaymentSchema }     = require('../middleware/validate');

const authCtrl      = require('../controllers/authController');
const dashCtrl      = require('../controllers/dashboardController');
const orderCtrl     = require('../controllers/orderController');
const buyListCtrl   = require('../controllers/buyListController');
const inventoryCtrl = require('../controllers/inventoryController');
const invoiceCtrl   = require('../controllers/invoiceController');

// ── File upload config ─────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR || 'uploads'),
  filename:    (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: (process.env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── Auth ───────────────────────────────────────────────────────────────────
router.post('/auth/login',    validate(loginSchema), authCtrl.login);
router.get ('/auth/me',       authenticate,          authCtrl.getMe);
router.post('/auth/register', authenticate, authorize('admin'), authCtrl.register);

// ── Dashboard ──────────────────────────────────────────────────────────────
router.get('/dashboard/kpis',            authenticate, dashCtrl.getKPIs);
router.get('/dashboard/anomaly-alerts',  authenticate, dashCtrl.getAnomalyAlerts);
router.get('/dashboard/recent-activity', authenticate, dashCtrl.getRecentActivity);

// ── Orders ─────────────────────────────────────────────────────────────────
router.get ('/orders',         authenticate, orderCtrl.getOrders);
router.get ('/orders/:id',     authenticate, orderCtrl.getOrder);
router.post('/orders',         authenticate, validate(createOrderSchema), orderCtrl.createOrder);
router.put ('/orders/:id',     authenticate, orderCtrl.updateOrderStatus);
router.post('/orders/import',  authenticate, upload.single('file'), orderCtrl.importOrderFile);

// ── Market Buy List ────────────────────────────────────────────────────────
router.get ('/buy-list',              authenticate, buyListCtrl.getBuyList);
router.post('/buy-list/generate',     authenticate, validate(generateBuyListSchema), buyListCtrl.generateBuyList);
router.put ('/buy-list/items/:itemId',authenticate, validate(updateBuyListItemSchema), buyListCtrl.updateBuyListItem);
router.post('/buy-list/:id/complete', authenticate, buyListCtrl.completeBuyList);

// ── Inventory ──────────────────────────────────────────────────────────────
router.get ('/inventory',             authenticate, inventoryCtrl.getInventory);
router.post('/inventory',             authenticate, validate(createInventorySchema), inventoryCtrl.createInventoryBatch);
router.put ('/inventory/:id/shrinkage', authenticate, validate(updateShrinkageSchema), inventoryCtrl.recordShrinkage);

// ── Invoices ───────────────────────────────────────────────────────────────
router.get ('/invoices',            authenticate, invoiceCtrl.getInvoices);
router.get ('/invoices/:id',        authenticate, invoiceCtrl.getInvoice);
router.post('/invoices',            authenticate, validate(createInvoiceSchema), invoiceCtrl.createInvoice);
router.post('/invoices/:id/send',   authenticate, invoiceCtrl.sendInvoice);
router.post('/invoices/:id/payment',authenticate, validate(recordPaymentSchema), invoiceCtrl.recordPayment);

// ── Products (basic CRUD) ──────────────────────────────────────────────────
const { query }    = require('../config/database');
const { catchAsync } = require('../utils/errors');
const { success, created } = require('../utils/response');

router.get('/products', authenticate, catchAsync(async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM products WHERE is_active = TRUE ORDER BY category, product_name'
  );
  success(res, rows);
}));

router.post('/products', authenticate, authorize('admin', 'sales_staff'), catchAsync(async (req, res) => {
  const { product_name, category, unit_of_measure, default_selling_price,
          average_shrinkage_rate, is_perishable, shelf_life_hours } = req.body;
  const { rows } = await query(
    `INSERT INTO products
       (product_name, category, unit_of_measure, default_selling_price,
        average_shrinkage_rate, is_perishable, shelf_life_hours)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [product_name, category, unit_of_measure || 'kg', default_selling_price,
     average_shrinkage_rate || 15, is_perishable ?? true, shelf_life_hours]
  );
  created(res, rows[0], 'Product created');
}));

// ── Clients ────────────────────────────────────────────────────────────────
router.get('/clients', authenticate, catchAsync(async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM clients WHERE is_active = TRUE ORDER BY client_name'
  );
  success(res, rows);
}));

router.post('/clients', authenticate, validate(createClientSchema), catchAsync(async (req, res) => {
  const {
    client_name, client_type, contact_person, phone, email,
    address, gps_latitude, gps_longitude, credit_limit, preferred_delivery_time,
  } = req.body;
  const { rows } = await query(
    `INSERT INTO clients
       (client_name, client_type, contact_person, phone, email,
        address, gps_latitude, gps_longitude, credit_limit, preferred_delivery_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [client_name, client_type, contact_person, phone, email,
     address, gps_latitude, gps_longitude, credit_limit || 0, preferred_delivery_time]
  );
  created(res, rows[0], 'Client created');
}));

router.put('/clients/:id', authenticate, catchAsync(async (req, res) => {
  const fields  = Object.entries(req.body);
  if (!fields.length) throw new Error('No fields to update');
  const sets    = fields.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  const values  = fields.map(([, v]) => v);
  const { rows } = await query(
    `UPDATE clients SET ${sets} WHERE client_id = $${fields.length + 1} RETURNING *`,
    [...values, req.params.id]
  );
  success(res, rows[0]);
}));

module.exports = router;
