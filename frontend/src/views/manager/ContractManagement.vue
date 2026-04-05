<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h3 class="text-lg font-semibold text-white">{{ t('nav.contracts') }}</h3>
      <button v-if="authStore.hasRole('manager')" class="btn-primary" @click="showCreate = true">
        + {{ t('common.create') }}
      </button>
    </div>
    <div class="glass-card overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-surface-700 text-surface-400">
            <th class="text-left p-4 font-medium">Proveedor</th>
            <th class="text-left p-4 font-medium">Nº Contrato</th>
            <th class="text-left p-4 font-medium">Fábrica</th>
            <th class="text-left p-4 font-medium">€/kWh</th>
            <th class="text-left p-4 font-medium">Potencia (kW)</th>
            <th class="text-left p-4 font-medium">{{ t('common.status') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in contracts" :key="c.id" class="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
            <td class="p-4 text-white">{{ c.provider }}</td>
            <td class="p-4 text-surface-300">{{ c.contract_number || '—' }}</td>
            <td class="p-4 text-surface-300">{{ c.factory_name || 'Empresa' }}</td>
            <td class="p-4 text-energy-400 font-semibold">{{ c.price_kwh_default }}€</td>
            <td class="p-4 text-surface-300">{{ c.contracted_power_kw || '—' }}</td>
            <td class="p-4">
              <span class="badge" :class="c.is_active ? 'badge-energy' : 'badge-warning'">
                {{ c.is_active ? t('common.active') : t('common.inactive') }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.store.js'
import api from '@/services/api.js'

const { t } = useI18n()
const authStore = useAuthStore()
const contracts = ref([])
const showCreate = ref(false)

onMounted(async () => {
  const response = await api.get('/contracts')
  contracts.value = response.data.data
})
</script>
