// 项目登记制：原地引用原始数据目录，projects.json 作为索引存于 workspace
// 导入文件夹不复制数据（算法直接在原始目录生成产物）；zip 导入时解压到 workspace/projects/ 下再登记
const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')
const { loadSettings } = require('./settings.cjs')
const { scanProject } = require('./artifactScanner.cjs')

function workspaceDir() {
  return loadSettings().workspacePath
}

function projectsRoot() {
  return path.join(workspaceDir(), 'projects')
}

function indexFile() {
  return path.join(workspaceDir(), 'projects.json')
}

function loadIndex() {
  try {
    const raw = fs.readFileSync(indexFile(), 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed.projects)) return parsed
  } catch {
    // 首次使用或文件损坏时从空索引开始
  }
  return { projects: [] }
}

function saveIndex(index) {
  fs.mkdirSync(workspaceDir(), { recursive: true })
  fs.writeFileSync(indexFile(), JSON.stringify(index, null, 2), 'utf8')
}

function makeId() {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function uniqueName(base, index) {
  const names = new Set(index.projects.map((p) => p.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

// Windows 路径大小写不敏感，统一 resolve 后小写比较
function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

/** 校验数据根：必须是目录，且至少包含一个子目录（站位）或点云文件 */
function validateProjectDir(dir) {
  let st
  try {
    st = fs.statSync(dir)
  } catch {
    throw new Error(`路径不存在: ${dir}`)
  }
  if (!st.isDirectory()) throw new Error('请选择文件夹（而非文件）作为项目数据根')
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    throw new Error(`无法读取目录: ${dir}`)
  }
  const hasContent = entries.some((e) => e.isDirectory()) || entries.some((e) => e.isFile() && /\.ply$/i.test(e.name))
  if (!hasContent) throw new Error('所选目录为空：应包含各站位子目录（如 Batch_001）')
}

function extractZip(zipPath, destDir) {
  const zip = new AdmZip(zipPath)
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const entryName = entry.entryName.replace(/\\/g, '/')
    // zip-slip 防护
    if (entryName.split('/').some((seg) => seg === '..')) {
      throw new Error(`压缩包含非法路径: ${entryName}`)
    }
    const target = path.join(destDir, ...entryName.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, entry.getData())
  }
}

/** zip 解压后定位真实数据根：穿透"仅含单一子目录"的套壳层（最多 3 层） */
function resolveExtractRoot(dir) {
  let cur = dir
  for (let i = 0; i < 3; i++) {
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      break
    }
    const dirs = entries.filter((e) => e.isDirectory())
    const files = entries.filter((e) => e.isFile())
    if (files.length > 0 || dirs.length !== 1) break
    cur = path.join(cur, dirs[0].name)
  }
  return cur
}

/** 登记 + 首次扫描（共享给文件夹/zip 两种导入方式） */
function registerProject(rootPath, displayName, origin) {
  validateProjectDir(rootPath)
  const index = loadIndex()
  const existing = index.projects.find((p) => samePath(p.rootPath, rootPath))
  if (existing) return { project: existing, existed: true }

  const scan = scanProject(rootPath)
  const project = {
    id: makeId(),
    name: uniqueName(displayName, index),
    rootPath,
    origin,
    importedAt: Date.now(),
    lastRunAt: null,
    scan,
  }
  index.projects.push(project)
  saveIndex(index)
  return { project, existed: false }
}

/** 按文件夹导入（原地引用） */
function addProjectByPath(rootPath) {
  return registerProject(rootPath, path.basename(path.resolve(rootPath)), 'folder')
}

/** 按 zip 导入：解压到 workspace/projects/ 后登记 */
function addProjectByZip(zipPath) {
  let st
  try {
    st = fs.statSync(zipPath)
  } catch {
    throw new Error(`文件不存在: ${zipPath}`)
  }
  if (!st.isFile() || !/\.zip$/i.test(zipPath)) throw new Error('请选择 .zip 压缩包')

  const index = loadIndex()
  const base = path.basename(zipPath).replace(/\.zip$/i, '')
  const dest = path.join(projectsRoot(), uniqueName(base, index))
  extractZip(zipPath, dest)
  const rootPath = resolveExtractRoot(dest)
  try {
    return registerProject(rootPath, path.basename(rootPath), 'zip')
  } catch (err) {
    // 登记失败（如 zip 内容不是有效数据）时清理已解压内容
    try {
      fs.rmSync(dest, { recursive: true, force: true })
    } catch {
      // 清理失败不影响错误抛出
    }
    throw err
  }
}

function getProject(id) {
  return loadIndex().projects.find((p) => p.id === id) || null
}

/** 项目列表（附 rootPath 存活标记，供 UI 提示"数据目录丢失"） */
function listProjects() {
  return loadIndex().projects.map((p) => ({
    ...p,
    rootExists: fs.existsSync(p.rootPath),
  }))
}

function renameProject(id, name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('项目名不能为空')
  const index = loadIndex()
  const project = index.projects.find((p) => p.id === id)
  if (!project) throw new Error('项目不存在')
  if (project.name !== trimmed && index.projects.some((p) => p.id !== id && p.name === trimmed)) {
    throw new Error(`项目名已存在: ${trimmed}`)
  }
  project.name = trimmed
  saveIndex(index)
  return project
}

function removeProject(id, removeData) {
  const index = loadIndex()
  const i = index.projects.findIndex((p) => p.id === id)
  if (i < 0) throw new Error('项目不存在')
  const project = index.projects[i]
  index.projects.splice(i, 1)
  saveIndex(index)
  // zip 型可连带删除解压数据；文件夹型为用户原始数据，绝不删除
  if (removeData && project.origin === 'zip') {
    const root = path.resolve(projectsRoot())
    const target = path.resolve(project.rootPath)
    if (target.startsWith(root + path.sep)) {
      try {
        fs.rmSync(target, { recursive: true, force: true })
      } catch {
        // 删除数据失败不影响移除登记
      }
    }
  }
  return project
}

/** 重扫项目产物（exe 运行完成或用户手动刷新时调用） */
function rescanProject(id) {
  const index = loadIndex()
  const project = index.projects.find((p) => p.id === id)
  if (!project) throw new Error('项目不存在')
  project.scan = scanProject(project.rootPath)
  project.lastScanAt = project.scan.scannedAt
  saveIndex(index)
  return project
}

function touchLastRun(id) {
  const index = loadIndex()
  const project = index.projects.find((p) => p.id === id)
  if (!project) return
  project.lastRunAt = Date.now()
  saveIndex(index)
}

module.exports = {
  addProjectByPath,
  addProjectByZip,
  getProject,
  listProjects,
  renameProject,
  removeProject,
  rescanProject,
  touchLastRun,
  workspaceDir,
}
