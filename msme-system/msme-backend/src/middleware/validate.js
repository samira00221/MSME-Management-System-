'use strict';

/**
 * validate(schema)
 * Validates req.body against a Joi schema.
 * Returns 400 with field-level error detail on failure.
 */
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly:   false,  // collect ALL errors, not just first
      stripUnknown: true,   // remove fields not in schema
    });

    if (error) {
      const errors = error.details.map((d) => ({
        field:   d.path.join('.'),
        message: d.message,
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    req.body = value; // use sanitized + coerced value
    return next();
  };
}

module.exports = validate;
