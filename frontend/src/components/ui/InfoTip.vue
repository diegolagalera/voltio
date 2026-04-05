<template>
  <span
    class="info-tip"
    ref="triggerRef"
    @mouseenter="openTip"
    @mouseleave="closeTip"
    @click.stop.prevent="toggleTip"
  >
    <svg class="info-tip__icon" viewBox="0 0 16 16" fill="currentColor">
      <path fill-rule="evenodd" d="M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0zM9 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM6.5 8a.5.5 0 0 0 0 1H7v2h-.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1H9V8a.5.5 0 0 0-.5-.5h-2z"/>
    </svg>
    <Teleport to="body">
      <Transition name="tip-fade">
        <div
          v-if="show"
          class="info-tip__popover"
          :style="popoverStyle"
        >
          <div class="info-tip__arrow" :style="arrowStyle"></div>
          <div class="info-tip__content">
            <p v-if="title" class="info-tip__title">{{ title }}</p>
            <p class="info-tip__text"><slot /></p>
          </div>
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<script setup>
import { ref, reactive, nextTick } from 'vue'

defineProps({
  title: { type: String, default: '' },
})

const show = ref(false)
const triggerRef = ref(null)
const popoverStyle = reactive({})
const arrowStyle = reactive({})

const updatePosition = async () => {
  await nextTick()
  if (!triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  const popW = 280
  const margin = 12

  // Try to show above; if not enough space, show below
  let top, arrowTop
  const showAbove = rect.top > 120

  if (showAbove) {
    top = rect.top - margin + window.scrollY
    popoverStyle.transform = 'translateX(-50%) translateY(-100%)'
    arrowStyle.bottom = '-4px'
    arrowStyle.top = 'auto'
    arrowStyle.borderRight = '1px solid var(--color-surface-600)'
    arrowStyle.borderBottom = '1px solid var(--color-surface-600)'
    arrowStyle.borderTop = 'none'
    arrowStyle.borderLeft = 'none'
  } else {
    top = rect.bottom + margin + window.scrollY
    popoverStyle.transform = 'translateX(-50%) translateY(0)'
    arrowStyle.top = '-4px'
    arrowStyle.bottom = 'auto'
    arrowStyle.borderLeft = '1px solid var(--color-surface-600)'
    arrowStyle.borderTop = '1px solid var(--color-surface-600)'
    arrowStyle.borderRight = 'none'
    arrowStyle.borderBottom = 'none'
  }

  let left = rect.left + rect.width / 2

  // Clamp to viewport
  const halfW = popW / 2
  if (left - halfW < margin) left = halfW + margin
  if (left + halfW > window.innerWidth - margin) left = window.innerWidth - margin - halfW

  popoverStyle.top = top + 'px'
  popoverStyle.left = left + 'px'
}

const openTip = () => {
  show.value = true
  updatePosition()
}
const closeTip = () => { show.value = false }
const toggleTip = () => {
  show.value = !show.value
  if (show.value) updatePosition()
}
</script>

<style scoped>
.info-tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: help;
  vertical-align: middle;
  margin-left: 4px;
}

.info-tip__icon {
  width: 13px;
  height: 13px;
  color: var(--color-surface-500);
  opacity: 0.6;
  transition: all 0.2s ease;
}

.info-tip:hover .info-tip__icon {
  color: var(--color-primary-400);
  opacity: 1;
  transform: scale(1.15);
}
</style>

<style>
/* Global styles for teleported popover */
.info-tip__popover {
  position: absolute;
  z-index: 9999;
  width: max-content;
  max-width: 280px;
  pointer-events: none;
}

.info-tip__arrow {
  position: absolute;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 8px;
  height: 8px;
  background: var(--color-surface-700);
}

.info-tip__content {
  background: var(--color-surface-700);
  border: 1px solid var(--color-surface-600);
  border-radius: 10px;
  padding: 10px 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(12px);
}

.info-tip__title {
  color: var(--color-primary-400);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.info-tip__text {
  color: var(--color-surface-200);
  font-size: 12px;
  line-height: 1.5;
  white-space: normal;
}

.tip-fade-enter-active { transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
.tip-fade-leave-active { transition: all 0.12s ease-in; }
.tip-fade-enter-from,
.tip-fade-leave-to { opacity: 0; }
</style>
