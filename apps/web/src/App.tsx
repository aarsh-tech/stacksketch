import { Suspense, lazy } from 'react'
import { Toaster } from 'sonner'

import { Shell } from '@/components/Shell'
import { useApplyTheme } from '@/hooks/useTheme'
import { ApiExplorer } from '@/modules/api-explorer/ApiExplorer'
import { Planned } from '@/modules/Planned'
import { moduleById } from '@/modules/registry'
import { useUi } from '@/store/ui'

// drag and drop only loads when the form builder opens
const FormBuilder = lazy(() => import('@/modules/form-builder/FormBuilder'))

function CurrentModule() {
  const module = useUi((s) => moduleById(s.module))
  if (module.id === 'api-explorer') return <ApiExplorer />
  if (module.id === 'form-builder')
    return (
      <Suspense fallback={<div className="paper-grid h-full" />}>
        <FormBuilder />
      </Suspense>
    )
  return <Planned key={module.id} module={module} />
}

export function App() {
  const theme = useApplyTheme()
  return (
    <>
      <Shell>
        <CurrentModule />
      </Shell>
      <Toaster theme={theme} position="bottom-right" toastOptions={{ className: 'font-sans' }} />
    </>
  )
}
