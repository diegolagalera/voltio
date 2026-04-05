import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/services/api.js'

export const useFactoryStore = defineStore('factory', () => {
    const factories = ref([])
    const currentFactory = ref(null)
    const devices = ref([])
    const loading = ref(false)

    // Persisted selected factory ID
    const selectedFactoryId = ref(localStorage.getItem('fpsaver_selected_factory') || null)

    const selectedFactory = computed(() =>
        factories.value.find(f => f.id === selectedFactoryId.value) || null
    )

    const setSelectedFactory = (factoryId) => {
        selectedFactoryId.value = factoryId
        if (factoryId) {
            localStorage.setItem('fpsaver_selected_factory', factoryId)
        } else {
            localStorage.removeItem('fpsaver_selected_factory')
        }
    }

    const fetchFactories = async () => {
        loading.value = true
        try {
            const response = await api.get('/company/factories')
            factories.value = response.data.data

            // Auto-select first factory if none selected or invalid
            if (factories.value.length > 0) {
                const validSelection = factories.value.some(f => f.id === selectedFactoryId.value)
                if (!validSelection) {
                    setSelectedFactory(factories.value[0].id)
                }
            }
        } finally {
            loading.value = false
        }
    }

    const fetchFactory = async (factoryId) => {
        loading.value = true
        try {
            const response = await api.get(`/factories/${factoryId}`)
            currentFactory.value = response.data.data
            return response.data.data
        } finally {
            loading.value = false
        }
    }

    const fetchDevices = async (factoryId) => {
        const response = await api.get(`/factories/${factoryId}/devices`)
        devices.value = response.data.data
        return response.data.data
    }

    return {
        factories,
        currentFactory,
        devices,
        loading,
        selectedFactoryId,
        selectedFactory,
        setSelectedFactory,
        fetchFactories,
        fetchFactory,
        fetchDevices,
    }
})
