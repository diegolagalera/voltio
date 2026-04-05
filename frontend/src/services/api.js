import axios from 'axios'

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api',
    timeout: 15000,
    headers: {
        'Content-Type': 'application/json',
    },
})

// Request interceptor — inject auth token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('fpsaver_access_token')
        if (token) {
            config.headers.Authorization = `Bearer ${token}`
        }
        return config
    },
    (error) => Promise.reject(error)
)

// ─── Refresh Token Mutex ────────────────────────────────────────────
// Only one refresh request runs at a time. All concurrent 401 responses
// wait for the same refresh promise, then retry with the new token.
let isRefreshing = false
let refreshSubscribers = []

const onRefreshed = (newAccessToken) => {
    refreshSubscribers.forEach(cb => cb(newAccessToken))
    refreshSubscribers = []
}

const onRefreshFailed = (error) => {
    refreshSubscribers.forEach(cb => cb(null, error))
    refreshSubscribers = []
}

const subscribeToRefresh = (cb) => {
    refreshSubscribers.push(cb)
}
// ────────────────────────────────────────────────────────────────────

// Response interceptor — handle token refresh with mutex
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config

        // Only intercept 401s that haven't been retried yet
        if (error.response?.status !== 401 || originalRequest._retry) {
            return Promise.reject(error)
        }

        // Skip refresh attempts for the refresh endpoint itself
        if (originalRequest.url?.includes('/auth/refresh')) {
            return Promise.reject(error)
        }

        originalRequest._retry = true

        // If a refresh is already in flight, queue this request
        if (isRefreshing) {
            return new Promise((resolve, reject) => {
                subscribeToRefresh((newToken, err) => {
                    if (err) return reject(err)
                    originalRequest.headers.Authorization = `Bearer ${newToken}`
                    resolve(api(originalRequest))
                })
            })
        }

        // This is the first 401 — take the lock and refresh
        isRefreshing = true

        try {
            const refreshToken = localStorage.getItem('fpsaver_refresh_token')
            if (!refreshToken) {
                throw new Error('No refresh token')
            }

            const response = await axios.post(
                `${api.defaults.baseURL}/auth/refresh`,
                { refreshToken }
            )

            const { accessToken, refreshToken: newRefreshToken } = response.data.data
            localStorage.setItem('fpsaver_access_token', accessToken)
            localStorage.setItem('fpsaver_refresh_token', newRefreshToken)

            // Notify all queued requests with the new token
            onRefreshed(accessToken)

            // Retry the original request
            originalRequest.headers.Authorization = `Bearer ${accessToken}`
            return api(originalRequest)
        } catch (refreshError) {
            // Refresh failed → notify all queued requests and logout
            onRefreshFailed(refreshError)

            localStorage.removeItem('fpsaver_access_token')
            localStorage.removeItem('fpsaver_refresh_token')
            localStorage.removeItem('fpsaver_user')
            window.location.href = '/login'
            return Promise.reject(refreshError)
        } finally {
            isRefreshing = false
        }
    }
)

export default api
