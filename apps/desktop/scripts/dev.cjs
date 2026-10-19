// 开发模式：启动 vite dev server，就绪后拉起 Electron 指向 dev URL
const { spawn } = require('child_process')
const http = require('http')
const path = require('path')

const root = path.resolve(__dirname, '..')
const PORT = 5173

function waitPort(port, timeoutMs = 60000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    function poll() {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`vite dev server 未在 ${timeoutMs}ms 内就绪`))
        } else {
          setTimeout(poll, 400)
        }
      })
    }
    poll()
  })
}

function shutdown(code) {
  if (viteProc) viteProc.kill()
  process.exit(code ?? 0)
}

let viteProc = null
let electronProc = null

viteProc = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], {
  cwd: root,
  stdio: 'inherit',
})
viteProc.on('exit', (code) => {
  if (electronProc) shutdown(code ?? 0)
})

waitPort(PORT)
  .then(() => {
    const electronBin = require('electron')
    electronProc = spawn(electronBin, ['.'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_START_URL: `http://127.0.0.1:${PORT}` },
    })
    electronProc.on('exit', (code) => shutdown(code ?? 0))
  })
  .catch((err) => {
    console.error('[dev]', err.message)
    shutdown(1)
  })

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
