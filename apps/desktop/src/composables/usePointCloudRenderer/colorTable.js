/**
 * 颜色查找表（从手机端 colorTable.js 原样移植：蓝→青→绿→黄→红 按高度映射）
 */
export const ColorLookupTable = (() => {
  let instance = null

  function create() {
    const lut = new Array(256)
    for (let i = 0; i < 256; i++) {
      const t = i / 255
      let r, g, b
      if (t < 0.25) {
        r = 0
        g = t * 4
        b = 1
      } else if (t < 0.5) {
        r = 0
        g = 1
        b = 1 - (t - 0.25) * 4
      } else if (t < 0.75) {
        r = (t - 0.5) * 4
        g = 1
        b = 0
      } else {
        r = 1
        g = 1 - (t - 0.75) * 4
        b = 0
      }
      lut[i] = { r, g, b }
    }
    return lut
  }

  return {
    getInstance() {
      if (!instance) instance = create()
      return instance
    },
  }
})()

export function createColorCalculator() {
  let globalMinY = Infinity
  let globalMaxY = -Infinity
  const colorLUT = ColorLookupTable.getInstance()

  function updateYRange(minY, maxY) {
    if (minY < globalMinY) globalMinY = minY
    if (maxY > globalMaxY) globalMaxY = maxY
  }

  function getColorByHeight(y) {
    if (globalMinY === globalMaxY) return colorLUT[128]
    const t = Math.max(0, Math.min(1, (y - globalMinY) / (globalMaxY - globalMinY)))
    return colorLUT[Math.floor(t * 255)]
  }

  function resetYRange() {
    globalMinY = Infinity
    globalMaxY = -Infinity
  }

  return { updateYRange, getColorByHeight, resetYRange }
}
