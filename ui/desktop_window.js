'use strict'

async function setupDesktopWindowChrome(attempt = 0) {
  if (!window.desktopWindow) {
    if (attempt < 40) {
      window.setTimeout(() => {
        void setupDesktopWindowChrome(attempt + 1)
      }, 50)
    }
    return
  }
  if (document.querySelector('.desktop-titlebar')) {
    return
  }
  document.body.classList.add('desktop-app')

  const titlebar = document.createElement('div')
  titlebar.className = 'desktop-titlebar'
  const appVersion = typeof window.desktopWindow.appVersion === 'function'
    ? String(await window.desktopWindow.appVersion().catch(() => '') || '').trim()
    : String(window.desktopWindow.appVersion || '').trim()
  const versionBadge = appVersion
    ? `<span class="desktop-titlebar-version">v${appVersion}</span>`
    : ''
  titlebar.innerHTML = `
    <div class="desktop-titlebar-brand">
      <span class="desktop-titlebar-mark"><img src="/ui/app-icon-64.png" alt=""></span>
      <span>BNB BitLadder</span>
      ${versionBadge}
    </div>
    <div class="desktop-titlebar-controls">
      <button class="desktop-titlebar-button" type="button" data-window-action="minimize" title="Minimize" aria-label="Minimize">
        <span class="desktop-titlebar-icon minimize" aria-hidden="true"></span>
      </button>
      <button class="desktop-titlebar-button" type="button" data-window-action="maximize" title="Maximize" aria-label="Maximize">
        <span class="desktop-titlebar-icon maximize" aria-hidden="true"></span>
      </button>
      <button class="desktop-titlebar-button close" type="button" data-window-action="close" title="Close" aria-label="Close">
        <span class="desktop-titlebar-icon close" aria-hidden="true"></span>
      </button>
    </div>
  `
  document.body.prepend(titlebar)

  titlebar.querySelector('[data-window-action="minimize"]')?.addEventListener('click', () => {
    window.desktopWindow.minimize()
  })
  titlebar.querySelector('[data-window-action="maximize"]')?.addEventListener('click', () => {
    window.desktopWindow.toggleMaximize()
  })
  titlebar.querySelector('[data-window-action="close"]')?.addEventListener('click', () => {
    window.desktopWindow.close()
  })
}

void setupDesktopWindowChrome()
