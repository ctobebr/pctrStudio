<template>
  <div ref="containerRef" class="cloud-canvas">
    <div v-if="loading" class="overlay loading">
      <div class="spinner"></div>
      <span>正在加载点云…</span>
    </div>
    <div v-else-if="error" class="overlay error">{{ error }}</div>
    <div v-else-if="empty" class="overlay empty">该节点暂无点云数据</div>

    <div class="toolbar">
      <div v-if="loaded" class="size-ctrl" title="调整点大小；双击滑块或点 ⟲ 恢复默认">
        <span class="size-label">点大小</span>
        <input
          v-model.number="pointSize"
          class="size-slider"
          type="range"
          :min="POINT_SIZE_LIMITS.min"
          :max="POINT_SIZE_LIMITS.max"
          :step="POINT_SIZE_LIMITS.step"
          @dblclick="resetPointSize"
        />
        <button class="size-reset" title="恢复默认点大小" @click="resetPointSize">⟲</button>
        <span class="size-value">{{ pointSize.toFixed(2) }}</span>
      </div>
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
import { POINT_SIZE_LIMITS } from '../composables/usePointCloudRenderer/config'

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

const POINT_SIZE_STORAGE_KEY = 'ptcr.pointSize'

function readSavedPointSize() {
  const raw = Number(localStorage.getItem(POINT_SIZE_STORAGE_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return POINT_SIZE_LIMITS.default
  // 夹在可调范围内，防止历史脏数据把滑块撑爆
  return Math.min(POINT_SIZE_LIMITS.max, Math.max(POINT_SIZE_LIMITS.min, raw))
}

// 点大小：用户偏好持久化，跨会话记忆
const pointSize = ref(readSavedPointSize())

function resetPointSize() {
  pointSize.value = POINT_SIZE_LIMITS.default
}

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
  renderer = usePointCloudRenderer(containerRef.value)
  renderer.init()
  // 应用用户上次保存的点大小偏好
  renderer.setPointSize(pointSize.value)
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

// 拖动滑块实时调整点大小并记住偏好（setPointSize 仅改 uniform，开销可忽略）
watch(pointSize, (v) => {
  renderer?.setPointSize(v)
  localStorage.setItem(POINT_SIZE_STORAGE_KEY, String(v))
})

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
/* 点大小滑块控件：与 .btn 同视觉规格（高度/底色/描边），并排不突兀 */
.size-ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 27px;
  padding: 0 12px;
  background: #21262d;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-dim);
}
.size-label {
  white-space: nowrap;
}
.size-slider {
  width: 110px;
  accent-color: var(--accent);
  cursor: pointer;
}
.size-reset {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
}
.size-reset:hover {
  color: var(--text);
}
.size-value {
  min-width: 28px;
  text-align: right;
  color: var(--text);
  font-variant-numeric: tabular-nums;
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
