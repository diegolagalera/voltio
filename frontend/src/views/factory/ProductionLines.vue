<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white">Líneas de Producción</h1>
        <p class="text-surface-400 text-sm mt-1">Agrupa dispositivos para calcular el coste energético por producto</p>
      </div>
      <button
        v-if="canManage"
        @click="showCreateModal = true"
        class="btn-primary flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Nueva Línea
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!lines.length" class="glass-card text-center py-16 px-6">
      <div class="w-16 h-16 mx-auto rounded-2xl bg-surface-700/50 flex items-center justify-center mb-4">
        <svg class="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
        </svg>
      </div>
      <h3 class="text-white font-semibold text-lg mb-2">No hay líneas de producción</h3>
      <p class="text-surface-400 text-sm mb-6 max-w-md mx-auto">
        Crea tu primera línea de producción para monitorizar el coste energético de tus productos.
      </p>
      <button v-if="canManage" @click="showCreateModal = true" class="btn-primary px-6 py-2.5 rounded-xl text-sm font-semibold">
        Crear línea de producción
      </button>
    </div>

    <!-- Lines grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div
        v-for="line in lines"
        :key="line.id"
        @click="navigateToLine(line.id)"
        class="glass-card p-5 cursor-pointer hover:border-surface-500/50 transition-all duration-200 group"
      >
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
              :style="{ backgroundColor: line.color + '20', color: line.color }"
            >🏭</div>
            <div>
              <h3 class="text-white font-semibold group-hover:text-primary-400 transition-colors">{{ line.name }}</h3>
              <p class="text-surface-500 text-xs">{{ line.description || 'Sin descripción' }}</p>
            </div>
          </div>
          <span class="bg-surface-700/50 text-surface-400 text-xs px-2.5 py-1 rounded-full font-medium">
            {{ line.device_count || 0 }} {{ (line.device_count || 0) === 1 ? 'dispositivo' : 'dispositivos' }}
          </span>
        </div>

        <!-- Real-time power (from telemetry if available) -->
        <div class="flex items-center gap-3 mt-3 pt-3 border-t border-surface-700/50">
          <div v-if="lineRealtimePower[line.id] !== undefined" class="flex-1">
            <p class="text-surface-500 text-[10px] uppercase tracking-wider">Potencia actual</p>
            <p class="text-primary-400 font-bold text-lg">{{ formatPower(lineRealtimePower[line.id]) }}</p>
          </div>
          <div v-else class="flex-1">
            <p class="text-surface-500 text-xs">Haz clic para ver analytics</p>
          </div>
          <svg class="w-5 h-5 text-surface-600 group-hover:text-primary-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </div>

    <!-- Create/Edit Modal -->
    <Teleport to="body">
      <div v-if="showCreateModal || editingLine" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeModal"></div>
        <div class="relative bg-surface-800 border border-surface-700 rounded-2xl shadow-2xl w-full max-w-md p-6">
          <h3 class="text-white font-semibold text-lg mb-5">{{ editingLine ? 'Editar línea' : 'Nueva línea de producción' }}</h3>

          <div class="space-y-4">
            <div>
              <label class="block text-surface-400 text-xs font-semibold uppercase mb-1.5">Nombre *</label>
              <input v-model="formData.name" type="text" placeholder="Ej: Línea Armario Blanco"
                class="w-full bg-surface-700 border border-surface-600 text-white rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary-500 transition-colors" />
            </div>
            <div>
              <label class="block text-surface-400 text-xs font-semibold uppercase mb-1.5">Descripción</label>
              <textarea v-model="formData.description" rows="2" placeholder="Descripción opcional..."
                class="w-full bg-surface-700 border border-surface-600 text-white rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary-500 transition-colors resize-none"></textarea>
            </div>
            <div>
              <label class="block text-surface-400 text-xs font-semibold uppercase mb-1.5">Color</label>
              <div class="flex gap-2 flex-wrap">
                <button
                  v-for="c in colorOptions"
                  :key="c"
                  @click="formData.color = c"
                  class="w-8 h-8 rounded-lg border-2 transition-all"
                  :style="{ backgroundColor: c }"
                  :class="formData.color === c ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-100'"
                ></button>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-3 mt-6">
            <button @click="closeModal" class="px-4 py-2 text-surface-400 hover:text-white text-sm transition-colors">Cancelar</button>
            <button @click="saveLine" :disabled="!formData.name?.trim() || saving"
              class="btn-primary px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
              {{ saving ? 'Guardando...' : editingLine ? 'Guardar' : 'Crear' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store.js'
import api from '@/services/api'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const factoryId = route.params.factoryId
const lines = ref([])
const loading = ref(true)
const showCreateModal = ref(false)
const editingLine = ref(null)
const saving = ref(false)
const lineRealtimePower = ref({})

const canManage = computed(() => ['manager', 'superadmin'].includes(authStore.user?.role))

const colorOptions = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#f97316']

const formData = ref({ name: '', description: '', color: '#8b5cf6' })

const formatPower = (w) => {
  if (w == null) return '—'
  if (w > 1000) return `${(w / 1000).toFixed(1)} kW`
  return `${w.toFixed(0)} W`
}

const fetchLines = async () => {
  try {
    loading.value = true
    const res = await api.get(`/factories/${factoryId}/production-lines`)
    lines.value = res.data.data || []
  } catch (e) {
    console.error('Failed to fetch production lines:', e)
  } finally {
    loading.value = false
  }
}

const saveLine = async () => {
  if (!formData.value.name?.trim()) return
  saving.value = true
  try {
    if (editingLine.value) {
      await api.put(`/factories/${factoryId}/production-lines/${editingLine.value.id}`, formData.value)
    } else {
      await api.post(`/factories/${factoryId}/production-lines`, formData.value)
    }
    closeModal()
    await fetchLines()
  } catch (e) {
    console.error('Failed to save line:', e)
  } finally {
    saving.value = false
  }
}

const closeModal = () => {
  showCreateModal.value = false
  editingLine.value = null
  formData.value = { name: '', description: '', color: '#8b5cf6' }
}

const navigateToLine = (lineId) => {
  router.push(`/factory/${factoryId}/production-lines/${lineId}`)
}

onMounted(fetchLines)
</script>
