'use strict';

const authService            = require('./authService');
const { successResponse }    = require('../../utils/response');
const { refreshCookieOptions } = require('../../utils/jwt');

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const { user, accessToken, refreshToken } = await authService.login(email, password);

    // Refresh token travels in an HttpOnly cookie — never exposed to JS
    res.cookie('refreshToken', refreshToken, refreshCookieOptions());

    return successResponse(res, { user, accessToken }, 'Login successful');
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
async function refresh(req, res, next) {
  try {
    const incomingToken = req.cookies?.refreshToken;
    if (!incomingToken) {
      return res.status(401).json({ success: false, message: 'No refresh token provided' });
    }

    const { accessToken, refreshToken } = await authService.refreshAccessToken(incomingToken);

    res.cookie('refreshToken', refreshToken, refreshCookieOptions());
    return successResponse(res, { accessToken }, 'Token refreshed');
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
async function logout(req, res, next) {
  try {
    await authService.logout(req.user.sub);

    res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
    return successResponse(res, null, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
async function forgotPassword(req, res, next) {
  try {
    const result = await authService.forgotPassword(req.body.email);

    // TODO: if result, call notificationService to send reset email/WhatsApp
    // e.g. await notificationService.sendPasswordReset(result.user, result.token);

    // Always 200 — do not reveal if email exists
    return successResponse(
      res,
      null,
      'If that email is registered, a reset link has been sent.'
    );
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body;
    await authService.resetPassword(token, newPassword);
    return successResponse(res, null, 'Password reset successfully. Please log in.');
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/change-password  (authenticated) ─────────────────────────
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(req.user.sub, currentPassword, newPassword);
    return successResponse(res, null, 'Password changed. You have been logged out of all devices.');
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/users  (admin only — handled by roleMiddleware on route) ──
async function createUser(req, res, next) {
  try {
    const user = await authService.createUser(req.body, req.user.sub);
    return successResponse(res, { user }, 'User created successfully', 201);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/auth/me  (authenticated) ───────────────────────────────────────
async function getMe(req, res) {
  // req.user is already the safe payload from access token
  return successResponse(res, { user: req.user }, 'Profile fetched');
}

module.exports = {
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  createUser,
  getMe,
};
