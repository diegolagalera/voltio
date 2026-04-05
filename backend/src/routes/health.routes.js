const router = require('express').Router();

router.get('/', (req, res) => {
    res.json({
        success: true,
        service: 'FPSaver API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

module.exports = router;
