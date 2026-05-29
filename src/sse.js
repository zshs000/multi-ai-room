// SSE 心跳：每 intervalMs 发一个 `: ping` 注释行（前端解析时被忽略），
// 让中间代理/防火墙不会因长时间无数据而掐断连接（如等慢模型憋首字时）。
// 返回 stop()，必须在连接结束的所有路径上调用，避免定时器泄漏或往已关闭连接写入。
export function startHeartbeat(res, intervalMs = Number(process.env.SSE_HEARTBEAT_MS) || 15000) {
  const timer = setInterval(() => {
    if (res.writableEnded) return
    try { res.write(': ping\n\n') } catch {}
  }, intervalMs)
  timer.unref?.() // 不阻止进程退出
  return () => clearInterval(timer)
}
