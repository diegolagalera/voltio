<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-4">
      <div class="flex items-center gap-4">
        <button @click="router.push(`/factory/${factoryId}/production-lines`)"
          class="p-2 rounded-lg bg-surface-800 border border-surface-700 hover:border-surface-500 text-surface-400 hover:text-white transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
            :style="{ backgroundColor: (line?.color || '#8b5cf6') + '20', color: line?.color || '#8b5cf6' }">🏭</div>
          <div>
            <h1 class="text-xl font-bold text-white">{{ line?.name || 'Cargando...' }}</h1>
            <p class="text-surface-500 text-xs">{{ line?.description || 'Sin descripción' }}</p>
          </div>
        </div>
      </div>

      <!-- Date range selector -->
      <div class="flex items-center gap-2 flex-wrap">
        <button v-for="r in ranges" :key="r.value" @click="selectRange(r.value)"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          :class="selectedRange === r.value ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30' : 'bg-surface-800 text-surface-400 border border-surface-700 hover:border-surface-500'">
          {{ r.label }}
        </button>
        <button @click="selectRange('custom')"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          :class="selectedRange === 'custom' ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30' : 'bg-surface-800 text-surface-400 border border-surface-700 hover:border-surface-500'">
          📅 Personalizado
        </button>
        <!-- Custom date inputs -->
        <div v-if="selectedRange === 'custom'" class="flex items-center gap-2">
          <input v-model="customFrom" type="date"
            class="bg-surface-800 border border-surface-700 text-white text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-primary-500 transition-colors" />
          <span class="text-surface-500 text-xs">→</span>
          <input v-model="customTo" type="date"
            class="bg-surface-800 border border-surface-700 text-white text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-primary-500 transition-colors" />
          <button @click="fetchAnalytics()"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600/20 text-primary-400 border border-primary-500/30 hover:bg-primary-600/30 transition-all">
            Aplicar
          </button>
        </div>
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="glass-card p-4">
        <p class="text-surface-500 text-[10px] uppercase tracking-wider font-semibold">Energía Total</p>
        <p class="text-white font-bold text-xl mt-1">{{ summary.total_kwh?.toFixed(1) || '0' }} <span class="text-sm text-surface-400">kWh</span></p>
      </div>
      <div class="glass-card p-4">
        <p class="text-surface-500 text-[10px] uppercase tracking-wider font-semibold">Coste Total</p>
        <p class="text-energy-400 font-bold text-xl mt-1">{{ summary.total_cost?.toFixed(2) || '0.00' }} <span class="text-sm text-surface-400">€</span></p>
      </div>
      <div class="glass-card p-4">
        <p class="text-surface-500 text-[10px] uppercase tracking-wider font-semibold">Potencia Media</p>
        <p class="text-primary-400 font-bold text-xl mt-1">{{ summary.avg_kw?.toFixed(1) || '0' }} <span class="text-sm text-surface-400">kW</span></p>
      </div>
      <div class="glass-card p-4">
        <p class="text-surface-500 text-[10px] uppercase tracking-wider font-semibold">Potencia Pico</p>
        <p class="text-warning-400 font-bold text-xl mt-1">{{ summary.peak_kw?.toFixed(1) || '0' }} <span class="text-sm text-surface-400">kW</span></p>
      </div>
    </div>

    <!-- Timeline Chart -->
    <div class="glass-card p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-white font-semibold">Consumo y Coste</h3>
        <div class="flex gap-2">
          <button v-for="g in ['hour', 'day']" :key="g" @click="groupBy = g"
            class="px-2.5 py-1 rounded-md text-xs transition-all"
            :class="groupBy === g ? 'bg-primary-600/20 text-primary-400' : 'text-surface-500 hover:text-surface-300'">
            {{ g === 'hour' ? 'Horas' : 'Días' }}
          </button>
        </div>
      </div>
      <div ref="timelineChartRef" class="w-full h-[300px]"></div>
    </div>

    <!-- Device Breakdown -->
    <div class="glass-card p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-white font-semibold">Desglose por Dispositivo</h3>
        <span class="text-surface-500 text-xs">{{ breakdown.devices?.length || 0 }} dispositivos</span>
      </div>
      <div v-if="breakdown.devices?.length" class="space-y-3">
        <div v-for="d in breakdown.devices" :key="d.device_id" class="flex items-center gap-4"
          :class="d.parent_in_line ? 'ml-6 border-l-2 border-surface-700 pl-3' : ''">
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2 min-w-0">
                <span v-if="d.parent_in_line" class="text-surface-600 text-[10px]">↳</span>
                <span class="text-white text-sm font-medium truncate">{{ d.device_name }}</span>
                <span v-if="d.phase_channel" class="text-xs px-1.5 py-0.5 rounded bg-surface-700/50 text-surface-400">{{ d.phase_channel }}</span>
                <span v-if="d.parent_relation" class="text-[10px] text-surface-600">{{ d.parent_relation === 'downstream' ? 'downstream' : 'fase' }}</span>
              </div>
              <div class="flex items-center gap-3 text-xs shrink-0">
                <span class="text-surface-400">{{ d.kwh_net.toFixed(1) }} kWh</span>
                <span v-if="d.kwh_gross !== d.kwh_net" class="text-surface-600 text-[10px]">(bruto: {{ d.kwh_gross.toFixed(1) }})</span>
                <span class="text-energy-400 font-semibold">{{ d.cost_net.toFixed(2) }} €</span>
                <span class="text-primary-400 font-bold w-12 text-right">{{ d.pct.toFixed(1) }}%</span>
              </div>
            </div>
            <div class="w-full bg-surface-800 rounded-full h-1.5 overflow-hidden">
              <div class="h-full rounded-full bg-primary-500 transition-all duration-500" :style="{ width: d.pct + '%' }"></div>
            </div>
          </div>
        </div>
      </div>
      <p v-else class="text-surface-500 text-sm text-center py-6">Sin datos para este período</p>
    </div>

    <!-- Device Management -->
    <div class="glass-card p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-white font-semibold">Dispositivos Asignados</h3>
        <button v-if="canManage" @click="showAddDevices = !showAddDevices"
          class="text-primary-400 text-xs hover:text-primary-300 font-semibold flex items-center gap-1">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Añadir dispositivo
        </button>
      </div>

      <!-- Add device panel -->
      <div v-if="showAddDevices" class="mb-4 p-4 bg-surface-700/30 rounded-xl border border-surface-600/50">
        <p class="text-surface-400 text-xs font-semibold uppercase mb-2">Seleccionar dispositivos</p>
        <div class="space-y-1.5 max-h-60 overflow-y-auto">
          <div v-for="d in availableDevices" :key="d.id"
            @click="addDeviceToLine(d.id)"
            class="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-800/50 hover:bg-surface-700 cursor-pointer transition-colors text-sm">
            <div>
              <span class="text-white">{{ d.name }}</span>
              <span class="text-surface-500 text-xs ml-2">{{ d.device_type }} · {{ d.model || 'EM340' }}</span>
            </div>
            <svg class="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
        </div>
        <p v-if="!availableDevices.length" class="text-surface-500 text-xs py-3 text-center">Todos los dispositivos ya están asignados</p>
      </div>

      <!-- Current devices -->
      <div v-if="line?.devices?.length" class="space-y-1.5">
        <div v-for="d in line.devices" :key="d.device_id"
          class="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-800/30 text-sm group">
          <div>
            <span class="text-white">{{ d.device_name }}</span>
            <span class="text-surface-500 text-xs ml-2">{{ d.device_type }} · {{ d.model || 'EM340' }}</span>
          </div>
          <button v-if="canManage" @click="removeDeviceFromLine(d.device_id)"
            class="p-1 rounded-md text-surface-600 hover:text-alarm-400 hover:bg-alarm-500/10 transition-colors opacity-0 group-hover:opacity-100">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <p v-else class="text-surface-500 text-sm text-center py-4">No hay dispositivos asignados</p>
    </div>

    <!-- Membership Log -->
    <div class="glass-card p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-white font-semibold flex items-center gap-2">
          <svg class="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Historial de cambios
        </h3>
        <span v-if="membershipLog.length" class="bg-surface-700/50 text-surface-400 text-xs px-2 py-0.5 rounded-full">
          {{ membershipLog.length }} {{ membershipLog.length === 1 ? 'registro' : 'registros' }}
        </span>
      </div>
      <div v-if="membershipLog.length" class="space-y-1.5 max-h-80 overflow-y-auto">
        <div v-for="log in membershipLog" :key="log.id"
          class="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-800/30 text-xs">
          <span :class="log.action === 'added' ? 'text-energy-400' : 'text-alarm-400'" class="font-bold w-16">
            {{ log.action === 'added' ? '+ Añadido' : '− Quitado' }}
          </span>
          <span class="text-white">{{ log.device_name }}</span>
          <span class="text-surface-500 ml-auto">{{ formatDate(log.timestamp) }}</span>
        </div>
      </div>
      <p v-else class="text-surface-500 text-xs py-3 text-center">Sin cambios registrados</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store.js'
import { useFactoryStore } from '@/stores/factory.store.js'
import api from '@/services/api'
import * as echarts from 'echarts'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const factoryStore = useFactoryStore()

const factoryId = route.params.factoryId
const lineId = route.params.lineId

const line = ref(null)
const summary = ref({})
const timeline = ref({ data: [] })
const breakdown = ref({ devices: [] })
const membershipLog = ref([])
const showAddDevices = ref(false)
const selectedRange = ref('today')
const groupBy = ref('hour')
const timelineChartRef = ref(null)
const chartInstance = shallowRef(null)

// Custom date range
const todayStr = new Date().toISOString().split('T')[0]
const customFrom = ref(todayStr)
const customTo = ref(todayStr)

const canManage = computed(() => ['manager', 'superadmin'].includes(authStore.user?.role))

const ranges = [
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
]

const selectRange = (value) => {
  selectedRange.value = value
  if (value !== 'custom') fetchAnalytics()
}

// Devices not yet assigned to this line
const availableDevices = computed(() => {
  const assignedIds = new Set((line.value?.devices || []).map(d => d.device_id))
  return (factoryStore.devices || []).filter(d => !assignedIds.has(d.id) && d.is_active !== false)
})

const formatDate = (ts) => {
  if (!ts) return ''
  return new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Data Fetching ──
const fetchLine = async () => {
  try {
    const res = await api.get(`/factories/${factoryId}/production-lines/${lineId}`)
    line.value = res.data.data
  } catch (e) {
    console.error('Failed to fetch line:', e)
  }
}

const fetchAnalytics = async () => {
  try {
    const params = selectedRange.value === 'custom'
      ? { from: customFrom.value, to: customTo.value }
      : { range: selectedRange.value }

    const [summaryRes, timelineRes, breakdownRes] = await Promise.all([
      api.get(`/factories/${factoryId}/production-lines/${lineId}/analytics/summary`, { params }),
      api.get(`/factories/${factoryId}/production-lines/${lineId}/analytics/timeline`, { params: { ...params, group: groupBy.value } }),
      api.get(`/factories/${factoryId}/production-lines/${lineId}/analytics/device-breakdown`, { params }),
    ])

    summary.value = summaryRes.data.data || {}
    timeline.value = timelineRes.data.data || { data: [] }
    breakdown.value = breakdownRes.data.data || { devices: [] }

    await nextTick()
    renderChart()
  } catch (e) {
    console.error('Failed to fetch analytics:', e)
  }
}

const fetchMembershipLog = async () => {
  try {
    const res = await api.get(`/factories/${factoryId}/production-lines/${lineId}/membership-log`)
    membershipLog.value = res.data.data || []
  } catch (e) {
    console.error('Failed to fetch membership log:', e)
  }
}

// ── Membership Management ──
const addDeviceToLine = async (deviceId) => {
  try {
    await api.post(`/factories/${factoryId}/production-lines/${lineId}/devices`, { device_ids: [deviceId] })
    await fetchLine()
    await fetchMembershipLog()
    await fetchAnalytics()
  } catch (e) {
    console.error('Failed to add device:', e)
  }
}

const removeDeviceFromLine = async (deviceId) => {
  try {
    await api.delete(`/factories/${factoryId}/production-lines/${lineId}/devices/${deviceId}`)
    await fetchLine()
    await fetchMembershipLog()
    await fetchAnalytics()
  } catch (e) {
    console.error('Failed to remove device:', e)
  }
}

// ── Chart ──
const renderChart = () => {
  const el = timelineChartRef.value
  if (!el) return

  if (chartInstance.value) {
    chartInstance.value.dispose()
  }

  const chart = echarts.init(el, null, { renderer: 'canvas' })
  chartInstance.value = chart

  const data = timeline.value?.data || []

  const formatBucketLabel = (bucket) => {
    const d = new Date(bucket)
    if (groupBy.value === 'hour') return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  }

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: 'rgba(148, 163, 184, 0.15)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: (params) => {
        const label = formatBucketLabel(params[0]?.axisValue)
        let html = `<div class="font-semibold mb-1">${label}</div>`
        for (const p of params) {
          html += `<div>${p.marker} ${p.seriesName}: <strong>${p.value?.toFixed(2)}</strong></div>`
        }
        return html
      }
    },
    legend: { show: true, bottom: 0, textStyle: { color: '#94a3b8', fontSize: 11 } },
    grid: { left: 50, right: 20, top: 20, bottom: 40 },
    xAxis: {
      type: 'category',
      data: data.map(d => d.bucket),
      axisLabel: { color: '#94a3b8', fontSize: 10, formatter: formatBucketLabel },
      axisLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } },
    },
    yAxis: [
      {
        type: 'value',
        name: 'kWh',
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.06)' } },
      },
      {
        type: 'value',
        name: '€',
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Energía (kWh)',
        type: 'bar',
        data: data.map(d => d.kwh || 0),
        itemStyle: { color: 'rgba(139, 92, 246, 0.7)', borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 30,
        yAxisIndex: 0,
      },
      {
        name: 'Coste (€)',
        type: 'line',
        data: data.map(d => d.cost_eur || 0),
        smooth: true,
        lineStyle: { color: '#10b981', width: 2 },
        itemStyle: { color: '#10b981' },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(16, 185, 129, 0.2)' },
          { offset: 1, color: 'rgba(16, 185, 129, 0)' },
        ])},
        yAxisIndex: 1,
      },
    ],
  }, true)
}

// ── Lifecycle ──
let resizeObserver = null

onMounted(async () => {
  // Fetch factory devices for the "add device" picker
  if (!factoryStore.devices?.length) {
    await factoryStore.fetchDevices(factoryId)
  }

  await Promise.all([fetchLine(), fetchAnalytics(), fetchMembershipLog()])

  // Resize observer for chart
  if (timelineChartRef.value) {
    resizeObserver = new ResizeObserver(() => chartInstance.value?.resize())
    resizeObserver.observe(timelineChartRef.value)
  }
})

onUnmounted(() => {
  chartInstance.value?.dispose()
  resizeObserver?.disconnect()
})

// Re-fetch when groupBy changes (range changes are handled by selectRange)
watch(groupBy, () => fetchAnalytics())
</script>
