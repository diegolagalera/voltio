<template>
  <div class="relative" ref="bellRef">
    <!-- Bell Button -->
    <button
      @click="togglePanel"
      class="relative p-2 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-colors"
      title="Notificaciones"
    >
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      <!-- Badge -->
      <span
        v-if="unreadCount > 0"
        class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-alarm-500 text-white text-[10px] font-bold rounded-full px-1 animate-pulse"
      >
        {{ unreadCount > 99 ? '99+' : unreadCount }}
      </span>
    </button>

    <!-- Dropdown Panel -->
    <Transition name="dropdown">
      <div
        v-if="showPanel"
        class="fixed left-64 top-4 w-[26rem] max-h-[32rem] bg-surface-800 border border-surface-700 rounded-xl shadow-xl shadow-black/30 z-[60] flex flex-col overflow-hidden"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-surface-700">
          <h3 class="text-white font-semibold text-sm">
            Notificaciones
            <span class="text-surface-500 text-xs font-normal ml-1">últimos 7 días</span>
          </h3>
          <div class="flex items-center gap-2">
            <button
              @click="showInfoTooltip = !showInfoTooltip"
              class="p-1 rounded-md transition-colors"
              :class="showInfoTooltip ? 'text-primary-400 bg-surface-700' : 'text-surface-500 hover:text-surface-300'"
              title="¿Cómo funcionan las notificaciones?"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          <button
            v-if="unreadCount > 0"
            @click="markAllRead"
            class="text-primary-400 text-xs hover:text-primary-300 transition-colors flex items-center gap-1"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Marcar todas como leídas
          </button>
          </div>
        </div>

        <!-- Info Tooltip -->
        <Transition name="slide">
          <div v-if="showInfoTooltip" class="px-4 py-2.5 bg-surface-700/60 border-b border-surface-700 text-[11px] text-surface-300 leading-relaxed">
            <div class="flex items-start gap-2">
              <span class="text-primary-400 shrink-0 mt-0.5">ℹ️</span>
              <div>
                <p><span class="text-alarm-400 font-semibold">🔴 Activo</span> — Hay un problema detectado. Se actualiza en cada lectura mientras persista.</p>
                <p class="mt-1"><span class="text-energy-400 font-semibold">✅ Resuelto</span> — El problema se corrigió automáticamente. Si la siguiente lectura (5 min) es correcta, la notificación pasa a resuelta.</p>
                <p class="mt-1 text-surface-400">El puntito <span class="inline-block w-1.5 h-1.5 rounded-full bg-primary-400 align-middle"></span> azul indica que no la has leído aún.</p>
              </div>
            </div>
          </div>
        </Transition>

        <!-- Loading -->
        <div v-if="loading" class="p-6 text-center">
          <span class="text-surface-400 text-sm">Cargando...</span>
        </div>

        <!-- Empty -->
        <div v-else-if="!notifications.length" class="p-8 text-center">
          <span class="text-3xl">🔔</span>
          <p class="text-surface-400 text-sm mt-2">Sin notificaciones en los últimos 7 días</p>
        </div>

        <!-- Notification List -->
        <div v-else class="overflow-y-auto flex-1">
          <div
            v-for="n in notifications"
            :key="n.id"
            class="px-4 py-3 border-b border-surface-700/50 transition-colors"
            :class="{ 'bg-surface-700/20': !n.is_read }"
          >
            <div class="flex items-start gap-3">
              <!-- Status Icon -->
              <div class="mt-0.5 shrink-0">
                <span v-if="n.status === 'active'" class="text-lg">{{ getSeverityIcon(n.severity) }}</span>
                <span v-else class="text-lg">✅</span>
              </div>

              <!-- Content -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <p class="text-sm font-medium truncate" :class="n.is_read ? 'text-surface-300' : 'text-white'">
                    {{ n.title }}
                  </p>
                  <span
                    v-if="!n.is_read"
                    class="w-2 h-2 rounded-full bg-primary-400 shrink-0"
                  ></span>
                </div>
                <p class="text-surface-400 text-xs mt-0.5 line-clamp-2">{{ n.message }}</p>
                <div class="flex items-center gap-3 mt-1.5">
                  <span class="text-surface-500 text-[10px]">{{ formatTime(n.created_at) }}</span>
                  <span v-if="n.status === 'active' && n.occurrence_count > 1" class="text-warning-400 text-[10px] font-medium">
                    {{ n.occurrence_count }} lecturas · {{ getDuration(n.first_seen_at, n.last_seen_at) }}
                  </span>
                  <span v-if="n.status === 'resolved'" class="text-energy-400 text-[10px] font-medium">
                    Resuelto · {{ getDuration(n.first_seen_at, n.resolved_at) }}
                  </span>
                  <!-- Status badge with tooltip -->
                  <span class="relative group">
                    <span
                      class="text-[10px] px-1.5 py-0.5 rounded-full cursor-help"
                      :class="n.status === 'active' ? 'bg-alarm-500/15 text-alarm-400' : 'bg-energy-500/15 text-energy-400'"
                    >
                      {{ n.status === 'active' ? 'Activo' : 'Resuelto' }}
                    </span>
                    <!-- Badge tooltip -->
                    <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 px-2.5 py-1.5 bg-surface-900 border border-surface-600 rounded-lg text-[10px] text-surface-300 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                      <template v-if="n.status === 'active'">
                        Problema detectado. Se actualiza con cada lectura. Si la próxima lectura es correcta, se resolverá automáticamente ✅
                      </template>
                      <template v-else>
                        La lectura volvió a valores normales. El problema se resolvió automáticamente.
                      </template>
                    </span>
                  </span>
                </div>
              </div>

              <!-- Mark as read button -->
              <button
                v-if="!n.is_read"
                @click.stop="markOneRead(n)"
                class="mt-1 shrink-0 p-1 rounded-md text-surface-500 hover:text-primary-400 hover:bg-surface-700 transition-colors"
                title="Marcar como leída"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <span v-else class="mt-1 shrink-0 p-1 text-surface-700">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            </div>
          </div>

          <!-- Load More -->
          <div v-if="hasMore" class="p-3 text-center border-t border-surface-700/50">
            <button
              @click="loadMore"
              :disabled="loadingMore"
              class="text-primary-400 text-xs hover:text-primary-300 transition-colors"
            >
              {{ loadingMore ? 'Cargando...' : 'Cargar más antiguas' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/services/api.js'
import { useWebSocket } from '@/composables/useWebSocket.js'

const route = useRoute()
const { getSocket } = useWebSocket()

const showPanel = ref(false)
const showInfoTooltip = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const notifications = ref([])
const unreadCount = ref(0)
const bellRef = ref(null)
const hasMore = ref(false)
const PAGE_SIZE = 20

// Get factory ID from route
const getFactoryId = () => route.params.factoryId || null

// Fetch unread count
const fetchUnreadCount = async () => {
  const fid = getFactoryId()
  if (!fid) return
  try {
    const res = await api.get(`/factories/${fid}/notifications/unread-count`)
    unreadCount.value = res.data.data?.count || 0
  } catch (e) { /* ignore */ }
}

// Fetch notifications list (last 7 days, paginated)
const fetchNotifications = async (offset = 0) => {
  const fid = getFactoryId()
  if (!fid) return
  if (offset === 0) loading.value = true
  else loadingMore.value = true
  try {
    const res = await api.get(`/factories/${fid}/notifications?limit=${PAGE_SIZE}&offset=${offset}`)
    const data = res.data.data || []
    if (offset === 0) {
      notifications.value = data
    } else {
      notifications.value.push(...data)
    }
    hasMore.value = data.length === PAGE_SIZE
  } catch (e) {
    if (offset === 0) notifications.value = []
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

// Toggle panel
const togglePanel = async () => {
  showPanel.value = !showPanel.value
  if (showPanel.value) {
    await fetchNotifications(0)
  }
}

// Load more (pagination)
const loadMore = async () => {
  await fetchNotifications(notifications.value.length)
}

// Mark single notification as read
const markOneRead = async (n) => {
  try {
    await api.put(`/notifications/${n.id}/read`)
    n.is_read = true
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  } catch (e) { /* ignore */ }
}

// Mark all as read
const markAllRead = async () => {
  const fid = getFactoryId()
  if (!fid) return
  try {
    await api.put(`/factories/${fid}/notifications/read-all`)
    notifications.value.forEach(n => { n.is_read = true })
    unreadCount.value = 0
  } catch (e) { /* ignore */ }
}

// Severity icon
const getSeverityIcon = (severity) => {
  switch (severity) {
    case 'critical': return '🔴'
    case 'warning': return '🟡'
    default: return 'ℹ️'
  }
}

// Format relative time
const formatTime = (ts) => {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `hace ${days}d`
}

// Format duration between two timestamps
const getDuration = (from, to) => {
  if (!from || !to) return ''
  const diff = new Date(to).getTime() - new Date(from).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}

// Close on outside click
const onClickOutside = (e) => {
  if (bellRef.value && !bellRef.value.contains(e.target)) {
    showPanel.value = false
  }
}

// WebSocket listener for real-time notifications
const onNotificationUpdate = (payload) => {
  if (payload.type === 'new') {
    notifications.value.unshift(payload.notification)
    unreadCount.value++
  } else if (payload.type === 'resolved') {
    const idx = notifications.value.findIndex(n => n.id === payload.notification.id)
    if (idx >= 0) {
      notifications.value[idx] = payload.notification
    } else {
      notifications.value.unshift(payload.notification)
    }
    unreadCount.value++
  } else if (payload.type === 'updated') {
    const idx = notifications.value.findIndex(n => n.id === payload.notification.id)
    if (idx >= 0) {
      const wasRead = notifications.value[idx].is_read
      notifications.value[idx] = payload.notification
      if (wasRead && !payload.notification.is_read) {
        unreadCount.value++
      }
    }
    fetchUnreadCount()
  }
}

let countInterval = null

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  fetchUnreadCount()
  countInterval = setInterval(fetchUnreadCount, 60000)

  const sock = getSocket()
  if (sock) {
    sock.on('notification:update', onNotificationUpdate)
  }
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside)
  if (countInterval) clearInterval(countInterval)
  const sock = getSocket()
  if (sock) {
    sock.off('notification:update', onNotificationUpdate)
  }
})
</script>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.95);
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  overflow: hidden;
}
.slide-enter-to,
.slide-leave-from {
  max-height: 200px;
}
</style>
