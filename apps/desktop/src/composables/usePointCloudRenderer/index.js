/**
 * 点云渲染器主入口（从手机端 usePointCloudRenderer/index.js 移植）
 */
import { mergeConfig } from './config.js'
import { createColorCalculator } from './colorTable.js'
import { createBufferManager } from './bufferManager.js'
import { createRendererCore } from './rendererCore.js'

export function usePointCloudRenderer(container, options = {}) {
  const config = mergeConfig(options)
  const colorCalculator = createColorCalculator()
  const bufferManager = createBufferManager(config)
  const rendererCore = createRendererCore({ container, config, bufferManager, colorCalculator })

  return {
    init: rendererCore.init,
    addPoints: rendererCore.addPoints,
    addPointsFromArrays: rendererCore.addPointsFromArrays,
    resetPointCloud: rendererCore.resetPointCloud,
    setTargetFps: rendererCore.setTargetFps,
    onResize: rendererCore.onResize,
    markNeedsRender: rendererCore.markNeedsRender,
    fitCameraToBounds: rendererCore.fitCameraToBounds,
    getCurrentPointCount: rendererCore.getCurrentPointCount,
    isWebGLContextValid: rendererCore.isWebGLContextValid,
    setErrorHandler: rendererCore.setErrorHandler,
    dispose: rendererCore.dispose,
  }
}

export { mergeConfig } from './config.js'
export { createColorCalculator } from './colorTable.js'
