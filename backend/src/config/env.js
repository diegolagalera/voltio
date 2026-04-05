require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

module.exports = {
  port: process.env.BACKEND_PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'fpsaver',
    user: process.env.POSTGRES_USER || 'fpsaver_admin',
    password: process.env.POSTGRES_PASSWORD || 'fpsaver_secret_2026',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '1h',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  mqtt: {
    host: process.env.MQTT_HOST || 'localhost',
    port: parseInt(process.env.MQTT_PORT || '1883'),
  },

  superadmin: {
    email: process.env.SUPERADMIN_EMAIL || 'admin@fpsaver.com',
    password: process.env.SUPERADMIN_PASSWORD || 'SuperAdmin2026!',
  },

  esios: {
    apiKey: process.env.ESIOS_API_KEY || '',
    baseUrl: process.env.ESIOS_BASE_URL || 'https://api.esios.ree.es',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },
};
