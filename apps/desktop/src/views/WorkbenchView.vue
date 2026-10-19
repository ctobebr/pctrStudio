<template>
  <div class="workbench">
    <header class="wb-header">
      <button class="btn btn-back" @click="goHome">
        <span>返回</span>
      </button>
      <div class="wb-title">
        <h1 :title="project?.rootPath">{{ project ? project.name : '加载中…' }}</h1>
        <span class="root-path">{{ project?.rootPath || '' }}</span>
      </div>
      <div class="wb-actions">
        <button class="btn" :disabled="!project" @click="openDataDir">打开数据目录</button>
        <button class="btn" :disabled="!project || running" @click="rescan">重新扫描</button>
        <button v-if="!running" class="btn primary" :disabled="!project" @click="run">运行算法</button>
        <button v-else class="btn danger" @click="cancelRun">取消</button>
      </div>
    </header>

    <div v-if="loadError" class="wb-error panel">
      <span>{{ loadError }}</span>
      <button class="btn" @click="goHome">返回首页</button>
    </div>

    <div v-else-if="!project" class="state-tip">加载中…</div>

    <template v-else>
      <div class="wb-main">
        <!-- 左侧目录树：磁盘原样结构 -->
        <aside class="wb-tree panel">
          <div class="tree-scroll">
            <template v-if="treeRows.length">
              <button
                v-for="row in treeRows"
                :key="row.node.path"
                class="tree-node"
                :class="{
                  active: isActive(row.node),
                  'non-clickable': row.node.type === 'file' || row.node.type === 'more' || isBareDir(row.node),
                }"
                :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
                :title="`${row.node.path}${row.node.size ? `（${formatSize(row.node.size)}）` : ''}`"
                @click="onNodeClick(row.node)"
              >
                <span
                  class="chevron"
                  v-if="hasChildren(row.node)"
                  v-html="expandedMap[row.node.path] ? SVG_CHEVRON_DOWN : SVG_CHEVRON_RIGHT"
                ></span>
                <span class="chevron" v-else></span>
                <span class="node-icon" v-html="nodeIcon(row.node)"></span>
                <span class="node-name">{{ row.node.name }}</span>
                <span class="node-size" v-if="row.node.type === 'cloud' && row.node.size">{{ formatSize(row.node.size) }}</span>
              </button>
            </template>
            <div v-else class="tree-empty">
              {{ treeError || '目录为空' }}
            </div>
          </div>
        </aside>

        <!-- 右侧展示区：左照片 / 右点云 -->
        <section class="wb-view">
          <div v-if="photoOpen" class="pane panel">
            <div class="pane-head">
              <span class="pane-title">照片</span>
              <span class="pane-sub" :title="selectedImagePath">{{ selectedImageName }}</span>
              <button
                class="pane-btn"
                :title="cloudOpen ? '关闭照片面板，放大点云渲染' : '恢复双栏'"
                v-html="cloudOpen ? SVG_CLOSE : SVG_RESTORE"
                @click="onPhotoPaneBtn"
              ></button>
            </div>
            <div class="pane-body" @dblclick="openFullImage">
              <PanoViewer v-if="imageKind === 'pano'" :pano-path="selectedImagePath" :reload-key="reloadKey" />
              <div v-else-if="imageKind === 'normal'" class="photo-stage">
                <img :src="activeImagePath ? localfileUrl(activeImagePath) : ''" draggable="false" @error="imageKind = 'error'" />
              </div>
              <div v-else-if="imageKind === 'loading'" class="pane-empty">照片加载中…</div>
              <div v-else-if="imageKind === 'error'" class="pane-empty">照片加载失败</div>
              <div v-else class="pane-empty">在左侧选择照片文件查看</div>
              <div v-if="imageKind === 'normal'" class="photo-tip">双击放大查看</div>
            </div>
          </div>
          <div v-if="cloudOpen" class="pane panel">
            <div class="pane-head">
              <span class="pane-title">点云渲染</span>
              <span class="pane-sub" :title="selectedCloudPath">{{ selectedCloudName }}</span>
              <button
                class="pane-btn"
                :title="photoOpen ? '关闭点云渲染面板，放大照片' : '恢复双栏'"
                v-html="photoOpen ? SVG_CLOSE : SVG_RESTORE"
                @click="onCloudPaneBtn"
              ></button>
            </div>
            <div class="pane-body">
              <PointCloudCanvas
                v-if="selectedCloudPath"
                :cloud-path="selectedCloudPath"
                :label="selectedCloudName"
                :reload-key="reloadKey"
              />
              <div v-else class="pane-empty">在左侧选择点云文件查看渲染</div>
            </div>
          </div>
        </section>
      </div>

      <!-- 底部日志区 -->
      <footer class="wb-log panel">
        <div class="log-head">
          <span class="pane-title">运行日志</span>
          <div v-if="steps.length" class="steps">
            <span v-for="s in steps" :key="s.id" class="step" :class="s.status">{{ s.label }}</span>
          </div>
          <button class="btn sm" @click="clearLogs">清空</button>
        </div>
        <div v-if="progress" class="algo-progress">
          <span class="progress-text">
            <template v-if="progress.stationCount > 1">站点 {{ progress.stationIndex }}/{{ progress.stationCount }} · </template>{{ progress.stageLabel }}
          </span>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: progress.percent + '%' }"></div>
          </div>
          <span class="progress-percent">{{ progress.percent }}%</span>
        </div>
        <div ref="logScrollRef" class="log-body">
          <div v-for="(l, i) in logs" :key="i" class="log-line" :class="l.level">{{ l.text }}</div>
          <div v-if="logs.length === 0" class="log-empty">
            日志为空。点击右上角「运行算法」开始处理（调用 gpd.exe），输出将实时显示在此。
          </div>
        </div>
      </footer>

      <!-- 照片全屏放大 -->
      <ImageViewer v-if="showFullImage" :src="localfileUrl(selectedImagePath)" @close="showFullImage = false" />
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import api, { errText, localfileUrl, formatSize } from '../api/ipc'
import PanoViewer from '../components/PanoViewer.vue'
import PointCloudCanvas from '../components/PointCloudCanvas.vue'
import ImageViewer from '../components/ImageViewer.vue'

const props = defineProps({
  id: { type: String, required: true },
})

const router = useRouter()
const project = ref(null)
const loadError = ref('')
const running = ref(false)
// 递增触发双栏强制重载（重新扫描/算法完成后产物可能已更新）
const reloadKey = ref(0)

// ===== 目录树 =====
const tree = ref(null)
const treeError = ref('')
const expandedMap = reactive({})
// 选中节点：照片与点云各自独立选中，互不影响（两个窗口可同时展示）
const selectedImagePath = ref('')
const selectedCloudPath = ref('')

// ===== 照片查看 =====
// '' 未选 | loading 加载判断中 | pano 球面全景 | normal 平面照片 | error 失败
const imageKind = ref('')
const showFullImage = ref(false)

// ===== 双栏面板控制：关闭一侧后另一侧自动占满 =====
const SVG_CLOSE = '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
const SVG_RESTORE = '<svg viewBox="0 0 16 16"><rect x="1.8" y="3.5" width="5.2" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="3.5" width="5.2" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>'
const photoOpen = ref(true)
const cloudOpen = ref(true)

function onPhotoPaneBtn() {
  if (cloudOpen.value) {
    photoOpen.value = false
  } else {
    photoOpen.value = true
    cloudOpen.value = true
  }
}

function onCloudPaneBtn() {
  if (photoOpen.value) {
    cloudOpen.value = false
  } else {
    photoOpen.value = true
    cloudOpen.value = true
  }
}

const steps = ref([])
// 算法运行进度（由主进程解析 gpd 日志推算）：{stationIndex,stationCount,stage,stageLabel,percent}
const progress = ref(null)
const logs = ref([])
const logScrollRef = ref(null)

let offEvent = null

/** 目录节点是否有可展开子项（深度截断的目录不再展开） */
function hasChildren(node) {
  return node.type === 'dir' && !node.depthLimited && Array.isArray(node.children) && node.children.length > 0
}

/** 无任何交互的目录（空目录/不可读/深度截断） */
function isBareDir(node) {
  return node.type === 'dir' && !hasChildren(node)
}

// ===== 树图标（VSCode 风格 SVG，文件统一形态、不做类型配色区分）=====
const SVG_CHEVRON_RIGHT = '<svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const SVG_CHEVRON_DOWN = '<svg viewBox="0 0 16 16"><path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const SVG_FOLDER_CLOSED = '<svg viewBox="0 0 16 16"><path d="M1.5 3h5L8 4.5h6.5V13H1.5V3z" fill="currentColor"/></svg>'
const SVG_FOLDER_OPEN = '<svg viewBox="0 0 16 16"><path d="M1.5 3h5L8 4.5h6V7H4.6L2.3 13H1.5V3z" fill="currentColor"/><path d="M3.6 14l2.2-6.3h9.7L13.3 14H3.6z" fill="currentColor" opacity="0.5"/></svg>'
const SVG_FILE = '<svg viewBox="0 0 16 16"><path d="M4 1.5h5.2L13 5.3v9.2H4V1.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 1.8v3.7h3.7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>'

function nodeIcon(node) {
  if (node.type === 'dir') return expandedMap[node.path] ? SVG_FOLDER_OPEN : SVG_FOLDER_CLOSED
  if (node.type === 'more') return ''
  return SVG_FILE
}

/** 展开状态扁平化为可见行（目录在前文件在后已由扫描保证） */
const treeRows = computed(() => {
  const rows = []
  if (!tree.value) return rows
  const walk = (node, depth) => {
    rows.push({ node, depth })
    if (node.type === 'dir' && expandedMap[node.path]) {
      for (const c of node.children || []) walk(c, depth + 1)
    }
  }
  walk(tree.value, 0)
  return rows
})

/** 取路径文件名 */
function baseName(path) {
  if (!path) return ''
  const parts = path.replace(/\//g, '\\').split('\\')
  return parts[parts.length - 1]
}

const selectedImageName = computed(() => baseName(selectedImagePath.value))
const selectedCloudName = computed(() => baseName(selectedCloudPath.value))

/** 树节点是否处于选中态：照片/点云分别高亮各自选中的项 */
function isActive(node) {
  if (node.type === 'image') return node.path === selectedImagePath.value
  if (node.type === 'cloud') return node.path === selectedCloudPath.value
  return false
}

const activeImagePath = computed(() => selectedImagePath.value)

// 照片分流：宽高比 ≥ 1.9 视为等距柱状全景（球面查看），否则平面查看
watch(activeImagePath, (p) => {
  showFullImage.value = false
  if (!p) {
    imageKind.value = ''
    return
  }
  imageKind.value = 'loading'
  const img = new Image()
  img.onload = () => {
    if (activeImagePath.value !== p) return
    const ratio = img.naturalWidth / Math.max(img.naturalHeight, 1)
    imageKind.value = ratio >= 1.9 ? 'pano' : 'normal'
  }
  img.onerror = () => {
    if (activeImagePath.value === p) imageKind.value = 'error'
  }
  img.src = localfileUrl(p)
})

function openFullImage() {
  if (selectedImagePath.value && imageKind.value !== 'loading' && imageKind.value !== 'error') {
    showFullImage.value = true
  }
}

// ===== 树交互 =====
function onNodeClick(node) {
  if (node.type === 'dir') {
    if (hasChildren(node)) expandedMap[node.path] = !expandedMap[node.path]
    return
  }
  // 照片、点云各自更新对应窗口，互不影响
  if (node.type === 'cloud') {
    selectedCloudPath.value = node.path
  } else if (node.type === 'image') {
    selectedImagePath.value = node.path
  }
}

function expandDefault(node, depth = 0) {
  if (!node || node.type !== 'dir') return
  expandedMap[node.path] = true
  if (depth < 1) {
    for (const c of node.children || []) {
      if (c.type === 'dir') expandDefault(c, depth + 1)
    }
  }
}

async function loadTree() {
  treeError.value = ''
  try {
    tree.value = await api.scanTree(props.id)
    expandDefault(tree.value)
  } catch (e) {
    tree.value = null
    treeError.value = errText(e)
  }
}

// ===== 数据加载 =====
async function load() {
  loadError.value = ''
  project.value = null
  try {
    const p = await api.getProject(props.id)
    if (!p) {
      loadError.value = '项目不存在（可能已被移除）'
      return
    }
    project.value = p
    await loadTree()
  } catch (e) {
    loadError.value = errText(e)
  }
}

async function rescan() {
  try {
    project.value = await api.rescanProject(props.id)
    reloadKey.value++
    appendLog('已重新扫描项目产物')
  } catch (e) {
    appendLog(`扫描失败: ${errText(e)}`, 'warn')
  }
}

function goHome() {
  router.push({ name: 'home' })
}

function openDataDir() {
  if (project.value) api.openPath(project.value.rootPath)
}

// ===== 管线运行 =====
async function run() {
  if (running.value) return
  running.value = true
  try {
    // 异步执行，进度通过 pipeline 事件流接收；预检失败（未配置 gpd.exe 等）在此 reject
    await api.runPipeline({ projectId: props.id })
  } catch (e) {
    running.value = false
    appendLog(errText(e), 'warn')
    alert(errText(e))
  }
}

async function cancelRun() {
  try {
    await api.cancelPipeline()
  } catch (e) {
    appendLog(`取消失败: ${errText(e)}`, 'warn')
  }
}

function finishRunningSteps(status) {
  for (const s of steps.value) {
    if (s.status === 'running') s.status = status
  }
}

function handleEvent(ev) {
  if (ev.type === 'plan') {
    steps.value = ev.steps.map((s) => ({ ...s, status: 'pending' }))
    progress.value = null
  } else if (ev.type === 'step') {
    const s = steps.value.find((x) => x.id === ev.id)
    if (s) s.status = ev.status
    if (ev.status === 'error' && ev.detail) appendLog(ev.detail, 'warn')
  } else if (ev.type === 'progress') {
    progress.value = ev
  } else if (ev.type === 'log') {
    appendLog(ev.text, ev.level)
  } else if (ev.type === 'done') {
    running.value = false
    finishRunningSteps(ev.ok ? 'success' : 'error')
    progress.value = null
    if (ev.ok) {
      appendLog(`处理完成，耗时 ${(ev.elapsedMs / 1000).toFixed(1)}s`)
      if (ev.scan && project.value) project.value.scan = ev.scan
      loadTree()
      reloadKey.value++
    } else {
      appendLog(`处理失败: ${ev.error}`, 'warn')
    }
  } else if (ev.type === 'cancelled') {
    running.value = false
    finishRunningSteps('error')
    progress.value = null
    appendLog('已取消', 'warn')
  }
}

// ===== 日志 =====
function appendLog(text, level = 'info') {
  const t = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  logs.value.push({ text: `[${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}] ${text}`, level })
  if (logs.value.length > 2000) logs.value.splice(0, logs.value.length - 2000)
  nextTick(() => {
    const el = logScrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function clearLogs() {
  logs.value = []
  steps.value = []
  progress.value = null
}

watch(() => props.id, () => {
  selectedImagePath.value = ''
  selectedCloudPath.value = ''
  imageKind.value = ''
  load()
})

onMounted(async () => {
  offEvent = api.onPipelineEvent(handleEvent)
  await load()
  // 页面刷新后事件流丢失，用运行状态恢复按钮形态
  try {
    running.value = await api.isPipelineRunning()
  } catch {
    running.value = false
  }
})

onBeforeUnmount(() => {
  if (offEvent) offEvent()
})
</script>

<style scoped>
.workbench {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.wb-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
}
.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn-back .ico-back {
  width: 14px;
  height: 14px;
  transition: transform 0.18s ease;
}
.btn-back:hover .ico-back {
  transform: translateX(-2px);
}
.wb-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wb-title h1 {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.root-path {
  font-size: 11px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wb-actions {
  display: flex;
  gap: 8px;
}
.wb-error {
  margin: 24px auto;
  max-width: 520px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: var(--text-dim);
  font-size: 13px;
}
.state-tip {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
}
.wb-main {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 12px;
}

/* ===== 左侧目录树 ===== */
.wb-tree {
  width: 300px;
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.tree-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  color: var(--text);
  text-align: left;
  font-size: 12px;
  border-radius: var(--radius-sm);
}
.tree-node:hover {
  background: var(--bg-panel-hover);
}
.tree-node.active {
  background: rgba(76, 141, 255, 0.15);
  color: var(--accent);
}
.tree-node.non-clickable {
  cursor: default;
  color: var(--text-faint);
}
.chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
}
.chevron :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}
.node-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
}
.node-icon :deep(svg) {
  width: 15px;
  height: 15px;
  display: block;
}
.node-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-size {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-faint);
  font-family: var(--font-mono);
}
.tree-empty {
  padding: 8px 10px;
  font-size: 11px;
  color: var(--text-faint);
  line-height: 1.6;
}

/* ===== 右侧双栏 ===== */
.wb-view {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 12px;
}
.pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.pane-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.pane-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  flex-shrink: 0;
}
.pane-sub {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}
.pane-btn {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  color: var(--text-faint);
  border-radius: var(--radius-sm);
}
.pane-btn:hover {
  background: var(--bg-panel-hover);
  color: var(--text);
}
.pane-btn :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}
.pane-body {
  flex: 1;
  min-height: 0;
  padding: 8px;
  position: relative;
}
.pane-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 13px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
}
.photo-stage {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.photo-stage img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.photo-tip {
  position: absolute;
  right: 16px;
  bottom: 14px;
  padding: 2px 10px;
  border-radius: 10px;
  background: rgba(13, 17, 23, 0.7);
  color: var(--text-faint);
  font-size: 11px;
  pointer-events: none;
}

/* ===== 底部日志区 ===== */
.wb-log {
  height: 190px;
  flex-shrink: 0;
  margin: 0 12px 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.log-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.steps {
  flex: 1;
  display: flex;
  gap: 8px;
  overflow: hidden;
}
.step {
  font-size: 11px;
  color: var(--text-faint);
  padding: 2px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  white-space: nowrap;
}
.step.running {
  color: var(--accent);
  border-color: rgba(76, 141, 255, 0.4);
}
.step.success {
  color: var(--success);
}
.step.error {
  color: var(--error);
}
.btn.sm {
  padding: 3px 10px;
  font-size: 11px;
}
.log-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.8;
  /* 全局 body 禁用了文字选中，日志区恢复可选中复制 */
  user-select: text;
  cursor: text;
}
.log-line {
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-dim);
}
.log-line.warn {
  color: var(--warn);
}
.log-empty {
  color: var(--text-faint);
}
/* ===== 算法运行进度条 ===== */
.algo-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.progress-text {
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
}
.progress-track {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: #21262d;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #1f6feb, #4c8dff);
  transition: width 0.4s ease;
}
.progress-percent {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--accent);
  min-width: 34px;
  text-align: right;
}
</style>
