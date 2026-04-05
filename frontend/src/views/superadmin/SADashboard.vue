<template>
  <div class="space-y-6 animate-fade-in">
    <!-- Stats Cards -->
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <div v-for="stat in stats" :key="stat.label" class="glass-card p-5">
        <p class="text-surface-400 text-xs uppercase tracking-wider mb-1">{{ stat.label }}</p>
        <p class="text-3xl font-bold" :class="stat.color || 'text-white'">{{ stat.value }}</p>
      </div>
    </div>

    <!-- Recent Factories -->
    <div class="glass-card p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-white">Fábricas Activas</h3>
        <router-link to="/superadmin/factories" class="text-primary-400 hover:text-primary-300 text-sm">Ver todas →</router-link>
      </div>
      <div v-if="factories.length" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <router-link
          v-for="f in factories"
          :key="f.id"
          :to="`/factory/${f.id}`"
          class="bg-surface-800/50 rounded-xl p-4 hover:bg-surface-700/50 transition-colors group"
        >
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-white font-medium group-hover:text-primary-400 transition-colors">{{ f.name }}</h4>
            <span class="badge badge-energy text-[10px]">{{ f.device_count || 0 }} equipo{{ f.device_count === 1 ? '' : 's' }}</span>
          </div>
          <p class="text-surface-400 text-xs">{{ f.company_name }} · {{ f.city || '—' }}</p>
        </router-link>
      </div>
      <p v-else class="text-surface-500 text-sm">No hay fábricas registradas.</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '@/services/api.js'

const stats = ref([])
const factories = ref([])

onMounted(async () => {
  try {
    const [statsRes, factoriesRes] = await Promise.all([
      api.get('/superadmin/stats'),
      api.get('/superadmin/factories'),
    ])
    const d = statsRes.data.data
    stats.value = [
      { label: 'Empresas', value: d.total_companies, color: 'text-white' },
      { label: 'Fábricas', value: d.total_factories, color: 'text-primary-400' },
      { label: 'Dispositivos', value: d.total_devices, color: 'text-energy-400' },
      { label: 'Usuarios', value: d.total_users, color: 'text-white' },
      { label: 'Alarmas Activas', value: d.active_alarms, color: d.active_alarms > 0 ? 'text-alarm-400' : 'text-energy-400' },
    ]
    factories.value = factoriesRes.data.data
  } catch { /* ignore */ }
})
</script>
