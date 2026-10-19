// 打包入口：设置国内镜像规避 GitHub 下载不稳定（electron zip / NSIS 工具）
// 用法：npm run dist:win（package.json 已指向本脚本）
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/'
process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/'

// 使用临时输出目录以绕过旧 win-unpacked 目录被锁的问题
const projectDir = path.resolve(__dirname, '..')
const tmpDir = path.join(os.tmpdir(), `ptcr-dist-${Date.now()}`)

// 前端构建
const build = spawnSync('npx.cmd', ['vite', 'build'], { stdio: 'inherit', shell: true, cwd: projectDir })
if (build.status !== 0) {
  console.error('前端构建失败')
  process.exit(build.status ?? 1)
}

// electron-builder 打包到临时目录
// electronDist 直接指向 node_modules 内的本地 electron：腾讯电脑管家实时扫描会锁住
// 临时目录里刚解压的 electron 文件，导致解压后的目录重命名必然 EPERM（跳过该环节）
const electronDist = path.join(projectDir, 'node_modules', 'electron', 'dist')
const dist = spawnSync('npx.cmd', [
  'electron-builder', '--win', '--publish', 'never',
  '--config.electronDist', electronDist,
  '--config.directories.output', tmpDir,
], {
  stdio: 'inherit',
  shell: true,
  cwd: projectDir,
})
if (dist.status !== 0) {
  console.error('electron-builder 打包失败')
  // 清理临时目录
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  process.exit(dist.status ?? 1)
}

// 打包成功，将产物复制到 release 目录
const releaseDir = path.join(projectDir, 'release')
fs.mkdirSync(releaseDir, { recursive: true })
for (const name of fs.readdirSync(tmpDir)) {
  const src = path.join(tmpDir, name)
  const dst = path.join(releaseDir, name)
  // 跳过 win-unpacked（免安装版），只复制安装包
  if (name === 'win-unpacked') continue
  try {
    // 覆盖旧安装包
    if (fs.existsSync(dst)) fs.rmSync(dst, { force: true })
    fs.cpSync(src, dst, { recursive: true })
    console.log(`已复制产物: ${name}`)
  } catch (e) {
    console.warn(`警告：无法复制 ${name}: ${e.message}`)
  }
}

// 清理临时目录
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}

// 清理旧版本安装包，只留本次产物
const { version } = require('../package.json')
const keep = new Set([`PTCR-Studio-Setup-${version}.exe`, `PTCR-Studio-Setup-${version}.exe.blockmap`])
if (fs.existsSync(releaseDir)) {
  for (const name of fs.readdirSync(releaseDir)) {
    if (name.startsWith('PTCR-Studio-Setup-') && !keep.has(name)) {
      try {
        fs.rmSync(path.join(releaseDir, name), { force: true })
        console.log(`已清理旧版本安装包: ${name}`)
      } catch (_) {}
    }
  }
}