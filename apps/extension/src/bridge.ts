import { FROM_EXTENSION, isFromApp } from '@stacksketch/core'
import type { ExtensionToApp, SendResult } from '@stacksketch/core'
import type { ToBackground } from './messages'

/**
 * Runs in the workbench page (on the sites Stacksketch is turned on for) and
 * relays the API client's requests to the service worker, which sends them
 * without CORS. Only messages from this page's own window are taken.
 */

declare global {
  interface Window {
    __stacksketchBridge?: boolean
  }
}

const VERSION = chrome.runtime.getManifest().version

const post = (message: ExtensionToApp) => window.postMessage(message, location.origin)

if (!window.__stacksketchBridge) {
  window.__stacksketchBridge = true

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window || e.origin !== location.origin || !isFromApp(e.data)) return
    const m = e.data
    if (m.type === 'ping') post({ source: FROM_EXTENSION, id: m.id, type: 'pong', version: VERSION })
    else if (m.type === 'send') {
      const ask: ToBackground = { type: 'apiSend', request: m.request }
      chrome.runtime.sendMessage(ask).then(
        (result: SendResult) => post({ source: FROM_EXTENSION, id: m.id, type: 'result', result }),
        (err: unknown) =>
          post({
            source: FROM_EXTENSION,
            id: m.id,
            type: 'result',
            result: { ok: false, kind: 'network', error: `The extension didn't answer (${String(err)}). Reload this page; if it keeps happening, reload the extension in chrome://extensions.` },
          }),
      )
    } else if (m.type === 'grant') {
      const ask: ToBackground = { type: 'apiGrant', origin: m.origin }
      void chrome.runtime.sendMessage(ask)
    }
  })

  chrome.runtime.onMessage.addListener((m: { type?: string; origin?: string; granted?: boolean }) => {
    if (m.type === 'apiGranted' && m.origin) post({ source: FROM_EXTENSION, type: 'granted', origin: m.origin, granted: Boolean(m.granted) })
    return undefined
  })

  post({ source: FROM_EXTENSION, type: 'ready', version: VERSION })
}
