import { ref } from 'vue'
import type { ChatMessage } from '../types'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const TEXT_MODEL = 'gemini-2.5-flash'
const EMBEDDING_MODEL = 'gemini-embedding-2'

export const geminiApiKey = ref('')
export const hasGeminiApiKey = ref(false)

export function setGeminiApiKey(value: string) {
  geminiApiKey.value = value.trim()
  hasGeminiApiKey.value = Boolean(geminiApiKey.value)
}

function requireGeminiApiKey() {
  if (!geminiApiKey.value) {
    throw new Error('Add your Google AI Studio API key in account settings to use AI features.')
  }
  return geminiApiKey.value
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  error?: { message?: string }
}

async function callGemini<T>(
  model: string,
  operation: 'generateContent' | 'embedContent',
  body: unknown,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/models/${model}:${operation}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': requireGeminiApiKey(),
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'Could not reach the Google AI API. Check your connection and whether your key allows browser requests.',
      )
    }
    throw error
  }

  const result: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      result &&
      typeof result === 'object' &&
      'error' in result &&
      result.error &&
      typeof result.error === 'object' &&
      'message' in result.error &&
      typeof result.error.message === 'string'
        ? result.error.message
        : `Google AI request failed (${response.status}).`
    throw new Error(detail)
  }
  if (!result || typeof result !== 'object') {
    throw new Error('Google AI returned an invalid response.')
  }
  return result as T
}

function getGeneratedText(result: GeminiResponse) {
  const text = result.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim()
  if (!text) throw new Error('Google AI returned an empty response. Please try again.')
  return text
}

export async function generateChapterSummary(chapterContent: string): Promise<string> {
  if (!chapterContent.trim()) throw new Error('Write some chapter content before summarizing.')
  const result = await callGemini<GeminiResponse>(TEXT_MODEL, 'generateContent', {
    systemInstruction: {
      parts: [
        {
          text: 'You summarize novel chapters for future story retrieval. Write a faithful summary in 100-200 words, preserving important characters, events, places, and details. Do not invent facts.',
        },
      ],
    },
    contents: [{ role: 'user', parts: [{ text: chapterContent }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
  })
  return getGeneratedText(result)
}

export async function embedText(text: string): Promise<number[]> {
  if (!text.trim()) throw new Error('Text is required to create an embedding.')
  const result = await callGemini<{
    embedding?: { values?: number[] }
  }>(EMBEDDING_MODEL, 'embedContent', {
    content: { parts: [{ text: text.trim() }] },
    outputDimensionality: 768,
  })
  const values = result.embedding?.values
  if (!values?.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Google AI returned an invalid chapter embedding.')
  }
  return values
}

export async function askNovel(
  query: string,
  relevantMemories: Array<{ content: string; similarity: number }>,
  history: ChatMessage[],
): Promise<string> {
  const memoryContext = relevantMemories.length
    ? relevantMemories
        .map(
          (memory, index) =>
            `[Story passage ${index + 1}; similarity ${memory.similarity.toFixed(3)}]\n${memory.content}`,
        )
        .join('\n\n')
    : 'No relevant chapter passages were found in this novel.'
  const recentHistory = history
    .slice(-5)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n')
  const prompt = [
    'Answer the writer using only the supplied novel passages. Do not invent story facts. If the passages do not answer the question, say you do not know based on the saved chapters.',
    `Relevant novel passages:\n${memoryContext}`,
    recentHistory ? `Recent conversation:\n${recentHistory}` : '',
    `Writer question: ${query}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const result = await callGemini<GeminiResponse>(TEXT_MODEL, 'generateContent', {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
  })
  return getGeneratedText(result)
}
