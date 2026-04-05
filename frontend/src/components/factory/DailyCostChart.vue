<template>
  <div class="glass-card p-5">
    <div class="flex items-center justify-between mb-4">
      <h4 class="text-white font-semibold text-lg flex items-center gap-2">
        <svg class="w-5 h-5 text-energy-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        Coste por Hora · Hoy
      </h4>
      <div v-if="data" class="flex items-center gap-4 text-base">
        <span class="text-surface-200">Total: <span class="text-energy-400 font-bold">{{ data.total_cost?.toFixed(2) }} €</span></span>
        <span class="text-surface-200">Consumo: <span class="text-white font-semibold">{{ data.total_kwh?.toFixed(1) }} kWh</span></span>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center h-48">
      <div class="animate-spin w-6 h-6 border-2 border-primary-400 border-t-transparent rounded-full"></div>
    </div>

    <v-chart v-else-if="chartOption" :option="chartOption" :autoresize="true" style="width: 100%; height: 320px" />

    <div v-else class="text-center py-8">
      <p class="text-surface-500 text-sm">No hay datos de coste disponibles</p>
    </div>

    <!-- Period Legend -->
    <div v-if="data" class="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-surface-700/50">
      <span v-for="p in legendPeriods" :key="p.period" class="flex items-center gap-1.5 text-sm text-surface-200">
        <span class="w-2.5 h-2.5 rounded-sm" :style="{ backgroundColor: p.color }"></span>
        {{ p.period }} {{ p.label }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, GridComponent } from 'echarts/components'
import api from '@/services/api.js'

use([CanvasRenderer, BarChart, TitleComponent, TooltipComponent, GridComponent])

const props = defineProps({
  factoryId: { type: String, required: true }
})

const data = ref(null)
const loading = ref(true)

const periodColors = { P1: '#ef4444', P2: '#f97316', P3: '#eab308', P4: '#22c55e', P5: '#06b6d4', P6: '#6366f1' }
const periodLabels = { P1: 'Punta', P2: 'Llano Alto', P3: 'Llano', P4: 'Valle Alto', P5: 'Valle', P6: 'Super Valle' }

const legendPeriods = computed(() => {
  if (!data.value?.hours) return []
  const seen = new Set()
  return data.value.hours
    .filter(h => { if (seen.has(h.period)) return false; seen.add(h.period); return true })
    .map(h => ({ period: h.period, label: periodLabels[h.period], color: periodColors[h.period] }))
})

const chartOption = computed(() => {
  if (!data.value?.hours) return null

  const hours = data.value.hours
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0', fontSize: 14 },
      formatter: (params) => {
        const d = params[0]
        const h = hours[d.dataIndex]
        return `<b>${d.name}</b><br/>
          Periodo: <span style="color:${h.color}">● ${h.period} (${h.period_label})</span><br/>
          Consumo: ${h.kwh.toFixed(2)} kWh<br/>
          Precio: ${h.price_kwh.toFixed(4)} €/kWh<br/>
          <b>Coste: ${h.cost.toFixed(2)} €</b>`
      }
    },
    grid: { left: '8%', right: '3%', top: '8%', bottom: '12%' },
    xAxis: {
      type: 'category',
      data: hours.map(h => `${h.hour.toString().padStart(2, '0')}:00`),
      axisLabel: { color: '#cbd5e1', fontSize: 14 },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      name: '€',
      nameTextStyle: { color: '#cbd5e1', fontSize: 14 },
      axisLabel: { color: '#cbd5e1', fontSize: 14, formatter: v => v.toFixed(2) },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series: [{
      type: 'bar',
      data: hours.map(h => ({
        value: h.cost,
        itemStyle: { color: h.color, borderRadius: [3, 3, 0, 0] },
      })),
      barWidth: '60%',
    }],
    animationDuration: 600,
  }
})

onMounted(async () => {
  try {
    const res = await api.get(`/factories/${props.factoryId}/cost/daily`)
    data.value = res.data.data
  } catch (e) { /* no contract or no data */ }
  loading.value = false
})
</script>
