import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'react-hot-toast'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'MSX AI Assistant',
  description: 'AI-powered assistant for Muscat Stock Exchange',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: { background: '#1e2030', color: '#e2e8f0', border: '1px solid #2d3250' },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
