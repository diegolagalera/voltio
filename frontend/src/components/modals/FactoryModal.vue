<template>
  <BaseModal v-model="show" :title="editMode ? 'Editar Fábrica' : 'Crear Fábrica'" size="lg">
    <form @submit.prevent="handleSubmit" class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Nombre *</label>
          <input v-model="form.name" type="text" class="input" placeholder="Fábrica Norte" required />
        </div>
        <div v-if="!editMode">
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Empresa *</label>
          <select v-model="form.company_id" class="input" required>
            <option value="">Seleccionar empresa…</option>
            <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Dirección</label>
          <input v-model="form.location_address" type="text" class="input" placeholder="Calle Industria, 25" />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Ciudad</label>
          <input v-model="form.city" type="text" class="input" placeholder="Barcelona" />
        </div>
      </div>
      <div class="grid grid-cols-3 gap-4">
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Latitud</label>
          <input v-model.number="form.latitude" type="number" step="any" class="input" placeholder="41.3851" />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Longitud</label>
          <input v-model.number="form.longitude" type="number" step="any" class="input" placeholder="2.1734" />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Zona horaria</label>
          <div class="relative">
            <!-- Display selected value (click to open search) -->
            <button
              v-if="!tzDropdownOpen"
              type="button"
              class="input w-full text-left pr-8 flex items-center gap-2"
              @click="tzDropdownOpen = true; $nextTick(() => $refs.tzInput?.focus())"
            >
              <span class="text-white">{{ selectedTzLabel }}</span>
              <span class="text-surface-500 text-xs ml-auto">{{ selectedTzOffset }}</span>
            </button>
            <!-- Search input (shown when dropdown is open) -->
            <input
              v-else
              ref="tzInput"
              v-model="tzSearch"
              type="text"
              class="input pr-8"
              placeholder="Buscar zona horaria..."
              @blur="closeTzDropdown"
            />
            <svg class="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            <div
              v-if="tzDropdownOpen"
              class="absolute z-50 bottom-full mb-1 w-full max-h-48 overflow-y-auto bg-surface-800 border border-surface-600 rounded-lg shadow-xl"
            >
              <button
                v-for="tz in filteredTimezones"
                :key="tz.value"
                type="button"
                class="w-full text-left px-3 py-2 text-sm hover:bg-surface-700 transition-colors flex items-center justify-between"
                :class="form.timezone === tz.value ? 'text-primary-400 bg-primary-500/10' : 'text-surface-300'"
                @mousedown.prevent="selectTimezone(tz.value)"
              >
                <span>{{ tz.label }}</span>
                <span class="text-surface-500 text-xs">{{ tz.offset }}</span>
              </button>
              <p v-if="!filteredTimezones.length" class="px-3 py-2 text-surface-500 text-sm">Sin resultados</p>
            </div>
          </div>
        </div>
      </div>
      <div v-if="error" class="bg-alarm-500/15 text-alarm-400 text-sm p-3 rounded-lg">{{ error }}</div>
    </form>

    <template #footer>
      <button @click="show = false" class="btn-secondary">{{ t('common.cancel') }}</button>
      <button @click="handleSubmit" class="btn-primary" :disabled="loading">
        <svg v-if="loading" class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" opacity="0.3"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/></svg>
        {{ editMode ? t('common.save') : t('common.create') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import api from '@/services/api.js'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  factory: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'created', 'updated'])

const { t } = useI18n()
const loading = ref(false)
const error = ref('')
const companies = ref([])

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const editMode = computed(() => !!props.factory)

const form = ref({
  name: '', company_id: '', location_address: '', city: '',
  latitude: null, longitude: null, timezone: 'Europe/Madrid',
})

// ═══ Timezone Dropdown ═══
const tzSearch = ref('')
const tzDropdownOpen = ref(false)

const TIMEZONES = [
  // España
  { value: 'Europe/Madrid', label: '🇪🇸 España (Península)', offset: 'CET/CEST' },
  { value: 'Atlantic/Canary', label: '🇪🇸 España (Canarias)', offset: 'WET/WEST' },
  // Europa
  { value: 'Europe/London', label: '🇬🇧 Reino Unido', offset: 'GMT/BST' },
  { value: 'Europe/Paris', label: '🇫🇷 Francia', offset: 'CET/CEST' },
  { value: 'Europe/Berlin', label: '🇩🇪 Alemania', offset: 'CET/CEST' },
  { value: 'Europe/Rome', label: '🇮🇹 Italia', offset: 'CET/CEST' },
  { value: 'Europe/Lisbon', label: '🇵🇹 Portugal', offset: 'WET/WEST' },
  { value: 'Europe/Amsterdam', label: '🇳🇱 Países Bajos', offset: 'CET/CEST' },
  { value: 'Europe/Brussels', label: '🇧🇪 Bélgica', offset: 'CET/CEST' },
  { value: 'Europe/Warsaw', label: '🇵🇱 Polonia', offset: 'CET/CEST' },
  { value: 'Europe/Bucharest', label: '🇷🇴 Rumanía', offset: 'EET/EEST' },
  { value: 'Europe/Istanbul', label: '🇹🇷 Turquía', offset: 'TRT' },
  { value: 'Europe/Moscow', label: '🇷🇺 Moscú', offset: 'MSK' },
  // Americas
  { value: 'America/New_York', label: '🇺🇸 Este EEUU (New York)', offset: 'EST/EDT' },
  { value: 'America/Chicago', label: '🇺🇸 Centro EEUU (Chicago)', offset: 'CST/CDT' },
  { value: 'America/Denver', label: '🇺🇸 Montaña EEUU (Denver)', offset: 'MST/MDT' },
  { value: 'America/Los_Angeles', label: '🇺🇸 Pacífico EEUU (LA)', offset: 'PST/PDT' },
  { value: 'America/Mexico_City', label: '🇲🇽 México (Ciudad)', offset: 'CST' },
  { value: 'America/Bogota', label: '🇨🇴 Colombia', offset: 'COT' },
  { value: 'America/Sao_Paulo', label: '🇧🇷 Brasil (São Paulo)', offset: 'BRT' },
  { value: 'America/Argentina/Buenos_Aires', label: '🇦🇷 Argentina', offset: 'ART' },
  { value: 'America/Santiago', label: '🇨🇱 Chile', offset: 'CLT/CLST' },
  // Asia-Pacífico
  { value: 'Asia/Dubai', label: '🇦🇪 Emiratos Árabes', offset: 'GST' },
  { value: 'Asia/Kolkata', label: '🇮🇳 India', offset: 'IST' },
  { value: 'Asia/Shanghai', label: '🇨🇳 China', offset: 'CST' },
  { value: 'Asia/Tokyo', label: '🇯🇵 Japón', offset: 'JST' },
  { value: 'Asia/Seoul', label: '🇰🇷 Corea del Sur', offset: 'KST' },
  { value: 'Asia/Singapore', label: '🇸🇬 Singapur', offset: 'SGT' },
  { value: 'Australia/Sydney', label: '🇦🇺 Australia (Sídney)', offset: 'AEST/AEDT' },
  // África
  { value: 'Africa/Casablanca', label: '🇲🇦 Marruecos', offset: 'WET/WEST' },
  { value: 'Africa/Lagos', label: '🇳🇬 Nigeria', offset: 'WAT' },
  { value: 'Africa/Johannesburg', label: '🇿🇦 Sudáfrica', offset: 'SAST' },
]

const selectedTz = computed(() => TIMEZONES.find(tz => tz.value === form.value.timezone))
const selectedTzLabel = computed(() => selectedTz.value?.label || form.value.timezone)
const selectedTzOffset = computed(() => selectedTz.value?.offset || '')

const filteredTimezones = computed(() => {
  if (!tzSearch.value) return TIMEZONES
  const q = tzSearch.value.toLowerCase()
  return TIMEZONES.filter(tz =>
    tz.label.toLowerCase().includes(q) ||
    tz.value.toLowerCase().includes(q) ||
    tz.offset.toLowerCase().includes(q)
  )
})

const selectTimezone = (value) => {
  form.value.timezone = value
  tzSearch.value = ''
  tzDropdownOpen.value = false
}

const closeTzDropdown = () => {
  // Small delay to allow button mousedown to fire before blur closes it
  setTimeout(() => { tzDropdownOpen.value = false; tzSearch.value = '' }, 150)
}

watch(() => props.factory, (f) => {
  if (f) {
    form.value = { name: f.name, company_id: f.company_id, location_address: f.location_address || '', city: f.city || '', latitude: f.latitude, longitude: f.longitude, timezone: f.timezone || 'Europe/Madrid' }
  } else {
    form.value = { name: '', company_id: '', location_address: '', city: '', latitude: null, longitude: null, timezone: 'Europe/Madrid' }
  }
  tzSearch.value = ''
}, { immediate: true })

onMounted(async () => {
  try {
    const res = await api.get('/superadmin/companies')
    companies.value = res.data.data
  } catch { /* ignore */ }
})

const handleSubmit = async () => {
  error.value = ''
  loading.value = true
  try {
    if (editMode.value) {
      await api.put(`/superadmin/factories/${props.factory.id}`, form.value)
      emit('updated')
    } else {
      const res = await api.post(`/superadmin/companies/${form.value.company_id}/factories`, form.value)
      emit('created', res.data.data)
    }
    show.value = false
  } catch (e) {
    error.value = e.response?.data?.message || 'Error al guardar'
  } finally {
    loading.value = false
  }
}
</script>
