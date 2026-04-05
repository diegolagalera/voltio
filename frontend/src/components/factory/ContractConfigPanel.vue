<template>
  <div class="glass-card p-5 space-y-5">
    <div class="flex items-center justify-between">
      <h4 class="text-white font-semibold flex items-center gap-2">
        <svg class="w-5 h-5 text-energy-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Contrato Eléctrico
      </h4>
      <button v-if="!editing && contract" @click="editing = true" class="btn-secondary text-xs px-3 py-1.5">
        Editar
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-8">
      <div class="animate-spin w-6 h-6 border-2 border-primary-400 border-t-transparent rounded-full mx-auto"></div>
    </div>

    <!-- No Contract -->
    <div v-else-if="!contract && !editing" class="text-center py-6 space-y-3">
      <p class="text-surface-400 text-sm">No hay contrato eléctrico configurado</p>
      <button @click="editing = true" class="btn-primary text-sm px-4 py-2">
        Configurar Contrato
      </button>
    </div>

    <!-- View Mode -->
    <div v-else-if="!editing" class="space-y-4">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="bg-surface-800/50 rounded-lg p-3">
          <p class="text-surface-500 text-[10px] uppercase tracking-wider">Comercializadora</p>
          <p class="text-white text-sm">{{ contract.provider }}</p>
        </div>
        <div class="bg-surface-800/50 rounded-lg p-3">
          <p class="text-surface-500 text-[10px] uppercase tracking-wider">Tarifa</p>
          <p class="text-white text-sm font-semibold">{{ contract.tariff_type }}</p>
        </div>
        <div class="bg-surface-800/50 rounded-lg p-3">
          <p class="text-surface-500 text-[10px] uppercase tracking-wider">Modelo Precio</p>
          <p class="text-white text-sm">{{ pricingLabels[contract.pricing_model] || contract.pricing_model }}</p>
        </div>
        <div class="bg-surface-800/50 rounded-lg p-3">
          <p class="text-surface-500 text-[10px] uppercase tracking-wider">CUPS</p>
          <p class="text-white text-sm font-mono text-[11px]">{{ contract.cups || '—' }}</p>
        </div>
      </div>

      <!-- Period Table -->
      <div>
        <p class="text-surface-400 text-xs mb-2 uppercase tracking-wider">Periodos (€/kWh)</p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-surface-400 text-xs">
                <th class="text-left py-1 pr-3">Periodo</th>
                <th class="text-right py-1 px-2">Potencia (kW)</th>
                <th class="text-right py-1 px-2" v-if="contract.pricing_model === 'fixed'">Energía</th>
                <th class="text-right py-1 px-2">Peaje</th>
                <th class="text-right py-1 px-2">Cargo</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in periods" :key="p" class="border-t border-surface-700/50">
                <td class="py-1.5 pr-3">
                  <span class="inline-flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: periodColors[p] }"></span>
                    <span class="text-white font-medium">{{ p }}</span>
                  </span>
                </td>
                <td class="text-right py-1.5 px-2 text-surface-300">{{ contract[`power_${p.toLowerCase()}_kw`] || '—' }}</td>
                <td class="text-right py-1.5 px-2 text-primary-400" v-if="contract.pricing_model === 'fixed'">{{ contract[`energy_price_${p.toLowerCase()}`]?.toFixed(4) || '—' }}</td>
                <td class="text-right py-1.5 px-2 text-surface-300">{{ contract[`peaje_${p.toLowerCase()}`]?.toFixed(4) || '—' }}</td>
                <td class="text-right py-1.5 px-2 text-surface-300">{{ contract[`cargo_${p.toLowerCase()}`]?.toFixed(4) || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Taxes -->
      <div class="grid grid-cols-3 gap-3">
        <div class="bg-surface-800/50 rounded-lg p-3">
          <p class="text-surface-500 text-[10px] uppercase tracking-wider">Imp. Eléctrico</p>
          <p class="text-white text-sm">{{ contract.electricity_tax }}%</p>
        </div>
        <div class="bg-surface-800/50 rounded-lg p-3">
          <p class="text-surface-500 text-[10px] uppercase tracking-wider">IVA</p>
          <p class="text-white text-sm">{{ contract.iva }}%</p>
        </div>
        <div class="bg-surface-800/50 rounded-lg p-3">
          <p class="text-surface-500 text-[10px] uppercase tracking-wider">Reactiva &gt;</p>
          <p class="text-white text-sm">{{ contract.reactive_penalty_threshold }}%</p>
        </div>
      </div>
    </div>

    <!-- Edit Mode -->
    <form v-else @submit.prevent="saveContract" class="space-y-5">
      <!-- Basic Info -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-surface-400 text-xs mb-1">Comercializadora *</label>
          <input v-model="form.provider" type="text" required class="input w-full" placeholder="Iberdrola, Endesa..." />
        </div>
        <div>
          <label class="block text-surface-400 text-xs mb-1">Nº Contrato</label>
          <input v-model="form.contract_number" type="text" class="input w-full" placeholder="CT-2025-001" />
        </div>
        <div>
          <label class="block text-surface-400 text-xs mb-1">Tarifa *</label>
          <select v-model="form.tariff_type" required class="input w-full">
            <option value="2.0TD">2.0TD (≤15kW)</option>
            <option value="3.0TD">3.0TD (BT &gt;15kW)</option>
            <option value="6.1TD">6.1TD (AT Industrial)</option>
            <option value="6.2TD">6.2TD</option>
            <option value="6.3TD">6.3TD</option>
            <option value="6.4TD">6.4TD</option>
          </select>
        </div>
        <div>
          <label class="block text-surface-400 text-xs mb-1">Modelo de Precio *</label>
          <select v-model="form.pricing_model" required class="input w-full">
            <option value="fixed">Precio Fijo</option>
            <option value="indexed_omie">Indexado OMIE</option>
            <option value="pvpc">PVPC</option>
          </select>
        </div>
        <div>
          <label class="block text-surface-400 text-xs mb-1">CUPS</label>
          <input v-model="form.cups" type="text" class="input w-full" maxlength="22" placeholder="ES0021000000000001AG" />
        </div>
        <div>
          <label class="block text-surface-400 text-xs mb-1">Fecha Inicio *</label>
          <input v-model="form.start_date" type="date" required class="input w-full" />
        </div>
      </div>

      <!-- Periods Table -->
      <div>
        <p class="text-white text-sm font-semibold mb-2">Periodos</p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-surface-400 text-xs">
                <th class="text-left py-1">Periodo</th>
                <th class="text-center py-1">Pot. (kW)</th>
                <th class="text-center py-1" v-if="form.pricing_model === 'fixed'">Energía (€/kWh)</th>
                <th class="text-center py-1">Peaje (€/kWh)</th>
                <th class="text-center py-1">Cargo (€/kWh)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in activePeriods" :key="p" class="border-t border-surface-700/50">
                <td class="py-2 pr-2">
                  <span class="inline-flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: periodColors[p] }"></span>
                    <span class="text-white font-medium">{{ p }}</span>
                  </span>
                </td>
                <td class="py-2 px-1"><input v-model.number="form[`power_${p.toLowerCase()}_kw`]" type="number" step="0.01" min="0" class="input w-full text-center text-sm" /></td>
                <td class="py-2 px-1" v-if="form.pricing_model === 'fixed'"><input v-model.number="form[`energy_price_${p.toLowerCase()}`]" type="number" step="0.0001" min="0" class="input w-full text-center text-sm" /></td>
                <td class="py-2 px-1"><input v-model.number="form[`peaje_${p.toLowerCase()}`]" type="number" step="0.0001" min="0" class="input w-full text-center text-sm" /></td>
                <td class="py-2 px-1"><input v-model.number="form[`cargo_${p.toLowerCase()}`]" type="number" step="0.0001" min="0" class="input w-full text-center text-sm" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Indexed margin (only for indexed) -->
      <div v-if="form.pricing_model === 'indexed_omie'" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-surface-400 text-xs mb-1">Margen indexado (€/kWh)</label>
          <input v-model.number="form.indexed_margin" type="number" step="0.001" min="0" class="input w-full" placeholder="0.005" />
        </div>
      </div>

      <!-- Taxes -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label class="block text-surface-400 text-xs mb-1">Impuesto Eléctrico (%)</label>
          <input v-model.number="form.electricity_tax" type="number" step="0.01" class="input w-full" />
        </div>
        <div>
          <label class="block text-surface-400 text-xs mb-1">IVA (%)</label>
          <input v-model.number="form.iva" type="number" step="0.01" class="input w-full" />
        </div>
        <div>
          <label class="block text-surface-400 text-xs mb-1">Penalización Reactiva (%)</label>
          <input v-model.number="form.reactive_penalty_threshold" type="number" step="1" class="input w-full" />
        </div>
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-3 pt-2">
        <button type="button" @click="cancelEdit" class="btn-secondary px-4 py-2 text-sm">Cancelar</button>
        <button type="submit" :disabled="saving" class="btn-primary px-6 py-2 text-sm">
          {{ saving ? 'Guardando...' : (contract ? 'Actualizar' : 'Crear Contrato') }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api.js'

const props = defineProps({
  factoryId: { type: String, required: true }
})

const contract = ref(null)
const editing = ref(false)
const loading = ref(true)
const saving = ref(false)

const periods = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
const periodColors = { P1: '#ef4444', P2: '#f97316', P3: '#eab308', P4: '#22c55e', P5: '#06b6d4', P6: '#6366f1' }
const pricingLabels = { fixed: 'Precio Fijo', indexed_omie: 'Indexado OMIE', pvpc: 'PVPC' }

const activePeriods = computed(() => {
  if (form.value.tariff_type === '2.0TD') return ['P1', 'P2', 'P3']
  return periods
})

const defaultForm = () => ({
  provider: '', contract_number: '', tariff_type: '6.1TD', pricing_model: 'fixed',
  comercializadora: '', cups: '', start_date: new Date().toISOString().split('T')[0],
  power_p1_kw: null, power_p2_kw: null, power_p3_kw: null,
  power_p4_kw: null, power_p5_kw: null, power_p6_kw: null,
  energy_price_p1: null, energy_price_p2: null, energy_price_p3: null,
  energy_price_p4: null, energy_price_p5: null, energy_price_p6: null,
  peaje_p1: 0, peaje_p2: 0, peaje_p3: 0, peaje_p4: 0, peaje_p5: 0, peaje_p6: 0,
  cargo_p1: 0, cargo_p2: 0, cargo_p3: 0, cargo_p4: 0, cargo_p5: 0, cargo_p6: 0,
  electricity_tax: 5.1127, iva: 21.0, reactive_penalty_threshold: 33.0, indexed_margin: 0,
})

const form = ref(defaultForm())

const fetchContract = async () => {
  loading.value = true
  try {
    const res = await api.get(`/factories/${props.factoryId}/contract`)
    contract.value = res.data.data
    if (contract.value) {
      // Populate form from existing contract
      Object.keys(form.value).forEach(key => {
        if (contract.value[key] != null) {
          form.value[key] = key === 'start_date'
            ? contract.value[key].split('T')[0]
            : contract.value[key]
        }
      })
    }
  } catch (e) { /* no contract */ }
  loading.value = false
}

const saveContract = async () => {
  saving.value = true
  try {
    if (contract.value?.id) {
      await api.put(`/contracts/${contract.value.id}`, form.value)
    } else {
      await api.post(`/factories/${props.factoryId}/contract`, form.value)
    }
    await fetchContract()
    editing.value = false
  } catch (err) {
    alert(err.response?.data?.error || 'Error al guardar contrato')
  }
  saving.value = false
}

const cancelEdit = () => {
  editing.value = false
  if (contract.value) {
    Object.keys(form.value).forEach(key => {
      if (contract.value[key] != null) {
        form.value[key] = key === 'start_date'
          ? contract.value[key].split('T')[0]
          : contract.value[key]
      }
    })
  } else {
    form.value = defaultForm()
  }
}

onMounted(fetchContract)
</script>
