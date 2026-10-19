// 产物发现式扫描：不依赖算法输出文件/文件夹的具体命名
// 算法端输出命名变化时，只需调整本文件顶部 RULES
const fs = require('fs')
const path = require('path')

const RULES = {
  // 点云产物扩展名（原始输入点云为 txt，故 txt 不计入算法产物）
  cloudExts: ['.ply'],
  // 全景照片扩展名
  panoramaExts: ['.png', '.jpg', '.jpeg'],
  // 站位目录名模式（现状为 Batch_NNN）；一级子目录无匹配时回退为全部视为站
  stationPattern: /^batch[_\- ]?(\d+)$/i,
  // 站内无点云产物时，全景照片在这些名字的目录里找（提示词，宽松匹配；gpd 算法输出目录为 out）
  outputDirHints: ['pctr_output', 'output', 'result', 'pano', 'out'],
  // 站内递归扫描深度（站目录自身为 0 层）
  stationScanDepth: 3,
  // 拼接点云目录递归深度（根目录自身为 0 层；先扫 0 层，无结果再扫到 1 层）
  mergedScanDepth: 1,
  // 原始点云（输入数据，非算法产物）：站目录第一层的前缀匹配 txt
  sourceCloudPrefix: 'pointCloud_data_',
  // 目录树扫描深度（工作台左侧按磁盘原样展示；根目录自身为 0 层）
  treeScanDepth: 4,
  // 目录树单目录文件数上限（如 allPicture 内大量原始照片）
  maxFilesPerDir: 3000,
  // 目录树中可点击渲染的点云扩展名（含原始输入 txt）
  treeCloudExts: ['.ply', '.txt'],
}

// 目录树忽略的系统文件
const TREE_IGNORE_FILES = new Set(['thumbs.db', 'desktop.ini', '.ds_store'])

function extOf(name) {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

function isCloudFile(name) {
  return RULES.cloudExts.includes(extOf(name))
}

function isPanoramaFile(name) {
  return RULES.panoramaExts.includes(extOf(name))
}

function statFile(filePath) {
  try {
    const st = fs.statSync(filePath)
    if (!st.isFile()) return null
    return { path: filePath, name: path.basename(filePath), size: st.size, mtime: st.mtimeMs }
  } catch {
    return null
  }
}

/** 递归收集目录下文件绝对路径（限深度，忽略无法读取的目录） */
function walkFiles(dir, maxDepth, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (maxDepth > 0) walkFiles(p, maxDepth - 1, out)
    } else if (e.isFile()) {
      out.push(p)
    }
  }
  return out
}

/** 递归收集目录下子目录绝对路径（含起始目录自身，限深度） */
function walkDirs(dir, maxDepth, out = []) {
  out.push(dir)
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.isDirectory() && maxDepth > 0) walkDirs(path.join(dir, e.name), maxDepth - 1, out)
  }
  return out
}

// ===================== 图片尺寸（读文件头，不整读文件） =====================

function readPngSize(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const head = Buffer.alloc(24)
    if (fs.readSync(fd, head, 0, 24, 0) < 24) return null
    if (head.readUInt32BE(0) !== 0x89504e47) return null
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
  } catch {
    return null
  } finally {
    fs.closeSync(fd)
  }
}

function readJpegSize(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const st = fs.fstatSync(fd)
    const two = Buffer.alloc(2)
    let offset = 2
    while (offset + 4 < st.size) {
      if (fs.readSync(fd, two, 0, 2, offset) < 2 || two[0] !== 0xff) return null
      const marker = two[1]
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2
        continue
      }
      if (fs.readSync(fd, two, 0, 2, offset + 2) < 2) return null
      const len = two.readUInt16BE(0)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const seg = Buffer.alloc(5)
        if (fs.readSync(fd, seg, 0, 5, offset + 4) < 5) return null
        return { width: seg.readUInt16BE(3), height: seg.readUInt16BE(1) }
      }
      offset += 2 + len
    }
    return null
  } catch {
    return null
  } finally {
    fs.closeSync(fd)
  }
}

function readImageSize(filePath) {
  const ext = extOf(filePath)
  if (ext === '.png') return readPngSize(filePath)
  if (ext === '.jpg' || ext === '.jpeg') return readJpegSize(filePath)
  return null
}

// ===================== 站位 =====================

/** 发现根目录下的站位：优先 Batch_NNN 命名，否则回退为全部一级子目录 */
function discoverStations(rootPath) {
  let entries
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

  const matched = []
  for (const name of dirs) {
    const m = RULES.stationPattern.exec(name)
    if (m) matched.push({ name, path: path.join(rootPath, name), num: parseInt(m[1], 10) })
  }
  if (matched.length > 0) {
    matched.sort((a, b) => a.num - b.num)
    return matched.map(({ name, path: p }) => ({ name, path: p }))
  }
  return dirs
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
    .map((name) => ({ name, path: path.join(rootPath, name) }))
}

/** 目录名是否命中输出目录提示词 */
function matchesOutputHint(dirPath) {
  const name = path.basename(dirPath).toLowerCase()
  return RULES.outputDirHints.some((hint) => name.includes(hint))
}

function makePanoramaInfo(filePath) {
  const info = statFile(filePath)
  if (!info) return null
  const dim = readImageSize(filePath)
  info.width = dim ? dim.width : 0
  info.height = dim ? dim.height : 0
  return info
}

/** 全景按像素面积降序（全景图远大于普通截图/小图），未知尺寸排最后按文件大小 */
function sortPanoramas(list) {
  return list.sort((a, b) => {
    const pa = a.width * a.height
    const pb = b.width * b.height
    if (pa !== pb) return pb - pa
    return b.size - a.size
  })
}

/**
 * 扫描单个站位产物
 * @returns {{name, path, cloud, panoramas}}
 */
function scanStation(stationPath, name) {
  const files = walkFiles(stationPath, RULES.stationScanDepth)
  const panoramas = []

  // 点云产物所在目录即输出目录
  const cloudFiles = files.filter((p) => isCloudFile(path.basename(p)))
  cloudFiles.sort((a, b) => {
    const sa = statFile(a)
    const sb = statFile(b)
    return (sb ? sb.mtime : 0) - (sa ? sa.mtime : 0)
  })

  let outputDir = cloudFiles.length > 0 ? path.dirname(cloudFiles[0]) : null
  if (!outputDir) {
    // 无点云产物时回退：站内 1 层深度内名字命中提示词的目录
    outputDir = walkDirs(stationPath, 1).find(matchesOutputHint) || null
  }

  if (outputDir) {
    for (const p of files) {
      if (!isPanoramaFile(path.basename(p))) continue
      if (p.startsWith(outputDir + path.sep)) {
        const info = makePanoramaInfo(p)
        if (info) panoramas.push(info)
      }
    }
  }

  // 原始点云：站目录第一层的 pointCloud_data_*.txt（输入数据，无颜色按高度着色）
  let sourceCloud = null
  try {
    const first = fs
      .readdirSync(stationPath, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.startsWith(RULES.sourceCloudPrefix) && e.name.endsWith('.txt'))
      .map((e) => e.name)
      .sort()[0]
    if (first) sourceCloud = statFile(path.join(stationPath, first))
  } catch {
    // 站目录不可读时忽略原始点云
  }

  return {
    name,
    path: stationPath,
    sourceCloud,
    cloud: cloudFiles.length > 0 ? statFile(cloudFiles[0]) : null,
    panoramas: sortPanoramas(panoramas),
  }
}

// ===================== 拼接点云 =====================

/**
 * 发现根目录下的多站拼接点云：先扫根目录一层，无结果再扫到子目录一层
 * @returns {Array<{path,name,size,mtime}>} 按修改时间降序（最新优先）
 */
function scanMergedClouds(rootPath) {
  let candidates = walkFiles(rootPath, 0).filter((p) => isCloudFile(path.basename(p)))
  if (candidates.length === 0) {
    candidates = walkFiles(rootPath, RULES.mergedScanDepth).filter((p) => isCloudFile(path.basename(p)))
  }
  return candidates
    .map(statFile)
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
}

// ===================== 项目全量扫描 =====================

/**
 * 全量扫描项目根目录：站位列表 + 各站产物 + 根目录拼接点云
 * @returns {{scannedAt, stations, mergedClouds}}
 */
function scanProject(rootPath) {
  const stations = discoverStations(rootPath).map((st) => scanStation(st.path, st.name))
  return {
    scannedAt: Date.now(),
    stations,
    mergedClouds: scanMergedClouds(rootPath),
  }
}

// ===================== 磁盘目录树 =====================

/** 按文件扩展名归类目录树文件节点类型 */
function classifyTreeFile(name) {
  const ext = extOf(name)
  if (RULES.treeCloudExts.includes(ext)) return 'cloud'
  if (RULES.panoramaExts.includes(ext)) return 'image'
  return 'file'
}

function buildDirNode(dirPath, remainDepth) {
  const node = { name: path.basename(dirPath), path: dirPath, type: 'dir', children: [] }
  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    // 不可读目录保留节点但无子项
    node.children = []
    node.unreadable = true
    return node
  }

  const dirs = []
  const files = []
  for (const e of entries) {
    if (e.isDirectory()) dirs.push(e)
    else if (e.isFile() && !TREE_IGNORE_FILES.has(e.name.toLowerCase())) files.push(e)
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  dirs.sort(byName)
  files.sort(byName)

  for (const d of dirs) {
    const p = path.join(dirPath, d.name)
    if (remainDepth > 0) node.children.push(buildDirNode(p, remainDepth - 1))
    else node.children.push({ name: d.name, path: p, type: 'dir', children: [], depthLimited: true })
  }

  const shown = files.slice(0, RULES.maxFilesPerDir)
  for (const f of shown) {
    const p = path.join(dirPath, f.name)
    let size = 0
    try {
      size = fs.statSync(p).size
    } catch {
      // 无法取大小的文件仍列出
    }
    node.children.push({ name: f.name, path: p, type: classifyTreeFile(f.name), size })
  }
  if (files.length > shown.length) {
    node.children.push({
      name: `… 其余 ${files.length - shown.length} 个文件未显示`,
      path: path.join(dirPath, '#more'),
      type: 'more',
    })
  }
  return node
}

/**
 * 扫描磁盘原始目录树：工作台左侧原样展示数据结构，不做产物分类、不改文件名
 * @returns {{name,path,type:'dir',children:Array}}
 */
function scanTree(rootPath) {
  return buildDirNode(rootPath, RULES.treeScanDepth)
}

module.exports = {
  scanProject,
  scanStation,
  scanMergedClouds,
  discoverStations,
  scanTree,
  readImageSize,
  RULES,
}
