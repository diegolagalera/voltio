<template>
  <div class="glass-card p-5 space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h4 class="text-white font-semibold flex items-center gap-2">
        <svg class="w-5 h-5 text-energy-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        Dispositivos Detectados
      </h4>
      <button
        @click="triggerScan"
        :disabled="scanning"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        :class="scanning
          ? 'bg-surface-700 text-surface-400 cursor-wait'
          : 'bg-energy-500/15 text-energy-400 hover:bg-energy-500/25'"
      >
        <svg
          class="w-4 h-4"
          :class="{ 'animate-spin': scanning }"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {{ scanning ? 'Escaneando...' : 'Escanear Red' }}
      </button>
    </div>

    <!-- Scanning Progress -->
    <div v-if="scanning" class="bg-energy-500/10 border border-energy-500/20 rounded-lg p-3">
      <div class="flex items-center gap-2 text-energy-400 text-sm">
        <div class="w-2 h-2 rounded-full bg-energy-400 animate-pulse"></div>
        Escaneando rango 192.168.10.10 — 192.168.10.50 (puerto 502)…
      </div>
    </div>

    <!-- Pending Devices -->
    <div v-if="pendingDevices.length > 0" class="space-y-2">
      <p class="text-surface-400 text-xs uppercase tracking-wider">
        {{ pendingDevices.length }} dispositivo{{ pendingDevices.length > 1 ? 's' : '' }} pendiente{{ pendingDevices.length > 1 ? 's' : '' }}
      </p>
      <div
        v-for="device in pendingDevices"
        :key="device.id"
        class="bg-warning-500/10 border border-warning-500/20 rounded-lg p-3 space-y-2"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-warning-400 animate-pulse"></span>
            <span class="text-white text-sm font-medium">{{ device.detected_model || 'Desconocido' }}</span>
            <span class="badge badge-warning text-[10px]">{{ device.detected_type === 'trifasica' ? 'Trifásica' : 'Monofásica' }}</span>
          </div>
          <span class="text-surface-400 text-xs">{{ device.ip_address }}:{{ device.port }}</span>
        </div>

        <div class="flex items-center gap-2 text-xs text-surface-400">
          <span v-if="device.voltage_sample">⚡ {{ device.voltage_sample }}V</span>
          <span>Modbus addr: {{ device.modbus_address }}</span>
          <span>Detectado: {{ formatDate(device.discovered_at) }}</span>
        </div>

        <div class="flex items-center gap-2 pt-1">
          <button
            @click="openConfirmModal(device)"
            class="flex-1 px-3 py-1.5 bg-energy-600 hover:bg-energy-500 text-white text-xs font-medium rounded-lg transition-colors"
          >
            ✓ Confirmar
          </button>
          <button
            @click="ignoreDevice(device.id)"
            class="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300 text-xs rounded-lg transition-colors"
          >
            Ignorar
          </button>
        </div>
      </div>
    </div>

    <!-- Confirmed Devices -->
    <div v-if="confirmedDevices.length > 0" class="space-y-2">
      <p class="text-surface-400 text-xs uppercase tracking-wider">
        {{ confirmedDevices.length }} dispositivo{{ confirmedDevices.length > 1 ? 's' : '' }} activo{{ confirmedDevices.length > 1 ? 's' : '' }}
      </p>
      <div
        v-for="device in confirmedDevices"
        :key="device.id"
        class="bg-surface-800/50 rounded-lg p-3 flex items-center justify-between"
      >
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-energy-400"></span>
          <span class="text-white text-sm">{{ device.confirmed_device_name || device.detected_model }}</span>
          <span class="text-surface-500 text-xs">{{ device.ip_address }}</span>
        </div>
        <span class="text-energy-400 text-xs">✓ Activo</span>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="!loading && !scanning && discoveries.length === 0" class="text-center py-6">
      <svg class="w-8 h-8 text-surface-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      <p class="text-surface-500 text-sm">No se han detectado dispositivos</p>
      <p class="text-surface-600 text-xs mt-1">Pulsa "Escanear Red" para buscar medidores</p>
    </div>

    <!-- Confirm Modal -->
    <div v-if="showConfirmModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="showConfirmModal = false">
      <div class="bg-surface-900 border border-surface-700 rounded-xl p-6 w-full max-w-md shadow-2xl space-y-4">
        <h5 class="text-white font-semibold text-lg">Confirmar Dispositivo</h5>
        <p class="text-surface-400 text-sm">
          {{ selectedDevice?.detected_model }} en {{ selectedDevice?.ip_address }} ({{ selectedDevice?.voltage_sample }}V)
        </p>

        <div class="space-y-3">
          <div>
            <label class="text-surface-400 text-xs block mb-1">Nombre del dispositivo *</label>
            <input
              v-model="confirmForm.name"
              type="text"
              placeholder="Ej: Fresadora CNC Nave 2"
              class="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-white text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="text-surface-400 text-xs block mb-1">Tipo</label>
            <select
              v-model="confirmForm.device_type"
              class="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-white text-sm focus:border-primary-500 focus:outline-none"
            >
              <option value="trifasica">Trifásica (EM340 / EM24)</option>
              <option value="monofasica">Monofásica (EM111)</option>
            </select>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-2">
          <button
            @click="confirmDevice"
            :disabled="!confirmForm.name.trim() || confirming"
            class="flex-1 px-4 py-2 bg-energy-600 hover:bg-energy-500 disabled:bg-surface-700 disabled:text-surface-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {{ confirming ? 'Guardando...' : 'Confirmar y Activar' }}
          </button>
          <button
            @click="showConfirmModal = false"
            class="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm rounded-lg transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api.js'

const props = defineProps({
  factoryId: { type: String, required: true }
})

const emit = defineEmits(['device-confirmed'])

const discoveries = ref([])
const loading = ref(false)
const scanning = ref(false)
const showConfirmModal = ref(false)
const selectedDevice = ref(null)
const confirming = ref(false)
const confirmForm = ref({ name: '', device_type: 'trifasica' })

const pendingDevices = computed(() => discoveries.value.filter(d => d.status === 'pending'))
const confirmedDevices = computed(() => discoveries.value.filter(d => d.status === 'confirmed'))

const fetchDiscoveries = async () => {
  loading.value = true
  try {
    const res = await api.get(`/discovery/${props.factoryId}/discoveries`)
    discoveries.value = res.data.data || []
  } catch (err) {
    console.error('Error fetching discoveries:', err)
  } finally {
    loading.value = false
  }
}

const triggerScan = async () => {
  scanning.value = true
  try {
    await api.post(`/discovery/${props.factoryId}/scan`)
    // Poll for results after a few seconds
    setTimeout(async () => {
      await fetchDiscoveries()
      scanning.value = false
    }, 8000)
  } catch (err) {
    console.error('Error triggering scan:', err)
    scanning.value = false
  }
}

const openConfirmModal = (device) => {
  selectedDevice.value = device
  confirmForm.value = {
    name: '',
    device_type: device.detected_type || 'trifasica',
  }
  showConfirmModal.value = true
}

const confirmDevice = async () => {
  if (!confirmForm.value.name.trim()) return
  confirming.value = true
  try {
    await api.post(
      `/discovery/${props.factoryId}/discoveries/${selectedDevice.value.id}/confirm`,
      confirmForm.value,
    )
    showConfirmModal.value = false
    await fetchDiscoveries()
    emit('device-confirmed')
  } catch (err) {
    console.error('Error confirming device:', err)
    alert(err.response?.data?.message || 'Error al confirmar dispositivo')
  } finally {
    confirming.value = false
  }
}

const ignoreDevice = async (discoveryId) => {
  try {
    await api.post(`/discovery/${props.factoryId}/discoveries/${discoveryId}/ignore`)
    await fetchDiscoveries()
  } catch (err) {
    console.error('Error ignoring device:', err)
  }
}

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

onMounted(fetchDiscoveries)
</script>
