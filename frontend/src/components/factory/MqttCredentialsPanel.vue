<template>
  <div class="glass-card p-5 space-y-4">
    <div class="flex items-center justify-between">
      <h4 class="text-white font-semibold flex items-center gap-2">
        <svg class="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        Configuración MQTT
      </h4>
      <span class="badge badge-energy text-[10px]">TLS / 8883</span>
    </div>

    <div v-if="loading" class="text-center py-8">
      <div class="animate-spin w-6 h-6 border-2 border-primary-400 border-t-transparent rounded-full mx-auto"></div>
      <p class="text-surface-400 text-sm mt-2">Cargando credenciales...</p>
    </div>

    <template v-else-if="creds">
      <!-- Credentials Grid -->
      <div class="space-y-3">
        <div class="bg-surface-800/50 rounded-lg p-3 flex items-center justify-between">
          <div>
            <p class="text-surface-500 text-[10px] uppercase tracking-wider">Broker</p>
            <p class="text-white text-sm font-mono">{{ creds.broker_host }}:{{ creds.broker_port_tls }}</p>
          </div>
          <button @click="copy(creds.broker_host + ':' + creds.broker_port_tls)" class="btn-icon" title="Copiar">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>

        <div class="bg-surface-800/50 rounded-lg p-3 flex items-center justify-between">
          <div>
            <p class="text-surface-500 text-[10px] uppercase tracking-wider">Usuario MQTT</p>
            <p class="text-white text-sm font-mono">{{ creds.username }}</p>
          </div>
          <button @click="copy(creds.username)" class="btn-icon" title="Copiar">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>

        <div class="bg-surface-800/50 rounded-lg p-3 flex items-center justify-between">
          <div>
            <p class="text-surface-500 text-[10px] uppercase tracking-wider">Contraseña MQTT</p>
            <p class="text-white text-sm font-mono">
              {{ showPassword ? creds.password : '••••••••••••••••' }}
            </p>
          </div>
          <div class="flex gap-1">
            <button @click="showPassword = !showPassword" class="btn-icon" :title="showPassword ? 'Ocultar' : 'Mostrar'">
              <svg v-if="!showPassword" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <svg v-else class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            </button>
            <button @click="copy(creds.password)" class="btn-icon" title="Copiar">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>

        <div class="bg-surface-800/50 rounded-lg p-3 flex items-center justify-between">
          <div>
            <p class="text-surface-500 text-[10px] uppercase tracking-wider">Topic</p>
            <p class="text-white text-sm font-mono">{{ creds.topic }}/telemetry</p>
          </div>
          <button @click="copy(creds.topic + '/telemetry')" class="btn-icon" title="Copiar">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-3 pt-2">
        <button
          @click="downloadConfig"
          class="btn-primary flex-1 flex items-center justify-center gap-2 text-sm"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Descargar config.json
        </button>
        <button
          @click="confirmRegenerate"
          class="btn-secondary flex items-center justify-center gap-2 text-sm px-4"
          :disabled="regenerating"
        >
          <svg class="w-4 h-4" :class="{ 'animate-spin': regenerating }" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Regenerar
        </button>
      </div>

      <p class="text-surface-500 text-[10px] text-center">
        Las credenciales se usan en la Raspberry Pi para conectar al broker MQTT con TLS.
      </p>
    </template>

    <!-- Copied Toast -->
    <Transition name="fade">
      <div v-if="copied" class="fixed bottom-6 right-6 bg-energy-500/90 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg z-50">
        ✓ Copiado al portapapeles
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '@/services/api.js'

const props = defineProps({ factoryId: { type: String, required: true } })

const creds = ref(null)
const loading = ref(true)
const showPassword = ref(false)
const copied = ref(false)
const regenerating = ref(false)

const fetchCredentials = async () => {
  loading.value = true
  try {
    const res = await api.get(`/factories/${props.factoryId}/mqtt-credentials`)
    creds.value = res.data.data
  } catch (err) {
    console.error('Error fetching MQTT credentials:', err)
  }
  loading.value = false
}

const copy = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* ignore */ }
}

const confirmRegenerate = async () => {
  if (!confirm('¿Regenerar la contraseña MQTT?\n\nLa Raspberry Pi dejará de conectar hasta que actualices el config.json con la nueva contraseña.')) return
  regenerating.value = true
  try {
    const res = await api.post(`/factories/${props.factoryId}/mqtt-credentials/regenerate`)
    creds.value = res.data.data
    showPassword.value = true
  } catch (err) {
    alert('Error regenerando credenciales: ' + (err.response?.data?.message || err.message))
  }
  regenerating.value = false
}

const downloadConfig = async () => {
  try {
    const res = await api.get(`/factories/${props.factoryId}/download-config`, { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([JSON.stringify(JSON.parse(await res.data.text()), null, 2)]))
    const a = document.createElement('a')
    a.href = url
    a.download = 'config.json'
    a.click()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    alert('Error descargando config: ' + (err.response?.data?.message || err.message))
  }
}

onMounted(fetchCredentials)
</script>

<style scoped>
.btn-icon {
  padding: 0.375rem;
  color: var(--color-surface-400, #94a3b8);
  border-radius: 0.5rem;
  transition: all 0.15s;
  cursor: pointer;
  background: transparent;
  border: none;
}
.btn-icon:hover {
  color: white;
  background: var(--color-surface-700, #334155);
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
