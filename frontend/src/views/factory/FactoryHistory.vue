<template>
  <div class="space-y-6 animate-fade-in">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold text-white">{{ t('telemetry.history') }}</h2>
      <div class="flex items-center gap-3">
        <select v-model="selectedDevice" class="input w-52" @change="loadHistory">
          <option value="">Todos los dispositivos</option>
          <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
        <select v-model="interval" class="input w-32" @change="loadHistory">
          <option value="raw">Raw (5m)</option>
          <option value="1h">Horario</option>
          <option value="1d">Diario</option>
        </select>
        <input type="date" v-model="startDate" class="input w-40" @change="loadHistory" />
        <input type="date" v-model="endDate" class="input w-40" @change="loadHistory" />
      </div>
    </div>

    <!-- Power Chart -->
    <div class="glass-card p-5">
      <h4 class="text-white font-semibold mb-3">Potencia Activa</h4>
      <v-chart :option="powerChartOption" :autoresize="true" class="h-80" />
    </div>

    <!-- Energy Chart -->
    <div class="glass-card p-5">
      <h4 class="text-white font-semibold mb-3">Energía Consumida</h4>
      <v-chart :option="energyChartOption" :autoresize="true" class="h-72" />
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
import { LineChart, BarChart } from 'echarts/charts'
import { TooltipComponent, GridComponent, DataZoomComponent, LegendComponent } from 'echarts/components'
import { useFactoryStore } from '@/stores/factory.store.js'
import api from '@/services/api.js'

use([CanvasRenderer, LineChart, BarChart, TooltipComponent, GridComponent, DataZoomComponent, LegendComponent])

const { t } = useI18n()
const route = useRoute()
const factoryStore = useFactoryStore()
const factoryId = route.params.factoryId

const devices = computed(() => factoryStore.devices)
const selectedDevice = ref('')
const interval = ref('1h')
const historyData = ref([])

const today = new Date()
const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
const startDate = ref(sevenDaysAgo.toISOString().split('T')[0])
const endDate = ref(today.toISOString().split('T')[0])

const loadHistory = async () => {
  if (!selectedDevice.value) return
  try {
    const res = await api.get(`/telemetry/${selectedDevice.value}/history`, {
      params: { start: startDate.value, end: endDate.value, interval: interval.value },
    })
    historyData.value = res.data.data || []
  } catch {
    historyData.value = []
  }
}

const powerChartOption = computed(() => ({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis', backgroundColor: '#1a2332', borderColor: '#334155', textStyle: { color: '#cbd5e1' } },
  grid: { left: 60, right: 20, top: 10, bottom: 60 },
  dataZoom: [{ type: 'slider', height: 20, bottom: 10, borderColor: '#334155', fillerColor: 'rgba(41,163,255,0.2)' }, { type: 'inside' }],
  xAxis: { type: 'time', axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b' }, splitLine: { show: false } },
  yAxis: { type: 'value', name: 'W', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
  series: [{
    name: 'Potencia', type: 'line', smooth: true, showSymbol: false,
    lineStyle: { width: 2, color: '#29a3ff' },
    areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(41,163,255,0.25)' }, { offset: 1, color: 'rgba(41,163,255,0)' }] } },
    data: historyData.value.map(d => [d.bucket || d.time, d.avg_power_w || d.power_w_total || 0]),
  }],
}))

const energyChartOption = computed(() => ({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis', backgroundColor: '#1a2332', borderColor: '#334155', textStyle: { color: '#cbd5e1' } },
  grid: { left: 60, right: 20, top: 10, bottom: 30 },
  xAxis: { type: 'category', data: historyData.value.map(d => (d.bucket || d.time)?.toString().slice(5, 16)), axisLabel: { color: '#64748b' }, axisLine: { lineStyle: { color: '#334155' } } },
  yAxis: { type: 'value', name: 'kWh', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
  series: [{
    name: 'Energía', type: 'bar',
    data: historyData.value.map(d => parseFloat(d.delta_kwh || d.total_kwh || 0)),
    itemStyle: { color: 'rgba(52,211,153,0.7)', borderRadius: [4, 4, 0, 0] },
  }],
}))

onMounted(async () => {
  if (factoryStore.devices.length === 0) await factoryStore.fetchDevices(factoryId)
  if (devices.value.length > 0) {
    selectedDevice.value = devices.value[0].id
    await loadHistory()
  }
})
</script>
