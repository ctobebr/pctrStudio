import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/workbench/:id', name: 'workbench', component: () => import('../views/WorkbenchView.vue'), props: true },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
