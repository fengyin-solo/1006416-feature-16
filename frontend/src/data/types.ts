/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

/** 唯一性规则：scopeField 相同的记录之间，fields 组合不许重号。 */
export type UniqueRule = {
  fields: string[]
  scopeField?: string
  label?: string
}

/** 同一台设备只允许存在一条未完结记录，防止重复登记堆在待办里。 */
export type SingleActiveRule = {
  scopeField: string
  activeStatuses: string[]
}

/** 动作前置条件：只允许从 allowFrom 列出的状态执行，requiredFields 缺一个都挡住。 */
export type ActionGuard = {
  allowFrom?: string[]
  requiredFields?: string[]
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 登记时必填的字段，缺了先挡回。 */
  requiredFields?: string[]
  /** 重号校验规则。 */
  uniqueRules?: UniqueRule[]
  /** 同一业务对象只保留一条进行中记录的规则。 */
  singleActive?: SingleActiveRule
  /** 业务日期字段（页面按它圈本周计划）。 */
  dateField?: string
  /** 与 status 同步镜像的状态列字段，保证列表与详情口径一致。 */
  statusMirrorField?: string
  /** 终态：落到这些状态后不再算待办。 */
  terminalStatuses?: string[]
  /** 异常态：落到这些状态会在看板上标异常。 */
  abnormalStatuses?: string[]
  /** 每个动作的前置状态与必填项。 */
  actionGuards?: Record<string, ActionGuard>
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
