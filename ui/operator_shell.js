function withNoCache(url) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}_=${Date.now()}`
}

const EXIT_SWAP_CLOSE_ENABLED = true
const EXIT_SWAP_DISABLED_TITLE = 'Close + Swap requires live exit-swap guards, a healthy route, and canary autoswap allowance.'
const SEARCH_POOLS_TIMEOUT_MS = 70_000
const PARTIAL_MARKET_AUTO_REFRESH_DELAY_MS = 2_500
const PARTIAL_MARKET_AUTO_REFRESH_MAX_ATTEMPTS = 4
const SETUP_EXECUTABLE_PREVIEW_TIMEOUT_MS = 8_000
const SETUP_EXECUTABLE_PREVIEW_DEBOUNCE_MS = 400
const DESKTOP_UPDATE_BACKGROUND_CHECK_INTERVAL_MS = 60 * 60 * 1000
const COPY_LINK_MENU_LABEL = 'Копировать'

function installDesktopUpdateControls() {
  const button = document.getElementById('desktop-update-button')
  const label = document.getElementById('desktop-update-label')
  const detail = document.getElementById('desktop-update-detail')
  const progress = document.getElementById('desktop-update-progress')
  const progressBar = progress?.querySelector('.desktop-update-progress-bar')
  if (!button || !label || !detail || !progressBar || !window.desktopUpdater) {
    if (button) button.classList.add('hidden')
    return
  }

  const shouldShowUpdateCallout = (state, hasUpdate) => (
    state === 'available'
    || state === 'downloading'
    || state === 'installing'
    || (state === 'error' && hasUpdate)
  )

  const applyStatus = (status = {}) => {
    const state = status.state || 'idle'
    const isError = status.state === 'error'
    const pct = Math.max(0, Math.min(100, Number(status.progressPct || 0)))
    const version = status.availableVersion || ''
    if (status.availableVersion) {
      button.dataset.availableVersion = status.availableVersion
    } else if (state !== 'downloading' && state !== 'installing') {
      delete button.dataset.availableVersion
    }
    const hasUpdate = Boolean(status.availableVersion || button.dataset.availableVersion)
    button.dataset.hasUpdate = hasUpdate ? '1' : '0'
    button.dataset.updateState = state
    button.classList.remove('hidden')
    button.classList.toggle('desktop-update-button-hidden', !shouldShowUpdateCallout(state, hasUpdate))
    button.disabled = state === 'downloading' || state === 'installing'
    const visiblePct = state === 'installing'
      ? 100
      : state === 'downloading'
        ? Math.max(4, pct)
        : 0
    progressBar.style.width = `${visiblePct}%`

    if (state === 'downloading') {
      label.textContent = 'Downloading'
      detail.textContent = `${pct || 1}%`
    } else if (state === 'installing') {
      label.textContent = 'Installing'
      detail.textContent = 'Restarting'
    } else if (state === 'checking') {
      label.textContent = 'Checking'
      detail.textContent = 'GitHub'
    } else if (isError) {
      label.textContent = 'Retry'
      detail.textContent = 'Failed'
      button.disabled = false
    } else if (version) {
      label.textContent = 'Update'
      detail.textContent = `v${version}`
    } else if (state === 'up-to-date') {
      label.textContent = 'Check'
      detail.textContent = 'Up to date'
    } else {
      label.textContent = 'Check'
      detail.textContent = 'Ready'
    }
    const title = status.message || (version ? `Install update ${version}` : 'Check for desktop updates')
    button.title = title
    button.setAttribute('aria-label', title)
  }

  window.desktopUpdater.status().then(applyStatus).catch(() => {
    button.classList.add('hidden')
  })
  window.desktopUpdater.check().then(applyStatus).catch(() => {
    button.classList.add('desktop-update-button-hidden')
  })
  setInterval(() => {
    window.desktopUpdater.check().then(applyStatus).catch(() => {
      const hasUpdate = button.dataset.hasUpdate === '1'
      if (!hasUpdate) button.classList.add('desktop-update-button-hidden')
    })
  }, DESKTOP_UPDATE_BACKGROUND_CHECK_INTERVAL_MS)
  window.desktopUpdater.onStatus(applyStatus)

  button.addEventListener('click', async () => {
    if (button.disabled) return
    button.disabled = true
    const hasUpdate = button.dataset.hasUpdate === '1'
    if (!hasUpdate) {
      button.dataset.updateState = 'checking'
      label.textContent = 'Checking'
      detail.textContent = 'GitHub'
      progressBar.style.width = '0%'
      try {
        const status = await window.desktopUpdater.check()
        applyStatus(status)
      } catch (error) {
        applyStatus({
          state: 'error',
          message: error?.message || 'Update check failed',
          progressPct: 0
        })
      }
      return
    }
    button.dataset.updateState = 'downloading'
    label.textContent = 'Downloading'
    detail.textContent = '1%'
    progressBar.style.width = '4%'
    try {
      const status = await window.desktopUpdater.install()
      applyStatus(status)
    } catch (error) {
      applyStatus({
        state: 'error',
        availableVersion: button.dataset.availableVersion,
        message: error?.message || 'Update failed',
        progressPct: 0
      })
    }
  })
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 0)
  const controller = timeoutMs > 0 ? new AbortController() : null
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null
  let response
  try {
    response = await fetch(withNoCache(url), {
    cache: 'no-store',
    signal: controller?.signal,
    headers: {
      'cache-control': 'no-cache',
      pragma: 'no-cache'
    }
  })
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (options.signal && timeoutMs <= 0) {
        throw error
      }
      throw new Error(`Request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
  const payload = await response.json()

  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`)
  }

  return payload
}

async function postJson(url, payload, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 0)
  const controller = timeoutMs > 0 ? new AbortController() : null
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      signal: options.signal || controller?.signal,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-cache',
        pragma: 'no-cache'
      },
      body: JSON.stringify(payload)
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (options.signal && timeoutMs <= 0) {
        throw error
      }
      throw new Error(`Request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`)
  }

  return data
}

function stopActionProgressPolling() {
  window.__actionProgressPollGeneration = (window.__actionProgressPollGeneration || 0) + 1
  if (window.__actionProgressPollTimer) {
    clearInterval(window.__actionProgressPollTimer)
    window.__actionProgressPollTimer = null
  }
}

function startActionProgressPolling(actionId, title, totalFallback = 1) {
  stopActionProgressPolling()
  if (!actionId) {
    return
  }
  const pollGeneration = window.__actionProgressPollGeneration || 0

  const poll = async () => {
    try {
      const progress = await fetchJson(`/api/action-progress?actionId=${encodeURIComponent(actionId)}`)
      if (pollGeneration !== (window.__actionProgressPollGeneration || 0)) {
        return
      }
      if (!progress?.active) {
        return
      }

      const total = Math.max(1, Number(progress.total || totalFallback || 1))
      const current = Math.max(0, Math.min(total, Number(progress.current || 0)))
      showActionOverlay({
        title,
        total,
        current,
        step: progress.stage === 'approval'
          ? 'Approval in progress'
          : progress.stage === 'minting'
            ? 'Opening positions'
            : progress.stage === 'sync'
              ? 'Syncing operator state'
              : 'Execution in progress',
        progressLabel: `${current}/${total}`,
        message: progress.message || 'Processing execution request',
        indeterminate: false
      })
    } catch (_) {
    }
  }

  poll()
  window.__actionProgressPollTimer = setInterval(poll, 400)
}

function stopLiveRunnerPolling() {
  if (liveRunnerPollTimer) {
    clearInterval(liveRunnerPollTimer)
    liveRunnerPollTimer = null
  }
}

function mapLiveRunnerStep(run) {
  const stage = String(run?.stage || '')
  if (stage === 'queued') {
    return 'Queued on server'
  }
  if (stage === 'prepare' || stage === 'preflight') {
    return 'Preflight and live gate'
  }
  if (stage.startsWith('open')) {
    return 'Opening live position'
  }
  if (stage === 'close') {
    return 'Closing live position'
  }
  if (stage === 'reconcile') {
    return 'Reconciling operator state'
  }
  if (stage === 'completed') {
    return 'Scenario complete'
  }
  if (stage === 'aborted') {
    return 'Scenario aborted'
  }
  if (stage === 'error') {
    return 'Scenario failed'
  }

  return 'Live scenario in progress'
}

function applyLiveRunnerStatus(payload) {
  state.liveRunner = {
    activeRunId: payload?.activeRunId || null,
    activeRun: payload?.activeRun || null,
    targetRun: payload?.targetRun || null,
    recentRuns: payload?.recentRuns || [],
    busy: false
  }
}

function isLiveRunnerActive(payload) {
  const run = payload?.activeRun || payload?.targetRun
  const status = String(run?.status || '').toLowerCase()
  return Boolean(payload?.activeRunId || ['queued', 'preflight', 'opening', 'opened', 'closing', 'autoswapping', 'reconciling'].includes(status))
}

async function loadLiveRunnerStatus(runId = null) {
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : ''
  const payload = await fetchJson(`/api/live-test-runner${query}`)
  applyLiveRunnerStatus(payload)
  const hasActiveRunner = isLiveRunnerActive(payload)
  if (hasActiveRunner && state.activeView === 'create' && !hasActiveTextSelection() && !isInteractingWithSetupControls()) {
    renderPositionSetupPanel(getSelectedCardFromState())
  }
  return payload
}

function startLiveRunnerPolling(runId, title) {
  stopLiveRunnerPolling()

  const poll = async () => {
    try {
      const payload = await loadLiveRunnerStatus(runId)
      const run = payload.targetRun || payload.activeRun
      if (!run) {
        stopLiveRunnerPolling()
        return
      }

      showActionOverlay({
        title,
        total: Math.max(1, Number(run.total || 1)),
        current: Math.max(0, Math.min(Number(run.total || 1), Number(run.current || 0))),
        step: mapLiveRunnerStep(run),
        progressLabel: `${Math.max(0, Number(run.current || 0))}/${Math.max(1, Number(run.total || 1))}`,
        message: run.message || 'Live runner is processing the scenario',
        indeterminate: false
      })

      if (['completed', 'failed', 'aborted'].includes(String(run.status || ''))) {
        stopLiveRunnerPolling()
        if (run.status === 'completed' && run.result) {
          state.setupExecutionResult = {
            kind: 'live-scenario',
            ...run.result
          }
          await loadSnapshot().catch(() => {})
          hideActionOverlay(240)
        } else if (run.status === 'failed' || run.status === 'aborted') {
          state.setupExecutionResult = {
            kind: 'error',
            error: run.error || run.message || `Live scenario ${run.status}`
          }
          hideActionOverlay(0)
        }
        renderPositionSetupPanel(getSelectedCardFromState())
      }
    } catch (_) {
    }
  }

  poll()
  liveRunnerPollTimer = setInterval(poll, 1000)
}

const TOKEN_DECIMALS = {
  usdt: 18,
  usdc: 18,
  wbnb: 18,
  bnb: 18
}

function buildTrustWalletSmartchainLogoUrl(address) {
  const value = String(address || '').trim()
  return /^0x[a-fA-F0-9]{40}$/.test(value)
    ? `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/${value}/logo.png`
    : ''
}

const UI_SUPPORTED_FORK_DEX_IDS = new Set(['pancakeswap', 'uniswap'])
const SWAP_DEX_LOGOS = Object.freeze({
  pancake: {
    label: 'PancakeSwap',
    logoUrl: buildTrustWalletSmartchainLogoUrl('0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82')
  },
  uniswap: {
    label: 'Uniswap',
    logoUrl: 'https://app.uniswap.org/images/192x192_App_Icon.png'
  }
})
const UI_COMMON_TOKENS = Object.freeze({
  BNB: {
    symbol: 'BNB',
    name: 'BNB',
    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    decimals: 18,
    logoUrl: buildTrustWalletSmartchainLogoUrl('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'),
    native: true,
    wrappedAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
  },
  WBNB: {
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    decimals: 18,
    logoUrl: buildTrustWalletSmartchainLogoUrl('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
    logoUrl: buildTrustWalletSmartchainLogoUrl('0x55d398326f99059fF775485246999027B3197955')
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    decimals: 18,
    logoUrl: buildTrustWalletSmartchainLogoUrl('0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d')
  }
})
const DEFAULT_SWAP_SETTINGS = Object.freeze({
  slippagePct: 0.5,
  slippageMode: 'auto',
  autoRefreshEnabled: true,
  refreshCadenceMs: 5000,
  quickTokenSymbols: ['USDT', 'BNB', 'USDC']
})
const SWAP_RECENT_TOKEN_LIMIT = 12
const SWAP_MAX_SLIPPAGE_PCT = 5
const SWAP_QUOTE_DEBOUNCE_MS = 100
const SWAP_PREVIEW_TIMEOUT_MS = 22000
const SWAP_TOKEN_SEARCH_DEBOUNCE_MS = 160
const SWAP_AUTO_REFRESH_BUFFER_MS = 2500
const SWAP_QUOTE_STALE_FALLBACK_MS = 60000
const SWAP_DUPLICATE_GUARD_MS = 120000
const MANAGE_OPEN_REFRESH_INTERVAL_MS = 3000
const MANAGE_OPEN_REFRESH_QUERY = '?refreshOpen=1'
const BACKGROUND_SELECTED_PRICE_REFRESH_INTERVAL_MS = 5000
const FILTER_PRESETS_STORAGE_KEY = 'bnb.operator.poolSearch.filterPresets.v1'
const FILTER_PRESET_LIMIT = 5
const TELEGRAM_CHANNEL_URL = 'https://t.me/'

const state = {
  activeView: 'pool-search',
  viewScrollPositions: {},
  visitedViews: {
    'pool-search': true
  },
  searchResult: null,
  selectedPoolId: null,
  selectedPoolKey: null,
  selectedPoolCard: null,
  lastQuery: '',
  marketUpdatedAt: null,
  marketDisplayUpdatedAt: null,
  forkStatus: null,
  refreshTimer: null,
  lastSnapshot: null,
  manageSelection: new Set(),
  manageExpandedGroups: new Set(),
  closedExpandedGroups: new Set(),
  positionSetup: {
    mode: 'bidask',
    minPct: '',
    maxPct: '',
    capitalUsd: 2,
    depositToken: 'quote',
    slippagePct: 0.5,
    dryRun: false,
    autoswapOnClose: false,
    spotSide: 'buy',
    anchorPrice: null,
    anchorLocked: false
  },
  setupExecutionResult: null,
  setupExecutablePreview: null,
  positionActionResults: {},
  modalPreviewPayload: null,
  actionOverlay: null,
  keystore: {
    status: null,
    wallets: [],
    feedback: 'Key material is encrypted locally and unlock stays only in RAM.',
    busy: false
  },
  settings: {
    nodeRpcUrl: '',
    nodeFeedback: '',
    walletFeedback: '',
    generatedWalletSecrets: []
  },
  liveRunner: {
    activeRunId: null,
    activeRun: null,
    targetRun: null,
    recentRuns: [],
    busy: false
  },
  filterPresets: [],
  swap: {
    preview: null,
    walletBalanceByAddress: {},
    feedback: '',
    lastExecutionFeedback: '',
    lastExecutionAtMs: 0,
    lastExecutionSummary: null,
    lastExecutionKey: '',
    executingKey: '',
    busy: false,
    status: 'idle',
    feedbackTone: 'info',
    inputToken: { ...UI_COMMON_TOKENS.USDT },
    outputToken: { ...UI_COMMON_TOKENS.BNB },
    selectedRouteId: null,
    selectedRoutePinned: false,
    settings: {
      ...DEFAULT_SWAP_SETTINGS
    },
    quoteTimer: null,
    staleTimer: null,
    autoRefreshTimer: null,
    backgroundRefreshing: false,
    requestSeq: 0,
    activeRequestSeq: 0,
    previewRequestController: null,
    selector: {
      open: false,
      side: 'input',
      tab: 'holdings',
      query: '',
      loading: false,
      tokens: [],
      quickTokens: [],
      holdings: [],
      topTokens: [],
      catalogRows: [],
      meta: '',
      lastSelectedAddress: null,
      searchTimer: null,
      catalogRefreshTimer: null,
      requestSeq: 0
    }
  }
}

let setupInteractionLockedUntil = 0

const inputDebounce = new Map()
let actionOverlayHideTimer = null
let snapshotRefreshInFlight = false
let snapshotRefreshQueued = false
let snapshotRefreshQueuedForce = false
let snapshotRefreshQueuedRefreshOpen = false
let searchRefreshInFlight = false
let poolSearchInFlight = false
let poolSearchPartialRefreshTimer = null
let poolSearchPartialRefreshAttempts = 0
let selectedPriceRefreshInFlight = false
let selectedPriceManualRefreshQueued = false
let searchFilterRenderTimer = null
let liveRunnerPollTimer = null
let searchViewportHydrationTimer = null
let searchViewportHydrationInFlight = false
let searchViewportHydrationBurstTimers = []
let poolCardRenderSequence = 0
let poolSearchRequestSequence = 0
let positionSetupRenderInProgress = false
const SEARCH_FILTER_INPUT_DEBOUNCE_MS = 180
const SEARCH_RENDER_CHUNK_SIZE = 80
const pendingTokenMarketCapLookups = new Set()
const pendingPairMarketMetricLookups = new Set()
const SETUP_EDIT_INPUT_IDS = new Set([
  'setup-capital-usd',
  'setup-min-pct',
  'setup-max-pct',
  'setup-min-price',
  'setup-max-price'
])
const setupRangeInputDraft = {
  id: null,
  value: '',
  selectionStart: null,
  selectionEnd: null
}
let setupExecutablePreviewTimer = null
let setupExecutablePreviewGeneration = 0

const FILTER_IDS = [
  'sort-select',
  'fee-tvl-interval',
  'dex-filter',
  'quote-token-filter',
  'pool-type-filter',
  'min-market-cap',
  'max-market-cap',
  'min-age-hours',
  'max-age-hours',
  'min-liquidity',
  'max-liquidity',
  'min-volume-24h',
  'max-volume-24h',
  'min-volume-1h',
  'max-volume-1h',
  'min-base-fee',
  'max-base-fee',
  'min-fees-24h',
  'max-fees-24h'
]

function setText(id, value) {
  const node = document.getElementById(id)
  if (node) {
    node.textContent = value
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function setHtml(id, value) {
  const node = document.getElementById(id)
  if (node) {
    node.innerHTML = escapeHtml(value)
  }
}

function formatCompact(value, suffix = '') {
  const numeric = Number(value || 0)

  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }

  if (numeric >= 1_000_000_000) {
    return `${(numeric / 1_000_000_000).toFixed(2)}B${suffix}`
  }

  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(2)}M${suffix}`
  }

  if (numeric >= 1_000) {
    return `${(numeric / 1_000).toFixed(1)}K${suffix}`
  }

  return `${numeric.toFixed(2).replace(/\.00$/, '')}${suffix}`
}

function formatUsd(value) {
  let numeric = Number(value || 0)
  if (Number.isFinite(numeric) && Math.abs(numeric) < 0.005) {
    numeric = 0
  }
  return Number.isFinite(numeric) ? `$${formatCompact(numeric)}` : 'n/a'
}

function formatPreviewCapitalUsd(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }
  if (numeric > 0 && numeric < 0.01) {
    return '<$0.01'
  }
  return formatUsd(numeric)
}

function formatUsdNullable(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return 'n/a'
  }
  return formatUsd(value)
}

function formatUsdPrecise(value, { signed = false } = {}) {
  let numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }
  if (Math.abs(numeric) < 0.00005) {
    numeric = 0
  }

  const prefix = signed && numeric > 0 ? '+' : ''
  const abs = Math.abs(numeric)

  if (abs >= 1000) {
    return `${prefix}${formatUsd(numeric)}`
  }

  if (abs >= 1) {
    return `${prefix}$${numeric.toFixed(2).replace(/\.00$/, '')}`
  }

  if (abs >= 0.01) {
    return `${prefix}$${numeric.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`
  }

  return `${prefix}$${numeric.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`
}

function formatManagePnlUsd(value) {
  let numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }
  if (Math.abs(numeric) < 0.00005) {
    numeric = 0
  }
  if (numeric < 0) {
    return `-${formatUsdPrecise(Math.abs(numeric))}`
  }
  return formatUsdPrecise(numeric)
}

function formatSetupLossUsd(lossPct, capitalUsd) {
  const numericLoss = Number(lossPct || 0)
  const numericCapital = Number(capitalUsd || 0)
  if (!Number.isFinite(numericLoss) || !Number.isFinite(numericCapital) || numericCapital <= 0) {
    return '$0.00'
  }
  return formatUsd((numericLoss / 100) * numericCapital)
}

function updateMarketAgeLabels() {
  const label = formatRelativeSeconds(state.marketDisplayUpdatedAt || state.marketUpdatedAt)
  for (const node of document.querySelectorAll('#updated-age-label, #setup-current-price-updated, #setup-current-price-updated-inline')) {
    node.textContent = label
  }
}

function formatQuoteTokenAmount(value, symbol, digits = 4) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }

  return `${numeric.toFixed(digits).replace(/\.?0+$/, '')} ${symbol}`
}

function hasKnownManageValuation(card) {
  if (!card) {
    return false
  }

  const valuationStatus = String(card.valuationStatus || '').toLowerCase()
  if (card.hasKnownValuation === false || valuationStatus === 'unavailable') {
    return false
  }

  return Number.isFinite(Number(card.currentValueQuote))
}

function formatManageValue(card) {
  if (!hasKnownManageValuation(card)) {
    return '-'
  }

  const quoteSymbol = String(card?.quoteSymbol || '').toUpperCase()
  const currentValue = Number(card?.currentValueQuote || 0)
  const depositTokenUsdPrice = Number(card?.depositTokenUsdPrice || 0)

  if (['WBNB', 'BNB'].includes(quoteSymbol) && Number.isFinite(currentValue)) {
    const nativeValue = formatQuoteTokenAmount(currentValue, quoteSymbol)
    if (depositTokenUsdPrice > 0) {
      return `${nativeValue} (${formatUsd(currentValue * depositTokenUsdPrice)})`
    }
    return nativeValue
  }

  return formatUsd(currentValue)
}

function formatPct(value, digits = 2) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric !== 0 && Math.abs(numeric) < 0.01 && digits === 2) {
    return `${numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}%`
  }
  return Number.isFinite(numeric) ? `${numeric.toFixed(digits)}%` : 'n/a'
}

function isRealIntervalEntry(entry) {
  return Boolean(entry && entry.estimated !== true)
}

function formatIntervalPct(entry) {
  if (!entry || entry.feeTvlPct == null || !Number.isFinite(Number(entry.feeTvlPct))) {
    return 'n/a'
  }
  return formatPct(entry.feeTvlPct)
}

function formatIntervalFees(entry) {
  if (!entry || entry.feesUsd == null || !Number.isFinite(Number(entry.feesUsd))) {
    return 'n/a'
  }
  return `${formatUsd(entry.feesUsd)} fees`
}

function formatIntervalVolume(entry, fallbackValue = null) {
  if (entry && entry.volumeUsd != null && Number.isFinite(Number(entry.volumeUsd))) {
    return formatUsd(entry.volumeUsd)
  }
  if (!entry && fallbackValue != null && Number.isFinite(Number(fallbackValue))) {
    return formatUsd(fallbackValue)
  }
  return 'n/a'
}

function formatPctSmart(value, companionValue = null) {
  if (window.PositionSetupShared?.formatPctWithPrecision) {
    return window.PositionSetupShared.formatPctWithPrecision(value, companionValue)
  }

  return formatPct(value)
}

function formatPctRangeSmart(lowerPct, upperPct) {
  if (window.PositionSetupShared?.formatPctRangeWithPrecision) {
    return window.PositionSetupShared.formatPctRangeWithPrecision(lowerPct, upperPct)
  }

  if (!Number.isFinite(Number(lowerPct)) || !Number.isFinite(Number(upperPct))) {
    return 'n/a'
  }

  return `${formatPct(lowerPct)}  ..  ${formatPct(upperPct)}`
}

function formatNumber(value, digits = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : 'n/a'
}

function formatPrice(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'n/a'
  }
  if (numeric >= 1) {
    return numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  }
  if (numeric >= 0.000001) {
    return numeric.toFixed(6)
  }
  return numeric.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
}

function formatSetupPriceInput(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return ''
  }

  if (numeric >= 0.000001) {
    return numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  }

  const fixed = numeric.toFixed(18).replace(/0+$/, '').replace(/\.$/, '')
  return fixed === '0' ? numeric.toPrecision(8) : fixed
}

function formatTokenQuantity(value, digits = 6) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }
  if (numeric === 0) {
    return '0'
  }
  if (Math.abs(numeric) >= 1000) {
    return formatCompact(numeric)
  }
  if (Math.abs(numeric) >= 1) {
    return numeric.toFixed(Math.min(4, digits)).replace(/\.?0+$/, '')
  }
  return numeric.toFixed(digits).replace(/\.?0+$/, '')
}

function floorTokenAmount(value, digits = 6) {
  const numeric = Number(value)
  const precision = Math.max(0, Math.min(8, Number(digits || 0) || 0))
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0
  }
  const factor = 10 ** precision
  return Math.floor(numeric * factor) / factor
}

function formatSwapBalanceAmount(value, decimals = 18) {
  if (value == null) {
    return '-'
  }
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '0'
  }
  const displayDigits = Math.max(2, Math.min(6, Number(decimals || 18)))
  return formatTokenQuantity(floorTokenAmount(numeric, displayDigits), displayDigits)
}

function parseLocaleNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const normalized = String(value ?? '')
    .trim()
    .replace(',', '.')

  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric : fallback
}

function debounceInput(id, fn, delay = 500) {
  if (inputDebounce.has(id)) {
    clearTimeout(inputDebounce.get(id))
  }

  const timer = setTimeout(() => {
    inputDebounce.delete(id)
    fn()
  }, delay)

  inputDebounce.set(id, timer)
}

function isEditingSetupRangeInputs() {
  const active = document.activeElement
  return Boolean(active && SETUP_EDIT_INPUT_IDS.has(active.id))
}

function hasActiveTextSelection() {
  const selection = window.getSelection?.()
  return Boolean(selection && String(selection).trim().length > 0)
}

function formatAge(hours) {
  const numeric = Number(hours)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'n/a'
  }

  if (numeric >= 24) {
    return `${Math.floor(numeric / 24)}d`
  }

  return `${Math.round(numeric)}h`
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return '-'
  }

  const date = new Date(isoString)
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDateTime(isoString) {
  if (!isoString) {
    return '-'
  }

  const date = new Date(isoString)
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
}

function formatRemainingUntil(isoString) {
  const date = new Date(isoString || '')
  if (Number.isNaN(date.getTime())) {
    return '-'
  }
  const remainingMs = date.getTime() - Date.now()
  if (remainingMs <= 0) {
    return 'expired'
  }
  const days = Math.floor(remainingMs / 86400000)
  const hours = Math.floor((remainingMs % 86400000) / 3600000)
  return days > 0 ? `${days}d ${hours}h` : `${Math.max(1, hours)}h`
}

async function loadLicenseStatusBadge() {
  const node = document.getElementById('license-status-chip')
  if (!node) {
    return
  }
  try {
    const status = await fetchJson('/api/license-status')
    if (!status.unlocked) {
      node.textContent = status.reason || 'Locked'
      node.title = status.error || status.reason || ''
      return
    }
    const expiresAt = status.licenseExpiresAt || status.expiresAt
    const remaining = formatRemainingUntil(expiresAt)
    node.textContent = remaining === '-' ? 'Active' : `${remaining} left`
    node.title = expiresAt ? `License valid until ${formatDateTime(expiresAt)}` : 'License active'
  } catch (error) {
    node.textContent = 'Check failed'
    node.title = error?.message || String(error)
  }
}

function toMinuteBucket(isoString) {
  if (!isoString) {
    return 'unknown'
  }

  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return 'unknown'
  }

  date.setSeconds(0, 0)
  return date.toISOString()
}

function formatRelativeSeconds(isoString) {
  if (!isoString) {
    return '-'
  }

  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  const diffMs = Date.now() - date.getTime()
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000))
  return `${diffSeconds}s ago`
}

function formatElapsedSince(isoString) {
  if (!isoString) {
    return '-'
  }

  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  let diffMs = Math.max(0, Date.now() - date.getTime())
  const diffMinutes = Math.floor(diffMs / 60000)
  const days = Math.floor(diffMinutes / 1440)
  const hours = Math.floor((diffMinutes % 1440) / 60)
  const minutes = diffMinutes % 60

  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${Math.max(1, minutes)}m`
}

function getPositionOpenedDisplay(card) {
  if (card?.openedAt) {
    return {
      elapsed: formatElapsedSince(card.openedAt),
      timestamp: formatTimestamp(card.openedAt),
      groupTimestamp: `Opened ${formatTimestamp(card.openedAt)}`
    }
  }

  if (card?.recoveredFromChain) {
    return {
      elapsed: 'Recovered',
      timestamp: card?.recoveredAt ? `Seen ${formatTimestamp(card.recoveredAt)}` : 'Seen on-chain',
      groupTimestamp: card?.recoveredAt ? `Recovered ${formatTimestamp(card.recoveredAt)}` : 'Recovered from chain'
    }
  }

  return {
    elapsed: '-',
    timestamp: '-',
    groupTimestamp: '-'
  }
}

function safePctFromBase(value, base) {
  const numericValue = Number(value || 0)
  const numericBase = Number(base || 0)
  if (!Number.isFinite(numericValue) || !Number.isFinite(numericBase) || numericBase === 0) {
    return null
  }
  return (numericValue / numericBase) * 100
}

function buildOpenGroupTotals(cards = []) {
  const knownValueCards = cards.filter((card) => hasKnownManageValuation(card))
  const allKnownValuation = cards.length > 0 && knownValueCards.length === cards.length
  const totalValue = knownValueCards.reduce((sum, card) => sum + Number(card.currentValueQuote || 0), 0)
  const totalFees = cards.reduce((sum, card) => sum + Number(card.accruedFeesQuote || 0), 0)
  const totalPnl = cards.reduce((sum, card) => sum + Number(card.unrealizedPnlQuote || 0), 0)
  const totalCostBasis = cards.reduce((sum, card) => sum + Number(card.costBasisQuote || 0), 0)
  const claimedFees = cards.reduce((sum, card) => sum + Number(card.claimedFeesQuote || 0), 0)
  const allKnownCostBasis = cards.length > 0 && cards.every((card) => Boolean(card.hasKnownCostBasis))
  const allKnownUnrealizedPnl = cards.length > 0 && cards.every((card) => Boolean(card.hasKnownUnrealizedPnl))
  return {
    totalValue,
    totalFees,
    totalPnl,
    totalCostBasis,
    claimedFees,
    allKnownValuation,
    allKnownCostBasis,
    allKnownUnrealizedPnl,
    totalFeesPct: safePctFromBase(totalFees + claimedFees, totalCostBasis),
    totalPnlPct: allKnownUnrealizedPnl ? safePctFromBase(totalPnl, totalCostBasis) : null
  }
}

function estimateOpenGroupDailyFeesPct(cards = [], totals = buildOpenGroupTotals(cards), nowMs = Date.now()) {
  const totalCostBasis = Number(totals?.totalCostBasis || 0)
  const totalGeneratedFees = Number(totals?.totalFees || 0) + Number(totals?.claimedFees || 0)
  if (!Number.isFinite(totalCostBasis) || totalCostBasis <= 0 || !Number.isFinite(totalGeneratedFees)) {
    return null
  }

  const openedTimes = (cards || [])
    .map((card) => Date.parse(card?.openedAt || ''))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0)
  if (!openedTimes.length) {
    return null
  }

  const openedAtMs = Math.min(...openedTimes)
  const elapsedMs = Number(nowMs) - openedAtMs
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60000) {
    return null
  }

  return safePctFromBase(totalGeneratedFees, totalCostBasis) * (86400000 / elapsedMs)
}

function buildClosedGroupTotals(cards = []) {
  const trustedCards = cards.filter((card) => card.hasTrustedCloseValuation !== false)
  const displayCards = cards.filter((card) => canDisplayClosedValuation(card))
  const allTrusted = cards.length > 0 && trustedCards.length === cards.length
  const allDisplayable = cards.length > 0 && displayCards.length === cards.length
  const totalNet = displayCards.reduce((sum, card) => sum + Number(card.netProceedsQuote || 0), 0)
  const totalDeposit = cards.reduce((sum, card) => sum + Number(card.costBasisQuote || card.deployedQuote || 0), 0)
  const totalFees = displayCards.reduce((sum, card) => sum + Number(card.feesQuote || 0), 0)
  const totalPnl = displayCards.reduce((sum, card) => sum + Number(card.realizedPnlQuote || 0), 0)
  const totalCosts = displayCards.reduce((sum, card) => sum + Number(card.closeCostsQuote || 0), 0)
  const totalAutoswap = displayCards.reduce((sum, card) => sum + Number(card.autoswapDeltaQuote || 0), 0)
  const hasEstimated = allDisplayable && !allTrusted
  return {
    totalNet,
    totalDeposit,
    totalFees,
    totalPnl,
    totalCosts,
    totalAutoswap,
    allTrusted,
    allDisplayable,
    hasEstimated
  }
}

function canDisplayClosedValuation(card = {}) {
  if (card?.hasTrustedCloseValuation !== false) {
    return true
  }
  const status = String(card?.reconciliationStatus || '')
  if (status.startsWith('reconciling_') || status.startsWith('pending_')) {
    return false
  }
  const warning = String(card?.closeValuationWarning || '')
  const isEstimated = Boolean(card?.proceedsEstimated)
    || status.startsWith('estimated_')
    || /estimated/i.test(warning)
  if (!isEstimated) {
    return false
  }
  return ['netProceedsQuote', 'realizedPnlQuote', 'feesQuote', 'closeCostsQuote', 'autoswapDeltaQuote']
    .some((field) => Number.isFinite(Number(card?.[field])))
}

function getClosedValuationStatusLabel(card = {}) {
  const status = String(card?.reconciliationStatus || '')
  if (status.startsWith('reconciling_')) {
    return 'Reconciling'
  }
  if (status.startsWith('pending_')) {
    return 'Pending'
  }
  return ''
}

function formatClosedUsd(card, field, { signed = false } = {}) {
  return signed ? formatSignedUsd(card?.[field] || 0) : formatUsd(card?.[field] || 0)
}

function formatClosedPnlPct(card) {
  const pct = Number(card?.realizedPnlPct || 0)
  return Number.isFinite(pct) ? formatSignedPct(pct) : ''
}

function stampMarketRefreshNow() {
  const refreshedAt = new Date().toISOString()
  state.marketUpdatedAt = refreshedAt
  state.marketDisplayUpdatedAt = refreshedAt
}

function pulseNode(node, className = 'is-live-updated') {
  if (!node) {
    return
  }
  node.classList.remove(className)
  void node.offsetWidth
  node.classList.add(className)
}

function pulseHeaderPriceCards() {
  pulseNode(document.getElementById('header-selected-price'))
  pulseNode(document.getElementById('header-selected-pool'), 'is-live-updated-soft')
  pulseNode(document.querySelector('.status-card-updated'), 'is-live-updated-soft')
}

function refreshManageSelectionState(openCards = state.lastSnapshot?.dashboard?.positions?.openCards || []) {
  const liveIds = new Set(openCards.map((card) => String(card.positionId)))
  for (const id of [...state.manageSelection]) {
    if (!liveIds.has(id)) {
      state.manageSelection.delete(id)
    }
  }
}

function syncManageActionAvailability(openCards = state.lastSnapshot?.dashboard?.positions?.openCards || []) {
  const keystoreUnlocked = Boolean(state.keystore.status?.unlocked)
  const canClosePositions = keystoreUnlocked
  const selectedIds = [...state.manageSelection]
  const selectedCards = openCards.filter((card) => state.manageSelection.has(String(card.positionId)))
  const hasOpenCards = openCards.length > 0
  const hasSelectedCards = selectedIds.length > 0
  const hasClaimableOpenCards = openCards.some((card) => Number(card.accruedFeesQuote || 0) > 0)
  const hasClaimableSelectedCards = selectedCards.some((card) => Number(card.accruedFeesQuote || 0) > 0)

  const topButtons = [
    {
      id: 'manage-close-selected',
      disabled: !hasSelectedCards || !canClosePositions,
      title: !hasSelectedCards
        ? 'Select one or more positions first'
        : !canClosePositions
          ? 'Unlock the local keystore session to close live positions'
          : 'Close selected live positions'
    },
    {
      id: 'manage-close-swap-selected',
      disabled: !hasSelectedCards || !canClosePositions || !EXIT_SWAP_CLOSE_ENABLED,
      title: !hasSelectedCards
        ? 'Select one or more positions first'
        : !EXIT_SWAP_CLOSE_ENABLED
          ? EXIT_SWAP_DISABLED_TITLE
        : !canClosePositions
          ? 'Unlock the local keystore session to close live positions'
          : 'Close and swap selected live positions'
    },
    {
      id: 'manage-close-all',
      disabled: !hasOpenCards || !canClosePositions,
      title: !hasOpenCards
        ? 'No open positions available'
        : !canClosePositions
          ? 'Unlock the local keystore session to close live positions'
          : 'Close all live positions'
    },
    {
      id: 'manage-close-swap-all',
      disabled: !hasOpenCards || !canClosePositions || !EXIT_SWAP_CLOSE_ENABLED,
      title: !hasOpenCards
        ? 'No open positions available'
        : !EXIT_SWAP_CLOSE_ENABLED
          ? EXIT_SWAP_DISABLED_TITLE
        : !canClosePositions
          ? 'Unlock the local keystore session to close live positions'
          : 'Close and swap all live positions'
    },
    {
      id: 'manage-claim-selected',
      disabled: !hasSelectedCards || !hasClaimableSelectedCards || !keystoreUnlocked,
      title: !hasSelectedCards
        ? 'Select one or more positions first'
        : !hasClaimableSelectedCards
          ? 'No selected positions have claimable fees'
          : keystoreUnlocked
            ? 'Claim fees from selected live positions'
            : 'Unlock the local keystore session to claim live fees'
    },
    {
      id: 'manage-claim-all',
      disabled: !hasClaimableOpenCards || !keystoreUnlocked,
      title: !hasClaimableOpenCards
        ? 'No claimable fees available'
        : keystoreUnlocked
          ? 'Claim fees from all live positions'
          : 'Unlock the local keystore session to claim live fees'
    }
  ]

  for (const entry of topButtons) {
    const button = document.getElementById(entry.id)
    if (!button) {
      continue
    }
    button.disabled = entry.disabled
    if (entry.title) {
      button.title = entry.title
    }
    button.setAttribute('aria-disabled', String(entry.disabled))
  }

  for (const button of document.querySelectorAll('[data-manage-collect]')) {
    const key = String(button.dataset.manageCollect || '')
    const card = openCards.find((entry) => String(entry.positionId) === key)
    const disabled = !keystoreUnlocked || !(Number(card?.accruedFeesQuote || 0) > 0)
    button.disabled = disabled
    button.title = Number(card?.accruedFeesQuote || 0) > 0
      ? (keystoreUnlocked ? 'Claim fees from this live position' : 'Unlock the local keystore session to claim live fees')
      : 'No accrued fees to collect'
    button.setAttribute('aria-disabled', String(disabled))
  }

  for (const button of document.querySelectorAll('[data-position-action]')) {
    const action = String(button.dataset.positionAction || '')
    const key = String(button.dataset.positionId || '')
    const card = openCards.find((entry) => String(entry.positionId) === key)
    let disabled = false

    if (action === 'collect-live') {
      disabled = !keystoreUnlocked || !(Number(card?.accruedFeesQuote || 0) > 0)
      button.title = Number(card?.accruedFeesQuote || 0) > 0
        ? (keystoreUnlocked ? 'Claim fees from this live position' : 'Unlock the local keystore session to claim live fees')
        : 'No accrued fees to collect'
    } else if (action === 'close-live' || action === 'close-live-autoswap') {
      disabled = !keystoreUnlocked || (action === 'close-live-autoswap' && !EXIT_SWAP_CLOSE_ENABLED)
      button.title = action === 'close-live-autoswap' && !EXIT_SWAP_CLOSE_ENABLED
        ? EXIT_SWAP_DISABLED_TITLE
        : (keystoreUnlocked ? 'Close this live position' : 'Unlock the local keystore session to close live positions')
    }

    button.disabled = disabled
    button.setAttribute('aria-disabled', String(disabled))
  }
}

function getPoolDisplayPrice(card) {
  return Number(card?.poolPrice || card?.price || card?.priceUsd || 0)
}

function positiveNumber(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function poolCardCompletenessScore(card) {
  if (!card) return 0
  return [
    positiveNumber(getPoolDisplayPrice(card)),
    positiveNumber(card.priceUsd),
    positiveNumber(card.marketCapUsd),
    positiveNumber(card.ageHours),
    positiveNumber(card.depositTokenUsdPrice || card.quoteTokenUsdPrice),
    positiveNumber(card.liquidityUsd)
  ].filter((value) => value > 0).length
}

function fillPositivePoolMetric(target, source, key) {
  if (!target || !source) return
  if (positiveNumber(target[key]) <= 0 && positiveNumber(source[key]) > 0) {
    target[key] = source[key]
  }
}

function chooseRicherPoolCard(candidate, fallback) {
  if (!candidate) return fallback || null
  if (!fallback) return candidate
  const candidateScore = poolCardCompletenessScore(candidate)
  const fallbackScore = poolCardCompletenessScore(fallback)
  const merged = candidateScore >= fallbackScore
    ? { ...fallback, ...candidate }
    : { ...candidate, ...fallback }

  for (const key of [
    'poolPrice',
    'price',
    'priceUsd',
    'marketCapUsd',
    'ageHours',
    'depositTokenUsdPrice',
    'quoteTokenUsdPrice',
    'liquidityUsd',
    'volume1hUsd',
    'fees1hUsd',
    'volume24hUsd',
    'fees24hUsd'
  ]) {
    fillPositivePoolMetric(merged, candidate, key)
    fillPositivePoolMetric(merged, fallback, key)
  }

  return merged
}

function resolvePreservedSelectedPoolCard(cards = [], allCards = [], selectedKey = null, selectedId = null, previousCard = null) {
  const match = (cards || []).find((card) => buildPoolSelectionKey(card) === selectedKey)
    || (allCards || []).find((card) => buildPoolSelectionKey(card) === selectedKey)
    || (cards || []).find((card) => String(card.pairAddress || '').toLowerCase() === String(previousCard?.pairAddress || '').toLowerCase())
    || (allCards || []).find((card) => String(card.pairAddress || '').toLowerCase() === String(previousCard?.pairAddress || '').toLowerCase())
    || (cards || []).find((card) => card.id === selectedId)
    || (allCards || []).find((card) => card.id === selectedId)
    || null
  return chooseRicherPoolCard(match, previousCard)
}

function resolveSetupReferencePrice(card) {
  const direct = Number(getPoolDisplayPrice(card) || 0)
  if (Number.isFinite(direct) && direct > 0) {
    return direct
  }

  const selected = Number(getPoolDisplayPrice(state.selectedPoolCard) || 0)
  if (Number.isFinite(selected) && selected > 0) {
    return selected
  }

  const anchored = Number(state.positionSetup?.anchorPrice || 0)
  if (Number.isFinite(anchored) && anchored > 0) {
    return anchored
  }

  return 0
}

function isInteractingWithSetupControls() {
  if (Date.now() < setupInteractionLockedUntil) {
    return true
  }
  const active = document.activeElement
  if (!active) {
    return false
  }

  const id = String(active.id || '')
  const tag = String(active.tagName || '').toLowerCase()
  if (tag === 'select' || tag === 'textarea') {
    return true
  }

  return [
    'setup-capital-usd',
    'setup-slippage',
    'setup-deposit-token',
    'setup-spot-side',
    'setup-min-pct',
    'setup-max-pct',
    'setup-min-price',
    'setup-max-price'
  ].includes(id)
}

function lockSetupInteraction(ms = 4000) {
  setupInteractionLockedUntil = Date.now() + ms
}

function updateCreateLivePriceNodes(card) {
  if (!card) {
    return
  }

  const currentPrice = Number(getPoolDisplayPrice(card) || 0)
  setText('header-selected-price', formatNumber(currentPrice, 6))
  renderUpdatedHeader()
  updateMarketAgeLabels()
  pulseHeaderPriceCards()

  for (const livePriceNode of document.querySelectorAll('[data-setup-current-price-text]')) {
    livePriceNode.textContent = formatNumber(currentPrice, 6)
  }

  updateMarketAgeLabels()
}

function groupPositionsByRun(openCards) {
  const groups = new Map()

  for (const card of openCards || []) {
    const openedAt = card.openedAt || card.recoveredAt || card.lastSeenAt || 'unknown'
    const runKey = card.openedRunKey || card.openedTxHash || null
    const key = runKey
      ? `${card.dex || 'dex'}:${card.poolAddress || 'pool'}:${runKey}`
      : `${card.dex || 'dex'}:${card.poolAddress || 'pool'}:${openedAt}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        openedAt,
        runKey,
        dex: card.dex || 'unknown',
        poolAddress: card.poolAddress || null,
        quoteSymbol: card.quoteSymbol || 'USDT',
        cards: []
      })
    }
    groups.get(key).cards.push(card)
  }

  return [...groups.values()].sort((left, right) => {
    const byOpenedAt = String(right.openedAt || '').localeCompare(String(left.openedAt || ''))
    if (byOpenedAt !== 0) {
      return byOpenedAt
    }
    return String(right.runKey || '').localeCompare(String(left.runKey || ''))
  })
}

function groupClosedPositionsByRun(closedCards) {
  const groups = new Map()

  for (const card of closedCards || []) {
    const closedAt = card.closedAt || 'unknown'
    const minuteBucket = toMinuteBucket(closedAt)
    const originalOpenBatch = card.openedRunKey || card.openedTxHash || null
    const closedBatchKey = originalOpenBatch ? `closed-batch:${originalOpenBatch}` : minuteBucket
    const key = `${card.dex || 'dex'}:${card.poolAddress || 'pool'}:${card.tokenSymbol || 'token'}:${card.quoteSymbol || 'quote'}:${closedBatchKey}`

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        closedAt,
        dex: card.dex || 'unknown',
        poolAddress: card.poolAddress || null,
        tokenSymbol: card.tokenSymbol || 'TOKEN',
        quoteSymbol: card.quoteSymbol || 'USDT',
        runKey: originalOpenBatch || null,
        cards: []
      })
    }

    groups.get(key).cards.push(card)
  }

  return [...groups.values()].sort((left, right) => String(right.closedAt || '').localeCompare(String(left.closedAt || '')))
}

function formatSignedUsd(value) {
  let numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }
  if (Math.abs(numeric) < 0.005) {
    numeric = 0
  }

  const prefix = numeric > 0 ? '+' : ''
  return `${prefix}${formatUsd(numeric)}`
}

function formatSignedPct(value, digits = 2) {
  let numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }
  if (Math.abs(numeric) < Math.pow(10, -digits) / 2) {
    numeric = 0
  }

  const prefix = numeric > 0 ? '+' : ''
  return `${prefix}${numeric.toFixed(digits)}%`
}

function truncateAddress(value) {
  const address = String(value || '')
  if (!address || address.length < 12) {
    return address || '-'
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getDefenseTone(value, fallback = 'info') {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'allow' || normalized === 'ok') {
    return 'success'
  }
  if (normalized === 'warn' || normalized === 'warning') {
    return 'warning'
  }
  if (normalized === 'block' || normalized === 'critical') {
    return 'danger'
  }
  return fallback
}

function formatDefenseVerdictLabel(value, fallback = 'Unknown') {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'allow') {
    return 'Allow'
  }
  if (normalized === 'warn') {
    return 'Warn'
  }
  if (normalized === 'block') {
    return 'Block'
  }
  if (normalized === 'ok') {
    return 'OK'
  }
  if (normalized === 'warning') {
    return 'Warning'
  }
  if (normalized === 'critical') {
    return 'Critical'
  }
  return fallback
}

function formatBps(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${Math.round(numeric)} bps` : 'n/a'
}

function collectDefenseFlags(assessment) {
  if (!assessment || typeof assessment !== 'object') {
    return []
  }

  if (Array.isArray(assessment.positions)) {
    return assessment.positions.flatMap((item) => collectDefenseFlags(item))
  }

  return [
    ...(Array.isArray(assessment.reasons) ? assessment.reasons : []),
    ...(Array.isArray(assessment.warnings) ? assessment.warnings : [])
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function collectVerificationAlerts(verification) {
  if (!verification || typeof verification !== 'object') {
    return []
  }

  if (Array.isArray(verification.positions)) {
    return verification.positions.flatMap((item) => collectVerificationAlerts(item))
  }

  return (Array.isArray(verification.alerts) ? verification.alerts : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function formatExecutionFlagLabel(item) {
  const normalized = String(item || '').trim()
  const labels = {
    pool_state_unavailable_for_simulation: 'Pool state unavailable for live precheck',
    low_confidence_reference: 'Low confidence live reference',
    route_guard: 'Route guard held execution'
  }
  return labels[normalized] || normalized.replaceAll('_', ' ')
}

function renderExecutionFlags(items, emptyLabel = '') {
  const normalized = Array.from(new Set((items || []).filter(Boolean)))
  if (!normalized.length) {
    return emptyLabel ? `<div class="execution-flag-item muted">${escapeHtml(emptyLabel)}</div>` : ''
  }

  return `
    <div class="execution-flag-list">
      ${normalized.map((item) => `<div class="execution-flag-item">${escapeHtml(formatExecutionFlagLabel(item))}</div>`).join('')}
    </div>
  `
}

function renderDefenseSummary(assessment, title = 'Defense') {
  if (!assessment) {
    return ''
  }

  const verdict = formatDefenseVerdictLabel(assessment.verdict, 'Pending')
  const tone = getDefenseTone(assessment.verdict)
  const confidence = Number(assessment.confidence)
  const flags = collectDefenseFlags(assessment)
  const pendingDeteriorationBps = Number(assessment.metrics?.pendingDeteriorationBps)
  const impairmentBps = Number(assessment.metrics?.immediateImpairmentBps)

  return `
    <div class="execution-flag-group ${tone}">
      <div class="execution-flag-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(verdict)}</span>
      </div>
      <div class="row"><span>Confidence</span><strong>${Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : 'n/a'}</strong></div>
      <div class="row"><span>Pending Drift</span><strong>${formatBps(pendingDeteriorationBps)}</strong></div>
      <div class="row"><span>Impairment</span><strong>${formatBps(impairmentBps)}</strong></div>
      ${renderExecutionFlags(flags, 'No active defense flags')}
    </div>
  `
}

function renderVerificationSummary(verification, title = 'Post-Trade Check') {
  if (!verification) {
    return ''
  }

  const severity = formatDefenseVerdictLabel(verification.severity, 'Info')
  const tone = getDefenseTone(verification.severity)
  const alerts = collectVerificationAlerts(verification)
  const priceDeviationBps = Number(verification.realizedMetrics?.priceDeviationBps)
  const proceedsDeviationBps = Number(verification.realizedMetrics?.proceedsDeviationBps)

  return `
    <div class="execution-flag-group ${tone}">
      <div class="execution-flag-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(severity)}</span>
      </div>
      <div class="row"><span>Price Drift</span><strong>${formatBps(priceDeviationBps)}</strong></div>
      <div class="row"><span>Proceeds Drift</span><strong>${formatBps(proceedsDeviationBps)}</strong></div>
      ${renderExecutionFlags(alerts, verification.ok === false ? 'Verification requires review' : 'No verification alerts')}
    </div>
  `
}

function renderAutoswapExecutionSummary(executions = []) {
  const normalized = Array.isArray(executions) ? executions : []
  if (!normalized.length) {
    return ''
  }

  return normalized.map((entry) => {
    const tone = getDefenseTone(entry.executed ? 'allow' : entry.defense?.verdict || 'warn', 'info')
    const status = entry.executed
      ? `${entry.tokenInSymbol || 'token'} -> ${entry.tokenOutSymbol || 'quote'}`
      : `Skipped: ${entry.reason || 'route_guard'}`
    const flags = [
      ...(entry.defense ? collectDefenseFlags(entry.defense) : []),
      ...(entry.postTradeVerification ? collectVerificationAlerts(entry.postTradeVerification) : [])
    ]

    return `
      <div class="execution-flag-group ${tone}">
        <div class="execution-flag-head">
          <strong>Exit Swap</strong>
          <span>${escapeHtml(entry.executed ? 'Executed' : 'Held')}</span>
        </div>
        <div class="row"><span>Route</span><strong>${escapeHtml(status)}</strong></div>
        <div class="row"><span>Delta</span><strong>${formatSignedUsd(entry.autoswapDeltaQuote || 0)}</strong></div>
        ${renderExecutionFlags(flags, entry.executed ? 'No exit swap alerts' : 'Exit swap guard held execution')}
      </div>
    `
  }).join('')
}

function formatRemainingDuration(ms) {
  const numeric = Number(ms || 0)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '0s'
  }

  const totalSeconds = Math.max(0, Math.floor(numeric / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }

  if (minutes <= 0) {
    return `${seconds}s`
  }

  return `${minutes}m ${seconds}s`
}

function formatUiAssetSymbol(symbol, card = null) {
  const resolved = String(symbol || '').trim()
  const upper = resolved.toUpperCase()
  const pairSymbols = [
    card?.tokenSymbol,
    card?.quoteTokenSymbol,
    card?.quoteSymbol
  ].map((value) => String(value || '').toUpperCase())

  if (upper === 'WBNB' && pairSymbols.some((value) => value === 'BNB' || value === 'WBNB')) {
    return 'BNB'
  }

  return resolved || 'TOKEN'
}

function getDepositTokenLabel(card, depositToken) {
  if (!card) {
    return depositToken === 'base' ? 'BASE' : 'QUOTE'
  }

  return depositToken === 'base'
    ? formatUiAssetSymbol(card.tokenSymbol || 'BASE', card)
    : formatUiAssetSymbol(card.quoteTokenSymbol || card.quoteSymbol || 'QUOTE', card)
}

function formatSpotDepositUsageLabel(summary = {}, card = null) {
  const breakdown = summary?.depositBreakdown || null
  if (breakdown?.label) {
    return breakdown.label
  }

  const tokens = Array.isArray(breakdown?.tokens)
    ? breakdown.tokens.filter((token) => token?.active)
    : []
  if (tokens.length > 1) {
    return tokens.map((token) => token.symbol || token.side).join(' + ')
  }
  if (tokens.length === 1) {
    return `${tokens[0].symbol || tokens[0].side} only`
  }

  return getDepositTokenLabel(card, summary?.depositToken === 'base' ? 'base' : 'quote')
}

function formatSpotDepositUsageDetail(summary = {}) {
  const tokens = Array.isArray(summary?.depositBreakdown?.tokens)
    ? summary.depositBreakdown.tokens.filter((token) => token?.active)
    : []
  if (!tokens.length) {
    return 'Token side will be resolved from pool token0/token1 at execution time'
  }

  return tokens
    .map((token) => {
      const amount = token.expectedUsedFormatted || token.desiredAmountFormatted || '0'
      return `${amount} ${token.symbol || token.side}`
    })
    .join(' + ')
}

function getPairDisplayLabel(card) {
  if (!card) {
    return 'TOKEN/QUOTE'
  }

  return `${card.tokenSymbol || 'TOKEN'}/${card.quoteSymbol || card.quoteTokenSymbol || 'QUOTE'}`
}

async function hydrateVisibleTokenMarketCaps(cards = []) {
  const visibleCards = getViewportSearchCards(cards, { limit: 36, overscanPx: 280 })
  const targets = [...new Map(
    visibleCards
      .filter((card) => (
        /^0x[a-fA-F0-9]{40}$/.test(String(card?.tokenAddress || ''))
        && !/^0x[a-fA-F0-9]{40,64}$/.test(String(card?.pairAddress || ''))
        && (
          Number(card?.marketCapUsd || 0) <= 0
          || Number(getPoolDisplayPrice(card) || 0) <= 0
          || Number(card?.ageHours || 0) <= 0
        )
      ))
      .map((card) => [String(card.tokenAddress).toLowerCase(), card.tokenAddress])
  ).values()]

  if (!targets.length) {
    return
  }

  let changed = false
  for (let index = 0; index < targets.length; index += 6) {
    const chunk = targets.slice(index, index + 6).filter((tokenAddress) => {
      const key = String(tokenAddress).toLowerCase()
      return !pendingTokenMarketCapLookups.has(key)
    })

    if (!chunk.length) {
      continue
    }

    chunk.forEach((tokenAddress) => pendingTokenMarketCapLookups.add(String(tokenAddress).toLowerCase()))
    try {
      const results = await Promise.all(chunk.map(async (tokenAddress) => {
        try {
          const payload = await fetchJson(`/api/token-market-cap?tokenAddress=${encodeURIComponent(tokenAddress)}`)
          return [String(tokenAddress).toLowerCase(), payload]
        } catch (_) {
          return [String(tokenAddress).toLowerCase(), null]
        }
      }))

      for (const [key, payload] of results) {
        if (!payload || !state.searchResult?.cards?.length) {
          continue
        }

        for (const card of state.searchResult.cards) {
          if (String(card.tokenAddress || '').toLowerCase() !== key) {
            continue
          }

          const marketCapUsd = Number(payload.marketCapUsd || 0)
          if (Number(card.marketCapUsd || 0) <= 0 && Number.isFinite(marketCapUsd) && marketCapUsd > 0) {
            card.marketCapUsd = marketCapUsd
            card.marketCapLabel = formatUsd(marketCapUsd)
            changed = true
          }

          const tokenPriceUsd = Number(payload.priceUsd || 0)
          if (Number(getPoolDisplayPrice(card) || 0) <= 0 && Number.isFinite(tokenPriceUsd) && tokenPriceUsd > 0) {
            card.priceUsd = tokenPriceUsd
            card.poolPrice = tokenPriceUsd
            changed = true
          }

          const ageHours = Number(payload.ageHours || 0)
          if (Number(card.ageHours || 0) <= 0 && Number.isFinite(ageHours) && ageHours > 0) {
            card.ageHours = ageHours
            card.ageLabel = `${Math.round(ageHours)}h`
            changed = true
          }
        }
      }
    } finally {
      chunk.forEach((tokenAddress) => pendingTokenMarketCapLookups.delete(String(tokenAddress).toLowerCase()))
    }
  }

  if (changed) {
    rerenderSearchResult()
  }
}

async function hydrateVisiblePairMarketMetrics(cards = []) {
  const visibleCards = getViewportSearchCards(cards, { limit: 42, overscanPx: 320 })
  const targets = visibleCards.filter((card) => (
    /^0x[a-fA-F0-9]{40,64}$/.test(String(card?.pairAddress || ''))
    && (
      Number(card?.marketCapUsd || 0) <= 0
      || Number(card?.ageHours || 0) <= 0
      || !/^0x[a-fA-F0-9]{40}$/.test(String(card?.tokenAddress || ''))
    )
  )).filter((card) => {
    const key = String(card.pairAddress || '').toLowerCase()
    return key && !pendingPairMarketMetricLookups.has(key)
  }).slice(0, 12)

  if (!targets.length) {
    return
  }

  let changed = false
  const requestPairs = []
  for (const card of targets) {
    const key = String(card.pairAddress || '').toLowerCase()
    pendingPairMarketMetricLookups.add(key)
    requestPairs.push({
      pairAddress: String(card.pairAddress || ''),
      tokenSymbol: String(card.tokenSymbol || ''),
      quoteSymbol: String(card.quoteTokenSymbol || card.quoteSymbol || ''),
      dex: String(card.dex || ''),
      protocolVersion: String(card.protocolVersion || '')
    })
  }

  try {
    const payload = await postJson('/api/pool-market-metrics-batch', {
      pairs: requestPairs
    }).catch(() => null)
    if (!payload?.results?.length || !state.searchResult?.cards?.length) {
      return
    }

    const metricsByPair = new Map(
      payload.results
        .filter((item) => item?.pairAddress)
        .map((item) => [String(item.pairAddress || '').toLowerCase(), item])
    )

    for (const target of state.searchResult.cards) {
      const key = String(target?.pairAddress || '').toLowerCase()
      const metrics = metricsByPair.get(key)
      if (!metrics) {
        continue
      }

      if (!/^0x[a-fA-F0-9]{40}$/.test(String(target.tokenAddress || '')) && /^0x[a-fA-F0-9]{40}$/.test(String(metrics.tokenAddress || ''))) {
        target.tokenAddress = metrics.tokenAddress
        changed = true
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(String(target.quoteAddress || '')) && /^0x[a-fA-F0-9]{40}$/.test(String(metrics.quoteAddress || ''))) {
        target.quoteAddress = metrics.quoteAddress
        changed = true
      }

      const marketCapUsd = Number(metrics.marketCapUsd || 0)
      if (Number(target.marketCapUsd || 0) <= 0 && Number.isFinite(marketCapUsd) && marketCapUsd > 0) {
        target.marketCapUsd = marketCapUsd
        target.marketCapLabel = formatUsd(marketCapUsd)
        changed = true
      }

      const ageHours = Number(metrics.pairCreatedAt || 0) > 0
        ? Math.max(0, (Date.now() - Number(metrics.pairCreatedAt)) / (60 * 60 * 1000))
        : 0
      if (Number(target.ageHours || 0) <= 0 && Number.isFinite(ageHours) && ageHours > 0) {
        target.ageHours = ageHours
        target.ageLabel = `${Math.round(ageHours)}h`
        changed = true
      }

      const liquidityUsd = Number(metrics.liquidityUsd || 0)
      if (Number(target.liquidityUsd || 0) <= 0 && Number.isFinite(liquidityUsd) && liquidityUsd > 0) {
        target.liquidityUsd = liquidityUsd
        changed = true
      }

      const priceUsd = Number(metrics.priceUsd || 0)
      if (Number(getPoolDisplayPrice(target) || 0) <= 0 && Number.isFinite(priceUsd) && priceUsd > 0) {
        target.priceUsd = priceUsd
        target.poolPrice = priceUsd
        changed = true
      }
    }
  } finally {
    for (const card of targets) {
      const key = String(card.pairAddress || '').toLowerCase()
      pendingPairMarketMetricLookups.delete(key)
    }
  }

  if (changed) {
    rerenderSearchResult()
  }
}

function getViewportSearchCards(cards = [], options = {}) {
  const normalizedCards = Array.isArray(cards) ? cards : []
  if (!normalizedCards.length) {
    return []
  }

  const limit = Math.max(1, Number(options.limit || 24))
  const overscanPx = Math.max(0, Number(options.overscanPx || 240))
  const filteredCards = getFilteredCards({ ...(state.searchResult || {}), cards: normalizedCards })
  const grid = document.getElementById('pool-grid')

  if (!grid) {
    return filteredCards.slice(0, limit)
  }

  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
  const visibleIds = new Set(
    [...grid.querySelectorAll('.pool-card[data-pool-id]')]
      .map((node) => ({
        id: String(node.dataset.poolId || ''),
        rect: node.getBoundingClientRect()
      }))
      .filter(({ rect }) => rect.bottom >= -overscanPx && rect.top <= viewportHeight + overscanPx)
      .sort((left, right) => left.rect.top - right.rect.top)
      .map(({ id }) => id)
  )

  const viewportCards = filteredCards.filter((card) => visibleIds.has(String(card.id || '')))
  return (viewportCards.length ? viewportCards : filteredCards).slice(0, limit)
}

async function runSearchViewportHydration() {
  if (
    searchViewportHydrationInFlight
    || document.hidden
    || state.activeView !== 'pool-search'
    || !state.searchResult?.cards?.length
  ) {
    return
  }

  searchViewportHydrationInFlight = true
  try {
    await hydrateVisiblePairMarketMetrics(state.searchResult.cards)
    await hydrateVisibleTokenMarketCaps(state.searchResult.cards)
  } finally {
    searchViewportHydrationInFlight = false
  }
}

function clearSearchViewportHydrationTimers() {
  if (searchViewportHydrationTimer) {
    clearTimeout(searchViewportHydrationTimer)
    searchViewportHydrationTimer = null
  }

  for (const timer of searchViewportHydrationBurstTimers) {
    clearTimeout(timer)
  }
  searchViewportHydrationBurstTimers = []
}

function scheduleSearchViewportHydration(options = {}) {
  clearSearchViewportHydrationTimers()

  const delayMs = Math.max(0, Number(options.delayMs ?? 180))
  const burst = Array.isArray(options.burst) ? options.burst : []
  searchViewportHydrationTimer = setTimeout(() => {
    searchViewportHydrationTimer = null
    runSearchViewportHydration().catch(() => {})
  }, delayMs)

  for (const offset of burst) {
    const timer = setTimeout(() => {
      runSearchViewportHydration().catch(() => {})
    }, Math.max(delayMs, Number(offset || 0)))
    searchViewportHydrationBurstTimers.push(timer)
  }
}

function getCardCompletenessScore(card) {
  return (
    (Number(card?.marketCapUsd || 0) > 0 ? 1 : 0)
    + (Number(getPoolDisplayPrice(card) || 0) > 0 ? 1 : 0)
    + (Number(card?.ageHours || 0) > 0 ? 1 : 0)
  )
}

function getRealFeeTvlPct(card, feeTvlInterval = '4h') {
  const entry = card?.feeTvl?.[feeTvlInterval]
  if (!entry) {
    return null
  }
  const value = Number(entry?.feeTvlPct)
  return Number.isFinite(value) ? value : null
}

function getMarketLiveSignalScore(card, feeTvlInterval = '4h') {
  const completeMarketDataBoost = getCardCompletenessScore(card) >= 3 ? 10000 : 0
  return (
    completeMarketDataBoost
    + (Number(getRealFeeTvlPct(card, feeTvlInterval) || 0) > 0 ? 100 : 0)
    + (Number(card?.fees1hUsd || 0) > 0 ? 10 : 0)
    + (Number(card?.volume1hUsd || 0) > 0 ? 1 : 0)
  )
}

function inferUiDepositTokenUsdPrice(card, depositToken) {
  if (!card) {
    return 1
  }

  const explicitDepositUsd = Number(card.depositTokenUsdPrice || card.quoteTokenUsdPrice || 0)
  const tokenUsd = Number(card.priceUsd || 0)
  const poolPrice = Number(getPoolDisplayPrice(card) || 0)
  const depositLabel = getDepositTokenLabel(card, depositToken).toUpperCase()

  if (depositToken === 'base') {
    return tokenUsd > 0 ? tokenUsd : 1
  }

  if (explicitDepositUsd > 0) {
    return explicitDepositUsd
  }

  if (['USDT', 'USDC', 'FDUSD', 'BUSD', 'USDE'].includes(depositLabel)) {
    return 1
  }

  if (depositLabel === 'WBNB' || depositLabel === 'BNB') {
    if (tokenUsd > 0 && poolPrice > 0) {
      return tokenUsd / poolPrice
    }
  }

  return 1
}

function supportsForkExecution(card) {
  if (!card) {
    return false
  }

  const dex = String(card.dex || '').toLowerCase()
  const label = String(card.dexLabel || '').toLowerCase()

  if (!UI_SUPPORTED_FORK_DEX_IDS.has(dex)) {
    return false
  }

  if (label.includes('infinity')) {
    return false
  }

  return true
}

function inferUiCardProtocolVersion(card) {
  const explicit = String(card?.protocolVersion || '').toLowerCase()
  if (['v1', 'v2', 'v3', 'v4', 'fusion'].includes(explicit)) {
    return explicit
  }

  const label = [
    card?.dexLabel,
    card?.dexDisplay,
    card?.quoteChip
  ].map((item) => String(item || '').toLowerCase()).join(' ')

  if (/^0x[a-fA-F0-9]{64}$/.test(String(card?.pairAddress || '')) || label.includes('v4')) {
    return 'v4'
  }
  if (label.includes('v3') || card?.tickSpacing || card?.sqrtPriceX96 || card?.poolManager) {
    return 'v3'
  }
  if (label.includes('v2') || String(card?.poolModel || '').toLowerCase() === 'xyk') {
    return 'v2'
  }
  if (label.includes('v1')) {
    return 'v1'
  }

  return 'unknown'
}

function getUiPoolTypeLabel(card) {
  const explicit = String(card?.poolTypeLabel || '').trim()
  if (explicit) {
    return explicit
  }
  const protocolVersion = inferUiCardProtocolVersion(card)
  if (protocolVersion === 'v1') return 'V2'
  if (protocolVersion === 'v2') return 'V2'
  if (protocolVersion === 'v3') return 'V3'
  if (protocolVersion === 'v4') return String(card?.dex || '').toLowerCase() === 'pancakeswap' ? 'Infinity' : 'V4'
  if (protocolVersion === 'fusion') return 'V3'
  return 'Classification required'
}

function buildUiExecutionSupportReport(card) {
  const protocolVersion = inferUiCardProtocolVersion(card)
  const poolModel = String(card?.poolModel || (protocolVersion === 'v3' || protocolVersion === 'v4' ? 'cl' : 'unknown')).toLowerCase()
  const supportsBidAsk = card?.supportsBidAsk == null
    ? (protocolVersion === 'v3' || protocolVersion === 'v4')
    : Boolean(card.supportsBidAsk)

  if (!supportsForkExecution(card)) {
    return {
      ok: false,
      reason: 'unsupported-dex-family',
      message: 'This pool family is not executable in the current operator path.'
    }
  }

  if (protocolVersion !== 'v3' && protocolVersion !== 'v4') {
    return {
      ok: false,
      reason: 'unsupported-protocol',
      message: 'This pool stays visible in search, but live range execution is only available for confirmed V3/V4 concentrated-liquidity pools.'
    }
  }

  if (!supportsBidAsk || poolModel === 'xyk') {
    return {
      ok: false,
      reason: 'bidask-not-supported-for-pool-model',
      message: 'This pool stays visible in search, but bid/ask range execution is only wired for concentrated-liquidity pools.'
    }
  }

  return {
    ok: true,
    reason: null,
    message: null
  }
}

function buildUiPoolModeSupportReport(card, mode) {
  const protocolVersion = inferUiCardProtocolVersion(card)
  const poolModel = String(card?.poolModel || '').toLowerCase()
  const supportsBidAsk = card?.supportsBidAsk == null
    ? (protocolVersion === 'v3' || protocolVersion === 'v4')
    : Boolean(card.supportsBidAsk)
  const normalizedMode = String(mode || 'bidask').toLowerCase()

  if (normalizedMode === 'bidask' && (!supportsBidAsk || protocolVersion === 'v1' || protocolVersion === 'v2' || protocolVersion === 'fusion' || poolModel === 'xyk' || poolModel === 'stable-v2' || String(card?.poolTypeLabel || '').toLowerCase().includes('infinity'))) {
    return {
      ok: false,
      reason: 'bidask-not-supported-for-pool',
      message: 'Для этого пула доступен только Spot. BidAsk здесь невозможен.'
    }
  }

  return {
    ok: true,
    reason: null,
    message: null
  }
}

function showSetupModeWarning(message) {
  const existing = document.querySelector('.setup-mode-warning-backdrop')
  if (existing) {
    existing.remove()
  }
  const backdrop = document.createElement('div')
  backdrop.className = 'setup-mode-warning-backdrop'
  backdrop.innerHTML = `
    <div class="setup-mode-warning-dialog" role="dialog" aria-modal="true" aria-live="polite">
      <button type="button" class="setup-mode-warning-close" aria-label="Закрыть">×</button>
      <strong>${escapeHtml(message || 'Этот режим недоступен для выбранного пула.')}</strong>
    </div>
  `
  const close = () => backdrop.remove()
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close()
  })
  backdrop.querySelector('.setup-mode-warning-close')?.addEventListener('click', close)
  document.body.appendChild(backdrop)
}

function isCardInsideConfiguredRange(currentPrice, minPrice, maxPrice, minPct, maxPct) {
  const live = Number(currentPrice)
  const firstPrice = Number(minPrice)
  const secondPrice = Number(maxPrice)
  const firstPct = Number(minPct)
  const secondPct = Number(maxPct)

  if (!Number.isFinite(live) || live <= 0 || !Number.isFinite(firstPrice) || !Number.isFinite(secondPrice)) {
    return false
  }

  const lowerPrice = Math.min(firstPrice, secondPrice)
  const upperPrice = Math.max(firstPrice, secondPrice)
  const lowerPct = Math.min(firstPct, secondPct)
  const upperPct = Math.max(firstPct, secondPct)

  if (upperPct <= 0) {
    return live <= upperPrice
  }

  if (lowerPct >= 0) {
    return live >= lowerPrice
  }

  return live >= lowerPrice && live <= upperPrice
}

function renderUpdatedHeader() {
  const node = document.getElementById('updated-at')
  if (!node) {
    return
  }

  node.innerHTML = `
    <span class="updated-inline">
      <span class="updated-age-inline">
        <span class="updated-live-dot"></span>
        <span id="updated-age-label">${formatRelativeSeconds(state.marketDisplayUpdatedAt || state.marketUpdatedAt)}</span>
      </span>
    </span>
    <button type="button" id="updated-refresh-button" class="updated-refresh-button" aria-label="Refresh current price" title="Refresh current price">&#8635;</button>
  `

  const refreshButton = document.getElementById('updated-refresh-button')
  if (refreshButton) {
    refreshButton.onclick = async () => {
      refreshButton.disabled = true
      try {
        await refreshLiveOperatorData({ manual: true })
      } finally {
        setTimeout(() => {
          refreshButton.disabled = false
        }, 300)
      }
    }
  }
}

function bindManageGroupActions() {
  for (const button of document.querySelectorAll('[data-manage-copy-ca]')) {
    if (button.dataset.manageCopyBound === '1') {
      continue
    }
    button.dataset.manageCopyBound = '1'
    const copyContract = async (event) => {
      event.stopPropagation()
      event.preventDefault()
      const copied = await copyToClipboard(button.dataset.manageCopyCa || '')
      if (copied) {
        button.classList.add('copied')
        setTimeout(() => button.classList.remove('copied'), 1200)
      }
    }
    button.addEventListener('click', copyContract)
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        copyContract(event)
      }
    })
  }

  for (const button of document.querySelectorAll('[data-manage-group]')) {
    if (button.dataset.manageGroupBound === '1') {
      continue
    }
    button.dataset.manageGroupBound = '1'
    button.addEventListener('click', () => {
      const key = String(button.dataset.manageGroup || '')
      if (!key) {
        return
      }

      if (state.manageExpandedGroups.has(key)) {
        state.manageExpandedGroups.delete(key)
      } else {
        state.manageExpandedGroups.add(key)
      }

      if (state.lastSnapshot?.dashboard?.positions?.openCards) {
        renderManageOpenTable(state.lastSnapshot.dashboard.positions.openCards || [])
      }
    })
  }

  for (const checkbox of document.querySelectorAll('[data-manage-group-select]')) {
    if (checkbox.dataset.manageGroupSelectBound === '1') {
      continue
    }
    checkbox.dataset.manageGroupSelectBound = '1'
    checkbox.addEventListener('change', (event) => {
      event.stopPropagation()
      const key = String(checkbox.dataset.manageGroupSelect || '')
      const openCards = state.lastSnapshot?.dashboard?.positions?.openCards || []
      const group = groupPositionsByRun(openCards).find((entry) => entry.key === key)
      if (!group) {
        return
      }

      for (const card of group.cards) {
        const positionId = String(card.positionId)
        if (checkbox.checked) {
          state.manageSelection.add(positionId)
        } else {
          state.manageSelection.delete(positionId)
        }
      }

      refreshManageSelectionState(openCards)
      renderManageOpenTable(openCards)
    })
  }
}

function renderForkStatus() {
  const node = document.getElementById('fork-status')
  if (!node) {
    return
  }

  if (!state.forkStatus) {
    node.textContent = 'Checking...'
    node.className = ''
    return
  }

  node.textContent = state.keystore.status?.unlocked ? 'Live Ready' : 'Wallet Locked'
  node.className = 'positive'
  syncManageActionAvailability(state.lastSnapshot?.dashboard?.positions?.openCards || [])
}

function renderKeystorePanel() {
  const listRoot = document.getElementById('keystore-status-list')
  const walletSelect = document.getElementById('keystore-wallet-select')
  const feedbackNode = document.getElementById('keystore-feedback')
  const unlockButton = document.getElementById('keystore-unlock-button')
  const importButton = document.getElementById('keystore-import-button')
  const lockButton = document.getElementById('keystore-lock-button')

  if (!listRoot || !walletSelect || !feedbackNode) {
    return
  }

  const status = state.keystore.status || {
    unlocked: false,
    availableWallets: 0
  }
  const wallets = state.keystore.wallets || []
  const selectedWalletId = walletSelect.value

  listRoot.innerHTML = ''
  const rows = [
    ['Session', status.unlocked ? 'Unlocked' : 'Locked'],
    ['Wallets', String(status.availableWallets || wallets.length || 0)],
    ['Active Wallet', status.walletIdMasked || '-'],
    ['Address', status.address ? truncateAddress(status.address) : '-'],
    ['TTL', status.unlocked ? formatRemainingDuration(status.remainingMs) : '-']
  ]

  for (const [label, value] of rows) {
    const row = document.createElement('div')
    row.className = 'row'
    const strongClass = label === 'Address' || label === 'Active Wallet' ? 'mono-value' : ''
    const addressCopy = label === 'Address' && status.address
      ? `<span class="keystore-value-with-action"><strong class="${strongClass}" title="${escapeHtml(status.address)}">${escapeHtml(value)}</strong><button type="button" class="icon-action copy-ca-button keystore-address-copy" data-keystore-copy-address="${escapeHtml(status.address)}" aria-label="Copy wallet address" title="Copy wallet address"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v10H9z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5h10" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button></span>`
      : `<strong class="${strongClass}">${escapeHtml(value)}</strong>`
    row.innerHTML = `<span>${escapeHtml(label)}</span>${addressCopy}`
    listRoot.appendChild(row)
  }

  for (const button of listRoot.querySelectorAll('[data-keystore-copy-address]')) {
    const copyWalletAddress = async (event) => {
      event.preventDefault()
      event.stopPropagation()
      const copied = await copyToClipboard(button.dataset.keystoreCopyAddress || '')
      if (copied) {
        button.classList.add('copied')
        if (feedbackNode) {
          feedbackNode.textContent = 'Wallet address copied.'
        }
        setTimeout(() => button.classList.remove('copied'), 900)
      } else if (feedbackNode) {
        feedbackNode.textContent = 'Could not copy wallet address.'
      }
    }
    button.addEventListener('click', copyWalletAddress)
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        copyWalletAddress(event)
      }
    })
  }

  walletSelect.innerHTML = ''
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = wallets.length ? 'Select local wallet' : 'No wallet imported yet'
  walletSelect.appendChild(placeholder)

  for (const wallet of wallets) {
    const option = document.createElement('option')
    option.value = wallet.walletId
    option.textContent = `${wallet.label || 'Wallet'} · ${wallet.walletIdMasked} · ${truncateAddress(wallet.address)}${wallet.active ? ' · active' : ''}`
    if (wallet.walletId === selectedWalletId || (!selectedWalletId && wallet.active)) {
      option.selected = true
    }
    walletSelect.appendChild(option)
  }

  walletSelect.disabled = state.keystore.busy || !wallets.length
  if (unlockButton) {
    unlockButton.disabled = state.keystore.busy || !wallets.length
  }
  if (importButton) {
    importButton.disabled = state.keystore.busy
  }
  if (lockButton) {
    lockButton.disabled = state.keystore.busy || !status.unlocked
  }
  feedbackNode.textContent = state.keystore.feedback || 'Key material stays encrypted locally and the unlocked session lives only in RAM.'
  syncManageActionAvailability(state.lastSnapshot?.dashboard?.positions?.openCards || [])
  renderSettingsPanel()
}

function maskSecretValue(value, visible = false) {
  if (visible) {
    return String(value || '')
  }
  return String(value || '').replace(/[^\s]/g, '•')
}

function renderGeneratedWalletSecrets() {
  const root = document.getElementById('settings-generated-wallet-list')
  if (!root) {
    return
  }

  root.innerHTML = ''
  const generated = state.settings.generatedWalletSecrets || []
  if (!generated.length) {
    return
  }

  for (const wallet of generated) {
    const item = document.createElement('article')
    item.className = 'generated-wallet-card'
    item.innerHTML = `
      <div class="generated-wallet-head">
        <div>
          <strong>${escapeHtml(wallet.label || 'Generated wallet')}</strong>
          <span class="mono-value">${escapeHtml(truncateAddress(wallet.address || ''))}</span>
        </div>
        <span>${escapeHtml(wallet.walletIdMasked || '')}</span>
      </div>
      <div class="secret-stack">
        <div class="secret-row">
          <span>Seed Phrase</span>
          <code>${escapeHtml(maskSecretValue(wallet.mnemonic, wallet.showMnemonic))}</code>
          <button type="button" class="ghost-button secret-action" data-generated-secret-toggle="mnemonic" data-wallet-id="${escapeHtml(wallet.walletId)}">${wallet.showMnemonic ? 'Hide' : 'Show'}</button>
          <button type="button" class="ghost-button secret-action" data-generated-secret-copy="mnemonic" data-wallet-id="${escapeHtml(wallet.walletId)}">Copy</button>
        </div>
        <div class="secret-row">
          <span>Private Key</span>
          <code>${escapeHtml(maskSecretValue(wallet.privateKey, wallet.showPrivateKey))}</code>
          <button type="button" class="ghost-button secret-action" data-generated-secret-toggle="privateKey" data-wallet-id="${escapeHtml(wallet.walletId)}">${wallet.showPrivateKey ? 'Hide' : 'Show'}</button>
          <button type="button" class="ghost-button secret-action" data-generated-secret-copy="privateKey" data-wallet-id="${escapeHtml(wallet.walletId)}">Copy</button>
        </div>
      </div>
    `
    root.appendChild(item)
  }

  for (const button of root.querySelectorAll('[data-generated-secret-toggle]')) {
    button.addEventListener('click', () => {
      const wallet = state.settings.generatedWalletSecrets.find((entry) => entry.walletId === button.dataset.walletId)
      if (!wallet) return
      if (button.dataset.generatedSecretToggle === 'mnemonic') {
        wallet.showMnemonic = !wallet.showMnemonic
      } else {
        wallet.showPrivateKey = !wallet.showPrivateKey
      }
      renderGeneratedWalletSecrets()
    })
  }

  for (const button of root.querySelectorAll('[data-generated-secret-copy]')) {
    button.addEventListener('click', async () => {
      const wallet = state.settings.generatedWalletSecrets.find((entry) => entry.walletId === button.dataset.walletId)
      if (!wallet) return
      const key = button.dataset.generatedSecretCopy === 'mnemonic' ? 'mnemonic' : 'privateKey'
      const ok = await copyToClipboard(wallet[key])
      state.settings.walletFeedback = ok ? 'Copied.' : 'Could not copy.'
      renderSettingsPanel()
    })
  }
}

function renderSettingsPanel() {
  const nodeUrlInput = document.getElementById('settings-node-url')
  const nodeFeedback = document.getElementById('settings-node-feedback')
  const walletFeedback = document.getElementById('settings-wallet-feedback')
  const telegramLink = document.getElementById('settings-telegram-link')

  if (nodeUrlInput && document.activeElement !== nodeUrlInput) {
    nodeUrlInput.value = state.settings.nodeRpcUrl || ''
  }
  if (nodeFeedback) {
    nodeFeedback.textContent = state.settings.nodeFeedback || ''
  }
  if (walletFeedback) {
    walletFeedback.textContent = state.settings.walletFeedback || ''
  }
  if (telegramLink) {
    telegramLink.href = TELEGRAM_CHANNEL_URL
  }
  renderGeneratedWalletSecrets()
}

async function loadOperatorSettings() {
  try {
    const payload = await fetchJson('/api/operator-settings')
    state.settings.nodeRpcUrl = payload.nodeRpcUrl || ''
    state.settings.nodeFeedback = payload.nodeRpcUrl ? 'Current node is loaded.' : ''
  } catch (error) {
    state.settings.nodeFeedback = error.message
  }
  renderSettingsPanel()
}

async function saveOperatorNodeSettings(nodeRpcUrl) {
  state.settings.nodeFeedback = 'Saving node...'
  renderSettingsPanel()
  try {
    const payload = await postJson('/api/operator-settings', { nodeRpcUrl })
    state.settings.nodeRpcUrl = payload.nodeRpcUrl || ''
    state.settings.nodeFeedback = payload.nodeRpcUrl ? 'Node saved.' : ''
  } catch (error) {
    state.settings.nodeFeedback = error.message
  }
  renderSettingsPanel()
}

async function generateSettingsWallet() {
  const labelNode = document.getElementById('settings-wallet-label')
  const passwordNode = document.getElementById('settings-wallet-password')
  const label = String(labelNode?.value || '').trim()
  const password = String(passwordNode?.value || '')
  state.settings.walletFeedback = 'Generating wallet...'
  renderSettingsPanel()
  try {
    const payload = await postJson('/api/keystore-generate', { label, password })
    const generated = payload.generatedWallet
    state.settings.generatedWalletSecrets.unshift({
      ...generated,
      showMnemonic: false,
      showPrivateKey: false
    })
    state.settings.generatedWalletSecrets = state.settings.generatedWalletSecrets.slice(0, 5)
    state.keystore.status = payload.status
    state.keystore.wallets = payload.wallets || []
    state.keystore.feedback = 'Generated wallet was added to the local keystore.'
    state.settings.walletFeedback = 'Wallet generated and added to Manage.'
    if (passwordNode) passwordNode.value = ''
    if (labelNode) labelNode.value = ''
    renderKeystorePanel()
  } catch (error) {
    state.settings.walletFeedback = error.message
    renderSettingsPanel()
  }
}

function getSwapWalletAddress() {
  return state.keystore.status?.address || state.keystore.wallets?.find((wallet) => wallet.active)?.address || state.keystore.wallets?.[0]?.address || null
}

function getSwapSettingsStorageKey() {
  return `operator-shell.swap-settings.v2:${String(getSwapWalletAddress() || 'guest').toLowerCase()}`
}

function loadSwapSettings() {
  try {
    const raw = localStorage.getItem(getSwapSettingsStorageKey())
    if (!raw) {
      state.swap.settings = { ...DEFAULT_SWAP_SETTINGS }
      return
    }

    const parsed = JSON.parse(raw)
    state.swap.settings = {
      ...DEFAULT_SWAP_SETTINGS,
      ...parsed,
      slippagePct: clampSwapSlippagePct(parsed?.slippagePct ?? DEFAULT_SWAP_SETTINGS.slippagePct),
      slippageMode: String(parsed?.slippageMode || DEFAULT_SWAP_SETTINGS.slippageMode).toLowerCase() === 'manual' ? 'manual' : 'auto',
      quickTokenSymbols: Array.isArray(parsed?.quickTokenSymbols) && parsed.quickTokenSymbols.length
        ? parsed.quickTokenSymbols.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean).slice(0, 6)
        : [...DEFAULT_SWAP_SETTINGS.quickTokenSymbols]
    }
  } catch (_) {
    state.swap.settings = { ...DEFAULT_SWAP_SETTINGS }
  }
}

function persistSwapSettings() {
  try {
    localStorage.setItem(getSwapSettingsStorageKey(), JSON.stringify(state.swap.settings))
  } catch (_) {
  }
}

function getSwapRecentTokensStorageKey() {
  return `operator-shell.swap-recent-tokens.v1:${String(getSwapWalletAddress() || 'guest').toLowerCase()}`
}

function loadRecentSwapTokenAddresses() {
  try {
    const raw = localStorage.getItem(getSwapRecentTokensStorageKey())
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    const values = Array.isArray(parsed) ? parsed : []
    return [...new Set(values
      .map((item) => String(item || '').trim())
      .filter((item) => /^0x[a-fA-F0-9]{40}$/.test(item))
      .map((item) => item.toLowerCase()))].slice(0, SWAP_RECENT_TOKEN_LIMIT)
  } catch (_) {
    return []
  }
}

function persistRecentSwapTokenAddresses(addresses = []) {
  try {
    localStorage.setItem(getSwapRecentTokensStorageKey(), JSON.stringify(
      [...new Set((addresses || [])
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => /^0x[a-f0-9]{40}$/.test(item)))]
        .slice(0, SWAP_RECENT_TOKEN_LIMIT)
    ))
  } catch (_) {
  }
}

function noteRecentSwapTokenAddress(address) {
  const normalized = String(address || '').trim().toLowerCase()
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
    return
  }

  const next = [normalized, ...loadRecentSwapTokenAddresses().filter((item) => item !== normalized)]
  persistRecentSwapTokenAddresses(next)
}

function isExactEvmAddressInput(value = '') {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || '').trim())
}

function clampSwapSlippagePct(value, fallback = DEFAULT_SWAP_SETTINGS.slippagePct) {
  const numeric = Number(value)
  const resolved = Number.isFinite(numeric) && numeric > 0 ? numeric : Number(fallback || DEFAULT_SWAP_SETTINGS.slippagePct)
  return Math.max(0.01, Math.min(SWAP_MAX_SLIPPAGE_PCT, resolved))
}

function applySwapSettings(partial) {
  partial = partial || {}
  const nextPartial = { ...partial }
  if (Object.prototype.hasOwnProperty.call(nextPartial, 'slippagePct')) {
    nextPartial.slippagePct = clampSwapSlippagePct(nextPartial.slippagePct)
  }
  if (Object.prototype.hasOwnProperty.call(nextPartial, 'slippageMode')) {
    nextPartial.slippageMode = String(nextPartial.slippageMode || '').toLowerCase() === 'manual' ? 'manual' : 'auto'
  }
  state.swap.settings = {
    ...state.swap.settings,
    ...nextPartial
  }
  persistSwapSettings()
  refreshSwapAutoQuoteLoop()
  renderSwapPanel()
}

function setSwapFeedback(message = '', tone = 'info') {
  state.swap.feedback = String(message || '')
  state.swap.feedbackTone = tone || 'info'
}

function formatSwapErrorMessage(message = '') {
  const raw = String(message || '').trim()
  if (!raw) return 'Swap failed. Refresh the quote and try again.'
  if (/insufficient/i.test(raw)) return 'Insufficient balance for this swap.'
  if (/timed out|timeout|abort/i.test(raw)) return 'Swap timed out. Refresh the quote and try again.'
  if (/allowance|approve/i.test(raw)) return 'Approval failed. Check wallet balance and retry.'
  if (/slippage|amountout|min/i.test(raw)) return 'Price moved beyond slippage. Refresh the quote.'
  if (/no route|route/i.test(raw)) return 'No executable route for this amount.'
  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/execution reverted:?/i, 'Reverted:')
    .replace(/0x[a-fA-F0-9]{16,}/g, 'tx data')
    .trim()
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned
}

function showSwapToast(tone = 'info', title = 'Swap update', message = '') {
  showToast({
    title,
    message,
    tone: `swap-${tone}`,
    timeoutMs: tone === 'danger' ? 5200 : 3600
  })
}

function buildTokenBadgeLetter(token = {}) {
  const symbol = String(token.symbol || token.name || '').trim().toUpperCase()
  if (symbol === 'USDT') return 'T'
  if (symbol === 'USDC') return '$'
  if (symbol === 'WBNB' || symbol === 'BNB') return 'B'
  return symbol.charAt(0) || '?'
}

function getSwapTokenLogoUrl(token = {}) {
  const value = String(
    token?.logoUrl
    || token?.logo
    || token?.iconUrl
    || token?.image
    || token?.imageUrl
    || buildTrustWalletSmartchainLogoUrl(token?.address || token?.wrappedAddress)
    || ''
  ).trim()
  return /^(https?:\/\/|data:image\/)/i.test(value) ? value : ''
}

function renderSwapTokenIconInner(token = {}) {
  const logoUrl = getSwapTokenLogoUrl(token)
  const fallback = `<span class="swap-token-icon-fallback">${escapeHtml(buildTokenBadgeLetter(token))}</span>`
  if (!logoUrl) return fallback
  return `<img class="swap-token-icon-img" src="${escapeHtml(logoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">${fallback}`
}

function renderSwapTokenIcon(token = {}, className = 'swap-token-trigger-icon') {
  const symbol = token?.symbol || token?.name || 'Token'
  return `<span class="${escapeHtml(className)}" data-token="${escapeHtml(symbol)}" title="${escapeHtml(symbol)}">${renderSwapTokenIconInner(token)}</span>`
}

function bindSwapTokenIconFallbacks(root = document) {
  if (!root?.querySelectorAll) return
  for (const image of root.querySelectorAll('.swap-token-icon-img:not([data-swap-icon-bound])')) {
    image.dataset.swapIconBound = '1'
    image.addEventListener('error', () => {
      image.remove()
    }, { once: true })
  }
}

function resolveSwapDexKey(label = '') {
  const value = String(label || '').toLowerCase()
  if (value.includes('pancake')) return 'pancake'
  if (value.includes('uniswap')) return 'uniswap'
  if (value.includes('venus')) return 'venus'
  return 'dex'
}

function buildSwapDexFallbackLabel(label = '') {
  const normalized = String(label || '').trim()
  if (!normalized) return '?'
  if (normalized.toLowerCase().includes('pancake')) return 'P'
  if (normalized.toLowerCase().includes('uniswap')) return 'U'
  if (normalized.toLowerCase().includes('venus')) return 'V'
  return normalized.charAt(0).toUpperCase()
}

function getSwapDexLogoUrl(label = '') {
  return SWAP_DEX_LOGOS[resolveSwapDexKey(label)]?.logoUrl || ''
}

function renderSwapDexNode(label = '') {
  const dexLabel = String(label || 'DEX').trim() || 'DEX'
  const dexKey = resolveSwapDexKey(dexLabel)
  const logoUrl = getSwapDexLogoUrl(dexLabel)
  const fallback = `<span class="swap-dex-logo-fallback">${escapeHtml(buildSwapDexFallbackLabel(dexLabel))}</span>`
  const icon = logoUrl
    ? `<img class="swap-dex-logo-img" src="${escapeHtml(logoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">${fallback}`
    : fallback
  return `<span class="swap-route-dex-node" data-dex="${escapeHtml(dexKey)}" title="${escapeHtml(dexLabel)}"><span class="swap-dex-logo">${icon}</span><span class="swap-dex-label">${escapeHtml(dexLabel)}</span></span>`
}

function bindSwapDexIconFallbacks(root = document) {
  if (!root?.querySelectorAll) return
  for (const image of root.querySelectorAll('.swap-dex-logo-img:not([data-swap-dex-icon-bound])')) {
    image.dataset.swapDexIconBound = '1'
    image.addEventListener('error', () => {
      image.remove()
    }, { once: true })
  }
}

function isNativeBnbToken(token = {}) {
  return Boolean(token?.native)
    || (
      String(token?.symbol || '').trim().toUpperCase() === 'BNB'
      && String(token?.address || '').toLowerCase() === String(UI_COMMON_TOKENS.BNB.address || '').toLowerCase()
    )
}

function getSwapBalanceQueryToken(token = {}) {
  if (isNativeBnbToken(token)) {
    return 'BNB'
  }
  return token?.address || token?.symbol || ''
}

function getSwapBalanceCacheKey(token = {}) {
  if (isNativeBnbToken(token)) {
    return 'native:bnb'
  }
  return String(token?.address || '').trim().toLowerCase()
}

function setSwapTokenChip(side, token) {
  const symbolNode = document.getElementById(side === 'input' ? 'swap-token-in-symbol' : 'swap-token-out-symbol')
  const addressNode = document.getElementById(side === 'input' ? 'swap-token-in-address' : 'swap-token-out-address')
  const iconNode = document.getElementById(side === 'input' ? 'swap-token-in-icon' : 'swap-token-out-icon')

  if (symbolNode) symbolNode.textContent = token?.symbol || '-'
  if (addressNode) {
    addressNode.textContent = token?.name || (token?.address ? truncateAddress(token.address) : 'Select token')
    addressNode.title = token?.address || token?.name || ''
  }
  if (iconNode) {
    iconNode.innerHTML = renderSwapTokenIconInner(token)
    iconNode.dataset.token = token?.symbol || ''
    bindSwapTokenIconFallbacks(iconNode)
  }
}

function getActiveSwapRoute() {
  const preview = state.swap.preview
  if (!preview) return null
  const selectedRouteId = String(state.swap.selectedRouteId || '').trim().toLowerCase()
  return (preview.routes || []).find((route) => String(route.routeId || '').trim().toLowerCase() === selectedRouteId) || preview.bestRoute || null
}

function resolveSmartSwapSlippagePct(options) {
  options = options || {}
  const route = options.route || getActiveSwapRoute()
  const preview = options.preview || state.swap.preview
  const configured = clampSwapSlippagePct(state.swap.settings?.slippagePct || DEFAULT_SWAP_SETTINGS.slippagePct)
  if (String(state.swap.settings?.slippageMode || 'auto').toLowerCase() === 'manual') {
    return configured
  }

  const priceImpactPct = Math.max(
    0,
    Number(route?.priceImpactPct ?? preview?.metrics?.priceImpactPct ?? 0) || 0
  )
  const routeKind = String(route?.routeKind || '').toLowerCase()
  const hopCount = Math.max(1, Array.isArray(route?.hops) ? route.hops.length : 1)
  const liquidityUsd = Number(route?.liquidityUsd || 0)
  let smart = Math.max(configured, 0.5)

  if (priceImpactPct >= 0.5) {
    smart = Math.max(smart, priceImpactPct + 0.35)
  }
  if (routeKind.includes('multi') || hopCount > 1) {
    smart = Math.max(smart, 0.85)
  }
  if (routeKind.includes('v2')) {
    smart = Math.max(smart, 0.75)
  }
  if (liquidityUsd > 0 && liquidityUsd < 25000) {
    smart = Math.max(smart, 1.25)
  }

  return Math.min(SWAP_MAX_SLIPPAGE_PCT, Number(smart.toFixed(2)))
}

function getSwapInputAmountValue() {
  return document.getElementById('swap-amount-in')?.value || ''
}

function getCachedSwapTokenBalance(token) {
  const key = getSwapBalanceCacheKey(token)
  if (!key) return null
  return state.swap.walletBalanceByAddress[key] || null
}

function updateSwapAmountFiatDisplay() {
  const amountNode = document.getElementById('swap-amount-in')
  const fiatInNode = document.getElementById('swap-fiat-in')
  const fiatOutNode = document.getElementById('swap-fiat-out')
  const amount = Number(amountNode?.value || 0)
  const preview = state.swap.preview

  if (fiatInNode) {
    const inputPrice = Number(preview?.market?.inputPriceUsd || state.swap.inputToken?.priceUsd || 0)
    fiatInNode.textContent = inputPrice > 0 && amount > 0 ? formatUsd(amount * inputPrice) : '$0.00'
  }

  if (fiatOutNode) {
    const outputAmount = Number(getActiveSwapRoute()?.quotedAmountOutDisplay || 0)
    const outputPrice = Number(preview?.market?.outputPriceUsd || state.swap.outputToken?.priceUsd || 0)
    fiatOutNode.textContent = outputAmount > 0 && outputPrice > 0 ? formatUsd(outputAmount * outputPrice) : '$0.00'
  }
}

function getSwapFormPayload() {
  const inputBalance = getCachedSwapTokenBalance(state.swap.inputToken)
  const outputBalance = getCachedSwapTokenBalance(state.swap.outputToken)
  const withCachedBalance = (token, balance) => token ? {
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    verified: token.verified,
    standard: token.standard,
    logoUrl: getSwapTokenLogoUrl(token),
    priceUsd: token.priceUsd,
    priceChange24h: token.priceChange24h,
    marketCap: token.marketCap,
    liquidityUsd: token.liquidityUsd,
    native: Boolean(token.native),
    wrappedAddress: token.wrappedAddress,
    balance: balance?.balance ?? token.balance,
    balanceRaw: balance?.balanceRaw ?? token.balanceRaw,
    balanceUsd: balance?.balanceUsd ?? token.balanceUsd,
    hasBalance: Boolean(balance?.hasBalance ?? token.hasBalance)
  } : null

  return {
    tokenIn: state.swap.inputToken?.address || state.swap.inputToken?.symbol || '',
    tokenOut: state.swap.outputToken?.address || state.swap.outputToken?.symbol || '',
    tokenInMeta: withCachedBalance(state.swap.inputToken, inputBalance),
    tokenOutMeta: withCachedBalance(state.swap.outputToken, outputBalance),
    amountIn: getSwapInputAmountValue(),
    slippagePct: resolveSmartSwapSlippagePct({ preview: state.swap.preview, route: getActiveSwapRoute() })
  }
}

function formatOptionalUsd(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? formatUsd(numeric) : 'n/a'
}

function formatOptionalGas(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? `${numeric.toFixed(5)} BNB gas` : 'Gas n/a'
}

function formatOptionalBnbFee(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? `${numeric.toFixed(5)} BNB` : 'n/a'
}

function hasRecentSwapExecutionSuccess(windowMs = 90000) {
  return Boolean(
    String(state.swap.lastExecutionFeedback || '').trim()
    && Number(state.swap.lastExecutionAtMs || 0) > 0
    && (Date.now() - Number(state.swap.lastExecutionAtMs || 0) < windowMs)
  )
}

function buildSwapExecutionKey(route = getActiveSwapRoute()) {
  const payload = getSwapFormPayload()
  const tokenIn = String(payload.tokenInMeta?.address || payload.tokenIn || '').trim().toLowerCase()
  const tokenOut = String(payload.tokenOutMeta?.native ? 'native:bnb' : (payload.tokenOutMeta?.address || payload.tokenOut || '')).trim().toLowerCase()
  const amountIn = String(payload.amountIn || '').trim()
  const slippagePct = String(payload.slippagePct || '').trim()
  const routeId = String(route?.routeId || state.swap.selectedRouteId || '').trim().toLowerCase()
  return [tokenIn, tokenOut, amountIn, slippagePct, routeId].join('|')
}

function swapRouteIdsEqual(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase()
}

function getSwapQuoteFreshnessLabel(preview) {
  if (state.swap.backgroundRefreshing) {
    return 'Updating...'
  }
  if (!preview?.quote?.generatedAtMs) {
    return 'Idle'
  }

  const ageSec = Math.max(0, Math.floor((Date.now() - Number(preview.quote.generatedAtMs || 0)) / 1000))
  return ageSec >= Math.floor((preview.quote.staleAfterMs || SWAP_QUOTE_STALE_FALLBACK_MS) / 1000) ? `Stale ${ageSec}s` : `Live ${ageSec}s`
}

function isSwapPreviewActuallyStale(preview) {
  if (!preview?.quote?.generatedAtMs) {
    return false
  }
  const staleAfterMs = Number(preview.quote?.staleAfterMs || SWAP_QUOTE_STALE_FALLBACK_MS)
  const quoteAgeMs = Math.max(0, Date.now() - Number(preview.quote.generatedAtMs || 0))
  return quoteAgeMs >= staleAfterMs
}

function renderSwapEmptyState(root, title, body) {
  if (!root) return
  root.innerHTML = ''
  const card = document.createElement('div')
  card.className = 'swap-empty-card'
  card.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span>`
  root.appendChild(card)
}

function getSupportedSwapPoolHints() {
  return [
    'Pancake 0.01%',
    'Pancake 0.05%',
    'Pancake 1.00%',
    'Uniswap 0.01%',
    'Uniswap 0.05%',
    'Uniswap 1.00%'
  ]
}

function describeSwapIdleState({ walletReady, walletUnlocked, hasAmount, status, feedback }) {
  if (!walletReady) {
    return {
      subtitle: 'Import a local keystore wallet to view holdings and enable live execution.',
      summary: ['Wallet Required', 'Import a local wallet to load balances, quote from the active address, and unlock execution.'],
      selectedRoute: ['Execution Locked', 'Live execution stays disabled until a local wallet is available and unlocked.'],
      routeList: ['Supported Pools', 'Routes are searched on PancakeSwap and Uniswap after the form becomes executable.'],
      freshness: 'Wallet needed'
    }
  }

  if (!walletUnlocked) {
    return {
      subtitle: 'Unlock the local wallet session to quote and execute the best available route.',
      summary: ['Wallet Locked', 'Holdings are visible after unlock. Execution and live quote refresh stay blocked while the session is locked.'],
      selectedRoute: ['Awaiting Unlock', 'The selected route card will populate after the wallet session is unlocked and a quote is built.'],
      routeList: ['Best Route', 'Unlock first, then enter an amount to scan the supported pools.'],
      freshness: 'Locked'
    }
  }

  if (!hasAmount) {
    return {
      subtitle: 'Enter an amount to scan supported PancakeSwap and Uniswap pools.',
      summary: ['Enter Amount', 'The swap terminal builds quotes after both tokens are selected and the sell amount is positive.'],
      selectedRoute: ['No Route Selected', 'Once a quote is ready, this card will show the route that will be executed.'],
      routeList: ['Supported Pools', 'Select tokens and enter a positive amount to compare supported pools.'],
      freshness: 'Need amount'
    }
  }

  if (status === 'refreshing') {
    return {
      subtitle: 'Scanning the supported pools and refreshing the selected route.',
      summary: ['Refreshing Quote', 'The quote board will repopulate as soon as the latest route response comes back.'],
      selectedRoute: ['Refreshing Route', 'Execution stays paused until the new quote is ready.'],
      routeList: ['Route Scan', 'Route candidates will repopulate automatically after the current refresh finishes.'],
      freshness: 'Refreshing'
    }
  }

  if (status === 'insufficient') {
    return {
      subtitle: feedback || 'Insufficient balance for the current swap amount.',
      summary: ['Insufficient Balance', 'Reduce the sell amount or switch the input token before requesting the next quote.'],
      selectedRoute: ['Route Blocked', 'Live execution stays disabled while the wallet cannot fund the input amount.'],
      routeList: ['No Executable Route', 'Quote building stopped because the current wallet balance cannot fund the request.'],
      freshness: 'Balance low'
    }
  }

  if (/no swap route/i.test(String(feedback || ''))) {
    return {
      subtitle: feedback || 'No route is available for this token pair on the supported pools.',
      summary: ['No Route', 'The pair can stay unsupported even if both tokens exist.'],
      selectedRoute: ['Route Unavailable', 'No executable route is currently available in this workspace.'],
      routeList: ['Supported Pools', 'Try the reverse direction or switch tokens to a pair that has a supported pool.'],
      freshness: 'No route'
    }
  }

  return {
    subtitle: feedback || 'Waiting for a fresh quote from the supported pools.',
    summary: ['Waiting For Quote', 'The workspace is ready, but no fresh quote is attached to the current form yet.'],
    selectedRoute: ['Route Pending', 'The selected route card fills in when a quote is available.'],
    routeList: ['Supported Pools', 'Supported route candidates appear here once the quote response is ready.'],
    freshness: status === 'stale' ? 'Stale' : 'Idle'
  }
}

function clearSwapQuoteTimers() {
  if (state.swap.quoteTimer) {
    clearTimeout(state.swap.quoteTimer)
    state.swap.quoteTimer = null
  }
  if (state.swap.staleTimer) {
    clearTimeout(state.swap.staleTimer)
    state.swap.staleTimer = null
  }
  if (state.swap.autoRefreshTimer) {
    clearTimeout(state.swap.autoRefreshTimer)
    state.swap.autoRefreshTimer = null
  }
}

function cancelSwapPreviewRequest() {
  if (state.swap.previewRequestController) {
    state.swap.previewRequestController.abort()
    state.swap.previewRequestController = null
  }
}

function scheduleSwapQuote(reason = 'input') {
  clearSwapQuoteTimers()

  if (!state.keystore.status?.unlocked) {
    cancelSwapPreviewRequest()
    state.swap.preview = null
    state.swap.status = 'idle'
    state.swap.feedback = state.keystore.status?.availableWallets
      ? 'Unlock wallet to build a live quote.'
      : ''
    renderSwapPanel()
    return
  }

  if (!state.swap.inputToken?.address || !state.swap.outputToken?.address) {
    cancelSwapPreviewRequest()
    state.swap.preview = null
    renderSwapPanel()
    return
  }

  const amount = Number(getSwapInputAmountValue() || 0)
  if (!Number.isFinite(amount) || amount <= 0) {
    cancelSwapPreviewRequest()
    state.swap.preview = null
    renderSwapPanel()
    return
  }

  state.swap.quoteTimer = setTimeout(() => {
    runSwapPreview(reason)
  }, SWAP_QUOTE_DEBOUNCE_MS)
  renderSwapPanel()
}

function refreshSwapAutoQuoteLoop() {
  if (state.swap.autoRefreshTimer) {
    clearTimeout(state.swap.autoRefreshTimer)
    state.swap.autoRefreshTimer = null
  }
  if (!state.swap.settings.autoRefreshEnabled) return
  if (['stale', 'error', 'failure'].includes(String(state.swap.status || ''))) return
  if (hasRecentSwapExecutionSuccess()) return
  if (!state.swap.preview?.quote?.generatedAtMs) return

  const staleAfterMs = Number(state.swap.preview?.quote?.staleAfterMs || SWAP_QUOTE_STALE_FALLBACK_MS)
  const quoteAgeMs = Math.max(0, Date.now() - Number(state.swap.preview?.quote?.generatedAtMs || 0))
  const cadenceMs = Number(state.swap.settings.refreshCadenceMs || DEFAULT_SWAP_SETTINGS.refreshCadenceMs)
  const dueInMs = Math.max(
    1200,
    Math.max(cadenceMs, staleAfterMs - SWAP_AUTO_REFRESH_BUFFER_MS) - quoteAgeMs
  )

  state.swap.autoRefreshTimer = setTimeout(() => {
    state.swap.autoRefreshTimer = null
    if (
      document.hidden
      || state.swap.busy
      || state.swap.backgroundRefreshing
      || !state.swap.preview
      || state.swap.status === 'executing'
    ) {
      refreshSwapAutoQuoteLoop()
      return
    }
    runSwapPreview('auto-refresh')
  }, dueInMs)
}

function openSwapModal(id) {
  const shell = document.getElementById(id)
  if (!shell) return
  shell.classList.remove('hidden')
  shell.setAttribute('aria-hidden', 'false')
}

function closeSwapModal(id) {
  const shell = document.getElementById(id)
  if (!shell) return
  shell.classList.add('hidden')
  shell.setAttribute('aria-hidden', 'true')
}

async function fetchSwapTokenCatalog() {
  const requestSeq = (state.swap.selector.requestSeq || 0) + 1
  state.swap.selector.requestSeq = requestSeq
  state.swap.selector.loading = true
  renderSwapTokenSelector()
  try {
    const selected = [state.swap.inputToken?.address, state.swap.outputToken?.address].filter(Boolean).join(',')
    const recent = loadRecentSwapTokenAddresses().join(',')
    const payload = await fetchJson(`/api/swap-tokens?query=${encodeURIComponent(state.swap.selector.query || '')}&selected=${encodeURIComponent(selected)}&recent=${encodeURIComponent(recent)}`)
    if (requestSeq !== state.swap.selector.requestSeq) {
      return
    }
    state.swap.selector.tokens = payload.results || []
    state.swap.selector.quickTokens = payload.quickTokens || []
    state.swap.selector.holdings = payload.holdings || []
    state.swap.selector.topTokens = payload.topTokens || []
    state.swap.selector.catalogRows = payload.catalogRows || []
    state.swap.selector.meta = payload.hasWallet
      ? (payload.query ? `Found ${payload.results?.length || 0} token candidates for the active wallet.` : 'Showing wallet tokens with a positive balance.')
      : 'Wallet not imported yet. Search still works, holdings stay empty.'
  } catch (error) {
    if (requestSeq !== state.swap.selector.requestSeq) {
      return
    }
    state.swap.selector.tokens = []
    state.swap.selector.meta = 'Token list unavailable. Search again when the swap server is ready.'
  } finally {
    if (requestSeq !== state.swap.selector.requestSeq) {
      return
    }
    state.swap.selector.loading = false
    renderSwapTokenSelector()
  }
}

function openSwapTokenSelector(side) {
  state.swap.selector.open = true
  state.swap.selector.side = side
  state.swap.selector.query = ''
  state.swap.selector.tab = 'holdings'
  const selectorRoot = document.getElementById('swap-token-modal')
  if (selectorRoot) {
    selectorRoot.classList.remove('hidden')
    selectorRoot.setAttribute('aria-hidden', 'false')
    positionSwapTokenDropdown(side)
  }
  const searchNode = document.getElementById('swap-token-search-input')
  if (searchNode) {
    searchNode.value = ''
    setTimeout(() => searchNode.focus(), 30)
  }
  fetchSwapTokenCatalog().catch(() => {})
}

function closeSwapTokenSelector() {
  state.swap.selector.open = false
  const selectorRoot = document.getElementById('swap-token-modal')
  if (selectorRoot) {
    selectorRoot.classList.add('hidden')
    selectorRoot.setAttribute('aria-hidden', 'true')
  }
}

function positionSwapTokenDropdown(side = state.swap.selector.side) {
  const selectorRoot = document.getElementById('swap-token-modal')
  const trigger = document.getElementById(side === 'output' ? 'swap-token-out-button' : 'swap-token-in-button')
  if (!selectorRoot || !trigger) return
  const rect = trigger.getBoundingClientRect()
  const gutter = 12
  const wantedWidth = Math.min(440, Math.max(380, rect.width + 190))
  const width = Math.min(wantedWidth, Math.max(320, window.innerWidth - gutter * 2))
  const left = Math.max(gutter, Math.min(window.innerWidth - width - gutter, rect.left))
  const topBelow = rect.bottom + 8
  const maxTop = Math.max(gutter, window.innerHeight - 470)
  const top = Math.max(gutter, Math.min(maxTop, topBelow))
  selectorRoot.style.setProperty('--swap-token-dropdown-left', `${Math.round(left)}px`)
  selectorRoot.style.setProperty('--swap-token-dropdown-top', `${Math.round(top)}px`)
  selectorRoot.style.setProperty('--swap-token-dropdown-width', `${Math.round(width)}px`)
}

function openSwapSettingsModal() {
  const slippageNode = document.getElementById('swap-slippage')
  const autoRefreshNode = document.getElementById('swap-auto-refresh-toggle')
  const cadenceNode = document.getElementById('swap-refresh-cadence')
  const quickTokenNode = document.getElementById('swap-quick-token-input')
  if (slippageNode) slippageNode.value = String(state.swap.settings.slippagePct)
  if (autoRefreshNode) autoRefreshNode.checked = Boolean(state.swap.settings.autoRefreshEnabled)
  if (cadenceNode) cadenceNode.value = String(state.swap.settings.refreshCadenceMs)
  if (quickTokenNode) quickTokenNode.value = (state.swap.settings.quickTokenSymbols || []).join(',')
  openSwapModal('swap-settings-modal')
}

function closeSwapSettingsModal() {
  closeSwapModal('swap-settings-modal')
}

function applySwapTokenSelection(token) {
  if (!token?.address) return
  noteRecentSwapTokenAddress(token.address)
  state.swap.lastExecutionFeedback = ''
  state.swap.lastExecutionAtMs = 0
  state.swap.lastExecutionSummary = null
  if (state.swap.selector.side === 'input') {
    state.swap.inputToken = { ...token }
    const amountNode = document.getElementById('swap-amount-in')
    if (amountNode) {
      amountNode.value = ''
    }
  } else {
    state.swap.outputToken = { ...token }
  }
  state.swap.preview = null
  state.swap.selectedRouteId = null
  state.swap.selectedRoutePinned = false
  state.swap.feedback = ''
  closeSwapTokenSelector()
  renderSwapPanel()
  refreshSelectedSwapBalances().catch(() => {})
  scheduleSwapQuote('token-select')
}

function renderSwapTokenSelector() {
  const listRoot = document.getElementById('swap-token-list')
  const emptyRoot = document.getElementById('swap-token-empty')
  const metaNode = document.getElementById('swap-token-modal-meta')
  const subtitleNode = document.getElementById('swap-token-modal-subtitle')
  if (!listRoot || !emptyRoot || !metaNode || !subtitleNode) return

  subtitleNode.textContent = state.swap.selector.side === 'input'
    ? 'Select the token you want to sell. Paste a contract address for exact match.'
    : 'Select the token you want to buy. Rows always bind to an exact contract address.'
  metaNode.textContent = state.swap.selector.loading ? 'Loading tokens...' : (state.swap.selector.meta || 'Ready.')

  const holdingsRows = state.swap.selector.holdings || []
  const currentList = state.swap.selector.query
    ? (state.swap.selector.tokens || [])
    : holdingsRows

  listRoot.innerHTML = ''
  const visibleList = currentList.filter((item) => item?.address)
  const showEmptyState = !state.swap.selector.loading && visibleList.length === 0
  emptyRoot.classList.toggle('hidden', !showEmptyState)
  if (showEmptyState) {
    emptyRoot.textContent = state.swap.selector.query
      ? 'No matching token candidates. Paste the exact contract address or try a clearer symbol.'
      : 'No wallet token balances found yet. Paste a contract address or search by token symbol.'
  } else {
    emptyRoot.textContent = ''
  }

  for (const token of visibleList) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'swap-token-row'
    const balanceLabel = token.hasBalance
      ? `${formatCompact(token.balance || 0)} ${escapeHtml(token.symbol || '')}`
      : `0 ${escapeHtml(token.symbol || '')}`
    const secondaryLabel = token.hasBalance
      ? formatUsd(token.balanceUsd || 0)
      : (Number(token.priceUsd || 0) > 0 ? `Price ${formatUsd(token.priceUsd || 0)}` : 'Not in wallet')
    row.innerHTML = `
      <div class="swap-token-row-main">
        ${renderSwapTokenIcon(token, 'swap-token-row-icon')}
        <span class="swap-token-row-copy">
          <strong>${escapeHtml(token.symbol || 'UNKNOWN')}</strong>
          <small>${escapeHtml(token.name || 'Unknown token')} · ${escapeHtml(token.address ? truncateAddress(token.address) : 'No address')}</small>
          <em>${token.exactMatch ? 'Exact CA / symbol match' : (token.hasBalance && !token.verified ? 'Wallet token' : (token.verified ? 'Core token' : 'Search result'))}</em>
        </span>
      </div>
      <div class="swap-token-row-side">
        <strong>${balanceLabel}</strong>
        <span>${escapeHtml(secondaryLabel)}</span>
      </div>
    `
    row.addEventListener('click', () => applySwapTokenSelection(token))
    listRoot.appendChild(row)
  }
  bindSwapTokenIconFallbacks(listRoot)
}

function renderSwapPanel() {
  const feedbackNode = document.getElementById('swap-feedback')
  const summaryRoot = document.getElementById('swap-preview-summary')
  const routeListRoot = document.getElementById('swap-route-list')
  const subtitleNode = document.getElementById('swap-preview-subtitle')
  const executeButton = document.getElementById('swap-execute-button')
  const selectedRoutePill = document.getElementById('swap-selected-route-pill')
  const balanceInNode = document.getElementById('swap-wallet-balance-in')
  const balanceOutNode = document.getElementById('swap-wallet-balance-out')
  const outputEstimateNode = document.getElementById('swap-output-estimate')
  const walletAddressNode = document.getElementById('swap-wallet-address')
  const minReceiveNode = document.getElementById('swap-min-receive')
  const bestVenueNode = document.getElementById('swap-best-venue')
  const routeCountChip = document.getElementById('swap-route-count-chip')
  const priceImpactNode = document.getElementById('swap-price-impact')
  const sellLabelNode = document.getElementById('swap-sell-label')
  const buyLabelNode = document.getElementById('swap-buy-label')
  const rateNode = document.getElementById('swap-rate')
  const directionLineNode = document.getElementById('swap-direction-line')
  const quoteFreshnessNode = document.getElementById('swap-quote-freshness')
  const slippageNode = document.getElementById('swap-slippage-display')

  if (!feedbackNode || !summaryRoot || !routeListRoot || !subtitleNode) return

  setSwapTokenChip('input', state.swap.inputToken)
  setSwapTokenChip('output', state.swap.outputToken)

  const feedback = String(state.swap.feedback || '').trim()
  feedbackNode.textContent = feedback || ''
  feedbackNode.classList.toggle('hidden', !feedback)
  feedbackNode.classList.remove('swap-feedback-info', 'swap-feedback-success', 'swap-feedback-danger')
  feedbackNode.classList.add(`swap-feedback-${state.swap.feedbackTone || 'info'}`)

  const preview = state.swap.preview
  const activeRoute = getActiveSwapRoute()
  const walletReady = Boolean(state.keystore.status?.availableWallets)
  const walletUnlocked = Boolean(state.keystore.status?.unlocked)
  const hasAmount = Number(getSwapInputAmountValue() || 0) > 0
  const routes = Array.isArray(preview?.routes) ? preview.routes : []
  const bestRoute = preview?.bestRoute || routes[0] || activeRoute || null
  const bestQuotedOut = Number(bestRoute?.quotedAmountOutDisplay || 0)
  const hasReadyPreview = Boolean(preview && activeRoute)
  const previewIsActuallyStale = isSwapPreviewActuallyStale(preview)
  const isBackgroundRefreshing = Boolean(state.swap.backgroundRefreshing)
  const quoteFreshnessLabel = getSwapQuoteFreshnessLabel(preview)
  const priceImpactLabel = preview && activeRoute ? `${Number(preview.metrics?.priceImpactPct || 0).toFixed(2)}%` : '-'
  const formatRouteFeePct = (feeValue) => `${(Number(feeValue || 0) / 10000).toFixed(2)}%`
  const formatRouteFeeLabel = (route) => {
    const hops = Array.isArray(route?.hops) ? route.hops : []
    if (String(route?.routeKind || '').toLowerCase() === 'multi-hop' && hops.length > 1) {
      return hops.map((hop) => formatRouteFeePct(hop.fee)).join(' + ')
    }
    return formatRouteFeePct(route?.fee)
  }
  const formatRouteEdge = (route) => {
    const routeOut = Number(route?.quotedAmountOutDisplay || 0)
    if (!bestQuotedOut || !routeOut) return 'Edge n/a'
    const deltaPct = ((routeOut / bestQuotedOut) - 1) * 100
    if (Math.abs(deltaPct) < 0.005) return 'Best price'
    return deltaPct > 0 ? `+${deltaPct.toFixed(2)}% vs best` : `${deltaPct.toFixed(2)}% vs best`
  }
  const formatRouteDepth = (route) => {
    const liquidity = Number(route?.liquidityUsd || 0)
    const volume24h = Number(route?.volume24hUsd || 0)
    if (liquidity > 0 && volume24h > 0) return `Depth ${formatUsd(liquidity)} | 24H ${formatUsd(volume24h)}`
    if (liquidity > 0) return `Depth ${formatUsd(liquidity)}`
    if (volume24h > 0) return `24H ${formatUsd(volume24h)}`
    return 'Depth n/a'
  }

  if (walletAddressNode) walletAddressNode.textContent = getSwapWalletAddress() ? truncateAddress(getSwapWalletAddress()) : 'No wallet'
  if (sellLabelNode) sellLabelNode.textContent = `Sell ${state.swap.inputToken?.symbol || 'token'}`
  if (buyLabelNode) buyLabelNode.textContent = `Buy ${state.swap.outputToken?.symbol || 'token'}`
  if (slippageNode) {
    const computedSlippage = resolveSmartSwapSlippagePct({ preview, route: activeRoute })
    slippageNode.textContent = String(state.swap.settings?.slippageMode || 'auto').toLowerCase() === 'manual'
      ? `${computedSlippage.toFixed(2)}%`
      : `Auto ${computedSlippage.toFixed(2)}%`
  }
  if (directionLineNode) {
    const amountLabel = hasAmount ? formatTokenQuantity(getSwapInputAmountValue() || 0) : '-'
    directionLineNode.textContent = `${amountLabel} ${state.swap.inputToken.symbol} -> - ${state.swap.outputToken.symbol}`
  }

  summaryRoot.innerHTML = ''
  routeListRoot.innerHTML = ''
  if (selectedRoutePill) selectedRoutePill.textContent = hasReadyPreview ? 'Best' : ''

  if (executeButton) {
    if (!walletReady) {
      executeButton.textContent = 'Import wallet to swap'
      executeButton.disabled = true
    } else if (!walletUnlocked) {
      executeButton.textContent = 'Unlock wallet to swap'
      executeButton.disabled = true
    } else if (state.swap.status === 'executing') {
      executeButton.textContent = 'Executing swap...'
      executeButton.disabled = true
    } else if (state.swap.busy && !hasReadyPreview) {
      executeButton.textContent = 'Refreshing quote...'
      executeButton.disabled = true
    } else if (isBackgroundRefreshing && hasReadyPreview) {
      executeButton.textContent = `Swap ${state.swap.inputToken.symbol} -> ${state.swap.outputToken.symbol}`
      executeButton.disabled = false
    } else if (state.swap.status === 'stale' || previewIsActuallyStale) {
      executeButton.textContent = 'Refresh stale quote'
      executeButton.disabled = !hasAmount || state.swap.busy
    } else if (!preview || !activeRoute) {
      executeButton.textContent = hasAmount ? 'Waiting for quote' : 'Enter amount to quote'
      executeButton.disabled = true
    } else if (activeRoute.executable === false) {
      executeButton.textContent = 'Route not executable'
      executeButton.disabled = true
    } else {
      executeButton.textContent = `Swap ${state.swap.inputToken.symbol} -> ${state.swap.outputToken.symbol}`
      executeButton.disabled = false
    }
  }

  const cachedInputBalance = getCachedSwapTokenBalance(state.swap.inputToken)
  const cachedOutputBalance = getCachedSwapTokenBalance(state.swap.outputToken)
  const displayInputBalance = cachedInputBalance?.balance != null
    ? Number(cachedInputBalance.balance)
    : (preview?.wallet?.balanceIn != null ? Number(preview.wallet.balanceIn || 0) : null)
  const displayOutputBalance = cachedOutputBalance?.balance != null
    ? Number(cachedOutputBalance.balance)
    : (preview?.wallet?.balanceOut != null ? Number(preview.wallet.balanceOut || 0) : null)
  if (balanceInNode) balanceInNode.textContent = `${formatSwapBalanceAmount(displayInputBalance, state.swap.inputToken?.decimals)} ${state.swap.inputToken.symbol}`
  if (balanceOutNode) balanceOutNode.textContent = `${formatSwapBalanceAmount(displayOutputBalance, state.swap.outputToken?.decimals)} ${state.swap.outputToken.symbol}`
  if (outputEstimateNode) outputEstimateNode.textContent = activeRoute ? formatTokenQuantity(activeRoute.quotedAmountOutDisplay || 0) : '-'
  if (minReceiveNode) minReceiveNode.textContent = activeRoute ? `${formatTokenQuantity(activeRoute.amountOutMinimumDisplay || 0)} ${state.swap.outputToken.symbol}` : '-'
  if (bestVenueNode) bestVenueNode.textContent = activeRoute ? `${activeRoute.dex} ${formatRouteFeePct(activeRoute.fee)}` : '-'
  if (priceImpactNode) priceImpactNode.textContent = priceImpactLabel
  if (routeCountChip) routeCountChip.textContent = `${(preview?.routes || []).length} routes`
  if (quoteFreshnessNode) quoteFreshnessNode.textContent = quoteFreshnessLabel

  updateSwapAmountFiatDisplay()

  if (!preview || !activeRoute) {
    if (rateNode) rateNode.textContent = 'Rate: -'
    const idleCopy = describeSwapIdleState({
      walletReady,
      walletUnlocked,
      hasAmount,
      status: previewIsActuallyStale ? 'stale' : state.swap.status,
      feedback
    })
    subtitleNode.textContent = idleCopy.subtitle
    renderSwapEmptyState(summaryRoot, idleCopy.summary[0], idleCopy.summary[1])
    if (!hasAmount) {
      renderSwapEmptyState(routeListRoot, idleCopy.routeList[0], idleCopy.routeList[1])
      if (routeCountChip) routeCountChip.textContent = '0 routes'
      if (quoteFreshnessNode) quoteFreshnessNode.textContent = idleCopy.freshness
      return
    }
    getSupportedSwapPoolHints().forEach((label, index) => {
      const feeMatch = String(label).match(/(\d+(?:\.\d+)?%)/)
      const feeTier = feeMatch ? feeMatch[1] : '-'
      const dexLabel = String(label).replace(/\s+\d+(?:\.\d+)?%.*$/, '')
      const item = document.createElement('div')
      item.className = `swap-route-row-pro swap-route-item-static${index === 0 ? ' active' : ''}`
      item.innerHTML = `
        <div class="swap-route-card-top">
          <span class="swap-route-index">${escapeHtml(String(index + 1))}</span>
          <div class="swap-route-pathline">
            ${renderSwapTokenIcon(state.swap.inputToken, 'swap-route-coin')}
            <span class="swap-route-arrow">-></span>
            ${renderSwapDexNode(dexLabel)}
            <span class="swap-route-arrow">-></span>
            ${renderSwapTokenIcon(state.swap.outputToken, 'swap-route-coin swap-route-coin-out')}
          </div>
          <div class="swap-route-output-block">
            ${index === 0 ? '<span class="swap-route-badge">Best</span>' : ''}
            <strong>- ${escapeHtml(state.swap.outputToken.symbol)}</strong>
            <small>$0.00</small>
          </div>
        </div>
        <div class="swap-route-card-meta">
          <span>Fee Tier <strong>${escapeHtml(feeTier)}</strong></span>
          <span>Liquidity <strong>n/a</strong></span>
          <span>Min. received <strong>- ${escapeHtml(state.swap.outputToken.symbol)}</strong></span>
          <span>Price impact <strong>-</strong></span>
        </div>
        <div class="swap-route-detail">
          <span>${escapeHtml(idleCopy.routeList[0])}</span>
        </div>
      `
      routeListRoot.appendChild(item)
    })
    if (!routeListRoot.children.length) {
      renderSwapEmptyState(routeListRoot, idleCopy.routeList[0], idleCopy.routeList[1])
    }
    if (routeCountChip) routeCountChip.textContent = hasAmount ? 'Best route' : '0 routes'
    if (quoteFreshnessNode) quoteFreshnessNode.textContent = idleCopy.freshness
    bindSwapTokenIconFallbacks(routeListRoot)
    bindSwapDexIconFallbacks(routeListRoot)
    return
  }

  const routeRate = Number(preview.amountIn || 0) > 0
    ? Number(activeRoute.quotedAmountOutDisplay || 0) / Number(preview.amountIn || 0)
    : 0
  const secondRoute = routes.find((route) => route.routeId !== activeRoute.routeId) || null
  const activeRouteIsBest = Boolean(activeRoute?.isBest || (bestRoute?.routeId && activeRoute?.routeId === bestRoute.routeId))
  const routeGapPct = secondRoute && Number(secondRoute.quotedAmountOutDisplay || 0) > 0 && Number(activeRoute.quotedAmountOutDisplay || 0) > 0
    ? ((Number(activeRoute.quotedAmountOutDisplay || 0) / Number(secondRoute.quotedAmountOutDisplay || 0)) - 1) * 100
    : 0

  if (selectedRoutePill) selectedRoutePill.textContent = activeRouteIsBest ? 'Best' : 'Selected'

  if (rateNode) {
    rateNode.textContent = routeRate > 0
      ? `Rate 1 ${preview.tokenIn.symbol} = ${formatTokenQuantity(routeRate)} ${preview.tokenOut.symbol}`
      : 'Rate: -'
  }
  if (directionLineNode) {
    directionLineNode.textContent = `${formatTokenQuantity(preview.amountIn || 0)} ${preview.tokenIn.symbol} -> ${formatTokenQuantity(activeRoute.quotedAmountOutDisplay || 0)} ${preview.tokenOut.symbol}`
  }

  subtitleNode.textContent = isBackgroundRefreshing
    ? `${preview.tokenIn.symbol} -> ${preview.tokenOut.symbol} | updating route in background | ${truncateAddress(preview.wallet.address)}`
    : `${preview.tokenIn.symbol} -> ${preview.tokenOut.symbol} | ${preview.quote?.generatedAt ? new Date(preview.quote.generatedAt).toLocaleTimeString() : 'live quote'} | ${truncateAddress(preview.wallet.address)}`

  const summaryRows = [
    ['Input Value', preview.market?.inputValueUsd > 0 ? formatUsd(preview.market.inputValueUsd) : `${formatTokenQuantity(preview.amountIn || 0)} ${preview.tokenIn.symbol}`, 'Wallet-funded sell size'],
    ['Selected Output', `${formatTokenQuantity(activeRoute.quotedAmountOutDisplay || 0)} ${preview.tokenOut.symbol}`, routeGapPct > 0 ? `+${routeGapPct.toFixed(2)}% vs next route` : 'Current route'],
    ['Protected Min Out', `${formatTokenQuantity(activeRoute.amountOutMinimumDisplay || 0)} ${preview.tokenOut.symbol}`, `Slippage ${Number(preview.slippagePct || 0).toFixed(2)}%`],
    ['Quote Freshness', quoteFreshnessLabel, `${Math.round((Number(preview.quote.staleAfterMs || 0) || SWAP_QUOTE_STALE_FALLBACK_MS) / 1000)}s stale window`]
  ]
  for (const [label, value, meta] of summaryRows) {
    const tile = document.createElement('div')
    tile.className = 'swap-summary-tile'
    tile.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${meta ? `<small class="swap-summary-subtext">${escapeHtml(meta)}</small>` : ''}`
    summaryRoot.appendChild(tile)
  }

  for (const route of routes) {
    const feePct = formatRouteFeeLabel(route)
    const liquidityLabel = formatOptionalUsd(route.liquidityUsd)
    const volume24hLabel = formatOptionalUsd(route.volume24hUsd)
    const volume1hLabel = formatOptionalUsd(route.volume1hUsd)
    const quotedAmountOutDisplay = route.quotedAmountOutDisplay
      ?? route.amountOutDisplay
      ?? route.expectedOutDisplay
      ?? 0
    const amountOutMinimumDisplay = route.amountOutMinimumDisplay
      ?? route.minReceivedDisplay
      ?? route.minAmountOutDisplay
      ?? route.minimumReceivedDisplay
      ?? 0
    const expectedOutLabel = `${formatTokenQuantity(quotedAmountOutDisplay)} ${preview.tokenOut.symbol}`
    const protectedMinLabel = `${formatTokenQuantity(amountOutMinimumDisplay)} ${preview.tokenOut.symbol}`
    const hopsLabel = `${Math.max(1, Array.isArray(route.hops) ? route.hops.length : 1)} hop`
    const routeKindLabel = String(route.routeKind || 'direct') === 'multi-hop'
      ? 'Multi-hop'
      : (String(route.routeKind || 'direct') === 'v4-quote-only' ? 'V4 quote only' : 'Direct pool')
    const rankLabel = `#${Number(route.rank || 0) || '-'}`
    const edgeLabel = route.isBest ? 'Best price' : formatRouteEdge(route)
    const routeDepthLabel = formatRouteDepth(route)
    const directionLabel = `${formatTokenQuantity(preview.amountIn || 0)} ${preview.tokenIn.symbol} -> ${formatTokenQuantity(quotedAmountOutDisplay)} ${preview.tokenOut.symbol}`
    const isSelectedRoute = route.routeId === activeRoute.routeId
    const routeIndex = Number(route.rank || 0) || (routes.indexOf(route) + 1)
    const impactLabel = `${Number(route.priceImpactPct ?? preview.metrics?.priceImpactPct ?? 0).toFixed(2)}%`
    const item = document.createElement('button')
    item.type = 'button'
    item.className = `swap-route-row-pro${isSelectedRoute ? ' active' : ''}${route.executable === false ? ' disabled' : ''}`
    item.disabled = route.executable === false
    item.title = route.executable === false ? (route.disabledReason || 'Route is visible but not executable yet.') : ''
    item.innerHTML = `
      <div class="swap-route-card-top">
        <span class="swap-route-index">${escapeHtml(String(routeIndex))}</span>
        <div class="swap-route-pathline">
          ${renderSwapTokenIcon(preview.tokenIn, 'swap-route-coin')}
          <span class="swap-route-arrow">-></span>
          ${renderSwapDexNode(route.dex)}
          ${String(routeKindLabel).toLowerCase().includes('multi') ? `<span class="swap-route-arrow">-></span>${renderSwapDexNode('Hop')}` : ''}
          <span class="swap-route-arrow">-></span>
          ${renderSwapTokenIcon(preview.tokenOut, 'swap-route-coin swap-route-coin-out')}
        </div>
        <div class="swap-route-output-block">
          ${route.isBest ? '<span class="swap-route-badge">Best</span>' : ''}
          ${isSelectedRoute ? '<span class="swap-route-badge swap-route-selected-badge">Selected</span>' : ''}
          ${route.executable === false ? '<span class="swap-route-badge">Quote only</span>' : ''}
          <strong>${escapeHtml(expectedOutLabel)}</strong>
          <small>${escapeHtml(formatOptionalUsd(route.estimatedOutputUsd || preview.market?.outputValueUsd))}</small>
        </div>
      </div>
      <div class="swap-route-card-meta">
        <span>Fee Tier <strong>${escapeHtml(feePct)}</strong></span>
        <span>Liquidity <strong>${escapeHtml(liquidityLabel)}</strong></span>
        <span>Min. received <strong>${escapeHtml(protectedMinLabel)}</strong></span>
        <span>Price impact <strong>${escapeHtml(impactLabel)}</strong></span>
      </div>
      <div class="swap-route-detail">
        <span>${escapeHtml(`${routeKindLabel} | ${hopsLabel}`)}</span>
        <span>${escapeHtml(routeDepthLabel)}</span>
        <span>${escapeHtml(edgeLabel)}</span>
      </div>
      <div class="swap-route-address">
        <span>${escapeHtml(`Pool ${truncateAddress(route.poolAddress)}`)}</span>
        ${route.poolAddress ? `<span class="swap-route-pool-copy" role="button" tabindex="0" data-swap-copy-pool="${escapeHtml(route.poolAddress)}" aria-label="Copy pool address"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v10H9z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5h10" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></span>` : ''}
      </div>
      ${route.executable === false ? `<div class="swap-route-address">${escapeHtml(route.disabledReason || 'Quote-only route')}</div>` : ''}
    `
    for (const copyButton of item.querySelectorAll('[data-swap-copy-pool]')) {
      const copyPool = async (event) => {
        event.preventDefault()
        event.stopPropagation()
        const copied = await copyToClipboard(copyButton.dataset.swapCopyPool || '')
        if (copied) {
          copyButton.classList.add('copied')
          setTimeout(() => copyButton.classList.remove('copied'), 900)
        }
      }
      copyButton.addEventListener('click', copyPool)
      copyButton.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          copyPool(event)
        }
      })
    }
    item.addEventListener('click', () => {
      if (route.executable === false) return
      state.swap.selectedRouteId = route.routeId
      state.swap.selectedRoutePinned = true
      state.swap.status = 'refreshing'
      state.swap.feedback = `Checking selected route: ${route.dex} ${feePct}.`
      renderSwapPanel()
      runSwapPreview('route-selection').catch(() => {})
    })
    routeListRoot.appendChild(item)
  }
  bindSwapTokenIconFallbacks(routeListRoot)
  bindSwapDexIconFallbacks(routeListRoot)
}

function applySwapAmountShortcut(shortcut) {
  const amountNode = document.getElementById('swap-amount-in')
  const cachedBalance = getCachedSwapTokenBalance(state.swap.inputToken)
  const balance = Number(
    cachedBalance?.balance
    || state.swap.preview?.wallet?.balanceIn
    || 0
  )
  const tokenDecimals = Number(state.swap.inputToken?.decimals || cachedBalance?.decimals || 18)
  const shortcutDigits = Math.max(2, Math.min(6, tokenDecimals))
  if (!amountNode || !Number.isFinite(balance) || balance <= 0) {
    setSwapFeedback('Balance is still loading. Try again in a moment.', 'info')
    renderSwapPanel()
    return
  }

  let nextAmount = balance
  if (shortcut === '25%') {
    nextAmount = balance * 0.25
  } else if (shortcut === '50%') {
    nextAmount = balance * 0.5
  } else if (shortcut === '75%') {
    nextAmount = balance * 0.75
  }

  amountNode.value = String(floorTokenAmount(nextAmount, shortcutDigits))
  state.swap.lastExecutionFeedback = ''
  state.swap.lastExecutionAtMs = 0
  state.swap.lastExecutionSummary = null
  setSwapFeedback('', 'info')
  updateSwapAmountFiatDisplay()
  renderSwapPanel()
  scheduleSwapQuote('typing')
}

function getExecutionAnchorPrice(card, setup = state.positionSetup) {
  const liveReferencePrice = Number(resolveSetupReferencePrice(card) || 0)
  const storedAnchorPrice = Number(setup?.anchorPrice || 0)
  const anchorLocked = Boolean(setup?.anchorLocked)

  if (!anchorLocked && liveReferencePrice > 0) {
    return liveReferencePrice
  }

  if (storedAnchorPrice > 0) {
    return storedAnchorPrice
  }

  return liveReferencePrice > 0 ? liveReferencePrice : 0
}

function buildExecutionReadySetup(card, setup = state.positionSetup) {
  const anchorPrice = getExecutionAnchorPrice(card, setup)
  return {
    ...setup,
    anchorPrice: anchorPrice > 0 ? anchorPrice : null
  }
}

async function loadKeystoreState() {
  try {
    const payload = await fetchJson('/api/keystore-status')
    state.keystore.status = payload.status || null
    state.keystore.wallets = payload.wallets || []
  } catch (error) {
    state.keystore.feedback = error.message
  }

  renderKeystorePanel()
  loadSwapSettings()
  refreshSwapAutoQuoteLoop()
  renderSwapPanel()
  if (state.keystore.status?.unlocked) {
    refreshSelectedSwapBalances().catch(() => {})
  }
  if (state.swap.selector.open) {
    fetchSwapTokenCatalog().catch(() => {})
  }
  if (state.activeView === 'swap' && !state.swap.busy && !state.swap.preview && !['error', 'insufficient', 'failure'].includes(String(state.swap.status || '')) && Number(getSwapInputAmountValue() || 0) > 0) {
    scheduleSwapQuote('wallet-refresh')
  }
}

async function refreshKeystoreState(message = null) {
  if (message) {
    state.keystore.feedback = message
  }
  await loadKeystoreState()
}

async function refreshSelectedSwapBalances() {
  const tokenQueries = [getSwapBalanceQueryToken(state.swap.inputToken), getSwapBalanceQueryToken(state.swap.outputToken)]
    .filter(Boolean)
    .join(',')
  if (!state.keystore.status?.unlocked || !tokenQueries) {
    state.swap.walletBalanceByAddress = {}
    renderSwapPanel()
    return
  }

  const payload = await fetchJson(`/api/swap-balances?tokens=${encodeURIComponent(tokenQueries)}`)
  state.swap.walletBalanceByAddress = Object.fromEntries(
    (payload.balances || []).map((item) => [String(item.balanceKey || item.address || '').toLowerCase(), item])
  )
  renderSwapPanel()
}

async function refreshSwapWalletBalances() {
  const preview = state.swap.preview
  if (!preview?.tokenIn?.address || !preview?.tokenOut?.address) {
    await refreshSelectedSwapBalances()
    return
  }

  const tokenQueries = [getSwapBalanceQueryToken(preview.tokenIn), getSwapBalanceQueryToken(preview.tokenOut)]
    .filter(Boolean)
    .join(',')
  if (!state.keystore.status?.unlocked || !tokenQueries) {
    renderSwapPanel()
    return
  }
  const payload = await fetchJson(`/api/swap-balances?tokens=${encodeURIComponent(tokenQueries)}`)
  const balanceByAddress = new Map((payload.balances || []).map((item) => [String(item.balanceKey || item.address || '').toLowerCase(), item]))
  const inputBalance = balanceByAddress.get(getSwapBalanceCacheKey(preview.tokenIn))
  const outputBalance = balanceByAddress.get(getSwapBalanceCacheKey(preview.tokenOut))

  if (inputBalance && inputBalance.balanceRaw != null) {
    preview.wallet.balanceIn = Number(inputBalance.balance || 0)
    preview.wallet.balanceInRaw = String(inputBalance.balanceRaw)
  }
  if (outputBalance && outputBalance.balanceRaw != null) {
    preview.wallet.balanceOut = Number(outputBalance.balance || 0)
    preview.wallet.balanceOutRaw = String(outputBalance.balanceRaw)
  }
  state.swap.walletBalanceByAddress = Object.fromEntries((payload.balances || []).map((item) => [String(item.balanceKey || item.address || '').toLowerCase(), item]))

  renderSwapPanel()
}

function scheduleSwapTokenCatalogRefresh(delayMs = 800) {
  if (state.swap.selector.catalogRefreshTimer) {
    clearTimeout(state.swap.selector.catalogRefreshTimer)
    state.swap.selector.catalogRefreshTimer = null
  }
  if (!state.swap.selector.open) {
    return
  }
  state.swap.selector.catalogRefreshTimer = setTimeout(() => {
    state.swap.selector.catalogRefreshTimer = null
    if (state.swap.selector.open) {
      fetchSwapTokenCatalog().catch(() => {})
    }
  }, Math.max(0, Number(delayMs || 0)))
}

function queuePostSwapRefresh() {
  refreshSelectedSwapBalances().catch(() => {})
  if (state.swap.selector.open) {
    scheduleSwapTokenCatalogRefresh(650)
  }
  setTimeout(() => {
    if (state.activeView === 'swap') {
      refreshSelectedSwapBalances().catch(() => {})
    }
    if (state.swap.selector.open) {
      scheduleSwapTokenCatalogRefresh()
    }
  }, 650)
  setTimeout(() => {
    if (state.activeView === 'swap') {
      refreshSelectedSwapBalances().catch(() => {})
    }
    if (state.swap.selector.open) {
      scheduleSwapTokenCatalogRefresh()
    }
  }, 1800)
}

async function runSwapFullRouteExpansion(reason = 'route-expansion') {
  if (!state.swap.preview || state.swap.status === 'executing') {
    return
  }
  const payload = getSwapFormPayload()
  const amount = Number(payload.amountIn || 0)
  if (!payload.tokenIn || !payload.tokenOut || !Number.isFinite(amount) || amount <= 0) {
    return
  }

  const requestSeq = state.swap.activeRequestSeq
  const requestController = new AbortController()
  let quoteTimedOut = false
  const quoteTimeout = setTimeout(() => {
    quoteTimedOut = true
    requestController.abort()
  }, SWAP_PREVIEW_TIMEOUT_MS)
  state.swap.backgroundRefreshing = true
  if (!hasRecentSwapExecutionSuccess()) {
    state.swap.feedback = reason === 'route-expansion'
      ? 'Expanding route list...'
      : 'Updating route list...'
  }
  renderSwapPanel()

  try {
    const response = await postJson('/api/swap-preview', {
      ...payload,
      routeMode: 'full',
      preferredRouteId: state.swap.selectedRoutePinned
        ? (state.swap.selectedRouteId || state.swap.preview?.selectedRouteId || null)
        : null
    }, { signal: requestController.signal })
    if (requestSeq !== state.swap.activeRequestSeq) return
    if (response?.ok === false || !response?.preview) {
      return
    }
    const preserveSuccessFeedback = hasRecentSwapExecutionSuccess()
    state.swap.preview = response.preview || null
    state.swap.selectedRouteId = state.swap.selectedRoutePinned
      ? (response.preview?.selectedRouteId || response.preview?.bestRoute?.routeId || state.swap.selectedRouteId || null)
      : (response.preview?.bestRoute?.routeId || response.preview?.selectedRouteId || null)
    state.swap.status = preserveSuccessFeedback ? 'success' : 'quoted'
    state.swap.feedback = preserveSuccessFeedback ? state.swap.lastExecutionFeedback : 'Route list expanded.'
    clearSwapQuoteTimers()
    state.swap.staleTimer = setTimeout(() => {
      if (state.swap.preview) {
        if (hasRecentSwapExecutionSuccess()) {
          state.swap.status = 'success'
          state.swap.feedback = state.swap.lastExecutionFeedback
          renderSwapPanel()
          return
        }
        state.swap.status = 'stale'
        state.swap.backgroundRefreshing = false
        state.swap.feedback = 'Quote is stale. Refresh before executing the swap.'
        renderSwapPanel()
      }
    }, Number(response.preview?.quote?.staleAfterMs || SWAP_QUOTE_STALE_FALLBACK_MS))
    refreshSwapAutoQuoteLoop()
  } catch (error) {
    if (error.name === 'AbortError' && quoteTimedOut && requestSeq === state.swap.activeRequestSeq && !hasRecentSwapExecutionSuccess()) {
      state.swap.feedback = 'Full route refresh timed out. Latest confirmed route is still shown.'
    }
  } finally {
    clearTimeout(quoteTimeout)
    if (requestSeq === state.swap.activeRequestSeq) {
      state.swap.backgroundRefreshing = false
      renderSwapPanel()
    }
  }
}

async function runSwapPreview(reason = 'manual') {
  const payload = getSwapFormPayload()
  const amount = Number(payload.amountIn || 0)
  if (!payload.tokenIn || !payload.tokenOut || !Number.isFinite(amount) || amount <= 0) {
    state.swap.preview = null
    state.swap.status = 'idle'
    state.swap.feedback = ''
    renderSwapPanel()
    return
  }

  const requestSeq = ++state.swap.requestSeq
  const hasExistingPreview = Boolean(state.swap.preview && getActiveSwapRoute())
  const isBackgroundRefresh = hasExistingPreview && ['auto-refresh', 'visibility'].includes(String(reason || ''))
  const preferredRouteId = state.swap.selectedRoutePinned ? (state.swap.selectedRouteId || null) : null
  const previewRouteMode = preferredRouteId || isBackgroundRefresh || reason === 'route-selection' ? 'full' : 'fast'
  cancelSwapPreviewRequest()
  const requestController = new AbortController()
  let quoteTimedOut = false
  let shouldExpandFullRoutes = false
  const quoteTimeout = setTimeout(() => {
    quoteTimedOut = true
    requestController.abort()
  }, SWAP_PREVIEW_TIMEOUT_MS)
  state.swap.activeRequestSeq = requestSeq
  state.swap.previewRequestController = requestController
  state.swap.busy = !isBackgroundRefresh
  state.swap.backgroundRefreshing = isBackgroundRefresh
  if (!isBackgroundRefresh) {
    state.swap.status = 'refreshing'
    state.swap.feedback = reason === 'auto-refresh'
      ? 'Refreshing route...'
      : 'Scanning supported pools...'
  } else {
    state.swap.feedback = 'Updating route in background...'
  }
  renderSwapPanel()

  try {
    const response = await postJson('/api/swap-preview', {
      ...payload,
      routeMode: previewRouteMode,
      preferredRouteId
    }, { signal: requestController.signal })
    if (requestSeq !== state.swap.activeRequestSeq) return
    if (response?.ok === false || !response?.preview) {
      throw new Error(response?.error || 'Swap quote is unavailable right now.')
    }
    const preserveSuccessFeedback = isBackgroundRefresh && hasRecentSwapExecutionSuccess()
    state.swap.preview = response.preview || null
    state.swap.selectedRouteId = state.swap.selectedRoutePinned
      ? (response.preview?.selectedRouteId || response.preview?.bestRoute?.routeId || null)
      : (response.preview?.bestRoute?.routeId || response.preview?.selectedRouteId || null)
    state.swap.status = preserveSuccessFeedback ? 'success' : 'quoted'
    if (!preserveSuccessFeedback) {
      state.swap.feedback = isBackgroundRefresh
        ? 'Route updated.'
        : (swapRouteIdsEqual(response.preview?.selectedRouteId, response.preview?.bestRoute?.routeId)
            ? 'Route ready.'
            : 'Route refreshed and preserved.')
    } else {
      state.swap.feedback = state.swap.lastExecutionFeedback
    }
    clearSwapQuoteTimers()
    state.swap.staleTimer = setTimeout(() => {
      if (state.swap.preview) {
        if (hasRecentSwapExecutionSuccess()) {
          state.swap.status = 'success'
          state.swap.feedback = state.swap.lastExecutionFeedback
          renderSwapPanel()
          return
        }
        state.swap.status = 'stale'
        state.swap.backgroundRefreshing = false
        state.swap.feedback = 'Quote is stale. Refresh before executing the swap.'
        renderSwapPanel()
      }
    }, Number(response.preview?.quote?.staleAfterMs || SWAP_QUOTE_STALE_FALLBACK_MS))
    refreshSwapAutoQuoteLoop()
    shouldExpandFullRoutes = !isBackgroundRefresh && response.preview?.quote?.mode === 'fast' && !preferredRouteId
  } catch (error) {
    if (error.name === 'AbortError') {
      if (quoteTimedOut && requestSeq === state.swap.activeRequestSeq) {
        if (hasExistingPreview) {
          if (isSwapPreviewActuallyStale(state.swap.preview)) {
            state.swap.status = 'stale'
            state.swap.feedback = 'Quote refresh timed out. Refresh before executing the swap.'
          } else {
            state.swap.status = 'quoted'
            state.swap.feedback = 'Quote refresh timed out. Latest confirmed route is still shown.'
          }
          refreshSwapAutoQuoteLoop()
        } else {
          state.swap.preview = null
          state.swap.selectedRouteId = null
          state.swap.status = 'error'
          state.swap.feedback = 'Quote refresh timed out. Try again in a moment.'
        }
      }
      return
    }
    if (requestSeq !== state.swap.activeRequestSeq) return
    if (isBackgroundRefresh && hasExistingPreview) {
      if (isSwapPreviewActuallyStale(state.swap.preview)) {
        state.swap.status = 'stale'
        state.swap.feedback = 'Background refresh failed and the quote is stale. Refresh before executing the swap.'
      } else {
        state.swap.status = 'quoted'
        state.swap.feedback = 'Background quote refresh failed. Latest confirmed route is still shown.'
      }
      refreshSwapAutoQuoteLoop()
    } else {
      state.swap.preview = null
      state.swap.selectedRouteId = null
      state.swap.status = /insufficient/i.test(String(error.message || '')) ? 'insufficient' : 'error'
      state.swap.feedback = error.message
    }
  } finally {
    clearTimeout(quoteTimeout)
    if (requestSeq === state.swap.activeRequestSeq) {
      if (state.swap.previewRequestController === requestController) {
        state.swap.previewRequestController = null
      }
      state.swap.busy = false
      state.swap.backgroundRefreshing = false
      renderSwapPanel()
      if (shouldExpandFullRoutes && state.swap.preview && requestSeq === state.swap.activeRequestSeq) {
        runSwapFullRouteExpansion('route-expansion').catch(() => {})
      }
    }
  }
}

async function runSwapExecute() {
  const preview = state.swap.preview
  const activeRoute = getActiveSwapRoute()
  if (!preview || !activeRoute) {
    setSwapFeedback('Refresh the quote before swapping.', 'danger')
    showSwapToast('danger', 'Swap needs a fresh quote')
    renderSwapPanel()
    return
  }
  if (state.swap.status === 'stale' || isSwapPreviewActuallyStale(preview)) {
    setSwapFeedback('Refresh the stale quote before executing the swap.', 'danger')
    showSwapToast('danger', 'Quote is stale')
    renderSwapPanel()
    return
  }
  const executionKey = buildSwapExecutionKey(activeRoute)
  if (state.swap.executingKey && state.swap.executingKey === executionKey) {
    setSwapFeedback('Swap is already running. Wait for confirmation.', 'info')
    renderSwapPanel()
    return
  }
  if (
    state.swap.lastExecutionKey
    && state.swap.lastExecutionKey === executionKey
    && Number(state.swap.lastExecutionAtMs || 0) > 0
    && Date.now() - Number(state.swap.lastExecutionAtMs || 0) < SWAP_DUPLICATE_GUARD_MS
  ) {
    setSwapFeedback('This exact swap was already confirmed recently. Change amount or wait.', 'info')
    renderSwapPanel()
    return
  }

  cancelSwapPreviewRequest()
  clearSwapQuoteTimers()
  state.swap.activeRequestSeq = ++state.swap.requestSeq
  state.swap.busy = true
  state.swap.status = 'executing'
  state.swap.backgroundRefreshing = false
  state.swap.executingKey = executionKey
  setSwapFeedback('Executing selected route...', 'info')
  renderSwapPanel()
  try {
    const payload = await postJson('/api/swap-execute', {
      ...getSwapFormPayload(),
      selectedRouteId: activeRoute.routeId,
      selectedRouteSnapshot: activeRoute,
      quoteContext: {
        generatedAt: preview.quote?.generatedAt || null,
        generatedAtMs: preview.quote?.generatedAtMs || null,
        requestKey: preview.quote?.requestKey || null
      }
    })
    state.swap.preview = payload.preview || null
    state.swap.selectedRouteId = payload.executedRouteId || payload.preview?.selectedRouteId || payload.preview?.bestRoute?.routeId || null
    state.swap.lastExecutionSummary = payload.executionSummary || null
    state.swap.status = 'success'
    const executionModeLabel = payload.executionSummary?.approvalRequired ? 'Approve + swap' : 'Swap'
    setSwapFeedback(`${executionModeLabel} confirmed.`, 'success')
    showSwapToast('success', `${executionModeLabel} confirmed`)
    state.swap.lastExecutionFeedback = state.swap.feedback
    state.swap.lastExecutionAtMs = Date.now()
    state.swap.lastExecutionKey = executionKey
    state.swap.preview = null
    state.swap.selectedRouteId = null
    const amountNode = document.getElementById('swap-amount-in')
    if (amountNode) {
      amountNode.value = ''
    }
  } catch (error) {
    state.swap.status = 'failure'
    const message = formatSwapErrorMessage(error.message)
    setSwapFeedback(message, 'danger')
    showSwapToast('danger', 'Swap failed', message)
  } finally {
    state.swap.busy = false
    state.swap.backgroundRefreshing = false
    state.swap.executingKey = ''
    renderSwapPanel()
    if (state.swap.status === 'success') {
      queuePostSwapRefresh()
      refreshSwapAutoQuoteLoop()
    }
  }
}

function formatRawTokenAmount(value, symbol = '', decimals) {
  const raw = String(value || '')
  if (!raw || !/^\d+$/.test(raw)) {
    return value || 'n/a'
  }

  const resolvedDecimals = Number.isFinite(Number(decimals))
    ? Number(decimals)
    : (TOKEN_DECIMALS[String(symbol || '').toLowerCase()] ?? 18)
  const padded = raw.padStart(resolvedDecimals + 1, '0')
  const splitIndex = padded.length - resolvedDecimals
  const integer = padded.slice(0, splitIndex)
  const fraction = padded.slice(splitIndex).replace(/0+$/, '')
  const asNumber = Number(`${integer}${fraction ? `.${fraction.slice(0, 6)}` : ''}`)

  if (!Number.isFinite(asNumber)) {
    return `${raw} ${symbol}`.trim()
  }

  return `${formatCompact(asNumber)} ${symbol}`.trim()
}

function saveActiveViewScrollPosition(view = state.activeView) {
  if (!view) {
    return
  }
  state.viewScrollPositions[view] = window.scrollY || window.pageYOffset || 0
}

function restoreActiveViewScrollPosition(view = state.activeView) {
  const hasVisited = Boolean(state.visitedViews[view])
  const nextY = hasVisited ? Number(state.viewScrollPositions[view] || 0) : 0
  state.visitedViews[view] = true
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: Math.max(0, nextY), left: 0, behavior: 'auto' })
  })
}

function setActiveView(view) {
  const previousView = state.activeView
  const viewChanged = view !== previousView
  if (viewChanged) {
    saveActiveViewScrollPosition(state.activeView)
  }
  state.activeView = view
  document.body.classList.toggle('swap-view-active', view === 'swap')
  document.querySelector('.app-header')?.classList.toggle('app-header-manage', view === 'manage')

  for (const node of document.querySelectorAll('.view-section')) {
    node.classList.toggle('active', node.id === `view-${view}`)
  }

  for (const node of document.querySelectorAll('.nav-link')) {
    node.classList.toggle('active', node.dataset.view === view)
  }

  const titles = {
    'pool-search': ['Pool Search', ''],
    'create': ['Create', 'Configure Bid/Ask or Spot entry and inspect the ladder before opening.'],
    'swap': ['Swap', 'Manual swap terminal for supported BNB pools with wallet-aware holdings and settings-driven slippage.'],
    'manage': ['Manage', 'Monitor live ranges, pnl, fees and close flow like an operator console.'],
    'settings': ['Settings', 'Node, local wallet generation, and operator links.']
  }
  const [title, subtitle] = titles[view] || titles['pool-search']
  setText('app-title', title)
  setText('app-subtitle', subtitle)
  syncHeaderContextForView()
  renderUpdatedHeader()
  if (view === 'swap' && state.keystore.status?.unlocked) {
    refreshSelectedSwapBalances().catch(() => {})
  }
  if (view === 'swap' && !state.swap.preview && !state.swap.busy && Number(getSwapInputAmountValue() || 0) > 0) {
    scheduleSwapQuote('view-enter')
  }
  if (view === 'settings') {
    renderSettingsPanel()
  }
  if (viewChanged || !state.visitedViews[view]) {
    restoreActiveViewScrollPosition(view)
  }
}

function getManageHeaderCard(openCards) {
  if (!Array.isArray(openCards) || !openCards.length) {
    return null
  }

  const groups = new Map()
  for (const card of openCards) {
    const key = String(card.poolAddress || `${card.tokenSymbol || 'TOKEN'}/${card.quoteTokenSymbol || 'QUOTE'}`).toLowerCase()
    const currentValueQuote = Number(card.currentValueQuote || 0)
    const currentPoolPrice = Number(card.currentPoolPrice || 0)
    const bucket = groups.get(key) || {
      card,
      count: 0,
      totalValueQuote: 0,
      latestPoolPrice: currentPoolPrice
    }
    bucket.count += 1
    bucket.totalValueQuote += currentValueQuote
    if (Number.isFinite(currentPoolPrice) && currentPoolPrice > 0) {
      bucket.latestPoolPrice = currentPoolPrice
      bucket.card = {
        ...bucket.card,
        currentPoolPrice
      }
    }
    groups.set(key, bucket)
  }

  return Array.from(groups.values())
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count
      }
      return right.totalValueQuote - left.totalValueQuote
    })[0]?.card || openCards[0]
}

function syncHeaderContextForView(snapshot = state.lastSnapshot) {
  const selectedCard = getSelectedCardFromState()
  if (selectedCard) {
    renderSelectedPoolPanel(selectedCard, state.filters?.feeTvlInterval)
    return
  }

  if (state.activeView === 'manage') {
    const openCards = snapshot?.dashboard?.positions?.openCards || []
    const manageCard = getManageHeaderCard(openCards)
    if (manageCard) {
      setText('header-selected-pool', getPairDisplayLabel(manageCard))
      setText('header-selected-price', formatNumber(Number(manageCard.currentPoolPrice || 0), 6))
      return
    }
  }

  renderSelectedPoolPanel(null, state.filters?.feeTvlInterval)
}

function renderWalletSummary(summary) {
  const root = document.getElementById('wallet-summary')
  if (!root) {
    return
  }
  root.innerHTML = ''
  const rows = [
    ['Positions', summary.positions],
    ['Cost Basis', formatUsd(summary.totalCostBasisQuote || 0)],
    ['Current Value', formatUsd(summary.totalCurrentValueQuote || 0)],
    ['Claimable Fees', formatUsd(summary.totalAccruedFeesQuote || 0)],
    ['Unrealized PnL', formatUsd(summary.totalUnrealizedPnlQuote || 0)]
  ]

  for (const [label, value] of rows) {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`
    root.appendChild(row)
  }
}

function renderClosedPnlSummary(summary) {
  const root = document.getElementById('closed-pnl-summary')
  if (!root) {
    return
  }

  root.innerHTML = ''
  const rows = [
    ['Closed Positions', summary?.closedPositions || 0],
    ['Realized PnL', formatSignedUsd(summary?.totalRealizedPnlQuote || 0)],
    ['Net Proceeds', formatUsd(summary?.totalNetProceedsQuote || 0)],
    ['Fees', formatUsd(summary?.totalFeesQuote || 0)],
    ['Exit Swap Delta', formatSignedUsd(summary?.totalAutoswapDeltaQuote || 0)]
  ]

  for (const [label, value] of rows) {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`
    root.appendChild(row)
  }
}

function renderOperatorActions(actions, snapshot = null) {
  const root = document.getElementById('operator-actions')
  if (!root) {
    return
  }
  root.innerHTML = ''

  if (actions.blockers?.length) {
    for (const blocker of actions.blockers) {
      const item = document.createElement('div')
      item.className = 'warning-item'
      item.textContent = blocker
      root.appendChild(item)
    }
  } else {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = '<span>Status</span><strong>Ready for controlled flow</strong>'
    root.appendChild(row)
  }

  for (const warning of actions.warnings || []) {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = `<span>Warning</span><strong>${escapeHtml(warning)}</strong>`
    root.appendChild(row)
  }

  const review = snapshot?.review || {}
  const approvalAudit = snapshot?.approvalAudit || {}
  const infoRows = [
    ['Recovery Queue', String(review.recoveryActionsCount || 0)],
    ['Live Permit', approvalAudit.hasValidApproval ? 'Valid' : 'Missing or expired'],
    ['Permit Expires', review.permitExpiresAt ? formatTimestamp(review.permitExpiresAt) : 'n/a']
  ]

  for (const [label, value] of infoRows) {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`
    root.appendChild(row)
  }
}

function renderPositions(openCards) {
  const root = document.getElementById('position-list')
  if (!root) {
    syncManageActionAvailability(openCards)
    return
  }
  root.innerHTML = ''

  if (!openCards.length) {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = '<span>Open Positions</span><strong>None</strong>'
    root.appendChild(row)
    return
  }

  for (const card of openCards) {
    const actionResult = state.positionActionResults[String(card.positionId)]
    const statusClass = card.outOfRange ? 'danger' : 'ok'
    const statusLabel = card.outOfRange ? 'Out of range' : 'In range'
    const hasKnownUnrealizedPnl = Boolean(card.hasKnownUnrealizedPnl)
    const pnlClass = hasKnownUnrealizedPnl
      ? (Number(card.unrealizedPnlQuote || 0) >= 0 ? 'positive' : 'negative')
      : ''
    const pnlText = hasKnownUnrealizedPnl
      ? `${formatSignedUsd(card.unrealizedPnlQuote || 0)} · ${formatSignedPct(card.unrealizedPnlPct || 0)}`
      : '-'
    const item = document.createElement('div')
    item.className = 'position-item'
    item.innerHTML = `
      <div class="position-head">
        <div>
          <h4>${escapeHtml(`${card.dex} #${card.tokenId || card.positionId}`)}</h4>
          <p class="position-subline">${escapeHtml(`${truncateAddress(card.poolAddress)} · ${card.quoteSymbol || 'USDT'}`)}</p>
        </div>
        <span class="position-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="position-metrics">
        <div class="position-metric"><span>Tick Range</span><strong>${card.tickLower} .. ${card.tickUpper}</strong></div>
        <div class="position-metric"><span>Current Tick</span><strong>${formatNumber(card.currentTick)}</strong></div>
        <div class="position-metric"><span>Cost Basis</span><strong>${formatUsd(card.costBasisQuote || 0)}</strong></div>
        <div class="position-metric"><span>Current Value</span><strong>${formatUsd(card.currentValueQuote || 0)}</strong></div>
        <div class="position-metric"><span>Fees</span><strong class="positive">${formatUsd(card.accruedFeesQuote || 0)}</strong></div>
        <div class="position-metric"><span>PnL</span><strong class="${pnlClass}">${pnlText}</strong></div>
      </div>
      <div class="position-foot">
        <span>Liquidity ${formatCompact(card.liquidity || 0)}</span>
        <span>Seen ${formatTimestamp(card.lastSeenAt)}</span>
      </div>
      <div class="position-actions">
        <button class="position-mini-button" type="button" data-position-action="collect-live" data-position-id="${escapeHtml(card.positionId)}">Collect</button>
        <button class="position-mini-button" type="button" data-position-action="close-preview" data-position-id="${escapeHtml(card.positionId)}">Exit Review</button>
        <button class="position-mini-button" type="button" data-position-action="close-dry-run" data-position-id="${escapeHtml(card.positionId)}">Exit Check</button>
      </div>
      ${actionResult ? renderPositionActionResult(actionResult) : ''}
    `
    root.appendChild(item)
  }

  bindPositionActions()
  syncManageActionAvailability(openCards)
}

function renderClosedPositions(closedCards) {
  const root = document.getElementById('closed-position-list')
  if (!root) {
    return
  }
  root.innerHTML = ''

  if (!closedCards.length) {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = '<span>Closed Positions</span><strong>None</strong>'
    root.appendChild(row)
    return
  }

  const groups = groupClosedPositionsByRun(closedCards.slice(0, 24))
  for (const group of groups) {
    const totalNet = group.cards.reduce((sum, card) => sum + Number(card.netProceedsQuote || 0), 0)
    const totalPnl = group.cards.reduce((sum, card) => sum + Number(card.realizedPnlQuote || 0), 0)
    const totalFees = group.cards.reduce((sum, card) => sum + Number(card.feesQuote || 0), 0)
    const pnlClass = totalPnl >= 0 ? 'positive' : 'negative'
    const item = document.createElement('div')
    item.className = 'position-item'
    item.innerHTML = `
      <div class="position-head">
        <div>
          <h4>${escapeHtml(`${group.dex} · ${truncateAddress(group.poolAddress)}`)}</h4>
          <p class="position-subline">${escapeHtml(`${group.cards.length} closed positions · ${group.quoteSymbol || 'USDT'} · ${formatTimestamp(group.closedAt)}`)}</p>
        </div>
        <span class="position-status closed">Closed</span>
      </div>
      <div class="position-metrics">
        <div class="position-metric"><span>Net Proceeds</span><strong>${formatUsd(totalNet)}</strong></div>
        <div class="position-metric"><span>Realized PnL</span><strong class="${pnlClass}">${formatSignedUsd(totalPnl)}</strong></div>
        <div class="position-metric"><span>Fees</span><strong class="positive">${formatUsd(totalFees)}</strong></div>
      </div>
    `
    root.appendChild(item)
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function approximatePriceFromTick(targetPrice, currentTick, tick) {
  const anchor = Number(targetPrice || 0)
  const current = Number(currentTick)
  const next = Number(tick)
  const inputIsToken0 = arguments[3] === true
  if (!Number.isFinite(anchor) || anchor <= 0 || !Number.isFinite(current) || !Number.isFinite(next)) {
    return 0
  }

  const exponent = inputIsToken0 ? (next - current) : -(next - current)
  return anchor * Math.pow(1.0001, exponent)
}

const RANGE_METER_SLOT_COUNT = 21

function buildRangeMeterModel({
  lowerPrice,
  upperPrice,
  currentPrice,
  lowerPct = null,
  upperPct = null,
  dimmed = false
}) {
  const lower = Math.min(Number(lowerPrice || 0), Number(upperPrice || 0))
  const upper = Math.max(Number(lowerPrice || 0), Number(upperPrice || 0))
  const current = Number(currentPrice || 0)
  const hasCurrent = Number.isFinite(current) && current > 0
  const hasRange = Number.isFinite(lower) && Number.isFinite(upper) && upper > lower
  const normalized = hasRange && hasCurrent
    ? clamp((current - lower) / (upper - lower), 0, 1)
    : 0.5
  const markerIndex = Math.max(0, Math.min(RANGE_METER_SLOT_COUNT - 1, Math.round(normalized * (RANGE_METER_SLOT_COUNT - 1))))
  const status = !hasCurrent
    ? 'unknown'
    : current < lower
      ? 'below'
      : current > upper
        ? 'above'
        : 'inside'

  return {
    lowerPrice: lower,
    upperPrice: upper,
    currentPrice: current,
    lowerPct: Number.isFinite(Number(lowerPct)) ? Number(lowerPct) : null,
    upperPct: Number.isFinite(Number(upperPct)) ? Number(upperPct) : null,
    markerIndex,
    slotCount: RANGE_METER_SLOT_COUNT,
    status,
    dimmed: Boolean(dimmed),
    hasCurrent,
    hasRange
  }
}

function buildRangeProgress(card) {
  const selectedCard = getSelectedCardFromState()
  const selectedCurrent = selectedCard
    && String(selectedCard.poolAddress || '').toLowerCase() === String(card.poolAddress || '').toLowerCase()
    ? Number(getPoolDisplayPrice(selectedCard) || 0)
    : 0
  const current = Number(selectedCurrent || card.currentPoolPrice || card.targetPrice || 0)
  const inputIsToken0 = String(card.inputTokenAddress || '').toLowerCase() === String(card.token0Address || '').toLowerCase()
  const lower = Number(card.rangeLowerPrice || approximatePriceFromTick(current, card.currentTick, card.tickLower, inputIsToken0))
  const upper = Number(card.rangeUpperPrice || approximatePriceFromTick(current, card.currentTick, card.tickUpper, inputIsToken0))
  const lowerPct = card.rangeLowerPct == null || card.rangeUpperPct == null ? null : Math.min(Number(card.rangeLowerPct), Number(card.rangeUpperPct))
  const upperPct = card.rangeLowerPct == null || card.rangeUpperPct == null ? null : Math.max(Number(card.rangeLowerPct), Number(card.rangeUpperPct))

  return buildRangeMeterModel({
    lowerPrice: lower,
    upperPrice: upper,
    currentPrice: current,
    lowerPct,
    upperPct,
    dimmed: card.outOfRange
  })
}

function describeRangeMeterStatus(status) {
  if (status === 'inside') {
    return 'Inside range'
  }
  if (status === 'below') {
    return 'Below range'
  }
  if (status === 'above') {
    return 'Above range'
  }
  return 'Waiting for live price'
}

function buildRangeMeterMarkup(model, { compact = false, hero = false } = {}) {
  const slots = Array.from({ length: model.slotCount || RANGE_METER_SLOT_COUNT }, (_, index) => {
    const classes = ['range-meter-slot']
    if (index === Number(model.markerIndex || 0)) {
      classes.push('is-marker')
    }
    if (model.status === 'inside' && Math.abs(index - Number(model.markerIndex || 0)) <= 1) {
      classes.push('is-hot')
    }
    if (model.status === 'below' && index === 0) {
      classes.push('is-edge')
    }
    if (model.status === 'above' && index === (model.slotCount || RANGE_METER_SLOT_COUNT) - 1) {
      classes.push('is-edge')
    }
    return `<span class="${classes.join(' ')}"></span>`
  }).join('')

  const classes = [
    'range-meter',
    compact ? 'range-meter-compact' : '',
    hero ? 'range-meter-hero' : '',
    model.dimmed ? 'is-dimmed' : '',
    `is-${model.status || 'unknown'}`
  ].filter(Boolean).join(' ')

  return `
    <div class="${classes}">
      <div class="range-meter-topline">
        <span class="range-meter-state">${escapeHtml(describeRangeMeterStatus(model.status))}</span>
        <strong class="range-meter-current">${model.hasCurrent ? escapeHtml(formatNumber(model.currentPrice, 6)) : 'n/a'}</strong>
      </div>
      <div class="range-meter-track" aria-hidden="true">${slots}</div>
      <div class="range-meter-legend">
        <span class="range-meter-edge">
          <strong>${escapeHtml(formatNumber(model.lowerPrice, 6))}</strong>
          <small>${model.lowerPct == null ? 'Lower' : escapeHtml(formatPctSmart(model.lowerPct, model.upperPct))}</small>
        </span>
        <span class="range-meter-edge range-meter-edge-right">
          <strong>${escapeHtml(formatNumber(model.upperPrice, 6))}</strong>
          <small>${model.upperPct == null ? 'Upper' : escapeHtml(formatPctSmart(model.upperPct, model.lowerPct))}</small>
        </span>
      </div>
    </div>
  `
}

function renderManageSummary(openCards, closedCards) {
  const root = document.getElementById('manage-summary-strip')
  if (!root) {
    return
  }

  const knownValueCards = openCards.filter((card) => hasKnownManageValuation(card))
  const allKnownOpenValue = openCards.length > 0 && knownValueCards.length === openCards.length
  const totalValue = knownValueCards.reduce((sum, card) => sum + Number(card.currentValueQuote || 0), 0)
  const totalFees = openCards.reduce((sum, card) => sum + Number(card.accruedFeesQuote || 0), 0)
  const totalPnl = openCards.reduce((sum, card) => sum + Number(card.unrealizedPnlQuote || 0), 0)
  const allKnownUnrealizedPnl = openCards.length > 0 && openCards.every((card) => Boolean(card.hasKnownUnrealizedPnl))
  const active = openCards.filter((card) => !card.outOfRange).length
  const outOfRange = openCards.filter((card) => card.outOfRange).length

  root.innerHTML = ''
  const items = [
    ['Open Value', allKnownOpenValue ? formatUsd(totalValue) : '-'],
    ['Claimable Fees', formatUsd(totalFees)],
    ['Unrealized PnL', allKnownUnrealizedPnl ? formatManagePnlUsd(totalPnl) : '-', allKnownUnrealizedPnl ? (totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative') : ''],
    ['Active', String(active)],
    ['Out Of Range', String(outOfRange)]
  ]

  for (const [label, value, toneClass = ''] of items) {
    const item = document.createElement('div')
    item.className = ['manage-summary-chip', toneClass].filter(Boolean).join(' ')
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`
    root.appendChild(item)
  }
}

function renderManageOpenTable(openCards) {
  const root = document.getElementById('manage-open-table-body')
  if (!root) {
    return
  }

  root.innerHTML = ''

  if (!openCards.length) {
    root.innerHTML = '<tr><td colspan="11" class="manage-inline-note">No open positions yet.</td></tr>'
    return
  }

  const groups = groupPositionsByRun(openCards)
  if (groups.length) {
    for (const group of groups) {
      const expanded = state.manageExpandedGroups.has(group.key)
      const totals = buildOpenGroupTotals(group.cards)
      const selectedCount = group.cards.filter((card) => state.manageSelection.has(String(card.positionId))).length
      const allSelected = group.cards.length > 0 && selectedCount === group.cards.length
      const totalPnlClass = totals.allKnownUnrealizedPnl
        ? (totals.totalPnl >= 0 ? 'positive-soft' : 'negative')
        : ''
      const totalPnlText = totals.allKnownUnrealizedPnl
        ? formatManagePnlUsd(totals.totalPnl)
        : '-'
      const totalValueText = totals.allKnownValuation ? formatUsd(totals.totalValue) : '-'
      const dailyFeesPct = estimateOpenGroupDailyFeesPct(group.cards, totals)
      const dailyFeesText = dailyFeesPct == null ? '-' : formatPct(dailyFeesPct)
      const headerRow = document.createElement('tr')
      const openedDisplay = getPositionOpenedDisplay(group.cards[0] || {})
      const groupFeeTier = getOpenGroupFeeTierLabel(group.cards)
      const groupContractAddress = getOpenGroupContractAddress(group.cards)
      headerRow.className = 'manage-group-row'
      headerRow.innerHTML = `
        <td colspan="11">
          <button class="manage-group-toggle" type="button" data-manage-group="${escapeHtml(group.key)}">
            <span class="manage-group-caret">${expanded ? '−' : '+'}</span>
            <span class="manage-group-title-block">
              <span class="manage-group-title">${escapeHtml(group.cards[0] ? getPairDisplayLabel(group.cards[0]) : `${group.tokenSymbol || 'TOKEN'}/${group.quoteSymbol || 'QUOTE'}`)}</span>
              ${groupFeeTier ? `<span class="manage-group-fee-tier">Fee Tier | ${escapeHtml(groupFeeTier)}</span>` : ''}
              ${groupContractAddress ? `<span class="icon-action copy-ca-button manage-group-copy-ca" role="button" tabindex="0" data-manage-copy-ca="${escapeHtml(groupContractAddress)}" aria-label="Copy contract address"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v10H9z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5h10" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></span>` : ''}
              <span class="manage-group-meta">${escapeHtml(`${group.cards.length} positions · ${openedDisplay.groupTimestamp}`)}</span>
            </span>
            <span class="manage-group-daily-fees"><small>24h Fees</small><strong class="positive-soft">${dailyFeesText}</strong></span>
            <span class="manage-group-summary">
              <span class="manage-group-chip"><small>Value</small><strong>${totalValueText}</strong></span>
              <span class="manage-group-chip"><small>Fees</small><strong class="positive">${formatUsd(totals.totalFees)}</strong></span>
              <span class="manage-group-chip"><small>PnL</small><strong class="manage-pnl-value ${totalPnlClass}">${totalPnlText}</strong></span>
            </span>
          </button>
        </td>
      `
      root.appendChild(headerRow)
      const metaNode = headerRow.querySelector('.manage-group-meta')
      if (metaNode) {
        metaNode.textContent = `${group.cards.length} positions · ${openedDisplay.groupTimestamp}`
      }
      const titleBlock = headerRow.querySelector('.manage-group-title-block')
      if (titleBlock) {
        const countChip = document.createElement('span')
        countChip.className = 'manage-group-count-chip'
        countChip.textContent = `${group.cards.length} positions`
        titleBlock.insertAdjacentElement('afterend', countChip)
      }

      if (!expanded) {
        continue
      }

      for (const card of group.cards) {
        const key = String(card.positionId)
        const progress = buildRangeProgress(card)
        const openedDisplay = getPositionOpenedDisplay(card)
        const selected = state.manageSelection.has(key)
        const canCollect = Number(card.accruedFeesQuote || 0) > 0
        const hasKnownUnrealizedPnl = Boolean(card.hasKnownUnrealizedPnl)
        const pnlClass = hasKnownUnrealizedPnl
          ? (Number(card.unrealizedPnlQuote || 0) >= 0 ? 'positive' : 'negative')
          : ''
        const pnlText = hasKnownUnrealizedPnl
          ? formatManagePnlUsd(card.unrealizedPnlQuote || 0)
          : '-'
        const pnlPctText = hasKnownUnrealizedPnl ? formatSignedPct(card.unrealizedPnlPct || 0) : '-'
        const pair = getPairDisplayLabel(card)
        const row = document.createElement('tr')
        row.innerHTML = `
          <td><input class="manage-row-check" type="checkbox" data-manage-select="${escapeHtml(key)}"${selected ? ' checked' : ''}></td>
          <td class="manage-token-cell"><strong>${escapeHtml(pair)}</strong></td>
          <td class="manage-age-cell"><strong>${escapeHtml(openedDisplay.elapsed)}</strong><span>${escapeHtml(openedDisplay.timestamp)}</span></td>
          <td>${formatPct(Number(card.fee || 0) / 10000, 2)}</td>
      <td class="manage-range-cell">
        <strong>${formatNumber(progress.lowerPrice, 6)} - ${formatNumber(progress.upperPrice, 6)}</strong>
          <div class="manage-range-values">${progress.lowerPct == null || progress.upperPct == null ? `${card.tickLower} .. ${card.tickUpper}` : formatPctRangeSmart(progress.lowerPct, progress.upperPct)}</div>
      </td>
          <td class="manage-value-stack"><strong>${formatManageValue(card)}</strong></td>
          <td class="manage-fee-stack"><strong class="positive">${formatUsd(Number(card.claimedFeesQuote || 0) + Number(card.accruedFeesQuote || 0))}</strong><span>Claimed ${formatUsd(card.claimedFeesQuote || 0)} · Claimable ${formatUsd(card.accruedFeesQuote || 0)}</span></td>
          <td class="manage-pnl-stack"><strong class="manage-pnl-value ${pnlClass}">${pnlText}</strong><span class="${pnlClass}">${pnlPctText}</span></td>
          <td><span class="manage-status-pill${card.outOfRange ? ' out' : ''}">${card.outOfRange ? 'Out' : 'Active'}</span></td>
          <td>${buildRangeMeterMarkup(progress, { compact: true })}</td>
          <td>
            <div class="manage-actions">
              <button class="manage-action-button collect" type="button" data-manage-collect="${escapeHtml(key)}">Collect</button>
              <button class="manage-action-button close" type="button" data-position-action="close-live" data-position-id="${escapeHtml(key)}">Close</button>
              <button class="manage-action-button autoswap" type="button" data-position-action="close-live-autoswap" data-position-id="${escapeHtml(key)}">Close + Swap</button>
            </div>
          </td>
        `
        root.appendChild(row)
      }

      const totalsRow = document.createElement('tr')
      totalsRow.className = 'manage-total-row'
      totalsRow.innerHTML = `
        <td><input class="manage-row-check manage-group-check" type="checkbox"${allSelected ? ' checked' : ''}></td>
        <td colspan="4"><span class="manage-total-label">Total</span></td>
        <td class="manage-value-stack"><strong>${totals.allKnownValuation ? formatUsd(totals.totalValue) : '-'}</strong></td>
        <td class="manage-fee-stack"><strong class="positive">${formatUsd(totals.totalFees + totals.claimedFees)}</strong><span>Claimed ${formatUsd(totals.claimedFees)} · Claimable ${formatUsd(totals.totalFees)}${totals.totalFeesPct == null ? '' : ` · ${formatPct(totals.totalFeesPct)}`}</span></td>
        <td class="manage-pnl-stack"><strong class="manage-pnl-value ${totalPnlClass}">${totalPnlText}</strong><span class="${totalPnlClass}">${totals.totalPnlPct == null ? '-' : formatSignedPct(totals.totalPnlPct)}</span></td>
        <td></td>
        <td></td>
        <td></td>
      `
      const groupCheckbox = totalsRow.querySelector('.manage-group-check')
      if (groupCheckbox) {
        groupCheckbox.dataset.manageGroupSelect = group.key
      }
      root.appendChild(totalsRow)
    }

    bindManageGroupActions()
    bindPositionActions()
    bindManageActions()
    refreshManageSelectionState(openCards)
    syncManageActionAvailability(openCards)
    return
  }

  for (const card of openCards) {
    const key = String(card.positionId)
    const progress = buildRangeProgress(card)
    const openedDisplay = getPositionOpenedDisplay(card)
    const selected = state.manageSelection.has(key)
    const canCollect = Number(card.accruedFeesQuote || 0) > 0
    const hasKnownUnrealizedPnl = Boolean(card.hasKnownUnrealizedPnl)
    const pnlClass = hasKnownUnrealizedPnl
      ? (Number(card.unrealizedPnlQuote || 0) >= 0 ? 'positive' : 'negative')
      : ''
    const pnlText = hasKnownUnrealizedPnl ? formatSignedUsd(card.unrealizedPnlQuote || 0) : '-'
    const pnlPctText = hasKnownUnrealizedPnl ? formatSignedPct(card.unrealizedPnlPct || 0) : '-'
    const pair = getPairDisplayLabel(card)
    const row = document.createElement('tr')
    row.innerHTML = `
      <td><input class="manage-row-check" type="checkbox" data-manage-select="${escapeHtml(key)}"${selected ? ' checked' : ''}></td>
      <td class="manage-token-cell"><strong>${escapeHtml(pair)}</strong></td>
      <td class="manage-age-cell"><strong>${escapeHtml(openedDisplay.elapsed)}</strong><span>${escapeHtml(openedDisplay.timestamp)}</span></td>
      <td>${formatPct(Number(card.fee || 0) / 10000, 2)}</td>
      <td class="manage-range-cell">
        <strong>${formatNumber(progress.lowerPrice, 6)} - ${formatNumber(progress.upperPrice, 6)}</strong>
          <div class="manage-range-values">${progress.lowerPct == null || progress.upperPct == null ? `${card.tickLower} .. ${card.tickUpper}` : formatPctRangeSmart(progress.lowerPct, progress.upperPct)}</div>
      </td>
      <td class="manage-value-stack"><strong>${formatManageValue(card)}</strong></td>
      <td class="manage-fee-stack"><strong class="positive">${formatUsd(Number(card.claimedFeesQuote || 0) + Number(card.accruedFeesQuote || 0))}</strong><span>Claimed ${formatUsd(card.claimedFeesQuote || 0)} · Claimable ${formatUsd(card.accruedFeesQuote || 0)}</span></td>
      <td class="manage-pnl-stack"><strong class="${pnlClass}">${pnlText}</strong><span class="${pnlClass}">${pnlPctText}</span></td>
      <td><span class="manage-status-pill${card.outOfRange ? ' out' : ''}">${card.outOfRange ? 'Out' : 'Active'}</span></td>
      <td>${buildRangeMeterMarkup(progress, { compact: true })}</td>
      <td>
        <div class="manage-actions">
          <button class="manage-action-button collect" type="button" data-manage-collect="${escapeHtml(key)}">Collect</button>
          <button class="manage-action-button close" type="button" data-position-action="close-live" data-position-id="${escapeHtml(key)}">Close</button>
          <button class="manage-action-button autoswap" type="button" data-position-action="close-live-autoswap" data-position-id="${escapeHtml(key)}">Close + Swap</button>
        </div>
      </td>
    `
    root.appendChild(row)
  }

  bindPositionActions()
  bindManageActions()
  refreshManageSelectionState(openCards)
  syncManageActionAvailability(openCards)
}

function renderManageClosedTable(closedCards) {
  const root = document.getElementById('manage-closed-table-body')
  if (!root) {
    return
  }

  root.innerHTML = ''

  if (!closedCards.length) {
    root.innerHTML = '<tr><td colspan="6" class="manage-inline-note">No closed positions yet.</td></tr>'
    return
  }

  for (const card of closedCards.slice(0, 24)) {
    const pnlClass = Number(card.realizedPnlQuote || 0) >= 0 ? 'positive' : 'negative'
    const exitSwapStatus = formatClosedExitSwapStatus(card)
    const row = document.createElement('tr')
    row.innerHTML = `
      <td class="manage-token-cell"><strong>${escapeHtml(getPairDisplayLabel(card))}</strong></td>
      <td>${formatTimestamp(card.closedAt)}</td>
      <td>${formatUsd(card.costBasisQuote || card.deployedQuote || 0)}</td>
      <td class="positive-soft">${formatClosedUsd(card, 'feesQuote')}</td>
      <td class="${pnlClass}">${formatClosedUsd(card, 'realizedPnlQuote', { signed: true })}<div class="manage-inline-sub ${pnlClass}">${formatClosedPnlPct(card)}</div></td>
      <td class="${exitSwapStatus.className}">${exitSwapStatus.html}</td>
    `
    root.appendChild(row)
  }
}

function formatAutoswapHoldReason(card) {
  const rawReason = card.autoswapDecision?.reason || card.autoswapRoute?.reason || 'route_guard'
  return String(rawReason || 'route_guard')
    .replaceAll('_', ' ')
    .replace(/^route price impact is above max slippage policy$/i, 'price impact above slippage')
}

function formatClosedExitSwapStatus(card) {
  if (card.autoswapDecision?.action === 'hold') {
    return {
      className: 'warning-soft',
      html: `<span>Held: ${escapeHtml(formatAutoswapHoldReason(card))}</span><div class="manage-inline-sub">Exit tokens remain in wallet</div>`
    }
  }
  return {
    className: Number(card.autoswapDeltaQuote || 0) >= 0 ? 'positive-soft' : 'negative',
    html: formatClosedUsd(card, 'autoswapDeltaQuote', { signed: true })
  }
}

function renderManageClosedGroups(closedCards) {
  const root = document.getElementById('manage-closed-table-body')
  if (!root) {
    return
  }

  root.innerHTML = ''

  if (!closedCards.length) {
    root.innerHTML = '<tr><td colspan="6" class="manage-inline-note">No closed positions yet.</td></tr>'
    return
  }

  const groups = groupClosedPositionsByRun(closedCards.slice(0, 48))
  for (const group of groups) {
    const expanded = state.closedExpandedGroups.has(group.key)
    const totals = buildClosedGroupTotals(group.cards)
    const pairLabel = group.cards[0] ? getPairDisplayLabel(group.cards[0]) : `${group.tokenSymbol || 'TOKEN'}/${group.quoteSymbol || 'QUOTE'}`
    const groupFeeTier = getOpenGroupFeeTierLabel(group.cards)
    const groupContractAddress = getOpenGroupContractAddress(group.cards)
    const groupPnlClass = totals.totalPnl >= 0 ? 'positive-soft' : 'negative'
    const groupAutoswapClass = totals.totalAutoswap >= 0 ? 'positive-soft' : 'negative'
    const headerRow = document.createElement('tr')
    headerRow.className = 'manage-group-row'
    headerRow.innerHTML = `
      <td colspan="6">
        <button class="manage-group-toggle" type="button" data-closed-group="${escapeHtml(group.key)}">
          <span class="manage-group-caret">${expanded ? '−' : '+'}</span>
          <span class="manage-group-title-block">
            <span class="manage-group-title">${escapeHtml(pairLabel)}</span>
            ${groupFeeTier ? `<span class="manage-group-fee-tier">Fee Tier | ${escapeHtml(groupFeeTier)}</span>` : ''}
            ${groupContractAddress ? `<span class="icon-action copy-ca-button manage-group-copy-ca" role="button" tabindex="0" data-manage-copy-ca="${escapeHtml(groupContractAddress)}" aria-label="Copy contract address"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v10H9z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5h10" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></span>` : ''}
            <span class="manage-group-meta">${escapeHtml(`${group.cards.length} closed positions · ${formatTimestamp(group.closedAt)}`)}</span>
          </span>
          <span class="manage-group-summary">
            <span class="manage-group-chip"><small>Deposit</small><strong>${formatUsd(totals.totalDeposit)}</strong></span>
            <span class="manage-group-chip"><small>Fees</small><strong class="positive-soft">${formatUsd(totals.totalFees)}</strong></span>
            <span class="manage-group-chip"><small>PnL</small><strong class="${groupPnlClass}">${formatSignedUsd(totals.totalPnl)}</strong></span>
            <span class="manage-group-chip"><small>Exit Swap</small><strong class="${groupAutoswapClass}">${formatSignedUsd(totals.totalAutoswap)}</strong></span>
          </span>
        </button>
      </td>
    `
    root.appendChild(headerRow)

    if (!expanded) {
      continue
    }

    for (const card of group.cards) {
      const pnlClass = Number(card.realizedPnlQuote || 0) >= 0 ? 'positive' : 'negative'
      const exitSwapStatus = formatClosedExitSwapStatus(card)
      const row = document.createElement('tr')
      row.innerHTML = `
        <td class="manage-token-cell"><strong>${escapeHtml(getPairDisplayLabel(card))}</strong></td>
        <td>${formatTimestamp(card.closedAt)}</td>
        <td>${formatUsd(card.costBasisQuote || card.deployedQuote || 0)}</td>
        <td class="positive-soft">${formatClosedUsd(card, 'feesQuote')}</td>
        <td class="${pnlClass}">${formatClosedUsd(card, 'realizedPnlQuote', { signed: true })}<div class="manage-inline-sub ${pnlClass}">${formatClosedPnlPct(card)}</div></td>
        <td class="${exitSwapStatus.className}">${exitSwapStatus.html}</td>
      `
      root.appendChild(row)
    }
  }

  for (const button of document.querySelectorAll('[data-closed-group]')) {
    button.onclick = () => {
      const key = String(button.dataset.closedGroup || '')
      if (!key) {
        return
      }
      if (state.closedExpandedGroups.has(key)) {
        state.closedExpandedGroups.delete(key)
      } else {
        state.closedExpandedGroups.add(key)
      }
      renderManageClosedGroups(state.lastSnapshot?.dashboard?.positions?.closedCards || [])
    }
  }
  bindManageGroupActions()
}

function renderActivity(execution) {
  const root = document.getElementById('activity-list')
  if (!root) {
    return
  }

  root.innerHTML = ''

  const entries = execution?.timeline || execution?.recentEntries || []
  if (!entries.length) {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = '<span>Activity</span><strong>None yet</strong>'
    root.appendChild(row)
    return
  }

  for (const entry of entries.slice(-8).reverse()) {
    const item = document.createElement('div')
    item.className = 'activity-item'
    if (entry.type === 'close_card') {
      item.innerHTML = `
        <strong>close card</strong>
        <span>${escapeHtml(`Position ${entry.positionId || '-'}`)}</span>
        <span>${escapeHtml(`Token ${entry.tokenId || '-'}`)}</span>
        <span>${escapeHtml(`${formatSignedUsd(entry.realizedPnlQuote || 0)} · ${formatTimestamp(entry.at)}`)}</span>
      `
    } else if (entry.type === 'discovery') {
      item.innerHTML = `
        <strong>discovery</strong>
        <span>${escapeHtml(`${entry.poolCount || 0} pools · ${entry.accepted || 0} ready`)}</span>
        <span>${escapeHtml(`Warn ${entry.warned || 0} · Block ${entry.blocked || 0}`)}</span>
        <span>${escapeHtml(formatTimestamp(entry.at))}</span>
      `
    } else if (entry.type === 'execution_extension') {
      item.innerHTML = `
        <strong>execution extension</strong>
        <span>${escapeHtml(`${entry.actionableCount || 0} actionable`)}</span>
        <span>${escapeHtml(`${entry.readyToExecute ? 'ready' : 'blocked'} · blockers ${entry.blockerCount || 0}`)}</span>
        <span>${escapeHtml(formatTimestamp(entry.at))}</span>
      `
    } else {
      const tokenIds = Array.isArray(entry.tokenIds) && entry.tokenIds.length ? entry.tokenIds.join(', ') : '-'
      item.innerHTML = `
        <strong>${escapeHtml(String(entry.kind || entry.type || 'execution').replaceAll('_', ' '))}</strong>
        <span>${escapeHtml(`${entry.dex || 'unknown dex'} · ${truncateAddress(entry.poolAddress)}`)}</span>
        <span>${escapeHtml(`Tokens ${tokenIds}`)}</span>
        <span>${escapeHtml(`${entry.summary?.mode || entry.status || 'n/a'} · ${entry.summary?.executionCount || 0} tx · ${entry.summary?.ok === undefined ? '' : (entry.summary.ok ? 'ok' : 'blocked')}`)}</span>
      `
    }
    root.appendChild(item)
  }
}

function renderPositionActionResult(result) {
  if (result.kind === 'error') {
    return `<div class="position-inline-result">${escapeHtml(result.error)}</div>`
  }

  if (result.kind === 'close-preview') {
    return `
      <div class="position-inline-result">
        <div class="row"><span>Exit Review</span><strong>${escapeHtml(result.tokenId)}</strong></div>
        <div class="row"><span>Liquidity</span><strong>${formatCompact(result.liquidity)}</strong></div>
        <div class="row"><span>Range</span><strong>${escapeHtml(result.tickLower)} .. ${escapeHtml(result.tickUpper)}</strong></div>
      </div>
    `
  }

  if (result.kind === 'close-dry-run') {
    return `
      <div class="position-inline-result">
        <div class="row"><span>Exit Check</span><strong>${result.dryRun.ok ? 'Ready' : 'Blocked'}</strong></div>
        <div class="row"><span>Requests</span><strong>${result.dryRun.requestCount}</strong></div>
        <div class="row"><span>Mode</span><strong>${result.dryRun.structuralOnly ? 'Structural' : 'Preflight'}</strong></div>
      </div>
    `
  }

  if (result.kind === 'close-live') {
    const autoswapExecution = Array.isArray(result.autoswapExecutions) && result.autoswapExecutions.length
      ? result.autoswapExecutions[0]
      : null
    const exitSwapLabel = autoswapExecution
      ? (autoswapExecution.executed
        ? `${autoswapExecution.tokenInSymbol || 'token'} -> ${autoswapExecution.tokenOutSymbol || 'quote'} ${formatSignedUsd(autoswapExecution.autoswapDeltaQuote || 0)}`
        : `requested, skipped: ${autoswapExecution.reason || 'route_guard'}`)
      : (result.autoswapRequested ? 'requested, no eligible swap' : 'off')
    return `
      <div class="position-inline-result">
        <div class="row"><span>Live Close</span><strong>${truncateAddress(result.tokenId || result.positionId || '')}</strong></div>
        <div class="row"><span>Tx Hashes</span><strong>${(result.txHashes || []).map(truncateAddress).join(', ') || '-'}</strong></div>
        <div class="row"><span>Exit Swap</span><strong>${escapeHtml(exitSwapLabel)}</strong></div>
        <div class="row"><span>Status</span><strong>${(result.closeCards || []).length ? 'Closed' : 'Submitted'}</strong></div>
        ${renderDefenseSummary(result.defense, 'Close Defense')}
        ${renderVerificationSummary(result.postTradeVerification, 'Close Verification')}
        ${renderAutoswapExecutionSummary(result.autoswapExecutions)}
      </div>
    `
  }

  return ''
}

function renderActionOverlay() {
  let shell = document.getElementById('action-overlay')
  if (!shell) {
    shell = document.createElement('div')
    shell.id = 'action-overlay'
    shell.className = 'action-overlay-shell hidden'
    document.body.appendChild(shell)
  }

  const overlay = state.actionOverlay
  if (!overlay) {
    shell.classList.add('hidden')
    shell.classList.remove('minimized')
    shell.innerHTML = ''
    return
  }

  shell.classList.remove('hidden')
  shell.classList.toggle('minimized', Boolean(overlay.minimized))
  if (overlay.minimized) {
    shell.innerHTML = `
      <button type="button" class="action-overlay-restore" aria-label="Restore execution window" title="Restore execution window">
        <span class="action-overlay-restore-icon action-overlay-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="m8 14 4-4 4 4" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7 19h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="action-overlay-restore-text">${escapeHtml(overlay.title || 'Execution')}</span>
        <strong>${escapeHtml(overlay.progressLabel || `${overlay.current || 0}/${overlay.total || 0}`)}</strong>
      </button>
    `
    shell.querySelector('.action-overlay-restore')?.addEventListener('click', toggleActionOverlayMinimized)
    return
  }
  const percent = overlay.indeterminate
    ? 100
    : Math.max(8, Math.min(100, overlay.total > 0 ? (overlay.current / overlay.total) * 100 : 12))
  const progressValue = overlay.indeterminate ? '' : ` value="${Math.round(percent)}"`
  shell.innerHTML = `
    <div class="action-overlay-backdrop"></div>
    <div class="action-overlay-card">
      <div class="action-overlay-head">
        <strong>${escapeHtml(overlay.title || 'Processing execution')}</strong>
        <div class="action-overlay-head-actions">
          <span>${escapeHtml(overlay.step || '')}</span>
          <button type="button" class="action-overlay-minimize" aria-label="Minimize execution window" title="Minimize execution window">
            <span class="action-overlay-minimize-icon action-overlay-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="m8 10 4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M7 5h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </span>
          </button>
        </div>
      </div>
      <div class="action-overlay-progress">
        <progress class="action-overlay-progress-bar${overlay.indeterminate ? ' indeterminate' : ''}" max="100"${progressValue}></progress>
        <div class="action-overlay-meta">
          <span>${escapeHtml(overlay.progressLabel || `${overlay.current || 0}/${overlay.total || 0}`)}</span>
          <span>${escapeHtml(overlay.message || 'Sending execution request...')}</span>
        </div>
      </div>
    </div>
  `
  shell.querySelector('.action-overlay-minimize')?.addEventListener('click', toggleActionOverlayMinimized)
}

function showActionOverlay({ title, total = 1, current = 1, message, step = 'Execution in progress', progressLabel = null, indeterminate = false }) {
  if (actionOverlayHideTimer) {
    clearTimeout(actionOverlayHideTimer)
    actionOverlayHideTimer = null
  }
  const wasMinimized = Boolean(state.actionOverlay?.minimized)
  state.actionOverlay = {
    title,
    total,
    current: Math.min(current, total),
    message,
    step,
    progressLabel,
    indeterminate,
    minimized: wasMinimized
  }
  renderActionOverlay()
}

function toggleActionOverlayMinimized() {
  if (!state.actionOverlay) {
    return
  }
  state.actionOverlay.minimized = !state.actionOverlay.minimized
  renderActionOverlay()
}

function bumpActionOverlay(current, message, options = {}) {
  if (!state.actionOverlay) {
    return
  }
  state.actionOverlay.current = current
  state.actionOverlay.message = message || state.actionOverlay.message
  if (Object.prototype.hasOwnProperty.call(options, 'progressLabel')) {
    state.actionOverlay.progressLabel = options.progressLabel
  }
  if (Object.prototype.hasOwnProperty.call(options, 'indeterminate')) {
    state.actionOverlay.indeterminate = Boolean(options.indeterminate)
  }
  if (options.step) {
    state.actionOverlay.step = options.step
  }
  renderActionOverlay()
}

function hideActionOverlay(delayMs = 350) {
  if (actionOverlayHideTimer) {
    clearTimeout(actionOverlayHideTimer)
    actionOverlayHideTimer = null
  }

  const clearOverlay = () => {
    state.actionOverlay = null
    renderActionOverlay()
  }

  if (!delayMs || delayMs <= 0) {
    clearOverlay()
    return
  }

  actionOverlayHideTimer = setTimeout(() => {
    actionOverlayHideTimer = null
    clearOverlay()
  }, delayMs)
}

function showToast({ title, message = '', tone = 'info', timeoutMs = 3200 }) {
  let root = document.getElementById('toast-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'toast-root'
    root.className = 'toast-root'
    document.body.appendChild(root)
  }
  const toast = document.createElement('div')
  toast.className = `toast-item ${tone}`
  toast.innerHTML = `
    <strong>${escapeHtml(title || 'Notice')}</strong>
    ${message ? `<span>${escapeHtml(message)}</span>` : ''}
  `
  root.appendChild(toast)
  setTimeout(() => {
    toast.classList.add('leaving')
    setTimeout(() => toast.remove(), 220)
  }, Math.max(1000, Number(timeoutMs || 3200)))
}

function formatCloseSwapAttemptMessage(autoswapExecutions = []) {
  const attempts = autoswapExecutions.flatMap((entry) => entry?.autoswapAttempts || entry?.attempts || [])
  if (attempts.length <= 1) {
    return ''
  }
  const last = attempts[attempts.length - 1]
  return `First swap attempt did not pass; slippage was increased to ${Number(last.slippagePct || 0).toFixed(2)}% and the next attempt was executed.`
}

function showCloseSwapToast(summary = {}) {
  if (Number(summary.errors || 0) > 0) {
    showToast({
      title: 'Close + Swap needs review',
      message: `${summary.errors} close request(s) failed`,
      tone: 'danger'
    })
    return
  }
  if (Number(summary.swapExecuted || 0) > 0) {
    const attemptMessage = formatCloseSwapAttemptMessage(summary.autoswapExecutions || [])
    showToast({
      title: 'Close + Swap complete',
      message: attemptMessage || `${summary.closed || 0} closed, ${summary.swapExecuted} exit swap(s) executed`,
      tone: Number(summary.swapHeld || 0) > 0 ? 'warning' : 'success'
    })
    return
  }
  if (Number(summary.swapHeld || 0) > 0) {
    showToast({
      title: 'Close complete, swap held',
      message: 'Exit tokens stayed in wallet because route guard held the swap',
      tone: 'warning'
    })
  }
}

async function refreshLiveOperatorData(options = {}) {
  const manual = options.manual === true

  if (manual) {
    stampMarketRefreshNow()
    renderUpdatedHeader()
  }

  await Promise.allSettled([
    refreshSelectedPoolPrice({ manual }),
    loadSnapshot(),
    loadForkStatus(),
    loadKeystoreState()
  ])
}

function openPreviewModal(card, preview, summary) {
  const shell = document.getElementById('preview-modal')
  const body = document.getElementById('preview-modal-body')
  if (!shell || !body || !card || !preview) {
    return
  }

  const orderedRows = preview.mode === 'bidask'
    ? [...(preview.rows || [])].sort((left, right) => Number(right.upperPrice || 0) - Number(left.upperPrice || 0))
    : (preview.rows || [])
  const spotDepositUsageLabel = preview.mode === 'spot' ? formatSpotDepositUsageLabel(summary, card) : null
  const spotDepositUsageDetail = preview.mode === 'spot' ? formatSpotDepositUsageDetail(summary) : null
  const rows = orderedRows.map((row) => `
    <div class="preview-ladder-row">
      <strong>#${row.index || 1}</strong>
      <div>
        <div>${preview.mode === 'spot' ? `Spot LP ${escapeHtml(row.rangeShape || 'around')}` : `${row.lowerPct.toFixed(2)}% .. ${row.upperPct.toFixed(2)}%`}</div>
        <div class="muted">${preview.mode === 'spot' ? `Ref ${formatNumber(row.referencePrice, 6)}` : `${formatNumber(row.lowerPrice, 6)} .. ${formatNumber(row.upperPrice, 6)}`}</div>
      </div>
      <div>
        <strong>${formatUsd(row.capitalUsd || 0)}</strong>
        <div class="muted">${preview.mode === 'spot' ? `${formatNumber(row.estimatedUnits, 4)} units` : `Loss ${formatPct(row.lossAtLevel || 0)}`}</div>
      </div>
      <div>
        <strong>${preview.mode === 'spot' ? escapeHtml(spotDepositUsageLabel) : `#${row.index || 1}`}</strong>
        <div class="muted">${preview.mode === 'spot' ? escapeHtml(spotDepositUsageDetail) : `${formatPct(row.sharePct || 0)} capital`}</div>
      </div>
    </div>
  `).join('')
  const review = summary?.review || {}
  const reviewWarnings = (review.warnings || []).map((warning) => `<div class="row"><span>Warning</span><strong>${escapeHtml(warning)}</strong></div>`).join('')
  const reviewBlockers = (review.blockers || []).map((blocker) => `<div class="row"><span>Blocker</span><strong>${escapeHtml(blocker)}</strong></div>`).join('')

  body.innerHTML = `
    <div class="preview-modal-grid">
      <aside class="preview-side">
        <section class="preview-card">
          <h3>Pool</h3>
          <div class="metric-list">
            <div class="row"><span>Pair</span><strong>${escapeHtml(`${card.tokenSymbol || 'TOKEN'}/${card.quoteTokenSymbol || 'QUOTE'}`)}</strong></div>
            <div class="row"><span>DEX</span><strong>${escapeHtml(card.dexLabel || card.dex)}</strong></div>
            <div class="row"><span>Fee Tier</span><strong>${escapeHtml(card.feeTierLabel)}</strong></div>
            <div class="row"><span>Current Price</span><strong>${formatNumber(getPoolDisplayPrice(card), 6)}</strong></div>
            <div class="row"><span>Liquidity</span><strong>${formatUsd(card.liquidityUsd)}</strong></div>
          </div>
        </section>
        <section class="preview-card">
          <h3>Execution</h3>
          <div class="metric-list">
            <div class="row"><span>Mode</span><strong>${preview.mode === 'spot' ? 'Spot' : 'Bid/Ask'}</strong></div>
            <div class="row"><span>Capital</span><strong>${formatUsd(summary?.capitalUsd || 0)}</strong></div>
            <div class="row"><span>Slippage</span><strong>${formatPct(summary?.slippagePct || 0)}</strong></div>
            <div class="row"><span>Deposit Side</span><strong data-setup-spot-deposit-usage>${escapeHtml(preview.mode === 'spot' ? spotDepositUsageLabel : String(summary?.depositToken || 'quote').toUpperCase())}</strong></div>
            <div class="row"><span>Stretch</span><strong>${preview.mode === 'spot' ? '-' : `${formatPct(preview.minPct || 0)} .. ${formatPct(preview.maxPct || 0)}`}</strong></div>
            <div class="row"><span>Max Drawdown</span><strong>${preview.mode === 'spot' ? '-' : formatPct(preview.summary?.worstLossPct || 0)}</strong></div>
            <div class="row"><span>Recipient</span><strong>${escapeHtml(truncateAddress(review.recipient || 'n/a'))}</strong></div>
            <div class="row"><span>Spender</span><strong>${escapeHtml(truncateAddress(review.spender || 'n/a'))}</strong></div>
            <div class="row"><span>Tx Count</span><strong>${escapeHtml(review.txCount == null ? 'n/a' : String(review.txCount))}</strong></div>
            ${reviewWarnings}
            ${reviewBlockers}
          </div>
        </section>
      </aside>
      <section class="preview-card">
        <h3>${preview.mode === 'spot' ? 'Spot Route' : 'Ladder Layout'}</h3>
        <div class="preview-ladder">${rows || '<div class="setup-empty">No positions to preview yet.</div>'}</div>
      </section>
    </div>
  `

  shell.classList.remove('hidden')
  shell.setAttribute('aria-hidden', 'false')
}

function closePreviewModal() {
  const shell = document.getElementById('preview-modal')
  if (!shell) {
    return
  }
  shell.classList.add('hidden')
  shell.setAttribute('aria-hidden', 'true')
}

function bindPositionActions() {
  for (const button of document.querySelectorAll('[data-position-action]')) {
    button.addEventListener('click', async () => {
      const positionId = button.dataset.positionId
      const action = button.dataset.positionAction
      if (action === 'close-live' || action === 'close-live-autoswap') {
        if (!positionId) {
          return
        }
        if (action === 'close-live-autoswap' && !EXIT_SWAP_CLOSE_ENABLED) {
          button.title = EXIT_SWAP_DISABLED_TITLE
          return
        }
        button.disabled = true
        try {
          await closeLiveByIds([String(positionId)], {
            autoswapOnClose: action === 'close-live-autoswap'
          })
        } finally {
          button.disabled = false
        }
        return
      }

      if (action === 'collect-live') {
        if (!positionId) {
          return
        }
        button.disabled = true
        try {
          await collectLiveByIds([String(positionId)])
        } finally {
          button.disabled = false
        }
        return
      }

      button.disabled = true

      try {
        showActionOverlay({
          title: action === 'collect-live'
            ? 'Collecting fees'
            : action === 'close-live-autoswap'
              ? 'Closing live position with exit swap'
            : action === 'close-live'
              ? 'Closing live position'
              : 'Checking position action',
          total: 3,
          message: `Preparing ${action}`
        })
        bumpActionOverlay(1, 'Preparing request')
        const endpoint = action === 'close-dry-run'
          ? '/api/position-close-dry-run'
          : '/api/position-close-preview'
        bumpActionOverlay(2, 'Sending request to backend')
        const result = await postJson(endpoint, {
          positionId,
          autoswapOnClose: state.positionSetup.autoswapOnClose,
          slippagePct: state.positionSetup.slippagePct
        })
        bumpActionOverlay(3, 'Syncing position state')
        state.positionActionResults[String(positionId)] = {
          kind: action,
          ...result
        }
      } catch (error) {
        state.positionActionResults[String(positionId)] = {
          kind: 'error',
          error: error.message
        }
      } finally {
        hideActionOverlay()
        button.disabled = false
        if (state.lastSnapshot) {
          renderPositions(state.lastSnapshot.dashboard.positions.openCards || [])
        }
      }
    })
  }
}

function bindManageActions() {
  for (const checkbox of document.querySelectorAll('[data-manage-select]')) {
    checkbox.addEventListener('change', () => {
      const key = checkbox.dataset.manageSelect
      if (checkbox.checked) {
        state.manageSelection.add(key)
      } else {
        state.manageSelection.delete(key)
      }

      syncManageActionAvailability(state.lastSnapshot?.dashboard?.positions?.openCards || [])
    })
  }

  for (const button of document.querySelectorAll('[data-manage-collect]')) {
    button.addEventListener('click', async () => {
      const key = button.dataset.manageCollect
      if (!key) {
        return
      }
      button.disabled = true
      try {
        await collectLiveByIds([String(key)])
      } finally {
        button.disabled = false
        if (state.lastSnapshot) {
          renderPositions(state.lastSnapshot.dashboard.positions.openCards || [])
          renderManageOpenTable(state.lastSnapshot.dashboard.positions.openCards || [])
        }
      }
    })
  }
}

async function collectLiveByIds(positionIds) {
  showActionOverlay({
    title: 'Claiming live fees',
    total: Math.max(1, positionIds.length),
    message: `Claiming fees for ${positionIds.length} position(s)`
  })
  try {
    for (const positionId of positionIds) {
      try {
        bumpActionOverlay(positionIds.indexOf(positionId) + 1, `Claiming fees for position ${positionId}`)
        const result = await postJson('/api/position-claim-live', {
          positionId
        })
        state.positionActionResults[String(positionId)] = {
          kind: 'collect-live',
          ...result
        }
        if (result?.dashboard && state.lastSnapshot) {
          const nextSnapshot = {
            ...state.lastSnapshot,
            dashboard: result.dashboard
          }
          applySnapshotToUi(nextSnapshot)
        }
      } catch (error) {
        state.positionActionResults[String(positionId)] = {
          kind: 'error',
          error: error.message
        }
      }
    }
    state.manageSelection.clear()
    void loadSnapshot(true).catch(() => {})
  } finally {
    hideActionOverlay(160)
  }
}

function renderSelectedPoolPanel(card, feeTvlInterval) {
  const roots = [
    document.getElementById('selected-pool-panel'),
    document.getElementById('create-selected-pool-panel')
  ].filter(Boolean)

  for (const root of roots) {
    root.innerHTML = ''
  }

  if (!card) {
    setText('header-selected-pool', 'None')
    setText('header-selected-price', '-')
    for (const root of roots) {
      const row = document.createElement('div')
      row.className = 'row'
      row.innerHTML = '<span>Pool</span><strong>Select from the list</strong>'
      root.appendChild(row)
    }
    return
  }

  setText('header-selected-pool', `${card.tokenSymbol}/${card.quoteTokenSymbol || 'QUOTE'}`)
  setText('header-selected-price', formatPrice(getPoolDisplayPrice(card)))

  const rows = [
    ['Pool', `${card.tokenSymbol}/${card.quoteTokenSymbol || 'QUOTE'}`],
    ['DEX', card.dex],
    ['Fee Tier', card.feeTierLabel],
    ['Main Fee/TVL', formatIntervalPct(card.feeTvl?.[feeTvlInterval])],
    ['Liquidity', formatUsd(card.liquidityUsd)],
    ['24H Volume', formatUsd(card.volume24hUsd)],
    ['Rank', card.signalLabel || '-'],
    ['Action', 'Position setup panel comes next']
  ]

  for (const root of roots) {
    for (const [label, value] of rows) {
      const row = document.createElement('div')
      row.className = 'row'
      row.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`
      root.appendChild(row)
    }
  }
}

function getSelectedCardFromState() {
  if (!state.searchResult?.cards?.length) {
    return state.selectedPoolCard || null
  }

  return state.searchResult.cards.find((card) => buildPoolSelectionKey(card) === state.selectedPoolKey)
    || state.searchResult.cards.find((card) => String(card.pairAddress || '').toLowerCase() === String(state.selectedPoolCard?.pairAddress || '').toLowerCase())
    || state.searchResult.cards.find((card) => card.id === state.selectedPoolId)
    || state.selectedPoolCard
    || null
}

function buildPoolSelectionKey(card) {
  return [
    String(card?.dex || '').toLowerCase(),
    String(card?.dexLabel || '').toLowerCase(),
    String(card?.pairAddress || '').toLowerCase(),
    String(card?.tokenAddress || '').toLowerCase(),
    String(card?.quoteAddress || '').toLowerCase(),
    String(card?.tokenSymbol || '').toUpperCase(),
    String(card?.quoteTokenSymbol || '').toUpperCase()
  ].join('|')
}

function formatEditable(value, digits = 2) {
  if (value === '' || value == null) {
    return ''
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : ''
}

function getSetupRangeInputDisplayValue(id, fallbackValue) {
  if (setupRangeInputDraft.id === id) {
    return setupRangeInputDraft.value
  }
  return fallbackValue
}

function rememberSetupRangeInputDraft(id, node) {
  setupRangeInputDraft.id = id
  setupRangeInputDraft.value = node?.value ?? ''
  setupRangeInputDraft.selectionStart = Number.isInteger(node?.selectionStart) ? node.selectionStart : null
  setupRangeInputDraft.selectionEnd = Number.isInteger(node?.selectionEnd) ? node.selectionEnd : setupRangeInputDraft.selectionStart
}

function clearSetupRangeInputDraft(id = null) {
  if (id == null || setupRangeInputDraft.id === id) {
    setupRangeInputDraft.id = null
    setupRangeInputDraft.value = ''
    setupRangeInputDraft.selectionStart = null
    setupRangeInputDraft.selectionEnd = null
  }
}

function restoreSetupRangeInputFocus() {
  const id = setupRangeInputDraft.id
  if (!id) {
    return
  }
  const draftValue = setupRangeInputDraft.value
  const draftSelectionStart = setupRangeInputDraft.selectionStart
  const draftSelectionEnd = setupRangeInputDraft.selectionEnd

  requestAnimationFrame(() => {
    const node = document.getElementById(id)
    if (!node) {
      return
    }
    node.focus({ preventScroll: true })
    node.value = draftValue
    if (draftSelectionStart != null && typeof node.setSelectionRange === 'function') {
      const start = Math.min(draftSelectionStart, node.value.length)
      const end = Math.min(draftSelectionEnd ?? start, node.value.length)
      node.setSelectionRange(start, end)
    }
  })
}

function parseCompleteSetupNumber(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) {
    return null
  }
  const numeric = Number(trimmed.replace(',', '.'))
  return Number.isFinite(numeric) ? numeric : null
}

function buildSetupExecutablePreviewKey(card, setup) {
  if (!card) {
    return ''
  }
  return [
    card.pairAddress || card.poolAddress || card.tokenAddress || '',
    card.dex || '',
    card.protocolVersion || card.dexDisplay || '',
    setup.mode || 'bidask',
    setup.depositToken || 'quote',
    Number(setup.capitalUsd || 0),
    setup.minPct ?? '',
    setup.maxPct ?? '',
    Number(setup.slippagePct || 0.5),
    Number(setup.anchorPrice || 0),
    Boolean(setup.anchorLocked)
  ].join('|')
}

function getSetupExecutablePreviewRows(previewKey) {
  const executablePreview = state.setupExecutablePreview
  if (!executablePreview || executablePreview.key !== previewKey || executablePreview.status !== 'ready') {
    return []
  }
  return executablePreview.payload?.rows || []
}

function clearSetupExecutablePreview() {
  setupExecutablePreviewGeneration += 1
  if (setupExecutablePreviewTimer) {
    clearTimeout(setupExecutablePreviewTimer)
    setupExecutablePreviewTimer = null
  }
  state.setupExecutablePreview = null
}

function scheduleSetupExecutablePreview(card, setup, preview, buildReady) {
  const key = buildSetupExecutablePreviewKey(card, setup)
  if (!buildReady || !card || (preview?.mode || 'bidask') !== 'bidask' || !key) {
    clearSetupExecutablePreview()
    return
  }

  if (state.setupExecutablePreview?.key === key && ['loading', 'ready'].includes(state.setupExecutablePreview.status)) {
    return
  }

  if (setupExecutablePreviewTimer) {
    clearTimeout(setupExecutablePreviewTimer)
  }
  const generation = setupExecutablePreviewGeneration + 1
  setupExecutablePreviewGeneration = generation
  state.setupExecutablePreview = {
    key,
    status: 'loading',
    payload: null,
    error: null
  }

  setupExecutablePreviewTimer = setTimeout(async () => {
    setupExecutablePreviewTimer = null
    try {
      const payload = await postJson('/api/position-setup-preview', {
        card,
        setup
      }, { timeoutMs: SETUP_EXECUTABLE_PREVIEW_TIMEOUT_MS })
      if (generation !== setupExecutablePreviewGeneration) {
        return
      }
      state.setupExecutablePreview = {
        key,
        status: 'ready',
        payload,
        error: null
      }
    } catch (error) {
      if (generation !== setupExecutablePreviewGeneration) {
        return
      }
      state.setupExecutablePreview = {
        key,
        status: 'error',
        payload: null,
        error: error?.message || 'Executable tick preview unavailable'
      }
    }

    if (state.activeView === 'create' && !positionSetupRenderInProgress) {
      if (isEditingSetupRangeInputs() || isInteractingWithSetupControls()) {
        refreshSetupPreviewWhileEditing(getSelectedCardFromState(), { skipExecutableSchedule: true })
        return
      }
      renderPositionSetupPanel(getSelectedCardFromState())
    }
  }, SETUP_EXECUTABLE_PREVIEW_DEBOUNCE_MS)
}

function computeSetupPreviewModel(card) {
  const setup = state.positionSetup
  if (!card) {
    return null
  }
  const resolvedPrice = resolveSetupReferencePrice(card)
  const currentPrice = Number(resolvedPrice || 0)
  const effectiveAnchorPrice = getExecutionAnchorPrice(card, setup)
  if (effectiveAnchorPrice > 0 && Number(state.positionSetup.anchorPrice || 0) !== effectiveAnchorPrice) {
    state.positionSetup.anchorPrice = effectiveAnchorPrice
  }
  const anchorPrice = Number(effectiveAnchorPrice || resolvedPrice || 0)
  let preview
  let previewError = null
  try {
    preview = window.PositionSetupShared.buildPositionSetupPreview({
      ...setup,
      currentPrice: anchorPrice > 0 ? anchorPrice : currentPrice
    })
  } catch (error) {
    previewError = error
    preview = {
      mode: setup.mode || 'bidask',
      currentPrice,
      minPct: setup.minPct,
      maxPct: setup.maxPct,
      minPrice: null,
      maxPrice: null,
      positions: 0,
      rows: [],
      summary: {
        ready: false,
        totalCapitalUsd: Number(setup.capitalUsd || 0),
        averageCapitalUsd: 0,
        firstLossPct: 0,
        worstLossPct: 0,
        currentPrice
      }
    }
  }
  const priceMovePct = anchorPrice > 0 && currentPrice > 0
    ? (currentPrice / anchorPrice - 1) * 100
    : 0
  const executionSupport = buildUiExecutionSupportReport(card)
  const modeSupport = buildUiPoolModeSupportReport(card, preview.mode)
  const minPctNumber = Number(preview.minPct)
  const maxPctNumber = Number(preview.maxPct)
  let priceShiftBlocked = false

  if (!previewError && preview.mode === 'bidask' && Number.isFinite(minPctNumber) && Number.isFinite(maxPctNumber)) {
    priceShiftBlocked = isCardInsideConfiguredRange(
      currentPrice,
      preview.minPrice,
      preview.maxPrice,
      minPctNumber,
      maxPctNumber
    )
  } else if (preview.mode === 'spot') {
    priceShiftBlocked = Math.abs(priceMovePct) >= 0.3
  }
  const minPriceDisplay = setup.mode === 'bidask' && String(setup.minPct || '').trim() === ''
    ? formatSetupPriceInput(currentPrice)
    : (preview.minPrice == null ? formatSetupPriceInput(currentPrice) : formatSetupPriceInput(preview.minPrice))
  const maxPriceDisplay = setup.mode === 'bidask' && String(setup.maxPct || '').trim() === ''
    ? formatSetupPriceInput(currentPrice)
    : (preview.maxPrice == null ? formatSetupPriceInput(currentPrice) : formatSetupPriceInput(preview.maxPrice))
  const depositSideLabel = getDepositTokenLabel(card, setup.depositToken)
  const depositTokenUsdPrice = inferUiDepositTokenUsdPrice(card, setup.depositToken)
  const capitalInputValue = depositTokenUsdPrice > 0 && !['USDT', 'USDC', 'FDUSD', 'BUSD', 'USDE'].includes(depositSideLabel.toUpperCase())
    ? formatEditable((Number(setup.capitalUsd || 0) / depositTokenUsdPrice), 6)
    : formatEditable(Number(setup.capitalUsd || 0), 2)
  const buildReady = !previewError && (preview.mode === 'spot'
    || (Number.isFinite(Number(preview.minPrice)) && Number.isFinite(Number(preview.maxPrice)) && Number(preview.positions || 0) > 0))
  const setupExecutablePreviewKey = buildSetupExecutablePreviewKey(card, setup)
  const setupExecutableRows = getSetupExecutablePreviewRows(setupExecutablePreviewKey)
  const openPositionDisabled = !buildReady || priceShiftBlocked || !state.keystore.status?.unlocked || (!executionSupport.ok && modeSupport.ok)
  const readinessLabel = !buildReady
    ? 'Range required'
    : !modeSupport.ok
      ? 'Use Spot'
      : !executionSupport.ok
        ? 'Unsupported pool'
      : priceShiftBlocked
        ? 'Range blocked'
        : !state.keystore.status?.unlocked
          ? 'Unlock wallet'
          : 'Ready to open'
  const readinessClass = openPositionDisabled ? ' muted' : ' ready'

  return {
    setup,
    currentPrice,
    preview,
    previewError,
    executionSupport,
    modeSupport,
    priceShiftBlocked,
    minPriceDisplay,
    maxPriceDisplay,
    capitalInputValue,
    buildReady,
    setupExecutablePreviewKey,
    setupExecutableRows,
    openPositionDisabled,
    readinessLabel,
    readinessClass
  }
}

function renderSetupPreviewRows(preview, setupExecutableRows = [], spotSummary = null, card = null) {
  if ((preview?.mode || 'bidask') === 'bidask') {
    return [...(preview.rows || [])].sort((left, right) => Number(right.upperPrice || 0) - Number(left.upperPrice || 0)).map((row) => {
      const executableRow = setupExecutableRows.find((item) => Number(item.index || 0) === Number(row.index || 0))
      const executableLine = executableRow && Number.isFinite(Number(executableRow.executableLowerPrice)) && Number.isFinite(Number(executableRow.executableUpperPrice))
        ? `<span>Executable Range ${formatNumber(executableRow.executableUpperPrice, 6)} .. ${formatNumber(executableRow.executableLowerPrice, 6)} | ticks ${executableRow.executableTickLower}..${executableRow.executableTickUpper}</span>`
        : ''
      return `
        <div class="create-preview-item">
          <span class="create-preview-index">${row.index}</span>
          <div class="create-preview-meta">
            <strong>${Math.min(row.upperPct, row.lowerPct).toFixed(2)}% .. ${Math.max(row.upperPct, row.lowerPct).toFixed(2)}%</strong>
            <span>${formatNumber(row.upperPrice, 6)} .. ${formatNumber(row.lowerPrice, 6)}</span>
            ${executableLine}
          </div>
          <div class="create-preview-right">
            <strong>${formatPreviewCapitalUsd(row.capitalUsd)}</strong>
            <span class="setup-loss-stack"><span>Loss ${formatPct(row.lossAtLevel)}</span><span data-setup-loss-usd>${formatSetupLossUsd(row.lossAtLevel, preview.summary.totalCapitalUsd)}</span></span>
          </div>
        </div>
      `
    }).join('')
  }

  const spotDepositUsageLabel = formatSpotDepositUsageLabel(spotSummary || preview?.summary, card)
  const spotDepositUsageDetail = formatSpotDepositUsageDetail(spotSummary || preview?.summary)
  return (preview?.rows || []).map((row) => `
        <div class="create-preview-item">
          <span class="create-preview-index">1</span>
          <div class="create-preview-meta">
            <strong>Spot LP ${escapeHtml(row.rangeShape || 'around')}</strong>
            <span>Ref ${formatNumber(row.referencePrice, 6)}</span>
            <span data-setup-spot-deposit-usage>Uses ${escapeHtml(spotDepositUsageLabel)}</span>
          </div>
          <div class="create-preview-right">
            <strong>${formatUsd(row.capitalUsd)}</strong>
            <span>${escapeHtml(spotDepositUsageDetail)}</span>
          </div>
        </div>
      `).join('')
}

function getSetupExecutableStatusLabel(model) {
  if ((model?.preview?.mode || 'bidask') !== 'bidask') {
    return ''
  }
  const executablePreview = state.setupExecutablePreview
  if (executablePreview?.key === model.setupExecutablePreviewKey && executablePreview.status === 'ready') {
    return 'Snapped'
  }
  if (executablePreview?.key === model.setupExecutablePreviewKey && executablePreview.status === 'error') {
    return 'Unavailable'
  }
  return 'Checking'
}

function updateSetupInputIfIdle(id, value) {
  const node = document.getElementById(id)
  if (!node || document.activeElement === node) {
    return
  }
  node.value = value
}

function refreshSetupPreviewWhileEditing(card = getSelectedCardFromState(), { skipExecutableSchedule = false } = {}) {
  const model = computeSetupPreviewModel(card)
  if (!model) {
    return
  }
  const { setup, preview, currentPrice } = model
  const previewRows = renderSetupPreviewRows(preview, model.setupExecutableRows, state.setupExecutionResult?.summary, card)
  const autoPositions = preview.mode === 'bidask' ? String(preview.positions || 0) : formatNumber(preview.summary.estimatedUnits, 4)
  const modeLabel = preview.mode === 'bidask' ? `${preview.positions || 0} auto positions` : `${formatNumber(preview.summary.estimatedUnits, 4)} units`
  const slotsLabel = preview.mode === 'bidask' ? `${preview.positions || 0} ladder slots` : 'spot route'

  updateSetupInputIfIdle('setup-capital-usd', model.capitalInputValue)
  updateSetupInputIfIdle('setup-min-price', model.minPriceDisplay)
  updateSetupInputIfIdle('setup-max-price', model.maxPriceDisplay)
  updateSetupInputIfIdle('setup-min-pct', formatEditable(preview.minPct, 2))
  updateSetupInputIfIdle('setup-max-pct', formatEditable(preview.maxPct, 2))

  for (const node of document.querySelectorAll('[data-setup-auto-positions]')) {
    node.textContent = autoPositions
  }
  for (const node of document.querySelectorAll('[data-setup-mode-chip]')) {
    node.textContent = modeLabel
  }
  for (const node of document.querySelectorAll('[data-setup-slots-chip]')) {
    node.textContent = slotsLabel
  }
  for (const node of document.querySelectorAll('[data-setup-stretch]')) {
    node.textContent = `${formatPct(preview.minPct || 0)} .. ${formatPct(preview.maxPct || 0)}`
  }
  for (const node of document.querySelectorAll('[data-setup-drawdown]')) {
    node.textContent = formatPct(preview.summary.worstLossPct)
  }
  for (const node of document.querySelectorAll('[data-setup-total-capital]')) {
    node.textContent = formatUsd(preview.summary.totalCapitalUsd)
  }
  for (const node of document.querySelectorAll('[data-setup-executable-status]')) {
    node.textContent = getSetupExecutableStatusLabel(model)
  }
  for (const node of document.querySelectorAll('[data-setup-current-price-text]')) {
    node.textContent = formatNumber(currentPrice, 6)
  }
  for (const node of document.querySelectorAll('[data-setup-range-health]')) {
    node.textContent = model.priceShiftBlocked ? 'Recheck range' : 'Within guardrails'
  }
  for (const node of document.querySelectorAll('[data-setup-readiness-label]')) {
    node.textContent = model.readinessLabel
    node.className = node.className.replace(/\s+(muted|ready)\b/g, '') + model.readinessClass
  }
  const previewList = document.querySelector('[data-setup-preview-list]')
  if (previewList) {
    previewList.innerHTML = previewRows || '<div class="setup-empty">Enter range values to build the ladder preview.</div>'
  }
  const openButton = document.getElementById('live-scenario-open-button')
  if (openButton) {
    openButton.disabled = model.openPositionDisabled
  }

  if (!skipExecutableSchedule) {
    scheduleSetupExecutablePreview(card, setup, preview, model.buildReady && model.executionSupport.ok && model.modeSupport.ok)
  }
}

function renderPositionSetupPanel(card) {
  const root = document.getElementById('position-setup-root')
  const setup = state.positionSetup
  positionSetupRenderInProgress = true
  root.innerHTML = ''

  if (!card) {
    setText('setup-meta', 'Select a pool to build a Bid/Ask or Spot entry preview.')
    root.innerHTML = '<div class="setup-empty">Select a pool above to build a Bid/Ask or Spot entry preview.</div>'
    positionSetupRenderInProgress = false
    return
  }

  const resolvedPrice = resolveSetupReferencePrice(card)
  const currentPrice = Number(resolvedPrice || 0)
  const effectiveAnchorPrice = getExecutionAnchorPrice(card, setup)
  if (effectiveAnchorPrice > 0 && Number(state.positionSetup.anchorPrice || 0) !== effectiveAnchorPrice) {
    state.positionSetup.anchorPrice = effectiveAnchorPrice
  }
  const anchorPrice = Number(effectiveAnchorPrice || resolvedPrice || 0)
  let preview
  let previewError = null
  try {
    preview = window.PositionSetupShared.buildPositionSetupPreview({
      ...setup,
      currentPrice: anchorPrice > 0 ? anchorPrice : currentPrice
    })
  } catch (error) {
    previewError = error
    preview = {
      mode: setup.mode || 'bidask',
      currentPrice,
      minPct: setup.minPct,
      maxPct: setup.maxPct,
      minPrice: null,
      maxPrice: null,
      positions: 0,
      rows: [],
      summary: {
        ready: false,
        totalCapitalUsd: Number(setup.capitalUsd || 0),
        averageCapitalUsd: 0,
        firstLossPct: 0,
        worstLossPct: 0,
        currentPrice
      }
    }
  }
  const priceMovePct = anchorPrice > 0 && currentPrice > 0
    ? (currentPrice / anchorPrice - 1) * 100
    : 0
  const executionSupport = buildUiExecutionSupportReport(card)
  const modeSupport = buildUiPoolModeSupportReport(card, preview.mode)
  const minPctNumber = Number(preview.minPct)
  const maxPctNumber = Number(preview.maxPct)
  let priceShiftBlocked = false

  if (!previewError && preview.mode === 'bidask' && Number.isFinite(minPctNumber) && Number.isFinite(maxPctNumber)) {
    priceShiftBlocked = isCardInsideConfiguredRange(
      currentPrice,
      preview.minPrice,
      preview.maxPrice,
      minPctNumber,
      maxPctNumber
    )
  } else if (preview.mode === 'spot') {
    priceShiftBlocked = Math.abs(priceMovePct) >= 0.3
  }

  setText('setup-meta', `Selected ${card.tokenSymbol}/${card.quoteTokenSymbol || 'QUOTE'} on ${card.dexLabel || card.dex}. Preview updates live while you change settings.`)

  const minPriceDisplay = setup.mode === 'bidask' && String(setup.minPct || '').trim() === ''
    ? formatSetupPriceInput(currentPrice)
    : (preview.minPrice == null ? formatSetupPriceInput(currentPrice) : formatSetupPriceInput(preview.minPrice))
  const maxPriceDisplay = setup.mode === 'bidask' && String(setup.maxPct || '').trim() === ''
    ? formatSetupPriceInput(currentPrice)
    : (preview.maxPrice == null ? formatSetupPriceInput(currentPrice) : formatSetupPriceInput(preview.maxPrice))
  const depositSideLabel = getDepositTokenLabel(card, setup.depositToken)
  const depositTokenUsdPrice = inferUiDepositTokenUsdPrice(card, setup.depositToken)
  const capitalInputValue = depositTokenUsdPrice > 0 && !['USDT', 'USDC', 'FDUSD', 'BUSD', 'USDE'].includes(depositSideLabel.toUpperCase())
    ? formatEditable((Number(setup.capitalUsd || 0) / depositTokenUsdPrice), 6)
    : formatEditable(Number(setup.capitalUsd || 0), 2)
  const capitalHelper = depositTokenUsdPrice > 0 && !['USDT', 'USDC', 'FDUSD', 'BUSD', 'USDE'].includes(depositSideLabel.toUpperCase())
    ? formatUsd(Number(setup.capitalUsd || 0))
    : ''
  const buildReady = !previewError && (preview.mode === 'spot'
    || (Number.isFinite(Number(preview.minPrice)) && Number.isFinite(Number(preview.maxPrice)) && Number(preview.positions || 0) > 0))
  const setupExecutablePreviewKey = buildSetupExecutablePreviewKey(card, setup)
  const setupExecutableRows = getSetupExecutablePreviewRows(setupExecutablePreviewKey)
  const openPositionDisabled = !buildReady || priceShiftBlocked || !state.keystore.status?.unlocked || (!executionSupport.ok && modeSupport.ok)
  const readinessLabel = !buildReady
    ? 'Range required'
    : !modeSupport.ok
      ? 'Use Spot'
      : !executionSupport.ok
        ? 'Unsupported pool'
      : priceShiftBlocked
        ? 'Range blocked'
        : !state.keystore.status?.unlocked
          ? 'Unlock wallet'
          : 'Ready to open'
  const readinessClass = openPositionDisabled ? ' muted' : ' ready'
  let executionBox = ''
  if (state.setupExecutionResult?.kind === 'dry-run') {
    executionBox = `
      <div class="setup-execution-box ${state.setupExecutionResult.dryRun.ok ? 'success' : 'warning'}">
        <div class="execution-box-head">
          <strong>${state.setupExecutionResult.dryRun.ok ? 'Execution Ready' : 'Execution Blocked'}</strong>
          <span class="execution-box-kind">Plan Review</span>
        </div>
        <div class="row"><span>Requests</span><strong>${state.setupExecutionResult.dryRun.requestCount}</strong></div>
        <div class="row"><span>Slippage</span><strong>${formatPct(state.setupExecutionResult.summary?.slippagePct || 0)}</strong></div>
        <div class="row"><span>Total Deposit</span><strong>${formatRawTokenAmount(
          state.setupExecutionResult.summary?.totalDepositAmount,
          state.setupExecutionResult.summary?.depositToken,
          state.setupExecutionResult.summary?.depositTokenDecimals
        )}</strong></div>
        <div class="row"><span>Preflight</span><strong>${state.setupExecutionResult.dryRun.preflightOk ? 'OK' : 'Blocked'}</strong></div>
      </div>
    `
  } else if (state.setupExecutionResult?.kind === 'error') {
    executionBox = `<div class="setup-warning">${escapeHtml(state.setupExecutionResult.error)}</div>`
  }

  const activeRunner = state.liveRunner.targetRun || state.liveRunner.activeRun
  const runnerBox = activeRunner
    ? `
      <div class="setup-execution-box ${activeRunner.status === 'completed' ? 'success' : activeRunner.status === 'failed' || activeRunner.status === 'aborted' ? 'warning' : ''}">
        <div class="execution-box-head">
          <strong>${escapeHtml(activeRunner.scenarioLabel || 'Live Scenario Runner')}</strong>
          <span class="execution-box-kind">Runner</span>
        </div>
        <div class="row"><span>Status</span><strong>${escapeHtml(activeRunner.status || 'unknown')}</strong></div>
        <div class="row"><span>Step</span><strong>${escapeHtml(mapLiveRunnerStep(activeRunner))}</strong></div>
        <div class="row"><span>Progress</span><strong>${Math.max(0, Number(activeRunner.current || 0))}/${Math.max(1, Number(activeRunner.total || 1))}</strong></div>
        <div class="row"><span>Message</span><strong>${escapeHtml(activeRunner.message || '-')}</strong></div>
        ${activeRunner.error ? `<div class="row"><span>Error</span><strong>${escapeHtml(activeRunner.error)}</strong></div>` : ''}
        ${['queued', 'preflight', 'opening', 'opened', 'closing', 'autoswapping', 'reconciling'].includes(String(activeRunner.status || ''))
          ? `<div class="row"><span>Control</span><strong><button type="button" class="ghost-button" id="live-runner-abort-button">Abort</button></strong></div>`
          : ''}
        ${['failed', 'aborted'].includes(String(activeRunner.status || ''))
          ? `<div class="row"><span>Control</span><strong><button type="button" class="ghost-button" id="live-runner-resume-button">Resume</button></strong></div>`
          : ''}
      </div>
    `
    : ''

  const strategyButtons = `
    <div class="strategy-switch">
      <button type="button" class="strategy-button${setup.mode === 'bidask' ? ' active' : ''}" data-setup-mode="bidask">
        <strong>Bid / Ask</strong>
        <small>Layered ladder entry with linked min and max range controls.</small>
      </button>
      <button type="button" class="strategy-button${setup.mode === 'spot' ? ' active' : ''}" data-setup-mode="spot">
        <strong>Spot</strong>
        <small>One LP position: below, above, or around the current price.</small>
      </button>
    </div>
  `

  const capitalSettings = `
    <div class="builder-form-grid three capital-grid create-control-grid">
      <label class="builder-field builder-field-wide">
        <span>Capital (${depositSideLabel})</span>
        <input id="setup-capital-usd" type="number" min="0" step="any" value="${escapeHtml(getSetupRangeInputDisplayValue('setup-capital-usd', capitalInputValue))}">
        ${capitalHelper ? `<small>${escapeHtml(capitalHelper)}</small>` : ''}
      </label>
      <label class="builder-field builder-field-compact">
        <span>Deposit Side</span>
        <select id="setup-deposit-token">
          <option value="quote"${setup.depositToken === 'quote' ? ' selected' : ''}>${escapeHtml(card.quoteTokenSymbol || 'QUOTE')}</option>
          <option value="base"${setup.depositToken === 'base' ? ' selected' : ''}>${escapeHtml(card.tokenSymbol || 'BASE')}</option>
        </select>
      </label>
      <label class="builder-field builder-field-tight">
        <span>Slippage (%)</span>
        <input id="setup-slippage" type="number" min="0" step="0.1" value="${setup.slippagePct}">
      </label>
    </div>
  `

  const bidAskSettings = `
    <div class="builder-range-card">
      <div class="builder-range-head">
        <div class="builder-range-title">
          <strong>Price Range</strong>
          <span>Enter either price or percentage. Both stay linked to the live pool price.</span>
        </div>
        <div class="builder-inline-chip">
          <span>Auto Positions</span>
          <strong data-setup-auto-positions>${preview.positions}</strong>
        </div>
      </div>
      <div class="builder-range-grid">
        <section class="range-column">
          <div class="range-column-label">
            <strong>Min Range</strong>
            <span>Lower ladder boundary</span>
          </div>
          <div class="range-input-grid">
            <label class="builder-field">
              <span>Min Price</span>
              <input id="setup-min-price" type="text" inputmode="decimal" value="${escapeHtml(getSetupRangeInputDisplayValue('setup-min-price', minPriceDisplay))}" placeholder="Enter min price">
            </label>
            <label class="builder-field">
              <span>Min (%)</span>
              <input id="setup-min-pct" type="text" inputmode="decimal" value="${escapeHtml(getSetupRangeInputDisplayValue('setup-min-pct', formatEditable(preview.minPct, 2)))}" placeholder="e.g. -8 or -27.5">
            </label>
          </div>
        </section>
        <section class="range-center-card">
          <div class="range-center-live">
            <span>Current Price</span>
            <div class="range-center-price-line">
              <strong data-setup-current-price-text>${formatNumber(currentPrice, 6)}</strong>
              <button type="button" id="setup-refresh-price-inline" class="price-refresh-button" aria-label="Refresh current price" title="Refresh current price">&#8635;</button>
            </div>
            <small id="setup-current-price-updated-inline" class="current-age-chip">${formatRelativeSeconds(state.marketDisplayUpdatedAt || state.marketUpdatedAt)}</small>
          </div>
        </section>
        <section class="range-column">
          <div class="range-column-label">
            <strong>Max Range</strong>
            <span>Upper ladder boundary</span>
          </div>
          <div class="range-input-grid">
            <label class="builder-field">
              <span>Max Price</span>
              <input id="setup-max-price" type="text" inputmode="decimal" value="${escapeHtml(getSetupRangeInputDisplayValue('setup-max-price', maxPriceDisplay))}" placeholder="Enter max price">
            </label>
            <label class="builder-field">
              <span>Max (%)</span>
              <input id="setup-max-pct" type="text" inputmode="decimal" value="${escapeHtml(getSetupRangeInputDisplayValue('setup-max-pct', formatEditable(preview.maxPct, 2)))}" placeholder="e.g. 0">
            </label>
          </div>
        </section>
      </div>
      <div class="builder-inline-grid">
        <div class="builder-stat">
          <span>Stretch</span>
          <strong data-setup-stretch>${formatPct(preview.minPct || 0)} .. ${formatPct(preview.maxPct || 0)}</strong>
        </div>
        <div class="builder-stat">
          <span>Max Drawdown</span>
          <strong class="setup-loss-stack builder-drawdown-stack" data-setup-drawdown><span>${formatPct(preview.summary.worstLossPct)}</span><span data-setup-loss-usd>${formatSetupLossUsd(preview.summary.worstLossPct, preview.summary.totalCapitalUsd)}</span></strong>
        </div>
      </div>
    </div>
  `

  const spotSettings = `
    <div class="builder-range-card">
      <div class="builder-range-head">
        <div class="builder-range-title">
          <strong>Spot LP Range</strong>
          <span>One position. Use a range below, above, or around the current price.</span>
        </div>
        <div class="builder-inline-chip">
          <span>Range Shape</span>
          <strong>${escapeHtml(preview.summary.rangeShape || 'around')}</strong>
        </div>
      </div>
      <div class="builder-range-grid">
        <section class="range-column">
          <div class="range-column-label">
            <strong>Min Range</strong>
            <span>Lower LP boundary</span>
          </div>
          <div class="range-input-grid">
            <label class="builder-field">
              <span>Min Price</span>
              <input id="setup-min-price" type="text" inputmode="decimal" value="${escapeHtml(getSetupRangeInputDisplayValue('setup-min-price', minPriceDisplay))}" placeholder="Enter min price">
            </label>
            <label class="builder-field">
              <span>Min (%)</span>
              <input id="setup-min-pct" type="text" inputmode="decimal" value="${escapeHtml(getSetupRangeInputDisplayValue('setup-min-pct', formatEditable(preview.minPct, 2)))}" placeholder="e.g. -10">
            </label>
          </div>
        </section>
        <section class="range-center-card">
          <div class="range-center-live">
            <span>Current Price</span>
            <div class="range-center-price-line">
              <strong data-setup-current-price-text>${formatNumber(currentPrice, 6)}</strong>
              <button type="button" id="setup-refresh-price-inline" class="price-refresh-button" aria-label="Refresh current price" title="Refresh current price">&#8635;</button>
            </div>
            <small id="setup-current-price-updated-inline" class="current-age-chip">${formatRelativeSeconds(state.marketDisplayUpdatedAt || state.marketUpdatedAt)}</small>
          </div>
        </section>
        <section class="range-column">
          <div class="range-column-label">
            <strong>Max Range</strong>
            <span>Upper LP boundary</span>
          </div>
          <div class="range-input-grid">
            <label class="builder-field">
              <span>Max Price</span>
              <input id="setup-max-price" type="text" inputmode="decimal" value="${escapeHtml(getSetupRangeInputDisplayValue('setup-max-price', maxPriceDisplay))}" placeholder="Enter max price">
            </label>
            <label class="builder-field">
              <span>Max (%)</span>
              <input id="setup-max-pct" type="text" inputmode="decimal" value="${escapeHtml(getSetupRangeInputDisplayValue('setup-max-pct', formatEditable(preview.maxPct, 2)))}" placeholder="e.g. 10">
            </label>
          </div>
        </section>
      </div>
      <div class="builder-inline-grid">
        <div class="builder-stat">
          <span>Stretch</span>
          <strong data-setup-stretch>${formatPct(preview.minPct || 0)} .. ${formatPct(preview.maxPct || 0)}</strong>
        </div>
        <div class="builder-stat">
          <span>Estimated Units</span>
          <strong>${formatNumber(preview.summary.estimatedUnits, 4)}</strong>
        </div>
      </div>
    </div>
  `

  const orderedPreviewRows = preview.mode === 'bidask'
    ? [...(preview.rows || [])].sort((left, right) => Number(right.upperPrice || 0) - Number(left.upperPrice || 0))
    : (preview.rows || [])
  const spotExecutionSummary = preview.mode === 'spot' && state.setupExecutionResult?.mode === 'spot'
    ? state.setupExecutionResult.summary
    : null
  const spotDepositUsageLabel = preview.mode === 'spot'
    ? formatSpotDepositUsageLabel(spotExecutionSummary || preview.summary, card)
    : depositSideLabel
  const spotDepositUsageDetail = preview.mode === 'spot'
    ? formatSpotDepositUsageDetail(spotExecutionSummary || preview.summary)
    : ''
  const previewRows = preview.mode === 'bidask'
    ? orderedPreviewRows.map((row) => {
        const executableRow = setupExecutableRows.find((item) => Number(item.index || 0) === Number(row.index || 0))
        const executableLine = executableRow && Number.isFinite(Number(executableRow.executableLowerPrice)) && Number.isFinite(Number(executableRow.executableUpperPrice))
          ? `<span>Executable Range ${formatNumber(executableRow.executableUpperPrice, 6)} .. ${formatNumber(executableRow.executableLowerPrice, 6)} | ticks ${executableRow.executableTickLower}..${executableRow.executableTickUpper}</span>`
          : ''
        return `
        <div class="create-preview-item">
          <span class="create-preview-index">${row.index}</span>
          <div class="create-preview-meta">
            <strong>${Math.min(row.upperPct, row.lowerPct).toFixed(2)}% .. ${Math.max(row.upperPct, row.lowerPct).toFixed(2)}%</strong>
            <span>${formatNumber(row.upperPrice, 6)} .. ${formatNumber(row.lowerPrice, 6)}</span>
            ${executableLine}
          </div>
          <div class="create-preview-right">
            <strong>${formatPreviewCapitalUsd(row.capitalUsd)}</strong>
            <span class="setup-loss-stack"><span>Loss ${formatPct(row.lossAtLevel)}</span><span data-setup-loss-usd>${formatSetupLossUsd(row.lossAtLevel, preview.summary.totalCapitalUsd)}</span></span>
          </div>
        </div>
      `
      }).join('')
    : preview.rows.map((row) => `
        <div class="create-preview-item">
          <span class="create-preview-index">1</span>
          <div class="create-preview-meta">
            <strong>Spot LP ${escapeHtml(row.rangeShape || 'around')}</strong>
            <span>${formatNumber(row.lowerPrice, 6)} .. ${formatNumber(row.upperPrice, 6)}</span>
            <span data-setup-spot-deposit-usage>Uses ${escapeHtml(spotDepositUsageLabel)}</span>
          </div>
          <div class="create-preview-right">
            <strong>${formatUsd(row.capitalUsd)}</strong>
            <span>${escapeHtml(spotDepositUsageDetail)}</span>
          </div>
        </div>
      `).join('')

  root.innerHTML = `
    <div class="create-builder">
      <section class="create-hero create-hero-reimagined">
        <div class="create-hero-main">
          <div class="create-hero-heading-row">
            <div class="create-hero-copy">
              <div class="create-hero-title-row">
                <h3>${escapeHtml(`${card.tokenSymbol || 'TOKEN'}/${card.quoteTokenSymbol || 'QUOTE'}`)}</h3>
                <div class="create-hero-status">
                  <span class="hero-status-pill">${setup.mode === 'bidask' ? 'Bid / Ask' : 'Spot'}</span>
                  <span class="hero-status-pill${readinessClass}" data-setup-readiness-label>${readinessLabel}</span>
                </div>
              </div>
              <p>Selected pool on ${escapeHtml(card.dexLabel || card.dex)}. Fee tier ${escapeHtml(card.feeTierLabel)}. Build the entry and open from one compact workspace.</p>
            </div>
          </div>
          <div class="create-hero-facts-grid">
            <div class="hero-fact-card">
              <span>Pool</span>
              <strong>${escapeHtml(`${card.tokenSymbol || 'TOKEN'}/${card.quoteTokenSymbol || 'QUOTE'}`)}</strong>
            </div>
            <div class="hero-fact-card">
              <span>DEX</span>
              <strong>${escapeHtml(card.dexLabel || card.dex)}</strong>
            </div>
            <div class="hero-fact-card">
              <span>Pool Type</span>
              <strong data-pool-type-label>${escapeHtml(getUiPoolTypeLabel(card))}</strong>
            </div>
            <div class="hero-fact-card">
              <span>Fee Tier</span>
              <strong>${escapeHtml(card.feeTierLabel)}</strong>
            </div>
            <div class="hero-fact-card">
              <span>Liquidity</span>
              <strong>${formatUsd(card.liquidityUsd)}</strong>
            </div>
            <div class="hero-fact-card">
              <span>4H Fee/TVL</span>
              <strong>${formatIntervalPct(card.feeTvl?.['4h'])}</strong>
            </div>
            <div class="hero-fact-card">
              <span>1H Vol</span>
              <strong>${formatUsd(card.volume1hUsd)}</strong>
            </div>
            <div class="hero-fact-card">
              <span>Age</span>
              <strong>${formatAge(card.ageHours)}</strong>
            </div>
            <div class="hero-fact-card">
              <span>Deposit</span>
              <strong>${depositSideLabel}</strong>
            </div>
          </div>
        </div>
        <aside class="create-hero-side create-hero-board create-hero-price-panel">
          <span class="hero-price-label">Live Price</span>
          <div class="hero-price-value">
            <strong id="setup-current-price-value" data-setup-current-price-text>${formatNumber(currentPrice, 6)}</strong>
          </div>
          <div class="create-hero-price-meta">
            <div class="hero-mini-row"><span>Pool</span><strong>${escapeHtml(`${card.tokenSymbol || 'TOKEN'}/${card.quoteTokenSymbol || 'QUOTE'}`)}</strong></div>
            <div class="hero-mini-row"><span>Execution</span><strong>${state.keystore.status?.unlocked ? 'Unlocked' : 'Locked'}</strong></div>
          </div>
          <span id="setup-current-price-updated" class="hero-price-updated hidden" aria-hidden="true"></span>
        </aside>
      </section>

      <div class="create-main-grid create-main-grid-reimagined">
        <div class="builder-stack create-primary-column">
          <section class="builder-card create-section-card create-entry-setup-card selected-pool-spotlight">
            <div class="create-entry-head">
              <div>
                <h3>Entry Setup</h3>
                <p>Pick the route, then dial the core controls without oversized cards.</p>
              </div>
              <div class="create-entry-badge">${setup.mode === 'bidask' ? 'Ladder route' : 'Spot route'}</div>
            </div>
            <div class="create-entry-shell">
              ${strategyButtons}
              <div class="create-entry-fields">
                ${capitalSettings}
                <div class="create-entry-inline-meta">
                  <div class="entry-inline-pill"><span>Deposit</span><strong>${depositSideLabel}</strong></div>
                  <div class="entry-inline-pill"><span>Slippage</span><strong>${formatPct(setup.slippagePct || 0)}</strong></div>
                  <div class="entry-inline-pill"><span>Price</span><strong data-setup-current-price-text>${formatNumber(currentPrice, 6)}</strong></div>
                </div>
              </div>
            </div>
          </section>

          <section class="builder-card create-section-card">
            <div class="create-card-header">
              <div>
                <h3>${setup.mode === 'bidask' ? 'Range Builder' : 'Spot Builder'}</h3>
                <p>${setup.mode === 'bidask'
                  ? 'Stretch the ladder in price or percent terms without wasting horizontal space.'
                  : 'Use the selected pool as a single-route reference while keeping the same entry guardrails.'}</p>
              </div>
              <div class="create-card-chip" data-setup-mode-chip>${setup.mode === 'bidask' ? `${preview.positions || 0} auto positions` : `${formatNumber(preview.summary.estimatedUnits, 4)} units`}</div>
            </div>
            ${setup.mode === 'bidask' ? bidAskSettings : spotSettings}
          </section>
        </div>

        <div class="preview-stack create-secondary-column">
          <section class="create-preview-card create-preview-card-bottom create-preview-card-compact">
            <div class="create-preview-head">
              <div>
                <h3>Quick Preview</h3>
                <p>Compact live summary of the current setup before the final open action.</p>
              </div>
              <div class="create-card-chip" data-setup-slots-chip>${escapeHtml(preview.mode === 'bidask' ? `${preview.positions || 0} ladder slots` : 'spot route')}</div>
            </div>
            <div class="create-preview-summary create-preview-summary-compact">
              <div class="row"><span>Total Capital</span><strong class="preview-emphasis" data-setup-total-capital>${formatUsd(preview.summary.totalCapitalUsd)}</strong></div>
              <div class="row"><span>${preview.mode === 'bidask' ? 'Auto Positions' : 'Estimated Units'}</span><strong data-setup-auto-positions>${preview.mode === 'bidask' ? preview.positions : formatNumber(preview.summary.estimatedUnits, 4)}</strong></div>
              ${preview.mode === 'bidask' ? `<div class="row"><span>Executable Ticks</span><strong data-setup-executable-status>${state.setupExecutablePreview?.key === setupExecutablePreviewKey && state.setupExecutablePreview.status === 'ready' ? 'Snapped' : state.setupExecutablePreview?.key === setupExecutablePreviewKey && state.setupExecutablePreview.status === 'error' ? 'Unavailable' : 'Checking'}</strong></div>` : ''}
              <div class="row"><span>Fee Tier</span><strong class="preview-accent">${escapeHtml(card.feeTierLabel)}</strong></div>
              <div class="row"><span>Deposit Side</span><strong data-setup-spot-deposit-usage>${preview.mode === 'spot' ? escapeHtml(spotDepositUsageLabel) : escapeHtml(depositSideLabel)}</strong></div>
              <div class="row"><span>Max Drawdown</span><strong class="preview-danger setup-loss-stack summary-drawdown-stack" data-setup-drawdown><span>${formatPct(preview.summary.worstLossPct)}</span><span data-setup-loss-usd>${formatSetupLossUsd(preview.summary.worstLossPct, preview.summary.totalCapitalUsd)}</span></strong></div>
              <div class="row"><span>Slippage</span><strong class="preview-accent">${formatPct(setup.slippagePct || 0)}</strong></div>
            </div>
            <div class="create-preview-list create-preview-list-compact" data-setup-preview-list>${previewRows || '<div class="setup-empty">Enter range values to build the ladder preview.</div>'}</div>
          </section>

          <section class="builder-card create-action-card">
            <div class="create-card-header">
              <div>
                <h3>Open Position</h3>
                <p>Single production action. The button stays guarded by range validity, price checks and keystore readiness.</p>
              </div>
            <div class="create-action-status${readinessClass}" data-setup-readiness-label>${escapeHtml(readinessLabel)}</div>
            </div>
            <div class="create-action-summary">
              <div class="row"><span>Route</span><strong>${setup.mode === 'bidask' ? 'Bid / Ask Ladder' : 'Spot Entry'}</strong></div>
              <div class="row"><span>Wallet Session</span><strong>${state.keystore.status?.unlocked ? 'Unlocked' : 'Locked'}</strong></div>
              <div class="row"><span>Pool Price</span><strong data-setup-current-price-text>${formatNumber(currentPrice, 6)}</strong></div>
              <div class="row"><span>Pool Type</span><strong data-pool-type-label>${escapeHtml(getUiPoolTypeLabel(card))}</strong></div>
              <div class="row"><span>Range Health</span><strong data-setup-range-health>${priceShiftBlocked ? 'Recheck range' : 'Within guardrails'}</strong></div>
            </div>
            <button type="button" id="live-scenario-open-button" class="create-open-button"${openPositionDisabled ? ' disabled' : ''}>Open Live Position</button>
            <div class="setup-actions-note">Uses the unlocked local keystore session and the live protected limits for the selected pool.</div>
            ${executionBox}
            ${runnerBox}
            ${previewError ? `<div class="setup-warning">${escapeHtml(previewError.message || 'Position preview failed')}</div>` : ''}
            ${!modeSupport.ok ? `<div class="setup-warning">${escapeHtml(modeSupport.message)}</div>` : ''}
            ${!executionSupport.ok ? `<div class="setup-warning">${escapeHtml(executionSupport.message || 'This pool is not executable in the current operator path.')}</div>` : ''}
            ${!previewError && priceShiftBlocked ? `<div class="setup-warning">Live price is already inside or beyond your configured range. Recheck the stretch before opening so the ladder still starts one-sided.</div>` : ''}
            ${!buildReady ? `<div class="setup-warning">Enter a valid Bid/Ask stretch or Spot amount context before opening the position.</div>` : ''}
            ${!state.keystore.status?.unlocked ? `<div class="setup-warning">Unlock the local keystore session before starting live execution.</div>` : ''}
          </section>
        </div>
      </div>
    </div>
  `

  bindSetupControls()
  restoreSetupRangeInputFocus()
  scheduleSetupExecutablePreview(card, setup, preview, buildReady && executionSupport.ok && modeSupport.ok)
  positionSetupRenderInProgress = false
}

function bindSetupControls() {
  const selectedCard = getSelectedCardFromState()
  const setupRoot = document.getElementById('position-setup-root')
  if (setupRoot) {
    setupRoot.addEventListener('pointerdown', (event) => {
      const node = event.target?.closest?.('input, select, textarea, button')
      if (!node) {
        return
      }
      lockSetupInteraction(30_000)
      if (SETUP_EDIT_INPUT_IDS.has(node.id)) {
        rememberSetupRangeInputDraft(node.id, node)
      }
    }, { capture: true })
    setupRoot.addEventListener('focusin', (event) => {
      const node = event.target
      if (!node?.id) {
        return
      }
      lockSetupInteraction(30_000)
      if (SETUP_EDIT_INPUT_IDS.has(node.id)) {
        rememberSetupRangeInputDraft(node.id, node)
      }
    }, { capture: true })
  }

  const runLiveScenario = async (button, scenarioKey, label) => {
    if (!selectedCard) {
      return
    }

    await loadKeystoreState()
    if (!state.keystore.status?.unlocked) {
      state.setupExecutionResult = {
        kind: 'error',
        error: 'Unlock the local keystore session before starting live execution'
      }
      renderPositionSetupPanel(getSelectedCardFromState())
      return
    }

    const executionSetup = buildExecutionReadySetup(selectedCard, state.positionSetup)
    const preview = window.PositionSetupShared.buildPositionSetupPreview({
      ...executionSetup,
      currentPrice: Number(executionSetup.anchorPrice || resolveSetupReferencePrice(selectedCard) || 0)
    })
    const modeSupport = buildUiPoolModeSupportReport(selectedCard, preview.mode)
    if (!modeSupport.ok) {
      showSetupModeWarning(modeSupport.message)
      return
    }
    const expectedPositions = Math.max(1, Number(preview.positions || 1))
    const totalProgressUnits = expectedPositions + (scenarioKey === 'micro_open_close' ? 1 : 0) + (scenarioKey === 'micro_open_close_autoswap' ? 2 : 0)

    button.disabled = true
    showActionOverlay({
      title: label,
      total: totalProgressUnits,
      current: 0,
      step: 'Preparing live micro-scenario',
      progressLabel: `0/${totalProgressUnits}`,
      message: 'Checking local keystore session, protected live limits, and pool runtime'
    })

    try {
      const payload = await postJson('/api/live-test-runner/start', {
        card: selectedCard,
        scenarioKey,
        setup: executionSetup,
        expectedPositions
      })
      applyLiveRunnerStatus(payload)
      const run = payload.targetRun || payload.activeRun
      if (!run?.runId) {
        throw new Error('Live runner did not return a run id')
      }
      startLiveRunnerPolling(run.runId, label)
    } catch (error) {
      state.setupExecutionResult = {
        kind: 'error',
        error: error.message
      }
      hideActionOverlay(0)
    } finally {
      button.disabled = false
      renderPositionSetupPanel(getSelectedCardFromState())
    }
  }

  for (const refreshPriceButton of document.querySelectorAll('#setup-refresh-price-inline')) {
    refreshPriceButton.addEventListener('click', async () => {
      refreshPriceButton.disabled = true
      try {
        stampMarketRefreshNow()
        renderUpdatedHeader()
        updateMarketAgeLabels()
        await refreshSelectedPoolPrice({ manual: true })
      } finally {
        setTimeout(() => {
          refreshPriceButton.disabled = false
        }, 300)
      }
    })
  }

  const liveScenarioOpenButton = document.getElementById('live-scenario-open-button')
  if (liveScenarioOpenButton && selectedCard) {
    liveScenarioOpenButton.addEventListener('click', async () => {
      await runLiveScenario(liveScenarioOpenButton, 'micro_open', 'Opening Live Position')
    })
  }


  const liveRunnerAbortButton = document.getElementById('live-runner-abort-button')
  if (liveRunnerAbortButton) {
    liveRunnerAbortButton.addEventListener('click', async () => {
      liveRunnerAbortButton.disabled = true
      try {
        const runId = state.liveRunner.targetRun?.runId || state.liveRunner.activeRun?.runId
        if (!runId) {
          return
        }
        const payload = await postJson('/api/live-test-runner/abort', { runId })
        applyLiveRunnerStatus(payload)
      } catch (error) {
        state.setupExecutionResult = {
          kind: 'error',
          error: error.message
        }
      } finally {
        liveRunnerAbortButton.disabled = false
        renderPositionSetupPanel(getSelectedCardFromState())
      }
    })
  }

  const liveRunnerResumeButton = document.getElementById('live-runner-resume-button')
  if (liveRunnerResumeButton) {
    liveRunnerResumeButton.addEventListener('click', async () => {
      liveRunnerResumeButton.disabled = true
      try {
        const runId = state.liveRunner.targetRun?.runId || state.liveRunner.activeRun?.runId
        if (!runId) {
          return
        }
        const payload = await postJson('/api/live-test-runner/resume', { runId })
        applyLiveRunnerStatus(payload)
        const run = payload.targetRun || payload.activeRun
        if (run?.runId) {
          startLiveRunnerPolling(run.runId, `Resuming ${run.scenarioLabel || 'Live Scenario'}`)
        }
      } catch (error) {
        state.setupExecutionResult = {
          kind: 'error',
          error: error.message
        }
      } finally {
        liveRunnerResumeButton.disabled = false
        renderPositionSetupPanel(getSelectedCardFromState())
      }
    })
  }

  for (const button of document.querySelectorAll('[data-setup-mode]')) {
    button.addEventListener('click', () => {
      state.positionSetup.mode = button.dataset.setupMode
      state.positionSetup.anchorLocked = false
      state.positionSetup.anchorPrice = Number(getPoolDisplayPrice(getSelectedCardFromState()) || state.positionSetup.anchorPrice || 0)
      state.setupExecutionResult = null
      renderPositionSetupPanel(getSelectedCardFromState())
    })
  }

  const bindings = [
    ['setup-deposit-token', 'depositToken', 'value'],
    ['setup-slippage', 'slippagePct', 'value'],
    ['setup-spot-side', 'spotSide', 'value']
  ]

  for (const [id, key, prop] of bindings) {
    const node = document.getElementById(id)
    if (!node) {
      continue
    }

    node.addEventListener('focus', () => lockSetupInteraction(30_000))
    node.addEventListener('click', () => lockSetupInteraction(30_000))
    node.addEventListener('blur', () => lockSetupInteraction(500))
    node.addEventListener('change', () => {
      lockSetupInteraction()
      if (prop === 'checked') {
        state.positionSetup[key] = node[prop]
      } else if (id === 'setup-slippage') {
        state.positionSetup[key] = parseLocaleNumber(node[prop], state.positionSetup[key])
      } else {
        state.positionSetup[key] = node[prop]
      }
      if (key !== 'spotSide') {
        state.positionSetup.anchorPrice = getExecutionAnchorPrice(getSelectedCardFromState())
      }
      state.setupExecutionResult = null
      renderPositionSetupPanel(getSelectedCardFromState())
    })
  }

  const capitalNode = document.getElementById('setup-capital-usd')
  if (capitalNode) {
    let capitalCommitTimer = null
    const commitCapital = ({ preserveFocus = document.activeElement === capitalNode, rerender = true } = {}) => {
      if (capitalCommitTimer) {
        clearTimeout(capitalCommitTimer)
        capitalCommitTimer = null
      }
      lockSetupInteraction()
      if (preserveFocus) {
        rememberSetupRangeInputDraft('setup-capital-usd', capitalNode)
      } else {
        clearSetupRangeInputDraft('setup-capital-usd')
      }
      const selectedCardForCapital = getSelectedCardFromState()
      const depositUsdPrice = inferUiDepositTokenUsdPrice(selectedCardForCapital, state.positionSetup.depositToken)
      const typedValue = parseLocaleNumber(capitalNode.value, state.positionSetup.capitalUsd)
      const nextCapitalUsd = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'USDE'].includes(getDepositTokenLabel(selectedCardForCapital, state.positionSetup.depositToken).toUpperCase())
        ? typedValue
        : typedValue * Math.max(depositUsdPrice, 0)
      state.positionSetup.capitalUsd = nextCapitalUsd
      state.positionSetup.anchorPrice = getExecutionAnchorPrice(selectedCardForCapital)
      state.setupExecutionResult = null
      if (rerender) {
        if (preserveFocus) {
          refreshSetupPreviewWhileEditing(getSelectedCardFromState())
          return
        }
        renderPositionSetupPanel(getSelectedCardFromState())
      }
    }
    const scheduleCapitalCommit = () => {
      if (capitalCommitTimer) {
        clearTimeout(capitalCommitTimer)
      }
      lockSetupInteraction(30_000)
      rememberSetupRangeInputDraft('setup-capital-usd', capitalNode)
      commitCapital({ preserveFocus: true, rerender: false })
      refreshSetupPreviewWhileEditing(getSelectedCardFromState())
      capitalCommitTimer = setTimeout(() => refreshSetupPreviewWhileEditing(getSelectedCardFromState()), 250)
    }
    capitalNode.addEventListener('focus', () => lockSetupInteraction(30_000))
    capitalNode.addEventListener('click', () => {
      lockSetupInteraction(30_000)
      rememberSetupRangeInputDraft('setup-capital-usd', capitalNode)
    })
    capitalNode.addEventListener('input', scheduleCapitalCommit)
    capitalNode.addEventListener('blur', () => {
      if (positionSetupRenderInProgress) {
        return
      }
      commitCapital({ preserveFocus: false, rerender: false })
      setTimeout(() => {
        if (!isEditingSetupRangeInputs()) {
          renderPositionSetupPanel(getSelectedCardFromState())
        }
      }, 0)
    })
    capitalNode.addEventListener('change', () => {
      commitCapital({ preserveFocus: document.activeElement === capitalNode })
    })
  }

  const currentPrice = Number(getPoolDisplayPrice(getSelectedCardFromState()) || 0)
  const minPctNode = document.getElementById('setup-min-pct')
  const maxPctNode = document.getElementById('setup-max-pct')
  const minPriceNode = document.getElementById('setup-min-price')
  const maxPriceNode = document.getElementById('setup-max-price')

  const commitAndRerender = (id, fn) => {
    const node = document.getElementById(id)
    if (!node) {
      return
    }
    let commitTimer = null

    const commit = ({ preserveFocus = document.activeElement === node, rerender = true } = {}) => {
      if (commitTimer) {
        clearTimeout(commitTimer)
        commitTimer = null
      }
      lockSetupInteraction()
      if (preserveFocus) {
        rememberSetupRangeInputDraft(id, node)
      } else {
        clearSetupRangeInputDraft(id)
      }
      fn(node)
      if (rerender) {
        if (preserveFocus) {
          refreshSetupPreviewWhileEditing(getSelectedCardFromState())
          return
        }
        renderPositionSetupPanel(getSelectedCardFromState())
      }
    }
    const scheduleCommit = () => {
      if (commitTimer) {
        clearTimeout(commitTimer)
      }
      lockSetupInteraction(30_000)
      rememberSetupRangeInputDraft(id, node)
      fn(node)
      refreshSetupPreviewWhileEditing(getSelectedCardFromState())
      commitTimer = setTimeout(() => refreshSetupPreviewWhileEditing(getSelectedCardFromState()), 250)
    }

    node.addEventListener('focus', () => {
      lockSetupInteraction(30_000)
      rememberSetupRangeInputDraft(id, node)
    })
    node.addEventListener('click', () => {
      lockSetupInteraction(30_000)
      rememberSetupRangeInputDraft(id, node)
    })
    node.addEventListener('input', scheduleCommit)
    node.addEventListener('blur', () => {
      if (positionSetupRenderInProgress) {
        return
      }
      commit({ preserveFocus: false, rerender: false })
      setTimeout(() => {
        if (!isEditingSetupRangeInputs()) {
          renderPositionSetupPanel(getSelectedCardFromState())
        }
      }, 0)
    })
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commit({ preserveFocus: true })
      }
    })
    node.addEventListener('change', () => {
      commit({ preserveFocus: document.activeElement === node })
    })
  }

  commitAndRerender('setup-min-pct', (node) => {
    const parsed = parseCompleteSetupNumber(node.value)
    state.positionSetup.minPct = node.value.trim() === '' ? '' : (parsed == null ? state.positionSetup.minPct : parsed)
    state.positionSetup.anchorLocked = false
    state.positionSetup.anchorPrice = getExecutionAnchorPrice(getSelectedCardFromState(), {
      ...state.positionSetup,
      anchorLocked: false
    })
    state.setupExecutionResult = null
  })

  commitAndRerender('setup-max-pct', (node) => {
    const parsed = parseCompleteSetupNumber(node.value)
    state.positionSetup.maxPct = node.value.trim() === '' ? '' : (parsed == null ? state.positionSetup.maxPct : parsed)
    state.positionSetup.anchorLocked = false
    state.positionSetup.anchorPrice = getExecutionAnchorPrice(getSelectedCardFromState(), {
      ...state.positionSetup,
      anchorLocked: false
    })
    state.setupExecutionResult = null
  })

  commitAndRerender('setup-min-price', (node) => {
    const parsed = parseCompleteSetupNumber(node.value)
    state.positionSetup.minPct = node.value.trim() === '' ? '' : (parsed == null ? state.positionSetup.minPct : window.PositionSetupShared.computePctFromPrice(currentPrice, parsed))
    state.positionSetup.anchorLocked = true
    state.positionSetup.anchorPrice = currentPrice > 0 ? currentPrice : state.positionSetup.anchorPrice
    state.setupExecutionResult = null
  })

  commitAndRerender('setup-max-price', (node) => {
    const parsed = parseCompleteSetupNumber(node.value)
    state.positionSetup.maxPct = node.value.trim() === '' ? '' : (parsed == null ? state.positionSetup.maxPct : window.PositionSetupShared.computePctFromPrice(currentPrice, parsed))
    state.positionSetup.anchorLocked = true
    state.positionSetup.anchorPrice = currentPrice > 0 ? currentPrice : state.positionSetup.anchorPrice
    state.setupExecutionResult = null
  })
}

async function copyToClipboard(text) {
  if (!text) {
    return false
  }

  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function normalizePoolTypeFilterValue(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized.includes('infinity')) return 'infinity'
  if (normalized.includes('v4')) return 'v4'
  if (normalized.includes('v3')) return 'v3'
  if (normalized.includes('v2')) return 'v2'
  return normalized || 'unknown'
}

function getSelectedPoolTypeFilters() {
  return [...document.querySelectorAll('[data-pool-type-filter]')]
    .filter((node) => node.checked)
    .map((node) => normalizePoolTypeFilterValue(node.dataset.poolTypeFilter))
    .filter(Boolean)
}

function getFilterState() {
  return {
    sortBy: document.getElementById('sort-select').value,
    feeTvlInterval: document.getElementById('fee-tvl-interval').value,
    dex: document.getElementById('dex-filter').value,
    poolTypes: getSelectedPoolTypeFilters(),
    quoteToken: document.getElementById('quote-token-filter').value,
    minMarketCapM: document.getElementById('min-market-cap').value,
    maxMarketCapM: document.getElementById('max-market-cap').value,
    minAgeHr: document.getElementById('min-age-hours').value,
    maxAgeHr: document.getElementById('max-age-hours').value,
    minLiquidityK: document.getElementById('min-liquidity').value,
    maxLiquidityK: document.getElementById('max-liquidity').value,
    min24hVolK: document.getElementById('min-volume-24h').value,
    max24hVolK: document.getElementById('max-volume-24h').value,
    min1hVolK: document.getElementById('min-volume-1h').value,
    max1hVolK: document.getElementById('max-volume-1h').value,
    minBaseFeePct: document.getElementById('min-base-fee').value,
    maxBaseFeePct: document.getElementById('max-base-fee').value,
    min24hFeesK: document.getElementById('min-fees-24h').value,
    max24hFeesK: document.getElementById('max-fees-24h').value
  }
}

function setFilterState(filters = {}) {
  const defaults = getDefaultFilterState()
  const next = {
    ...defaults,
    ...(filters || {})
  }
  const setValue = (id, value) => {
    const node = document.getElementById(id)
    if (node) {
      node.value = value == null ? '' : String(value)
    }
  }

  setValue('sort-select', next.sortBy)
  setValue('fee-tvl-interval', next.feeTvlInterval)
  setValue('dex-filter', next.dex)
  setValue('quote-token-filter', next.quoteToken)
  const selectedPoolTypes = Array.isArray(next.poolTypes)
    ? next.poolTypes.map(normalizePoolTypeFilterValue)
    : String(next.poolTypes || '').split(',').map(normalizePoolTypeFilterValue).filter(Boolean)
  for (const node of document.querySelectorAll('[data-pool-type-filter]')) {
    const type = normalizePoolTypeFilterValue(node.dataset.poolTypeFilter)
    node.checked = selectedPoolTypes.length === 0 || selectedPoolTypes.includes(type)
  }
  setValue('min-market-cap', next.minMarketCapM)
  setValue('max-market-cap', next.maxMarketCapM)
  setValue('min-age-hours', next.minAgeHr)
  setValue('max-age-hours', next.maxAgeHr)
  setValue('min-liquidity', next.minLiquidityK)
  setValue('max-liquidity', next.maxLiquidityK)
  setValue('min-volume-24h', next.min24hVolK)
  setValue('max-volume-24h', next.max24hVolK)
  setValue('min-volume-1h', next.min1hVolK)
  setValue('max-volume-1h', next.max1hVolK)
  setValue('min-base-fee', next.minBaseFeePct)
  setValue('max-base-fee', next.maxBaseFeePct)
  setValue('min-fees-24h', next.min24hFeesK)
  setValue('max-fees-24h', next.max24hFeesK)
}

function applyFilterPresetPreservingPoolTypes(filters = {}) {
  const currentPoolTypes = getSelectedPoolTypeFilters()
  setFilterState({
    ...filters,
    poolTypes: currentPoolTypes
  })
}

function getDefaultFilterState() {
  return {
    sortBy: 'feeTvl',
    feeTvlInterval: '4h',
    dex: 'all',
    poolTypes: ['v3', 'v4', 'v2', 'infinity'],
    quoteToken: 'all',
    minMarketCapM: '',
    maxMarketCapM: '',
    minAgeHr: '',
    maxAgeHr: '',
    minLiquidityK: '',
    maxLiquidityK: '',
    min24hVolK: '',
    max24hVolK: '',
    min1hVolK: '',
    max1hVolK: '',
    minBaseFeePct: '',
    maxBaseFeePct: '',
    min24hFeesK: '',
    max24hFeesK: ''
  }
}

function normalizeFilterComparableValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizePoolTypeFilterValue).sort().join(',')
  }
  return String(value == null ? '' : value).trim().toLowerCase()
}

function isDefaultFilterState(filters = getFilterState()) {
  const defaults = getDefaultFilterState()
  return Object.keys(defaults).every((key) => {
    if (typeof defaults[key] === 'boolean') {
      return Boolean(filters[key]) === defaults[key]
    }
    return normalizeFilterComparableValue(filters[key]) === normalizeFilterComparableValue(defaults[key])
  })
}

function normalizeFilterPreset(rawPreset, index = 0) {
  if (!rawPreset || typeof rawPreset !== 'object') {
    return null
  }

  const filters = {
    ...getDefaultFilterState(),
    ...(rawPreset.filters && typeof rawPreset.filters === 'object' ? rawPreset.filters : {})
  }
  const name = String(rawPreset.name || `Preset ${index + 1}`).trim().slice(0, 28)
  return {
    id: String(rawPreset.id || `${Date.now()}-${index}`),
    name: name || `Preset ${index + 1}`,
    filters
  }
}

function loadFilterPresetsFromLocalStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_PRESETS_STORAGE_KEY) || '[]')
    state.filterPresets = Array.isArray(parsed)
      ? parsed.map((preset, index) => normalizeFilterPreset(preset, index)).filter(Boolean).slice(0, FILTER_PRESET_LIMIT)
      : []
  } catch (_) {
    state.filterPresets = []
  }
}

async function loadFilterPresets() {
  try {
    const payload = await fetchJson('/api/filter-presets')
    state.filterPresets = Array.isArray(payload.filterPresets)
      ? payload.filterPresets.map((preset, index) => normalizeFilterPreset(preset, index)).filter(Boolean).slice(0, FILTER_PRESET_LIMIT)
      : []
    if (state.filterPresets.length > 0) {
      localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, JSON.stringify(state.filterPresets.slice(0, FILTER_PRESET_LIMIT)))
    }
  } catch (_) {
    loadFilterPresetsFromLocalStorage()
  }
}

function persistFilterPresets() {
  try {
    localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, JSON.stringify(state.filterPresets.slice(0, FILTER_PRESET_LIMIT)))
    postJson('/api/filter-presets', { filterPresets: state.filterPresets.slice(0, FILTER_PRESET_LIMIT) }).catch(() => {
      setText('filter-preset-feedback', 'Preset saved locally. Server sync failed.')
    })
  } catch (_) {
    setText('filter-preset-feedback', 'Preset storage unavailable.')
  }
}

function renderFilterPresets() {
  const list = document.getElementById('filter-preset-list')
  if (!list) {
    return
  }

  list.replaceChildren()
  for (const preset of state.filterPresets) {
    const item = document.createElement('div')
    item.className = 'filter-preset-item'

    const applyButton = document.createElement('button')
    applyButton.type = 'button'
    applyButton.className = 'filter-preset-apply'
    applyButton.textContent = preset.name
    applyButton.title = preset.name
    applyButton.addEventListener('click', () => {
      applyFilterPresetPreservingPoolTypes(preset.filters)
      setText('filter-preset-feedback', `Applied ${preset.name}.`)
      scheduleRerenderSearchResult({ immediate: true })
    })

    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.className = 'filter-preset-delete'
    deleteButton.textContent = 'x'
    deleteButton.title = `Delete ${preset.name}`
    deleteButton.setAttribute('aria-label', `Delete ${preset.name}`)
    deleteButton.addEventListener('click', () => {
      state.filterPresets = state.filterPresets.filter((item) => item.id !== preset.id)
      persistFilterPresets()
      renderFilterPresets()
      setText('filter-preset-feedback', `Deleted ${preset.name}.`)
    })

    item.append(applyButton, deleteButton)
    list.appendChild(item)
  }

  const saveButton = document.getElementById('save-filter-preset-button')
  if (saveButton) {
    saveButton.disabled = state.filterPresets.length >= FILTER_PRESET_LIMIT
      && !state.filterPresets.some((preset) => preset.name.toLowerCase() === getPendingFilterPresetName().toLowerCase())
  }
}

function getPendingFilterPresetName() {
  const node = document.getElementById('filter-preset-name')
  const raw = String(node?.value || '').trim()
  return raw.slice(0, 28) || `Preset ${Math.min(state.filterPresets.length + 1, FILTER_PRESET_LIMIT)}`
}

function saveCurrentFilterPreset() {
  const name = getPendingFilterPresetName()
  const existingIndex = state.filterPresets.findIndex((preset) => preset.name.toLowerCase() === name.toLowerCase())
  const nextPreset = {
    id: existingIndex >= 0 ? state.filterPresets[existingIndex].id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    filters: getFilterState()
  }

  if (existingIndex >= 0) {
    state.filterPresets.splice(existingIndex, 1, nextPreset)
  } else {
    if (state.filterPresets.length >= FILTER_PRESET_LIMIT) {
      setText('filter-preset-feedback', `Limit ${FILTER_PRESET_LIMIT} presets.`)
      renderFilterPresets()
      return
    }
    state.filterPresets.push(nextPreset)
  }

  persistFilterPresets()
  renderFilterPresets()
  const nameNode = document.getElementById('filter-preset-name')
  if (nameNode) {
    nameNode.value = ''
  }
  setText('filter-preset-feedback', `Saved ${name}.`)
}

function resetFilters() {
  setFilterState(getDefaultFilterState())
  setText('filter-preset-feedback', '')
  rerenderSearchResult()
}

function inRange(value, minRaw, maxRaw, multiplier = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return false
  }

  if (minRaw !== '' && minRaw != null && numeric < Number(minRaw) * multiplier) {
    return false
  }

  if (maxRaw !== '' && maxRaw != null && numeric > Number(maxRaw) * multiplier) {
    return false
  }

  return true
}

function inRangeOrUnknown(value, minRaw, maxRaw, multiplier = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return true
  }

  return inRange(value, minRaw, maxRaw, multiplier)
}

function getFilteredCards(viewModel) {
  const filters = getFilterState()
  const decisionScore = { ok: 0, warn: 1, block: 2, unknown: 3 }
  const isMarketFeed = viewModel?.queryType === 'market'
  const cards = [...(viewModel.cards || [])]
    .filter((card) => filters.dex === 'all' || card.dex === filters.dex)
    .filter((card) => filters.poolTypes.length === 0 || filters.poolTypes.includes(normalizePoolTypeFilterValue(card.poolTypeLabel || getUiPoolTypeLabel(card))))
    .filter((card) => filters.quoteToken === 'all'
      || (filters.quoteToken === 'bnb' && ['bnb', 'wbnb'].includes(String(card.quoteTokenSymbol || '').toLowerCase()))
      || (filters.quoteToken === 'usdt' && String(card.quoteTokenSymbol || '').toLowerCase() === 'usdt')
      || (filters.quoteToken === 'usdc' && String(card.quoteTokenSymbol || '').toLowerCase() === 'usdc'))
    .filter((card) => inRangeOrUnknown(card.marketCapUsd, filters.minMarketCapM, filters.maxMarketCapM, 1_000_000))
    .filter((card) => inRangeOrUnknown(card.ageHours, filters.minAgeHr, filters.maxAgeHr, 1))
    .filter((card) => inRange(card.liquidityUsd, filters.minLiquidityK, filters.maxLiquidityK, 1_000))
    .filter((card) => inRange(card.volume24hUsd, filters.min24hVolK, filters.max24hVolK, 1_000))
    .filter((card) => inRange(card.volume1hUsd, filters.min1hVolK, filters.max1hVolK, 1_000))
    .filter((card) => inRange(card.baseFeePct, filters.minBaseFeePct, filters.maxBaseFeePct, 1))
    .filter((card) => inRange(card.fees24hUsd, filters.min24hFeesK, filters.max24hFeesK, 1_000))
    .filter((card) => !isMarketFeed || Number(card.liquidityUsd || 0) > 0)
    .filter((card) => !isMarketFeed || Number(card.volume1hUsd || 0) >= 0)

  return cards.sort((left, right) => {
    if (isMarketFeed && filters.sortBy === 'feeTvl') {
      const liveSignalDelta = getMarketLiveSignalScore(right, filters.feeTvlInterval) - getMarketLiveSignalScore(left, filters.feeTvlInterval)
      if (liveSignalDelta !== 0) {
        return liveSignalDelta
      }
    }

    if (isMarketFeed && filters.sortBy !== 'feeTvl') {
      const completenessDelta = getCardCompletenessScore(right) - getCardCompletenessScore(left)
      if (completenessDelta !== 0) {
        return completenessDelta
      }
    }

    if (filters.sortBy === 'marketCap') {
      return Number(right.marketCapUsd || 0) - Number(left.marketCapUsd || 0)
    }

    if (filters.sortBy === 'liquidity') {
      return Number(right.liquidityUsd || 0) - Number(left.liquidityUsd || 0)
    }

    if (filters.sortBy === 'volume') {
      return Number(right.volume24hUsd || 0) - Number(left.volume24hUsd || 0)
    }

    if (filters.sortBy === 'age') {
      return Number(left.ageHours || 0) - Number(right.ageHours || 0)
    }

    if (filters.sortBy === 'decision') {
      return (decisionScore[left.decision] ?? 99) - (decisionScore[right.decision] ?? 99)
    }

    return Number(getRealFeeTvlPct(right, filters.feeTvlInterval) ?? -Infinity)
      - Number(getRealFeeTvlPct(left, filters.feeTvlInterval) ?? -Infinity)
  })
}

function appendMetricRows(root, rows) {
  for (const [label, value] of rows) {
    const row = document.createElement('div')
    row.className = 'metric-row'
    row.innerHTML = `<span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span>`
    root.appendChild(row)
  }
}

function buildRatioRows(root, entries) {
  for (const [label, left, right] of entries) {
    const row = document.createElement('div')
    row.className = 'ratio-row'
    row.innerHTML = `<span class="time">${escapeHtml(label)}</span><strong>${escapeHtml(left)}</strong><span class="${String(right).includes('fees') ? 'fees' : ''}">${escapeHtml(right)}</span>`
    root.appendChild(row)
  }
}

function getSignalDescriptor(index, total) {
  if (total <= 1 || index === 0) {
    return { signalClass: 'best', signalLabel: 'Best fee/tvl' }
  }

  const ratio = index / Math.max(total - 1, 1)

  if (ratio <= 0.25) {
    return { signalClass: 'good', signalLabel: 'Strong fee/tvl' }
  }

  if (ratio <= 0.6) {
    return { signalClass: 'mid', signalLabel: 'Medium fee/tvl' }
  }

  if (ratio <= 0.85) {
    return { signalClass: 'bad', signalLabel: 'Weak fee/tvl' }
  }

  return { signalClass: 'worst', signalLabel: 'Worst fee/tvl' }
}

function safeExternalUrl(value, allowedHosts = []) {
  try {
    const url = new URL(String(value || '').trim())
    if (url.protocol !== 'https:') return ''
    const host = url.hostname.toLowerCase()
    return allowedHosts.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`))
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

function buildSwapUrl(card) {
  if (!card?.pairAddress) {
    return '#'
  }

  if (card.dex === 'pancakeswap') {
    return `https://pancakeswap.finance/liquidity/pool/bsc/${encodeURIComponent(card.pairAddress)}`
  }

  if (card.dex === 'uniswap') {
    return `https://app.uniswap.org/explore/pools/bnb/${encodeURIComponent(card.pairAddress)}`
  }

  if (card.dex === 'thena') {
    return safeExternalUrl(card.dexUrl, ['thena.fi']) || `https://app.thena.fi/liquidity/pool/${encodeURIComponent(card.pairAddress)}`
  }

  if (card.dex === 'sushiswap') {
    return safeExternalUrl(card.dexUrl, ['sushi.com']) || `https://www.sushi.com/bnb/pool/${encodeURIComponent(card.pairAddress)}`
  }

  return safeExternalUrl(card.dexUrl, ['pancakeswap.finance', 'uniswap.org', 'thena.fi', 'sushi.com']) || '#'
}

function buildDexScreenerUrl(card) {
  const explicit = safeExternalUrl(card?.dexUrl, ['dexscreener.com'])
  if (explicit) {
    return explicit
  }

  if (!card?.pairAddress) {
    return '#'
  }

  return `https://dexscreener.com/bsc/${encodeURIComponent(card.pairAddress)}`
}

function buildDefinedPoolUrl(card) {
  if (!card?.pairAddress) {
    return '#'
  }

  return `https://www.defined.fi/bsc/${encodeURIComponent(card.pairAddress)}`
}

function closeLinkContextMenu() {
  const menu = document.getElementById('link-context-menu')
  if (!menu) return
  menu.hidden = true
  menu.dataset.copyUrl = ''
}

function openLinkContextMenu(event, url) {
  const menu = document.getElementById('link-context-menu')
  if (!menu || !url || url === '#') return
  event.preventDefault()
  event.stopPropagation()
  menu.dataset.copyUrl = url
  menu.hidden = false
  const viewportPadding = 10
  const rect = menu.getBoundingClientRect()
  const left = Math.min(event.clientX, Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding))
  const top = Math.min(event.clientY, Math.max(viewportPadding, window.innerHeight - rect.height - viewportPadding))
  menu.style.left = `${Math.max(viewportPadding, left)}px`
  menu.style.top = `${Math.max(viewportPadding, top)}px`
}

function bindPoolLinkContextMenu(link, url) {
  if (!link) return
  link.setAttribute('data-copy-url', url || '')
  link.addEventListener('contextmenu', (event) => {
    openLinkContextMenu(event, link.dataset.copyUrl)
  })
}

function getSwapLinkMeta(card) {
  if (card.dex === 'pancakeswap') {
    return { text: 'pancake', className: 'pancakeswap', ariaLabel: 'Open pool on PancakeSwap' }
  }

  if (card.dex === 'uniswap') {
    return { text: 'uni', className: 'uniswap', ariaLabel: 'Open pool on Uniswap' }
  }

  if (card.dex === 'thena') {
    return { text: 'thena', className: 'thena', ariaLabel: 'Open pool on Thena' }
  }

  if (card.dex === 'sushiswap') {
    return { text: 'sushi', className: 'sushiswap', ariaLabel: 'Open pool on SushiSwap' }
  }

  return { text: 'pool', className: 'dex-generic', ariaLabel: 'Open pool page' }
}

function renderPoolCards(viewModel) {
  const grid = document.getElementById('pool-grid')
  const template = document.getElementById('pool-card-template')
  const allCards = Array.isArray(viewModel?.cards) ? viewModel.cards : []
  const filters = getFilterState()
  let cards = getFilteredCards(viewModel)
  if (!cards.length && allCards.length && isDefaultFilterState(filters)) {
    // A stale browser state or partially upgraded UI must not hide a healthy backend market feed.
    cards = [...allCards]
  }
  const renderSeq = ++poolCardRenderSequence
  grid.replaceChildren()
  setText('results-header', `${cards.length} visible cards | ${(viewModel.cards || []).length} total found | sorted by ${filters.sortBy === 'feeTvl' ? `${filters.feeTvlInterval} fee/tvl` : filters.sortBy}`)

  const appendCardChunk = (startIndex = 0) => {
    if (renderSeq !== poolCardRenderSequence) {
      return
    }

    const fragmentRoot = document.createDocumentFragment()
    const endIndex = Math.min(cards.length, startIndex + SEARCH_RENDER_CHUNK_SIZE)

    for (let index = startIndex; index < endIndex; index += 1) {
    const card = cards[index]
    const signalInfo = getSignalDescriptor(index, cards.length)
    const fragment = template.content.cloneNode(true)
    const article = fragment.querySelector('.pool-card')
    article.dataset.poolId = card.id
    if (state.selectedPoolId === card.id) {
      article.classList.add('selected')
    }

    fragment.querySelector('.token-pair').textContent = `${card.tokenSymbol}/${card.quoteTokenSymbol || 'QUOTE'}`
    fragment.querySelector('.quote-chip').textContent = card.quoteChip || `${(card.dexLabel || card.dex).toUpperCase()} #${index + 1}`
    fragment.querySelector('.pool-name').textContent = `Fee Tier | ${card.feeTierLabel}`
    fragment.querySelector('.subline').textContent = `${signalInfo.signalLabel} | ${getUiPoolTypeLabel(card)}`
    fragment.querySelector('.active-fee-tvl').textContent = formatIntervalPct(card.feeTvl?.[filters.feeTvlInterval])
    fragment.querySelector('.active-fee-label').textContent = `${filters.feeTvlInterval.toUpperCase()} fee/tvl`

    const signal = fragment.querySelector('.pool-signal')
    signal.classList.add(signalInfo.signalClass)

    const primaryMetrics = fragment.querySelector('.primary-metrics')
    appendMetricRows(primaryMetrics, [
      ['Pool Type', card.poolTypeLabel || getUiPoolTypeLabel(card)],
      ['MCAP', Number(card.marketCapUsd || 0) > 0 ? (card.marketCapLabel || formatUsd(card.marketCapUsd)) : 'n/a'],
      ['Age', formatAge(card.ageHours)],
      ['Base Fee', card.feeTierLabel || formatPct(card.baseFeePct)],
      ['Liquidity', formatUsd(card.liquidityUsd)],
      ['Volume (1H)', formatUsd(card.volume1hUsd)],
      ['Fees (1H)', formatUsdNullable(card.fees1hUsd)],
      ['Price', formatPrice(getPoolDisplayPrice(card))]
    ])

    const feeTable = fragment.querySelector('.fee-tvl-table')
    buildRatioRows(feeTable, [
      ['24H', formatIntervalPct(card.feeTvl?.['24h']), formatIntervalFees(card.feeTvl?.['24h'])],
      ['12H', formatIntervalPct(card.feeTvl?.['12h']), formatIntervalFees(card.feeTvl?.['12h'])],
      ['6H', formatIntervalPct(card.feeTvl?.['6h']), formatIntervalFees(card.feeTvl?.['6h'])],
      ['4H', formatIntervalPct(card.feeTvl?.['4h']), formatIntervalFees(card.feeTvl?.['4h'])],
      ['2H', formatIntervalPct(card.feeTvl?.['2h']), formatIntervalFees(card.feeTvl?.['2h'])],
      ['1H', formatIntervalPct(card.feeTvl?.['1h']), formatIntervalFees(card.feeTvl?.['1h'])]
    ])

    const volumeTable = fragment.querySelector('.total-volume-table')
    buildRatioRows(volumeTable, [
      ['24H', formatIntervalVolume(card.feeTvl?.['24h'], card.totalVolume?.h24), ''],
      ['12H', formatIntervalVolume(card.feeTvl?.['12h'], card.totalVolume?.h12), ''],
      ['6H', formatIntervalVolume(card.feeTvl?.['6h'], card.totalVolume?.h6), ''],
      ['4H', formatIntervalVolume(card.feeTvl?.['4h'], card.totalVolume?.h4), ''],
      ['2H', formatIntervalVolume(card.feeTvl?.['2h'], card.totalVolume?.h2), ''],
      ['1H', formatIntervalVolume(card.feeTvl?.['1h'], card.totalVolume?.h1), '']
    ])

    fragment.querySelector('.pool-ca').textContent = card.tokenAddress || card.id

    const dexLink = fragment.querySelector('.dex-link')
    const dexUrl = buildDexScreenerUrl(card)
    dexLink.href = dexUrl
    dexLink.textContent = 'dex'
    bindPoolLinkContextMenu(dexLink, dexUrl)
    const definedLink = fragment.querySelector('.defined-link')
    if (definedLink) {
      const definedUrl = buildDefinedPoolUrl(card)
      definedLink.href = definedUrl
      definedLink.textContent = 'def'
      definedLink.setAttribute('aria-label', 'Open pool on Defined')
      bindPoolLinkContextMenu(definedLink, definedUrl)
    }
    const swapLink = fragment.querySelector('.swap-link')
    const swapMeta = getSwapLinkMeta(card)
    const swapUrl = buildSwapUrl(card)
    swapLink.classList.add(swapMeta.className)
    swapLink.href = swapUrl
    swapLink.textContent = swapMeta.text
    swapLink.setAttribute('aria-label', swapMeta.ariaLabel)
    bindPoolLinkContextMenu(swapLink, swapUrl)

    const copyButton = fragment.querySelector('.copy-ca-button')
    copyButton.addEventListener('click', async (event) => {
      event.stopPropagation()
      const copied = await copyToClipboard(card.tokenAddress || card.id)
      if (copied) {
        copyButton.classList.add('copied')
        setTimeout(() => copyButton.classList.remove('copied'), 1200)
      }
    })

    article.addEventListener('click', (event) => {
      if (event.target.closest('a,button')) {
        return
      }
      if (window.getSelection && String(window.getSelection()).trim()) {
        return
        }
        state.selectedPoolId = card.id
        state.selectedPoolKey = buildPoolSelectionKey(card)
        state.selectedPoolCard = card
        state.positionSetup.anchorLocked = false
        state.positionSetup.anchorPrice = Number(getPoolDisplayPrice(card) || state.positionSetup.anchorPrice || 0)
        state.setupExecutionResult = null
      renderSelectedPoolPanel({ ...card, ...signalInfo }, filters.feeTvlInterval)
      renderPoolCards(viewModel)
    })
    article.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          state.selectedPoolId = card.id
          state.selectedPoolKey = buildPoolSelectionKey(card)
          state.selectedPoolCard = card
          state.positionSetup.anchorLocked = false
          state.positionSetup.anchorPrice = Number(getPoolDisplayPrice(card) || state.positionSetup.anchorPrice || 0)
          state.setupExecutionResult = null
        renderSelectedPoolPanel({ ...card, ...signalInfo }, filters.feeTvlInterval)
        renderPoolCards(viewModel)
      }
    })
    fragmentRoot.appendChild(fragment)
  }

    if (fragmentRoot.childNodes.length) {
      grid.appendChild(fragmentRoot)
    }

    if (endIndex < cards.length) {
      requestAnimationFrame(() => appendCardChunk(endIndex))
    }
  }

  if (!cards.length) {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = '<span>Pool Search</span><strong>No cards match the active filters</strong>'
    grid.appendChild(row)
  } else {
    appendCardChunk(0)
  }

  const selectedCard = chooseRicherPoolCard(
    resolvePreservedSelectedPoolCard(cards, allCards, state.selectedPoolKey, state.selectedPoolId, state.selectedPoolCard),
    state.selectedPoolCard
  )
  state.selectedPoolId = selectedCard?.id || null
  state.selectedPoolKey = selectedCard ? buildPoolSelectionKey(selectedCard) : null
  state.selectedPoolCard = selectedCard || state.selectedPoolCard || null
  const signalIndex = cards.findIndex((card) => card.id === selectedCard?.id)
  const selectedSignal = selectedCard
    ? getSignalDescriptor(signalIndex >= 0 ? signalIndex : 0, Math.max(cards.length, 1))
    : null
  renderSelectedPoolPanel(selectedCard && selectedSignal ? { ...selectedCard, ...selectedSignal } : selectedCard, filters.feeTvlInterval)
  renderPositionSetupPanel(selectedCard && selectedSignal ? { ...selectedCard, ...selectedSignal } : selectedCard)
}

function stabilizeOpenCardWithPrevious(card, previousCard) {
  if (!card || !previousCard) {
    return card
  }
  const currentKnown = hasKnownManageValuation(card)
  const previousKnown = hasKnownManageValuation(previousCard)
  if (currentKnown || !previousKnown) {
    return card
  }

  return {
    ...card,
    currentValueQuote: previousCard.currentValueQuote,
    unrealizedPnlQuote: previousCard.unrealizedPnlQuote,
    unrealizedPnlPct: previousCard.unrealizedPnlPct,
    accruedFeesQuote: Number.isFinite(Number(card.accruedFeesQuote))
      ? card.accruedFeesQuote
      : previousCard.accruedFeesQuote,
    claimedFeesQuote: Number.isFinite(Number(card.claimedFeesQuote))
      ? card.claimedFeesQuote
      : previousCard.claimedFeesQuote,
    hasKnownValuation: true,
    hasKnownUnrealizedPnl: previousCard.hasKnownUnrealizedPnl,
    valuationStatus: 'stale_previous',
    staleValuation: true
  }
}

function stabilizeSnapshotOpenCards(snapshot) {
  const previousCards = state.lastSnapshot?.dashboard?.positions?.openCards || []
  const nextCards = snapshot?.dashboard?.positions?.openCards || []
  if (!previousCards.length || !nextCards.length) {
    return snapshot
  }

  const previousById = new Map(previousCards.map((card) => [String(card.positionId || card.tokenId || ''), card]))
  const stabilizedCards = nextCards.map((card) => stabilizeOpenCardWithPrevious(card, previousById.get(String(card.positionId || card.tokenId || ''))))
  return {
    ...snapshot,
    dashboard: {
      ...snapshot.dashboard,
      positions: {
        ...snapshot.dashboard.positions,
        openCards: stabilizedCards
      }
    }
  }
}

function applySnapshotToUi(snapshot) {
  snapshot = stabilizeSnapshotOpenCards(snapshot)
  stampMarketRefreshNow()
  renderUpdatedHeader()
  pulseHeaderPriceCards()
  state.lastSnapshot = snapshot
  syncHeaderContextForView(snapshot)
  renderWalletSummary(snapshot.dashboard.walletSummary)
  renderClosedPnlSummary(snapshot.dashboard.closedSummary)
  renderOperatorActions(snapshot.dashboard.actions, snapshot)
  const openCards = snapshot.dashboard.positions.openCards || []
  const closedCards = snapshot.dashboard.positions.closedCards || []
  renderPositions(openCards)
  renderClosedPositions(closedCards)
  renderManageSummary(openCards, closedCards)
  renderManageOpenTable(openCards)
  renderManageClosedGroups(closedCards)
  renderActivity(snapshot.dashboard.execution)
}

async function loadSnapshot(options = null) {
  const force = options === true || options?.force === true
  const refreshOpenPositions = options?.refreshOpenPositions === true

  if (snapshotRefreshInFlight) {
    snapshotRefreshQueued = true
    snapshotRefreshQueuedForce = snapshotRefreshQueuedForce || Boolean(force)
    snapshotRefreshQueuedRefreshOpen = snapshotRefreshQueuedRefreshOpen || Boolean(refreshOpenPositions)
    return
  }

  snapshotRefreshInFlight = true
  try {
    const snapshotQuery = force
      ? '?force=1'
      : (refreshOpenPositions ? MANAGE_OPEN_REFRESH_QUERY : '')
    const snapshot = await fetchJson(`/api/operator-snapshot${snapshotQuery}`)
    applySnapshotToUi(snapshot)
  } finally {
    snapshotRefreshInFlight = false
    if (snapshotRefreshQueued) {
      const queuedForce = snapshotRefreshQueuedForce
      const queuedRefreshOpen = snapshotRefreshQueuedRefreshOpen
      snapshotRefreshQueued = false
      snapshotRefreshQueuedForce = false
      snapshotRefreshQueuedRefreshOpen = false
      void loadSnapshot({ force: queuedForce, refreshOpenPositions: queuedRefreshOpen }).catch(() => {
        // Keep the last good operator snapshot if the queued refresh fails.
      })
    }
  }
}

async function loadForkStatus() {
  try {
    const status = await fetchJson('/api/fork-status')
    state.forkStatus = status
  } catch (error) {
    state.forkStatus = {
      ready: false,
      mode: 'unknown',
      error: error.message
    }
  }

  renderForkStatus()
}

function clearPartialMarketRefresh() {
  if (poolSearchPartialRefreshTimer) {
    clearTimeout(poolSearchPartialRefreshTimer)
    poolSearchPartialRefreshTimer = null
  }
}

function isPartialBroadMarketResult(result) {
  return !String(state.lastQuery || '').trim() && (
    result?.summary?.krystalPartial === true
    || /still streaming|partial/i.test(String(result?.summary?.sourceWarning || ''))
    || hasIncompleteBroadMarketTop(result)
  )
}

function hasIncompleteBroadMarketTop(result) {
  const topCards = (Array.isArray(result?.cards) ? result.cards : []).slice(0, 24)
  if (!topCards.length) {
    return false
  }
  const incomplete = topCards.filter((card) => (
    Number(card?.marketCapUsd || 0) <= 0
    || Number(getPoolDisplayPrice(card) || 0) <= 0
    || Number(card?.ageHours || 0) <= 0
  )).length

  return incomplete / topCards.length > 0.1
}

function formatPoolSearchMeta(result, verb = 'Resolved') {
  const tokenSymbol = result?.token?.symbol || 'query'
  const queryType = result?.queryType || 'unknown'
  const cardCount = Array.isArray(result?.cards) ? result.cards.length : 0
  const base = `${verb} ${tokenSymbol} via ${queryType} search. ${cardCount} cards loaded.`
  if (!isPartialBroadMarketResult(result)) {
    return base
  }

  return `${base} Market data is still loading; refreshing automatically.`
}

function schedulePartialMarketRefresh(result) {
  if (!isPartialBroadMarketResult(result) || document.hidden || state.activeView !== 'pool-search') {
    clearPartialMarketRefresh()
    poolSearchPartialRefreshAttempts = 0
    return
  }

  if (poolSearchPartialRefreshAttempts >= PARTIAL_MARKET_AUTO_REFRESH_MAX_ATTEMPTS) {
    clearPartialMarketRefresh()
    return
  }

  clearPartialMarketRefresh()
  const scheduledQuery = state.lastQuery || ''
  poolSearchPartialRefreshAttempts += 1
  poolSearchPartialRefreshTimer = setTimeout(() => {
    poolSearchPartialRefreshTimer = null
    if (document.hidden || state.activeView !== 'pool-search' || String(state.lastQuery || '') !== scheduledQuery) {
      return
    }
    refreshCurrentSearchResult({ force: true, partialAuto: true }).catch(() => {})
  }, PARTIAL_MARKET_AUTO_REFRESH_DELAY_MS)
}

async function searchPools() {
  const query = document.getElementById('pool-query').value.trim()
  clearPartialMarketRefresh()
  poolSearchPartialRefreshAttempts = 0
  const searchSeq = ++poolSearchRequestSequence
  poolSearchInFlight = true
  state.lastQuery = query
  state.manageExpandedGroups.clear()
  setText('search-meta', 'Searching pools and market data...')

  try {
    const result = await fetchJson(`/api/search-pools?q=${encodeURIComponent(query)}`, { timeoutMs: SEARCH_POOLS_TIMEOUT_MS })
    if (searchSeq !== poolSearchRequestSequence) {
      return
    }
    const pendingSelectedPoolId = state.selectedPoolId
    const pendingSelectedPoolKey = state.selectedPoolKey
    const pendingSelectedPoolCard = state.selectedPoolCard
    const preservedCard = resolvePreservedSelectedPoolCard(result.cards || [], result.cards || [], pendingSelectedPoolKey, pendingSelectedPoolId, pendingSelectedPoolCard)
    state.searchResult = result
    state.selectedPoolId = preservedCard?.id || null
    state.selectedPoolKey = preservedCard ? buildPoolSelectionKey(preservedCard) : null
    state.selectedPoolCard = preservedCard
    state.positionSetup.anchorLocked = false
    state.positionSetup.anchorPrice = preservedCard ? Number(getPoolDisplayPrice(preservedCard) || 0) : 0
    state.marketUpdatedAt = result.generatedAt || new Date().toISOString()
    state.marketDisplayUpdatedAt = state.marketUpdatedAt
    state.setupExecutionResult = null
    setText('search-meta', formatPoolSearchMeta(result, 'Resolved'))
    renderUpdatedHeader()
    renderPoolCards(result)
    scheduleSearchViewportHydration({ delayMs: 120, burst: [900, 2200] })
    schedulePartialMarketRefresh(result)
  } catch (error) {
    if (searchSeq !== poolSearchRequestSequence) {
      return
    }
      state.searchResult = null
      state.selectedPoolId = null
      state.selectedPoolKey = null
      state.selectedPoolCard = null
      state.positionSetup.anchorLocked = false
      state.marketUpdatedAt = null
    state.marketDisplayUpdatedAt = null
    setText('search-meta', error.message)
    renderUpdatedHeader()
    renderPoolCards({ cards: [], token: null })
    renderPositionSetupPanel(null)
  } finally {
    if (searchSeq === poolSearchRequestSequence) {
      poolSearchInFlight = false
    }
  }
}

async function refreshCurrentSearchResult(options = {}) {
  const manual = options.manual === true
  const force = options.force === true
  const partialAuto = options.partialAuto === true

  if (!state.searchResult && manual) {
    await searchPools()
    return
  }

  if (!state.searchResult || searchRefreshInFlight || poolSearchInFlight || document.hidden || state.activeView !== 'pool-search') {
    return
  }

  if (!force && !String(state.lastQuery || '').trim() && state.selectedPoolCard) {
    return
  }

  searchRefreshInFlight = true
  const refreshSeq = poolSearchRequestSequence
  if (manual) {
    setText('search-meta', 'Refreshing Pool Search...')
  }
  try {
    const previousSelectedPoolId = state.selectedPoolId
    const previousSelectedPoolKey = state.selectedPoolKey
    const previousSelectedPoolCard = state.selectedPoolCard
    const result = await fetchJson(`/api/search-pools?q=${encodeURIComponent(state.lastQuery || '')}${force ? `&_=${Date.now()}` : ''}`, { timeoutMs: SEARCH_POOLS_TIMEOUT_MS })
    if (refreshSeq !== poolSearchRequestSequence || state.activeView !== 'pool-search') {
      return
    }
    state.searchResult = result
    const preservedCard = resolvePreservedSelectedPoolCard(result.cards || [], result.cards || [], previousSelectedPoolKey, previousSelectedPoolId, previousSelectedPoolCard)
    const nextSelectedCard = chooseRicherPoolCard(preservedCard, previousSelectedPoolCard) || state.selectedPoolCard || null
    state.selectedPoolCard = nextSelectedCard
    state.selectedPoolId = nextSelectedCard?.id || null
    state.selectedPoolKey = nextSelectedCard ? buildPoolSelectionKey(nextSelectedCard) : null
    state.marketUpdatedAt = result.generatedAt || new Date().toISOString()
    state.marketDisplayUpdatedAt = state.marketUpdatedAt
    if (manual || partialAuto) {
      setText('search-meta', formatPoolSearchMeta(result, 'Refreshed'))
    }
    renderUpdatedHeader()
    schedulePartialMarketRefresh(result)
    if (isInteractingWithSetupControls() || hasActiveTextSelection()) {
      return
    }
    if (!hasActiveTextSelection()) {
      renderPoolCards(result)
      scheduleSearchViewportHydration({ delayMs: 180, burst: [1200] })
    }
  } catch (error) {
    if (manual) {
      setText('search-meta', `Pool Search refresh failed: ${error.message}`)
    }
    // Keep the last good state if background refresh fails.
  } finally {
    searchRefreshInFlight = false
  }
}

async function refreshSelectedPoolPrice(options = {}) {
  const manual = options.manual === true
  const background = options.background === true
  if (selectedPriceRefreshInFlight) {
    if (manual) {
      selectedPriceManualRefreshQueued = true
    }
    return
  }

  const selectedCard = getSelectedCardFromState()

  if (!selectedCard?.pairAddress || !state.searchResult?.cards?.length) {
    return
  }

  selectedPriceRefreshInFlight = true
  try {
    const fallbackPrice = Number(getPoolDisplayPrice(selectedCard) || 0)
    const payload = await fetchJson(`/api/pool-price?pairAddress=${encodeURIComponent(selectedCard.pairAddress)}&dex=${encodeURIComponent(selectedCard.dex || '')}&protocolVersion=${encodeURIComponent(selectedCard.protocolVersion || '')}&tokenAddress=${encodeURIComponent(selectedCard.tokenAddress || '')}&quoteAddress=${encodeURIComponent(selectedCard.quoteAddress || '')}&fallbackPrice=${encodeURIComponent(Number.isFinite(fallbackPrice) ? fallbackPrice : 0)}&_=${Date.now()}`)
    const card = state.searchResult.cards.find((entry) => entry.id === selectedCard.id)
    if (!card) {
      return
    }

    const previousPrice = Number(getPoolDisplayPrice(card) || 0)
    const nextPoolPrice = Number(payload.poolPrice || card.poolPrice || card.price || card.priceUsd || 0)
    const nextTokenPrice = Number(payload.priceUsd || card.priceUsd || 0)
    const previousLiquidity = Number(card.liquidityUsd || 0)
    const nextLiquidity = Number(payload.liquidityUsd || card.liquidityUsd || 0)
    const changed = Math.abs(previousPrice - nextPoolPrice) > 1e-12
      || Math.abs(previousLiquidity - nextLiquidity) > 1e-6

    card.poolPrice = nextPoolPrice
    card.priceUsd = nextTokenPrice
    card.quoteTokenUsdPrice = Number(payload.quoteTokenUsdPrice || card.quoteTokenUsdPrice || card.depositTokenUsdPrice || 0)
    card.depositTokenUsdPrice = Number(payload.quoteTokenUsdPrice || card.depositTokenUsdPrice || card.quoteTokenUsdPrice || 0)
    card.liquidityUsd = nextLiquidity
    card.marketCapUsd = Number(payload.marketCapUsd || card.marketCapUsd || 0)
    card.marketCapLabel = Number(card.marketCapUsd || 0) > 0 ? formatUsd(card.marketCapUsd) : null
    card.volume1hUsd = Number(payload.volume?.h1 || card.volume1hUsd || 0)
    card.volume24hUsd = Number(payload.volume?.h24 || card.volume24hUsd || 0)
    card.ageHours = payload.pairCreatedAt ? Math.max(0, (Date.now() - Number(payload.pairCreatedAt)) / (60 * 60 * 1000)) : card.ageHours

    const refreshedAt = new Date().toISOString()
    state.marketUpdatedAt = refreshedAt
    state.marketDisplayUpdatedAt = refreshedAt
    state.selectedPoolId = card.id
    state.selectedPoolKey = buildPoolSelectionKey(card)
    state.selectedPoolCard = card
    syncHeaderContextForView()

    if (manual && !isEditingSetupRangeInputs() && !hasActiveTextSelection()) {
      state.positionSetup.anchorLocked = false
      state.positionSetup.anchorPrice = nextPoolPrice
      state.setupExecutionResult = null
      clearSetupRangeInputDraft()
      renderPositionSetupPanel(card)
      updateCreateLivePriceNodes(card)
      return
    }

    if (isEditingSetupRangeInputs() || isInteractingWithSetupControls() || hasActiveTextSelection()) {
      updateCreateLivePriceNodes(card)
      return
    }

    updateCreateLivePriceNodes(card)

    if (background || document.hidden) {
      renderUpdatedHeader()
      return
    }

    if (state.activeView === 'create') {
      if (changed) {
        if (!state.positionSetup.anchorLocked) {
          state.positionSetup.anchorPrice = nextPoolPrice
        }
        renderPositionSetupPanel(card)
        updateCreateLivePriceNodes(card)
      }
      return
    }

    renderPoolCards(state.searchResult)
    scheduleSearchViewportHydration({ delayMs: 100 })
  } catch {
    // Keep the last good selected-pool state if live refresh fails.
  } finally {
    selectedPriceRefreshInFlight = false
    if (selectedPriceManualRefreshQueued) {
      selectedPriceManualRefreshQueued = false
      setTimeout(() => {
        refreshSelectedPoolPrice({ manual: true }).catch(() => {})
      }, 0)
    }
  }
}

function rerenderSearchResult() {
  if (state.searchResult) {
    renderPoolCards(state.searchResult)
    scheduleSearchViewportHydration({ delayMs: 140 })
  }
}

function scheduleRerenderSearchResult(options = {}) {
  const immediate = Boolean(options.immediate)
  if (searchFilterRenderTimer) {
    clearTimeout(searchFilterRenderTimer)
    searchFilterRenderTimer = null
  }

  if (immediate) {
    rerenderSearchResult()
    return
  }

  searchFilterRenderTimer = setTimeout(() => {
    searchFilterRenderTimer = null
    rerenderSearchResult()
  }, SEARCH_FILTER_INPUT_DEBOUNCE_MS)
}

document.getElementById('search-button').addEventListener('click', searchPools)
document.getElementById('pool-search-refresh-button').addEventListener('click', () => {
  refreshCurrentSearchResult({ manual: true, force: true }).catch((error) => {
    setText('search-meta', `Pool Search refresh failed: ${error.message}`)
  })
})
document.getElementById('reset-filters-button').addEventListener('click', resetFilters)
document.getElementById('save-filter-preset-button').addEventListener('click', saveCurrentFilterPreset)
document.getElementById('filter-preset-name').addEventListener('input', renderFilterPresets)
document.getElementById('filter-preset-name').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    saveCurrentFilterPreset()
  }
})
document.getElementById('pool-query').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    searchPools()
  }
})

for (const node of document.querySelectorAll('.nav-link')) {
  node.addEventListener('click', () => {
    setActiveView(node.dataset.view)
  })
}

document.getElementById('settings-node-form')?.addEventListener('submit', async (event) => {
  event.preventDefault()
  await saveOperatorNodeSettings(document.getElementById('settings-node-url')?.value || '')
})

document.getElementById('settings-node-reset')?.addEventListener('click', async () => {
  await saveOperatorNodeSettings('')
})

document.getElementById('settings-generate-wallet-form')?.addEventListener('submit', async (event) => {
  event.preventDefault()
  await generateSettingsWallet()
})

document.getElementById('preview-modal-close').addEventListener('click', closePreviewModal)
document.querySelector('[data-modal-close="preview"]').addEventListener('click', closePreviewModal)
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeLinkContextMenu()
    closePreviewModal()
    closeSwapTokenSelector()
    closeSwapSettingsModal()
  }
})

document.addEventListener('click', (event) => {
  if (!event.target.closest('#link-context-menu')) {
    closeLinkContextMenu()
  }
  if (
    state.swap.selector.open
    && !event.target.closest('#swap-token-modal')
    && !event.target.closest('#swap-token-in-button')
    && !event.target.closest('#swap-token-out-button')
  ) {
    closeSwapTokenSelector()
  }
})

window.addEventListener('resize', () => {
  if (state.swap.selector.open) {
    positionSwapTokenDropdown()
  }
})

document.getElementById('link-context-menu')?.addEventListener('click', async (event) => {
  const copyButton = event.target.closest('[data-copy-link-menu-action="copy"]')
  if (!copyButton) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const menu = document.getElementById('link-context-menu')
  const copied = await copyToClipboard(menu?.dataset.copyUrl || '')
  if (copied) {
    copyButton.classList.add('copied')
    setTimeout(() => copyButton.classList.remove('copied'), 900)
  }
  closeLinkContextMenu()
})

document.getElementById('keystore-refresh-button').addEventListener('click', async (event) => {
  const button = event.currentTarget
  button.disabled = true
  try {
    await refreshKeystoreState('Local keystore state refreshed.')
  } finally {
    setTimeout(() => {
      button.disabled = false
    }, 300)
  }
})

document.getElementById('keystore-lock-button').addEventListener('click', async () => {
  state.keystore.busy = true
  renderKeystorePanel()
  renderSwapPanel()
  try {
    await postJson('/api/keystore-lock', {
      reason: 'operator_manual_lock'
    })
    document.getElementById('keystore-password').value = ''
    state.keystore.feedback = 'Keystore session locked and removed from RAM.'
  } catch (error) {
    state.keystore.feedback = error.message
  } finally {
    state.keystore.busy = false
    await loadKeystoreState()
    await loadSnapshot(true).catch(() => {})
  }
})

document.getElementById('keystore-unlock-form').addEventListener('submit', async (event) => {
  event.preventDefault()

  const walletId = document.getElementById('keystore-wallet-select').value
  const passwordNode = document.getElementById('keystore-password')
  const password = passwordNode.value

  state.keystore.busy = true
  state.keystore.feedback = 'Unlocking local keystore session...'
  renderKeystorePanel()
  renderSwapPanel()

  try {
    const payload = await postJson('/api/keystore-unlock', {
      walletId,
      password
    })
    passwordNode.value = ''
    passwordNode.blur()
    state.keystore.status = payload.status || null
    state.keystore.wallets = payload.wallets || []
    state.keystore.feedback = `Session unlocked for ${payload.status?.walletIdMasked || truncateAddress(payload.status?.address)}.`
    state.keystore.busy = false
    renderKeystorePanel()
    renderSwapPanel()
    loadSnapshot(true).catch(() => {})
  } catch (error) {
    state.keystore.feedback = error.message
  } finally {
    state.keystore.busy = false
    renderKeystorePanel()
    renderSwapPanel()
  }
})

document.getElementById('keystore-import-form').addEventListener('submit', async (event) => {
  event.preventDefault()

  const labelNode = document.getElementById('keystore-import-label')
  const passwordNode = document.getElementById('keystore-import-password')
  const privateKeyNode = document.getElementById('keystore-import-private-key')

  state.keystore.busy = true
  state.keystore.feedback = 'Importing wallet into local encrypted keystore...'
  renderKeystorePanel()
  renderSwapPanel()

  try {
    const payload = await postJson('/api/keystore-import', {
      label: labelNode.value,
      password: passwordNode.value,
      privateKey: privateKeyNode.value
    })
    labelNode.value = ''
    passwordNode.value = ''
    privateKeyNode.value = ''
    state.keystore.status = payload.status || null
    state.keystore.wallets = payload.wallets || []
    state.keystore.feedback = `Wallet imported as ${payload.imported?.walletIdMasked || 'local entry'}.`
    await loadSnapshot(true).catch(() => {})
  } catch (error) {
    state.keystore.feedback = error.message
  } finally {
    state.keystore.busy = false
    renderKeystorePanel()
    renderSwapPanel()
  }
})

document.getElementById('swap-preview-button').addEventListener('click', async () => {
  await runSwapPreview()
})

  document.getElementById('swap-direction-button').addEventListener('click', () => {
    const nextIn = { ...state.swap.outputToken }
    state.swap.outputToken = { ...state.swap.inputToken }
    state.swap.inputToken = nextIn
    const amountNode = document.getElementById('swap-amount-in')
    if (amountNode) {
      amountNode.value = ''
    }
    state.swap.preview = null
    state.swap.selectedRouteId = null
    state.swap.selectedRoutePinned = false
    state.swap.feedback = ''
    state.swap.lastExecutionFeedback = ''
    state.swap.lastExecutionAtMs = 0
    state.swap.lastExecutionSummary = null
    renderSwapPanel()
    refreshSelectedSwapBalances().catch(() => {})
    scheduleSwapQuote('flip')
  })

for (const node of document.querySelectorAll('[data-swap-amount]')) {
  node.addEventListener('click', () => {
    applySwapAmountShortcut(String(node.dataset.swapAmount || 'max'))
  })
}

for (const node of document.querySelectorAll('[data-swap-slippage]')) {
  node.addEventListener('click', () => {
    const value = String(node.dataset.swapSlippage || '0.5')
    const slippageNode = document.getElementById('swap-slippage')
    if (slippageNode) slippageNode.value = value
    applySwapSettings({
      slippagePct: Number(value),
      slippageMode: 'manual'
    })
    setSwapFeedback(`Slippage set to ${clampSwapSlippagePct(value).toFixed(2)}%.`, 'info')
    scheduleSwapQuote('settings')
  })
}

document.getElementById('swap-execute-button').addEventListener('click', async () => {
  if (state.swap.status === 'stale' || isSwapPreviewActuallyStale(state.swap.preview)) {
    await runSwapPreview('stale-refresh')
    return
  }
  await runSwapExecute()
})

document.getElementById('swap-token-in-button').addEventListener('click', () => {
  openSwapTokenSelector('input')
})

document.getElementById('swap-token-out-button').addEventListener('click', () => {
  openSwapTokenSelector('output')
})

document.getElementById('swap-settings-button').addEventListener('click', () => {
  openSwapSettingsModal()
})

document.getElementById('swap-token-modal-close').addEventListener('click', closeSwapTokenSelector)
document.getElementById('swap-settings-modal-close').addEventListener('click', closeSwapSettingsModal)

for (const node of document.querySelectorAll('[data-modal-close="swap-token"]')) {
  node.addEventListener('click', closeSwapTokenSelector)
}

for (const node of document.querySelectorAll('[data-modal-close="swap-settings"]')) {
  node.addEventListener('click', closeSwapSettingsModal)
}

for (const node of document.querySelectorAll('[data-swap-token-tab]')) {
  node.addEventListener('click', () => {
    state.swap.selector.tab = String(node.dataset.swapTokenTab || 'top')
    renderSwapTokenSelector()
  })
}

const swapAmountNode = document.getElementById('swap-amount-in')
if (swapAmountNode) {
  swapAmountNode.addEventListener('input', () => {
    state.swap.lastExecutionFeedback = ''
    state.swap.lastExecutionAtMs = 0
    state.swap.lastExecutionSummary = null
    state.swap.preview = null
    state.swap.feedback = ''
    state.swap.status = 'typing'
    updateSwapAmountFiatDisplay()
    renderSwapPanel()
    scheduleSwapQuote('typing')
  })
}

const swapSearchNode = document.getElementById('swap-token-search-input')
if (swapSearchNode) {
  swapSearchNode.addEventListener('input', () => {
    state.swap.selector.query = swapSearchNode.value.trim()
    if (state.swap.selector.searchTimer) {
      clearTimeout(state.swap.selector.searchTimer)
      state.swap.selector.searchTimer = null
    }
    if (isExactEvmAddressInput(state.swap.selector.query)) {
      fetchSwapTokenCatalog().catch(() => {})
      return
    }
    state.swap.selector.searchTimer = setTimeout(() => {
      fetchSwapTokenCatalog().catch(() => {})
    }, SWAP_TOKEN_SEARCH_DEBOUNCE_MS)
  })
}

const swapSlippageNode = document.getElementById('swap-slippage')
if (swapSlippageNode) {
  swapSlippageNode.addEventListener('change', () => {
    const nextValue = clampSwapSlippagePct(swapSlippageNode.value || state.swap.settings.slippagePct || 0.5)
    swapSlippageNode.value = String(nextValue)
    applySwapSettings({
      slippagePct: nextValue,
      slippageMode: 'manual'
    })
    scheduleSwapQuote('settings')
  })
}

const swapAutoRefreshToggle = document.getElementById('swap-auto-refresh-toggle')
if (swapAutoRefreshToggle) {
  swapAutoRefreshToggle.addEventListener('change', () => {
    applySwapSettings({
      autoRefreshEnabled: Boolean(swapAutoRefreshToggle.checked)
    })
  })
}

const swapRefreshCadence = document.getElementById('swap-refresh-cadence')
if (swapRefreshCadence) {
  swapRefreshCadence.addEventListener('change', () => {
    applySwapSettings({
      refreshCadenceMs: Number(swapRefreshCadence.value || DEFAULT_SWAP_SETTINGS.refreshCadenceMs)
    })
  })
}

const swapQuickTokenInput = document.getElementById('swap-quick-token-input')
if (swapQuickTokenInput) {
  swapQuickTokenInput.addEventListener('change', () => {
    applySwapSettings({
      quickTokenSymbols: String(swapQuickTokenInput.value || '')
        .split(',')
        .map((item) => String(item || '').trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 6)
    })
  })
}

function partitionClosePositionIds(positionIds = []) {
  const cards = state.lastSnapshot?.dashboard?.positions?.openCards || []
  const byId = new Map(cards.map((card) => [String(card.positionId || card.tokenId), card]))
  const groups = new Map()

  for (const rawId of positionIds) {
    const positionId = String(rawId || '').trim()
    if (!positionId) {
      continue
    }
    const card = byId.get(positionId)
    const key = card
      ? [
          String(card.dex || '').toLowerCase(),
          String(card.protocolVersion || 'v3').toLowerCase(),
          String(card.poolAddress || '').toLowerCase()
        ].join(':')
      : `single:${positionId}`
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key).push(positionId)
  }

  return [...groups.values()]
}

function scopeCloseLiveResultForPosition(result, positionId) {
  const key = String(positionId || '')
  return {
    ...result,
    tokenId: key,
    positionId: key,
    closeCards: (result.closeCards || []).filter((card) => String(card.positionId || card.tokenId || '') === key),
    autoswapExecutions: (result.autoswapExecutions || []).filter((entry) => String(entry.positionId || entry.tokenId || '') === key)
  }
}

async function closeLiveByIds(positionIds, options = {}) {
  const autoswapOnClose = Boolean(options.autoswapOnClose)
  if (autoswapOnClose && !EXIT_SWAP_CLOSE_ENABLED) {
    showActionOverlay({
      title: 'Exit swap unavailable',
      total: 1,
      current: 1,
      message: EXIT_SWAP_DISABLED_TITLE
    })
    hideActionOverlay(1600)
    return
  }
  const closeGroups = partitionClosePositionIds(positionIds)
  const totalPositions = closeGroups.reduce((sum, group) => sum + group.length, 0)
  showActionOverlay({
    title: autoswapOnClose ? 'Closing live positions with exit swap' : 'Closing live positions',
    total: Math.max(1, totalPositions),
    message: autoswapOnClose
      ? `Closing and swapping exit tokens for ${totalPositions} position(s)`
      : `Closing ${totalPositions} position(s)`
  })
  try {
    let completed = 0
    const actionSummary = {
      closed: 0,
      swapExecuted: 0,
      swapHeld: 0,
      errors: 0,
      autoswapExecutions: []
    }
    for (const group of closeGroups) {
      const closeEndpoint = group.length > 1 ? '/api/positions-close-live' : '/api/position-close-live'
      const groupLabel = group.length > 1
        ? `${group.length} compatible positions`
        : `position ${group[0]}`
      try {
        bumpActionOverlay(completed, autoswapOnClose ? `Closing and swapping ${groupLabel}` : `Closing ${groupLabel}`, {
          progressLabel: `${completed}/${totalPositions}`,
          indeterminate: true
        })
        const result = await postJson(closeEndpoint, group.length > 1
          ? {
              positionIds: group,
              autoswapOnClose,
              slippagePct: state.positionSetup.slippagePct
            }
          : {
              positionId: group[0],
              autoswapOnClose,
              slippagePct: state.positionSetup.slippagePct
        })
        completed += group.length
        actionSummary.closed += Number(result?.closeCards?.length || group.length || 0)
        const autoswapExecutions = Array.isArray(result?.autoswapExecutions) ? result.autoswapExecutions : []
        actionSummary.autoswapExecutions.push(...autoswapExecutions)
        actionSummary.swapExecuted += autoswapExecutions.filter((entry) => entry?.executed).length
        actionSummary.swapHeld += autoswapExecutions.filter((entry) => entry && !entry.executed).length
        for (const positionId of group) {
          state.positionActionResults[String(positionId)] = scopeCloseLiveResultForPosition({
            kind: 'close-live',
            ...result
          }, positionId)
        }
        if (result?.dashboard && state.lastSnapshot) {
          const nextSnapshot = {
            ...state.lastSnapshot,
            dashboard: result.dashboard
          }
          applySnapshotToUi(nextSnapshot)
        }
      } catch (error) {
        completed += group.length
        actionSummary.errors += 1
        for (const positionId of group) {
          state.positionActionResults[String(positionId)] = {
            kind: 'error',
            error: error.message
          }
        }
      }
    }
    if (closeGroups.length === 0) {
      for (const positionId of positionIds) {
        try {
          bumpActionOverlay(1, autoswapOnClose ? `Closing and swapping exit tokens for position ${positionId}` : `Closing position ${positionId}`)
          const result = await postJson('/api/position-close-live', {
            positionId,
            autoswapOnClose,
            slippagePct: state.positionSetup.slippagePct
          })
          actionSummary.closed += Number(result?.closeCards?.length || 1)
          const autoswapExecutions = Array.isArray(result?.autoswapExecutions) ? result.autoswapExecutions : []
          actionSummary.autoswapExecutions.push(...autoswapExecutions)
          actionSummary.swapExecuted += autoswapExecutions.filter((entry) => entry?.executed).length
          actionSummary.swapHeld += autoswapExecutions.filter((entry) => entry && !entry.executed).length
          state.positionActionResults[String(positionId)] = scopeCloseLiveResultForPosition({
            kind: 'close-live',
            ...result
          }, positionId)
          if (result?.dashboard && state.lastSnapshot) {
            const nextSnapshot = {
              ...state.lastSnapshot,
              dashboard: result.dashboard
            }
            applySnapshotToUi(nextSnapshot)
          }
        } catch (error) {
          actionSummary.errors += 1
          state.positionActionResults[String(positionId)] = {
            kind: 'error',
            error: error.message
          }
        }
      }
    }
    if (autoswapOnClose) {
      showCloseSwapToast(actionSummary)
    }
    state.manageSelection.clear()
    void loadSnapshot(true).catch(() => {})
  } finally {
    hideActionOverlay(160)
  }
}

document.getElementById('manage-close-selected').addEventListener('click', async () => {
  const ids = [...state.manageSelection]
  if (!ids.length) {
    return
  }
  await closeLiveByIds(ids)
})

document.getElementById('manage-close-swap-selected').addEventListener('click', async () => {
  const ids = [...state.manageSelection]
  if (!ids.length) {
    return
  }
  await closeLiveByIds(ids, { autoswapOnClose: true })
})

document.getElementById('manage-close-all').addEventListener('click', async () => {
  const ids = (state.lastSnapshot?.dashboard?.positions?.openCards || []).map((card) => String(card.positionId))
  if (!ids.length) {
    return
  }
  await closeLiveByIds(ids)
})

document.getElementById('manage-close-swap-all').addEventListener('click', async () => {
  const ids = (state.lastSnapshot?.dashboard?.positions?.openCards || []).map((card) => String(card.positionId))
  if (!ids.length) {
    return
  }
  await closeLiveByIds(ids, { autoswapOnClose: true })
})

document.getElementById('manage-claim-selected').addEventListener('click', async () => {
  const ids = (state.lastSnapshot?.dashboard?.positions?.openCards || [])
    .filter((card) => state.manageSelection.has(String(card.positionId)) && Number(card.accruedFeesQuote || 0) > 0)
    .map((card) => String(card.positionId))
  if (!ids.length) {
    return
  }
  await collectLiveByIds(ids)
})

document.getElementById('manage-claim-all').addEventListener('click', async () => {
  const ids = (state.lastSnapshot?.dashboard?.positions?.openCards || [])
    .filter((card) => Number(card.accruedFeesQuote || 0) > 0)
    .map((card) => String(card.positionId))
  if (!ids.length) {
    return
  }
  await collectLiveByIds(ids)
})

for (const id of FILTER_IDS) {
  const node = document.getElementById(id)
  if (!node) {
    continue
  }
  const isImmediateFilter = node.type === 'checkbox' || node.tagName === 'SELECT' || id === 'pool-type-filter'
  if (isImmediateFilter) {
    node.addEventListener('change', () => scheduleRerenderSearchResult({ immediate: true }))
    continue
  }

  node.addEventListener('input', () => scheduleRerenderSearchResult())
  node.addEventListener('change', () => scheduleRerenderSearchResult({ immediate: true }))
}

function sortPositionGroupCards(cards) {
  return [...(cards || [])].sort((left, right) => {
    const leftUpper = Math.max(Number(left.rangeUpperPrice || 0), Number(left.rangeLowerPrice || 0))
    const rightUpper = Math.max(Number(right.rangeUpperPrice || 0), Number(right.rangeLowerPrice || 0))
    return rightUpper - leftUpper
  })
}

function getOpenGroupFeeTierLabel(cards = []) {
  const first = (cards || []).find((card) => card && (card.feeTierLabel || Number(card.fee || card.baseFeePct || 0) > 0))
  if (!first) {
    return ''
  }
  if (first.feeTierLabel) {
    return first.feeTierLabel
  }
  if (Number(first.baseFeePct || 0) > 0) {
    return formatPct(Number(first.baseFeePct), 2)
  }
  if (Number(first.fee || 0) > 0) {
    return formatPct(Number(first.fee) / 10000, 2)
  }
  return ''
}

function getOpenGroupContractAddress(cards = []) {
  const first = (cards || []).find((card) => /^0x[a-fA-F0-9]{40}$/.test(String(card?.inputTokenAddress || card?.tokenAddress || card?.contractAddress || card?.baseTokenAddress || '')))
  return first ? String(first.inputTokenAddress || first.tokenAddress || first.contractAddress || first.baseTokenAddress) : ''
}

function groupPositionsByRun(openCards) {
  const groups = new Map()

  for (const card of openCards || []) {
    const openedAt = card.openedAt || card.recoveredAt || card.lastSeenAt || 'unknown'
    const runKey = card.openedRunKey || card.openedTxHash || null
    const key = runKey
      ? `${card.dex || 'dex'}:${card.poolAddress || 'pool'}:${runKey}`
      : `${card.dex || 'dex'}:${card.poolAddress || 'pool'}:${openedAt}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        openedAt,
        runKey,
        dex: card.dex || 'unknown',
        poolAddress: card.poolAddress || null,
        quoteSymbol: card.quoteSymbol || 'USDT',
        cards: []
      })
    }
    groups.get(key).cards.push(card)
  }

  return [...groups.values()]
    .map((group) => ({ ...group, cards: sortPositionGroupCards(group.cards) }))
    .sort((left, right) => String(right.openedAt || '').localeCompare(String(left.openedAt || '')))
}

function groupClosedPositionsByRun(closedCards) {
  const groups = new Map()

  for (const card of closedCards || []) {
    const closedAt = card.closedAt || 'unknown'
    const minuteBucket = toMinuteBucket(closedAt)
    const originalOpenBatch = card.openedRunKey || card.openedTxHash || null
    const closedBatchKey = originalOpenBatch ? `closed-batch:${originalOpenBatch}` : minuteBucket
    const key = `${card.dex || 'dex'}:${card.poolAddress || 'pool'}:${card.tokenSymbol || 'token'}:${card.quoteSymbol || 'quote'}:${closedBatchKey}`

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        closedAt,
        dex: card.dex || 'unknown',
        poolAddress: card.poolAddress || null,
        tokenSymbol: card.tokenSymbol || 'TOKEN',
        quoteSymbol: card.quoteSymbol || 'USDT',
        runKey: originalOpenBatch || null,
        cards: []
      })
    }

    groups.get(key).cards.push(card)
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      cards: [...group.cards].sort((left, right) => String(right.tokenId || right.positionId || '').localeCompare(String(left.tokenId || left.positionId || '')))
    }))
    .sort((left, right) => String(right.closedAt || '').localeCompare(String(left.closedAt || '')))
}

function buildRangeProgress(card) {
  const selectedCard = getSelectedCardFromState()
  const selectedCurrent = selectedCard
    && String(selectedCard.poolAddress || '').toLowerCase() === String(card.poolAddress || '').toLowerCase()
    ? Number(getPoolDisplayPrice(selectedCard) || 0)
    : 0
  const current = Number(selectedCurrent || card.currentPoolPrice || card.targetPrice || 0)
  const inputIsToken0 = String(card.inputTokenAddress || '').toLowerCase() === String(card.token0Address || '').toLowerCase()
  const fallbackLower = Number(card.rangeLowerPrice || approximatePriceFromTick(current, card.currentTick, card.tickLower, inputIsToken0))
  const fallbackUpper = Number(card.rangeUpperPrice || approximatePriceFromTick(current, card.currentTick, card.tickUpper, inputIsToken0))
  const lower = Math.min(fallbackLower, fallbackUpper)
  const upper = Math.max(fallbackLower, fallbackUpper)
  const lowerPct = card.rangeLowerPct == null || card.rangeUpperPct == null ? null : Math.min(Number(card.rangeLowerPct), Number(card.rangeUpperPct))
  const upperPct = card.rangeLowerPct == null || card.rangeUpperPct == null ? null : Math.max(Number(card.rangeLowerPct), Number(card.rangeUpperPct))

  return buildRangeMeterModel({
    lowerPrice: lower,
    upperPrice: upper,
    currentPrice: current,
    lowerPct,
    upperPct,
    dimmed: card.outOfRange
  })
}

function renderClosedPositions(closedCards) {
  const root = document.getElementById('closed-position-list')
  if (!root) {
    return
  }
  root.innerHTML = ''

  if (!closedCards.length) {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = '<span>Closed Positions</span><strong>None</strong>'
    root.appendChild(row)
    return
  }

  const groups = groupClosedPositionsByRun(closedCards.slice(0, 24))
  for (const group of groups) {
    const expanded = state.closedExpandedGroups.has(`sidebar:${group.key}`)
    const totals = buildClosedGroupTotals(group.cards)
    const pnlClass = totals.totalPnl >= 0 ? 'positive' : 'negative'
    const pairLabel = group.cards[0] ? getPairDisplayLabel(group.cards[0]) : `${group.tokenSymbol || 'TOKEN'}/${group.quoteSymbol || 'QUOTE'}`
    const item = document.createElement('div')
    item.className = 'position-item'
    item.innerHTML = `
      <div class="position-head">
        <button type="button" class="position-head-toggle" data-sidebar-closed-group="${group.key}">
          <div>
            <h4>${escapeHtml(pairLabel)}</h4>
            <p class="position-subline">${escapeHtml(`${group.cards.length} closed positions · ${group.quoteSymbol || 'USDT'} · ${formatTimestamp(group.closedAt)}`)}</p>
          </div>
          <span class="position-status closed">${expanded ? 'Collapse' : 'Closed'}</span>
        </button>
      </div>
      <div class="position-metrics">
        <div class="position-metric"><span>Net Proceeds</span><strong>${formatUsd(totals.totalNet)}</strong></div>
        <div class="position-metric"><span>Realized PnL</span><strong class="${pnlClass}">${formatSignedUsd(totals.totalPnl)}</strong></div>
        <div class="position-metric"><span>Fees</span><strong class="positive">${formatUsd(totals.totalFees)}</strong></div>
      </div>
      ${expanded ? `
        <div class="position-metrics compact">
          ${group.cards.map((card) => `
            <div class="position-metric">
              <span>#${escapeHtml(card.tokenId || card.positionId)}</span>
              <strong class="${Number(card.realizedPnlQuote || 0) >= 0 ? 'positive' : 'negative'}">${formatClosedUsd(card, 'realizedPnlQuote', { signed: true })}</strong>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `
    root.appendChild(item)
  }

  for (const button of document.querySelectorAll('[data-sidebar-closed-group]')) {
    button.onclick = () => {
      const key = `sidebar:${String(button.dataset.sidebarClosedGroup || '')}`
      if (!key || key === 'sidebar:') {
        return
      }
      if (state.closedExpandedGroups.has(key)) {
        state.closedExpandedGroups.delete(key)
      } else {
        state.closedExpandedGroups.add(key)
      }
      renderClosedPositions(closedCards)
    }
  }
}

loadSnapshot().catch((error) => {
  setText('search-meta', `Snapshot load failed: ${error.message}`)
})

loadForkStatus().catch(() => {
  renderForkStatus()
})

loadKeystoreState().catch((error) => {
  state.keystore.feedback = `Keystore load failed: ${error.message}`
  renderKeystorePanel()
  renderSwapPanel()
})

loadLiveRunnerStatus().catch(() => {})
loadLicenseStatusBadge().catch(() => {})

loadFilterPresets().then(() => {
  renderFilterPresets()
}).catch(() => {
  loadFilterPresetsFromLocalStorage()
  renderFilterPresets()
})

searchPools().catch((error) => {
  setText('search-meta', `Initial search failed: ${error.message}`)
})

setInterval(() => {
  if (state.activeView === 'create') {
    refreshSelectedPoolPrice()
  }
}, 5000)

setInterval(() => {
  refreshSelectedPoolPrice({ background: true }).catch(() => {})
}, BACKGROUND_SELECTED_PRICE_REFRESH_INTERVAL_MS)

setInterval(() => {
  if (hasActiveTextSelection() || isInteractingWithSetupControls()) {
    return
  }

  renderUpdatedHeader()
  updateMarketAgeLabels()
}, 1000)

setInterval(() => {
  if (
    state.activeView === 'manage'
    && !state.actionOverlay
    && !hasActiveTextSelection()
    && !isInteractingWithSetupControls()
  ) {
    loadSnapshot({ refreshOpenPositions: true, background: true }).catch(() => {
      // Keep the last good operator snapshot if background refresh fails.
    })
  }
}, MANAGE_OPEN_REFRESH_INTERVAL_MS)

setInterval(() => {
  if (document.hidden || state.activeView === 'pool-search') {
    return
  }
  loadForkStatus().catch(() => {
    renderForkStatus()
  })
}, 15000)

setInterval(() => {
  if (document.hidden || state.activeView === 'pool-search') {
    return
  }
  loadKeystoreState().catch(() => {
    renderKeystorePanel()
  })
}, 15000)

setInterval(() => {
  if (!document.hidden) {
    loadLicenseStatusBadge().catch(() => {})
  }
}, 60000)

setInterval(() => {
  if (
    document.hidden
    || (state.activeView === 'pool-search' && !state.liveRunner?.activeRunId)
  ) {
    return
  }
  loadLiveRunnerStatus().catch(() => {})
}, 5000)

window.addEventListener('scroll', () => {
  scheduleSearchViewportHydration({ delayMs: 150 })
}, { passive: true })

document.getElementById('pool-grid')?.addEventListener('scroll', () => {
  scheduleSearchViewportHydration({ delayMs: 150 })
}, { passive: true })

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.swap.settings.autoRefreshEnabled && state.swap.preview) {
    runSwapPreview('visibility').catch(() => {})
  }
  if (!document.hidden) {
    scheduleSearchViewportHydration({ delayMs: 80, burst: [1000] })
  }
})

loadSwapSettings()
refreshSwapAutoQuoteLoop()
setActiveView(state.activeView)
renderForkStatus()
renderKeystorePanel()
renderSwapPanel()
renderSwapTokenSelector()
renderActionOverlay()
installDesktopUpdateControls()
loadOperatorSettings().catch(() => {})
