'use strict'

const { execFileSync } = require('child_process')
const net = require('net')
const tls = require('tls')
const { URL } = require('url')
const { HttpsProxyAgent } = require('https-proxy-agent')

let cachedProxyUrl

function normalizeProxyUrl(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const proxy = text.includes('://') ? text : `http://${text}`
  try {
    const url = new URL(proxy)
    if (!/^https?:$/.test(url.protocol)) return null
    if (!url.hostname || !url.port) return null
    return url.toString()
  } catch (_) {
    return null
  }
}

function parseWindowsProxyServer(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const parts = text.split(';').map((item) => item.trim()).filter(Boolean)
  const httpsPart = parts.find((item) => item.toLowerCase().startsWith('https='))
  const httpPart = parts.find((item) => item.toLowerCase().startsWith('http='))
  if (httpsPart) return normalizeProxyUrl(httpsPart.slice(6))
  if (httpPart) return normalizeProxyUrl(httpPart.slice(5))
  return normalizeProxyUrl(text)
}

function readWindowsProxyUrl() {
  if (process.platform !== 'win32') return null
  try {
    const output = execFileSync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v',
      'ProxyEnable'
    ], { encoding: 'utf8', timeout: 1_500 })
    if (!/\b0x1\b/i.test(output)) return null
  } catch (_) {
    return null
  }

  try {
    const output = execFileSync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v',
      'ProxyServer'
    ], { encoding: 'utf8', timeout: 1_500 })
    const match = output.match(/ProxyServer\s+REG_SZ\s+(.+)/i)
    return parseWindowsProxyServer(match?.[1] || '')
  } catch (_) {
    return null
  }
}

function resolveAlchemyHttpsProxyUrl() {
  if (cachedProxyUrl !== undefined) return cachedProxyUrl
  cachedProxyUrl = normalizeProxyUrl(process.env.OPERATOR_HTTPS_PROXY)
    || normalizeProxyUrl(process.env.HTTPS_PROXY)
    || normalizeProxyUrl(process.env.HTTP_PROXY)
    || normalizeProxyUrl(process.env.ALL_PROXY)
    || readWindowsProxyUrl()
    || null
  return cachedProxyUrl
}

class HttpConnectHttpsAgent {
  constructor(proxyUrl) {
    this.proxyUrl = new URL(proxyUrl)
  }

  addRequest(req, options) {
    const port = Number(options.port || 443)
    const host = options.hostname || options.host
    const proxyPort = Number(this.proxyUrl.port || (this.proxyUrl.protocol === 'https:' ? 443 : 80))
    const connect = this.proxyUrl.protocol === 'https:' ? tls.connect : net.connect
    const proxySocket = connect({
      host: this.proxyUrl.hostname,
      port: proxyPort,
      servername: this.proxyUrl.protocol === 'https:' ? this.proxyUrl.hostname : undefined
    })

    proxySocket.once('connect', () => {
      const auth = this.proxyUrl.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(this.proxyUrl.username)}:${decodeURIComponent(this.proxyUrl.password)}`).toString('base64')}\r\n`
        : ''
      proxySocket.write(
        `CONNECT ${host}:${port} HTTP/1.1\r\n`
        + `Host: ${host}:${port}\r\n`
        + auth
        + 'Connection: close\r\n\r\n'
      )
    })

    let header = Buffer.alloc(0)
    const onData = (chunk) => {
      header = Buffer.concat([header, chunk])
      const headerEnd = header.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      proxySocket.off('data', onData)
      const head = header.slice(0, headerEnd).toString('latin1')
      if (!/^HTTP\/1\.[01] 2\d\d\b/.test(head)) {
        proxySocket.destroy(new Error(`proxy CONNECT failed: ${head.split('\r\n')[0] || 'empty response'}`))
        return
      }
      const rest = header.slice(headerEnd + 4)
      const secureSocket = tls.connect({
        socket: proxySocket,
        servername: host
      }, () => {
        if (rest.length) secureSocket.unshift(rest)
        req.onSocket(secureSocket)
      })
      secureSocket.on('error', (error) => req.destroy(error))
    }

    proxySocket.on('data', onData)
    proxySocket.on('error', (error) => req.destroy(error))
  }
}

function createAlchemyHttpsProxyAgent() {
  const proxyUrl = resolveAlchemyHttpsProxyUrl()
  return proxyUrl ? new HttpsProxyAgent(proxyUrl) : null
}

function installEthersAlchemyProxySupport(ethers) {
  const agent = createAlchemyHttpsProxyAgent()
  if (!agent || !ethers?.FetchRequest?.createGetUrlFunc || !ethers?.FetchRequest?.registerGetUrl) {
    return false
  }
  ethers.FetchRequest.registerGetUrl(ethers.FetchRequest.createGetUrlFunc({ agent }))
  return true
}

module.exports = {
  createAlchemyHttpsProxyAgent,
  installEthersAlchemyProxySupport,
  normalizeProxyUrl,
  parseWindowsProxyServer,
  resolveAlchemyHttpsProxyUrl
}
