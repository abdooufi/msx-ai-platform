import ChatWidget from '../components/chat/ChatWidget'

/**
 * Public homepage — fullscreen chat interface.
 * Embed the widget on any page by using <ChatWidget mode="widget" />
 */
export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-950 flex flex-col">
      {/* Hero header */}
      <header className="bg-gradient-to-r from-blue-950 to-gray-900 border-b border-blue-900/40 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <div>
              <h1 className="text-white font-bold text-lg">MSX AI Assistant</h1>
              <p className="text-blue-300 text-xs">Muscat Stock Exchange · مساعد ذكي</p>
            </div>
          </div>
          <a
            href="/admin"
            className="text-sm text-blue-400 hover:text-blue-300 border border-blue-800 px-3 py-1.5 rounded-lg transition"
          >
            Admin →
          </a>
        </div>
      </header>

      {/* Fullscreen chat */}
      <div className="flex-1 max-w-3xl mx-auto w-full py-6 px-4">
        <ChatWidget mode="embedded" />
      </div>
    </main>
  )
}
