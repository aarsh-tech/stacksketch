import { DEFAULT_SITES } from './messages'

/**
 * The service worker: opens the side panel from the toolbar button and keeps
 * the content script registered for the sites the user turned it on for
 * (local dev servers by default). Nothing runs anywhere else.
 */

async function sites(): Promise<string[]> {
  const { sites } = await chrome.storage.local.get('sites')
  return Array.isArray(sites) ? (sites as string[]) : DEFAULT_SITES
}

async function syncScripts() {
  const matches = await sites()
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: ['stacksketch'] })
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: ['stacksketch'] })
  if (matches.length) await chrome.scripting.registerContentScripts([{ id: 'stacksketch', matches, js: ['content.js'], runAt: 'document_idle', persistAcrossSessions: true }])
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  void syncScripts()
})
chrome.runtime.onStartup.addListener(() => void syncScripts())

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, reply) => {
  if (message.type === 'syncScripts') {
    syncScripts().then(
      () => reply({ ok: true }),
      (e: unknown) => reply({ ok: false, error: String(e) }),
    )
    return true
  }
  return undefined
})
