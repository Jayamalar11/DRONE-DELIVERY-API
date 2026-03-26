/**
 * Lightweight request-body validator.
 *
 * Usage:
 *   validate({ required: ['field'], types: { field: 'number' }, oneOf: { status: ['a','b'] } })
 */
function validate({ required = [], types = {}, oneOf = {} } = {}) {
  return (req, res, next) => {
    const body = req.body || {};
    const errors = [];

    for (const field of required) {
      if (body[field] === undefined || body[field] === null) {
        errors.push(`'${field}' is required`);
      }
    }

    for (const [field, type] of Object.entries(types)) {
      if (body[field] !== undefined && typeof body[field] !== type) {
        errors.push(`'${field}' must be a ${type}`);
      }
    }

    for (const [field, allowed] of Object.entries(oneOf)) {
      if (body[field] !== undefined && !allowed.includes(body[field])) {
        errors.push(`'${field}' must be one of: ${allowed.join(", ")}`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    next();
  };
}

module.exports = { validate };
