<template>
  <div class="min-h-screen flex items-center justify-center bg-surface-900 p-4">
    <div class="w-full max-w-md animate-slide-up">
      <!-- Logo Section -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 mb-4">
          <svg class="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h1 class="text-3xl font-bold text-white">Voltio</h1>
        <p class="text-surface-300 mt-1 text-sm">{{ t('app.tagline') }}</p>
      </div>

      <!-- Login Card -->
      <div class="glass-card p-8">
        <h2 class="text-xl font-semibold text-white mb-6">{{ t('auth.login') }}</h2>

        <form @submit.prevent="handleLogin" class="space-y-5">
          <!-- Email -->
          <div>
            <label class="block text-sm font-medium text-surface-300 mb-1.5">{{ t('auth.email') }}</label>
            <input
              id="login-email"
              v-model="email"
              type="email"
              class="input"
              :placeholder="t('auth.email')"
              required
              autocomplete="email"
            />
          </div>

          <!-- Password -->
          <div>
            <label class="block text-sm font-medium text-surface-300 mb-1.5">{{ t('auth.password') }}</label>
            <input
              id="login-password"
              v-model="password"
              type="password"
              class="input"
              :placeholder="t('auth.password')"
              required
              autocomplete="current-password"
            />
          </div>

          <!-- Error Message -->
          <div v-if="error" class="p-3 rounded-lg bg-alarm-500/10 border border-alarm-500/20">
            <p class="text-sm text-alarm-400">{{ error }}</p>
          </div>

          <!-- Submit Button -->
          <button
            id="login-submit"
            type="submit"
            class="btn-primary w-full justify-center text-base py-3"
            :disabled="loading"
          >
            <svg v-if="loading" class="animate-spin w-5 h-5" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" />
            </svg>
            {{ loading ? t('common.loading') : t('auth.submit') }}
          </button>
        </form>
      </div>

      <!-- Footer -->
      <p class="text-center text-surface-500 text-xs mt-6">
        © {{ new Date().getFullYear() }} Voltio · Industrial Energy Intelligence
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.store.js'
import { getHomeRoute } from '@/router/index.js'

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const handleLogin = async () => {
  error.value = ''
  loading.value = true

  try {
    const user = await authStore.login(email.value, password.value)
    router.push(getHomeRoute(user.role))
  } catch (err) {
    error.value = err.response?.data?.message || t('auth.error')
  } finally {
    loading.value = false
  }
}
</script>
