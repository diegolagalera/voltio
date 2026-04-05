const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

/**
 * Hash a password
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
const hash = async (password) => {
    return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Compare password with hash
 * @param {string} password - Plain text password
 * @param {string} hashedPassword - Bcrypt hash
 * @returns {Promise<boolean>}
 */
const compare = async (password, hashedPassword) => {
    return bcrypt.compare(password, hashedPassword);
};

module.exports = { hash, compare };
