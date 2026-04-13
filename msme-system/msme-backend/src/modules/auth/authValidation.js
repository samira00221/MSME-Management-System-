'use strict';

const Joi = require('joi');

const passwordRules = Joi.string()
  .min(8)
  .max(72) // bcrypt truncates at 72 bytes
  .pattern(/[A-Z]/, 'uppercase')
  .pattern(/[0-9]/, 'number')
  .messages({
    'string.min':     'Password must be at least 8 characters',
    'string.pattern.name': 'Password must contain at least one {{#name}}',
  });

const loginSchema = Joi.object({
  email:    Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
});

const resetPasswordSchema = Joi.object({
  token:       Joi.string().length(64).required(), // 32 bytes hex = 64 chars
  newPassword: passwordRules.required(),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword:     passwordRules.required(),
});

const createUserSchema = Joi.object({
  firstName: Joi.string().min(2).max(80).required(),
  lastName:  Joi.string().min(2).max(80).required(),
  email:     Joi.string().email().lowercase().required(),
  phone:     Joi.string().pattern(/^\+?[0-9\s\-]{7,20}$/).optional(),
  password:  passwordRules.required(),
  role:      Joi.string().valid('admin', 'sales_staff', 'field_staff').required(),
});

module.exports = {
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  createUserSchema,
};
