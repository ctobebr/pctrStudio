// 管线编排器：调用算法端 gpd.exe（生成每站点云/全景 + 多站拼接点云）
// gpd.exe 单命令完成全部工作，本模块负责预检、日志转发、取消与产物扫描
// 事件通过 emit 推送到渲染进程：
//   {type:'plan', steps} {type:'step', id, status, label, detail} {type:'log', level, text}
//   {type:'done', ok, error, elapsedMs, scan} {type:'cancelled'}
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { loadSettings } = require('./settings.cjs')
const { runCommand } = require('./procRunner.cjs')
const { getProject, rescanProject, touchLastRun } = require('./projectStore.cjs')
const { discoverStations } = require('./artifactScanner.cjs')

let active = null // { projectId, controller, emit }

// ===== 进度解析：gpd.exe 无结构化进度输出，按日志关键字驱动阶段状态机 =====
// 阶段顺序与权重（权重按单站各阶段实测耗时占比估算，用于整体百分比）
const PROGRESS_STAGES = ['prepare', 'match', 'adjust', 'depth', 'fusion']
const PROGRESS_WEIGHTS = { prepare: 5, match: 45, adjust: 10, depth: 25, fusion: 15 }
const PROGRESS_LABELS = {
  prepare: '数据准备',
  match: '特征提取与匹配',
  adjust: '机械平差',
  depth: '全景深度估计',
  fusion: '稠密融合着色',
  merge: '多站配准拼接',
}

function isRunning() {
  return !!active && !active.controller.signal.aborted
}

// ===== 内存预检：gpd.exe 峰值提交内存随站数近似线性增长（单站约 9GB，此后每站多保留约 1.5GB）=====
const MIN_COMMIT_GB = 12
const PER_STATION_EXTRA_GB = 1.5
const execFileAsync = promisify(execFile)

// 查询系统提交内存（上限/余量，GB）。走 WMI 不受系统区域语言影响；查询失败返回 null（预检降级为告警）
async function queryCommitMemoryGB() {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_OperatingSystem | ForEach-Object { "{0},{1}" -f $_.TotalVirtualMemorySize, $_.FreeVirtualMemory }',
      ],
      { timeout: 15000, windowsHide: true }
    )
    const [totalKB, freeKB] = String(stdout).trim().split(',').map((v) => parseInt(v, 10))
    if (!Number.isFinite(totalKB) || !Number.isFinite(freeKB)) return null
    return { totalGB: totalKB / 1048576, freeGB: freeKB / 1048576 }
  } catch {
    return null
  }
}

async function runPipeline({ projectId, mode }, emit) {
  if (active) throw new Error('已有管线在运行中，请先取消或等待完成')

  const settings = loadSettings()
  const emitLog = (text, level = 'info') => emit({ type: 'log', level, text })

  // ===== 预检（同步失败直接抛错，由调用方 toast）=====
  if (!settings.gpdExePath) throw new Error('未配置算法程序路径，请在「设置」中选择 gpd.exe')
  if (!fs.existsSync(settings.gpdExePath)) {
    throw new Error(`算法程序不存在: ${settings.gpdExePath}，请在「设置」中重新选择`)
  }
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  if (!fs.existsSync(project.rootPath)) {
    throw new Error(`项目数据目录不存在: ${project.rootPath}（可能已被移动或删除）`)
  }

  const controller = new AbortController()
  active = { projectId, controller, emit }
  const t0 = Date.now()
  let ok = false
  let error = null
  let scan = null

  try {
    const steps = [
      { id: 'prepare', label: '预检' },
      { id: 'gpd', label: '算法执行（gpd.exe）' },
      { id: 'rescan', label: '产物扫描' },
    ]
    emit({ type: 'plan', steps })

    // ===== 运行进度状态机 =====
    const effMode = ['default', 'panorama', 'single'].includes(mode) ? mode : 'default'
    const progressState = { stationIndex: 0, stationCount: 0, stage: 'prepare' }
    let lastProgressSig = ''
    const emitProgress = (forcePercent) => {
      const { stationIndex, stationCount, stage } = progressState
      if (!stationCount) return
      // default 多站时为末尾多站配准拼接预留权重；panorama 无点云、单站无需配准
      const mergeReserve = effMode === 'panorama' || stationCount <= 1 ? 0 : 10
      const perStation = (100 - mergeReserve) / stationCount
      let percent
      if (forcePercent != null) {
        percent = forcePercent
      } else if (stage === 'merge') {
        percent = 100 - mergeReserve + mergeReserve * 0.5
      } else {
        const idx = PROGRESS_STAGES.indexOf(stage)
        const cumBefore = PROGRESS_STAGES.slice(0, Math.max(0, idx)).reduce((s, k) => s + PROGRESS_WEIGHTS[k], 0)
        percent = (stationIndex - 1) * perStation + ((cumBefore + (PROGRESS_WEIGHTS[stage] || 0) * 0.6) / 100) * perStation
      }
      percent = Math.round(Math.max(0, Math.min(forcePercent != null ? 100 : 99, percent)))
      const sig = `${stage}|${percent}`
      if (sig === lastProgressSig) return
      lastProgressSig = sig
      emit({
        type: 'progress',
        stationIndex,
        stationCount,
        stage,
        stageLabel: PROGRESS_LABELS[stage] || stage,
        percent,
      })
    }
    const updateProgressFromLine = (line) => {
      const text = line.trim()
      const mStation = /^Station (\d+)\/(\d+):/.exec(text)
      if (mStation) {
        progressState.stationIndex = parseInt(mStation[1], 10)
        progressState.stationCount = parseInt(mStation[2], 10)
        progressState.stage = 'prepare'
      } else if (/^(Extracting and matching|Prepared:)/.test(text)) {
        progressState.stage = 'match'
      } else if (/^Running Ceres/.test(text)) {
        progressState.stage = 'adjust'
      } else if (/^DepthMaster/.test(text)) {
        progressState.stage = 'depth'
      } else if (/^Cloud coverage margin/.test(text)) {
        progressState.stage = 'fusion'
      } else if (/final\.ply/i.test(text)) {
        progressState.stage = 'merge'
      } else if (/^Timing \[project\]/.test(text)) {
        emitProgress(100)
        return
      } else {
        return
      }
      emitProgress()
    }

    // ===== 预检 =====
    emit({ type: 'step', id: 'prepare', status: 'running', label: '预检' })
    emitLog(`项目: ${project.name}`)
    emitLog(`数据根: ${project.rootPath}`)
    emitLog(`算法: ${settings.gpdExePath}`)

    // 输入预检：gpd 要求项目根目录必须提供设备标定参数文件，缺失时提前给出明确提示
    if (!fs.existsSync(path.join(project.rootPath, 'calib_params.txt'))) {
      const msg = '项目根目录缺少 calib_params.txt（设备标定参数文件）。请将设备标定文件放入项目数据目录后重试。'
      emit({ type: 'step', id: 'prepare', status: 'error', label: '预检', detail: msg })
      throw new Error(msg)
    }

    // 提交内存预检：余量不足时提前阻断，避免算法运行到中途 OOM 崩溃
    const stationCount = discoverStations(project.rootPath).length
    const needGB = Math.ceil(MIN_COMMIT_GB + PER_STATION_EXTRA_GB * Math.max(0, stationCount - 1))
    const mem = await queryCommitMemoryGB()
    if (mem) {
      emitLog(`内存预检: 提交余量 ${mem.freeGB.toFixed(1)}GB / 上限 ${mem.totalGB.toFixed(1)}GB，检测到 ${stationCount} 站，预计需 ≥ ${needGB}GB`)
      if (mem.freeGB < needGB) {
        const msg =
          `系统提交内存余量不足：当前可用 ${mem.freeGB.toFixed(1)}GB，本次运行（${stationCount} 站）预计需要至少 ${needGB}GB。` +
          '请先关闭占用内存较大的程序（如浏览器、IDE），或调大虚拟内存（页面文件）后重试。'
        emit({ type: 'step', id: 'prepare', status: 'error', label: '预检', detail: msg })
        throw new Error(msg)
      }
    } else {
      emitLog('无法读取系统提交内存，跳过内存预检', 'warn')
    }
    emit({ type: 'step', id: 'prepare', status: 'success', label: '预检' })

    // ===== gpd.exe =====
    emit({ type: 'step', id: 'gpd', status: 'running', label: '算法执行（gpd.exe）' })
    // 用法：gpd PROJECT [--mode default|panorama|single]；default 省略
    const args = [project.rootPath]
    if (effMode !== 'default') args.push('--mode', effMode)
    emitLog(`模式: ${effMode}`)
    emitLog(`命令: "${settings.gpdExePath}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`)
    try {
      await runCommand(settings.gpdExePath, args, {
        // gpd 可能按自身所在目录定位资源，cwd 设为 exe 目录最稳妥
        cwd: path.dirname(settings.gpdExePath),
        onStdout: (line) => {
          emitLog(line)
          updateProgressFromLine(line)
        },
        onStderr: (line) => emitLog(line, 'warn'),
        signal: controller.signal,
      })
      emit({ type: 'step', id: 'gpd', status: 'success', label: '算法执行（gpd.exe）' })
    } catch (err) {
      if (controller.signal.aborted) throw err
      emit({ type: 'step', id: 'gpd', status: 'error', label: '算法执行（gpd.exe）', detail: err.message })
      throw new Error(`算法执行失败: ${err.message}`)
    }

    // ===== 产物扫描 =====
    emit({ type: 'step', id: 'rescan', status: 'running', label: '产物扫描' })
    touchLastRun(projectId)
    const updated = rescanProject(projectId)
    scan = updated.scan
    const cloudStations = scan.stations.filter((s) => s.cloud).length
    const panoStations = scan.stations.filter((s) => s.panoramas.length > 0).length
    emitLog(`扫描完成: ${cloudStations}/${scan.stations.length} 站有点云产物，${panoStations}/${scan.stations.length} 站有全景照片，拼接点云 ${scan.mergedClouds.length} 份`)
    if (scan.stations.length > 0 && cloudStations === 0 && scan.mergedClouds.length === 0) {
      emitLog('未发现任何产物：若算法输出命名有变，请检查扫描规则（electron/services/artifactScanner.cjs RULES）', 'warn')
    }
    emit({ type: 'step', id: 'rescan', status: 'success', label: '产物扫描' })

    ok = true
  } catch (err) {
    error = err.message
  } finally {
    const elapsedMs = Date.now() - t0
    if (controller.signal.aborted) {
      emit({ type: 'cancelled' })
    } else {
      emit({ type: 'done', ok, error, elapsedMs, scan })
    }
    active = null
  }
}

function cancelPipeline() {
  if (active) {
    active.controller.abort()
    return true
  }
  return false
}

module.exports = { runPipeline, cancelPipeline, isRunning }
