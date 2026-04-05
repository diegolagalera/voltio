<template>
  <div class="glass-card p-5 space-y-4">
    <div class="flex items-center justify-between">
      <h4 class="text-white font-semibold flex items-center gap-2">
        <svg class="w-5 h-5 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Festivos · Calendario Tarifario
      </h4>
      <button @click="showAdd = !showAdd" class="btn-secondary text-xs px-3 py-1.5">
        {{ showAdd ? 'Cancelar' : '+ Añadir Festivo' }}
      </button>
    </div>

    <p class="text-surface-400 text-xs">
      Los festivos se tratan como fines de semana (P6 todo el día = tarifa más barata).
      Mostrando: <span class="text-white font-medium">nacionales</span>
      <template v-if="region && region !== 'nacional'">
        + <span class="text-primary-400 font-medium">{{ regionLabels[region] || region }}</span>
      </template>
    </p>

    <!-- Add Form -->
    <div v-if="showAdd" class="bg-surface-800/50 rounded-lg p-4 space-y-3">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label class="block text-surface-400 text-xs mb-1">Fecha *</label>
          <input v-model="newHoliday.date" type="date" required class="input w-full" />
        </div>
        <div>
          <label class="block text-surface-400 text-xs mb-1">Nombre *</label>
          <input v-model="newHoliday.name" type="text" required class="input w-full" placeholder="San Ignacio" />
        </div>
        <div>
          <label class="block text-surface-400 text-xs mb-1">Región</label>
          <select v-model="newHoliday.region" class="input w-full">
            <option value="nacional">Nacional</option>
            <option value="pais_vasco">País Vasco</option>
            <option value="cataluna">Cataluña</option>
            <option value="madrid">Madrid</option>
            <option value="andalucia">Andalucía</option>
            <option value="valencia">C. Valenciana</option>
            <option value="galicia">Galicia</option>
            <option value="aragon">Aragón</option>
            <option value="castilla_leon">Castilla y León</option>
            <option value="other">Otra</option>
          </select>
        </div>
      </div>
      <div class="flex justify-end">
        <button @click="addHoliday" :disabled="!newHoliday.date || !newHoliday.name" class="btn-primary text-xs px-4 py-1.5">
          Añadir
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-4">
      <div class="animate-spin w-5 h-5 border-2 border-primary-400 border-t-transparent rounded-full mx-auto"></div>
    </div>

    <!-- Holidays grouped by year -->
    <div v-else-if="groupedHolidays.length" class="space-y-4">
      <div v-for="group in groupedHolidays" :key="group.year">
        <p class="text-white text-sm font-semibold mb-2">{{ group.year }}</p>
        <div class="space-y-1">
          <div v-for="h in group.items" :key="h.id" class="flex items-center justify-between bg-surface-800/30 rounded-lg px-3 py-2 group">
            <div class="flex items-center gap-3">
              <span class="text-surface-400 text-xs font-mono w-20">{{ formatDate(h.date) }}</span>
              <span class="text-white text-sm">{{ h.name }}</span>
              <span class="badge badge-info text-[10px]">{{ regionLabels[h.region] || h.region }}</span>
            </div>
            <button @click="deleteHoliday(h.id)" class="text-surface-500 hover:text-alarm-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs">
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="text-center py-4">
      <p class="text-surface-500 text-sm">No hay festivos configurados</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api.js'

const props = defineProps({
  region: { type: String, default: 'nacional' }
})

const holidays = ref([])
const loading = ref(true)
const showAdd = ref(false)

const newHoliday = ref({ date: '', name: '', region: props.region || 'nacional' })

const regionLabels = {
  nacional: 'Nacional',
  pais_vasco: 'País Vasco',
  cataluna: 'Cataluña',
  madrid: 'Madrid',
  andalucia: 'Andalucía',
  valencia: 'C. Valenciana',
  galicia: 'Galicia',
  aragon: 'Aragón',
  castilla_leon: 'Castilla y León',
  other: 'Otra',
}

const groupedHolidays = computed(() => {
  const groups = {}
  // Filter: show national + factory's region
  const filtered = holidays.value.filter(h => {
    if (!h.region || h.region === 'nacional' || h.region === 'national') return true
    return h.region === props.region
  })
  for (const h of filtered) {
    const year = new Date(h.date).getFullYear()
    if (!groups[year]) groups[year] = []
    groups[year].push(h)
  }
  return Object.entries(groups)
    .sort(([a], [b]) => b - a)
    .map(([year, items]) => ({ year, items: items.sort((a, b) => new Date(a.date) - new Date(b.date)) }))
})

const formatDate = (dateStr) => {
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

const fetchHolidays = async () => {
  loading.value = true
  try {
    const res = await api.get('/holidays')
    holidays.value = res.data.data || []
  } catch (e) { console.warn('No holidays endpoint yet') }
  loading.value = false
}

const addHoliday = async () => {
  try {
    await api.post('/holidays', newHoliday.value)
    newHoliday.value = { date: '', name: '', region: 'nacional' }
    showAdd.value = false
    await fetchHolidays()
  } catch (e) {
    alert(e.response?.data?.error || 'Error al añadir festivo')
  }
}

const deleteHoliday = async (id) => {
  if (!confirm('¿Eliminar este festivo?')) return
  try {
    await api.delete(`/holidays/${id}`)
    await fetchHolidays()
  } catch (e) {
    alert('Error al eliminar festivo')
  }
}

onMounted(fetchHolidays)
</script>
