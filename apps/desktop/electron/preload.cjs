const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ptcrApi', {
  selectFile: (filters) => ipcRenderer.invoke('app:select-file', filters),
  selectDirectory: () => ipcRenderer.invoke('app:select-directory'),
  openPath: (p) => ipcRenderer.invoke('app:open-path', p),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:set', partial),

  listProjects: () => ipcRenderer.invoke('projects:list'),
  getProject: (projectId) => ipcRenderer.invoke('projects:get', projectId),
  addProjectByFolder: (folderPath) => ipcRenderer.invoke('projects:add-folder', folderPath),
  addProjectByZip: (zipPath) => ipcRenderer.invoke('projects:add-zip', zipPath),
  renameProject: (projectId, name) => ipcRenderer.invoke('projects:rename', projectId, name),
  removeProject: (projectId, removeData) => ipcRenderer.invoke('projects:remove', projectId, removeData),
  rescanProject: (projectId) => ipcRenderer.invoke('projects:rescan', projectId),
  scanTree: (projectId) => ipcRenderer.invoke('projects:tree', projectId),

  runPipeline: (opts) => ipcRenderer.invoke('pipeline:run', opts),
  cancelPipeline: () => ipcRenderer.invoke('pipeline:cancel'),
  isPipelineRunning: () => ipcRenderer.invoke('pipeline:is-running'),

  loadPointCloudFile: (filePath) => ipcRenderer.invoke('pointcloud:load-file', filePath),

  onPipelineEvent: (callback) => {
    const listener = (_e, payload) => callback(payload)
    ipcRenderer.on('pipeline:event', listener)
    return () => ipcRenderer.removeListener('pipeline:event', listener)
  },
})
