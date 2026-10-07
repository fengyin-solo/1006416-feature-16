import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function fieldLabel(meta: ModuleMeta, field: string): string {
  // 点检人员这一列对应的是岗位安排，提示里直接点明「岗位」。
  if (meta.key === 'equipcheck' && field === '点检人员') {
    return '点检岗位（点检人员）'
  }
  return field
}

/**
 * 登记一条记录。所有硬校验都在这一层挡回：
 * 必填项缺失（尤其点检岗位）、同设备点检编号重号、同设备重复登记。
 */
export function createEntry(key: string, draft: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  const values: Record<string, string> = {}
  for (const field of meta.fields) {
    values[field] = (draft[field] ?? '').trim()
  }

  // 1) 必填项：缺一个都说明不了怎么点检，先挡回去并指出少了哪个岗位/字段。
  for (const field of meta.requiredFields ?? []) {
    if (isBlank(values[field])) {
      return { ok: false, message: `无法登记：${fieldLabel(meta, field)}还没安排，请补齐后再提交` }
    }
  }

  const rows = listRows(key)

  // 2) 重号：同一台设备的点检编号不能重号，重号先挡回。
  for (const rule of meta.uniqueRules ?? []) {
    const duplicated = rows.find((row) =>
      rule.fields.every((field) => String(row[field] ?? '').trim() === values[field]) &&
      (rule.scopeField ? String(row[rule.scopeField] ?? '').trim() === values[rule.scopeField] : true),
    )
    if (duplicated) {
      const scope = rule.scopeField ? `${values[rule.scopeField]}` : meta.entity
      const label = rule.label ?? rule.fields.join('、')
      return {
        ok: false,
        message: `无法登记：设备「${scope}」的${label}「${values[rule.fields[0]]}」已经存在，同一台设备不能重号`,
      }
    }
  }

  // 3) 重复登记：同一台设备有未完结记录时只留一条，先把旧的处理完再登记。
  if (meta.singleActive) {
    const { scopeField, activeStatuses } = meta.singleActive
    const repeated = rows.find(
      (row) =>
        String(row[scopeField] ?? '').trim() === values[scopeField] &&
        activeStatuses.includes(String(row.status)),
    )
    if (repeated) {
      return {
        ok: false,
        message: `无法登记：设备「${values[scopeField]}」已有一条${repeated.status}的点检记录（${String(
          repeated[meta.fields[0]] ?? '',
        )}），同一台设备只保留一条进行中的记录，请先处理或关闭它`,
      }
    }
  }

  const initialStatus = meta.statuses[0]
  const row: EntryRow = {
    id: nextId(rows),
    ...values,
    status: initialStatus,
    pending: !(meta.terminalStatuses ?? [meta.statuses[meta.statuses.length - 1]]).includes(initialStatus),
    abnormal: (meta.abnormalStatuses ?? []).includes(initialStatus),
  }
  if (meta.statusMirrorField) {
    row[meta.statusMirrorField] = initialStatus
  }
  saveRows(key, [...rows, row])
  return { ok: true, message: `${meta.entity}已登记，当前状态「${initialStatus}」` }
}

/** 判定为需维修的点检，要落进设备检修的「待安排」清单；同一台设备只生成一条。 */
function pushRepairToOverhaul(row: EntryRow, meta: ModuleMeta): string {
  if (meta.key !== 'equipcheck') {
    return ''
  }
  const overhaulKey = 'overhaul'
  const overhaul = MODULE_BY_KEY.get(overhaulKey)
  if (!overhaul) {
    return ''
  }
  const checks = listRows(overhaulKey)
  const sourceCode = String(row['点检编号'] ?? '')
  const device = String(row['点检设备'] ?? '')
  const exists = checks.some(
    (item) =>
      String(item['来源点检编号'] ?? '') === sourceCode ||
      (String(item['检修设备'] ?? '') === device &&
        String(item.status) !== '已完工' &&
        String(item.status) !== '已延期'),
  )
  if (exists) {
    return '该设备已在设备检修待安排清单中，不重复生成'
  }
  const initialStatus = overhaul.statuses[0]
  const repairRow: EntryRow = {
    id: nextId(checks),
    status: initialStatus,
    pending: true,
    abnormal: false,
    检修编号: `WX-${sourceCode.replace(/[^A-Za-z0-9]/g, '')}`,
    检修设备: device,
    检修类别: '故障检修',
    检修班组: '',
    计划工期: '待安排',
    完工日期: '',
    更换备件: '待确认',
    检修状态: initialStatus,
    来源点检编号: sourceCode,
  }
  saveRows(overhaulKey, [...checks, repairRow])
  return `已生成检修任务「${repairRow.检修编号 as string}」并进入设备检修待安排清单`
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  const guard = meta.actionGuards?.[action]

  // 状态分步推进：只允许从 guard.allowFrom 列出的状态执行，跨状态直接挡住。
  if (guard?.allowFrom && !guard.allowFrom.includes(current)) {
    const from = guard.allowFrom.join('、')
    return {
      ok: false,
      message: `无法${action}：当前状态为「${current}」，需先处于「${from}」。点检状态只能按 待点检 → 点检中 → 状态正常/需维修 依次推进，不能跨步骤操作`,
    }
  }

  // 前置必填项：没排点检岗位、部位或方法空着的，提交点检时挡回。
  for (const field of guard?.requiredFields ?? []) {
    if (isBlank(rows[index][field])) {
      return { ok: false, message: `无法${action}：${fieldLabel(meta, field)}还没安排，补齐排班后再提交` }
    }
  }

  const terminals = meta.terminalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !terminals.includes(target),
    abnormal:
      (meta.abnormalStatuses?.includes(target) ?? false) ||
      NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 同步镜像状态列：列表与详情读到的永远是同一个状态口径。
  if (meta.statusMirrorField) {
    updated[meta.statusMirrorField] = target
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  const extras = pushRepairToOverhaul(updated, meta)
  const tail = extras ? `；${extras}` : ''
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${tail}` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = listRows(meta.key)
    const terminals = meta.terminalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => !terminals.includes(String(row.status))).length,
      abnormal: entries.filter(
        (row) =>
          (meta.abnormalStatuses?.includes(String(row.status)) ?? false) || row.abnormal === true,
      ).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
