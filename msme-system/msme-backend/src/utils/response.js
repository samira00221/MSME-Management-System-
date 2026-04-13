'use strict';

// ─── RESPONSE HELPERS ─────────────────────────────────────────────────────────

function successResponse(res, data, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

function errorResponse(res, message = 'An error occurred', statusCode = 500, errors = null) {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
}

// ─── CUSTOM ERROR CLASS ───────────────────────────────────────────────────────
// Throw this anywhere in the app — the global error handler catches it

class AppError extends Error {
  constructor(message, statusCode = 500, errors = null) {
    super(message);
    this.name        = 'AppError';
    this.statusCode  = statusCode;
    this.errors      = errors;
    this.isOperational = true;  // distinguishes from unexpected crashes
    Error.captureStackTrace(this, this.constructor);
  }
}

// Convenience factories
AppError.badRequest    = (msg, errors) => new AppError(msg, 400, errors);
AppError.unauthorized  = (msg = 'Unauthorized')        => new AppError(msg, 401);
AppError.forbidden     = (msg = 'Access denied')       => new AppError(msg, 403);
AppError.notFound      = (msg = 'Resource not found')  => new AppError(msg, 404);
AppError.conflict      = (msg)                         => new AppError(msg, 409);
AppError.internal      = (msg = 'Internal server error') => new AppError(msg, 500);

module.exports = { successResponse, errorResponse, AppError };
