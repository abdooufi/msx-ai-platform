'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ChatWidget from '../../components/chat/ChatWidget'
import { useChatStore } from '../../lib/store'
import { useEffect } from 'react'

/**
 * /embed — bare iframe page for the embeddable widget.
 * Loaded by widget.js inside an <iframe>.
 * No header, no nav, transparent background — just the chat.
 */
function EmbedInner() {
  const params   = useSearchParams()
  const lang     = params.get('lang') === 'ar' ? 'ar' : 'en'
  const setLang  = useChatStore(s => s.setLanguage)

  useEffect(() => { setLang(lang as 'en' | 'ar') }, [lang, setLang])

  return (
    <div
      style={{
        width: '100%',
        height: '100dvh',
        overflow: 'hidden',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ChatWidget mode="embedded" />
    </div>
  )
}

export default function EmbedPage() {
  return (
    <Suspense>
      <EmbedInner />
    </Suspense>
  )
}
