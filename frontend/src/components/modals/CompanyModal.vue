<template>
  <BaseModal v-model="show" :title="editMode ? 'Editar Empresa' : 'Crear Empresa'" size="lg">
    <form @submit.prevent="handleSubmit" class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">{{ t('company.name') }} *</label>
          <input v-model="form.name" type="text" class="input" :placeholder="t('company.name')" required />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">{{ t('company.taxId') }}</label>
          <input v-model="form.tax_id" type="text" class="input" placeholder="B12345678" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">{{ t('company.address') }}</label>
          <input v-model="form.address" type="text" class="input" :placeholder="t('company.address')" />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">{{ t('company.city') }}</label>
          <input v-model="form.city" type="text" class="input" :placeholder="t('company.city')" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">{{ t('company.phone') }}</label>
          <input v-model="form.phone" type="tel" class="input" placeholder="+34 600 000 000" />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">{{ t('company.email') }}</label>
          <input v-model="form.contact_email" type="email" class="input" placeholder="info@empresa.com" />
        </div>
      </div>

      <!-- Manager Section (only for create) -->
      <div v-if="!editMode" class="border-t border-surface-700 pt-4 mt-4">
        <h4 class="text-white font-semibold text-sm mb-3">Manager de la empresa</h4>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-surface-300 mb-1.5">Nombre *</label>
            <input v-model="manager.first_name" type="text" class="input" placeholder="Nombre" required />
          </div>
          <div>
            <label class="block text-sm font-medium text-surface-300 mb-1.5">Apellido *</label>
            <input v-model="manager.last_name" type="text" class="input" placeholder="Apellido" required />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label class="block text-sm font-medium text-surface-300 mb-1.5">Email *</label>
            <input v-model="manager.email" type="email" class="input" placeholder="manager@empresa.com" required />
          </div>
          <div>
            <label class="block text-sm font-medium text-surface-300 mb-1.5">Contraseña *</label>
            <input v-model="manager.password" type="password" class="input" placeholder="Min. 8 caracteres" required minlength="8" />
          </div>
        </div>
      </div>

      <!-- Error -->
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
  company: { type: Object, default: null }, // existing company for edit
})
const emit = defineEmits(['update:modelValue', 'created', 'updated'])

const { t } = useI18n()
const loading = ref(false)
const error = ref('')

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const editMode = computed(() => !!props.company)

const form = ref({
  name: '', tax_id: '', address: '', city: '', phone: '', contact_email: '',
})

const manager = ref({
  first_name: '', last_name: '', email: '', password: '',
})

watch(() => props.company, (c) => {
  if (c) {
    form.value = { name: c.name, tax_id: c.tax_id || '', address: c.address || '', city: c.city || '', phone: c.phone || '', contact_email: c.contact_email || '' }
  } else {
    form.value = { name: '', tax_id: '', address: '', city: '', phone: '', contact_email: '' }
    manager.value = { first_name: '', last_name: '', email: '', password: '' }
  }
}, { immediate: true })

const handleSubmit = async () => {
  error.value = ''
  loading.value = true
  try {
    if (editMode.value) {
      await api.put(`/superadmin/companies/${props.company.id}`, form.value)
      emit('updated')
    } else {
      const res = await api.post('/superadmin/companies', {
        ...form.value,
        manager: manager.value,
      })
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
