/**
 * FPSaver — AI Chatbot Controller
 */

const chatbotService = require('../services/chatbot.service');

/**
 * POST /api/chatbot/:factoryId
 * Body: { messages: [{ role: 'user'|'assistant', content: string }] }
 */
const chat = async (req, res) => {
    try {
        const { factoryId } = req.params;
        const { messages } = req.body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Messages array is required and must not be empty',
            });
        }

        // Validate message format
        for (const msg of messages) {
            if (!msg.role || !msg.content) {
                return res.status(400).json({
                    success: false,
                    message: 'Each message must have role and content',
                });
            }
            if (!['user', 'assistant'].includes(msg.role)) {
                return res.status(400).json({
                    success: false,
                    message: 'Message role must be "user" or "assistant"',
                });
            }
        }

        // Limit conversation length to prevent token abuse
        const trimmedMessages = messages.slice(-20);

        const result = await chatbotService.chat(factoryId, trimmedMessages, req.user.id);

        return res.json({
            success: true,
            data: result,
        });
    } catch (err) {
        console.error('[Chatbot] Error:', err.message);

        if (err.message === 'OPENAI_API_KEY not configured') {
            return res.status(503).json({
                success: false,
                message: 'AI service not configured. Contact administrator.',
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Error processing AI request',
        });
    }
};

/**
 * POST /api/chatbot/:factoryId/tts
 * Body: { text: string }
 * Returns: audio/mpeg binary
 */
const textToSpeech = async (req, res) => {
    try {
        const { text } = req.body;

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Text is required',
            });
        }

        const audioBuffer = await chatbotService.textToSpeech(text.trim());

        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioBuffer.length,
            'Cache-Control': 'no-cache',
        });

        return res.send(audioBuffer);
    } catch (err) {
        console.error('[Chatbot TTS] Error:', err.message);

        if (err.message === 'OPENAI_API_KEY not configured') {
            return res.status(503).json({
                success: false,
                message: 'AI service not configured.',
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Error generating speech',
        });
    }
};

module.exports = { chat, textToSpeech };
