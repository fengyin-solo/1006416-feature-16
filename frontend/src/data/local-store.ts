import { SEED_ROWS, weekDate } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'

// 一次性的读故障开关：打开后下一次读取会像「读到一半断掉」一样抛错，
// 用来验证页面的失败提示与「重新拉取」；不写进 localStorage，刷新即恢复。
let failNextRead = false

export function armReadFailure(): void {
  failNextRead = true
}

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
  if (failNextRead) {
    // 模拟读取中断：绝不能只把半截数据塞进缓存，列表与详情都要等一次完整读取。
    failNextRead = false
    throw new Error('点检数据读取中断，数据只读到一半，请重新拉取一次')
  }
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

export function storageKey(): string {
  return STORAGE_KEY
}

// 示例日期统一落在本周，页面首次打开就能看到整周点检计划。
export { weekDate }
