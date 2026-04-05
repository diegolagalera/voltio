import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import router from './router/index.js'
import App from './App.vue'
import es from './i18n/es.json'
import en from './i18n/en.json'
import './assets/css/main.css'

// i18n setup
const i18n = createI18n({
    legacy: false,
    locale: 'es',
    fallbackLocale: 'en',
    messages: { es, en },
})

// Create Vue app
const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

app.mount('#app')
