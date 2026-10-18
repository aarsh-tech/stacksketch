import { useEffect, useSyncExternalStore } from 'react'

import type { FromContent, PingReply, ToContent } from '../messages'
import { withDefaults } from '../messages'

/** The page the side panel works on: the active tab of this window, and whether Stacksketch runs there. */
export interface TabState {
  id: number
  windowId: number
  url: string
  /** `http://localhost:5173`, or null for pages extensions can't touch (chrome://, the web store) */
  origin: string | null
  /** the content script answered */
  connected: boolean
  page?: PingReply
}

export async function sendToTab<T = unknown>(tabId: number, message: ToContent): Promise<T | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  } catch {
    return undefined
  }
}

const originOf = (url: string | undefined) => {
  try {
    const u = new URL(url ?? '')
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

/** `http://localhost/*` matches `http://localhost:5173` */
const matches = (pattern: string, origin: string) => {
  const m = /^(\w+):\/\/([^/]+)\/\*$/.exec(pattern)
  if (!m) return false
  const u = new URL(origin)
  return u.protocol === `${m[1]}:` && (u.hostname === m[2] || m[2] === '*' || (m[2].startsWith('*.') && u.hostname.endsWith(m[2].slice(1))))
}

export async function enabledSites(): Promise<string[]> {
  const { sites } = await chrome.storage.local.get('sites')
  return withDefaults(sites)
}

/* the active tab lives outside React: chrome's tab events update it, and the panel subscribes */

let state: { tab: TabState | null; enabled: boolean } = { tab: null, enabled: false }
const listeners = new Set<() => void>()

async function refresh() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!t?.id) {
    state = { tab: null, enabled: false }
  } else {
    const origin = originOf(t.url)
    const on = origin ? (await enabledSites()).some((p) => matches(p, origin)) : false
    let page = await sendToTab<PingReply>(t.id, { type: 'ping' })
    // turned on, but the page was open before the extension was: run the script now
    if (!page && on) {
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js', 'bridge.js'] }).catch(() => undefined)
      page = await sendToTab<PingReply>(t.id, { type: 'ping' })
    }
    state = { tab: { id: t.id, windowId: t.windowId, url: t.url ?? '', origin, connected: Boolean(page), page }, enabled: on }
  }
  listeners.forEach((l) => l())
}

const onActivated = () => void refresh()
const onUpdated = (_id: number, info: { status?: string }) => {
  if (info.status === 'complete') void refresh()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    void refresh()
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
    }
  }
}

/** Ask for access to this site, remember it, and start the script. Runs from a click, which the permission prompt needs. */
async function enable(origin: string | null) {
  if (!origin) return false
  const pattern = `${origin}/*`
  const granted = await chrome.permissions.request({ origins: [pattern] })
  if (!granted) return false
  const sites = await enabledSites()
  await chrome.storage.local.set({ sites: [...new Set([...sites, pattern])] })
  await chrome.runtime.sendMessage({ type: 'syncScripts' })
  await refresh()
  return true
}

export function useTab(onMessage: (m: FromContent) => void) {
  const { tab, enabled } = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [onMessage])
  return { tab, enabled, enable: () => enable(tab?.origin ?? null) }
}
