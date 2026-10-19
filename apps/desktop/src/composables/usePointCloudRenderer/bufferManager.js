/**
 * 缓冲区管理（从手机端 bufferManager.js 移植，去掉 vant 依赖）
 */
import * as THREE from 'three'

export function createBufferManager(config) {
  let pointsGeometry = null
  let capacity = Math.min(config.initialCapacity, config.maxPoints)
  let currentPointCount = 0

  function createBuffers(cap) {
    const positions = new Float32Array(cap * 3)
    const colors = new Float32Array(cap * 3)

    pointsGeometry = new THREE.BufferGeometry()
    pointsGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    )
    pointsGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage),
    )
  }

  function ensureCapacity(additional, currentCount) {
    const needed = currentCount + additional
    if (needed <= capacity) return true

    if (needed > config.maxPoints) {
      throw new Error(`capacity exceed: 点云数量已达上限 ${config.maxPoints} 点`)
    }

    let newCap = Math.max(capacity, 1024)
    while (newCap < needed) {
      newCap = Math.floor(newCap * 1.5)
    }
    newCap = Math.min(newCap, config.maxPoints)

    const newPos = new Float32Array(newCap * 3)
    const newCol = new Float32Array(newCap * 3)
    newPos.set(pointsGeometry.attributes.position.array)
    newCol.set(pointsGeometry.attributes.color.array)

    pointsGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(newPos, 3).setUsage(THREE.DynamicDrawUsage),
    )
    pointsGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(newCol, 3).setUsage(THREE.DynamicDrawUsage),
    )

    capacity = newCap
    return true
  }

  function getGeometry() {
    return pointsGeometry
  }

  function updateDrawRange(count) {
    currentPointCount = count
    if (pointsGeometry) {
      pointsGeometry.setDrawRange(0, count)
    }
  }

  function reset() {
    if (pointsGeometry) {
      pointsGeometry.dispose()
    }
    createBuffers(Math.min(config.initialCapacity, config.maxPoints))
    currentPointCount = 0
  }

  function dispose() {
    if (pointsGeometry) {
      pointsGeometry.dispose()
      pointsGeometry = null
    }
  }

  createBuffers(capacity)

  return {
    ensureCapacity,
    getGeometry,
    updateDrawRange,
    reset,
    dispose,
    get capacity() {
      return capacity
    },
    get currentPointCount() {
      return currentPointCount
    },
  }
}
