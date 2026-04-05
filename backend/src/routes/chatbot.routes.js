/**
 * FPSaver — AI Chatbot Routes
 * 
 * POST /api/chatbot/:factoryId — Send a chat message (authenticated + tenant-scoped)
 */

const router = require('express').Router();
const ctrl = require('../controllers/chatbot.controller');
const auth = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');

// All chatbot routes require authentication + factory access
router.use(auth);

// Chat with AI about a specific factory
router.post('/:factoryId', tenantGuard, ctrl.chat);

// Text-to-Speech for voice mode
router.post('/:factoryId/tts', tenantGuard, ctrl.textToSpeech);

module.exports = router;
