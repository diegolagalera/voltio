const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { hash, compare } = require('../utils/password');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');

/**
 * POST /api/auth/login
 */
const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const result = await db.query(
            'SELECT id, company_id, email, password_hash, first_name, last_name, role, is_active FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(403).json({ success: false, message: 'Account deactivated' });
        }

        const isMatch = await compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // Generate tokens
        const accessToken = generateAccessToken({
            userId: user.id,
            role: user.role,
            companyId: user.company_id,
        });

        const jti = uuidv4();
        const refreshToken = generateRefreshToken({ userId: user.id, jti });

        // Store refresh token hash
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

        await db.query(
            `INSERT INTO refresh_tokens (user_id, token_hash, jti, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
            [user.id, tokenHash, jti]
        );

        // Update last login
        await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

        res.json({
            success: true,
            data: {
                accessToken,
                refreshToken,
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    role: user.role,
                    companyId: user.company_id,
                },
            },
        });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/auth/refresh
 */
const refresh = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        // Verify refresh token
        const decoded = verifyRefreshToken(refreshToken);

        // Check stored token
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

        const result = await db.query(
            'SELECT id, user_id, is_revoked FROM refresh_tokens WHERE jti = $1 AND expires_at > NOW()',
            [decoded.jti]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid refresh token' });
        }

        const storedToken = result.rows[0];

        // ─── Grace Period for Concurrent Requests ───────────────────
        // If the token was already revoked (by a concurrent refresh), check if
        // a new token pair was issued for this user within the last 30 seconds.
        // If so, return that pair instead of failing — this prevents the race
        // condition where parallel 401 retries revoke each other's tokens.
        if (storedToken.is_revoked) {
            const recentToken = await db.query(
                `SELECT id, user_id, jti FROM refresh_tokens
                 WHERE user_id = $1 AND is_revoked = false AND expires_at > NOW()
                 AND created_at > NOW() - INTERVAL '30 seconds'
                 ORDER BY created_at DESC LIMIT 1`,
                [storedToken.user_id]
            );

            if (recentToken.rows.length > 0) {
                // A valid token pair was just issued — reuse it
                const user = await db.query(
                    'SELECT id, company_id, role, is_active FROM users WHERE id = $1',
                    [storedToken.user_id]
                );
                if (user.rows.length === 0 || !user.rows[0].is_active) {
                    return res.status(401).json({ success: false, message: 'User not found or deactivated' });
                }
                const u = user.rows[0];
                const newAccessToken = generateAccessToken({ userId: u.id, role: u.role, companyId: u.company_id });
                const newJti = uuidv4();
                const newRefreshToken = generateRefreshToken({ userId: u.id, jti: newJti });
                const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
                await db.query(
                    `INSERT INTO refresh_tokens (user_id, token_hash, jti, expires_at)
                     VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
                    [u.id, newTokenHash, newJti]
                );
                return res.json({ success: true, data: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
            }

            return res.status(401).json({ success: false, message: 'Refresh token already used' });
        }
        // ────────────────────────────────────────────────────────────

        // Revoke old refresh token
        await db.query('UPDATE refresh_tokens SET is_revoked = true WHERE id = $1', [storedToken.id]);

        // Get user data
        const userResult = await db.query(
            'SELECT id, company_id, role, is_active FROM users WHERE id = $1',
            [storedToken.user_id]
        );

        if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
            return res.status(401).json({ success: false, message: 'User not found or deactivated' });
        }

        const user = userResult.rows[0];

        // Generate new token pair
        const newAccessToken = generateAccessToken({
            userId: user.id,
            role: user.role,
            companyId: user.company_id,
        });

        const newJti = uuidv4();
        const newRefreshToken = generateRefreshToken({ userId: user.id, jti: newJti });
        const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

        await db.query(
            `INSERT INTO refresh_tokens (user_id, token_hash, jti, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
            [user.id, newTokenHash, newJti]
        );

        res.json({
            success: true,
            data: {
                accessToken: newAccessToken,
                refreshToken: newRefreshToken,
            },
        });
    } catch (err) {
        if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Invalid refresh token' });
        }
        next(err);
    }
};

/**
 * POST /api/auth/logout
 */
const logout = async (req, res, next) => {
    try {
        // Revoke all refresh tokens for this user
        await db.query('UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1', [req.user.id]);

        res.json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/auth/me
 */
const me = async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.phone, u.company_id,
              c.name as company_name
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE u.id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = result.rows[0];

        // Get accessible factories
        let factories = [];
        if (user.role === 'manager') {
            const fResult = await db.query(
                'SELECT id, name FROM factories WHERE company_id = $1 AND is_active = true',
                [user.company_id]
            );
            factories = fResult.rows;
        } else if (user.role === 'gerencia' || user.role === 'operador') {
            const fResult = await db.query(
                `SELECT f.id, f.name FROM factories f
         JOIN user_factory_access ufa ON f.id = ufa.factory_id
         WHERE ufa.user_id = $1 AND f.is_active = true`,
                [user.id]
            );
            factories = fResult.rows;
        }

        res.json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                role: user.role,
                phone: user.phone,
                companyId: user.company_id,
                companyName: user.company_name,
                factories,
            },
        });
    } catch (err) {
        next(err);
    }
};

module.exports = { login, refresh, logout, me };
