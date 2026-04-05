import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store.js'

const routes = [
    // ============ Auth ============
    {
        path: '/login',
        name: 'Login',
        component: () => import('@/views/auth/LoginView.vue'),
        meta: { requiresAuth: false, layout: 'auth' },
    },

    // ============ SuperAdmin ============
    {
        path: '/superadmin',
        meta: { requiresAuth: true, roles: ['superadmin'], layout: 'superadmin' },
        children: [
            {
                path: '',
                name: 'SADashboard',
                component: () => import('@/views/superadmin/SADashboard.vue'),
            },
            {
                path: 'companies',
                name: 'SACompanies',
                component: () => import('@/views/superadmin/SACompanies.vue'),
            },
            {
                path: 'factories',
                name: 'SAFactories',
                component: () => import('@/views/superadmin/SAFactories.vue'),
            },
        ],
    },

    // ============ Dashboard (Manager / Gerencia / Operador) ============
    {
        path: '/dashboard',
        meta: { requiresAuth: true, roles: ['manager', 'gerencia', 'operador'], layout: 'dashboard' },
        children: [
            {
                path: '',
                name: 'Dashboard',
                component: () => import('@/views/manager/ManagerDashboard.vue'),
            },
            {
                path: 'users',
                name: 'UserManagement',
                component: () => import('@/views/manager/UserManagement.vue'),
                meta: { roles: ['manager'] },
            },
            {
                path: 'contracts',
                name: 'ContractManagement',
                component: () => import('@/views/manager/ContractManagement.vue'),
                meta: { roles: ['manager', 'gerencia'] },
            },
        ],
    },

    // ============ Factory ============
    {
        path: '/factory/:factoryId',
        meta: { requiresAuth: true, requiresFactoryAccess: true, layout: 'dashboard' },
        children: [
            {
                path: '',
                name: 'FactoryDashboard',
                component: () => import('@/views/factory/FactoryDashboard.vue'),
            },
            {
                path: 'history',
                name: 'FactoryHistory',
                component: () => import('@/views/factory/FactoryHistory.vue'),
            },
            {
                path: 'device/:deviceId',
                name: 'DeviceDetail',
                component: () => import('@/views/factory/DeviceDetail.vue'),
            },
            {
                path: 'alarms',
                name: 'AlarmsView',
                component: () => import('@/views/factory/AlarmsView.vue'),
            },
            {
                path: 'reports',
                name: 'EnergyReports',
                component: () => import('@/views/factory/EnergyReports.vue'),
            },
            {
                path: 'market-prices',
                name: 'EsiosPrices',
                component: () => import('@/views/factory/EsiosPrices.vue'),
            },
            {
                path: 'settings',
                name: 'FactorySettings',
                component: () => import('@/views/factory/FactorySettings.vue'),
                meta: { roles: ['superadmin', 'manager'] },
            },
            {
                path: 'production-lines',
                name: 'ProductionLines',
                component: () => import('@/views/factory/ProductionLines.vue'),
            },
            {
                path: 'production-lines/:lineId',
                name: 'ProductionLineDetail',
                component: () => import('@/views/factory/ProductionLineDetail.vue'),
            },
        ],
    },

    // ============ KPI (Gerencia only) ============
    {
        path: '/kpi',
        meta: { requiresAuth: true, roles: ['manager', 'superadmin'], layout: 'dashboard' },
        children: [
            {
                path: ':factoryId',
                name: 'KPIDashboard',
                component: () => import('@/views/kpi/KPIDashboard.vue'),
            },
        ],
    },

    // ============ Fallback ============
    {
        path: '/forbidden',
        name: 'Forbidden',
        component: () => import('@/views/shared/ForbiddenView.vue'),
    },
    {
        path: '/:pathMatch(.*)*',
        name: 'NotFound',
        component: () => import('@/views/shared/NotFoundView.vue'),
    },
]

const router = createRouter({
    history: createWebHistory(),
    routes,
})

// ============ Navigation Guards ============
router.beforeEach(async (to, from, next) => {
    const authStore = useAuthStore()

    // Public routes
    if (to.meta.requiresAuth === false) {
        if (authStore.isAuthenticated) {
            // Redirect logged-in users to their home
            return next(getHomeRoute(authStore.role))
        }
        return next()
    }

    // Auth required
    if (!authStore.isAuthenticated) {
        return next('/login')
    }

    // Role check (check route and parent route meta)
    const requiredRoles = to.meta.roles || to.matched.find(r => r.meta.roles)?.meta.roles
    if (requiredRoles && !requiredRoles.includes(authStore.role)) {
        return next('/forbidden')
    }

    // Factory access check
    if (to.meta.requiresFactoryAccess || to.matched.some(r => r.meta.requiresFactoryAccess)) {
        const factoryId = to.params.factoryId
        if (factoryId && !authStore.hasFactoryAccess(factoryId)) {
            return next('/forbidden')
        }
    }

    next()
})

/**
 * Get the home route based on user role
 */
function getHomeRoute(role) {
    switch (role) {
        case 'superadmin': return '/superadmin'
        case 'manager': return '/dashboard'
        case 'gerencia': return '/dashboard'
        case 'operador': return '/dashboard'
        default: return '/login'
    }
}

export { getHomeRoute }
export default router
