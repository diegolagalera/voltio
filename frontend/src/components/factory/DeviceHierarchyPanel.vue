<template>
  <div class="glass-card p-5 space-y-4">
    <div class="flex items-center justify-between">
      <h4 class="text-white font-semibold flex items-center gap-2">
        <svg class="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Jerarquía de Dispositivos
      </h4>
      <button @click="loadDevices" class="text-surface-400 hover:text-white text-xs flex items-center gap-1 transition-colors">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Actualizar
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-6">
      <div class="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
    </div>

    <!-- Device List -->
    <div v-else class="space-y-2">
      <div v-if="!devices.length" class="text-surface-500 text-sm text-center py-4">
        No hay dispositivos configurados.
      </div>

      <div
        v-for="device in deviceTree"
        :key="device.id"
        class="space-y-1"
      >
        <!-- Recursive device node -->
        <DeviceNode
          :device="device"
          :depth="0"
          @set-general="setAsGeneralMeter"
          @open-phases="openPhaseConfig"
          @open-downstream="openDownstreamModal"
          @unlink="unlinkChild"
        />
      </div>
    </div>

    <!-- Phase Config Modal -->
    <div v-if="phaseModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="phaseModal = null">
      <div class="glass-card p-6 w-full max-w-md space-y-4">
        <h4 class="text-white font-semibold">Configurar Fases — {{ phaseModal.name }}</h4>
        <p class="text-surface-400 text-xs">Asigna un nombre a cada fase (pinza) del medidor trifásico.</p>

        <div class="space-y-3">
          <div v-for="phase in ['L1', 'L2', 'L3']" :key="phase">
            <label class="text-surface-400 text-xs font-medium">{{ phase }}</label>
            <input
              v-model="phaseNames[phase]"
              type="text"
              class="input w-full text-sm mt-1"
              :placeholder="`Nombre máquina en ${phase}...`"
            />
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button @click="phaseModal = null" class="px-4 py-2 text-sm text-surface-400 hover:text-white transition-colors">Cancelar</button>
          <button @click="savePhases" class="btn-primary text-sm px-4 py-2" :disabled="saving">
            {{ saving ? 'Guardando...' : 'Guardar Fases' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Downstream Modal -->
    <div v-if="downstreamModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="downstreamModal = null">
      <div class="glass-card p-6 w-full max-w-md space-y-4">
        <h4 class="text-white font-semibold">Vincular Carga Downstream</h4>
        <p class="text-surface-400 text-xs">
          Selecciona un dispositivo que toma corriente del cuadro de <strong class="text-white">{{ downstreamModal.name }}</strong>.
          Su consumo se restará del bruto.
        </p>

        <div class="space-y-2 max-h-64 overflow-y-auto">
          <div v-if="!availableForDownstream.length" class="text-surface-500 text-sm text-center py-4">
            No hay dispositivos disponibles para vincular.
          </div>
          <button
            v-for="d in availableForDownstream"
            :key="d.id"
            @click="linkDownstream(d)"
            class="w-full text-left bg-surface-800/50 hover:bg-surface-700 rounded-lg p-3 flex items-center gap-3 transition-colors"
          >
            <span class="shrink-0 text-[10px] uppercase px-2 py-0.5 rounded-full bg-surface-700 text-surface-400">
              {{ d.device_type }}
            </span>
            <div class="flex-1 min-w-0">
              <p class="text-white text-sm font-medium truncate">{{ d.name }}</p>
              <p class="text-surface-500 text-xs">{{ d.model || '' }} · IP {{ d.host || '—' }}</p>
            </div>
          </button>
        </div>

        <div class="flex justify-end pt-2">
          <button @click="downstreamModal = null" class="px-4 py-2 text-sm text-surface-400 hover:text-white transition-colors">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- Confirmation Modal -->
    <div v-if="confirmModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" @click.self="confirmModal = null">
      <div class="bg-surface-900 border border-surface-700 rounded-2xl p-6 w-full max-w-md shadow-2xl shadow-black/50 space-y-5">
        <!-- Header with icon -->
        <div class="flex items-start gap-4">
          <div
            class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
            :class="confirmModal.type === 'danger' ? 'bg-alarm-500/15' : 'bg-primary-500/15'"
          >
            <svg v-if="confirmModal.type === 'danger'" class="w-5 h-5 text-alarm-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <svg v-else class="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h4 class="text-white font-semibold text-base">{{ confirmModal.title }}</h4>
            <p class="text-surface-300 text-sm mt-1 leading-relaxed">{{ confirmModal.message }}</p>
          </div>
        </div>

        <!-- Warning about descendants -->
        <div v-if="confirmModal.descendants?.length" class="bg-alarm-500/10 border border-alarm-500/25 rounded-xl p-4">
          <p class="text-alarm-300 text-xs font-bold uppercase tracking-wider mb-2">⚠ Dispositivos afectados ({{ confirmModal.descendants.length }})</p>
          <ul class="space-y-1">
            <li v-for="d in confirmModal.descendants" :key="d.id" class="text-surface-200 text-sm flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="d.parent_relation === 'phase_channel' ? 'bg-primary-400' : 'bg-amber-400'"></span>
              {{ d.name }}
              <span class="text-surface-500 text-xs">({{ d.parent_relation === 'phase_channel' ? 'fase' : 'downstream' }})</span>
            </li>
          </ul>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-3 pt-1">
          <button
            @click="confirmModal = null"
            class="px-5 py-2.5 text-sm font-medium text-surface-300 hover:text-white bg-surface-800 hover:bg-surface-700 rounded-lg border border-surface-700 transition-all"
          >
            Cancelar
          </button>
          <button
            @click="confirmModal.action(); confirmModal = null"
            class="px-5 py-2.5 text-sm font-medium rounded-lg transition-all"
            :class="confirmModal.type === 'danger'
              ? 'bg-alarm-500 text-white hover:bg-alarm-600'
              : 'btn-primary'"
          >
            {{ confirmModal.confirmText || 'Confirmar' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Status message -->
    <p v-if="statusMsg" class="text-xs text-center" :class="statusOk ? 'text-energy-400' : 'text-alarm-400'">
      {{ statusMsg }}
    </p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api.js'
import DeviceNode from '@/components/factory/DeviceNode.vue'

const props = defineProps({
  factoryId: { type: String, required: true }
})

const devices = ref([])
const loading = ref(true)
const saving = ref(false)
const statusMsg = ref('')
const statusOk = ref(true)
const confirmModal = ref(null)

// Phase config modal
const phaseModal = ref(null)
const phaseNames = ref({ L1: '', L2: '', L3: '' })

// Downstream modal
const downstreamModal = ref(null)

// Devices available to link as downstream
// Excludes: self, general meter, phase children, and any device in the same ancestor chain (prevent loops)
const getAncestorIds = (deviceId) => {
  const ids = new Set()
  let current = deviceId
  let guard = 20
  while (current && guard-- > 0) {
    ids.add(current)
    const dev = devices.value.find(d => d.id === current)
    current = dev?.parent_device_id || null
  }
  return ids
}

const availableForDownstream = computed(() => {
  if (!downstreamModal.value) return []
  const parentId = downstreamModal.value.id
  const ancestors = getAncestorIds(parentId)
  return devices.value.filter(d =>
    !ancestors.has(d.id) &&
    !d.parent_device_id &&
    d.device_role !== 'general_meter' &&
    d.parent_relation !== 'phase_channel'
  )
})

// Build recursive tree: parent devices with nested children
const deviceTree = computed(() => {
  const childMap = {}
  for (const d of devices.value) {
    if (d.parent_device_id) {
      if (!childMap[d.parent_device_id]) childMap[d.parent_device_id] = []
      childMap[d.parent_device_id].push(d)
    }
  }
  const buildNode = (d) => ({
    ...d,
    children: (childMap[d.id] || []).map(buildNode)
  })
  return devices.value.filter(d => !d.parent_device_id).map(buildNode)
})

const loadDevices = async () => {
  loading.value = true
  try {
    const res = await api.get(`/factories/${props.factoryId}/devices`)
    devices.value = res.data.data
  } catch (e) {
    showStatus('Error cargando dispositivos', false)
  } finally {
    loading.value = false
  }
}

const setAsGeneralMeter = (device) => {
  confirmModal.value = {
    title: 'Marcar como Contador General',
    message: `¿Marcar "${device.name}" como el contador general de la fábrica? El anterior dejará de serlo.`,
    type: 'info',
    confirmText: 'Marcar General',
    action: async () => {
      try {
        await api.put(`/factories/${props.factoryId}/devices/${device.id}`, {
          device_role: 'general_meter'
        })
        showStatus(`${device.name} marcado como Contador General`, true)
        await loadDevices()
      } catch (e) {
        showStatus('Error actualizando dispositivo', false)
      }
    }
  }
}

const openPhaseConfig = (device) => {
  phaseModal.value = device
  const children = devices.value.filter(d => d.parent_device_id === device.id && d.parent_relation === 'phase_channel')
  phaseNames.value = { L1: '', L2: '', L3: '' }
  for (const c of children) {
    if (c.phase_channel) phaseNames.value[c.phase_channel] = c.name
  }
}

const savePhases = async () => {
  if (!phaseModal.value) return
  saving.value = true
  try {
    const phases = {}
    for (const [k, v] of Object.entries(phaseNames.value)) {
      if (v.trim()) phases[k] = v.trim()
    }
    await api.post(`/factories/${props.factoryId}/devices/${phaseModal.value.id}/phase-children`, { phases })
    showStatus('Fases configuradas correctamente', true)
    phaseModal.value = null
    await loadDevices()
  } catch (e) {
    showStatus('Error guardando fases', false)
  } finally {
    saving.value = false
  }
}

// ---- Downstream ----
const openDownstreamModal = (device) => {
  downstreamModal.value = device
}

const linkDownstream = (childDevice) => {
  if (!downstreamModal.value) return
  const parentName = downstreamModal.value.name
  confirmModal.value = {
    title: 'Vincular Downstream',
    message: `¿Vincular "${childDevice.name}" como carga downstream de "${parentName}"? Su consumo se restará del bruto de ${parentName}.`,
    type: 'info',
    confirmText: 'Vincular',
    action: async () => {
      try {
        await api.put(`/factories/${props.factoryId}/devices/${childDevice.id}`, {
          parent_device_id: downstreamModal.value.id,
          parent_relation: 'downstream'
        })
        showStatus(`${childDevice.name} vinculado como downstream de ${parentName}`, true)
        downstreamModal.value = null
        await loadDevices()
      } catch (e) {
        showStatus('Error vinculando dispositivo', false)
      }
    }
  }
}

// ---- Recursive descendant finder ----
const getDescendants = (deviceId) => {
  const result = []
  const collect = (parentId) => {
    for (const d of devices.value) {
      if (d.parent_device_id === parentId) {
        result.push(d)
        collect(d.id)
      }
    }
  }
  collect(deviceId)
  return result
}

const unlinkChild = (child) => {
  const descendants = getDescendants(child.id)
  const isPhase = child.parent_relation === 'phase_channel'
  const actionWord = isPhase ? 'eliminar' : 'desvincular'

  confirmModal.value = {
    title: isPhase ? 'Eliminar Fase' : 'Desvincular Dispositivo',
    message: isPhase
      ? `¿Eliminar la fase "${child.name}" (${child.phase_channel})?`
      : `¿Desvincular "${child.name}" de su padre? Se convertirá en un dispositivo independiente.`,
    type: 'danger',
    confirmText: isPhase ? 'Eliminar' : 'Desvincular',
    descendants: descendants.length ? descendants : null,
    action: async () => {
      try {
        // First: recursively unlink all descendants (bottom-up)
        // Reverse so we start from deepest children
        const reversed = [...descendants].reverse()
        for (const desc of reversed) {
          if (desc.parent_relation === 'phase_channel') {
            await api.put(`/factories/${props.factoryId}/devices/${desc.id}`, {
              is_active: false
            })
          } else {
            await api.put(`/factories/${props.factoryId}/devices/${desc.id}`, {
              parent_device_id: null,
              parent_relation: null
            })
          }
        }

        // Then: handle the target device itself
        if (isPhase) {
          await api.put(`/factories/${props.factoryId}/devices/${child.id}`, {
            is_active: false
          })
          showStatus(`${child.name} y ${descendants.length ? descendants.length + ' dependientes ' : ''}eliminado`, true)
        } else {
          await api.put(`/factories/${props.factoryId}/devices/${child.id}`, {
            parent_device_id: null,
            parent_relation: null
          })
          showStatus(`${child.name} y ${descendants.length ? descendants.length + ' dependientes ' : ''}desvinculado`, true)
        }
        await loadDevices()
      } catch (e) {
        showStatus(`Error al ${actionWord}`, false)
      }
    }
  }
}

const showStatus = (msg, ok) => {
  statusMsg.value = msg
  statusOk.value = ok
  setTimeout(() => { statusMsg.value = '' }, 3000)
}

onMounted(loadDevices)
</script>
