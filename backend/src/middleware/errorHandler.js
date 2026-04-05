/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, _next) => {
    console.error('[ERROR]', {
        message: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        userId: req.user?.id,
    });

    // Joi validation errors
    if (err.isJoi) {
        return res.status(400).json({
            success: false,
            message: 'Validation error',
            errors: err.details.map((d) => ({
                field: d.path.join('.'),
                message: d.message,
            })),
        });
    }

    // PostgreSQL errors
    if (err.code) {
        // Foreign key violation
        if (err.code === '23503') {
            return res.status(409).json({
                success: false,
                message: 'Referenced resource not found',
            });
        }
        // Unique violation
        if (err.code === '23505') {
            return res.status(409).json({
                success: false,
                message: 'Resource already exists',
                detail: err.detail,
            });
        }
    }

    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        success: false,
        message: statusCode === 500 ? 'Internal server error' : err.message,
    });
};

module.exports = errorHandler;
