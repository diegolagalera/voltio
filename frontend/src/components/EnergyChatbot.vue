<template>
  <!-- Floating Notch Button -->
  <button
    v-if="!chatStore.isOpen"
    id="chatbot-notch"
    @click="chatStore.open()"
    class="chatbot-notch"
  >
    <span class="notch-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    </span>
    <span class="notch-label">Voltio AI</span>
    <span class="notch-pulse"></span>
  </button>

  <!-- Chat Panel -->
  <Transition name="chatpanel">
    <div v-if="chatStore.isOpen" class="chatbot-panel" :class="{ 'chatbot-panel-fullscreen': isFullscreen }" id="chatbot-panel">
      <!-- Header -->
      <div class="chatbot-header">
        <div class="header-left">
          <div class="header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h3 class="header-title">Voltio AI</h3>
            <p class="header-subtitle">{{ factoryName }}</p>
          </div>
        </div>
        <div class="header-actions">
          <button
            @click="chatStore.clearChat()"
            class="header-btn"
            title="Limpiar chat"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
          <button
            @click="isFullscreen = !isFullscreen"
            class="header-btn"
            :title="isFullscreen ? 'Reducir' : 'Pantalla completa'"
          >
            <!-- Expand icon -->
            <svg v-if="!isFullscreen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
            <!-- Collapse icon -->
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            </svg>
          </button>
          <button
            @click="chatStore.close()"
            class="header-btn"
            title="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div class="chatbot-messages" ref="messagesContainer">
        <!-- Welcome message when empty -->
        <div v-if="chatStore.messages.length === 0" class="welcome-section">
          <div class="welcome-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-10 h-10">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h4 class="welcome-title">¡Hola! Soy Voltio AI</h4>
          <p class="welcome-text">
            Tu asistente de eficiencia energética para <strong>{{ factoryName }}</strong>. 
            Pregúntame sobre consumos, costes, optimización y métricas.
          </p>

          <!-- Suggested Questions -->
          <div class="suggested-questions">
            <button
              v-for="q in suggestedQuestions"
              :key="q"
              @click="sendSuggested(q)"
              class="suggested-btn"
            >
              {{ q }}
            </button>
          </div>
        </div>

        <!-- Message bubbles -->
        <div
          v-for="(msg, idx) in chatStore.messages"
          :key="idx"
          class="message-wrapper"
          :class="msg.role === 'user' ? 'message-user' : 'message-assistant'"
        >
          <!-- AI Avatar -->
          <div v-if="msg.role === 'assistant'" class="message-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>

          <div class="message-bubble" :class="{ 'error-bubble': msg.isError }">
            <!-- Text content (rendered as markdown) -->
            <div
              v-if="msg.content"
              class="message-text"
              v-html="renderMarkdown(msg.content)"
            ></div>

            <!-- Charts -->
            <div
              v-for="(chart, chartIdx) in (msg.charts || [])"
              :key="'chart-' + chartIdx"
              class="message-chart"
            >
              <div :ref="el => registerChart(el, idx, chartIdx, chart)" class="chart-container"></div>
            </div>

            <!-- Mermaid Diagrams -->
            <div
              v-for="(diagram, dIdx) in (msg.diagrams || [])"
              :key="'diagram-' + dIdx"
              class="message-diagram"
              :ref="el => renderMermaid(el, idx, dIdx, diagram)"
            ></div>
          </div>
        </div>

        <!-- Loading indicator -->
        <div v-if="chatStore.isLoading" class="message-wrapper message-assistant">
          <div class="message-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div class="message-bubble loading-bubble">
            <div class="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span class="typing-text">Analizando datos...</span>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="chatbot-input">
        <div class="input-wrapper">
          <input
            v-model="inputText"
            @keydown.enter.prevent="handleSend"
            type="text"
            placeholder="Pregunta sobre tu consumo energético..."
            class="chat-input"
            :disabled="chatStore.isLoading"
            id="chatbot-input"
          />
          <button
            @click="handleSend"
            :disabled="!inputText.trim() || chatStore.isLoading"
            class="send-btn"
            id="chatbot-send"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
          <button
            @click="startVoiceMode"
            class="mic-btn"
            title="Modo voz"
            :disabled="chatStore.isLoading"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- Voice Mode Overlay -->
  <Transition name="voicefade">
    <div v-if="isVoiceMode" class="voice-overlay" @click.self="stopVoiceMode">
      <div class="voice-modal">
        <div class="voice-status-label">
          {{ voiceState === 'listening' ? '🎤 Escuchando...' : voiceState === 'processing' ? '🤔 Procesando...' : voiceState === 'speaking' ? '🔊 Hablando...' : 'Modo Voz' }}
        </div>

        <!-- Animated orb -->
        <div class="voice-orb" :class="'voice-orb--' + voiceState">
          <div class="voice-ring voice-ring-1"></div>
          <div class="voice-ring voice-ring-2"></div>
          <div class="voice-ring voice-ring-3"></div>
          <div class="voice-core">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </div>
        </div>

        <!-- Live transcript -->
        <p class="voice-transcript" v-if="liveTranscript">{{ liveTranscript }}</p>
        <p class="voice-transcript voice-transcript--dim" v-else-if="voiceState === 'listening'">Di algo...</p>

        <!-- Stop button -->
        <button class="voice-stop-btn" @click="stopVoiceMode">
          <svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          Detener
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { marked } from 'marked'
import * as echarts from 'echarts'
import mermaid from 'mermaid'
import { useChatbotStore } from '@/stores/chatbot.store.js'
import { useFactoryStore } from '@/stores/factory.store.js'

// Initialize Mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#1a2235',
    primaryBorderColor: '#29a3ff',
    primaryTextColor: '#e2e8f0',
    lineColor: '#475569',
    secondaryColor: '#0f172a',
    tertiaryColor: '#1e293b',
  },
})

const chatStore = useChatbotStore()
const factoryStore = useFactoryStore()

const inputText = ref('')
const messagesContainer = ref(null)
const isFullscreen = ref(false)

// ── Voice Mode State ──
const isVoiceMode = ref(false)
const voiceState = ref('idle') // idle | listening | processing | speaking
const liveTranscript = ref('')
let recognition = null
let currentAudio = null

// ── Voice Mode: Start ──
const startVoiceMode = () => {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.')
    return
  }
  isVoiceMode.value = true
  voiceState.value = 'idle'
  liveTranscript.value = ''
  startListening()
}

// ── Voice Mode: Stop ──
const stopVoiceMode = () => {
  isVoiceMode.value = false
  voiceState.value = 'idle'
  liveTranscript.value = ''
  if (recognition) {
    recognition.onend = null
    recognition.abort()
    recognition = null
  }
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  // Stop browser TTS fallback
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
}

// ── STT: Start Listening ──
const startListening = () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  recognition = new SpeechRecognition()
  recognition.lang = 'es-ES'
  recognition.interimResults = true
  recognition.continuous = false
  recognition.maxAlternatives = 1

  voiceState.value = 'listening'
  liveTranscript.value = ''

  recognition.onresult = (event) => {
    let interim = ''
    let final = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript
      if (event.results[i].isFinal) {
        final += transcript
      } else {
        interim += transcript
      }
    }
    liveTranscript.value = final || interim
  }

  recognition.onend = () => {
    if (!isVoiceMode.value) return
    const text = liveTranscript.value.trim()
    if (text) {
      processVoiceInput(text)
    } else {
      // No speech detected, restart listening
      if (isVoiceMode.value) startListening()
    }
  }

  recognition.onerror = (event) => {
    console.warn('[Voice] STT error:', event.error)
    if (event.error === 'no-speech' && isVoiceMode.value) {
      startListening()
    } else if (event.error !== 'aborted') {
      stopVoiceMode()
    }
  }

  recognition.start()
}

// ── Process voice input: send to AI and play response ──
const processVoiceInput = async (text) => {
  voiceState.value = 'processing'

  // Send message through the store (adds to chat history)
  await chatStore.sendMessage(text)

  if (!isVoiceMode.value) return

  // Get the last assistant message
  const lastMsg = chatStore.messages[chatStore.messages.length - 1]
  if (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.isError) {
    if (isVoiceMode.value) startListening()
    return
  }

  // TTS: send response text to backend
  await speakText(lastMsg.content)
}

// ── TTS: Convert text to speech and play ──
const speakText = async (text) => {
  voiceState.value = 'speaking'
  const factoryId = factoryStore.selectedFactoryId

  try {
    const response = await fetch(`/api/chatbot/${factoryId}/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
      },
      body: JSON.stringify({ text }),
    })

    if (!response.ok) throw new Error('TTS request failed')

    const audioBlob = await response.blob()
    const audioUrl = URL.createObjectURL(audioBlob)
    currentAudio = new Audio(audioUrl)

    currentAudio.onended = () => {
      URL.revokeObjectURL(audioUrl)
      currentAudio = null
      // Auto-cycle: start listening again
      if (isVoiceMode.value) startListening()
    }

    currentAudio.onerror = () => {
      URL.revokeObjectURL(audioUrl)
      currentAudio = null
      if (isVoiceMode.value) startListening()
    }

    await currentAudio.play()
  } catch (err) {
    console.error('[Voice] TTS error:', err)
    // Fallback: use browser TTS
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'es-ES'
    utterance.onend = () => {
      if (isVoiceMode.value) startListening()
    }
    speechSynthesis.speak(utterance)
  }
}

// Active ECharts instances for cleanup
const chartInstances = []

const factoryName = computed(() => {
  const factory = factoryStore.selectedFactory
  return factory?.name || 'Fábrica'
})

const suggestedQuestions = [
  '¿Qué máquina consumió más este mes?',
  '¿Cuánto consumí en euros este mes?',
  '¿Cómo puedo optimizar mi consumo?',
  'Muéstrame el consumo mensual en un gráfico',
  '¿Cuánto puedo ahorrar con baterías?',
  '¿Diferencia de consumo entre meses?',
]

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
})

const renderMarkdown = (text) => {
  if (!text) return ''
  return marked.parse(text)
}

const handleSend = () => {
  if (!inputText.value.trim() || chatStore.isLoading) return
  chatStore.sendMessage(inputText.value)
  inputText.value = ''
}

const sendSuggested = (question) => {
  chatStore.sendMessage(question)
}

// Auto-scroll to bottom when messages change
watch(
  () => chatStore.messages.length,
  () => {
    nextTick(() => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      }
    })
  }
)

// Also scroll when loading state changes
watch(
  () => chatStore.isLoading,
  () => {
    nextTick(() => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      }
    })
  }
)

// ── ECharts Rendering ────────────────────────────
const registerChart = (el, msgIdx, chartIdx, chartData) => {
  if (!el || !chartData) return

  // Defer to next tick to ensure DOM is ready
  nextTick(() => {
    try {
      const instance = echarts.init(el, 'dark', { renderer: 'canvas' })
      chartInstances.push(instance)

      const option = buildEChartsOption(chartData)
      instance.setOption(option)

      // Resize observer
      const ro = new ResizeObserver(() => instance.resize())
      ro.observe(el)
    } catch (e) {
      console.warn('[Chatbot] Chart render error:', e)
    }
  })
}

// ── Mermaid Rendering ────────────────────────────
const renderedMermaidIds = new Set()

const renderMermaid = (el, msgIdx, dIdx, code) => {
  if (!el || !code) return
  const id = `mermaid-${msgIdx}-${dIdx}`
  if (renderedMermaidIds.has(id)) return
  renderedMermaidIds.add(id)

  nextTick(async () => {
    try {
      const { svg } = await mermaid.render(id, code)
      el.innerHTML = svg
    } catch (e) {
      console.warn('[Mermaid] Render error:', e.message)
      el.innerHTML = `<pre style="color: #94a3b8; font-size: 12px; padding: 12px;">${code}</pre>`
    }
  })
}

const buildEChartsOption = (chart) => {
  const baseTextStyle = { color: '#94a3b8', fontFamily: 'Inter, sans-serif' }
  const titleStyle = {
    text: chart.title || '',
    textStyle: { color: '#e2e8f0', fontSize: 13, fontWeight: 600, fontFamily: 'Inter, sans-serif' },
    left: 'center',
    top: 8,
  }

  if (chart.type === 'pie') {
    return {
      title: titleStyle,
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        borderColor: '#334155',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter: '{b}: {c} ({d}%)',
      },
      series: [{
        type: 'pie',
        radius: ['35%', '65%'],
        center: ['50%', '55%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: '#111827', borderWidth: 2 },
        label: { color: '#cbd5e1', fontSize: 11 },
        data: (chart.data || []).map(d => ({
          name: d.name,
          value: d.value,
          itemStyle: d.color ? { color: d.color } : undefined,
        })),
      }],
    }
  }

  // Bar / Line
  const isHorizontal = chart.orient === 'horizontal'
  const seriesData = (chart.series || []).map(s => ({
    name: s.name,
    type: chart.type || 'bar',
    data: s.data,
    smooth: chart.type === 'line',
    itemStyle: s.color ? { color: s.color } : undefined,
    lineStyle: s.color ? { color: s.color } : undefined,
    areaStyle: chart.type === 'line' ? { 
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: (s.color || '#22d3ee') + '40' },
        { offset: 1, color: (s.color || '#22d3ee') + '05' },
      ])
    } : undefined,
    barMaxWidth: 32,
    barBorderRadius: [4, 4, 0, 0],
  }))

  return {
    title: titleStyle,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
    },
    legend: seriesData.length > 1 ? {
      bottom: 4,
      textStyle: { color: '#94a3b8', fontSize: 11 },
    } : undefined,
    grid: {
      left: 12,
      right: 16,
      top: chart.title ? 40 : 16,
      bottom: seriesData.length > 1 ? 32 : 12,
      containLabel: true,
    },
    xAxis: {
      type: isHorizontal ? 'value' : 'category',
      data: isHorizontal ? undefined : (chart.xAxis || []),
      axisLabel: { ...baseTextStyle, fontSize: 10, rotate: (chart.xAxis?.length > 8) ? 30 : 0 },
      axisLine: { lineStyle: { color: '#334155' } },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    yAxis: {
      type: isHorizontal ? 'category' : 'value',
      data: isHorizontal ? (chart.xAxis || []) : undefined,
      name: chart.yAxisLabel || '',
      nameTextStyle: { ...baseTextStyle, fontSize: 10 },
      axisLabel: { ...baseTextStyle, fontSize: 10 },
      axisLine: { lineStyle: { color: '#334155' } },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series: seriesData,
  }
}

// Cleanup chart instances + voice mode
onBeforeUnmount(() => {
  chartInstances.forEach(instance => {
    try { instance.dispose() } catch (e) { /* ignore */ }
  })
  stopVoiceMode()
})
</script>

<style scoped>
/* ═══════════════════════════════════════════════
   Chatbot Notch — Top center, clean design
   ═══════════════════════════════════════════════ */
.chatbot-notch {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px 28px 14px;
  border: none;
  border-radius: 0 0 24px 24px;
  cursor: pointer;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.92);
  background: #1a2235;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.chatbot-notch:hover {
  background: #212d44;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.45);
}

.chatbot-notch:active {
  transform: translateX(-50%) scale(0.97);
}

.notch-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0a6de3, #29a3ff);
}

.notch-icon svg {
  width: 12px;
  height: 12px;
}

.notch-label {
  letter-spacing: 0.01em;
}

.notch-pulse {
  position: absolute;
  top: 6px;
  right: 10px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34d399;
  animation: notch-pulse 2s ease-in-out infinite;
}

@keyframes notch-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.6; }
}

/* ═══════════════════════════════════════════════
   Chat Panel — Expands downward from the notch
   ═══════════════════════════════════════════════ */
.chatbot-panel {
  position: fixed;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  width: 680px;
  max-width: calc(100vw - 32px);
  height: calc(100vh - 24px);
  max-height: 900px;
  display: flex;
  flex-direction: column;
  border-radius: 24px;
  overflow: hidden;
  background: linear-gradient(170deg, 
    rgba(17, 24, 39, 0.98) 0%, 
    rgba(11, 17, 33, 0.99) 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 
    0 25px 60px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  backdrop-filter: blur(24px);
}

.chatbot-panel-fullscreen {
  width: 100vw;
  max-width: 100vw;
  height: 100vh;
  max-height: 100vh;
  top: 0;
  left: 0;
  transform: none;
  border-radius: 0;
  border: none;
}

/* ── Panel Transition — expands from notch pill ── */
.chatpanel-enter-active {
  animation: panel-open 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: top center;
}
.chatpanel-leave-active {
  animation: panel-close 0.3s ease-in forwards;
  transform-origin: top center;
}

@keyframes panel-open {
  0% {
    opacity: 0;
    transform: translateX(-50%) scaleX(0.3) scaleY(0.05);
    border-radius: 28px;
  }
  40% {
    opacity: 1;
    transform: translateX(-50%) scaleX(0.95) scaleY(0.3);
    border-radius: 26px;
  }
  100% {
    transform: translateX(-50%) scaleX(1) scaleY(1);
    border-radius: 24px;
  }
}

@keyframes panel-close {
  0% {
    opacity: 1;
    transform: translateX(-50%) scaleX(1) scaleY(1);
  }
  100% {
    opacity: 0;
    transform: translateX(-50%) scaleX(0.4) scaleY(0.05);
    border-radius: 28px;
  }
}

/* ── Header ── */
.chatbot-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: linear-gradient(135deg, #0a6de3, #29a3ff);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 12px rgba(10, 109, 227, 0.3);
}

.header-title {
  font-size: 15px;
  font-weight: 700;
  color: #f1f5f9;
  letter-spacing: 0.01em;
}

.header-subtitle {
  font-size: 11px;
  color: #64748b;
  margin-top: 1px;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.header-btn {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: #64748b;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.header-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #e2e8f0;
}

/* ── Messages Area ── */
.chatbot-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chatbot-messages::-webkit-scrollbar {
  width: 4px;
}
.chatbot-messages::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

/* ── Welcome ── */
.welcome-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 28px 16px;
  animation: fade-in-up 0.5s ease-out;
}

.welcome-icon {
  width: 64px;
  height: 64px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(10, 109, 227, 0.2), rgba(41, 163, 255, 0.1));
  border: 1px solid rgba(41, 163, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #29a3ff;
  margin-bottom: 16px;
}

.welcome-title {
  font-size: 17px;
  font-weight: 700;
  color: #f1f5f9;
  margin-bottom: 8px;
}

.welcome-text {
  font-size: 13px;
  color: #94a3b8;
  line-height: 1.6;
  max-width: 300px;
}

.welcome-text strong {
  color: #22d3ee;
}

.suggested-questions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
  justify-content: center;
}

.suggested-btn {
  padding: 8px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: #94a3b8;
  font-size: 12px;
  font-family: 'Inter', sans-serif;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.suggested-btn:hover {
  background: rgba(41, 163, 255, 0.1);
  border-color: rgba(41, 163, 255, 0.2);
  color: #e2e8f0;
  transform: translateY(-1px);
}

/* ── Message Bubbles ── */
.message-wrapper {
  display: flex;
  gap: 10px;
  animation: msg-appear 0.3s ease-out;
}

.message-user {
  justify-content: flex-end;
}

.message-assistant {
  justify-content: flex-start;
}

.message-avatar {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: linear-gradient(135deg, #0a6de3, #29a3ff);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
  margin-top: 2px;
}

.message-bubble {
  max-width: 82%;
  padding: 12px 16px;
  border-radius: 16px;
  font-size: 13px;
  line-height: 1.65;
}

.message-user .message-bubble {
  background: linear-gradient(135deg, #0a6de3, #1185f7);
  color: white;
  border-bottom-right-radius: 6px;
}

.message-assistant .message-bubble {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
  border-bottom-left-radius: 6px;
}

.error-bubble {
  border-color: rgba(239, 68, 68, 0.2) !important;
  background: rgba(239, 68, 68, 0.08) !important;
}

/* ── Markdown in messages ── */
.message-text :deep(p) {
  margin: 0 0 8px 0;
}

.message-text :deep(p:last-child) {
  margin-bottom: 0;
}

.message-text :deep(strong) {
  color: #f1f5f9;
  font-weight: 600;
}

.message-text :deep(ul),
.message-text :deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}

.message-text :deep(li) {
  margin: 3px 0;
}

.message-text :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
}

.message-text :deep(th) {
  background: rgba(255, 255, 255, 0.06);
  padding: 6px 10px;
  font-weight: 600;
  color: #cbd5e1;
  text-align: left;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.message-text :deep(td) {
  padding: 5px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.message-text :deep(code) {
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'Fira Code', monospace;
}

.message-text :deep(h1),
.message-text :deep(h2),
.message-text :deep(h3) {
  color: #f1f5f9;
  margin: 10px 0 6px 0;
  font-size: 14px;
  font-weight: 700;
}

.message-text :deep(hr) {
  border: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin: 10px 0;
}

/* ── Charts ── */
.message-chart {
  margin-top: 10px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.2);
}

.chart-container {
  width: 100%;
  height: 240px;
}

.message-diagram {
  margin-top: 10px;
  padding: 16px;
  border-radius: 12px;
  overflow-x: auto;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  justify-content: center;
}

.message-diagram svg {
  max-width: 100%;
  height: auto;
}

/* ── Loading / Typing ── */
.loading-bubble {
  display: flex;
  align-items: center;
  gap: 10px;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  align-items: center;
}

.typing-indicator span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #64748b;
  animation: typing-pulse 1.4s ease-in-out infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

.typing-text {
  font-size: 12px;
  color: #64748b;
  font-style: italic;
}

@keyframes typing-pulse {
  0%, 60%, 100% { transform: scale(0.7); opacity: 0.4; }
  30% { transform: scale(1); opacity: 1; }
}

/* ── Input Area ── */
.chatbot-input {
  padding: 14px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.15);
}

.input-wrapper {
  display: flex;
  gap: 8px;
  align-items: center;
}

.chat-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  color: #f1f5f9;
  font-size: 13px;
  font-family: 'Inter', sans-serif;
  padding: 11px 16px;
  outline: none;
  transition: all 0.2s;
}

.chat-input:focus {
  border-color: rgba(41, 163, 255, 0.3);
  box-shadow: 0 0 0 3px rgba(41, 163, 255, 0.08);
  background: rgba(255, 255, 255, 0.08);
}

.chat-input::placeholder {
  color: #475569;
}

.chat-input:disabled {
  opacity: 0.5;
}

.send-btn {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, #0a6de3, #1185f7);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  transform: scale(1.05);
  box-shadow: 0 4px 15px rgba(10, 109, 227, 0.4);
}

.send-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ── Animations ── */
@keyframes fade-in-up {
  0% { opacity: 0; transform: translateY(16px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes msg-appear {
  0% { opacity: 0; transform: translateY(8px); }
  100% { opacity: 1; transform: translateY(0); }
}

/* ── Responsive ── */
@media (max-width: 640px) {
  .chatbot-notch {
    top: 8px;
  }

  .chatbot-panel {
    width: calc(100vw - 12px);
    height: calc(100vh - 16px);
    max-height: none;
    top: 6px;
    border-radius: 20px;
  }
}

/* ═══════════════════════════════════════════════
   Mic Button
   ═══════════════════════════════════════════════ */
.mic-btn {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, #16a34a, #22c55e);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.mic-btn:hover:not(:disabled) {
  transform: scale(1.05);
  box-shadow: 0 0 16px rgba(34, 197, 94, 0.3);
}

.mic-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ═══════════════════════════════════════════════
   Voice Mode Overlay
   ═══════════════════════════════════════════════ */
.voice-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.voice-modal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  padding: 40px;
}

.voice-status-label {
  font-family: 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.02em;
}

/* ── Animated Orb ── */
.voice-orb {
  position: relative;
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.voice-ring {
  position: absolute;
  border-radius: 50%;
  border: 2px solid rgba(41, 163, 255, 0.3);
}

.voice-ring-1 {
  width: 100%;
  height: 100%;
  animation: voice-ring-pulse 2s ease-in-out infinite;
}

.voice-ring-2 {
  width: 130%;
  height: 130%;
  animation: voice-ring-pulse 2s ease-in-out 0.4s infinite;
}

.voice-ring-3 {
  width: 160%;
  height: 160%;
  animation: voice-ring-pulse 2s ease-in-out 0.8s infinite;
}

.voice-orb--listening .voice-ring {
  border-color: rgba(34, 197, 94, 0.4);
}

.voice-orb--processing .voice-ring {
  border-color: rgba(168, 85, 247, 0.4);
  animation-duration: 1s;
}

.voice-orb--speaking .voice-ring {
  border-color: rgba(41, 163, 255, 0.4);
  animation-duration: 1.5s;
}

.voice-core {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0a6de3, #29a3ff);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 40px rgba(10, 109, 227, 0.3);
}

.voice-orb--listening .voice-core {
  background: linear-gradient(135deg, #16a34a, #22c55e);
  box-shadow: 0 0 40px rgba(34, 197, 94, 0.3);
}

.voice-orb--processing .voice-core {
  background: linear-gradient(135deg, #7c3aed, #a855f7);
  box-shadow: 0 0 40px rgba(168, 85, 247, 0.3);
  animation: voice-spin 1.5s linear infinite;
}

.voice-core svg {
  width: 32px;
  height: 32px;
  color: white;
}

@keyframes voice-ring-pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.08); opacity: 0.2; }
}

@keyframes voice-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* ── Transcript ── */
.voice-transcript {
  font-family: 'Inter', sans-serif;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.85);
  max-width: 400px;
  text-align: center;
  line-height: 1.5;
  min-height: 24px;
}

.voice-transcript--dim {
  color: rgba(255, 255, 255, 0.35);
  font-style: italic;
}

/* ── Stop Button ── */
.voice-stop-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  border-radius: 50px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.voice-stop-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}

.voice-stop-btn svg {
  width: 18px;
  height: 18px;
}

/* ── Voice Fade Transition ── */
.voicefade-enter-active,
.voicefade-leave-active {
  transition: opacity 0.3s ease;
}

.voicefade-enter-from,
.voicefade-leave-to {
  opacity: 0;
}
</style>
