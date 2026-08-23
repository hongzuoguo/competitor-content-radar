const { createHash } = require('node:crypto')
const { isAbsolute } = require('node:path')

const SESSION_COOKIE_NAMES = new Set([
  'sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt', 'uid_tt', 'uid_tt_ss'
])

function fingerprintCookieRows(rows) {
  const normalized = rows.map((row) => ({
    host: String(row.host_key),
    name: String(row.name),
    path: String(row.path),
    expires: String(row.expires_utc),
    secure: Number(row.is_secure),
    httpOnly: Number(row.is_httponly),
    valueHash: createHash('sha256').update(row.encrypted_value).digest('hex')
  }))
  const session = normalized.filter((row) => SESSION_COOKIE_NAMES.has(row.name))
  return {
    cookieCount: normalized.length,
    sessionCount: session.length,
    fingerprint: createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
    session: session.map((row) => ({
      host: row.host,
      name: row.name,
      expires: row.expires,
      valueHashPrefix: row.valueHash.slice(0, 12)
    }))
  }
}

function fingerprintPlainCookieRows(rows) {
  const normalized = rows
    .filter((row) => /(?:douyin|snssdk|bytedance|amemv)/i.test(String(row.domain)))
    .map((row) => ({
      host: String(row.domain),
      name: String(row.name),
      path: String(row.path),
      expires: String(row.expires),
      secure: Boolean(row.secure),
      httpOnly: Boolean(row.httpOnly),
      valueHash: createHash('sha256').update(String(row.value)).digest('hex')
    }))
    .sort((left, right) => `${left.host}\0${left.name}\0${left.path}`.localeCompare(`${right.host}\0${right.name}\0${right.path}`))
  const session = normalized.filter((row) => SESSION_COOKIE_NAMES.has(row.name))
  return {
    cookieCount: normalized.length,
    sessionCount: session.length,
    fingerprint: createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
    session: session.map((row) => ({
      host: row.host,
      name: row.name,
      expires: row.expires,
      valueHashPrefix: row.valueHash.slice(0, 12)
    }))
  }
}

async function snapshotCdpCookies(versionUrl) {
  const response = await fetch(versionUrl)
  if (!response.ok) throw new Error(`CDP_VERSION_HTTP_${response.status}`)
  const version = await response.json()
  if (typeof version.webSocketDebuggerUrl !== 'string') throw new Error('CDP_WEBSOCKET_URL_MISSING')
  const cookies = await new Promise((resolve, reject) => {
    const socket = new WebSocket(version.webSocketDebuggerUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('CDP_COOKIE_TIMEOUT'))
    }, 5000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' })))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error) reject(new Error('CDP_COOKIE_REQUEST_FAILED'))
      else resolve(message.result?.cookies ?? [])
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('CDP_WEBSOCKET_FAILED'))
    })
  })
  return fingerprintPlainCookieRows(cookies)
}

function summarizeDouyinResponse(url, status, body) {
  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    payload = null
  }
  const notLogin = payload && typeof payload.not_login_module === 'object'
    ? payload.not_login_module
    : null
  const works = payload && Array.isArray(payload.aweme_list) ? payload.aweme_list : null
  return {
    urlPath: new URL(url).pathname.slice(0, 300),
    httpStatus: Number.isInteger(status) ? status : null,
    bodyBytes: Buffer.byteLength(body),
    statusCode: payload && Object.hasOwn(payload, 'status_code') ? payload.status_code : null,
    statusMessage: payload && typeof payload.status_msg === 'string' ? payload.status_msg.slice(0, 300) : null,
    loginGuide: Boolean(notLogin && notLogin.guide_login_tip_exist === true),
    awemeCount: works ? works.length : null,
    keys: payload && typeof payload === 'object' ? Object.keys(payload).sort().slice(0, 40) : []
  }
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  const listeners = new Set()
  let nextId = 1
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP_WEBSOCKET_FAILED')), { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error('CDP_COMMAND_FAILED'))
      else resolve(message.result ?? {})
      return
    }
    for (const listener of listeners) listener(message)
  })
  return {
    request(method, params = {}) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      socket.close()
    }
  }
}

async function probeHeadedDouyinAccess(versionUrl, targetUrl) {
  const listUrl = new URL('/json/list', versionUrl).toString()
  const targetsResponse = await fetch(listUrl)
  if (!targetsResponse.ok) throw new Error(`CDP_TARGETS_HTTP_${targetsResponse.status}`)
  const targets = await targetsResponse.json()
  const target = targets.find((item) => item.type === 'page' && item.url.includes('douyin.com'))
    || targets.find((item) => item.type === 'page')
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP_PAGE_TARGET_MISSING')
  const client = await connectCdp(target.webSocketDebuggerUrl)
  try {
    await client.request('Network.enable')
    await client.request('Network.setCacheDisabled', { cacheDisabled: true })
    await client.request('Network.setBypassServiceWorker', { bypass: true })
    await client.request('Page.enable')
    const requests = new Map()
    const matched = new Map()
    const summary = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP_DOUYIN_RESPONSE_TIMEOUT')), 20_000)
      const stop = client.onEvent((message) => {
        if (message.method === 'Network.requestWillBeSent') {
          requests.set(message.params?.requestId, message.params?.request?.method)
          return
        }
        if (message.method === 'Network.responseReceived') {
          const response = message.params?.response
          if (response && requests.get(message.params.requestId) === 'GET'
            && /\/aweme\/v1\/web\/aweme\/(?:post|detail)\//.test(response.url)) {
            matched.set(message.params.requestId, { url: response.url, status: response.status })
          }
          return
        }
        if (message.method !== 'Network.loadingFinished') return
        const metadata = matched.get(message.params?.requestId)
        if (!metadata) return
        matched.delete(message.params.requestId)
        if (!message.params?.encodedDataLength) return
        client.request('Network.getResponseBody', { requestId: message.params.requestId })
          .then((result) => {
            clearTimeout(timer)
            stop()
            const body = result.base64Encoded
              ? Buffer.from(result.body, 'base64').toString('utf8')
              : String(result.body ?? '')
            resolve(summarizeDouyinResponse(metadata.url, metadata.status, body))
          })
          .catch(reject)
      })
      client.request('Page.navigate', { url: targetUrl }).catch(reject)
    })
    return summary
  } finally {
    client.close()
  }
}

async function closeCdpBrowser(versionUrl) {
  const response = await fetch(versionUrl)
  if (!response.ok) throw new Error(`CDP_VERSION_HTTP_${response.status}`)
  const version = await response.json()
  if (typeof version.webSocketDebuggerUrl !== 'string') throw new Error('CDP_WEBSOCKET_URL_MISSING')
  const client = await connectCdp(version.webSocketDebuggerUrl)
  await Promise.race([
    client.request('Browser.close').catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ])
}

function snapshotCookieDatabase(databasePath) {
  if (!isAbsolute(databasePath)) throw new Error('COOKIE_DATABASE_PATH_MUST_BE_ABSOLUTE')
  const Database = require('better-sqlite3')
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  database.defaultSafeIntegers(true)
  try {
    const rows = database.prepare(`
      SELECT host_key, name, path, expires_utc, is_secure, is_httponly, encrypted_value
      FROM cookies
      WHERE host_key LIKE '%douyin%'
         OR host_key LIKE '%snssdk%'
         OR host_key LIKE '%bytedance%'
         OR host_key LIKE '%amemv%'
      ORDER BY host_key, name, path
    `).all()
    return fingerprintCookieRows(rows)
  } finally {
    database.close()
  }
}

module.exports = {
  fingerprintCookieRows,
  fingerprintPlainCookieRows,
  snapshotCookieDatabase,
  snapshotCdpCookies,
  summarizeDouyinResponse,
  probeHeadedDouyinAccess,
  closeCdpBrowser
}

if (require.main === module) {
  const [mode, value, targetUrl] = process.argv.slice(2)
  const run = mode === '--cdp'
    ? snapshotCdpCookies(value || 'http://127.0.0.1:9333/json/version')
    : mode === '--probe-cdp'
      ? probeHeadedDouyinAccess(value || 'http://127.0.0.1:9333/json/version', targetUrl)
      : mode === '--close-cdp'
        ? closeCdpBrowser(value || 'http://127.0.0.1:9333/json/version').then(() => ({ closed: true }))
      : Promise.resolve(snapshotCookieDatabase(mode))
  run.then((snapshot) => process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'COOKIE_DIAGNOSTIC_FAILED'}\n`)
      process.exitCode = 1
    })
}
