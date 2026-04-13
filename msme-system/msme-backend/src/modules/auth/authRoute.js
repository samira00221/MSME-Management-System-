'use strict';

const express        = require('express');
const authController = require('./authController');
const authenticate   = require('../../middleware/auth');
const { authorize }  = require('../../middleware/roles');
const validate       = require('../../middleware/validate');
const {
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  createUserSchema,
}                    = require('./authValidation');
const { ROLES }      = require('../../database/models/User');

const router = express.Router();

// ─── PUBLIC ROUTES ────────────────────────────────────────────────────────────
router.post('/login',           validate(loginSchema),           authController.login);
router.post('/refresh',                                          authController.refresh);
router.post('/forgot-password', validate(forgotPasswordSchema),  authController.forgotPassword);
router.post('/reset-password',  validate(resetPasswordSchema),   authController.resetPassword);

// ─── AUTHENTICATED ROUTES ─────────────────────────────────────────────────────
router.use(authenticate);  // everything below requires a valid access token

router.get( '/me',              authController.getMe);
router.post('/logout',          authController.logout);
router.post('/change-password', validate(changePasswordSchema),  authController.changePassword);

// ─── ADMIN-ONLY: USER MANAGEMENT ─────────────────────────────────────────────
router.post(
  '/users',
  authorize(ROLES.ADMIN),          // only admins can create users
  validate(createUserSchema),
  authController.createUser
);

module.exports = router;
