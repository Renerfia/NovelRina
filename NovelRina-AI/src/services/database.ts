import { supabase } from './supabase'
import type { Chapter, Novel } from '../types'

const novelFields = 'novel_id, novel_name, description, author_id'
const chapterFields = 'chapter_id, novel_id, chapter_name, chapter_content, chapter_content_summary'

export interface NovelRecord {
  novel_id: string
  novel_name: string
  description: string | null
  author_id: string
}

export interface ChapterRecord {
  chapter_id: string
  novel_id: string
  chapter_name: string
  chapter_content: string
  chapter_content_summary: string | null
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export function toNovel(
  record: NovelRecord,
  records: ChapterRecord[] = [],
  embeddedIds: ReadonlySet<string> = new Set(),
): Novel {
  return {
    id: record.novel_id,
    title: record.novel_name,
    description: record.description ?? '',
    createdAt: new Date().toISOString(),
    chapters: records.map((chapter) =>
      toChapter(chapter, embeddedIds.has(chapter.chapter_id)),
    ),
  }
}

export function toChapter(record: ChapterRecord, memoryIndexed = false): Chapter {
  return {
    id: record.chapter_id,
    title: record.chapter_name,
    content: record.chapter_content,
    summary: record.chapter_content_summary ?? '',
    memoryIndexed,
    updatedAt: new Date().toISOString(),
  }
}

export async function fetchNovels(authorId: string): Promise<NovelRecord[]> {
  const { data, error } = await requireSupabase()
    .from('novels')
    .select(novelFields)
    .eq('author_id', authorId)
    .order('novel_name')
  if (error) throw error
  return data
}

export async function fetchChapters(novelIds: string[]): Promise<ChapterRecord[]> {
  if (novelIds.length === 0) return []
  const { data, error } = await requireSupabase()
    .from('chapters')
    .select(chapterFields)
    .in('novel_id', novelIds)
  if (error) throw error
  return data
}

export async function fetchEmbeddedChapterIds(novelIds: string[]): Promise<string[]> {
  if (novelIds.length === 0) return []
  const { data, error } = await requireSupabase()
    .from('chapters')
    .select('chapter_id')
    .in('novel_id', novelIds)
    .not('chapter_content_embedding', 'is', null)
  if (error) throw error
  return data.map(({ chapter_id }) => chapter_id)
}

export async function saveChapterEmbedding(
  novelId: string,
  chapterId: string,
  embedding: number[],
): Promise<void> {
  const { data, error } = await requireSupabase()
    .from('chapters')
    .update({ chapter_content_embedding: embedding })
    .eq('novel_id', novelId)
    .eq('chapter_id', chapterId)
    .select('chapter_id')
  if (error) throw error
  if (!data.length) throw new Error('Chapter not found or embedding update was blocked by row-level security.')
}

export async function searchNovelMemory(
  userId: string,
  novelId: string,
  queryEmbedding: number[],
): Promise<Array<{ content: string; similarity: number }>> {
  const { data, error } = await requireSupabase().rpc('match_chapters_novelrina', {
    query_embedding: queryEmbedding,
    match_count: 3,
    filter_novel_id: novelId,
    filter_user_id: userId,
  })
  if (error) throw error
  return data.map(({ chapter_content, similarity }) => ({
    content: chapter_content,
    similarity,
  }))
}

export async function createNovel(
  authorId: string,
  title: string,
  description: string,
): Promise<NovelRecord> {
  const { data, error } = await requireSupabase()
    .from('novels')
    .insert({ novel_name: title, description, author_id: authorId })
    .select(novelFields)
    .single()
  if (error) throw error
  return data
}

export async function updateNovel(
  authorId: string,
  novelId: string,
  title: string,
  description: string,
): Promise<NovelRecord> {
  const { data, error } = await requireSupabase()
    .from('novels')
    .update({ novel_name: title, description })
    .eq('author_id', authorId)
    .eq('novel_id', novelId)
    .select(novelFields)
    .single()
  if (error) throw error
  return data
}

export async function deleteNovel(authorId: string, novelId: string) {
  const { data, error } = await requireSupabase()
    .from('novels')
    .delete()
    .eq('author_id', authorId)
    .eq('novel_id', novelId)
    .select('novel_id')
    .single()
  if (error) throw error
  if (!data) throw new Error('Novel not found or you do not have permission to delete it.')
}

export async function createChapter(
  novelId: string,
  title: string,
  content: string,
): Promise<ChapterRecord> {
  const { data, error } = await requireSupabase()
    .from('chapters')
    .insert({ novel_id: novelId, chapter_name: title, chapter_content: content })
    .select(chapterFields)
    .single()
  if (error) throw error
  return data
}

export async function updateChapter(
  novelId: string,
  chapterId: string,
  title: string,
  content: string,
  invalidateMemory: boolean,
): Promise<ChapterRecord> {
  const updates = invalidateMemory
    ? {
        chapter_name: title,
        chapter_content: content,
        chapter_content_summary: null,
        chapter_content_embedding: null,
      }
    : { chapter_name: title, chapter_content: content }
  const { data, error } = await requireSupabase()
    .from('chapters')
    .update(updates)
    .eq('novel_id', novelId)
    .eq('chapter_id', chapterId)
    .select(chapterFields)
    .single()
  if (error) throw error
  return data
}

export async function updateChapterSummary(
  novelId: string,
  chapterId: string,
  summary: string,
): Promise<ChapterRecord> {
  const { data, error } = await requireSupabase()
    .from('chapters')
    .update({ chapter_content_summary: summary, chapter_content_embedding: null })
    .eq('novel_id', novelId)
    .eq('chapter_id', chapterId)
    .select(chapterFields)
    .single()
  if (error) throw error
  return data
}

export async function deleteChapter(novelId: string, chapterId: string) {
  const { data, error } = await requireSupabase()
    .from('chapters')
    .delete()
    .eq('novel_id', novelId)
    .eq('chapter_id', chapterId)
    .select('chapter_id')
    .single()
  if (error) throw error
  if (!data) throw new Error('Chapter not found or it does not belong to this novel.')
}
