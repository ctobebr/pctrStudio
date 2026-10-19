<template>
  <div class="img-viewer" @wheel.prevent="onWheel" @mousedown="onMouseDown" @dblclick="onDblClick">
    <div class="viewer-stage" :style="{ cursor: dragCursor }">
      <img
        ref="imgRef"
        :src="src"
        class="viewer-img"
        :style="imgStyle"
        draggable="false"
        @load="onImgLoad"
        @error="onImgError"
      />
    </div>

    <div class="viewer-toolbar">
      <button class="btn" title="缩小" @click="zoomBy(-1.25)">−</button>
      <span class="zoom-label">{{ Math.round(scale * 100) }}%</span>
      <button class="btn" title="放大" @click="zoomBy(1.25)">＋</button>
      <span class="sep"></span>
      <button class="btn" :class="{ primary: mode === 'fit' }" @click="fitWindow">适应窗口</button>
      <button class="btn" :class="{ primary: mode === '100' }" @click="zoomTo(1)">100%</button>
      <span class="sep"></span>
      <span class="size-label" v-if="imgSize">{{ imgSize.w }} × {{ imgSize.h }}</span>
    </div>

    <button class="btn close-btn" @click="$emit('close')">✕</button>
    <div class="hint">滚轮缩放 · 拖拽平移 · 双击适应窗口</div>
    <div v-if="error" class="error-overlay">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  src: { type: String, required: true },
})
const emit = defineEmits(['close'])

const imgRef = ref(null)
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const mode = ref('fit')
const error = ref('')
const imgSize = ref(null)
const dragging = ref(false)
let dragStart = null

const MIN_SCALE = 0.05
const MAX_SCALE = 16

const dragCursor = computed(() => (dragging.value ? 'grabbing' : 'grab'))
const imgStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`,
}))

function onImgLoad() {
  error.value = ''
  const img = imgRef.value
  if (img && img.naturalWidth) {
    imgSize.value = { w: img.naturalWidth, h: img.naturalHeight }
  }
  fitWindow()
}

function onImgError() {
  error.value = '图片加载失败'
}

function fitWindow() {
  const img = imgRef.value
  if (!img || !img.naturalWidth) return
  const stage = img.parentElement
  const sw = stage.clientWidth
  const sh = stage.clientHeight
  const s = Math.min(sw / img.naturalWidth, sh / img.naturalHeight)
  scale.value = Math.max(s, MIN_SCALE)
  offsetX.value = 0
  offsetY.value = 0
  mode.value = 'fit'
}

function zoomTo(target) {
  scale.value = target
  offsetX.value = 0
  offsetY.value = 0
  mode.value = String(target)
}

function zoomBy(factor) {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor))
  scale.value = next
  mode.value = 'custom'
}

function onWheel(e) {
  const img = imgRef.value
  if (!img || !scale.value) return
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor))
  if (next === scale.value) return
  // 缩放锚定鼠标位置：保持鼠标下的图像点在缩放前后不动
  const rect = img.parentElement.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const imgX = (e.clientX - cx - offsetX.value) / scale.value
  const imgY = (e.clientY - cy - offsetY.value) / scale.value
  scale.value = next
  offsetX.value = e.clientX - cx - imgX * next
  offsetY.value = e.clientY - cy - imgY * next
  mode.value = 'custom'
}

function onMouseDown(e) {
  if (e.button !== 0) return
  dragging.value = true
  dragStart = { x: e.clientX, y: e.clientY, ox: offsetX.value, oy: offsetY.value }
  e.preventDefault()
}

function onMouseMove(e) {
  if (!dragging.value || !dragStart) return
  offsetX.value = dragStart.ox + (e.clientX - dragStart.x)
  offsetY.value = dragStart.oy + (e.clientY - dragStart.y)
}

function onMouseUp() {
  dragging.value = false
  dragStart = null
}

function onDblClick() {
  fitWindow()
}

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.img-viewer {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(6, 8, 12, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}
.viewer-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.viewer-img {
  max-width: none;
  max-height: none;
  transform-origin: center center;
  will-change: transform;
  pointer-events: none;
}
.viewer-toolbar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(13, 17, 23, 0.92);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  z-index: 5;
}
.zoom-label {
  min-width: 48px;
  text-align: center;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-dim);
}
.size-label {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-faint);
}
.sep {
  width: 1px;
  height: 16px;
  background: var(--border);
}
.close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 5;
}
.hint {
  position: absolute;
  top: 16px;
  left: 16px;
  padding: 3px 12px;
  border-radius: 10px;
  background: rgba(13, 17, 23, 0.7);
  color: var(--text-faint);
  font-size: 11px;
  z-index: 5;
  pointer-events: none;
}
.error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--error);
  font-size: 14px;
  z-index: 6;
}
</style>
