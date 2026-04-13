'use strict';

const { verifyAccessToken } = require('../utils/jwt');

/**
 * authenticate
 * Verifies the Bearer access token from the Authorization header.
 * Attaches the decoded payload to req.user on success.
 *
 * req.user shape: { sub, email, role, iat, exp }
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access token missing or malformed',
    });
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      message: isExpired ? 'Access token expired' : 'Invalid access token',
      code:    isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    });
  }
}

module.exports = authenticate;
