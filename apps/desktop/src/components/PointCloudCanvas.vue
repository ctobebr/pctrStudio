<template>
  <div ref="containerRef" class="cloud-canvas">
    <div v-if="loading" class="overlay loading">
      <div class="spinner"></div>
      <span>正在加载点云…</span>
    </div>
    <div v-else-if="error" class="overlay error">{{ error }}</div>
    <div v-else-if="empty" class="overlay empty">该节点暂无点云数据</div>

    <div class="toolbar">
      <button class="btn" :disabled="!loaded" @click="resetView">重置视角</button>
    </div>

    <div v-if="loaded" class="stats">
      <span class="source">{{ label }}</span>
      <span>{{ stats.count.toLocaleString() }} 点</span>
      <span v-if="stats.hasColor" class="muted">顶点色</span>
      <span v-if="stats.truncated" class="warn-badge">
        原始 {{ stats.total.toLocaleString() }} 点，已采样至 {{ stats.count.toLocaleString() }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '../api/ipc'
import { usePointCloudRenderer } from '../composables/usePointCloudRenderer'

const props = defineProps({
  cloudPath: { type: String, default: '' },
  label: { type: String, default: '' },
  reloadKey: { type: Number, default: 0 },
})

const containerRef = ref(null)
const loading = ref(false)
const error = ref('')
const empty = ref(false)
const loaded = ref(false)
const stats = ref({ count: 0, total: 0, truncated: false, hasColor: false })

let renderer = null
let resizeObserver = null

async function load() {
  if (!renderer || !props.cloudPath) return
  loading.value = true
  error.value = ''
  empty.value = false
  loaded.value = false
  try {
    const cloud = await api.loadPointCloudFile(props.cloudPath)
    renderer.resetPointCloud()
    if (!cloud || cloud.count === 0) {
      empty.value = true
      loading.value = false
      return
    }
    renderer.addPointsFromArrays(cloud.positions, cloud.count, cloud.colors)
    renderer.fitCameraToBounds(cloud.bounds)
    stats.value = {
      count: cloud.count,
      total: cloud.total,
      truncated: cloud.truncated,
      hasColor: !!cloud.colors,
    }
    loaded.value = true
  } catch (e) {
    error.value = `点云加载失败: ${e.message || e}`
  } finally {
    loading.value = false
  }
}

function resetView() {
  if (loaded.value) {
    load()
  }
}

onMounted(async () => {
  renderer = usePointCloudRenderer(containerRef.value, {
    pointSize: 0.25,
  })
  renderer.init()
  resizeObserver = new ResizeObserver(() => renderer.onResize())
  resizeObserver.observe(containerRef.value)
  await load()
})

onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect()
  if (renderer) renderer.dispose()
  renderer = null
})

watch(() => props.cloudPath, () => load())
watch(() => props.reloadKey, () => load())

defineExpose({ load })
</script>

<style scoped>
.cloud-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--bg);
  border-radius: var(--radius);
  overflow: hidden;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-dim);
  font-size: 13px;
  z-index: 5;
  pointer-events: none;
}
.overlay.error {
  color: var(--error);
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 8px;
  z-index: 6;
}
.stats {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  gap: 10px;
  align-items: center;
  max-width: calc(100% - 24px);
  padding: 5px 12px;
  background: rgba(13, 17, 23, 0.8);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-dim);
  z-index: 6;
}
.stats .source {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stats .muted {
  color: var(--accent);
}
.warn-badge {
  color: var(--warn);
}
</style>
