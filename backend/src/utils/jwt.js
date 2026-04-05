const jwt = require('jsonwebtoken');
const config = require('../config/env');

/**
 * Generate an access token
 * @param {object} payload - { userId, role, companyId }
 * @returns {string} JWT token
 */
const generateAccessToken = (payload) => {
    return jwt.sign(payload, config.jwt.accessSecret, {
        expiresIn: config.jwt.accessExpiry,
    });
};

/**
 * Generate a refresh token
 * @param {object} payload - { userId, jti }
 * @returns {string} JWT token
 */
const generateRefreshToken = (payload) => {
    return jwt.sign(payload, config.jwt.refreshSecret, {
        expiresIn: config.jwt.refreshExpiry,
    });
};

/**
 * Verify an access token
 * @param {string} token
 * @returns {object} Decoded payload
 */
const verifyAccessToken = (token) => {
    return jwt.verify(token, config.jwt.accessSecret);
};

/**
 * Verify a refresh token
 * @param {string} token
 * @returns {object} Decoded payload
 */
const verifyRefreshToken = (token) => {
    return jwt.verify(token, config.jwt.refreshSecret);
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
};
