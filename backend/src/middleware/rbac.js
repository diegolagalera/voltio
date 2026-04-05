/**
 * Role-Based Access Control middleware factory
 * Usage: requireRole('superadmin', 'manager')
 *
 * @param  {...string} allowedRoles - Roles that can access this route
 * @returns {Function} Express middleware
 */
const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions',
                required: allowedRoles,
                current: req.user.role,
            });
        }

        next();
    };
};

module.exports = { requireRole };
