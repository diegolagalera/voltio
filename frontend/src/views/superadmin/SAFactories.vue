<template>
  <div class="space-y-6 animate-fade-in">
    <div class="flex items-center justify-between">
      <h3 class="text-lg font-semibold text-white">Todas las Fábricas</h3>
      <button class="btn-primary" @click="showCreate = true">+ Crear Fábrica</button>
    </div>

    <div class="glass-card overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-surface-700 text-surface-400">
            <th class="text-left p-4 font-medium">Fábrica</th>
            <th class="text-left p-4 font-medium">Empresa</th>
            <th class="text-left p-4 font-medium">Ciudad</th>
            <th class="text-left p-4 font-medium">Dispositivos</th>
            <th class="text-left p-4 font-medium">Estado</th>
            <th class="text-right p-4 font-medium">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in factories" :key="f.id" class="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
            <td class="p-4 text-white font-medium">{{ f.name }}</td>
            <td class="p-4 text-surface-300">{{ f.company_name }}</td>
            <td class="p-4 text-surface-300">{{ f.city || '—' }}</td>
            <td class="p-4 text-primary-400">{{ f.device_count || 0 }}</td>
            <td class="p-4"><span class="badge" :class="f.is_active ? 'badge-energy' : 'badge-warning'">{{ f.is_active ? 'Activa' : 'Inactiva' }}</span></td>
            <td class="p-4 text-right space-x-3">
              <router-link :to="`/factory/${f.id}`" class="text-primary-400 hover:text-primary-300 transition-colors text-sm font-medium">Ver</router-link>
              <button @click="editFactory(f)" class="text-surface-400 hover:text-white transition-colors text-sm">Editar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="factories.length === 0 && !loading" class="glass-card p-12 text-center">
      <p class="text-surface-400 text-lg mb-2">No hay fábricas registradas</p>
      <button class="btn-primary" @click="showCreate = true">+ Crear primera fábrica</button>
    </div>

    <FactoryModal v-model="showCreate" @created="fetchFactories" />
    <FactoryModal v-model="showEdit" :factory="editingFactory" @updated="fetchFactories" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '@/services/api.js'
import FactoryModal from '@/components/modals/FactoryModal.vue'

const factories = ref([])
const loading = ref(false)
const showCreate = ref(false)
const showEdit = ref(false)
const editingFactory = ref(null)

const fetchFactories = async () => {
  loading.value = true
  try {
    const res = await api.get('/superadmin/factories')
    factories.value = res.data.data
  } catch { /* ignore */ }
  loading.value = false
}

const editFactory = (f) => { editingFactory.value = f; showEdit.value = true }

onMounted(fetchFactories)
</script>
