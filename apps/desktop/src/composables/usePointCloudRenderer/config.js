/**
 * 点云渲染器配置（从手机端 usePointCloudRenderer/config.js 移植，桌面参数调整）
 * 坐标约定与手机端一致：txt 的 x/y/z 原样进入渲染空间，Y 作为高度着色
 */

/**
 * 点大小滑块可调范围（世界单位；sizeAttenuation 开启时点随距离近大远小）
 * default 与 config.pointSize 保持一致，作为滑块重置的默认值
 */
export const POINT_SIZE_LIMITS = Object.freeze({
  min: 0.005,
  max: 0.1,
  step: 0.005,
  default: 0.05,
})

/** @type {RendererConfig} */
export const DEFAULT_RENDERER_CONFIG = Object.freeze({
  // 桌面端显存充裕：2000 万点 × 3(float) × 4B × 2(位置+颜色) ≈ 480MB GPU 缓冲（8GB 显存可承载双画布）
  maxPoints: 20_000_000,
  // 初始容量 1000 万（约 240MB）：画布挂载即预分配，空画布不必占满上限；超出时按 1.5× 增长
  initialCapacity: 10_000_000,
  targetFps: 30,
  pixelRatioMax: 2,
  cameraFov: 70,
  pointSize: POINT_SIZE_LIMITS.default,
})

export function mergeConfig(options = {}) {
  return { ...DEFAULT_RENDERER_CONFIG, ...options }
}
