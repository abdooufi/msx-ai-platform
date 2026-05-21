export interface ChartPoint {
  time: string
  ltp: number
  shares: number
  turnover: number
}

export interface ChartSummary {
  open: number
  high: number
  low: number
  last: number
  latestTime: string
  totalShares: number
  totalTurnover: number
  tradesCount: number
}

export interface ChartData {
  symbol: string
  summary: ChartSummary
  points: ChartPoint[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  language?: string
  sources?: Source[]
  confidenceScore?: number
  tokensUsed?: number
  latencyMs?: number
  feedback?: 'positive' | 'negative' | null
  isStreaming?: boolean
  chartData?: ChartData
  createdAt: Date
}

export interface Source {
  title: string
  url: string
  content: string
  score: number
  type: 'website' | 'document' | 'database' | string
}

export interface Conversation {
  _id: string
  sessionId: string
  language: string
  channel: string
  messages: Message[]
  messageCount: number
  lastMessage: string
  createdAt: string
}

export interface DashboardStats {
  conversations: number
  messages: number
  failed: number
  successRate: number
  feedback: { positive: number; negative: number }
  avgLatencyMs: number
  ragStats: { qdrantVectors: number; pgDocuments: number }
  langBreakdown: Record<string, number>
  dailyMessages: Array<{ _id: string; count: number }>
}

export interface UploadedDoc {
  _id: string
  originalName: string
  mimeType: string
  sizeBytes: number
  status: 'pending' | 'processing' | 'indexed' | 'failed'
  chunksIndexed: number
  tags: string[]
  createdAt: string
}

export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'agent' | 'user'
}

export interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
}
