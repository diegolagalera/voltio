import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/services/api.js'

export const useAuthStore = defineStore('auth', () => {
    const user = ref(JSON.parse(localStorage.getItem('fpsaver_user') || 'null'))
    const isAuthenticated = computed(() => !!user.value)
    const role = computed(() => user.value?.role || null)
    const companyId = computed(() => user.value?.companyId || null)

    /**
     * Login
     */
    const login = async (email, password) => {
        const response = await api.post('/auth/login', { email, password })
        const { accessToken, refreshToken, user: userData } = response.data.data

        localStorage.setItem('fpsaver_access_token', accessToken)
        localStorage.setItem('fpsaver_refresh_token', refreshToken)
        localStorage.setItem('fpsaver_user', JSON.stringify(userData))
        user.value = userData

        return userData
    }

    /**
     * Fetch current user profile
     */
    const fetchMe = async () => {
        try {
            const response = await api.get('/auth/me')
            user.value = response.data.data
            localStorage.setItem('fpsaver_user', JSON.stringify(response.data.data))
            return response.data.data
        } catch {
            logout()
            return null
        }
    }

    /**
     * Logout
     */
    const logout = async () => {
        try {
            await api.post('/auth/logout')
        } catch {
            // Ignore logout errors
        } finally {
            localStorage.removeItem('fpsaver_access_token')
            localStorage.removeItem('fpsaver_refresh_token')
            localStorage.removeItem('fpsaver_user')
            user.value = null
        }
    }

    /**
     * Check if user has one of the given roles
     */
    const hasRole = (...roles) => {
        return roles.includes(user.value?.role)
    }

    /**
     * Check if user has access to a specific factory
     */
    const hasFactoryAccess = (factoryId) => {
        if (!user.value) return false
        if (user.value.role === 'superadmin' || user.value.role === 'manager') return true
        return user.value.factories?.some((f) => f.id === factoryId) || false
    }

    return {
        user,
        isAuthenticated,
        role,
        companyId,
        login,
        fetchMe,
        logout,
        hasRole,
        hasFactoryAccess,
    }
})
