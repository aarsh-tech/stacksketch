import type { SendRequest, SendResult } from './types'

/**
 * How the workbench page talks to the browser extension. The extension's
 * bridge script runs in the page and relays these with `window.postMessage`;
 * its service worker sends the request, where CORS doesn't apply.
 */

export const FROM_APP = 'stacksketch-app'
export const FROM_EXTENSION = 'stacksketch-extension'

export type AppToExtension =
  | { source: typeof FROM_APP; id: string; type: 'ping' }
  | { source: typeof FROM_APP; id: string; type: 'send'; request: SendRequest }
  /** open the extension's prompt to allow requests to this origin */
  | { source: typeof FROM_APP; id: string; type: 'grant'; origin: string }

export type ExtensionToApp =
  /** sent when the bridge loads, so the app knows without asking */
  | { source: typeof FROM_EXTENSION; type: 'ready'; version: string }
  | { source: typeof FROM_EXTENSION; id: string; type: 'pong'; version: string }
  | { source: typeof FROM_EXTENSION; id: string; type: 'result'; result: SendResult }
  /** the person answered the prompt to allow an origin */
  | { source: typeof FROM_EXTENSION; type: 'granted'; origin: string; granted: boolean }

export const isFromApp = (data: unknown): data is AppToExtension => typeof data === 'object' && data !== null && (data as { source?: unknown }).source === FROM_APP
export const isFromExtension = (data: unknown): data is ExtensionToApp =>
  typeof data === 'object' && data !== null && (data as { source?: unknown }).source === FROM_EXTENSION
