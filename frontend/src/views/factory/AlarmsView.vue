<template>
  <div class="space-y-6 animate-fade-in">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold text-white">{{ t('alarms.title') }}</h2>
      <div class="flex gap-2">
        <button
          @click="filter = 'active'"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="filter === 'active' ? 'bg-alarm-500/20 text-alarm-400' : 'text-surface-400 hover:text-white bg-surface-700'"
        >
          {{ t('alarms.active') }}
        </button>
        <button
          @click="filter = 'acknowledged'"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="filter === 'acknowledged' ? 'bg-energy-500/20 text-energy-400' : 'text-surface-400 hover:text-white bg-surface-700'"
        >
          {{ t('alarms.acknowledged') }}
        </button>
        <button
          @click="filter = 'all'"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="filter === 'all' ? 'bg-primary-500/20 text-primary-400' : 'text-surface-400 hover:text-white bg-surface-700'"
        >
          Todas
        </button>
      </div>
    </div>

    <!-- Alarms List -->
    <div class="space-y-3">
      <div
        v-for="alarm in filteredAlarms"
        :key="alarm.id"
        class="glass-card p-4 flex items-center justify-between"
        :class="{
          'border-l-4 border-l-alarm-500': alarm.severity === 'critical' && !alarm.acknowledged,
          'border-l-4 border-l-warning-500': alarm.severity === 'warning' && !alarm.acknowledged,
          'border-l-4 border-l-primary-500': alarm.severity === 'info' && !alarm.acknowledged,
          'opacity-60': alarm.acknowledged,
        }"
      >
        <div class="flex items-center gap-4">
          <!-- Severity Icon -->
          <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            :class="{
              'bg-alarm-500/15': alarm.severity === 'critical',
              'bg-warning-500/15': alarm.severity === 'warning',
              'bg-primary-500/15': alarm.severity === 'info',
            }">
            <svg v-if="alarm.severity === 'critical'" class="w-5 h-5 text-alarm-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <svg v-else class="w-5 h-5" :class="alarm.severity === 'warning' ? 'text-warning-400' : 'text-primary-400'" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <!-- Alarm Info -->
          <div>
            <div class="flex items-center gap-2 mb-0.5">
              <span class="badge" :class="{
                'badge-alarm': alarm.severity === 'critical',
                'badge-warning': alarm.severity === 'warning',
                'badge-info': alarm.severity === 'info',
              }">
                {{ t(`alarms.severity.${alarm.severity}`) }}
              </span>
              <span class="text-surface-500 text-xs">{{ alarm.alarm_type }}</span>
            </div>
            <p class="text-white text-sm">{{ alarm.message }}</p>
            <p class="text-surface-500 text-xs mt-1">
              {{ alarm.device_name || 'Dispositivo' }}
              · {{ formatDate(alarm.triggered_at) }}
            </p>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-3 shrink-0">
          <p v-if="alarm.value_detected" class="text-surface-300 text-sm font-mono">
            {{ parseFloat(alarm.value_detected).toFixed(1) }}
          </p>
          <button
            v-if="!alarm.acknowledged"
            @click="acknowledge(alarm.id)"
            class="btn-secondary text-xs px-3 py-1.5"
          >
            {{ t('alarms.acknowledge') }}
          </button>
          <span v-else class="text-energy-400 text-xs flex items-center gap-1">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            OK
          </span>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="filteredAlarms.length === 0" class="glass-card p-12 text-center">
      <svg class="w-16 h-16 text-surface-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
      <p class="text-surface-400 text-lg">Sin alarmas {{ filter === 'active' ? 'activas' : '' }}</p>
      <p class="text-surface-500 text-sm mt-1">Todo funciona correctamente</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/services/api.js'

const { t } = useI18n()
const route = useRoute()
const factoryId = route.params.factoryId

const alarms = ref([])
const filter = ref('active')

const filteredAlarms = computed(() => {
  if (filter.value === 'active') return alarms.value.filter(a => !a.acknowledged)
  if (filter.value === 'acknowledged') return alarms.value.filter(a => a.acknowledged)
  return alarms.value
})

const formatDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const acknowledge = async (alarmId) => {
  try {
    await api.put(`/alarms/${alarmId}/acknowledge`)
    const alarm = alarms.value.find(a => a.id === alarmId)
    if (alarm) alarm.acknowledged = true
  } catch (e) {
    console.error('Error acknowledging alarm:', e)
  }
}

onMounted(async () => {
  try {
    const res = await api.get(`/alarms/factory/${factoryId}`)
    alarms.value = res.data.data
  } catch {
    alarms.value = []
  }
})
</script>
