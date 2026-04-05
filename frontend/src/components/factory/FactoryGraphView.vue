<template>
  <div class="factory-graph-view">
    <!-- Floating summary cards -->
    <div class="absolute top-4 left-4 z-10 flex gap-3 flex-wrap">
      <!-- Power Usage Gauge -->
      <div v-if="contractedPowerKw" class="bg-surface-900/90 backdrop-blur-md border border-surface-700 rounded-xl px-4 py-3 shadow-lg min-w-[240px]">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-surface-500 text-[10px] uppercase tracking-wider">Potencia en uso</span>
          <span class="font-bold text-sm" :class="powerGaugeColorClass">{{ (totalPowerW / 1000).toFixed(1) }} kW <span class="text-surface-500 font-normal">/ {{ contractedPowerKw }} kW</span></span>
        </div>
        <div class="w-full bg-surface-800 rounded-full h-2 overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="powerUsagePct > 90 ? 'bg-alarm-500' : powerUsagePct > 70 ? 'bg-warning-400' : 'bg-energy-400'"
            :style="{ width: Math.min(powerUsagePct, 100) + '%' }"
          ></div>
        </div>
        <p class="text-[10px] mt-1" :class="powerUsagePct > 90 ? 'text-alarm-400 animate-pulse' : 'text-surface-500'">{{ powerUsagePct.toFixed(0) }}% del contratado</p>
      </div>
      <div class="bg-surface-900/90 backdrop-blur-md border border-surface-700 rounded-xl px-4 py-3 shadow-lg">
        <p class="text-surface-500 text-[10px] uppercase tracking-wider">Potencia Total</p>
        <p class="text-primary-400 font-bold text-lg">{{ formatValue(totalPowerW, 'W') }}</p>
      </div>
      <div v-if="costInfo?.price_kwh" class="bg-surface-900/90 backdrop-blur-md border border-surface-700 rounded-xl px-4 py-3 shadow-lg">
        <p class="text-surface-500 text-[10px] uppercase tracking-wider">Coste/hora</p>
        <p class="text-energy-400 font-bold text-lg">{{ totalCostPerHour }} €/h</p>
      </div>
      <div v-if="costInfo" class="bg-surface-900/90 backdrop-blur-md border border-surface-700 rounded-xl px-4 py-3 shadow-lg">
        <p class="text-surface-500 text-[10px] uppercase tracking-wider">Periodo</p>
        <p class="text-white font-bold text-lg">{{ costInfo.period }} <span class="text-sm font-normal text-surface-400">{{ costInfo.period_label }}</span></p>
      </div>
    </div>

    <!-- Reset Layout Button -->
    <div class="absolute top-4 right-4 z-10">
      <button
        v-if="hasCustomPositions"
        @click="$emit('reset:positions')"
        class="bg-surface-900/90 backdrop-blur-md border border-surface-700 rounded-xl px-3 py-2 shadow-lg
               text-surface-400 hover:text-white hover:border-surface-500 transition-all text-xs flex items-center gap-1.5"
        title="Restablecer layout automático"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Reset Layout
      </button>
    </div>

    <VueFlow
      :nodes="graphNodes"
      :edges="graphEdges"
      :default-viewport="{ x: 50, y: 50, zoom: 0.85 }"
      :min-zoom="0.2"
      :max-zoom="2"
      :snap-to-grid="true"
      :snap-grid="[20, 20]"
      fit-view-on-init
      @node-click="onNodeClick"
      @node-drag-stop="onNodeDragStop"
    >
      <template #node-generalMeter="nodeProps">
        <div class="graph-node general-meter-node">
          <div class="node-badge bg-energy-500/20 text-energy-400">⚡ Contador General</div>
          <p class="node-name">{{ nodeProps.data.label }}</p>
          <p class="node-meta">{{ nodeProps.data.meta }}</p>
          <div v-if="nodeProps.data.telemetry" class="node-telemetry">
            <div class="node-stat">
              <span class="stat-label">Potencia</span>
              <span class="stat-value text-energy-400">{{ formatValue(nodeProps.data.telemetry.power_w_total || nodeProps.data.telemetry.power_w, 'W') }}</span>
            </div>
            <div class="node-stat">
              <span class="stat-label">PF</span>
              <span class="stat-value" :class="getPFColor(nodeProps.data.telemetry.power_factor)">{{ (nodeProps.data.telemetry.power_factor || 0).toFixed(3) }}</span>
            </div>
            <div v-if="nodeProps.data.costPerHour" class="node-stat">
              <span class="stat-label">Coste</span>
              <span class="stat-value text-primary-400">{{ nodeProps.data.costPerHour }} €/h</span>
            </div>
          </div>
          <div v-else class="node-no-data">Sin datos</div>
        </div>
      </template>

      <template #node-device="nodeProps">
        <div class="graph-node device-node" :class="`device-type-${nodeProps.data.deviceType}`">
          <div class="flex items-center gap-2 mb-1">
            <span class="node-type-badge" :class="`type-${nodeProps.data.deviceType}`">{{ nodeProps.data.typeLabel }}</span>
            <span v-if="nodeProps.data.relation === 'downstream'" class="node-type-badge type-downstream">↓</span>
          </div>
          <p class="node-name">{{ nodeProps.data.label }}</p>
          <p class="node-meta">{{ nodeProps.data.meta }}</p>
          <div v-if="nodeProps.data.telemetry" class="node-telemetry">
            <div class="node-stat">
              <span class="stat-label">Potencia</span>
              <span class="stat-value text-primary-400">{{ formatValue(nodeProps.data.telemetry.power_w_total || nodeProps.data.telemetry.power_w, 'W') }}</span>
            </div>
            <div class="node-stat">
              <span class="stat-label">PF</span>
              <span class="stat-value" :class="getPFColor(nodeProps.data.telemetry.power_factor)">{{ (nodeProps.data.telemetry.power_factor || 0).toFixed(3) }}</span>
            </div>
          </div>
          <div v-else class="node-no-data">Sin datos</div>
        </div>
      </template>

      <template #node-phase="nodeProps">
        <div class="graph-node phase-node" :class="`phase-${nodeProps.data.phase}`">
          <div class="flex items-center gap-2 mb-1">
            <span class="node-phase-badge" :class="`phase-badge-${nodeProps.data.phase}`">{{ nodeProps.data.phase }}</span>
          </div>
          <p class="node-name text-sm">{{ nodeProps.data.label }}</p>
          <div v-if="nodeProps.data.telemetry" class="node-telemetry compact">
            <span class="stat-value text-primary-400 text-sm">{{ formatValue(nodeProps.data.telemetry.power_w_total, 'W') }}</span>
            <span class="text-surface-500 text-[10px]">PF {{ (nodeProps.data.telemetry.power_factor || 0).toFixed(3) }}</span>
          </div>
          <div v-else class="node-no-data text-xs">—</div>
        </div>
      </template>

      <Background :gap="25" :size="1" pattern-color="rgba(148, 163, 184, 0.06)" />
      <Controls position="bottom-left" />
      <MiniMap
        position="bottom-right"
        :pannable="true"
        :zoomable="true"
        :node-color="miniMapNodeColor"
      />
    </VueFlow>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

const props = defineProps({
  devices: { type: Array, required: true },
  telemetryData: { type: Object, default: () => ({}) },
  costInfo: { type: Object, default: null },
  factoryId: { type: String, required: true },
  contractedPowerKw: { type: Number, default: 0 },
  savedPositions: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['update:positions', 'reset:positions'])

const router = useRouter()
const route = useRoute()

// ── Helpers ──
const formatValue = (value, unit) => {
  if (value == null) return '—'
  if (unit === 'W' && value > 1000) return `${(value / 1000).toFixed(1)} kW`
  if (unit === 'A') return `${value.toFixed(2)} A`
  return `${value.toFixed(1)} ${unit}`
}

const getPFColor = (pf) => {
  if (!pf) return 'text-surface-400'
  if (pf >= 0.95) return 'text-energy-400'
  return 'text-alarm-400'
}

const getDeviceData = (deviceId) => {
  const rt = props.telemetryData[deviceId]
  return rt?.data || null
}

const getCostPerHour = (deviceId) => {
  if (!props.costInfo?.price_kwh) return null
  const data = getDeviceData(deviceId)
  if (!data) return null
  const powerKw = (data.power_w_total || data.power_w || 0) / 1000
  return (powerKw * props.costInfo.price_kwh).toFixed(2)
}

// Whether there are saved custom positions
const hasCustomPositions = computed(() => Object.keys(props.savedPositions).length > 0)

// ── Summary ──
const totalPowerW = computed(() => {
  let sum = 0
  for (const d of props.devices) {
    if (d.device_role === 'general_meter') {
      const data = getDeviceData(d.id)
      if (data) return data.power_w_total || data.power_w || 0
    }
  }
  for (const d of props.devices) {
    if (!d.parent_device_id) {
      const data = getDeviceData(d.id)
      if (data) sum += (data.power_w_total || data.power_w || 0)
    }
  }
  return sum
})

const totalCostPerHour = computed(() => {
  if (!props.costInfo?.price_kwh) return '0.00'
  return ((totalPowerW.value / 1000) * props.costInfo.price_kwh).toFixed(2)
})

const powerUsagePct = computed(() => {
  if (!props.contractedPowerKw) return 0
  return ((totalPowerW.value / 1000) / props.contractedPowerKw) * 100
})

const powerGaugeColorClass = computed(() => {
  if (powerUsagePct.value > 90) return 'text-alarm-400'
  if (powerUsagePct.value > 70) return 'text-warning-400'
  return 'text-energy-400'
})

// ── Build graph (horizontal layout: left → right) ──
const graphNodes = computed(() => {
  const nodes = []
  const devs = props.devices

  // Build parent→children map (data model)
  const childMap = {}
  for (const d of devs) {
    if (d.parent_device_id) {
      if (!childMap[d.parent_device_id]) childMap[d.parent_device_id] = []
      childMap[d.parent_device_id].push(d)
    }
  }

  // Horizontal layout constants
  const NODE_H = 140        // estimated node height for spacing
  const NODE_GAP_Y = 60     // vertical gap between siblings
  const LEVEL_GAP_X = 400   // horizontal gap between depth levels

  const typeMap = { trifasica: 'Trifásica', monofasica: 'Monofásica', master: 'Master' }

  // Calculate subtree height (vertical spread)
  const subtreeHeight = (deviceId) => {
    const children = childMap[deviceId] || []
    if (!children.length) return NODE_H
    const childHeights = children.map(c => subtreeHeight(c.id))
    return childHeights.reduce((sum, h) => sum + h + NODE_GAP_Y, -NODE_GAP_Y)
  }

  // Place a node and its children recursively
  const placeNode = (device, x, y) => {
    const isGeneral = device.device_role === 'general_meter'
    const isPhase = device.parent_relation === 'phase_channel'

    // Use saved position if available, otherwise use algorithmic position
    const savedPos = props.savedPositions[device.id]
    const position = savedPos ? { x: savedPos.x, y: savedPos.y } : { x, y }

    nodes.push({
      id: device.id,
      type: isGeneral ? 'generalMeter' : isPhase ? 'phase' : 'device',
      position,
      data: {
        label: device.name,
        meta: `${device.model || 'EM340'} · ${device.host || '—'}`,
        deviceType: device.device_type,
        typeLabel: typeMap[device.device_type] || device.device_type,
        relation: device.parent_relation,
        phase: device.phase_channel,
        telemetry: getDeviceData(device.id),
        costPerHour: getCostPerHour(device.id),
        deviceId: device.id
      }
    })

    // Place children to the right
    const children = childMap[device.id] || []
    if (children.length) {
      const childHeights = children.map(c => subtreeHeight(c.id))
      const totalHeight = childHeights.reduce((sum, h) => sum + h + NODE_GAP_Y, -NODE_GAP_Y)
      let childY = y + NODE_H / 2 - totalHeight / 2

      children.forEach((child, i) => {
        const ch = childHeights[i]
        placeNode(child, x + LEVEL_GAP_X, childY + ch / 2 - NODE_H / 2)
        childY += ch + NODE_GAP_Y
      })
    }
  }

  // Determine visual roots
  const generalMeter = devs.find(d => d.device_role === 'general_meter' && !d.parent_device_id)
  const otherRoots = devs.filter(d => !d.parent_device_id && d.device_role !== 'general_meter')

  if (generalMeter) {
    // General meter is THE root — other roots visually branch from it
    // Merge other roots into the general meter's children for layout
    const gmChildren = childMap[generalMeter.id] || []
    const allVisualChildren = [...gmChildren, ...otherRoots]

    // Temporarily set the childMap for layout
    const origChildren = childMap[generalMeter.id]
    childMap[generalMeter.id] = allVisualChildren

    const totalH = subtreeHeight(generalMeter.id)
    placeNode(generalMeter, 0, totalH / 2 - NODE_H / 2)

    // Restore original childMap
    childMap[generalMeter.id] = origChildren
  } else {
    // No general meter — place all roots independently
    let globalY = 0
    otherRoots.forEach(root => {
      const h = subtreeHeight(root.id)
      placeNode(root, 0, globalY)
      globalY += h + NODE_GAP_Y * 2
    })
  }

  return nodes
})

const graphEdges = computed(() => {
  const edges = []
  const generalMeter = props.devices.find(d => d.device_role === 'general_meter' && !d.parent_device_id)

  for (const d of props.devices) {
    if (d.parent_device_id) {
      const isPhase = d.parent_relation === 'phase_channel'
      edges.push({
        id: `e-${d.parent_device_id}-${d.id}`,
        source: d.parent_device_id,
        target: d.id,
        type: 'smoothstep',
        animated: true,
        style: {
          stroke: isPhase ? 'rgba(96, 165, 250, 0.6)' : 'rgba(245, 158, 11, 0.6)',
          strokeWidth: 2,
        },
        labelStyle: { fill: isPhase ? '#60a5fa' : '#f59e0b', fontSize: 10 },
        label: isPhase ? d.phase_channel : '↓'
      })
    }
  }

  // Visual edges from general meter to other root devices
  if (generalMeter) {
    for (const d of props.devices) {
      if (!d.parent_device_id && d.id !== generalMeter.id) {
        edges.push({
          id: `e-gm-${d.id}`,
          source: generalMeter.id,
          target: d.id,
          type: 'smoothstep',
          animated: true,
          style: {
            stroke: 'rgba(52, 211, 153, 0.4)',
            strokeWidth: 1.5,
            strokeDasharray: '8 4',
          },
        })
      }
    }
  }

  return edges
})

// ── Events ──
const onNodeClick = (event) => {
  const nodeId = event.node.id
  router.push(`/factory/${props.factoryId}/device/${nodeId}`)
}

const onNodeDragStop = (event) => {
  const node = event.node
  if (!node) return
  emit('update:positions', { [node.id]: { x: node.position.x, y: node.position.y } })
}

const miniMapNodeColor = (node) => {
  if (node.type === 'generalMeter') return '#34d399'
  if (node.type === 'phase') return '#60a5fa'
  return '#8b5cf6'
}
</script>

<style>
.factory-graph-view {
  position: relative;
  width: 100%;
  height: calc(100vh - 180px);
  min-height: 500px;
  border-radius: 1rem;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(15, 23, 42, 0.6);
}

/* Vue Flow overrides */
.factory-graph-view .vue-flow {
  height: 100%;
  background: transparent;
}

.factory-graph-view .vue-flow__background {
  background: transparent;
}

.factory-graph-view .vue-flow__minimap {
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.75rem;
}

.factory-graph-view .vue-flow__controls {
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.75rem;
  overflow: hidden;
}

.factory-graph-view .vue-flow__controls-button {
  background: transparent;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  color: rgba(148, 163, 184, 0.6);
  width: 30px;
  height: 30px;
}

.factory-graph-view .vue-flow__controls-button:hover {
  background: rgba(148, 163, 184, 0.1);
  color: white;
}

.factory-graph-view .vue-flow__controls-button svg {
  fill: currentColor;
}

/* ─── Node styles ─── */
.graph-node {
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.875rem;
  padding: 1rem 1.25rem;
  min-width: 220px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.graph-node:hover {
  border-color: rgba(148, 163, 184, 0.3);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  transform: translateY(-2px);
}

.general-meter-node {
  border-color: rgba(52, 211, 153, 0.3);
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(52, 211, 153, 0.05));
  min-width: 260px;
}

.general-meter-node:hover {
  border-color: rgba(52, 211, 153, 0.5);
}

.device-node {
  border-color: rgba(139, 92, 246, 0.2);
}

.device-node:hover {
  border-color: rgba(139, 92, 246, 0.4);
}

.device-type-trifasica { border-color: rgba(96, 165, 250, 0.25); }
.device-type-trifasica:hover { border-color: rgba(96, 165, 250, 0.5); }
.device-type-monofasica { border-color: rgba(245, 158, 11, 0.25); }
.device-type-monofasica:hover { border-color: rgba(245, 158, 11, 0.5); }
.device-type-master { border-color: rgba(52, 211, 153, 0.25); }
.device-type-master:hover { border-color: rgba(52, 211, 153, 0.5); }

.phase-node {
  min-width: 160px;
  padding: 0.75rem 1rem;
}

.phase-L1 { border-color: rgba(96, 165, 250, 0.3); }
.phase-L1:hover { border-color: rgba(96, 165, 250, 0.5); }
.phase-L2 { border-color: rgba(245, 158, 11, 0.3); }
.phase-L2:hover { border-color: rgba(245, 158, 11, 0.5); }
.phase-L3 { border-color: rgba(52, 211, 153, 0.3); }
.phase-L3:hover { border-color: rgba(52, 211, 153, 0.5); }

/* ─── Node inner elements ─── */
.node-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: 9999px;
  display: inline-block;
  margin-bottom: 0.5rem;
}

.node-name {
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
  margin: 0;
  line-height: 1.2;
}

.node-meta {
  color: rgba(148, 163, 184, 0.5);
  font-size: 0.65rem;
  margin-top: 2px;
}

.node-telemetry {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(148, 163, 184, 0.08);
}

.node-telemetry.compact {
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  align-items: center;
}

.node-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.stat-label {
  font-size: 0.6rem;
  color: rgba(148, 163, 184, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-value {
  font-weight: 700;
  font-size: 0.85rem;
}

.node-no-data {
  color: rgba(148, 163, 184, 0.3);
  font-size: 0.75rem;
  margin-top: 0.5rem;
}

.node-type-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.type-trifasica { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }
.type-monofasica { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
.type-master { background: rgba(52, 211, 153, 0.15); color: #34d399; }
.type-downstream { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }

.node-phase-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 9999px;
}

.phase-badge-L1 { background: rgba(96, 165, 250, 0.2); color: #60a5fa; }
.phase-badge-L2 { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
.phase-badge-L3 { background: rgba(52, 211, 153, 0.2); color: #34d399; }

/* Animated edges */
.factory-graph-view .vue-flow__edge-path {
  stroke-dasharray: 5;
  animation: edge-flow 1.5s linear infinite;
}

@keyframes edge-flow {
  from { stroke-dashoffset: 20; }
  to { stroke-dashoffset: 0; }
}

/* Node selection */
.factory-graph-view .vue-flow__node.selected .graph-node {
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.5), 0 8px 30px rgba(0, 0, 0, 0.5);
}
</style>
