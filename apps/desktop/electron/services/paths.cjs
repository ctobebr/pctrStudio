// 项目内固定路径解析
// 开发模式：相对本文件定位到 E:\ptcr-studio 根目录
// 打包模式（app.asar 内运行）：4 级上溯定位到安装目录 resources\
const path = require('path')

// electron/services -> electron -> desktop -> apps -> 项目根（打包后: app.asar -> electron -> services -> resources）
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

// 通过路径中的 app.asar 片段判定打包态（e2e 脚本在纯 Node 下运行，不能依赖 electron 模块）
const IS_PACKAGED = __dirname.includes(`${path.sep}app.asar${path.sep}`)

// 打包后安装目录（可能在 Program Files 下）不可写，设置与项目索引改放用户数据目录
function userDataDir() {
  const { app } = require('electron')
  return app.getPath('userData')
}

// 算法端 gpd.exe 为外部配置路径（设置页指定），不随应用分发，故无算法资源常量
const PATHS = {
  PROJECT_ROOT,
  IS_PACKAGED,
  SETTINGS_FILE: IS_PACKAGED ? path.join(userDataDir(), 'settings.json') : path.join(PROJECT_ROOT, 'settings.json'),
  WORKSPACE: IS_PACKAGED ? path.join(userDataDir(), 'workspace') : path.join(PROJECT_ROOT, 'workspace'),
}

module.exports = { PATHS }
