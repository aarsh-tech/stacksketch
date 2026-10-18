import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@codemirror/view'

import { useResolvedTheme } from '@/hooks/useTheme'
import { highlight } from '@/lib/codemirror'

/** Read-only, highlighted code. */
export function CodeView({ code, lang, label }: { code: string; lang: 'ts' | 'json'; label: string }) {
  const theme = useResolvedTheme()
  const extensions = useMemo(
    () => [lang === 'ts' ? javascript({ typescript: true }) : json(), highlight, EditorView.editorAttributes.of({ class: 'cm-readonly' }), EditorView.contentAttributes.of({ 'aria-label': label })],
    [lang, label],
  )
  return (
    <CodeMirror
      value={code}
      height="100%"
      className="h-full"
      theme={theme}
      editable={false}
      readOnly
      extensions={extensions}
      basicSetup={{ highlightActiveLine: false, highlightActiveLineGutter: false, foldGutter: true, searchKeymap: true }}
    />
  )
}
