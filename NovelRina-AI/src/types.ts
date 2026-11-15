export interface Chapter {
  id: string
  title: string
  content: string
  summary: string
  memoryIndexed: boolean
  updatedAt: string
}

export interface Novel {
  id: string
  title: string
  description: string
  createdAt: string
  chapters: Chapter[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: string[]
}

export interface Workspace {
  novels: Novel[]
  chats: Record<string, ChatMessage[]>
}
