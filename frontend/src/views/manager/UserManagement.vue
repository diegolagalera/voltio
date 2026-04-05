<template>
  <div class="space-y-6 animate-fade-in">
    <div class="flex items-center justify-between">
      <h3 class="text-lg font-semibold text-white">{{ t('nav.users') }}</h3>
      <button class="btn-primary" @click="showCreate = true">+ {{ t('common.create') }}</button>
    </div>

    <div class="glass-card overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-surface-700 text-surface-400">
            <th class="text-left p-4 font-medium">{{ t('common.name') }}</th>
            <th class="text-left p-4 font-medium">{{ t('common.email') }}</th>
            <th class="text-left p-4 font-medium">{{ t('common.role') }}</th>
            <th class="text-left p-4 font-medium">{{ t('nav.factories') }}</th>
            <th class="text-left p-4 font-medium">{{ t('common.status') }}</th>
            <th class="text-right p-4 font-medium">{{ t('common.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id" class="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
            <td class="p-4 text-white">{{ user.first_name }} {{ user.last_name }}</td>
            <td class="p-4 text-surface-300">{{ user.email }}</td>
            <td class="p-4"><span class="badge badge-info">{{ t(`roles.${user.role}`) }}</span></td>
            <td class="p-4 text-surface-300">{{ (user.factories || []).map(f => f.name).join(', ') || '—' }}</td>
            <td class="p-4">
              <span class="badge" :class="user.is_active ? 'badge-energy' : 'badge-warning'">
                {{ user.is_active ? t('common.active') : t('common.inactive') }}
              </span>
            </td>
            <td class="p-4 text-right space-x-3">
              <button @click="editUser(user)" class="text-surface-400 hover:text-white transition-colors text-sm">{{ t('common.edit') }}</button>
              <button @click="toggleUser(user)" class="text-sm" :class="user.is_active ? 'text-alarm-400' : 'text-energy-400'">
                {{ user.is_active ? 'Desactivar' : 'Activar' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="users.length === 0 && !loading" class="glass-card p-12 text-center">
      <p class="text-surface-400 text-lg mb-2">{{ t('common.noData') }}</p>
      <button class="btn-primary" @click="showCreate = true">+ {{ t('common.create') }}</button>
    </div>

    <UserModal v-model="showCreate" @created="fetchUsers" />
    <UserModal v-model="showEdit" :user="editingUser" @updated="fetchUsers" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/services/api.js'
import UserModal from '@/components/modals/UserModal.vue'

const { t } = useI18n()
const users = ref([])
const loading = ref(false)
const showCreate = ref(false)
const showEdit = ref(false)
const editingUser = ref(null)

const fetchUsers = async () => {
  loading.value = true
  try {
    const res = await api.get('/users')
    users.value = res.data.data
  } catch { /* ignore */ }
  loading.value = false
}

const editUser = (u) => { editingUser.value = u; showEdit.value = true }

const toggleUser = async (u) => {
  try {
    await api.put(`/users/${u.id}`, { is_active: !u.is_active })
    await fetchUsers()
  } catch { /* ignore */ }
}

onMounted(fetchUsers)
</script>
