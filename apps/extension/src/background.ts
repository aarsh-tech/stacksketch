import { sendWithFetch } from '@stacksketch/core'
import { withDefaults } from './messages'
import type { ToBackground } from './messages'

/**
 * The service worker: opens the side panel from the toolbar button and keeps
 * the content script registered for the sites the user turned it on for
 * (local dev servers and the hosted workbench by default). Nothing runs anywhere else.
 *
 * It also sends the workbench API client's requests, which the bridge script
 * hands it. Fetches from here aren't limited by CORS, but only reach hosts
 * the person allowed (localhost out of the box), and never carry the
 * browser's cookies.
 */

async function sites(): Promise<string[]> {
  const { sites } = await chrome.storage.local.get('sites')
  return withDefaults(sites)
}

async function syncScripts() {
  const matches = await sites()
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: ['stacksketch'] })
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: ['stacksketch'] })
  if (matches.length) await chrome.scripting.registerContentScripts([{ id: 'stacksketch', matches, js: ['content.js', 'bridge.js'], runAt: 'document_idle', persistAcrossSessions: true }])
}

/** Tabs open before the extension was installed don't have the scripts yet: start them there too. */
async function startInOpenTabs() {
  const tabs = await chrome.tabs.query({ url: await sites() })
  for (const t of tabs)
    if (t.id) await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js', 'bridge.js'] }).catch(() => undefined)
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  void syncScripts().then(startInOpenTabs)
})
chrome.runtime.onStartup.addListener(() => void syncScripts())

/** `http://localhost:3000/*` for http://localhost:3000/x: what permissions.contains wants */
const patternFor = (url: string) => {
  const u = new URL(url)
  return `${u.protocol}//${u.hostname}/*`
}

async function apiSend(request: Extract<ToBackground, { type: 'apiSend' }>['request']) {
  let pattern: string
  try {
    pattern = patternFor(request.url)
  } catch {
    return { ok: false, kind: 'invalid', error: `${request.url} isn't a URL.` }
  }
  if (!(await chrome.permissions.contains({ origins: [pattern] })))
    return { ok: false, kind: 'permission', origin: new URL(request.url).origin, error: `The extension isn't allowed to send requests to ${new URL(request.url).hostname} yet.` }
  return sendWithFetch(fetch, request, 'extension')
}

/** A small window with one button: permissions.request needs a click on an extension page. */
async function openGrant(origin: string, tabId: number | undefined) {
  const url = chrome.runtime.getURL(`sidepanel.html?grant=${encodeURIComponent(origin)}${tabId ? `&tab=${tabId}` : ''}`)
  await chrome.windows.create({ url, type: 'popup', width: 440, height: 340, focused: true })
}

chrome.runtime.onMessage.addListener((message: ToBackground, sender, reply) => {
  if (message.type === 'apiSend') {
    apiSend(message.request).then(reply, (e: unknown) => reply({ ok: false, kind: 'network', error: String(e) }))
    return true
  }
  if (message.type === 'apiGrant') {
    void openGrant(message.origin, sender.tab?.id)
    return undefined
  }
  if (message.type === 'syncScripts') {
    syncScripts().then(
      () => reply({ ok: true }),
      (e: unknown) => reply({ ok: false, error: String(e) }),
    )
    return true
  }
  return undefined
})
