<template>
  <BaseModal v-model="show" :title="editMode ? 'Editar Dispositivo' : 'Añadir Dispositivo'" size="md">
    <form @submit.prevent="handleSubmit" class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Nombre *</label>
          <input v-model="form.name" type="text" class="input" placeholder="Compresor 1" required />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Tipo *</label>
          <select v-model="form.device_type" class="input" required>
            <option value="master">{{ t('devices.type.master') }}</option>
            <option value="trifasica">{{ t('devices.type.trifasica') }}</option>
            <option value="monofasica">{{ t('devices.type.monofasica') }}</option>
          </select>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Dirección Modbus *</label>
          <input v-model.number="form.modbus_address" type="number" min="1" max="247" class="input" placeholder="1" required />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Modelo</label>
          <input v-model="form.model" type="text" class="input" placeholder="EM340" />
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-surface-300 mb-1.5">Número de Serie</label>
        <input v-model="form.serial_number" type="text" class="input" placeholder="SN-12345" />
      </div>
      <div>
        <label class="block text-sm font-medium text-surface-300 mb-1.5">Descripción</label>
        <textarea v-model="form.description" rows="2" class="input" placeholder="Descripción del equipo…"></textarea>
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
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import api from '@/services/api.js'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  factoryId: { type: String, required: true },
  device: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'created', 'updated'])

const { t } = useI18n()
const loading = ref(false)
const error = ref('')

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const editMode = computed(() => !!props.device)

const form = ref({
  name: '', device_type: 'trifasica', modbus_address: 1,
  model: '', serial_number: '', description: '',
})

watch(() => props.device, (d) => {
  if (d) {
    form.value = { name: d.name, device_type: d.device_type, modbus_address: d.modbus_address, model: d.model || '', serial_number: d.serial_number || '', description: d.description || '' }
  } else {
    form.value = { name: '', device_type: 'trifasica', modbus_address: 1, model: '', serial_number: '', description: '' }
  }
}, { immediate: true })

const handleSubmit = async () => {
  error.value = ''
  loading.value = true
  try {
    if (editMode.value) {
      await api.put(`/factories/${props.factoryId}/devices/${props.device.id}`, form.value)
      emit('updated')
    } else {
      const res = await api.post(`/factories/${props.factoryId}/devices`, form.value)
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
