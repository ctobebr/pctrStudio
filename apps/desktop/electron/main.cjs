const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
const { loadSettings, saveSettings } = require('./services/settings.cjs')
const projectStore = require('./services/projectStore.cjs')
const { runPipeline, cancelPipeline, isRunning } = require('./services/pipeline.cjs')
const { parsePointCloudFile } = require('./services/plyIO.cjs')
const { scanTree } = require('./services/artifactScanner.cjs')

let mainWindow = null

// localfile:// 协议：渲染进程访问本地图片（全景照片）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'localfile',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true, stream: true },
  },
])

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // 渲染进程 console 转发到终端：打包环境无 DevTools 时的关键排查手段
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error(`[renderer] ${message} (${sourceId}:${line})`)
    }
  })

  const devUrl = process.env.ELECTRON_START_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
    // npm run start（本地生产模式自测）：不自动开 DevTools，需要时按 Ctrl+Shift+I 手动打开
  }
}

function emitToRenderer(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pipeline:event', payload)
  }
}

function registerIpc() {
  ipcMain.handle('app:select-file', async (_e, filters) => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('app:select-directory', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('app:open-path', async (_e, p) => {
    shell.showItemInFolder(p)
    return true
  })

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, partial) => saveSettings(partial))

  ipcMain.handle('projects:list', () => projectStore.listProjects())
  ipcMain.handle('projects:get', (_e, projectId) => projectStore.getProject(projectId))
  ipcMain.handle('projects:add-folder', (_e, folderPath) => projectStore.addProjectByPath(folderPath))
  ipcMain.handle('projects:add-zip', (_e, zipPath) => projectStore.addProjectByZip(zipPath))
  ipcMain.handle('projects:rename', (_e, projectId, name) => projectStore.renameProject(projectId, name))
  ipcMain.handle('projects:remove', (_e, projectId, removeData) => projectStore.removeProject(projectId, removeData))
  ipcMain.handle('projects:rescan', (_e, projectId) => projectStore.rescanProject(projectId))
  // 工作台左侧目录树：磁盘原样结构
  ipcMain.handle('projects:tree', (_e, projectId) => {
    const p = projectStore.getProject(projectId)
    if (!p) throw new Error('项目不存在（可能已被移除）')
    return scanTree(p.rootPath)
  })

  ipcMain.handle('pipeline:run', async (_e, opts) => {
    if (isRunning()) throw new Error('已有管线在运行中')
    // 异步执行，进度通过 pipeline:event 推送
    runPipeline(opts, emitToRenderer).catch((err) => {
      emitToRenderer({ type: 'done', ok: false, error: err.message })
    })
    return { ok: true }
  })

  ipcMain.handle('pipeline:cancel', () => cancelPipeline())
  ipcMain.handle('pipeline:is-running', () => isRunning())

  // 按文件路径加载点云（每站产物 / 根目录拼接产物），ply 与 txt 均支持
  ipcMain.handle('pointcloud:load-file', async (_e, filePath) => {
    if (typeof filePath !== 'string' || !/\.(ply|txt)$/i.test(filePath)) {
      throw new Error('不支持的点云文件类型（仅 ply / txt）')
    }
    const cloud = await parsePointCloudFile(filePath)
    return { ...cloud, filePath }
  })
}

app.whenReady().then(() => {
  // URL 形如 localfile://localfile/E%3A/foo/bar.png：
  // host 为固定占位符（standard scheme 不允许空 host），真实文件路径编码在 pathname 中
  protocol.handle('localfile', (request) => {
    const u = new URL(request.url)
    let filePath
    try {
      filePath = decodeURIComponent(u.pathname)
    } catch {
      filePath = u.pathname
    }
    filePath = filePath.replace(/^\//, '')
    return net.fetch(pathToFileURL(filePath).toString())
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
