'use strict';

const { User, ROLES }      = require('../../database/models/User');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  compareToken,
  generateOpaqueToken,
  buildTokenPayload,
}                          = require('../../utils/jwt');
const { AppError }         = require('../../utils/response');
const { Op }               = require('sequelize');

// ─── LOGIN ────────────────────────────────────────────────────────────────────
async function login(email, password) {
  const user = await User.findOne({ where: { email: email.toLowerCase() } });

  if (!user || !(await user.comparePassword(password))) {
    throw AppError.unauthorized('Invalid email or password');
  }

  if (!user.isActive) {
    throw AppError.forbidden('Your account has been deactivated. Contact an administrator.');
  }

  const payload      = buildTokenPayload(user);
  const accessToken  = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  // Store hashed refresh token for rotation validation
  user.refreshTokenHash = await hashToken(refreshToken);
  user.lastLoginAt      = new Date();
  await user.save();

  return { user: user.toSafeJSON(), accessToken, refreshToken };
}

// ─── REFRESH TOKEN ────────────────────────────────────────────────────────────
async function refreshAccessToken(incomingRefreshToken) {
  let decoded;
  try {
    decoded = verifyRefreshToken(incomingRefreshToken);
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }

  const user = await User.findByPk(decoded.sub);
  if (!user || !user.isActive) {
    throw AppError.unauthorized('User not found or inactive');
  }

  if (!user.refreshTokenHash) {
    throw AppError.unauthorized('Refresh token has been revoked');
  }

  const tokenMatches = await compareToken(incomingRefreshToken, user.refreshTokenHash);
  if (!tokenMatches) {
    // Token reuse detected — revoke all sessions
    user.refreshTokenHash = null;
    await user.save();
    throw AppError.unauthorized('Refresh token reuse detected. Please log in again.');
  }

  // Rotate: issue new pair
  const payload         = buildTokenPayload(user);
  const newAccessToken  = signAccessToken(payload);
  const newRefreshToken = signRefreshToken(payload);

  user.refreshTokenHash = await hashToken(newRefreshToken);
  await user.save();

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
async function logout(userId) {
  await User.update(
    { refreshTokenHash: null },
    { where: { id: userId } }
  );
}

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
async function forgotPassword(email) {
  const user = await User.findOne({ where: { email: email.toLowerCase() } });

  // Always return success — don't leak whether email exists
  if (!user || !user.isActive) return null;

  const token  = generateOpaqueToken();
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  user.resetPasswordToken  = token;
  user.resetPasswordExpiry = expiry;
  await user.save();

  return { user, token };
}

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
async function resetPassword(token, newPassword) {
  const user = await User.findOne({
    where: {
      resetPasswordToken:  token,
      resetPasswordExpiry: { [Op.gt]: new Date() },
      isActive:            true,
    },
  });

  if (!user) {
    throw AppError.badRequest('Reset token is invalid or has expired');
  }

  user.passwordHash        = newPassword; // beforeUpdate hook will hash it
  user.resetPasswordToken  = null;
  user.resetPasswordExpiry = null;
  user.refreshTokenHash    = null;        // force re-login everywhere
  await user.save();
}

// ─── CHANGE PASSWORD (authenticated) ─────────────────────────────────────────
async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findByPk(userId);
  if (!user) throw AppError.notFound('User not found');

  const valid = await user.comparePassword(currentPassword);
  if (!valid) throw AppError.unauthorized('Current password is incorrect');

  user.passwordHash     = newPassword; // hook hashes
  user.refreshTokenHash = null;        // invalidate all sessions
  await user.save();
}

// ─── ADMIN: CREATE USER ───────────────────────────────────────────────────────
// Only admins can create users — no open self-registration
async function createUser({ firstName, lastName, email, phone, password, role }, createdBy) {
  const existing = await User.findOne({ where: { email: email.toLowerCase() } });
  if (existing) throw AppError.conflict('A user with this email already exists');

  const allowedRoles = Object.values(ROLES);
  if (!allowedRoles.includes(role)) {
    throw AppError.badRequest(`Invalid role. Must be one of: ${allowedRoles.join(', ')}`);
  }

  const user = await User.create({
    firstName,
    lastName,
    email:        email.toLowerCase(),
    phone:        phone || null,
    passwordHash: password, // beforeCreate hook hashes it
    role,
    createdBy,
  });

  return user.toSafeJSON();
}

module.exports = {
  login,
  refreshAccessToken,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  createUser,
};
