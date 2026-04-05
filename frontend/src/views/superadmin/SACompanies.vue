<template>
  <div class="space-y-6 animate-fade-in">
    <div class="flex items-center justify-between">
      <h3 class="text-lg font-semibold text-white">Empresas</h3>
      <button class="btn-primary" @click="showCreate = true">+ Crear Empresa</button>
    </div>

    <!-- Company Cards -->
    <div class="glass-card overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-surface-700 text-surface-400">
            <th class="text-left p-4 font-medium">Nombre</th>
            <th class="text-left p-4 font-medium">CIF/NIF</th>
            <th class="text-left p-4 font-medium">Ciudad</th>
            <th class="text-left p-4 font-medium">Fábricas</th>
            <th class="text-left p-4 font-medium">Usuarios</th>
            <th class="text-left p-4 font-medium">Estado</th>
            <th class="text-right p-4 font-medium">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in companies" :key="c.id" class="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
            <td class="p-4 text-white font-medium">{{ c.name }}</td>
            <td class="p-4 text-surface-300">{{ c.tax_id || '—' }}</td>
            <td class="p-4 text-surface-300">{{ c.city || '—' }}</td>
            <td class="p-4 text-primary-400 font-semibold">{{ c.factory_count || 0 }}</td>
            <td class="p-4 text-surface-300">{{ c.user_count || 0 }}</td>
            <td class="p-4">
              <span class="badge" :class="c.is_active ? 'badge-energy' : 'badge-warning'">
                {{ c.is_active ? 'Activa' : 'Inactiva' }}
              </span>
            </td>
            <td class="p-4 text-right">
              <button @click="editCompany(c)" class="text-surface-400 hover:text-white transition-colors text-sm mr-3">Editar</button>
              <button @click="toggleCompany(c)" class="text-sm" :class="c.is_active ? 'text-alarm-400 hover:text-alarm-300' : 'text-energy-400 hover:text-energy-300'">
                {{ c.is_active ? 'Desactivar' : 'Activar' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty State -->
    <div v-if="companies.length === 0 && !loading" class="glass-card p-12 text-center">
      <p class="text-surface-400 text-lg mb-2">No hay empresas registradas</p>
      <button class="btn-primary" @click="showCreate = true">+ Crear primera empresa</button>
    </div>

    <!-- Modals -->
    <CompanyModal
      v-model="showCreate"
      @created="onCreated"
    />
    <CompanyModal
      v-model="showEdit"
      :company="editingCompany"
      @updated="onUpdated"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '@/services/api.js'
import CompanyModal from '@/components/modals/CompanyModal.vue'

const companies = ref([])
const loading = ref(false)
const showCreate = ref(false)
const showEdit = ref(false)
const editingCompany = ref(null)

const fetchCompanies = async () => {
  loading.value = true
  try {
    const res = await api.get('/superadmin/companies')
    companies.value = res.data.data
  } catch { /* ignore */ }
  loading.value = false
}

const editCompany = (c) => {
  editingCompany.value = c
  showEdit.value = true
}

const toggleCompany = async (c) => {
  try {
    await api.put(`/superadmin/companies/${c.id}`, { is_active: !c.is_active })
    await fetchCompanies()
  } catch { /* ignore */ }
}

const onCreated = () => fetchCompanies()
const onUpdated = () => { showEdit.value = false; fetchCompanies() }

onMounted(fetchCompanies)
</script>
