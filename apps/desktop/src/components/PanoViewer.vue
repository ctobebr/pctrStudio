<template>
  <div ref="containerRef" class="pano-viewer">
    <div v-if="loading" class="overlay"><div class="spinner"></div><span>加载全景图…</span></div>
    <div v-else-if="error" class="overlay error">{{ error }}</div>
    <div class="hint">拖动旋转 · 滚轮放大缩小</div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { localfileUrl } from '../api/ipc'

const props = defineProps({
  panoPath: { type: String, default: '' },
  // 变化时强制重新加载当前全景（重跑算法后同路径文件内容可能已更新）
  reloadKey: { type: Number, default: 0 },
})

const containerRef = ref(null)
const loading = ref(false)
const error = ref('')

let renderer = null
let scene = null
let camera = null
let controls = null
let sphere = null
let material = null
let geometry = null
let animationId = null
let resizeObserver = null
let currentUrl = ''
let wheelHandler = null

function init() {
  const container = containerRef.value
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200)
  camera.position.set(0, 0, 0.01)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  container.appendChild(renderer.domElement)

  // 内翻球面 + 等距柱状全景纹理
  geometry = new THREE.SphereGeometry(50, 64, 40)
  geometry.scale(-1, 1, 1)
  material = new THREE.MeshBasicMaterial({ color: 0x161b22 })
  sphere = new THREE.Mesh(geometry, material)
  scene.add(sphere)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.enableZoom = false // 全景查看器使用 FOV 缩放，不用距离缩放
  controls.rotateSpeed = -0.25

  // FOV 缩放（360° 全景查看器标准做法：改变相机视场角而非相机距离）
  const DEFAULT_FOV = 75
  let currentFov = DEFAULT_FOV
  const MIN_FOV = 10
  const MAX_FOV = 100
  wheelHandler = (e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 1.08 : 1 / 1.08
    currentFov = Math.min(MAX_FOV, Math.max(MIN_FOV, currentFov * delta))
    camera.fov = currentFov
    camera.updateProjectionMatrix()
  }
  container.addEventListener('wheel', wheelHandler, { passive: false })

  resize()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  animate()
}

function resize() {
  const container = containerRef.value
  if (!container || !renderer) return
  const w = container.clientWidth
  const h = Math.max(container.clientHeight, 1)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

function animate() {
  animationId = requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

function loadPano(panoPath) {
  if (!renderer) return
  if (!panoPath) {
    material.map = null
    material.color.set(0x161b22)
    material.needsUpdate = true
    return
  }
  const url = localfileUrl(panoPath)
  if (url === currentUrl) return
  currentUrl = url
  loading.value = true
  error.value = ''

  const loader = new THREE.TextureLoader()
  loader.load(
    url,
    (texture) => {
      if (!material) return
      texture.colorSpace = THREE.SRGBColorSpace
      if (material.map) material.map.dispose()
      material.map = texture
      material.color.set(0xffffff)
      material.needsUpdate = true
      loading.value = false
    },
    undefined,
    () => {
      loading.value = false
      error.value = '全景图加载失败'
    },
  )
}

onMounted(() => {
  init()
  loadPano(props.panoPath)
})

onBeforeUnmount(() => {
  if (animationId) cancelAnimationFrame(animationId)
  if (resizeObserver) resizeObserver.disconnect()
  if (controls) controls.dispose()
  if (material && material.map) material.map.dispose()
  if (material) material.dispose()
  if (geometry) geometry.dispose()
  if (renderer) {
    renderer.dispose()
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }
  // 清理 FOV 缩放事件
  if (containerRef.value && wheelHandler) {
    containerRef.value.removeEventListener('wheel', wheelHandler)
  }
  renderer = null
  scene = null
})

watch(() => props.panoPath, (p) => loadPano(p))
watch(() => props.reloadKey, () => {
  currentUrl = ''
  loadPano(props.panoPath)
})
</script>

<style scoped>
.pano-viewer {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: var(--radius);
  overflow: hidden;
  background: #0a0e14;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-dim);
  font-size: 13px;
  z-index: 5;
  pointer-events: none;
  background: rgba(10, 14, 20, 0.5);
}
.overlay.error {
  color: var(--error);
}
.spinner {
  width: 26px;
  height: 26px;
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
.hint {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  padding: 3px 12px;
  border-radius: 10px;
  background: rgba(13, 17, 23, 0.7);
  color: var(--text-faint);
  font-size: 11px;
  z-index: 5;
  pointer-events: none;
}
</style>
