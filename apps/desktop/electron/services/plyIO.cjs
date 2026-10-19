// 点云文件读取：txt 流式解析 + PLY（ascii/binary）解析，供渲染进程展示
// PLY 支持 x/y/z + 可选 red/green/blue 顶点色（uchar/float 类型），无色时返回 colors=null 由渲染端按高度着色
const fs = require('fs')
const readline = require('readline')

// 与渲染进程 maxPoints（src/composables/usePointCloudRenderer/config.js）保持一致：
// 超过此值时均匀采样，避免渲染端二次截断
const DEFAULT_MAX_POINTS = 20_000_000

function emptyBounds() {
  return {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  }
}

function updateBounds(bounds, x, y, z) {
  if (x < bounds.minX) bounds.minX = x
  if (x > bounds.maxX) bounds.maxX = x
  if (y < bounds.minY) bounds.minY = y
  if (y > bounds.maxY) bounds.maxY = y
  if (z < bounds.minZ) bounds.minZ = z
  if (z > bounds.maxZ) bounds.maxZ = z
}

/** 按索引步进均匀采样（保持空间分布），idx 为采样点在原数组中的点序号 */
function sampleIndices(total, maxPoints) {
  const stride = total / maxPoints
  const idx = new Int32Array(maxPoints)
  for (let i = 0; i < maxPoints; i++) {
    idx[i] = Math.min(total - 1, Math.floor(i * stride))
  }
  return idx
}

function finalizeResult(positions, colors, count, total, bounds, truncated) {
  return {
    positions,
    colors,
    count,
    total,
    truncated,
    bounds:
      total > 0
        ? bounds
        : { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
  }
}

// ===================== txt =====================

/**
 * 流式解析点云 txt（每行前 3 列 x y z，非法行/表头行跳过）
 * @returns {Promise<{positions: Float32Array, colors: null, count, total, truncated, bounds}>}
 */
async function parseTxtPointCloud(filePath, maxPoints = DEFAULT_MAX_POINTS) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  let capacity = 1 << 16
  let positions = new Float32Array(capacity * 3)
  let total = 0
  const bounds = emptyBounds()

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // 快速预判：数据行以数字或负号开头，跳过表头等含字母行
    const c = trimmed.charCodeAt(0)
    if (!((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46)) continue

    const sp1 = trimmed.indexOf(' ')
    const sp2 = sp1 < 0 ? -1 : trimmed.indexOf(' ', sp1 + 1)
    if (sp2 < 0) continue
    const x = Number(trimmed.slice(0, sp1))
    const y = Number(trimmed.slice(sp1 + 1, sp2))
    const rest = trimmed.slice(sp2 + 1)
    const sp3 = rest.indexOf(' ')
    const zStr = sp3 < 0 ? rest : rest.slice(0, sp3)
    const z = Number(zStr)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue

    if (total >= capacity) {
      capacity *= 2
      const grown = new Float32Array(capacity * 3)
      grown.set(positions)
      positions = grown
    }
    const o = total * 3
    positions[o] = x
    positions[o + 1] = y
    positions[o + 2] = z
    total++
    updateBounds(bounds, x, y, z)
  }

  const truncated = total > maxPoints
  let result
  if (truncated) {
    const idx = sampleIndices(total, maxPoints)
    const sampled = new Float32Array(maxPoints * 3)
    for (let i = 0; i < maxPoints; i++) {
      const src = idx[i] * 3
      sampled[i * 3] = positions[src]
      sampled[i * 3 + 1] = positions[src + 1]
      sampled[i * 3 + 2] = positions[src + 2]
    }
    result = sampled
  } else {
    result = positions.subarray(0, total * 3)
  }

  return finalizeResult(result, null, truncated ? maxPoints : total, total, bounds, truncated)
}

// ===================== PLY =====================

// PLY 数据类型 -> 字节宽度
const PLY_TYPE_SIZE = {
  char: 1, int8: 1, uchar: 1, uint8: 1,
  short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4,
  float: 4, float32: 4, double: 8, float64: 8,
}

/** Buffer 读取方法名（Node Buffer 自带 LE/BE 变体） */
function plyReadMethod(type, littleEndian) {
  const suffix = littleEndian ? 'LE' : 'BE'
  switch (type) {
    case 'char': case 'int8': return `readInt8`
    case 'uchar': case 'uint8': return `readUInt8`
    case 'short': case 'int16': return `readInt16${suffix}`
    case 'ushort': case 'uint16': return `readUInt16${suffix}`
    case 'int': case 'int32': return `readInt32${suffix}`
    case 'uint': case 'uint32': return `readUInt32${suffix}`
    case 'float': case 'float32': return `readFloat${suffix}`
    case 'double': case 'float64': return `readDouble${suffix}`
    default: throw new Error(`PLY 不支持的属性类型: ${type}`)
  }
}

/**
 * 解析 PLY header
 * @returns {{format: string, vertex: {count: number, props: Array<{name: string, size: number, offset: number, method: string}>}, dataStart: number, stride: number}}
 */
function parsePlyHeader(buf) {
  const marker = buf.indexOf('end_header')
  if (marker < 0) throw new Error('PLY 头部解析失败（未找到 end_header）')
  const headerText = buf.subarray(0, marker).toString('utf8')
  const lines = headerText.split(/\r?\n/)
  if (!/^ply/i.test(lines[0] || '')) throw new Error('不是有效的 PLY 文件')

  let format = null
  let vertex = null
  for (const line of lines.slice(1)) {
    const t = line.trim().split(/\s+/)
    if (t[0] === 'format') {
      format = t[1]
    } else if (t[0] === 'element' && t[1] === 'vertex') {
      vertex = { count: parseInt(t[2], 10), props: [] }
    } else if (t[0] === 'property' && vertex && t[1] !== 'list') {
      vertex.props.push({ name: t[2], type: t[1] })
    }
  }
  if (!format) throw new Error('PLY 缺少 format 声明')
  if (!vertex) throw new Error('PLY 缺少 vertex element')
  if (vertex.count <= 0) throw new Error('PLY vertex 数量为 0')

  // dataStart：end_header 行尾换行符之后
  let dataStart = marker
  while (dataStart < buf.length && buf[dataStart] !== 0x0a) dataStart++
  dataStart++

  // 预计算属性偏移与读取方法：offset 为字节偏移（binary 用），index 为 token 序号（ascii 用）
  const littleEndian = format === 'binary_little_endian'
  let offset = 0
  vertex.props.forEach((p, i) => {
    p.index = i
    p.size = PLY_TYPE_SIZE[p.type]
    if (!p.size) throw new Error(`PLY 不支持的属性类型: ${p.type}`)
    p.offset = offset
    p.method = plyReadMethod(p.type, littleEndian)
    offset += p.size
  })
  return { format, vertex, dataStart, stride: offset }
}

/** RGB 归一化：uchar 0-255 与 float 0-1 两种约定都兼容 */
function normalizeColorComponent(v, isFloatType) {
  if (!isFloatType) return v / 255
  return v > 1.0001 ? v / 255 : v
}

/**
 * 解析 PLY 点云（ascii / binary 均支持），超限均匀采样
 * @returns {{positions: Float32Array, colors: Float32Array|null, count, total, truncated, bounds}}
 */
function parsePlyPointCloud(filePath, maxPoints = DEFAULT_MAX_POINTS) {
  const buf = fs.readFileSync(filePath)
  const { format, vertex, dataStart, stride } = parsePlyHeader(buf)

  const propMap = new Map(vertex.props.map((p) => [p.name.toLowerCase(), p]))
  const px = propMap.get('x')
  const py = propMap.get('y')
  const pz = propMap.get('z')
  if (!px || !py || !pz) throw new Error('PLY vertex 缺少 x/y/z 属性')
  const pr = propMap.get('red')
  const pg = propMap.get('green')
  const pb = propMap.get('blue')
  const hasColor = !!(pr && pg && pb)

  const total = vertex.count
  const truncated = total > maxPoints
  const count = truncated ? maxPoints : total
  const idx = truncated ? sampleIndices(total, maxPoints) : null

  const positions = new Float32Array(count * 3)
  const colors = hasColor ? new Float32Array(count * 3) : null
  const bounds = emptyBounds()

  // float 类颜色属性按 0-1 约定，整数类按 0-255 约定
  const floatLike = (t) => t === 'float' || t === 'float32' || t === 'double' || t === 'float64'
  const prFloat = hasColor ? floatLike(pr.type) : false
  const pgFloat = hasColor ? floatLike(pg.type) : false
  const pbFloat = hasColor ? floatLike(pb.type) : false

  if (format === 'ascii') {
    // ascii：从 dataStart 起逐行解析，按属性在 property 列表中的序号取 token
    const lines = buf.subarray(dataStart).toString('utf8').split(/\r?\n/)
    let li = 0
    let filled = 0
    while (filled < count && li < lines.length) {
      const parts = lines[li++].trim().split(/\s+/)
      if (parts.length < vertex.props.length) continue
      const x = Number(parts[px.index])
      const y = Number(parts[py.index])
      const z = Number(parts[pz.index])
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
      const o = filled * 3
      positions[o] = x
      positions[o + 1] = y
      positions[o + 2] = z
      updateBounds(bounds, x, y, z)
      if (hasColor) {
        colors[o] = normalizeColorComponent(Number(parts[pr.index]), prFloat)
        colors[o + 1] = normalizeColorComponent(Number(parts[pg.index]), pgFloat)
        colors[o + 2] = normalizeColorComponent(Number(parts[pb.index]), pbFloat)
      }
      filled++
    }
    return finalizeResult(positions, colors, filled, total, bounds, truncated)
  }

  // binary：直接按 stride 跳读采样点（避免全量展开）
  for (let i = 0; i < count; i++) {
    const base = dataStart + (idx ? idx[i] : i) * stride
    const x = buf[px.method](base + px.offset)
    const y = buf[py.method](base + py.offset)
    const z = buf[pz.method](base + pz.offset)
    const o = i * 3
    positions[o] = x
    positions[o + 1] = y
    positions[o + 2] = z
    updateBounds(bounds, x, y, z)
    if (hasColor) {
      colors[o] = normalizeColorComponent(buf[pr.method](base + pr.offset), prFloat)
      colors[o + 1] = normalizeColorComponent(buf[pg.method](base + pg.offset), pgFloat)
      colors[o + 2] = normalizeColorComponent(buf[pb.method](base + pb.offset), pbFloat)
    }
  }
  return finalizeResult(positions, colors, count, total, bounds, truncated)
}

/** 按扩展名判断点云文件类型并解析 */
async function parsePointCloudFile(filePath, maxPoints = DEFAULT_MAX_POINTS) {
  if (/\.ply$/i.test(filePath)) {
    return parsePlyPointCloud(filePath, maxPoints)
  }
  return parseTxtPointCloud(filePath, maxPoints)
}

module.exports = { parseTxtPointCloud, parsePlyPointCloud, parsePointCloudFile, DEFAULT_MAX_POINTS }
