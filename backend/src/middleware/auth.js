const { verifyAccessToken } = require('../utils/jwt');
const db = require('../config/database');

/**
 * Authentication middleware
 * Verifies JWT access token and attaches user info to req.user
 */
const auth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Access token required',
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = verifyAccessToken(token);

        // Fetch fresh user data to ensure account is still active
        const result = await db.query(
            'SELECT id, company_id, email, first_name, last_name, role, is_active FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'User not found',
            });
        }

        const user = result.rows[0];
        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                message: 'Account deactivated',
            });
        }

        req.user = {
            id: user.id,
            companyId: user.company_id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
        };

        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired',
                code: 'TOKEN_EXPIRED',
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Invalid token',
        });
    }
};

module.exports = auth;
