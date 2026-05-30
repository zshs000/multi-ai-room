import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { sendJson } from './src/http.js'
import { handleApiRoute } from './src/api-routes.js'

const PORT = Number(process.env.PORT) || 3000
const PUBLIC_DIR = new URL('./public/', import.meta.url)

// ---------- 静态文件 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
async function serveStatic(res, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1)
  try {
    const content = await readFile(new URL(file, PUBLIC_DIR))
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(content)
  } catch {
    res.writeHead(404); res.end('Not Found')
  }
}

// ---------- 路由 ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const { pathname } = url
  const method = req.method

  try {
    if (await handleApiRoute(req, res, url)) return

    // 其它走静态
    return serveStatic(res, pathname)
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: e.message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`多 AI 讨论室已启动：http://localhost:${PORT}`)
})
