import type { Rect } from '@stacksketch/core'

/** The design frame laid over the page. Positions are page pixels (they scroll with the page). */
export interface OverlayState {
  src: string
  name: string
  /** the image's own width in pixels; drawn at this width divided by `scale` (2 for a @2x export) */
  width: number
  scale: number
  opacity: number
  blend: 'normal' | 'difference'
  x: number
  y: number
  visible: boolean
  /** follow this element: x and y are then relative to its top left corner */
  lockedTo?: string
}

export type Tool = 'none' | 'measure' | 'comment' | 'lock'

export interface PinnedComment {
  n: number
  text: string
  x: number
  y: number
  selector?: string
  screenshot?: string
}

/** What the element under the pointer looks like, for the measure tool. */
export interface Inspected {
  selector: string
  rect: Rect
  fontSize: string
  lineHeight: string
  fontWeight: string
  letterSpacing: string
  fontFamily: string
  color: string
  /** the gap to the element picked first, in words */
  gap?: string
}

export type ToContent =
  | { type: 'ping' }
  | { type: 'overlay'; overlay: OverlayState | null }
  | { type: 'tool'; tool: Tool }
  | { type: 'comments'; comments: PinnedComment[] }
  | { type: 'scan' }
  | { type: 'highlight'; index: number | null }

export type FromContent =
  | { type: 'nudged'; x: number; y: number }
  | { type: 'locked'; selector: string }
  | { type: 'inspected'; inspected: Inspected }
  | { type: 'commentAt'; x: number; y: number; selector: string }
  | { type: 'toolDone' }

export interface PingReply {
  ok: true
  url: string
  title: string
  viewport: { width: number; height: number }
}

export type { StackScan as ScanReply } from '../../web/src/lib/stackingScan'

/** Sites the content script runs on by default: local dev servers on any port. */
export const DEFAULT_SITES = ['http://localhost/*', 'http://127.0.0.1/*']
