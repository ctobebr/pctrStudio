/**
 * 渲染核心（从手机端 rendererCore.js 移植，桌面适配）
 * - 去掉 vant toast / logger 依赖
 * - 新增 addPointsFromArrays：批量写入 Float32Array（避免百万级中间对象）
 * - 新增 fitCameraToBounds：按包围盒自适应俯视相机（手机端为固定 80m 高度）
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper'

export function createRendererCore({ container, config, bufferManager, colorCalculator }) {
  let scene = null
  let camera = null
  let renderer = null
  let controls = null
  let pointCloud = null
  let pointsMaterial = null
  let gridHelper = null
  let viewHelper = null
  let animationId = null
  let currentPointCount = 0

  let lastFrameTime = 0
  let lastAnimateTime = 0
  let targetFps = config.targetFps
  let frameInterval = 1000 / targetFps
  let needsRender = true
  let onError = () => {}

  function init() {
    const pixelRatio = Math.min(window.devicePixelRatio, config.pixelRatioMax)

    scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d1117)

    camera = new THREE.PerspectiveCamera(
      config.cameraFov,
      Math.max(container.clientWidth / Math.max(container.clientHeight, 1), 0.1),
      0.1,
      2000,
    )
    camera.position.set(0, 80, 0.001)
    camera.lookAt(0, 0, 0)

    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    pointsMaterial = new THREE.PointsMaterial({
      size: config.pointSize,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: false,
      opacity: 1.0,
    })

    const geometry = bufferManager.getGeometry()
    pointCloud = new THREE.Points(geometry, pointsMaterial)
    pointCloud.frustumCulled = false

    gridHelper = new THREE.GridHelper(40, 20, 0x30363d, 0x21262d)
    scene.add(gridHelper)

    // 角落导航轴（ViewHelper HUD）：以独立视口叠加渲染在右下角，不进主场景深度、
    // 不受点云遮挡与细线锯齿影响——替代原场景内 AxesHelper（1px 细线在
    // antialias:false + 百万点深度遮挡下会持续闪烁）
    renderer.autoClear = false
    viewHelper = new ViewHelper(camera, renderer.domElement)
    viewHelper.setLabels('X', 'Y', 'Z')

    // 命中检测必须先于 OrbitControls 注册：命中轴球时用 stopImmediatePropagation
    // 拦下事件，避免同一拖拽同时触发视角旋转
    renderer.domElement.addEventListener('pointerdown', onViewHelperPointerDown)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controls.screenSpacePanning = true
    controls.enableZoom = true
    controls.enablePan = true
    controls.minDistance = 0.5
    controls.maxDistance = 500
    controls.maxPolarAngle = Math.PI / 2
    controls.addEventListener('change', () => {
      markNeedsRender()
    })

    // 共享引用：点击轴球切换视角时，以当前轨道目标点为轴心
    viewHelper.center = controls.target

    animate()
  }

  function onViewHelperPointerDown(event) {
    if (!viewHelper || event.button !== 0) return
    if (viewHelper.handleClick(event)) {
      event.stopImmediatePropagation()
      markNeedsRender()
    }
  }

  function addPoints(newPoints) {
    if (!Array.isArray(newPoints) || newPoints.length === 0) return
    if (!isWebGLContextValid()) return

    if (currentPointCount === 0 && !scene.children.includes(pointCloud)) {
      scene.add(pointCloud)
    }
    if (currentPointCount + newPoints.length > config.maxPoints) {
      console.warn(`[RendererCore] 点云数量已达上限 ${config.maxPoints} 点`)
      return
    }
    bufferManager.ensureCapacity(newPoints.length, currentPointCount)

    let minY = Infinity
    let maxY = -Infinity
    for (const p of newPoints) {
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    colorCalculator.updateYRange(minY, maxY)

    const geometry = bufferManager.getGeometry()
    const posArr = geometry.attributes.position.array
    const colArr = geometry.attributes.color.array
    let offset = currentPointCount * 3

    for (let i = 0; i < newPoints.length; i++) {
      const p = newPoints[i]
      posArr[offset] = p.x
      posArr[offset + 1] = p.y
      posArr[offset + 2] = p.z
      if (p.r !== undefined && p.g !== undefined && p.b !== undefined) {
        colArr[offset] = p.r
        colArr[offset + 1] = p.g
        colArr[offset + 2] = p.b
      } else {
        const color = colorCalculator.getColorByHeight(p.y)
        colArr[offset] = color.r
        colArr[offset + 1] = color.g
        colArr[offset + 2] = color.b
      }
      offset += 3
    }

    currentPointCount += newPoints.length
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.color.needsUpdate = true
    bufferManager.updateDrawRange(currentPointCount)
    markNeedsRender()
  }

  /**
   * 批量写入展平的 xyz Float32Array（长度 = count*3）
   * @param {Float32Array|null} colors 顶点色（长度 = count*3，0-1）；为空时按高度着色
   */
  function addPointsFromArrays(xyz, count, colors = null) {
    if (!count || !isWebGLContextValid()) return 0

    if (currentPointCount === 0 && !scene.children.includes(pointCloud)) {
      scene.add(pointCloud)
    }
    const accepted = Math.min(count, config.maxPoints - currentPointCount)
    if (accepted <= 0) {
      console.warn(`[RendererCore] 点云数量已达上限 ${config.maxPoints} 点`)
      return 0
    }
    bufferManager.ensureCapacity(accepted, currentPointCount)

    if (!colors) {
      // 高度着色需要先求 y 范围；顶点色模式无需
      let minY = Infinity
      let maxY = -Infinity
      for (let i = 0; i < accepted; i++) {
        const y = xyz[i * 3 + 1]
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      colorCalculator.updateYRange(minY, maxY)
    }

    const geometry = bufferManager.getGeometry()
    const posArr = geometry.attributes.position.array
    const colArr = geometry.attributes.color.array
    let offset = currentPointCount * 3

    for (let i = 0; i < accepted; i++) {
      posArr[offset] = xyz[i * 3]
      posArr[offset + 1] = xyz[i * 3 + 1]
      posArr[offset + 2] = xyz[i * 3 + 2]
      if (colors) {
        colArr[offset] = colors[i * 3]
        colArr[offset + 1] = colors[i * 3 + 1]
        colArr[offset + 2] = colors[i * 3 + 2]
      } else {
        const color = colorCalculator.getColorByHeight(xyz[i * 3 + 1])
        colArr[offset] = color.r
        colArr[offset + 1] = color.g
        colArr[offset + 2] = color.b
      }
      offset += 3
    }

    currentPointCount += accepted
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.color.needsUpdate = true
    bufferManager.updateDrawRange(currentPointCount)
    markNeedsRender()
    return accepted
  }

  /**
   * 按包围盒自适应相机（俯视）与网格位置
   */
  function fitCameraToBounds(bounds) {
    if (!camera || !bounds) return
    const sizeX = Math.max(bounds.maxX - bounds.minX, 0.1)
    const sizeZ = Math.max(bounds.maxZ - bounds.minZ, 0.1)
    const sizeY = Math.max(bounds.maxY - bounds.minY, 0.1)
    const cx = (bounds.minX + bounds.maxX) / 2
    const cy = (bounds.minY + bounds.maxY) / 2
    const cz = (bounds.minZ + bounds.maxZ) / 2

    const span = Math.max(sizeX, sizeZ)
    const dist = Math.max(span * 1.4, sizeY * 2, 5)

    camera.position.set(cx, cy + dist, cz + dist * 0.02)
    controls.target.set(cx, cy, cz)
    controls.minDistance = 0.5
    controls.maxDistance = dist * 5
    controls.update()

    // 网格贴着点云底部
    const gridSize = Math.max(span * 2, 10)
    scene.remove(gridHelper)
    gridHelper.geometry.dispose()
    gridHelper = new THREE.GridHelper(gridSize, 20, 0x30363d, 0x21262d)
    gridHelper.position.set(cx, bounds.minY, cz)
    scene.add(gridHelper)

    markNeedsRender()
  }

  function resetPointCloud() {
    if (scene && pointCloud && scene.children.includes(pointCloud)) {
      scene.remove(pointCloud)
    }
    currentPointCount = 0
    colorCalculator.resetYRange()
    bufferManager.reset()
    // reset() 重建了几何体，必须重新绑定到网格，否则数据写入新缓冲、渲染的仍是旧缓冲
    if (pointCloud) {
      pointCloud.geometry = bufferManager.getGeometry()
    }
    // 场景已变更，必须标记重绘；否则画布停留在上一帧，旧点云残影直到鼠标移动才消失
    markNeedsRender()
  }

  function setTargetFps(fps) {
    if (typeof fps !== 'number' || fps <= 0) return
    targetFps = fps
    frameInterval = 1000 / targetFps
  }

  function getCurrentPointCount() {
    return currentPointCount
  }

  function markNeedsRender() {
    needsRender = true
  }

  function isWebGLContextValid() {
    if (!renderer) return false
    try {
      const gl = renderer.getContext()
      return gl != null && !gl.isContextLost()
    } catch {
      return false
    }
  }

  function animate() {
    animationId = requestAnimationFrame(animate)

    const time = performance.now()
    const delta = lastAnimateTime > 0 ? (time - lastAnimateTime) / 1000 : 0
    lastAnimateTime = time
    if (time - lastFrameTime < frameInterval) return

    try {
      if (!isWebGLContextValid()) {
        if (animationId) {
          cancelAnimationFrame(animationId)
          animationId = null
        }
        return
      }
      if (controls) controls.update()
      if (viewHelper && viewHelper.animating) {
        viewHelper.update(delta)
        markNeedsRender() // 导航轴视角动画期间持续重绘，动画结束后自动停止
      }
      if (needsRender) {
        // autoClear 已关闭，手动管理：先清屏渲染主场景，再叠加角落导航轴
        renderer.clear()
        renderer.render(scene, camera)
        viewHelper.render(renderer) // 内部完成 clearDepth 与视口保存/恢复
        needsRender = false
      }
      lastFrameTime = time
    } catch (err) {
      console.error('[RendererCore] 渲染循环异常', err)
      if (animationId) {
        cancelAnimationFrame(animationId)
        animationId = null
      }
      onError(err)
    }
  }

  function onResize() {
    if (!camera || !renderer || container.clientWidth <= 0 || container.clientHeight <= 0) return
    camera.aspect = container.clientWidth / container.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(container.clientWidth, container.clientHeight)
    markNeedsRender()
  }

  function dispose() {
    if (animationId) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
    if (pointCloud) {
      pointCloud.geometry?.dispose?.()
      pointCloud = null
    }
    if (pointsMaterial) {
      pointsMaterial.dispose()
      pointsMaterial = null
    }
    if (gridHelper) {
      gridHelper.geometry.dispose()
      gridHelper = null
    }
    if (viewHelper) {
      viewHelper.dispose()
      viewHelper = null
    }
    if (controls) {
      controls.dispose()
      controls = null
    }
    if (renderer) {
      renderer.domElement.removeEventListener('pointerdown', onViewHelperPointerDown)
      renderer.dispose()
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
      renderer = null
    }
    scene = null
    camera = null
  }

  return {
    init,
    addPoints,
    addPointsFromArrays,
    resetPointCloud,
    setTargetFps,
    markNeedsRender,
    isWebGLContextValid,
    onResize,
    fitCameraToBounds,
    getCurrentPointCount,
    dispose,
    setErrorHandler(fn) {
      onError = fn || (() => {})
    },
  }
}
