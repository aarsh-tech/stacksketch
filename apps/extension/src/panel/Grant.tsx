import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/primitives'

/**
 * The window the API client opens when a request goes to a host the
 * extension can't reach yet. Chrome only shows its permission prompt after a
 * click on an extension page, so this is that page.
 */
export function Grant({ origin }: { origin: string }) {
  const [state, setState] = useState<'asking' | 'denied'>('asking')
  const tab = Number(new URLSearchParams(location.search).get('tab')) || undefined
  let host = origin
  let pattern = ''
  try {
    const u = new URL(origin)
    host = u.host
    pattern = `${u.protocol}//${u.hostname}/*`
  } catch {
    // shown as it came
  }

  const tell = async (granted: boolean) => {
    if (tab) await chrome.tabs.sendMessage(tab, { type: 'apiGranted', origin, granted }).catch(() => undefined)
  }

  const allow = async () => {
    const granted = pattern ? await chrome.permissions.request({ origins: [pattern] }) : false
    await tell(granted)
    if (granted) window.close()
    else setState('denied')
  }

  const cancel = async () => {
    await tell(false)
    window.close()
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center gap-3 p-5">
      <ShieldCheck size={22} className="text-accent" />
      <h1 className="text-[15px] font-semibold">Send API requests to {host}?</h1>
      <p className="text-[13px] leading-relaxed text-ink-2">
        The Stacksketch API client wants to send requests to <span className="font-mono text-ink">{host}</span> through the extension, so CORS doesn’t get in the way. Chrome will ask you to confirm. Requests never carry your browser’s cookies for that site.
      </p>
      {state === 'denied' ? <p role="alert" className="text-[12.5px] text-danger">Not allowed. Click Allow again if you change your mind, or close this window.</p> : null}
      <div className="mt-1 flex gap-2">
        <Button variant="primary" onClick={() => void allow()}>
          Allow {host}
        </Button>
        <Button variant="outline" onClick={() => void cancel()}>
          Not now
        </Button>
      </div>
    </main>
  )
}
