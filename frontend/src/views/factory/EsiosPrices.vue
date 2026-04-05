<template>
  <div>
    <!-- Header -->
    <div class="mb-6">
      <h2 class="text-2xl font-bold text-white">Precios del Mercado Eléctrico</h2>
      <p class="text-surface-400 text-sm">Precios horarios OMIE — Mercado diario peninsular</p>
    </div>

    <!-- Date Navigation -->
    <div class="glass-card p-4 mb-6 flex flex-wrap items-center gap-3">
      <button @click="changeDate(-1)" class="p-2 rounded-lg bg-surface-700 text-surface-300 hover:text-white hover:bg-surface-600 transition-colors">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
      </button>
      <input type="date" v-model="selectedDate" @change="fetchPrices" class="input text-sm px-3 py-2" />
      <button @click="changeDate(1)" class="p-2 rounded-lg bg-surface-700 text-surface-300 hover:text-white hover:bg-surface-600 transition-colors" :disabled="isToday">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>
      <button @click="goToday" class="btn-secondary text-sm px-3 py-2">Hoy</button>

      <!-- Price type selector -->
      <div class="ml-auto flex rounded-lg overflow-hidden border border-surface-600">
        <button
          v-for="pt in priceTypes"
          :key="pt.key"
          @click="priceType = pt.key; fetchPrices()"
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="priceType === pt.key
            ? 'bg-primary-600 text-white'
            : 'bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-white'"
        >
          {{ pt.label }}
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-12">
      <div class="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
      <p class="text-surface-400 text-sm">Cargando precios...</p>
    </div>

    <template v-else>
      <!-- KPI Cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="glass-card p-4">
          <p class="text-surface-400 text-xs uppercase tracking-wider mb-1">Precio Medio</p>
          <p class="text-2xl font-bold text-white">{{ kpis.avg }} <span class="text-sm font-normal text-surface-400">€/MWh</span></p>
        </div>
        <div class="glass-card p-4">
          <p class="text-surface-400 text-xs uppercase tracking-wider mb-1">Mínimo</p>
          <p class="text-2xl font-bold text-energy-400">{{ kpis.min }} <span class="text-sm font-normal text-surface-400">€/MWh</span></p>
          <p class="text-xs text-surface-500">{{ kpis.minTime }}</p>
        </div>
        <div class="glass-card p-4">
          <p class="text-surface-400 text-xs uppercase tracking-wider mb-1">Máximo</p>
          <p class="text-2xl font-bold text-alarm-400">{{ kpis.max }} <span class="text-sm font-normal text-surface-400">€/MWh</span></p>
          <p class="text-xs text-surface-500">{{ kpis.maxTime }}</p>
        </div>
        <div class="glass-card p-4">
          <p class="text-surface-400 text-xs uppercase tracking-wider mb-1">Precio Medio kWh</p>
          <p class="text-2xl font-bold text-primary-400">{{ kpis.avgKwh }} <span class="text-sm font-normal text-surface-400">€/kWh</span></p>
        </div>
      </div>

      <!-- Chart -->
      <div class="glass-card p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-white font-semibold flex items-center gap-2">
            <svg class="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Precios Horarios — {{ formattedDate }}
          </h3>
          <div class="flex items-center gap-3 text-xs">
            <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-[#ef4444]"></span> P1 Punta</span>
            <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-[#f97316]"></span> P2 Llano Alto</span>
            <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-[#eab308]"></span> P3 Llano</span>
            <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-[#22c55e]"></span> P4/P5 Valle</span>
            <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-[#6366f1]"></span> P6 Super Valle</span>
          </div>
        </div>
        <div ref="chartRef" style="width: 100%; height: 380px;"></div>
      </div>

      <!-- No data -->
      <div v-if="!prices.length && !loading" class="glass-card p-8 text-center mt-6">
        <svg class="w-12 h-12 text-surface-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
        <p class="text-surface-400">No hay datos de precios para esta fecha</p>
        <p class="text-surface-500 text-sm mt-1">Los precios se sincronizan diariamente a las 21:00 CET</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import * as echarts from 'echarts'
import api from '@/services/api.js'

const route = useRoute()

// Period colors (same as energy reports)
const PERIOD_COLORS = {
  P1: '#ef4444', P2: '#f97316', P3: '#eab308',
  P4: '#22c55e', P5: '#06b6d4', P6: '#6366f1',
}

// Simplified tariff schedule (weekday, winter — just for visual color coding)
// This is approximation; real schedule comes from contract
const getHourPeriod = (hour) => {
  if (hour >= 10 && hour < 14) return 'P1'
  if ((hour >= 8 && hour < 10) || (hour >= 18 && hour < 22)) return 'P2'
  if ((hour >= 14 && hour < 18)) return 'P3'
  if (hour >= 22 || hour < 8) return 'P6'
  return 'P3'
}

const priceTypes = [
  { key: 'spot_omie', label: 'SPOT OMIE' },
  { key: 'pvpc', label: 'PVPC' },
]

const loading = ref(false)
const prices = ref([])
const priceType = ref('spot_omie')
const selectedDate = ref(new Date().toISOString().split('T')[0])
const chartRef = ref(null)
let chart = null
let tariffSchedule = ref([])

const factoryId = computed(() => route.params.factoryId)

const isToday = computed(() => {
  const today = new Date().toISOString().split('T')[0]
  return selectedDate.value === today
})

const formattedDate = computed(() => {
  const d = new Date(selectedDate.value + 'T12:00:00')
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
})

const kpis = computed(() => {
  if (!prices.value.length) return { avg: '—', min: '—', max: '—', minTime: '', maxTime: '', avgKwh: '—' }
  
  const vals = prices.value.map(p => parseFloat(p.price_eur_mwh))
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const minIdx = vals.indexOf(min)
  const maxIdx = vals.indexOf(max)

  // Format time from actual DB timestamp
  const fmtTime = (idx) => {
    const t = prices.value[idx]?.time
    if (!t) return ''
    const d = new Date(t)
    return d.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })
  }
  
  return {
    avg: avg.toFixed(2),
    min: min.toFixed(2),
    max: max.toFixed(2),
    minTime: fmtTime(minIdx),
    maxTime: fmtTime(maxIdx),
    avgKwh: (avg / 1000).toFixed(4),
  }
})

const changeDate = (delta) => {
  const d = new Date(selectedDate.value + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  selectedDate.value = d.toISOString().split('T')[0]
  fetchPrices()
}

const goToday = () => {
  selectedDate.value = new Date().toISOString().split('T')[0]
  fetchPrices()
}

const fetchPrices = async () => {
  loading.value = true
  try {
    // Fetch prices
    const res = await api.get('/esios/prices', { params: { date: selectedDate.value, type: priceType.value } })
    prices.value = res.data.data || []

    // Fetch tariff schedule for the factory
    try {
      const schedRes = await api.get(`/factories/${factoryId.value}/schedule`, { params: { date: selectedDate.value } })
      tariffSchedule.value = schedRes.data?.data?.hours || []
    } catch { tariffSchedule.value = [] }
  } catch (err) {
    console.error('[EsiosPrices] Error:', err)
    prices.value = []
  } finally {
    loading.value = false
    // Chart div only exists after loading=false (v-else), so render after nextTick
    await nextTick()
    renderChart()
  }
}

const getBarColor = (hour) => {
  // Use real tariff schedule if available
  if (tariffSchedule.value.length) {
    const entry = tariffSchedule.value.find(h => h.hour === hour)
    if (entry?.period) return PERIOD_COLORS[entry.period] || '#6366f1'
  }
  // Fallback to approximation
  return PERIOD_COLORS[getHourPeriod(hour)] || '#6366f1'
}

const renderChart = () => {
  if (!chartRef.value || !prices.value.length) return

  // Dispose old instance if DOM was recreated (v-if/v-else cycle)
  if (chart) {
    chart.dispose()
    chart = null
  }
  chart = echarts.init(chartRef.value)

  const TZ = 'Europe/Madrid'
  const isQuarterHourly = prices.value.length > 24

  // Build labels and data from actual DB rows (sorted by time)
  const labels = []
  const data = []
  const barColors = []

  prices.value.forEach(p => {
    const dt = new Date(p.time)
    const hh = dt.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })
    const mm = dt.toLocaleString('en-GB', { timeZone: TZ, minute: '2-digit' })
    const hour = parseInt(hh)
    labels.push(`${hh}:${mm.padStart(2, '0')}`)
    data.push(parseFloat(p.price_eur_mwh))
    barColors.push(getBarColor(hour))
  })

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: 'rgba(100, 116, 139, 0.3)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: (params) => {
        const p = params[0]
        if (!p) return ''
        const label = labels[p.dataIndex]
        const price = p.value
        const hour = parseInt(label)
        const period = tariffSchedule.value.find(h => h.hour === hour)?.period || getHourPeriod(hour)
        const nextLabel = isQuarterHourly
          ? (() => { const m = parseInt(label.split(':')[1]); return `${String(hour).padStart(2, '0')}:${String(m + 15 >= 60 ? 0 : m + 15).padStart(2, '0')}` })()
          : `${String(hour + 1).padStart(2, '0')}:00`
        return `
          <div style="font-weight:600;margin-bottom:4px">${label} - ${nextLabel}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="width:10px;height:10px;border-radius:2px;background:${PERIOD_COLORS[period] || '#6366f1'}"></span>
            <span>${price.toFixed(2)} €/MWh</span>
            <span style="color:#94a3b8;margin-left:4px">(${(price / 1000).toFixed(4)} €/kWh)</span>
          </div>
          <div style="color:#94a3b8;font-size:11px;margin-top:2px">Periodo ${period}</div>
        `
      },
    },
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
        // Show only full-hour labels to avoid clutter
        interval: isQuarterHourly ? 3 : 0,
        formatter: (val) => val.endsWith(':00') ? val : '',
      },
      axisLine: { lineStyle: { color: '#334155' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '€/MWh',
      nameTextStyle: { color: '#94a3b8', fontSize: 11, padding: [0, 40, 0, 0] },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
        formatter: (v) => v.toFixed(0),
      },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series: [{
      type: 'bar',
      data: data.map((val, i) => ({
        value: val,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: barColors[i] },
            { offset: 1, color: barColors[i] + '88' },
          ]),
          borderRadius: isQuarterHourly ? [2, 2, 0, 0] : [4, 4, 0, 0],
        },
      })),
      barWidth: isQuarterHourly ? '80%' : '60%',
    }],
  }

  // Add average line
  const nonZero = data.filter(v => v > 0)
  const avg = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0
  if (avg > 0) {
    option.series.push({
      type: 'line',
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#f59e0b', width: 1.5, type: 'dashed' },
        label: {
          formatter: `Media: ${avg.toFixed(1)} €/MWh`,
          color: '#f59e0b',
          fontSize: 11,
        },
        data: [{ yAxis: avg }],
      },
      data: [],
    })
  }

  chart.setOption(option, true)
}

// Resize handler
const handleResize = () => chart?.resize()

onMounted(() => {
  fetchPrices()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
  chart = null
})
</script>
