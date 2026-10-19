// 渲染进程 IPC 辅助工具
const api = window.ptcrApi

// 在普通浏览器（而非 Electron 窗口）中打开页面时，preload 未注入，给出明确提示
if (!api) {
  console.error('[ptcr] window.ptcrApi 不存在：请在 Electron 窗口中运行（npm run dev / npm run start），不要在浏览器中直接打开页面')
}

/** 本地文件路径 -> localfile:// URL（供 <img> 与 THREE 纹理加载）
 *  host 段为固定占位符：standard scheme 不允许空 host（localfile:/// 会被判为 Invalid URL），
 *  且直接把盘符放 host 位置（localfile:///E:/...）会被 Chromium 当作 host 吞掉，故路径全部编码进 pathname。
 *  主进程侧解析见 electron/main.cjs 的 protocol.handle('localfile')。
 */
export function localfileUrl(filePath) {
  if (!filePath) return ''
  const normalized = String(filePath).replace(/\\/g, '/')
  const encoded = normalized.split('/').map(encodeURIComponent).join('/')
  return `localfile://localfile/${encoded}`
}

/** 格式化文件大小 */
export function formatSize(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 格式化时间 */
export function formatTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 统一提取 IPC 错误文本（invoke reject 的 err 可能是 Error/字符串） */
export function errText(e) {
  if (!e) return '未知错误'
  return e.message || String(e)
}

export default api
