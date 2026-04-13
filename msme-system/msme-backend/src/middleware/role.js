'use strict';

const { ROLES } = require('../database/models/User');

// ─── PERMISSION MAP ───────────────────────────────────────────────────────────
// Defines what each role can do across the system.
// Used by authorize() on routes and can be imported by any module
// that needs to check permissions programmatically.
//
// Convention: 'module:action'
// ─────────────────────────────────────────────────────────────────────────────
const PERMISSIONS = {
  [ROLES.ADMIN]: [
    // User management
    'users:create',
    'users:read',
    'users:update',
    'users:deactivate',

    // Procurement & buy list
    'procurement:create',
    'procurement:read',
    'procurement:update',
    'procurement:delete',
    'buylist:generate',
    'buylist:read',

    // Inventory
    'inventory:create',
    'inventory:read',
    'inventory:update',
    'inventory:delete',

    // Orders / clients
    'orders:create',
    'orders:read',
    'orders:update',
    'orders:delete',
    'clients:create',
    'clients:read',
    'clients:update',

    // Deliveries
    'deliveries:read',
    'deliveries:dispatch',
    'deliveries:update',

    // Invoices
    'invoices:create',
    'invoices:read',
    'invoices:update',
    'invoices:send',

    // Finance
    'finance:read',
    'finance:update',

    // AI / Analytics
    'analytics:read',
    'anomalies:read',
    'forecasts:read',

    // Dashboard KPIs
    'dashboard:read',

    // Audit
    'audit:read',
  ],

  [ROLES.SALES_STAFF]: [
    // Orders — primary responsibility
    'orders:create',
    'orders:read',
    'orders:update',

    // Clients
    'clients:create',
    'clients:read',
    'clients:update',

    // Invoices — generate and send
    'invoices:create',
    'invoices:read',
    'invoices:send',

    // Inventory — read-only (to check stock)
    'inventory:read',

    // Buy list — read-only (to track what was bought)
    'buylist:read',

    // Basic dashboard
    'dashboard:read',
  ],

  [ROLES.FIELD_STAFF]: [
    // Deliveries — core field workflow
    'deliveries:read',
    'deliveries:update',      // qty adjustment, POD capture
    'deliveries:pod_capture', // signature + photo + geotag

    // Invoices — finalize on-site after delivery
    'invoices:read',
    'invoices:update',        // adjust quantities post-delivery
    'invoices:send',          // send via WhatsApp/SMS after POD

    // Orders — read-only (to see what they're delivering)
    'orders:read',
  ],
};

// ─── AUTHORIZE MIDDLEWARE ─────────────────────────────────────────────────────
/**
 * authorize(...roles)
 * Checks that req.user.role is in the allowed roles list.
 * Must be used AFTER authenticate middleware.
 *
 * Usage on routes:
 *   router.post('/users', authenticate, authorize(ROLES.ADMIN), createUser)
 *   router.get('/orders', authenticate, authorize(ROLES.ADMIN, ROLES.SALES_STAFF), getOrders)
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}`,
      });
    }

    return next();
  };
}

// ─── PERMISSION CHECK ─────────────────────────────────────────────────────────
/**
 * can(role, permission)
 * Programmatic permission check for use inside services/controllers.
 *
 * Example:
 *   if (!can(req.user.role, 'finance:update')) throw AppError.forbidden();
 */
function can(role, permission) {
  return (PERMISSIONS[role] || []).includes(permission);
}

/**
 * requirePermission(permission)
 * Route-level middleware version of can().
 *
 * Usage:
 *   router.get('/finance', authenticate, requirePermission('finance:read'), handler)
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    if (!can(req.user.role, permission)) {
      return res.status(403).json({
        success:    false,
        message:    `Access denied. Missing permission: ${permission}`,
        userRole:   req.user.role,
      });
    }

    return next();
  };
}

module.exports = { authorize, can, requirePermission, PERMISSIONS };
