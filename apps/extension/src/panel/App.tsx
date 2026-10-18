import { useCallback, useEffect, useRef, useState } from 'react'
import { PlugZap } from 'lucide-react'

import { Button, Tabs } from '@/components/ui/primitives'
import type { FromContent, Inspected, OverlayState, PinnedComment, ScanReply, Tool } from '../messages'
import { CommentsPanel, MeasurePanel, OverlayPanel } from './Qa'
import { StackingPanel } from '@/modules/stacking/StackingPanel'
import { sendToTab, useTab } from './tab'

type Panel = 'overlay' | 'measure' | 'comments' | 'stacking'

export function App() {
  const [panel, setPanel] = useState<Panel>('overlay')
  const [overlay, setOverlayState] = useState<OverlayState | null>(null)
  const [tool, setToolState] = useState<Tool>('none')
  const [inspected, setInspected] = useState<Inspected | null>(null)
  const [comments, setCommentsState] = useState<PinnedComment[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [scan, setScan] = useState<ScanReply | null>(null)
  const [error, setError] = useState<string | null>(null)
  // the message handler is registered once, so it reads the latest values from refs
  const latest = useRef({ comments, tabId: 0, windowId: 0 })

  const onMessage = useCallback((m: FromContent) => {
    if (m.type === 'nudged') setOverlayState((o) => (o ? { ...o, x: m.x, y: m.y } : o))
    else if (m.type === 'locked') setOverlayState((o) => (o ? { ...o, lockedTo: m.selector } : o))
    else if (m.type === 'inspected') setInspected(m.inspected)
    else if (m.type === 'toolDone') setToolState('none')
    else if (m.type === 'commentAt') {
      const { comments: list, tabId, windowId } = latest.current
      const comment: PinnedComment = { n: (list.at(-1)?.n ?? 0) + 1, text: '', x: m.x, y: m.y, selector: m.selector }
      const next = [...list, comment]
      setCommentsState(next)
      // draw the pin, then keep a screenshot of the page with it on
      void sendToTab(tabId, { type: 'comments', comments: next }).then(() =>
        setTimeout(() => {
          chrome.tabs
            .captureVisibleTab(windowId, { format: 'png' })
            .then((shot) => setCommentsState((all) => all.map((c) => (c.n === comment.n ? { ...c, screenshot: shot } : c))))
            .catch(() => undefined)
        }, 120),
      )
    }
  }, [])

  const { tab, enabled, enable } = useTab(onMessage)

  useEffect(() => {
    latest.current = { comments, tabId: tab?.id ?? 0, windowId: tab?.windowId ?? 0 }
  }, [comments, tab])

  const tell = (m: Parameters<typeof sendToTab>[1]) => tab && void sendToTab(tab.id, m)
  const setOverlay = (o: OverlayState | null) => {
    setOverlayState(o)
    tell({ type: 'overlay', overlay: o })
  }
  const setTool = (t: Tool) => {
    setToolState(t)
    tell({ type: 'tool', tool: t })
  }
  const setComments = (c: PinnedComment[]) => {
    setCommentsState(c)
    tell({ type: 'comments', comments: c })
  }
  const runScan = async () => {
    if (!tab) return
    const r = await sendToTab<ScanReply>(tab.id, { type: 'scan' })
    if (r) setScan(r)
    else setError('The page didn’t answer. Reload it and try again.')
  }

  if (!tab || !tab.connected)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <PlugZap size={22} className="text-ink-3" />
        {!tab?.origin ? (
          <p className="text-[13px] text-ink-2">Open a web page to check it. Stacksketch can’t run on browser pages like this one.</p>
        ) : enabled ? (
          <p className="text-[13px] text-ink-2">Reload the page to start Stacksketch on it.</p>
        ) : (
          <>
            <p className="text-[13px] text-ink-2">
              Stacksketch runs on <span className="font-mono">localhost</span> by default. Turn it on for <span className="font-mono">{new URL(tab.origin).host}</span> to check this page too.
            </p>
            <Button variant="primary" onClick={() => void enable()}>
              Turn on for {new URL(tab.origin).host}
            </Button>
            <p className="text-[12px] text-ink-3">Nothing leaves your browser: images, comments and reports stay here.</p>
          </>
        )}
      </div>
    )

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-panel px-1.5">
        <div className="flex items-center gap-2 px-2 pt-2 text-[12px] text-ink-3">
          <span className="font-semibold text-ink">Stacksketch</span>
          <span className="min-w-0 flex-1 truncate font-mono" title={tab.url}>
            {new URL(tab.url).host}
          </span>
        </div>
        <Tabs
          label="Tool"
          value={panel}
          onChange={setPanel}
          options={[
            { value: 'overlay', label: 'Overlay' },
            { value: 'measure', label: 'Measure' },
            { value: 'comments', label: comments.length ? `Comments (${comments.length})` : 'Comments' },
            { value: 'stacking', label: 'Stacking' },
          ]}
        />
      </header>
      {error ? (
        <p role="alert" className="mx-4 mt-3 text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
      <main className="flex-1">
        {panel === 'overlay' ? <OverlayPanel overlay={overlay} setOverlay={setOverlay} tool={tool} setTool={setTool} /> : null}
        {panel === 'measure' ? <MeasurePanel tool={tool} setTool={setTool} inspected={inspected} notes={notes} setNotes={setNotes} /> : null}
        {panel === 'comments' ? <CommentsPanel tab={tab} tool={tool} setTool={setTool} comments={comments} setComments={setComments} notes={notes} overlay={overlay} /> : null}
        {panel === 'stacking' ? <StackingPanel scan={scan} onScan={() => void runScan()} onHighlight={(index) => tell({ type: 'highlight', index })} /> : null}
      </main>
    </div>
  )
}
