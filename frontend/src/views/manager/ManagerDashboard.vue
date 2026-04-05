<template>
  <div>
    <!-- This view auto-redirects to the selected factory -->
    <div v-if="loading" class="text-center py-12">
      <div class="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
      <p class="text-surface-400 text-sm">Cargando fábricas...</p>
    </div>

    <!-- Factory Cards Grid (fallback / multiple factories) -->
    <div v-else-if="factories.length > 1" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
      <h3 class="col-span-full text-surface-400 text-sm font-medium mb-1">Selecciona una planta para comenzar</h3>
      <router-link
        v-for="factory in factories"
        :key="factory.id"
        :to="`/factory/${factory.id}`"
        class="glass-card glass-card-hover p-5 block"
      >
        <div class="flex items-start justify-between mb-3">
          <div>
            <h3 class="text-white font-semibold text-lg">{{ factory.name }}</h3>
            <p class="text-surface-400 text-sm">{{ factory.city || factory.location_address || '—' }}</p>
          </div>
          <span class="badge" :class="factory.active_alarms > 0 ? 'badge-alarm' : 'badge-energy'">
            {{ factory.active_alarms > 0 ? `${factory.active_alarms} alarmas` : 'OK' }}
          </span>
        </div>
        <div class="flex items-center gap-4 text-sm text-surface-300">
          <div class="flex items-center gap-1.5">
            <svg class="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {{ factory.device_count || 0 }} {{ t('nav.devices') }}
          </div>
        </div>
      </router-link>
    </div>

    <!-- Empty State -->
    <div v-else-if="factories.length === 0" class="glass-card p-12 text-center">
      <p class="text-surface-400 text-lg">{{ t('common.noData') }}</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useFactoryStore } from '@/stores/factory.store.js'

const { t } = useI18n()
const router = useRouter()
const factoryStore = useFactoryStore()
const factories = computed(() => factoryStore.factories)
const loading = computed(() => factoryStore.loading)

onMounted(async () => {
  await factoryStore.fetchFactories()
  
  // Auto-redirect to the selected (or first) factory
  const fid = factoryStore.selectedFactoryId
  if (fid) {
    router.replace(`/factory/${fid}`)
  } else if (factoryStore.factories.length === 1) {
    // Only one factory: go straight there
    router.replace(`/factory/${factoryStore.factories[0].id}`)
  }
  // If multiple factories and none selected, show the cards grid
})
</script>
