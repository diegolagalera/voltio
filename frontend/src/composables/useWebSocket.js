import { ref, onUnmounted } from 'vue'
import { io } from 'socket.io-client'
import { useTelemetryStore } from '@/stores/telemetry.store.js'

const WS_URL = import.meta.env.VITE_WS_URL || window.location.origin

let socket = null
const connected = ref(false)

/**
 * WebSocket composable for real-time telemetry
 */
export function useWebSocket() {
    const telemetryStore = useTelemetryStore()

    const connect = () => {
        if (socket?.connected) return

        socket = io(WS_URL, {
            transports: ['websocket', 'polling'],
        })

        socket.on('connect', () => {
            connected.value = true
            console.log('[WS] Connected:', socket.id)
        })

        socket.on('disconnect', () => {
            connected.value = false
            console.log('[WS] Disconnected')
        })

        // Listen for real-time telemetry
        socket.on('telemetry:realtime', (readings) => {
            telemetryStore.updateRealtime(Array.isArray(readings) ? readings : [readings])
        })

        // Listen for new alarms
        socket.on('alarm:new', (alarm) => {
            console.log('[WS] New alarm:', alarm)
            // Could integrate with an alarm store or notification system
        })
    }

    const joinFactory = (factoryId) => {
        if (!socket?.connected) connect()
        socket.emit('join:factory', factoryId)
        console.log('[WS] Joining factory:', factoryId)
    }

    const leaveFactory = (factoryId) => {
        if (socket?.connected) {
            socket.emit('leave:factory', factoryId)
            console.log('[WS] Leaving factory:', factoryId)
        }
    }

    const disconnect = () => {
        if (socket) {
            socket.disconnect()
            socket = null
            connected.value = false
        }
    }

    // Auto-cleanup on component unmount
    onUnmounted(() => {
        // Note: don't disconnect here, just clean up listeners if needed
    })

    return {
        connected,
        connect,
        disconnect,
        joinFactory,
        leaveFactory,
        getSocket: () => socket,
    }
}
