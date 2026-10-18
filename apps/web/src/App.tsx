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
const ContractDesigner = lazy(() => import('@/modules/contract/ContractDesigner'))
const ApiClient = lazy(() => import('@/modules/api-client/ApiClient'))
const DbCode = lazy(() => import('@/modules/db-code/DbCode'))
const Flows = lazy(() => import('@/modules/flows/Flows'))
const MockServer = lazy(() => import('@/modules/mock-server/MockServer'))
const QaOverlay = lazy(() => import('@/modules/qa-overlay/QaOverlay'))
const Stacking = lazy(() => import('@/modules/stacking/Stacking'))
// sucrase, which compiles the pasted component, loads when this opens
const Variants = lazy(() => import('@/modules/variants/Variants'))

const LAZY = { 'form-builder': FormBuilder, contract: ContractDesigner, 'api-client': ApiClient, 'db-code': DbCode, flows: Flows, 'mock-server': MockServer, 'qa-overlay': QaOverlay, stacking: Stacking, variants: Variants } as const

function CurrentModule() {
  const module = useUi((s) => moduleById(s.module))
  if (module.id === 'api-explorer') return <ApiExplorer />
  if (module.id in LAZY) {
    const Module = LAZY[module.id as keyof typeof LAZY]
    return (
      <Suspense fallback={<div className="paper-grid h-full" />}>
        <Module />
      </Suspense>
    )
  }
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
