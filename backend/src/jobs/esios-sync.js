/**
 * FPSaver — ESIOS Price Sync Job
 * Runs nightly at 21:00 CET to fetch next-day electricity prices
 * Also backfills missing days on startup
 */

const esiosService = require('../services/esios.service');

let syncInterval = null;

/**
 * Start the ESIOS sync scheduler
 */
const startSync = async () => {
    console.log('[ESIOS-SYNC] Initializing...');

    // Backfill any missing days on startup
    try {
        await esiosService.backfillMissingDays(7);
        console.log('[ESIOS-SYNC] Backfill complete');
    } catch (err) {
        console.error('[ESIOS-SYNC] Backfill error:', err.message);
    }

    // Schedule: check every hour, sync if it's 21:00 CET
    syncInterval = setInterval(async () => {
        const now = new Date();
        // Convert to CET (UTC+1 or UTC+2 in summer)
        const cetHour = now.toLocaleString('en-US', {
            hour: 'numeric', hour12: false, timeZone: 'Europe/Madrid'
        });

        if (parseInt(cetHour) === 21) {
            console.log('[ESIOS-SYNC] Running nightly sync...');
            try {
                // Fetch tomorrow's prices
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const dateStr = tomorrow.toISOString().split('T')[0];
                await esiosService.syncPricesForDate(dateStr);

                // Also sync today if missing
                const todayStr = now.toISOString().split('T')[0];
                await esiosService.syncPricesForDate(todayStr);

                console.log('[ESIOS-SYNC] Nightly sync complete');
            } catch (err) {
                console.error('[ESIOS-SYNC] Nightly sync error:', err.message);
            }
        }
    }, 3600000); // Check every hour

    console.log('[ESIOS-SYNC] Scheduler started (nightly at 21:00 CET)');
};

/**
 * Stop the sync scheduler
 */
const stopSync = () => {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('[ESIOS-SYNC] Scheduler stopped');
    }
};

module.exports = { startSync, stopSync };
