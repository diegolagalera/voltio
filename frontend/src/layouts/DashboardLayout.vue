<template>
  <div class="flex h-screen overflow-hidden bg-surface-900">
    <!-- Sidebar -->
    <aside 
      class="w-64 bg-surface-800 border-r border-surface-700 flex flex-col shrink-0"
    >
      <!-- Brand -->
      <div class="p-5 border-b border-surface-700">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 class="text-white font-bold text-lg leading-tight">Voltio</h1>
            <p class="text-surface-400 text-xs">{{ companyName }}</p>
          </div>
          <NotificationBell v-if="authStore.role !== 'superadmin'" class="ml-auto" />
        </div>
      </div>

      <!-- Factory Selector (regular users only) -->
      <div v-if="authStore.role !== 'superadmin'" class="px-3 pt-4 pb-2">
        <label class="text-[10px] uppercase tracking-wider text-surface-500 font-semibold px-1 mb-1 block">Planta</label>
        <select
          :value="factoryStore.selectedFactoryId"
          @change="onFactoryChange($event.target.value)"
          class="w-full bg-surface-700 border border-surface-600 text-white text-sm rounded-lg px-3 py-2.5 outline-none appearance-none cursor-pointer hover:border-surface-500 focus:border-primary-500 transition-colors"
        >
          <option v-if="!factoryStore.factories.length" value="" disabled>Cargando...</option>
          <option 
            v-for="f in factoryStore.factories" 
            :key="f.id" 
            :value="f.id"
          >
            {{ f.name }}
          </option>
        </select>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
        <!-- Section: Monitorización -->
        <p v-if="authStore.role !== 'superadmin'" class="text-[10px] uppercase tracking-wider text-surface-500 font-semibold px-3 pt-3 pb-1.5">Monitorización</p>
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group"
          :class="[
            isActive(item)
              ? 'bg-primary-600/15 text-primary-400' 
              : item.disabled
                ? 'text-surface-600 pointer-events-none'
                : 'text-surface-300 hover:bg-surface-700 hover:text-white'
          ]"
        >
          <span v-html="item.icon" class="w-5 h-5 shrink-0"></span>
          {{ item.label }}
        </router-link>

        <!-- Section: Administración -->
        <template v-if="adminItems.length">
          <p class="text-[10px] uppercase tracking-wider text-surface-500 font-semibold px-3 pt-4 pb-1.5">Administración</p>
          <router-link
            v-for="item in adminItems"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group"
            :class="[
              $route.path.startsWith(item.to) 
                ? 'bg-primary-600/15 text-primary-400' 
                : 'text-surface-300 hover:bg-surface-700 hover:text-white'
            ]"
          >
            <span v-html="item.icon" class="w-5 h-5 shrink-0"></span>
            {{ item.label }}
          </router-link>
        </template>
      </nav>

      <!-- Language Selector -->
      <div class="px-4 py-3 border-t border-surface-700">
        <select 
          v-model="locale" 
          class="w-full bg-surface-700 border border-surface-600 text-surface-200 text-sm rounded-lg px-3 py-2 outline-none cursor-pointer hover:border-surface-500 focus:border-primary-500 transition-colors"
        >
          <option value="es">🇪🇸 Español</option>
          <option value="en">🇬🇧 English</option>
        </select>
      </div>

      <!-- User Section -->
      <div class="p-4 border-t border-surface-700">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-surface-600 flex items-center justify-center text-sm font-semibold text-white">
            {{ initials }}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-white truncate">{{ displayName }}</p>
            <p class="text-xs text-surface-400">{{ t(`roles.${authStore.role}`) }}</p>
          </div>
          <button
            id="logout-btn"
            @click="handleLogout"
            class="p-2 rounded-lg text-surface-400 hover:text-alarm-400 hover:bg-surface-700 transition-colors"
            :title="t('nav.logout')"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto">
      <!-- Page Content -->
      <div class="p-6">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </div>
    </main>

    <!-- AI Energy Chatbot -->
    <EnergyChatbot v-if="authStore.role !== 'superadmin' && factoryStore.selectedFactoryId" />
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.store.js'
import { useFactoryStore } from '@/stores/factory.store.js'
import NotificationBell from '@/components/NotificationBell.vue'
import EnergyChatbot from '@/components/EnergyChatbot.vue'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const factoryStore = useFactoryStore()

const companyName = computed(() => authStore.user?.companyName || 'Voltio')
const displayName = computed(() => {
  const u = authStore.user
  return u ? `${u.firstName} ${u.lastName}` : ''
})
const initials = computed(() => {
  const u = authStore.user
  return u ? `${(u.firstName || '')[0]}${(u.lastName || '')[0]}`.toUpperCase() : '?'
})

// Selected factory ID — syncs with route
const selectedId = computed(() => 
  route.params.factoryId || factoryStore.selectedFactoryId
)

// On factory dropdown change
const onFactoryChange = (factoryId) => {
  factoryStore.setSelectedFactory(factoryId)
  // Navigate to the same sub-page for the new factory
  const currentPath = route.path
  const subPage = currentPath.replace(/^\/factory\/[^/]+/, '')
  router.push(`/factory/${factoryId}${subPage || ''}`)
}

// Load factories on mount
onMounted(async () => {
  if (authStore.role !== 'superadmin' && !factoryStore.factories.length) {
    await factoryStore.fetchFactories()
  }
})

// Sync store selection with route
watch(() => route.params.factoryId, (newId) => {
  if (newId && newId !== factoryStore.selectedFactoryId) {
    factoryStore.setSelectedFactory(newId)
  }
})

// SVG icons
const ICONS = {
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
  building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>',
  factory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4z"/></svg>',
  cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>',
  euro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.121 15.536c-1.171 1.952-3.07 1.952-4.242 0-1.172-1.953-1.172-5.119 0-7.072 1.171-1.952 3.07-1.952 4.242 0M8 10.5h4m-4 3h4"/></svg>',
}

const currentPageTitle = computed(() => {
  const name = route.name || ''
  if (name.startsWith('SA')) {
    if (name.includes('Companies')) return t('nav.companies')
    if (name.includes('Factories')) return t('nav.factories')
    return 'Panel SuperAdmin'
  }
  if (name.includes('Dashboard') && !name.includes('Factory')) return t('nav.dashboard')
  if (name.includes('User')) return t('nav.users')
  if (name.includes('Contract')) return t('nav.contracts')
  if (name.includes('EnergyReports')) return 'Informes Energéticos'
  if (name.includes('EsiosPrices')) return 'Precios Mercado Eléctrico'
  if (name.includes('FactoryDashboard')) return 'Tiempo Real'
  if (name.includes('ProductionLineDetail')) return 'Línea de Producción'
  if (name.includes('ProductionLines')) return 'Líneas de Producción'
  if (name.includes('Alarm')) return t('nav.alarms')
  if (name.includes('History')) return 'Historial'
  if (name.includes('Settings')) return 'Configuración'
  if (name.includes('KPI')) return t('nav.kpi')
  if (name.includes('Device')) return 'Dispositivo'
  return t('nav.dashboard')
})

// Is a nav item active?
const isActive = (item) => {
  if (item.exact) {
    // For "Tiempo Real" — active only on /factory/:id exactly
    return route.path === item.to || route.path === item.to + '/'
  }
  return route.path.startsWith(item.to)
}

const navItems = computed(() => {
  const role = authStore.role

  // SuperAdmin navigation
  if (role === 'superadmin') {
    return [
      { to: '/superadmin', label: t('nav.dashboard'), icon: ICONS.grid, exact: true },
      { to: '/superadmin/companies', label: t('nav.companies'), icon: ICONS.building },
      { to: '/superadmin/factories', label: t('nav.factories'), icon: ICONS.factory },
    ]
  }

  // Regular user: factory-scoped pages
  const fid = selectedId.value
  if (!fid) {
    return [
      { to: '#', label: 'Tiempo Real', icon: ICONS.bolt, disabled: true },
      { to: '#', label: 'Informes Energéticos', icon: ICONS.chart, disabled: true },
      { to: '#', label: 'Precios Mercado', icon: ICONS.euro, disabled: true },
      { to: '#', label: 'Alarmas', icon: ICONS.bell, disabled: true },
      { to: '#', label: 'Historial', icon: ICONS.clock, disabled: true },
    ]
  }

  return [
    { to: `/factory/${fid}`, label: 'Tiempo Real', icon: ICONS.bolt, exact: true },
    { to: `/factory/${fid}/reports`, label: 'Informes Energéticos', icon: ICONS.chart },
    { to: `/kpi/${fid}`, label: 'KPIs Gerencia', icon: '📊' },
    { to: `/factory/${fid}/market-prices`, label: 'Precios Mercado', icon: ICONS.euro },
    { to: `/factory/${fid}/alarms`, label: 'Alarmas', icon: ICONS.bell },
    { to: `/factory/${fid}/production-lines`, label: 'Líneas de Producción', icon: ICONS.factory },
    { to: `/factory/${fid}/history`, label: 'Historial', icon: ICONS.clock },
  ]
})

// Admin items (below separator)
const adminItems = computed(() => {
  const role = authStore.role
  if (role === 'superadmin') return []

  const items = []
  if (role === 'manager') {
    items.push({ to: '/dashboard/users', label: t('nav.users'), icon: ICONS.users })
  }
  if (role === 'manager' || role === 'gerencia') {
    items.push({ to: '/dashboard/contracts', label: t('nav.contracts'), icon: ICONS.doc })
  }
  // Settings (manager only, needs factory)
  const fid = selectedId.value
  if (fid && role === 'manager') {
    items.push({ to: `/factory/${fid}/settings`, label: 'Configuración', icon: ICONS.cog })
  }
  return items
})

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}
</script>
