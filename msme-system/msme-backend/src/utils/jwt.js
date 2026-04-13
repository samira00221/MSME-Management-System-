'use strict';

const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');

const {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRY  = '15m',
  JWT_REFRESH_EXPIRY = '7d',
} = process.env;

// ─── ACCESS TOKEN ─────────────────────────────────────────────────────────────
// Short-lived (15 min). Carries role for RBAC checks in middleware.
// ─────────────────────────────────────────────────────────────────────────────
function signAccessToken(payload) {
  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRY,
    issuer:    'msme-system',
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, JWT_ACCESS_SECRET, { issuer: 'msme-system' });
}

// ─── REFRESH TOKEN ────────────────────────────────────────────────────────────
// Long-lived (7 days). Only the hash is stored in DB (rotation + revocation).
// ─────────────────────────────────────────────────────────────────────────────
function signRefreshToken(payload) {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRY,
    issuer:    'msme-system',
  });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET, { issuer: 'msme-system' });
}

// Hash refresh token before storing — DB never holds the raw token
async function hashToken(token) {
  return bcrypt.hash(token, 10);
}

async function compareToken(token, hash) {
  return bcrypt.compare(token, hash);
}

// Opaque token for password-reset links
function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Build the standard payload stored inside both token types
function buildTokenPayload(user) {
  return {
    sub:   user.id,
    email: user.email,
    role:  user.role,
  };
}

// Cookie config — HttpOnly, Secure in prod, SameSite=Strict
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in ms
    path:     '/api/auth/refresh',       // scoped — only sent on refresh endpoint
  };
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  compareToken,
  generateOpaqueToken,
  buildTokenPayload,
  refreshCookieOptions,
};
