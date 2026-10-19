<template>
  <div class="home">
    <header class="header">
      <div class="title">
        <h1>PTCR Studio</h1>
        <span class="subtitle">多站点云与全景工作台</span>
      </div>
      <div class="actions">
        <button class="btn" @click="openSettings">设置</button>
        <div class="import-dropdown" @click.stop>
          <button class="btn primary" @click="importMenuOpen = !importMenuOpen">
            {{ importing ? '导入中…' : '导入项目' }} ▾
          </button>
          <div v-if="importMenuOpen" class="import-menu panel">
            <button class="menu-item" @click="importFromZip">
              <span class="mi-title">zip 数据包</span>
              <span class="mi-desc">解压到工作空间并登记为新项目</span>
            </button>
            <button class="menu-item" @click="importFromFolder">
              <span class="mi-title">项目文件夹</span>
              <span class="mi-desc">引用原始目录，数据不复制不移动</span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="content">
      <div v-if="loading" class="state-tip">加载中…</div>
      <div v-else-if="projects.length === 0" class="empty">
        <div class="empty-icon">☁</div>
        <h2>还没有项目</h2>
        <p>点击右上角「导入项目」，选择含各站位原始数据的文件夹或 zip 数据包。</p>
        <p class="dim">数据根目录下应包含站位子目录（如 Batch_001、Batch_002…），导入后在工作台运行算法生成全景与拼接点云。</p>
      </div>
      <div v-else class="project-grid">
        <div v-for="p in projects" :key="p.id" class="project-card panel" @click="openProject(p.id)">
          <div class="card-head">
            <span class="name" :title="p.rootPath">{{ p.name }}</span>
            <span class="card-ops">
              <button class="op" @click.stop="renameProject(p)">重命名</button>
              <button class="op danger" @click.stop="removeProject(p)">移除</button>
            </span>
          </div>
          <div class="card-sub">
            {{ p.lastRunAt ? `上次运行 ${formatTime(p.lastRunAt)}` : `导入于 ${formatTime(p.importedAt)}` }}
          </div>
          <div class="card-badges">
            <span v-if="!p.rootExists" class="badge err">数据目录丢失</span>
            <span class="badge">{{ stationCount(p) }} 站位</span>
            <span class="badge" :class="outputCount(p) > 0 ? 'ok' : ''">
              输出点云 {{ outputCount(p) }}/{{ stationCount(p) }}
            </span>
            <span class="badge" :class="panoCount(p) > 0 ? 'ok' : ''">
              全景 {{ panoCount(p) }}/{{ stationCount(p) }}
            </span>
            <span class="badge" :class="mergedCount(p) > 0 ? 'ok' : ''">拼接 {{ mergedCount(p) }}</span>
          </div>
          <div class="card-foot">
            <span class="open">
              打开工作台
            </span>
          </div>
        </div>
      </div>
    </main>

    <div v-if="importing" class="import-mask">
      <div class="spinner"></div>
      <span>正在导入项目…</span>
    </div>

    <!-- 设置弹窗：算法程序与工作空间 -->
    <div v-if="settingsVisible" class="modal-mask" @click.self="settingsVisible = false">
      <div class="modal panel">
        <h3>设置</h3>
        <div class="form-row">
          <label>算法程序（gpd.exe）</label>
          <div class="form-inline">
            <input v-model="settingsForm.gpdExePath" class="input" placeholder="例如 D:\work\GimbalPanoDense\build\gpd.exe" />
            <button class="btn" @click="pickGpdExe">浏览</button>
          </div>
          <p class="form-tip">算法端可执行文件，负责生成每站点云/全景照片与多站拼接点云（调用方式：gpd.exe 项目根目录 [--mode default|panorama|single]）</p>
        </div>
        <div class="form-row">
          <label>工作空间</label>
          <div class="form-inline">
            <input v-model="settingsForm.workspacePath" class="input" />
            <button class="btn" @click="pickWorkspace">浏览</button>
          </div>
          <p class="form-tip">zip 导入解压与项目索引（projects.json）的存放目录</p>
        </div>
        <p v-if="saveSuccessTip" class="form-tip save-success-tip">已保存，正在关闭…</p>
        <div class="modal-actions">
          <button class="btn" :disabled="saveSuccessTip" @click="settingsVisible = false">取消</button>
          <button class="btn primary" :disabled="saveSuccessTip" @click="saveSettings">
            {{ saveSuccessTip ? '已保存 ✓' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 重命名弹窗：Electron 渲染进程不支持 prompt()，改用弹窗输入 -->
    <div v-if="renamingProject" class="modal-mask" @click.self="cancelRename">
      <div class="modal panel rename-modal">
        <h3>重命名项目</h3>
        <div class="form-row">
          <input
            ref="renameInput"
            v-model="renameDraft"
            class="input"
            placeholder="新的项目名称"
            @keydown.enter="commitRename"
            @keydown.esc="cancelRename"
          />
        </div>
        <div class="modal-actions">
          <button class="btn" @click="cancelRename">取消</button>
          <button class="btn primary" @click="commitRename">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import api, { formatTime, errText } from '../api/ipc'

const router = useRouter()
const projects = ref([])
const loading = ref(true)
const importing = ref(false)
const settingsVisible = ref(false)
const settingsForm = ref({ gpdExePath: '', workspacePath: '' })
const saveSuccessTip = ref(false)
const importMenuOpen = ref(false)
const renamingProject = ref(null)
const renameDraft = ref('')
const renameInput = ref(null)

function onDocClick() {
  importMenuOpen.value = false
}

async function refresh() {
  loading.value = true
  try {
    projects.value = await api.listProjects()
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

function openProject(id) {
  router.push({ name: 'workbench', params: { id } })
}

function stationCount(p) {
  return p.scan?.stations?.length || 0
}
function outputCount(p) {
  return (p.scan?.stations || []).filter((s) => s.cloud).length
}
function panoCount(p) {
  return (p.scan?.stations || []).filter((s) => s.panoramas && s.panoramas.length > 0).length
}
function mergedCount(p) {
  return p.scan?.mergedClouds?.length || 0
}

async function importFromZip() {
  importMenuOpen.value = false
  const zipPath = await api.selectFile([{ name: 'zip 数据包', extensions: ['zip'] }])
  if (!zipPath) return
  importing.value = true
  try {
    const { project } = await api.addProjectByZip(zipPath)
    await refresh()
    openProject(project.id)
  } catch (e) {
    alert(`导入失败: ${errText(e)}`)
  } finally {
    importing.value = false
  }
}

async function importFromFolder() {
  importMenuOpen.value = false
  const folder = await api.selectDirectory()
  if (!folder) return
  importing.value = true
  try {
    const { project, existed } = await api.addProjectByFolder(folder)
    await refresh()
    if (existed) alert(`该目录已导入过: ${project.name}`)
    openProject(project.id)
  } catch (e) {
    alert(`导入失败: ${errText(e)}`)
  } finally {
    importing.value = false
  }
}

function renameProject(p) {
  renamingProject.value = p
  renameDraft.value = p.name
  // 等弹窗渲染完成后聚焦并全选，方便直接输入新名称
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

function cancelRename() {
  renamingProject.value = null
}

async function commitRename() {
  const p = renamingProject.value
  if (!p) return
  const name = renameDraft.value.trim()
  if (!name || name === p.name) {
    cancelRename()
    return
  }
  try {
    await api.renameProject(p.id, name)
    cancelRename()
    await refresh()
  } catch (e) {
    // 保留弹窗便于修正后重试
    alert(`重命名失败: ${errText(e)}`)
  }
}

async function removeProject(p) {
  let removeData = false
  if (p.origin === 'zip') {
    if (!confirm(`移除项目「${p.name}」并删除解压数据？\n\n确定 = 移除登记并删除解压出的数据文件\n取消 = 不做任何操作`)) return
    removeData = true
  } else {
    if (!confirm(`移除项目「${p.name}」？\n\n仅移除登记，不会删除原始数据目录。`)) return
  }
  try {
    await api.removeProject(p.id, removeData)
    await refresh()
  } catch (e) {
    alert(`移除失败: ${errText(e)}`)
  }
}

async function openSettings() {
  const s = await api.getSettings()
  settingsForm.value = { gpdExePath: s.gpdExePath || '', workspacePath: s.workspacePath || '' }
  saveSuccessTip.value = false
  settingsVisible.value = true
}

async function pickGpdExe() {
  const p = await api.selectFile([{ name: '算法程序', extensions: ['exe'] }])
  if (p) settingsForm.value.gpdExePath = p
}

async function pickWorkspace() {
  const p = await api.selectDirectory()
  if (p) settingsForm.value.workspacePath = p
}

async function saveSettings() {
  try {
    // settingsForm.value 是 Vue 响应式 Proxy，无法被 IPC 结构化克隆，必须传普通对象
    await api.saveSettings({ ...settingsForm.value })
    saveSuccessTip.value = true
    setTimeout(() => {
      saveSuccessTip.value = false
      settingsVisible.value = false
    }, 600)
  } catch (e) {
    alert(`保存设置失败: ${errText(e)}`)
  }
}

onMounted(() => {
  refresh()
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.home {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 28px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.title {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.title h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.subtitle {
  color: var(--text-dim);
  font-size: 13px;
}
.actions {
  display: flex;
  gap: 10px;
}
.import-dropdown {
  position: relative;
}
.import-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  padding: 6px;
  z-index: 30;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.menu-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 6px;
  color: var(--text);
  text-align: left;
  font-size: 13px;
}
.menu-item:hover {
  background: var(--bg-main, rgba(128, 128, 128, 0.12));
}
.mi-title {
  font-weight: 600;
}
.mi-desc {
  color: var(--text-dim);
  font-size: 12px;
}
.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}
.state-tip {
  color: var(--text-dim);
  padding: 40px;
  text-align: center;
}
.empty {
  margin-top: 10vh;
  text-align: center;
  color: var(--text-dim);
}
.empty-icon {
  font-size: 44px;
  margin-bottom: 12px;
  opacity: 0.6;
}
.empty h2 {
  color: var(--text);
  font-size: 17px;
  margin-bottom: 8px;
  font-weight: 500;
}
.empty p {
  font-size: 13px;
  line-height: 1.8;
}
.empty .dim {
  color: var(--text-faint);
}
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}
.project-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 18px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.project-card:hover {
  background: var(--bg-panel-hover);
  border-color: var(--border-strong);
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-ops {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.op {
  color: var(--text-faint);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
}
.op:hover {
  color: var(--text);
  background: var(--bg-panel-hover);
}
.op.danger:hover {
  color: var(--error);
}
.card-sub {
  font-size: 11px;
  color: var(--text-faint);
  margin: 6px 0 10px;
}
.card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.badge.err {
  color: var(--error);
  border-color: rgba(248, 81, 73, 0.4);
}
.card-foot {
  margin-top: auto;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding-top: 12px;
}
.open {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--accent);
  padding: 4px 14px;
  border: 1px solid rgba(76, 141, 255, 0.3);
  border-radius: var(--radius-sm);
  transition: background 0.15s, border-color 0.15s;
}
.open .ico-open {
  width: 12px;
  height: 12px;
  transition: transform 0.18s ease;
}
.open:hover {
  background: rgba(76, 141, 255, 0.1);
  border-color: rgba(76, 141, 255, 0.55);
}
.open:hover .ico-open {
  transform: translateX(2px);
}
.import-mask,
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.import-mask {
  flex-direction: column;
  gap: 12px;
  color: var(--text-dim);
  font-size: 13px;
}
.spinner {
  width: 30px;
  height: 30px;
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
.modal {
  width: 560px;
  padding: 22px 24px;
}
.rename-modal {
  width: 400px;
}
.modal h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 18px;
}
.form-row {
  margin-bottom: 14px;
}
.form-row label {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.form-inline {
  display: flex;
  gap: 8px;
}
.form-inline .input {
  flex: 1;
  min-width: 0;
}
.form-tip {
  font-size: 11px;
  color: var(--text-faint);
  margin-bottom: 16px;
}
.form-row .form-tip {
  margin: 6px 0 0;
  line-height: 1.6;
}
.save-success-tip {
  color: var(--success);
  text-align: center;
  margin: 8px 0 0;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
