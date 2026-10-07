import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 严读：页面拉数用。数据只读到一半（JSON 被截断）或结构不对时直接抛错，
// 调用方接住后给「重新拉取」的机会，而不是悄悄拿种子数据顶上、列表详情对不上。
export function readRowsStrict(key: string): EntryRow[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    // 没有本地存储可走时与 saveRows 共用同一份内存数据，保证读写一致。
    return allRows()[key] ?? []
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return clone(SEED_ROWS[key] ?? [])
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('本地数据只读到一半就断了，请重新拉取；反复失败可恢复示例数据')
  }
  const value = parsed[key]
  if (value === undefined || value === null) {
    return clone(SEED_ROWS[key] ?? [])
  }
  if (!Array.isArray(value)) {
    throw new Error(`「${key}」的数据结构不对，读取失败`)
  }
  value.forEach((row, index) => {
    const broken =
      !row ||
      typeof row !== 'object' ||
      typeof (row as EntryRow).id !== 'number' ||
      typeof (row as EntryRow).status !== 'string'
    if (broken) {
      throw new Error(`第 ${index + 1} 条记录损坏，读取中断`)
    }
  })
  return value as EntryRow[]
}

export function storageKey(): string {
  return STORAGE_KEY
}
