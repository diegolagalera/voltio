import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/services/api.js'

export const useTelemetryStore = defineStore('telemetry', () => {
    const realtimeData = ref({}) // { deviceId: { ...data } }
    const historyData = ref([])
    const factorySummary = ref(null)
    const loading = ref(false)

    const fetchLatest = async (deviceId) => {
        const response = await api.get(`/telemetry/${deviceId}/latest`)
        if (response.data.data) {
            realtimeData.value[deviceId] = response.data.data
        }
        return response.data.data
    }

    const fetchHistory = async (deviceId, params) => {
        loading.value = true
        try {
            const response = await api.get(`/telemetry/${deviceId}/history`, { params })
            historyData.value = response.data.data
            return response.data.data
        } finally {
            loading.value = false
        }
    }

    const fetchFactorySummary = async (factoryId) => {
        loading.value = true
        try {
            const response = await api.get(`/telemetry/factory/${factoryId}/summary`)
            factorySummary.value = response.data.data
            return response.data.data
        } finally {
            loading.value = false
        }
    }

    /**
     * Timestamp of the last WebSocket telemetry data received.
     * Used by the UI to determine if RPi is actually sending data.
     */
    const lastRealtimeReceived = ref(null)

    /**
     * Update realtime data from WebSocket
     */
    const updateRealtime = (readings) => {
        for (const reading of readings) {
            realtimeData.value[reading.device_id] = {
                data: reading.data,
                last_updated: reading.timestamp,
                device_type: reading.device_type,
            }
        }
        lastRealtimeReceived.value = Date.now()
    }

    return {
        realtimeData,
        historyData,
        factorySummary,
        loading,
        lastRealtimeReceived,
        fetchLatest,
        fetchHistory,
        fetchFactorySummary,
        updateRealtime,
    }
})
