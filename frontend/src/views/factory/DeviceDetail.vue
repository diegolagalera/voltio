<template>
  <div class="space-y-6 animate-fade-in">
    <!-- Device Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <button @click="$router.back()" class="btn-secondary px-3 py-2">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h2 class="text-2xl font-bold text-white">{{ device?.name || '...' }}</h2>
          <p class="text-surface-400 text-sm mt-0.5">
            <template v-if="isPhaseDevice">
              Fase {{ device?.phase_channel }} de
              <router-link :to="`/factory/${factoryId}/device/${device?.parent_device_id}`" class="text-primary-400 hover:underline">
                {{ parentDevice?.name || 'medidor padre' }}
              </router-link>
            </template>
            <template v-else>
              {{ t(`devices.type.${device?.device_type || 'trifasica'}`) }}
              · S/N: {{ device?.serial_number || '—' }}
            </template>
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="isPhaseDevice" class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
          :class="{
            'bg-blue-500/20 text-blue-400': device?.phase_channel === 'L1',
            'bg-amber-500/20 text-amber-400': device?.phase_channel === 'L2',
            'bg-emerald-500/20 text-emerald-400': device?.phase_channel === 'L3',
          }">
          {{ device?.phase_channel }}
        </span>
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
          :class="dataStatusClass">
          <span class="w-2 h-2 rounded-full" :class="dataStatusDotClass"></span>
          {{ dataStatusLabel }}
        </span>
      </div>
    </div>

    <!-- Energy & Cost Summary Bar -->
    <div class="grid grid-cols-2 gap-4">
      <div class="glass-card px-5 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-energy-400 text-xl">⚡</span>
          <div>
            <p class="text-surface-400 text-[10px] uppercase tracking-wider">{{ t('telemetry.energy') }} ({{ t('telemetry.today') }}) <InfoTip title="Energía hoy">kWh consumidos desde las 00:00 de hoy. Para fases, se estima a partir del historial de potencia del medidor padre.</InfoTip></p>
            <p class="text-2xl font-bold text-energy-400">{{ totalKwh }} <span class="text-sm font-normal text-surface-400">kWh</span></p>
          </div>
        </div>
      </div>
      <div class="glass-card px-5 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-xl">💰</span>
          <div v-if="deviceCost">
            <p class="text-surface-400 text-[10px] uppercase tracking-wider">Coste estimado <InfoTip title="Coste por hora">Potencia actual (kW) × precio (€/kWh) del periodo tarifario vigente. Varía con la potencia y el periodo.</InfoTip></p>
            <p class="text-2xl font-bold text-energy-400">{{ deviceCost.cost_per_hour?.toFixed(2) }} <span class="text-sm font-normal text-surface-400">€/hora</span></p>
          </div>
          <div v-else>
            <p class="text-surface-400 text-[10px] uppercase tracking-wider">Coste estimado</p>
            <p class="text-sm text-surface-500">Sin contrato</p>
          </div>
        </div>
        <div v-if="deviceCost" class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: deviceCost.color }"></span>
          <span class="text-xs text-surface-300">{{ deviceCost.period }} · {{ deviceCost.price_kwh?.toFixed(4) }} €/kWh</span>
        </div>
      </div>
    </div>

    <!-- Live Gauges Row (3 gauges full width) -->
    <div class="grid grid-cols-3 gap-4">
      <div class="glass-card p-4 text-center">
        <p class="text-surface-400 text-xs mb-2">{{ t('telemetry.power') }} <InfoTip title="Potencia activa (W)">Energía útil consumida ahora. Es la que se factura. El gauge muestra el % respecto al máximo esperado del equipo.</InfoTip></p>
        <v-chart :option="powerGaugeOption" :autoresize="true" :update-options="{notMerge: false}" :init-options="{renderer: 'canvas'}" style="width: 100%; height: 160px" />
        <p class="text-xl font-bold text-primary-400 mt-1">{{ formatPower(effectiveData?.power_w_total || effectiveData?.power_w) }}</p>
      </div>
      <div class="glass-card p-4 text-center">
        <p class="text-surface-400 text-xs mb-2">{{ t('telemetry.powerFactor') }} <InfoTip title="Factor de potencia">Eficiencia eléctrica (0–1). ≥ 0.95 ideal (verde). < 0.95 penalizable por exceso de reactiva (Circular 3/2020 CNMC). Un FP bajo indica carga reactiva excesiva; se corrige con condensadores.</InfoTip></p>
        <v-chart :option="pfGaugeOption" :autoresize="true" :update-options="{notMerge: false}" :init-options="{renderer: 'canvas'}" style="width: 100%; height: 160px" />
        <p class="text-xl font-bold mt-1" :class="getPFColor(effectiveData?.power_factor)">{{ (effectiveData?.power_factor || 0).toFixed(3) }}</p>
      </div>
      <div class="glass-card p-4 text-center">
        <p class="text-surface-400 text-xs mb-2">{{ t('telemetry.frequency') }} <InfoTip title="Frecuencia de red">Frecuencia de la red eléctrica (Hz). En Europa siempre ~50 Hz. Desviaciones indican problemas en la red o el generador.</InfoTip></p>
        <v-chart :option="freqGaugeOption" :autoresize="true" :update-options="{notMerge: false}" :init-options="{renderer: 'canvas'}" style="width: 100%; height: 160px" />
        <p class="text-xl font-bold text-white mt-1">{{ (effectiveData?.frequency_hz || 0).toFixed(1) }} Hz</p>
      </div>
    </div>

    <!-- Voltage & Current per Phase (only for non-phase parent devices) -->
    <div v-if="device?.device_type !== 'monofasica' && !isPhaseDevice" class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div class="glass-card p-5">
        <h4 class="text-white font-semibold mb-3">{{ t('telemetry.voltage') }} (L-N) <InfoTip title="Tensión Línea-Neutro">Voltaje medido entre cada fase y el neutro. En España el estándar es 230V ±10%. Valores fuera de rango indican problemas en la instalación o la red.</InfoTip></h4>
        <div class="grid grid-cols-3 gap-4">
          <div v-for="(phase, i) in ['L1', 'L2', 'L3']" :key="phase" class="text-center">
            <p class="text-surface-400 text-xs mb-1">{{ phase }}</p>
            <p class="text-2xl font-bold text-white">{{ (liveData?.[`voltage_l${i+1}_n`] || 0).toFixed(1) }}</p>
            <p class="text-surface-500 text-xs">V</p>
          </div>
        </div>
      </div>
      <div class="glass-card p-5">
        <h4 class="text-white font-semibold mb-3">{{ t('telemetry.current') }} <InfoTip title="Corriente (A)">Intensidad de corriente por fase (amperios). A más consumo, más amperios. Si una fase tiene mucha más corriente que las otras, hay desequilibrio.</InfoTip></h4>
        <div class="grid grid-cols-3 gap-4">
          <div v-for="(phase, i) in ['L1', 'L2', 'L3']" :key="phase" class="text-center">
            <p class="text-surface-400 text-xs mb-1">{{ phase }}</p>
            <p class="text-2xl font-bold text-white">{{ (liveData?.[`current_l${i+1}`] || 0).toFixed(2) }}</p>
            <p class="text-surface-500 text-xs">A</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Phase-specific voltage/current (single phase) -->
    <div v-if="isPhaseDevice" class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div class="glass-card p-5">
        <h4 class="text-white font-semibold mb-3">{{ device?.phase_channel }} — Tensión <InfoTip title="Tensión de fase">Voltaje medido en esta fase específica. Lectura del medidor padre para la línea {{ device?.phase_channel }}.</InfoTip></h4>
        <div class="text-center">
          <p class="text-4xl font-bold text-white">{{ (effectiveData?.voltage || 0).toFixed(1) }}</p>
          <p class="text-surface-500 text-sm">V</p>
        </div>
      </div>
      <div class="glass-card p-5">
        <h4 class="text-white font-semibold mb-3">{{ device?.phase_channel }} — Corriente <InfoTip title="Corriente de fase">Amperios circulando por esta fase. A más carga conectada, más corriente.</InfoTip></h4>
        <div class="text-center">
          <p class="text-4xl font-bold text-white">{{ (effectiveData?.current || 0).toFixed(2) }}</p>
          <p class="text-surface-500 text-sm">A</p>
        </div>
      </div>
    </div>

    <!-- Power Trend Chart -->
    <div class="glass-card p-5">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <h4 class="text-white font-semibold">{{ selectedInterval === '1h' ? 'Potencia Activa (últimas 24h)' : 'Potencia Activa (últimos 7 días)' }} <InfoTip title="Gráfico de tendencia">Evolución de la potencia activa en el tiempo. 24h = datos brutos (cada 5 min). 7 días = media horaria con líneas de máximo y mínimo.</InfoTip></h4>
        </div>
        <div class="flex gap-2">
          <button
            v-for="interval in ['1h', '1d']"
            :key="interval"
            @click="selectedInterval = interval"
            class="px-3 py-1 rounded-lg text-xs font-medium transition-colors"
            :class="selectedInterval === interval ? 'bg-primary-600/20 text-primary-400' : 'text-surface-400 hover:text-white'"
          >
            {{ interval === '1h' ? '24 horas' : '7 días' }}
          </button>
        </div>
      </div>
      <v-chart :option="trendChartOption" :autoresize="true" :update-options="{notMerge: true}" :init-options="{renderer: 'canvas'}" style="width: 100%; height: 300px" />
    </div>

    <!-- Power Detail (per phase) — only for non-phase parent devices -->
    <div v-if="device?.device_type !== 'monofasica' && !isPhaseDevice" class="glass-card p-5">
      <h4 class="text-white font-semibold mb-4">Potencia por Fase <InfoTip title="Desglose trifásico">Potencia desglosada por cada fase del medidor. P = activa (facturada), S = aparente (total generada), Q = reactiva (no útil), FP = eficiencia.</InfoTip></h4>
      <div class="grid grid-cols-3 gap-5">
        <div v-for="(phase, i) in ['L1', 'L2', 'L3']" :key="phase" class="bg-surface-800/50 rounded-xl p-4">
          <p class="text-surface-400 text-sm mb-3 font-medium">{{ phase }}</p>
          <div class="space-y-2.5">
            <div class="flex justify-between">
              <span class="text-surface-400 text-xs">P (W) <InfoTip title="Potencia activa">Energía útil (watios). La que hace funcionar el equipo y la que se paga.</InfoTip></span>
              <span class="text-white text-sm font-semibold">{{ formatPower(liveData?.[`power_w_l${i+1}`]) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400 text-xs">S (VA) <InfoTip title="Potencia aparente">Potencia total entregada (P + Q combinadas vectorialmente). Determina el dimensionamiento de cables y protecciones.</InfoTip></span>
              <span class="text-white text-sm font-semibold">{{ formatPower(liveData?.[`power_va_l${i+1}`]) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400 text-xs">Q (VAR) <InfoTip title="Potencia reactiva">Energía no útil que oscila entre la red y la carga. Causada por motores, transformadores. No produce trabajo pero ocupa capacidad.</InfoTip></span>
              <span class="text-white text-sm font-semibold">{{ formatPower(liveData?.[`power_var_l${i+1}`]) }}</span>
            </div>
            <div class="flex justify-between border-t border-surface-700 pt-2">
              <span class="text-surface-400 text-xs">FP <InfoTip title="Factor de potencia por fase">Ratio P/S de esta fase. Indica qué % de la energía entregada es útil.</InfoTip></span>
              <span class="text-sm font-semibold" :class="getPFColor(liveData?.[`power_factor_l${i+1}`])">
                {{ (liveData?.[`power_factor_l${i+1}`] || 0).toFixed(3) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Phase-specific power detail -->
    <div v-if="isPhaseDevice" class="glass-card p-5">
      <h4 class="text-white font-semibold mb-4">Detalle de Potencia — {{ device?.phase_channel }} <InfoTip title="Potencia de fase">Desglose de potencias para esta fase individual del medidor padre, con P (activa), S (aparente), Q (reactiva) y FP.</InfoTip></h4>
      <div class="bg-surface-800/50 rounded-xl p-5">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="text-center">
            <p class="text-surface-400 text-xs mb-1">P (Activa) <InfoTip title="Potencia activa">Energía útil para esta fase (W). Es la que se factura.</InfoTip></p>
            <p class="text-xl font-bold text-primary-400">{{ formatPower(effectiveData?.power_w_total || effectiveData?.power_w) }}</p>
            <p class="text-surface-500 text-xs">W</p>
          </div>
          <div class="text-center">
            <p class="text-surface-400 text-xs mb-1">S (Aparente) <InfoTip title="Potencia aparente">Potencia total entregada a esta fase (VA). Siempre ≥ que la activa.</InfoTip></p>
            <p class="text-xl font-bold text-white">{{ formatPower(effectiveData?.power_va) }}</p>
            <p class="text-surface-500 text-xs">VA</p>
          </div>
          <div class="text-center">
            <p class="text-surface-400 text-xs mb-1">Q (Reactiva) <InfoTip title="Potencia reactiva">Energía no útil en esta fase (VAR). Causada por cargas inductivas.</InfoTip></p>
            <p class="text-xl font-bold text-white">{{ formatPower(effectiveData?.power_var) }}</p>
            <p class="text-surface-500 text-xs">VAR</p>
          </div>
          <div class="text-center">
            <p class="text-surface-400 text-xs mb-1">Factor Potencia <InfoTip title="FP de fase">Eficiencia energética de esta fase. Ratio entre potencia activa y aparente.</InfoTip></p>
            <p class="text-xl font-bold" :class="getPFColor(effectiveData?.power_factor)">{{ (effectiveData?.power_factor || 0).toFixed(3) }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { GaugeChart, LineChart, BarChart } from 'echarts/charts'
import {
  TitleComponent, TooltipComponent, GridComponent,
  LegendComponent, DataZoomComponent,
} from 'echarts/components'
import { useFactoryStore } from '@/stores/factory.store.js'
import { useTelemetryStore } from '@/stores/telemetry.store.js'
import { useWebSocket } from '@/composables/useWebSocket.js'
import api from '@/services/api.js'
import InfoTip from '@/components/ui/InfoTip.vue'

use([
  CanvasRenderer, GaugeChart, LineChart, BarChart,
  TitleComponent, TooltipComponent, GridComponent,
  LegendComponent, DataZoomComponent,
])

const { t } = useI18n()
const route = useRoute()
const factoryStore = useFactoryStore()
const telemetryStore = useTelemetryStore()
const { connected: wsConnected, connect, joinFactory, leaveFactory } = useWebSocket()

const factoryId = route.params.factoryId
const deviceId = route.params.deviceId
const device = ref(null)
const selectedInterval = ref('1h')
const historyData = ref([])
const phaseEnergyData = ref([]) // Separate data source for phase energy calc (always today's raw)
const deviceCost = ref(null)
let costInterval = null
let freshnessTimer = null

// ── Data freshness indicator ──
const DATA_FRESH_THRESHOLD = 30_000
const now = ref(Date.now())

const isDataFresh = computed(() => {
  const lastReceived = telemetryStore.lastRealtimeReceived
  if (!lastReceived) return false
  return (now.value - lastReceived) < DATA_FRESH_THRESHOLD
})

const dataStatusClass = computed(() => {
  if (!wsConnected.value) return 'bg-surface-600 text-surface-400'
  if (isDataFresh.value) return 'bg-energy-500/15 text-energy-400'
  return 'bg-warning-500/15 text-warning-400'
})

const dataStatusDotClass = computed(() => {
  if (!wsConnected.value) return 'bg-surface-500'
  if (isDataFresh.value) return 'bg-energy-400 animate-pulse-glow'
  return 'bg-warning-400'
})

const dataStatusLabel = computed(() => {
  if (!wsConnected.value) return 'Offline'
  if (isDataFresh.value) return 'En vivo'
  return 'Sin datos recientes'
})
const totalKwh = computed(() => {
  if (isPhaseDevice.value) {
    // Estimate kWh from dedicated today-only raw data (independent of chart)
    const data = phaseEnergyData.value
    if (!data || data.length < 2) return '0.0'

    // Trapezoidal integration with real time deltas
    let totalWs = 0
    for (let j = 1; j < data.length; j++) {
      const t0 = new Date(data[j - 1].time || data[j - 1].bucket).getTime()
      const t1 = new Date(data[j].time || data[j].bucket).getTime()
      const dtSeconds = (t1 - t0) / 1000

      // Skip unreasonable gaps (> 30 minutes = likely a reconnection gap)
      if (dtSeconds <= 0 || dtSeconds > 1800) continue

      const w0 = data[j - 1].power_w_total || data[j - 1].avg_power_w || 0
      const w1 = data[j].power_w_total || data[j].avg_power_w || 0

      // Clamp to reasonable values (ignore spikes > 100kW per phase)
      const avgW = Math.min((w0 + w1) / 2, 100000)
      totalWs += avgW * dtSeconds
    }
    const kwh = totalWs / 3600 / 1000
    if (kwh >= 1000) return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(kwh)
    return kwh.toFixed(1)
  }
  const val = effectiveData.value?.energy_kwh_total
  if (val == null) return '—'
  if (val >= 1000) return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(val)
  return val.toFixed(1)
})

// Phase detection
const isPhaseDevice = computed(() => device.value?.parent_relation === 'phase_channel')
const parentDevice = computed(() => {
  if (!isPhaseDevice.value) return null
  return factoryStore.devices.find(d => d.id === device.value?.parent_device_id) || null
})
const phaseIndex = computed(() => {
  const ch = device.value?.phase_channel // 'L1', 'L2', 'L3'
  return ch ? parseInt(ch[1]) : 1
})

// Live data from store — for phases, read from PARENT's data
const liveData = computed(() => {
  const rt = telemetryStore.realtimeData[deviceId]
  return rt?.data || null
})

// Effective data: for phase devices, extract from parent's L1/L2/L3 columns
const effectiveData = computed(() => {
  if (!isPhaseDevice.value) return liveData.value
  // Read parent's realtime data
  const parentId = device.value?.parent_device_id
  if (!parentId) return null
  const parentRt = telemetryStore.realtimeData[parentId]
  const parentData = parentRt?.data || null
  if (!parentData) return null
  const i = phaseIndex.value
  return {
    power_w_total: parentData[`power_w_l${i}`] || 0,
    power_w: parentData[`power_w_l${i}`] || 0,
    power_va: parentData[`power_va_l${i}`] || 0,
    power_var: parentData[`power_var_l${i}`] || 0,
    power_factor: parentData[`power_factor_l${i}`] || parentData.power_factor || 0,
    voltage: parentData[`voltage_l${i}_n`] || 0,
    current: parentData[`current_l${i}`] || 0,
    frequency_hz: parentData.frequency_hz || 50,
    energy_kwh_total: null, // Not available per phase
  }
})

// ============ Gauges ============
// animationDuration: 0 prevents re-animate from 0 on each computed trigger
// animationDurationUpdate: 500 gives smooth transition between values

const gaugeBase = {
  startAngle: 210,
  endAngle: -30,
  pointer: { show: false },
  axisLine: { lineStyle: { width: 12, color: [[1, 'rgba(255,255,255,0.08)']] } },
  axisTick: { show: false },
  splitLine: { show: false },
  axisLabel: { show: false },
  detail: { show: false },
  animationDuration: 0,
  animationDurationUpdate: 500,
}

const powerGaugeOption = computed(() => ({
  series: [{
    ...gaugeBase,
    type: 'gauge',
    min: 0,
    max: isPhaseDevice.value ? 15000 : (device.value?.device_type === 'monofasica' ? 10000 : 50000),
    progress: { show: true, width: 12, roundCap: true, itemStyle: { color: '#29a3ff' } },
    data: [{ value: effectiveData.value?.power_w_total || effectiveData.value?.power_w || 0 }],
  }],
}))

const pfGaugeOption = computed(() => {
  const pf = effectiveData.value?.power_factor || 0
  const color = pf >= 0.95 ? '#34d399' : '#f87171'
  return {
    series: [{
      ...gaugeBase,
      type: 'gauge',
      min: 0,
      max: 1,
      progress: { show: true, width: 12, roundCap: true, itemStyle: { color } },
      data: [{ value: pf }],
    }],
  }
})

const freqGaugeOption = computed(() => ({
  series: [{
    ...gaugeBase,
    type: 'gauge',
    min: 49,
    max: 51,
    progress: { show: true, width: 12, roundCap: true, itemStyle: { color: '#a78bfa' } },
    data: [{ value: effectiveData.value?.frequency_hz || 50 }],
  }],
}))

// ============ Trend Chart ============

const trendChartOption = computed(() => {
  const data = historyData.value
  const isWeekly = selectedInterval.value === '1d'

  // Determine data fields based on interval
  const getAvgPower = (d) => {
    if (isWeekly) return d.avg_power_w || 0
    return d.power_w_total || d.avg_power_w || 0
  }
  const getMaxPower = (d) => d.max_power_w || 0
  const getMinPower = (d) => d.min_power_w || 0
  const getTime = (d) => d.bucket || d.time

  const series = [{
    name: isWeekly ? 'Media' : 'Potencia',
    type: 'line',
    smooth: true,
    showSymbol: false,
    lineStyle: { width: 2, color: '#29a3ff' },
    areaStyle: {
      color: {
        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [
          { offset: 0, color: 'rgba(41,163,255,0.3)' },
          { offset: 1, color: 'rgba(41,163,255,0.02)' },
        ],
      },
    },
    data: data.map(d => [getTime(d), getAvgPower(d)]),
  }]

  // Add max/min lines for weekly view
  if (isWeekly) {
    series.push({
      name: 'Máx',
      type: 'line',
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 1, color: 'rgba(248,113,113,0.5)', type: 'dashed' },
      data: data.map(d => [getTime(d), getMaxPower(d)]),
    })
    series.push({
      name: 'Mín',
      type: 'line',
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 1, color: 'rgba(52,211,153,0.5)', type: 'dashed' },
      areaStyle: { opacity: 0 },
      data: data.map(d => [getTime(d), getMinPower(d)]),
    })
  }

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a2332',
      borderColor: '#334155',
      textStyle: { color: '#cbd5e1', fontSize: 12 },
      formatter: (params) => {
        if (!params?.length) return ''
        const date = new Date(params[0].value[0])
        const fmt = isWeekly
          ? date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          : date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        let html = `<div style="font-weight:600;margin-bottom:4px">${fmt}</div>`
        for (const p of params) {
          const val = p.value[1]
          const formatted = val >= 1000 ? `${(val/1000).toFixed(1)} kW` : `${val.toFixed(0)} W`
          html += `<div style="display:flex;align-items:center;gap:6px">${p.marker}<span>${p.seriesName}:</span><span style="font-weight:600">${formatted}</span></div>`
        }
        return html
      },
    },
    legend: isWeekly ? {
      data: ['Media', 'Máx', 'Mín'],
      textStyle: { color: '#94a3b8', fontSize: 11 },
      right: 0, top: 0,
    } : undefined,
    grid: { left: 50, right: 20, top: isWeekly ? 30 : 20, bottom: 50 },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: {
        color: '#64748b', fontSize: 11,
        formatter: isWeekly
          ? (val) => { const d = new Date(val); return d.getHours() === 0 ? d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }
          : undefined,
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'W',
      axisLine: { show: false },
      axisLabel: { color: '#64748b', fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    dataZoom: [{ type: 'inside' }],
    series,
  }
})

// ============ Helpers ============

const formatPower = (value) => {
  if (value == null) return '—'
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)} kW`
  return `${value.toFixed(0)} W`
}

const getPFColor = (pf) => {
  if (!pf) return 'text-surface-400'
  if (pf >= 0.95) return 'text-energy-400'
  return 'text-alarm-400'
}

const fetchHistory = async () => {
  const now = new Date()
  let start, interval

  if (selectedInterval.value === '1d') {
    // Last 7 days, hourly aggregation (now supports per-phase columns)
    start = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
    interval = '1h'
  } else {
    // Last 24h, raw data
    start = new Date(now - 24 * 60 * 60 * 1000).toISOString()
    interval = 'raw'
  }

  const end = now.toISOString()
  const targetId = isPhaseDevice.value ? device.value?.parent_device_id : deviceId
  if (!targetId) return
  try {
    const data = await telemetryStore.fetchHistory(targetId, {
      start, end, interval,
    })
    if (isPhaseDevice.value && data) {
      // Map parent's per-phase column for trend chart
      const i = phaseIndex.value
      const isHourlyData = selectedInterval.value === '1d'
      historyData.value = data.map(d => ({
        ...d,
        // For hourly aggregated data, map avg/max/min per-phase columns
        avg_power_w: isHourlyData ? (d[`avg_power_w_l${i}`] || d.avg_power_w || 0) : (d[`power_w_l${i}`] || d.power_w_total || 0),
        max_power_w: isHourlyData ? (d[`max_power_w_l${i}`] || d.max_power_w || 0) : undefined,
        min_power_w: isHourlyData ? (d[`min_power_w_l${i}`] || d.min_power_w || 0) : undefined,
        power_w_total: d[`power_w_l${i}`] || d[`avg_power_w_l${i}`] || d.power_w_total || 0,
      }))
    } else {
      historyData.value = data || []
    }
  } catch {
    historyData.value = []
  }
}

watch(selectedInterval, fetchHistory)

// Fetch today's raw data for phase energy estimation (independent of chart)
const fetchPhaseEnergyData = async () => {
  if (!isPhaseDevice.value) return
  const parentId = device.value?.parent_device_id
  if (!parentId) return
  try {
    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const data = await telemetryStore.fetchHistory(parentId, {
      start: todayStart.toISOString(),
      end: now.toISOString(),
      interval: 'raw',
    })
    if (data) {
      const i = phaseIndex.value
      phaseEnergyData.value = data.map(d => ({
        ...d,
        power_w_total: d[`power_w_l${i}`] || d.power_w_total || 0,
      }))
    }
  } catch { /* ignore */ }
}

const fetchDeviceCost = async () => {
  try {
    // For phase devices, fetch parent's cost info and recalculate for this phase's power
    const targetId = isPhaseDevice.value ? device.value?.parent_device_id : deviceId
    if (!targetId) return
    const res = await api.get(`/devices/${targetId}/cost?factoryId=${factoryId}`)
    const costData = res.data.data
    if (isPhaseDevice.value && costData) {
      // Recalculate cost_per_hour using phase's actual power
      const phaseData = effectiveData.value
      const phasePowerKw = (phaseData?.power_w_total || phaseData?.power_w || 0) / 1000
      costData.cost_per_hour = phasePowerKw * (costData.price_kwh || 0)
    }
    deviceCost.value = costData
  } catch (e) { /* no contract */ }
}

onMounted(async () => {
  // Find device from factory store
  if (factoryStore.devices.length === 0) {
    await factoryStore.fetchDevices(factoryId)
  }
  device.value = factoryStore.devices.find(d => d.id === deviceId) || null

  // Fetch latest + history
  // For phase devices, fetch PARENT's latest so we have realtime data
  if (isPhaseDevice.value && device.value?.parent_device_id) {
    await telemetryStore.fetchLatest(device.value.parent_device_id)
    // Fetch today's raw data for energy estimation (independent of chart interval)
    await fetchPhaseEnergyData()
  } else {
    await telemetryStore.fetchLatest(deviceId)
  }
  await fetchHistory()

  // Connect WebSocket
  connect()
  joinFactory(factoryId)

  // Fetch cost estimate + refresh every 60s
  await fetchDeviceCost()
  costInterval = setInterval(fetchDeviceCost, 60000)

  // Freshness timer
  freshnessTimer = setInterval(() => { now.value = Date.now() }, 5000)
})

onUnmounted(() => {
  leaveFactory(factoryId)
  if (costInterval) clearInterval(costInterval)
  if (freshnessTimer) clearInterval(freshnessTimer)
})
</script>
