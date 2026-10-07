import { listRows, readRowsStrict, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 设备点检的专用规则都收在这里：排班拦截、编号查重、状态机、需维修转检修。
export const CHECK_KEY = 'equipcheck'
export const PLAN_KEY = 'equipcheckPlans'
export const OVERHAUL_KEY = 'overhaul'

// 每条计划必须排上的岗位；缺了就挡回去，提示里点名这个岗位。
export const REQUIRED_ROLE = '点检员'

// 状态只许 待点检 → 点检中 → 状态正常 依次推进；需维修是点检中的判定分支。
const FLOW: Record<string, { from: string[]; to: string }> = {
  提交点检: { from: ['待点检'], to: '点检中' },
  判定正常: { from: ['点检中'], to: '状态正常' },
  提出维修: { from: ['点检中'], to: '需维修' },
}
const TERMINAL = ['状态正常', '需维修']

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextNo(rows: EntryRow[], field: string, prefix: string): string {
  const max = rows.reduce((acc, row) => {
    const match = text(row, field).match(/(\d+)$/)
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

// ---------- 周工具 ----------

export type WeekRange = { start: Date; end: Date; label: string }

export function fmtDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function weekRange(offset: number): WeekRange {
  const now = new Date()
  const day = (now.getDay() + 6) % 7
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + offset * 7)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  return { start, end, label: `${fmtDate(start)} ~ ${fmtDate(end)}` }
}

export function inWeek(dateText: string, week: WeekRange): boolean {
  return dateText >= fmtDate(week.start) && dateText <= fmtDate(week.end)
}

// ---------- 读取 ----------

export type CheckPageData = {
  entries: EntryRow[]
  plans: EntryRow[]
  cleaned: number
}

// 同一台设备同一个点检编号只留一条，先登记的留下。
function dedupeEntries(rows: EntryRow[]): { rows: EntryRow[]; removed: number } {
  const seen = new Set<string>()
  const kept: EntryRow[] = []
  for (const row of rows) {
    const key = `${text(row, '点检设备')}::${text(row, '点检编号')}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    kept.push(row)
  }
  return { rows: kept, removed: rows.length - kept.length }
}

// 拉数走严读：读到一半断掉会抛错，页面接住后提示并允许重拉。
export function loadCheckPageData(): CheckPageData {
  const entries = readRowsStrict(CHECK_KEY)
  const plans = readRowsStrict(PLAN_KEY)
  const { rows, removed } = dedupeEntries(entries)
  if (removed > 0) {
    saveRows(CHECK_KEY, rows)
  }
  return { entries: rows, plans, cleaned: removed }
}

export function resetCheckData(): void {
  resetRows(CHECK_KEY)
  resetRows(PLAN_KEY)
}

export function suggestCheckNo(): string {
  return nextNo(listRows(CHECK_KEY), '点检编号', 'EQUI')
}

// ---------- 点检计划（排班） ----------

export type PlanInput = {
  点检设备: string
  计划日期: string
  点检部位: string
  点检方法: string
  点检人员: string
}

export function createCheckPlan(input: PlanInput): ActionResult {
  const missing: string[] = []
  if (!input.点检设备.trim()) missing.push('点检设备')
  if (!input.计划日期.trim()) missing.push('计划日期')
  if (!input.点检部位.trim()) missing.push('点检部位')
  if (!input.点检方法.trim()) missing.push('点检方法')
  if (missing.length > 0) {
    return { ok: false, message: `请先补齐：${missing.join('、')}` }
  }
  const plans = listRows(PLAN_KEY)
  const inspector = input.点检人员.trim()
  const plan: EntryRow = {
    id: nextId(plans),
    status: inspector ? '已排班' : '待排班',
    pending: !inspector,
    abnormal: false,
    计划日期: input.计划日期.trim(),
    点检设备: input.点检设备.trim(),
    点检部位: input.点检部位.trim(),
    点检方法: input.点检方法.trim(),
    点检人员: inspector,
    计划状态: inspector ? '已排班' : '待排班',
  }
  saveRows(PLAN_KEY, [...plans, plan])
  if (!inspector) {
    return {
      ok: true,
      message: `计划已登记，但还没排点检人（缺「${REQUIRED_ROLE}」岗位），已标成待排班，记得排班`,
    }
  }
  return { ok: true, message: `已登记「${plan.点检设备}」的点检计划并排好${REQUIRED_ROLE}` }
}

// 排班：写回计划，顺手把同设备还空着的点检记录补上人员、部位、方法。
export function assignPlanInspector(planId: number, inspector: string): ActionResult {
  const name = inspector.trim()
  if (!name) {
    return { ok: false, message: `请填写${REQUIRED_ROLE}姓名` }
  }
  const plans = listRows(PLAN_KEY)
  const index = plans.findIndex((plan) => Number(plan.id) === planId)
  if (index < 0) {
    return { ok: false, message: '没有找到这条点检计划' }
  }
  const plan = plans[index]
  const nextPlans = [...plans]
  nextPlans[index] = { ...plan, 点检人员: name, status: '已排班', pending: false, 计划状态: '已排班' }
  saveRows(PLAN_KEY, nextPlans)

  const entries = listRows(CHECK_KEY)
  let touched = 0
  const patched = entries.map((entry) => {
    if (text(entry, '点检设备') !== text(plan, '点检设备')) {
      return entry
    }
    const fill: Record<string, string> = {}
    if (!text(entry, '点检人员')) fill['点检人员'] = name
    if (!text(entry, '点检部位')) fill['点检部位'] = text(plan, '点检部位')
    if (!text(entry, '点检方法')) fill['点检方法'] = text(plan, '点检方法')
    if (Object.keys(fill).length === 0) {
      return entry
    }
    touched += 1
    return { ...entry, ...fill }
  })
  if (touched > 0) {
    saveRows(CHECK_KEY, patched)
  }
  const suffix = touched > 0 ? `，并补齐了 ${touched} 条待点检记录` : ''
  return { ok: true, message: `已为「${plan.点检设备}」排上${REQUIRED_ROLE}「${name}」${suffix}` }
}

// 按计划生成点检记录：没排点检人的计划先挡回去，同设备同日期只留一条。
export function generateEntryFromPlan(planId: number): ActionResult {
  const plans = listRows(PLAN_KEY)
  const plan = plans.find((item) => Number(item.id) === planId)
  if (!plan) {
    return { ok: false, message: '没有找到这条点检计划' }
  }
  const inspector = text(plan, '点检人员')
  if (!inspector) {
    return {
      ok: false,
      message: `「${plan.点检设备}」还没排点检人，缺少「${REQUIRED_ROLE}」岗位，请先排班再生成点检记录`,
    }
  }
  const entries = listRows(CHECK_KEY)
  const dup = entries.find(
    (entry) =>
      text(entry, '点检设备') === text(plan, '点检设备') &&
      text(entry, '点检日期') === text(plan, '计划日期') &&
      entry.status === '待点检',
  )
  if (dup) {
    return { ok: true, message: `「${plan.点检设备}」当天已有待点检记录，重复登记只留一条，未重复生成` }
  }
  const entry: EntryRow = {
    id: nextId(entries),
    status: '待点检',
    pending: true,
    abnormal: false,
    点检编号: nextNo(entries, '点检编号', 'EQUI'),
    点检设备: text(plan, '点检设备'),
    点检部位: text(plan, '点检部位'),
    点检方法: text(plan, '点检方法'),
    点检结果: '',
    点检人员: inspector,
    点检日期: text(plan, '计划日期'),
    点检状态: '待点检',
  }
  saveRows(CHECK_KEY, [...entries, entry])
  return { ok: true, message: `已按计划生成「${entry.点检设备}」的点检记录（${entry.点检编号}）` }
}

// ---------- 点检记录登记 ----------

export type CheckInput = {
  点检编号: string
  点检设备: string
  点检部位: string
  点检方法: string
  点检人员: string
  点检日期: string
  点检结果: string
}

export function registerCheckEntry(input: CheckInput): ActionResult {
  const missing: string[] = []
  if (!input.点检设备.trim()) missing.push('点检设备')
  if (!input.点检编号.trim()) missing.push('点检编号')
  if (!input.点检部位.trim()) missing.push('点检部位')
  if (!input.点检方法.trim()) missing.push('点检方法')
  if (!input.点检日期.trim()) missing.push('点检日期')
  if (missing.length > 0) {
    return { ok: false, message: `请先补齐：${missing.join('、')}` }
  }
  if (!input.点检人员.trim()) {
    return { ok: false, message: `未排点检人，缺少「${REQUIRED_ROLE}」岗位，请先排班再登记` }
  }
  const rows = listRows(CHECK_KEY)
  const dup = rows.find(
    (row) => text(row, '点检设备') === input.点检设备.trim() && text(row, '点检编号') === input.点检编号.trim(),
  )
  if (dup) {
    const same =
      text(dup, '点检部位') === input.点检部位.trim() &&
      text(dup, '点检方法') === input.点检方法.trim() &&
      text(dup, '点检人员') === input.点检人员.trim() &&
      text(dup, '点检日期') === input.点检日期.trim()
    if (same) {
      return { ok: true, message: `「${input.点检设备}」这条登记已存在，重复登记只留一条，未重复新增` }
    }
    return {
      ok: false,
      message: `点检编号「${input.点检编号}」在「${input.点检设备}」下已登记过，同一台设备编号不能重号，请更换点检编号`,
    }
  }
  const entry: EntryRow = {
    id: nextId(rows),
    status: '待点检',
    pending: true,
    abnormal: false,
    点检编号: input.点检编号.trim(),
    点检设备: input.点检设备.trim(),
    点检部位: input.点检部位.trim(),
    点检方法: input.点检方法.trim(),
    点检结果: input.点检结果.trim(),
    点检人员: input.点检人员.trim(),
    点检日期: input.点检日期.trim(),
    点检状态: '待点检',
  }
  saveRows(CHECK_KEY, [...rows, entry])
  return { ok: true, message: `已登记「${entry.点检设备}」的点检记录（${entry.点检编号}），当前状态「待点检」` }
}

// ---------- 状态流转 ----------

// 需维修的设备同步进设备检修的待安排清单（待开工），同一编号不重复转。
function syncOverhaul(row: EntryRow): string {
  const rows = listRows(OVERHAUL_KEY)
  const existing = rows.find((item) => text(item, '来源点检编号') === text(row, '点检编号'))
  if (existing) {
    return text(existing, '检修编号')
  }
  const no = nextNo(rows, '检修编号', 'OVER')
  const entry: EntryRow = {
    id: nextId(rows),
    status: '待开工',
    pending: true,
    abnormal: false,
    检修编号: no,
    检修设备: text(row, '点检设备'),
    检修类别: '点检维修',
    检修班组: '',
    计划工期: '',
    完工日期: '',
    更换备件: '',
    检修状态: '待安排',
    来源点检编号: text(row, '点检编号'),
  }
  saveRows(OVERHAUL_KEY, [...rows, entry])
  return no
}

export function runCheckAction(id: number, action: string): ActionResult {
  const flow = FLOW[action]
  if (!flow) {
    return { ok: false, message: `设备点检记录没有登记「${action}」这个动作` }
  }
  const rows = listRows(CHECK_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的设备点检记录` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (TERMINAL.includes(current)) {
    return { ok: false, message: `这条记录已办结（${current}），状态不再流转` }
  }
  if (!flow.from.includes(current)) {
    return {
      ok: false,
      message: `点检状态只许按「待点检 → 点检中 → 状态正常」依次推进，「${action}」要从「${flow.from.join('」或「')}」发起，当前是「${current}」，不能跨过中间步骤`,
    }
  }
  if (action === '提交点检') {
    const missing: string[] = []
    if (!text(row, '点检人员')) missing.push(`点检人（缺少「${REQUIRED_ROLE}」岗位）`)
    if (!text(row, '点检部位')) missing.push('点检部位')
    if (!text(row, '点检方法')) missing.push('点检方法')
    if (missing.length > 0) {
      return {
        ok: false,
        message: `「${row.点检设备}」还缺 ${missing.join('、')}，请先在点检计划里排班补齐，再提交点检`,
      }
    }
  }
  const updated: EntryRow = {
    ...row,
    status: flow.to,
    点检状态: flow.to,
    pending: flow.to !== '状态正常',
    点检结果: action === '判定正常' ? '正常' : action === '提出维修' ? '需维修' : row['点检结果'],
  }
  const next = [...rows]
  next[index] = updated
  saveRows(CHECK_KEY, next)
  if (action === '提出维修') {
    const overhaulNo = syncOverhaul(updated)
    return {
      ok: true,
      message: `已判定需维修，「${updated.点检设备}」已转入设备检修待安排清单（检修编号 ${overhaulNo}）`,
    }
  }
  return { ok: true, message: `设备点检记录已${action}，当前状态「${flow.to}」` }
}

// 详情里要交代这条需维修记录转到哪张检修单。
export function findLinkedOverhaul(checkNo: string): EntryRow | undefined {
  if (!checkNo.trim()) {
    return undefined
  }
  return listRows(OVERHAUL_KEY).find((row) => text(row, '来源点检编号') === checkNo.trim())
}
