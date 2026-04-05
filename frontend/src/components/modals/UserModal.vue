<template>
  <BaseModal v-model="show" :title="editMode ? 'Editar Usuario' : 'Crear Usuario'" size="md">
    <form @submit.prevent="handleSubmit" class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Nombre *</label>
          <input v-model="form.first_name" type="text" class="input" placeholder="Nombre" required />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-1.5">Apellido *</label>
          <input v-model="form.last_name" type="text" class="input" placeholder="Apellido" required />
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-surface-300 mb-1.5">Email *</label>
        <input v-model="form.email" type="email" class="input" placeholder="usuario@empresa.com" required />
      </div>
      <div v-if="!editMode">
        <label class="block text-sm font-medium text-surface-300 mb-1.5">Contraseña *</label>
        <input v-model="form.password" type="password" class="input" placeholder="Mín. 8 caracteres" required minlength="8" />
      </div>
      <div>
        <label class="block text-sm font-medium text-surface-300 mb-1.5">{{ t('common.role') }} *</label>
        <select v-model="form.role" class="input" required>
          <option value="gerencia">{{ t('roles.gerencia') }}</option>
          <option value="operador">{{ t('roles.operador') }}</option>
        </select>
      </div>

      <!-- Factory Access -->
      <div>
        <label class="block text-sm font-medium text-surface-300 mb-2">Acceso a fábricas</label>
        <div class="space-y-2 max-h-40 overflow-y-auto">
          <label v-for="f in factories" :key="f.id" class="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-700/50 cursor-pointer">
            <input type="checkbox" v-model="form.factory_ids" :value="f.id" class="w-4 h-4 rounded accent-primary-500" />
            <span class="text-sm text-surface-200">{{ f.name }}</span>
          </label>
        </div>
        <p v-if="factories.length === 0" class="text-surface-500 text-xs">No hay fábricas disponibles</p>
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
import { useFactoryStore } from '@/stores/factory.store.js'
import api from '@/services/api.js'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  user: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'created', 'updated'])

const { t } = useI18n()
const factoryStore = useFactoryStore()
const loading = ref(false)
const error = ref('')

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const editMode = computed(() => !!props.user)
const factories = computed(() => factoryStore.factories)

const form = ref({
  first_name: '', last_name: '', email: '', password: '',
  role: 'operador', factory_ids: [],
})

watch(() => props.user, (u) => {
  if (u) {
    form.value = {
      first_name: u.first_name, last_name: u.last_name, email: u.email,
      password: '', role: u.role, factory_ids: (u.factories || []).map(f => f.id),
    }
  } else {
    form.value = { first_name: '', last_name: '', email: '', password: '', role: 'operador', factory_ids: [] }
  }
}, { immediate: true })

onMounted(() => {
  if (factories.value.length === 0) factoryStore.fetchFactories()
})

const handleSubmit = async () => {
  error.value = ''
  loading.value = true
  try {
    if (editMode.value) {
      const { password, ...data } = form.value
      await api.put(`/users/${props.user.id}`, data)
      // Update factory access
      await api.put(`/users/${props.user.id}/access`, { factory_ids: form.value.factory_ids })
      emit('updated')
    } else {
      const res = await api.post('/users', form.value)
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
