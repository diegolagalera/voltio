<template>
  <div>
    <!-- Header -->
    <div class="mb-6">
      <h2 class="text-2xl font-bold text-white">Configuración</h2>
      <p class="text-surface-400 text-sm">{{ factory?.name || '' }}</p>
    </div>

    <!-- Settings Grid -->
    <div class="space-y-6">
      <!-- Row 1: MQTT + Factory Info -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MqttCredentialsPanel :factory-id="factoryId" />

        <!-- Factory Info Card -->
        <div class="glass-card p-5 space-y-4">
          <h4 class="text-white font-semibold flex items-center gap-2">
            <svg class="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            Información de la Fábrica
          </h4>

          <div class="space-y-3">
            <div class="bg-surface-800/50 rounded-lg p-3">
              <p class="text-surface-500 text-[10px] uppercase tracking-wider">Nombre</p>
              <p class="text-white text-sm">{{ factory?.name || '—' }}</p>
            </div>
            <div class="bg-surface-800/50 rounded-lg p-3">
              <p class="text-surface-500 text-[10px] uppercase tracking-wider">Ubicación</p>
              <p class="text-white text-sm">{{ factory?.location_address || factory?.city || '—' }}</p>
            </div>
            <div class="bg-surface-800/50 rounded-lg p-3">
              <p class="text-surface-500 text-[10px] uppercase tracking-wider">Empresa</p>
              <p class="text-white text-sm">{{ factory?.company_name || '—' }}</p>
            </div>
            <div class="bg-surface-800/50 rounded-lg p-3">
              <p class="text-surface-500 text-[10px] uppercase tracking-wider">Zona Horaria</p>
              <p class="text-white text-sm">{{ factory?.timezone || 'Europe/Madrid' }}</p>
            </div>
            <div class="bg-surface-800/50 rounded-lg p-3">
              <p class="text-surface-500 text-[10px] uppercase tracking-wider mb-1">Comunidad Autónoma</p>
              <select
                :value="factory?.comunidad_autonoma || 'nacional'"
                @change="saveComunidad($event.target.value)"
                class="input w-full text-sm"
              >
                <option value="nacional">Nacional (sin regional)</option>
                <option value="pais_vasco">País Vasco</option>
                <option value="cataluna">Cataluña</option>
                <option value="madrid">Madrid</option>
                <option value="andalucia">Andalucía</option>
                <option value="valencia">C. Valenciana</option>
                <option value="galicia">Galicia</option>
                <option value="aragon">Aragón</option>
                <option value="castilla_leon">Castilla y León</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Row 2: Contract Config (full width) -->
      <ContractConfigPanel :factory-id="factoryId" />

      <!-- Row 3: Holidays (filtered by factory region) -->
      <HolidaysPanel :region="factory?.comunidad_autonoma || 'nacional'" />

      <!-- Row 4: Device Discovery (full width) -->
      <DeviceDiscoveryPanel :factory-id="factoryId" @device-confirmed="onDeviceConfirmed" />

      <!-- Row 5: Device Hierarchy (full width) -->
      <DeviceHierarchyPanel :factory-id="factoryId" />
    </div>
  </div>
</template>

<script setup>
import { onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useFactoryStore } from '@/stores/factory.store.js'
import MqttCredentialsPanel from '@/components/factory/MqttCredentialsPanel.vue'
import DeviceDiscoveryPanel from '@/components/factory/DeviceDiscoveryPanel.vue'
import DeviceHierarchyPanel from '@/components/factory/DeviceHierarchyPanel.vue'
import ContractConfigPanel from '@/components/factory/ContractConfigPanel.vue'
import HolidaysPanel from '@/components/factory/HolidaysPanel.vue'
import api from '@/services/api.js'

const route = useRoute()
const factoryStore = useFactoryStore()
const factoryId = route.params.factoryId

const factory = computed(() => factoryStore.currentFactory)

const onDeviceConfirmed = () => {
  factoryStore.fetchFactory(factoryId)
}

const saveComunidad = async (value) => {
  try {
    await api.patch(`/factories/${factoryId}`, { comunidad_autonoma: value })
    await factoryStore.fetchFactory(factoryId)
  } catch (e) {
    console.error('Error saving comunidad:', e)
  }
}

onMounted(async () => {
  await factoryStore.fetchFactory(factoryId)
})
</script>
