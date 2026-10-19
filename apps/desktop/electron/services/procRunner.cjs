// 子进程执行器：调用算法端 gpd.exe，支持取消与逐行日志
const { spawn } = require('child_process')

/**
 * 运行外部命令
 * @param {string} exe 可执行文件
 * @param {string[]} args 参数
 * @param {Object} opts
 * @param {string} opts.cwd 工作目录
 * @param {Function} opts.onStdout 每行 stdout 回调
 * @param {Function} opts.onStderr 每行 stderr 回调
 * @param {AbortSignal} opts.signal 取消信号
 * @returns {Promise<void>} 非零退出码时 reject
 */
function runCommand(exe, args, { cwd, onStdout, onStderr, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true })
    let lastErrorLine = ''

    function wire(stream, cb) {
      let buf = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        buf += chunk
        const lines = buf.split(/\r?\n/)
        buf = lines.pop()
        for (const line of lines) if (line.trim()) cb(line)
      })
      stream.on('end', () => {
        if (buf.trim()) cb(buf)
      })
    }

    wire(child.stdout, (line) => onStdout && onStdout(line))
    wire(child.stderr, (line) => {
      lastErrorLine = line
      if (onStderr) onStderr(line)
    })

    // gpd.exe 内部可能派生自己的子进程，taskkill /T 整树终止比 child.kill() 更可靠
    function killTree() {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        killer.on('error', () => {
          try {
            child.kill()
          } catch {}
        })
      } else {
        try {
          child.kill()
        } catch {}
      }
    }
    const onAbort = () => killTree()
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      if (signal && signal.aborted) {
        reject(new Error('已取消'))
      } else if (code === 0) {
        resolve()
      } else {
        reject(new Error(lastErrorLine ? `退出码 ${code}: ${lastErrorLine}` : `退出码 ${code}`))
      }
    })
  })
}

module.exports = { runCommand }
