// 应用设置：持久化到 settings.json
// 算法端 gpd.exe（全景生成 + 多站拼接一体）为外部依赖，路径在设置页配置
const fs = require('fs')
const path = require('path')
const { PATHS } = require('./paths.cjs')

const DEFAULTS = {
  gpdExePath: '',
  workspacePath: PATHS.WORKSPACE,
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(PATHS.SETTINGS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveSettings(partial) {
  const merged = { ...loadSettings(), ...partial }
  fs.mkdirSync(path.dirname(PATHS.SETTINGS_FILE), { recursive: true })
  fs.writeFileSync(PATHS.SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

module.exports = { loadSettings, saveSettings, DEFAULTS }
