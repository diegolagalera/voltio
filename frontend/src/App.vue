<template>
  <DashboardLayout v-if="showDashboardLayout">
    <router-view />
  </DashboardLayout>
  <router-view v-else />
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'

const route = useRoute()

const showDashboardLayout = computed(() => {
  const layout = route.meta.layout || route.matched.find(r => r.meta.layout)?.meta.layout
  return layout === 'dashboard' || layout === 'superadmin'
})
</script>
