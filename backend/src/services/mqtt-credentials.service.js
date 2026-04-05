/**
 * FPSaver — MQTT Credentials Service
 * Manages per-factory MQTT authentication: username/password generation,
 * encryption, and Mosquitto file synchronization.
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

// Encryption key from env (32 bytes for AES-256)
const ENCRYPTION_KEY = process.env.MQTT_ENCRYPTION_KEY || 'fpsaver-mqtt-default-key-change!';
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// Paths
const MOSQUITTO_CONFIG_DIR = process.env.MOSQUITTO_CONFIG_DIR || path.join(__dirname, '..', '..', '..', 'mosquitto', 'config');
const PASSWORD_FILE = path.join(MOSQUITTO_CONFIG_DIR, 'password_file');
const ACL_FILE = path.join(MOSQUITTO_CONFIG_DIR, 'acl_file');

/**
 * Encrypt a plaintext password (AES-256-CBC) so it can be recovered for display
 */
function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt a password for display
 */
function decrypt(encryptedText) {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Generate a random MQTT password (16 chars, alphanumeric)
 */
function generatePassword() {
    return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

/**
 * Generate MQTT credentials for a factory
 */
async function generateCredentials(factoryId) {
    const username = 'fac_' + factoryId.substring(0, 8);
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const passwordEncrypted = encrypt(password);

    // Store in DB
    await db.query(
        `UPDATE factories 
         SET mqtt_username = $1, mqtt_password_hash = $2, mqtt_password_encrypted = $3,
             mqtt_topic = $4
         WHERE id = $5`,
        [username, passwordHash, passwordEncrypted, `factory/${factoryId}`, factoryId]
    );

    // Sync Mosquitto files
    await syncMosquittoFiles();

    return { username, password, topic: `factory/${factoryId}` };
}

/**
 * Regenerate MQTT password for a factory (rotate)
 */
async function regenerateCredentials(factoryId) {
    const result = await db.query('SELECT mqtt_username FROM factories WHERE id = $1', [factoryId]);
    if (result.rows.length === 0) throw new Error('Factory not found');

    const username = result.rows[0].mqtt_username;
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const passwordEncrypted = encrypt(password);

    await db.query(
        `UPDATE factories 
         SET mqtt_password_hash = $1, mqtt_password_encrypted = $2
         WHERE id = $3`,
        [passwordHash, passwordEncrypted, factoryId]
    );

    await syncMosquittoFiles();

    return { username, password, topic: `factory/${factoryId}` };
}

/**
 * Get decrypted MQTT credentials for display
 */
async function getCredentials(factoryId) {
    const result = await db.query(
        `SELECT id, mqtt_username, mqtt_password_encrypted, mqtt_topic 
         FROM factories WHERE id = $1`,
        [factoryId]
    );

    if (result.rows.length === 0) throw new Error('Factory not found');
    const factory = result.rows[0];

    if (!factory.mqtt_password_encrypted) {
        // No credentials yet — generate them
        return await generateCredentials(factoryId);
    }

    return {
        username: factory.mqtt_username,
        password: decrypt(factory.mqtt_password_encrypted),
        topic: factory.mqtt_topic || `factory/${factoryId}`,
    };
}

/**
 * Regenerate Mosquitto password_file and acl_file from DB,
 * then signal Mosquitto to reload config.
 */
async function syncMosquittoFiles() {
    try {
        // Get all factories with MQTT credentials
        const result = await db.query(
            `SELECT id, mqtt_username, mqtt_password_encrypted, mqtt_topic 
             FROM factories 
             WHERE mqtt_username IS NOT NULL AND mqtt_password_encrypted IS NOT NULL AND is_active = true`
        );

        // --- Password File ---
        // We need plaintext passwords for mosquitto_passwd format
        // Write a temp file, then use mosquitto_passwd to hash them
        let passwordContent = '';
        const backendPassword = process.env.MQTT_BACKEND_PASSWORD || 'backend_service_pass';

        // First write plaintext entries
        const tempFile = PASSWORD_FILE + '.tmp';
        let entries = [`backend_service:${backendPassword}`];

        for (const factory of result.rows) {
            try {
                const pass = decrypt(factory.mqtt_password_encrypted);
                entries.push(`${factory.mqtt_username}:${pass}`);
            } catch (e) {
                console.error(`[MQTT-Creds] Error decrypting password for ${factory.mqtt_username}:`, e.message);
            }
        }

        fs.writeFileSync(tempFile, entries.join('\n') + '\n');

        // Use mosquitto_passwd to convert to hashed format
        try {
            execSync(`mosquitto_passwd -U "${tempFile}"`, { timeout: 5000 });
            fs.renameSync(tempFile, PASSWORD_FILE);
        } catch (e) {
            // mosquitto_passwd not available locally — write plaintext
            // (works in Docker where Mosquitto can read it)
            // Fallback: write the entries directly — Mosquitto 2.x can hash on load
            console.warn('[MQTT-Creds] mosquitto_passwd not found, writing plaintext password file');
            fs.writeFileSync(PASSWORD_FILE, entries.join('\n') + '\n');
            try { fs.unlinkSync(tempFile); } catch (_) { }
        }

        // --- ACL File ---
        let aclContent = `# ============================================
# FPSaver MQTT ACL Configuration
# Auto-generated — do not edit manually
# ============================================

# Backend service — full access
user backend_service
topic readwrite #

`;

        for (const factory of result.rows) {
            const factoryId = factory.id;
            aclContent += `# Factory: ${factoryId}\n`;
            aclContent += `user ${factory.mqtt_username}\n`;
            aclContent += `topic write factory/${factoryId}/telemetry\n`;
            aclContent += `topic write factory/${factoryId}/realtime\n`;
            aclContent += `topic write factory/${factoryId}/status\n`;
            aclContent += `topic write factory/${factoryId}/discovery\n`;
            aclContent += `topic read factory/${factoryId}/commands\n`;
            aclContent += `topic read factory/${factoryId}/ack\n\n`;
        }

        fs.writeFileSync(ACL_FILE, aclContent);

        // Signal Mosquitto to reload (send SIGHUP to Docker container)
        try {
            execSync('docker kill --signal=SIGHUP fpsaver_mosquitto 2>/dev/null', { timeout: 5000 });
            console.log('[MQTT-Creds] Mosquitto config reloaded (SIGHUP)');
        } catch (e) {
            console.warn('[MQTT-Creds] Could not signal Mosquitto (may need manual restart)');
        }

        console.log(`[MQTT-Creds] Synced ${result.rows.length} factory credentials`);
    } catch (err) {
        console.error('[MQTT-Creds] Error syncing Mosquitto files:', err.message);
        throw err;
    }
}

module.exports = {
    generateCredentials,
    regenerateCredentials,
    getCredentials,
    syncMosquittoFiles,
};
