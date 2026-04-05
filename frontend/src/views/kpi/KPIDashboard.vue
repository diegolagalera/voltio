<template>
  <div class="space-y-6 animate-fade-in">
    <!-- Factory Selector -->
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold text-white">{{ t('kpi.title') }}</h2>
      <select v-model="selectedFactory" class="input w-64" @change="loadKPIs">
        <option v-for="f in factories" :key="f.id" :value="f.id">{{ f.name }}</option>
      </select>
    </div>

    <!-- KPI Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="glass-card p-5">
        <p class="text-surface-400 text-xs mb-1">{{ t('kpi.totalConsumption') }}</p>
        <p class="text-3xl font-bold text-primary-400">{{ totals.total_kwh?.toFixed(0) || '0' }}</p>
        <p class="text-surface-500 text-xs">kWh</p>
      </div>
      <div class="glass-card p-5">
        <p class="text-surface-400 text-xs mb-1">{{ t('kpi.costs') }}</p>
        <p class="text-3xl font-bold text-energy-400">{{ totals.total_cost?.toFixed(2) || '0.00' }}€</p>
        <p class="text-surface-500 text-xs">{{ t('kpi.costPerKwh') }}: {{ totals.avg_cost_per_kwh?.toFixed(4) || '—' }}</p>
      </div>
      <div class="glass-card p-5">
        <p class="text-surface-400 text-xs mb-1">{{ t('kpi.co2Emissions') }}</p>
        <p class="text-3xl font-bold text-warning-400">{{ carbonTotals.total_co2_tons?.toFixed(2) || '0' }}</p>
        <p class="text-surface-500 text-xs">Toneladas CO₂</p>
      </div>
      <div class="glass-card p-5">
        <p class="text-surface-400 text-xs mb-1">{{ t('kpi.peakDemand') }}</p>
        <p class="text-3xl font-bold text-alarm-400">{{ formatPower(totals.peak_demand) }}</p>
        <p class="text-surface-500 text-xs">Máxima registrada</p>
      </div>
    </div>

    <!-- Cost Trend Chart -->
    <div class="glass-card p-5">
      <h4 class="text-white font-semibold mb-4">{{ t('kpi.costs') }} — Últimos 30 días</h4>
      <v-chart :option="costChartOption" :autoresize="true" class="h-72" />
    </div>

    <!-- Per-Device Efficiency -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div class="glass-card p-5">
        <h4 class="text-white font-semibold mb-4">Consumo por Equipo</h4>
        <v-chart :option="deviceConsumptionOption" :autoresize="true" class="h-72" />
      </div>
      <div class="glass-card p-5">
        <h4 class="text-white font-semibold mb-4">Factor de Potencia (Tendencia)</h4>
        <v-chart :option="pfTrendOption" :autoresize="true" class="h-72" />
      </div>
    </div>

    <!-- Efficiency Table -->
    <div v-if="efficiencyDevices.length > 0" class="glass-card overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-surface-700 text-surface-400">
            <th class="text-left p-4 font-medium">Equipo</th>
            <th class="text-left p-4 font-medium">Tipo</th>
            <th class="text-right p-4 font-medium">Consumo (kWh)</th>
            <th class="text-right p-4 font-medium">FP medio</th>
            <th class="text-right p-4 font-medium">Demanda pico</th>
            <th class="text-right p-4 font-medium">Potencia media</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in efficiencyDevices" :key="d.device_id" class="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
            <td class="p-4 text-white font-medium">{{ d.device_name }}</td>
            <td class="p-4"><span class="badge badge-info">{{ t(`devices.type.${d.device_type}`) }}</span></td>
            <td class="p-4 text-right text-primary-400 font-semibold">{{ parseFloat(d.total_kwh || 0).toFixed(1) }}</td>
            <td class="p-4 text-right font-semibold" :class="getPFColor(d.avg_power_factor)">{{ parseFloat(d.avg_power_factor || 0).toFixed(3) }}</td>
            <td class="p-4 text-right text-surface-300">{{ formatPower(d.peak_demand_w) }}</td>
            <td class="p-4 text-right text-surface-300">{{ formatPower(d.avg_power_w) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart, PieChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, GridComponent, LegendComponent } from 'echarts/components'
import { useFactoryStore } from '@/stores/factory.store.js'
import api from '@/services/api.js'

use([CanvasRenderer, LineChart, BarChart, PieChart, TitleComponent, TooltipComponent, GridComponent, LegendComponent])

const { t } = useI18n()
const route = useRoute()
const factoryStore = useFactoryStore()

const factories = computed(() => factoryStore.factories)
const selectedFactory = ref(route.params.factoryId || '')
const costData = ref([])
const totals = ref({})
const carbonTotals = ref({})
const efficiencyDevices = ref([])
const pfTrend = ref([])

const loadKPIs = async () => {
  if (!selectedFactory.value) return
  try {
    const [costRes, carbonRes, effRes] = await Promise.all([
      api.get(`/kpi/costs/${selectedFactory.value}`),
      api.get(`/kpi/carbon/${selectedFactory.value}`),
      api.get(`/kpi/efficiency/${selectedFactory.value}`),
    ])
    costData.value = costRes.data.data.daily || []
    totals.value = costRes.data.data.totals || {}
    carbonTotals.value = carbonRes.data.data.totals || {}
    efficiencyDevices.value = effRes.data.data.devices || []
    pfTrend.value = effRes.data.data.power_factor_trend || []
  } catch {
    // API not available yet or no data
  }
}

// ========= Charts =========

const costChartOption = computed(() => ({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis', backgroundColor: '#1a2332', borderColor: '#334155', textStyle: { color: '#cbd5e1', fontSize: 12 } },
  grid: { left: 60, right: 20, top: 10, bottom: 40 },
  xAxis: { type: 'category', data: costData.value.map(d => d.date?.slice(5)), axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b' } },
  yAxis: [
    { type: 'value', name: 'kWh', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
    { type: 'value', name: '€', axisLabel: { color: '#64748b' }, splitLine: { show: false } },
  ],
  series: [
    {
      name: 'Consumo', type: 'bar', yAxisIndex: 0,
      data: costData.value.map(d => parseFloat(d.total_kwh || 0)),
      itemStyle: { color: 'rgba(41,163,255,0.6)', borderRadius: [4, 4, 0, 0] },
    },
    {
      name: 'Coste', type: 'line', yAxisIndex: 1, smooth: true, showSymbol: false,
      data: costData.value.map(d => parseFloat(d.estimated_cost || 0)),
      lineStyle: { color: '#34d399', width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(52,211,153,0.2)' }, { offset: 1, color: 'rgba(52,211,153,0)' }] } },
    },
  ],
}))

const deviceConsumptionOption = computed(() => ({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'item', backgroundColor: '#1a2332', borderColor: '#334155', textStyle: { color: '#cbd5e1' } },
  series: [{
    type: 'pie', radius: ['45%', '75%'], center: ['50%', '50%'],
    label: { color: '#94a3b8', fontSize: 11 },
    data: efficiencyDevices.value.map(d => ({
      name: d.device_name, value: parseFloat(d.total_kwh || 0),
    })),
    emphasis: { itemStyle: { shadowBlur: 20, shadowColor: 'rgba(0,0,0,0.5)' } },
  }],
}))

const pfTrendOption = computed(() => ({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis', backgroundColor: '#1a2332', borderColor: '#334155', textStyle: { color: '#cbd5e1' } },
  grid: { left: 50, right: 20, top: 10, bottom: 30 },
  xAxis: { type: 'time', axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b' }, splitLine: { show: false } },
  yAxis: { type: 'value', min: 0.7, max: 1, axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
  series: [{
    type: 'line', smooth: true, showSymbol: false,
    lineStyle: { width: 2, color: '#fbbf24' },
    areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(251,191,36,0.2)' }, { offset: 1, color: 'rgba(251,191,36,0)' }] } },
    data: pfTrend.value.map(d => [d.bucket, parseFloat(d.avg_power_factor || 0)]),
    markLine: { silent: true, data: [{ yAxis: 0.9, lineStyle: { color: '#ef4444', type: 'dashed' }, label: { formatter: 'PF mín 0.9', color: '#f87171', fontSize: 10 } }] },
  }],
}))

const formatPower = (v) => { if (!v) return '—'; v = parseFloat(v); return v >= 1000 ? `${(v/1000).toFixed(1)} kW` : `${v.toFixed(0)} W` }
const getPFColor = (pf) => { if (!pf) return 'text-surface-400'; pf = parseFloat(pf); return pf >= 0.95 ? 'text-energy-400' : 'text-alarm-400' }

onMounted(async () => {
  if (factories.value.length === 0) await factoryStore.fetchFactories()
  if (!selectedFactory.value && factories.value.length > 0) selectedFactory.value = factories.value[0].id
  await loadKPIs()
})
</script>
