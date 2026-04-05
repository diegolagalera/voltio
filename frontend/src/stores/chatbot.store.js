import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import api from '@/services/api.js'
import { useFactoryStore } from '@/stores/factory.store.js'

export const useChatbotStore = defineStore('chatbot', () => {
    const isOpen = ref(false)
    const messages = ref([])
    const isLoading = ref(false)
    const error = ref(null)

    const factoryStore = useFactoryStore()

    // Toggle chat panel
    const toggle = () => {
        isOpen.value = !isOpen.value
    }

    const open = () => { isOpen.value = true }
    const close = () => { isOpen.value = false }

    // Send a message to the AI
    const sendMessage = async (content) => {
        if (!content.trim() || isLoading.value) return
        
        const factoryId = factoryStore.selectedFactoryId
        if (!factoryId) {
            error.value = 'No hay fábrica seleccionada'
            return
        }

        // Add user message
        messages.value.push({ role: 'user', content: content.trim() })
        error.value = null
        isLoading.value = true

        try {
            // Send conversation history to backend
            const response = await api.post(`/chatbot/${factoryId}`, {
                messages: messages.value.map(m => ({
                    role: m.role,
                    content: m.content,
                })),
            })

            const data = response.data.data

            // Add AI response
            messages.value.push({
                role: 'assistant',
                content: data.message,
                charts: data.charts || [],
                diagrams: data.diagrams || [],
            })
        } catch (err) {
            console.error('[Chatbot] Error:', err)
            const msg = err.response?.data?.message || 'Error al comunicarse con la IA'
            error.value = msg
            // Add error as assistant message
            messages.value.push({
                role: 'assistant',
                content: `⚠️ ${msg}`,
                charts: [],
                isError: true,
            })
        } finally {
            isLoading.value = false
        }
    }

    // Clear conversation
    const clearChat = () => {
        messages.value = []
        error.value = null
    }

    // Reset chat when factory changes
    watch(() => factoryStore.selectedFactoryId, () => {
        clearChat()
    })

    return {
        isOpen,
        messages,
        isLoading,
        error,
        toggle,
        open,
        close,
        sendMessage,
        clearChat,
    }
})
