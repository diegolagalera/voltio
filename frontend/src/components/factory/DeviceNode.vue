<template>
  <div class="space-y-1">
    <!-- Device Row -->
    <div
      class="rounded-lg p-3 flex items-center gap-3"
      :class="depth === 0
        ? 'bg-surface-800/50'
        : device.parent_relation === 'phase_channel'
          ? 'bg-surface-800/30 border-l-2 border-primary-500/40'
          : 'bg-surface-800/30 border-l-2 border-amber-500/40'"
      :style="{ marginLeft: `${depth * 1.5}rem` }"
    >
      <!-- Role/Relation Badge -->
      <span
        v-if="device.device_role === 'general_meter'"
        class="shrink-0 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-energy-500/20 text-energy-400"
      >
        General
      </span>
      <span
        v-else-if="device.parent_relation === 'phase_channel'"
        class="shrink-0 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary-500/15 text-primary-400"
      >
        {{ device.phase_channel }}
      </span>
      <span
        v-else-if="device.parent_relation === 'downstream'"
        class="shrink-0 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400"
      >
        ↓ Downstream
      </span>
      <span
        v-else
        class="shrink-0 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-700 text-surface-400"
      >
        Sub
      </span>

      <!-- Device Info -->
      <div class="flex-1 min-w-0">
        <p class="text-white text-sm font-medium truncate">{{ device.name }}</p>
        <p class="text-surface-500 text-xs">
          {{ device.model || '—' }} · {{ device.device_type }} · IP {{ device.host || '—' }}
        </p>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-1.5 shrink-0">
        <!-- Set as General Meter -->
        <button
          v-if="device.device_role !== 'general_meter' && !device.parent_device_id"
          @click="$emit('set-general', device)"
          class="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-surface-400 hover:text-energy-400 hover:bg-energy-500/10 border border-transparent hover:border-energy-500/20 transition-all"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          General
        </button>

        <!-- Configure Phases (trifásica only) -->
        <button
          v-if="device.device_type === 'trifasica' && device.device_role !== 'general_meter'"
          @click="$emit('open-phases', device)"
          class="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-surface-400 hover:text-primary-400 hover:bg-primary-500/10 border border-transparent hover:border-primary-500/20 transition-all"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          Fases
        </button>

        <!-- Add Downstream -->
        <button
          v-if="device.device_role !== 'general_meter'"
          @click="$emit('open-downstream', device)"
          class="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-surface-400 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 transition-all"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m0 0l-4-4m4 4l4-4" />
          </svg>
          Downstream
        </button>

        <!-- Unlink/Remove (only children) -->
        <button
          v-if="device.parent_device_id"
          @click="$emit('unlink', device)"
          class="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-surface-500 hover:text-alarm-400 hover:bg-alarm-500/10 border border-transparent hover:border-alarm-500/20 transition-all"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          {{ device.parent_relation === 'phase_channel' ? 'Eliminar' : 'Desvincular' }}
        </button>
      </div>
    </div>

    <!-- Recursive children -->
    <DeviceNode
      v-for="child in device.children"
      :key="child.id"
      :device="child"
      :depth="depth + 1"
      @set-general="(d) => $emit('set-general', d)"
      @open-phases="(d) => $emit('open-phases', d)"
      @open-downstream="(d) => $emit('open-downstream', d)"
      @unlink="(d) => $emit('unlink', d)"
    />
  </div>
</template>

<script setup>
defineProps({
  device: { type: Object, required: true },
  depth: { type: Number, default: 0 }
})

defineEmits(['set-general', 'open-phases', 'open-downstream', 'unlink'])
</script>
