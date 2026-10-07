<template>
  <section class="page" data-module="equipcheck">
    <header class="page-head">
      <div>
        <h2>设备点检管理</h2>
        <p class="page-desc">维护设备点检记录，围绕点检编号、点检设备、点检部位、点检方法做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记设备点检记录</button>
        <button class="btn" type="button" @click="simulateReadFailure">模拟拉数中断</button>
        <button class="btn" type="button" @click="exportRows">导出设备点检清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="loadError" class="load-failed" role="alert">
      <div>
        <strong>设备点检数据拉取失败</strong>
        <p>{{ loadError }}。列表与详情已暂停更新，请点「重新拉取」再试一次。</p>
      </div>
      <button class="btn primary" type="button" @click="reload">重新拉取</button>
    </div>

    <template v-else>
      <section class="week-plan">
        <h3 class="section-title">本周点检计划（{{ weekRange }}）</h3>
        <table v-if="weekRows.length" class="data-table">
          <thead>
            <tr>
              <th v-for="column in weekColumns" :key="column">{{ column }}</th>
              <th>点检岗位</th>
              <th>当前状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in weekRows" :key="`week-${String(row.id)}`">
              <td v-for="column in weekColumns" :key="column">{{ display(row, column) }}</td>
              <td>
                {{ row['点检人员'] || '未排班' }}
                <span v-if="!row['点检人员']" class="tag tag-warn">缺岗位</span>
              </td>
              <td><span :class="['tag', statusTagClass(row.status)]">{{ row.status }}</span></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-panel">本周（{{ weekRange }}）暂无点检计划，请先登记设备点检记录并排定点检岗位。</div>
      </section>

      <section class="record-list">
        <h3 class="section-title">全部点检记录</h3>
        <table v-if="rows.length" class="data-table">
          <thead>
            <tr>
              <th v-for="column in tableColumns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="String(row.id)">
              <td v-for="column in tableColumns" :key="column">{{ display(row, column) }}</td>
              <td><span :class="['tag', statusTagClass(row.status)]">{{ row.status }}</span></td>
              <td class="row-actions">
                <button class="link" type="button" @click="openDetail(row)">查看详情</button>
                <button
                  v-for="action in availableActions(row)"
                  :key="action"
                  class="link"
                  type="button"
                  @click="runAction(action, row)"
                >
                  {{ action }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-panel">暂无设备点检数据，可先登记设备点检记录。</div>
      </section>
    </template>

    <footer class="page-foot">
      <span>共 {{ total }} 条设备点检记录</span>
      <span v-if="actionMessage" :class="actionOk ? 'ok-text' : 'error-text'">{{ actionMessage }}</span>
    </footer>

    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal">
        <header class="modal-head">
          <h3>设备点检记录详情</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <div class="detail-grid">
          <div v-for="field in detailFields" :key="field" class="detail-item">
            <span class="detail-label">{{ field }}</span>
            <span class="detail-value">
              {{ display(detailRow, field) }}
              <span v-if="field === '点检人员' && !detailRow['点检人员']" class="tag tag-warn">未排点检岗位</span>
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">当前状态</span>
            <span class="detail-value">
              <span :class="['tag', statusTagClass(detailRow.status)]">{{ detailRow.status }}</span>
            </span>
          </div>
        </div>
        <p v-if="missingSchedule(detailRow)" class="detail-warn">
          这条记录还没排定点检岗位，或点检部位/点检方法空缺，无法提交点检，请先补齐排班与点检交代。
        </p>
      </div>
    </div>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <header class="modal-head">
          <h3>登记设备点检记录</h3>
          <button class="link" type="button" @click="closeCreate">取消</button>
        </header>
        <form class="create-form" @submit.prevent="submitCreate">
          <label v-for="field in createFields" :key="field" class="form-item">
            <span>{{ field }}<em v-if="requiredFieldSet.has(field)" class="required-mark">*</em></span>
            <input v-model="createForm[field]" :placeholder="createPlaceholder(field)" />
          </label>
          <p v-if="createError" class="error-text form-error">{{ createError }}</p>
          <div class="form-actions">
            <button class="btn" type="button" @click="closeCreate">放弃</button>
            <button class="btn primary" type="submit">提交登记</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createEntry,
  downloadEntries,
  filterRows,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { armReadFailure, weekDate } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('equipcheck')
// 点检状态由「当前状态」列统一展示，列表不再重复渲染同名字段。
const tableColumns = ['点检编号', '点检设备', '点检部位', '点检方法', '点检结果', '点检人员', '点检日期']
const weekColumns = ['点检编号', '点检设备', '点检部位', '点检方法', '点检日期']
const detailFields = [...tableColumns]
const createFields = [...tableColumns]
const actionByStatus: Record<string, string[]> = {
  待点检: ['提交点检'],
  点检中: ['判定正常', '提出维修'],
}
const requiredFieldSet = new Set(meta.requiredFields ?? [])

const rows = ref<EntryRow[]>([])
const allSnapshot = ref<EntryRow[]>([])
const total = ref(0)
const loadError = ref('')
const actionMessage = ref('')
const actionOk = ref(true)
const filters = ref<Record<string, string>>({})
const filterFields = ['点检编号', '点检设备', '点检部位']

const detailRow = ref<EntryRow | null>(null)
const creating = ref(false)
const createError = ref('')
const createForm = reactive<Record<string, string>>({})

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待点检设备', value: countByStatus('待点检') },
  { label: '点检中设备', value: countByStatus('点检中') },
  { label: '需维修设备', value: countByStatus('需维修') },
])

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

// 周计划始终基于本次完整读取的快照圈选，不被检索条件过滤掉，也不会读到半截数据。
const weekRows = computed(() => allSnapshot.value.filter(inCurrentWeek))
const weekRange = computed(() => `${weekDate(0)} 至 ${weekDate(6)}`)

function inCurrentWeek(row: EntryRow): boolean {
  const value = String(row[meta.dateField ?? '点检日期'] ?? '')
  return value >= weekDate(0) && value <= weekDate(6)
}

function display(row: EntryRow, field: string): string {
  const value = row[field]
  return value === undefined || value === null || String(value) === '' ? '—（未交代）' : String(value)
}

function statusTagClass(status: string | number | boolean): string {
  const text = String(status)
  if (text === '待点检') return 'tag-pending'
  if (text === '点检中') return 'tag-doing'
  if (text === '状态正常') return 'tag-ok'
  if (text === '需维修') return 'tag-bad'
  return ''
}

function missingSchedule(row: EntryRow): boolean {
  return !row['点检人员'] || !row['点检部位'] || !row['点检方法']
}

function availableActions(row: EntryRow): string[] {
  return actionByStatus[String(row.status)] ?? []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function simulateReadFailure() {
  armReadFailure()
  reload()
}

function reload() {
  loadError.value = ''
  actionMessage.value = ''
  try {
    // 详情、周计划与列表同源：都从这一次完整读取的快照里取，半截数据不会被展示。
    const snapshot = listEntries(meta.key).items
    allSnapshot.value = snapshot
    rows.value = filterRows(snapshot, filters.value)
    total.value = rows.value.length
    if (detailRow.value) {
      const latest = snapshot.find((row) => Number(row.id) === Number(detailRow.value?.id))
      detailRow.value = latest ?? null
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '未知原因导致读取中断'
  }
}

function runAction(action: string, row: EntryRow) {
  actionMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  actionOk.value = result.ok
  actionMessage.value = result.message
  if (!result.ok) {
    return
  }
  reload()
}

function openDetail(row: EntryRow) {
  detailRow.value = row
}

function closeDetail() {
  detailRow.value = null
}

function createPlaceholder(field: string): string {
  if (field === '点检人员') {
    return '请填写点检岗位与人员，如：炉前巡检岗 张磊'
  }
  if (field === '点检日期') {
    return '格式：YYYY-MM-DD'
  }
  return `请填写${field}`
}

function openCreate() {
  createError.value = ''
  for (const field of createFields) {
    createForm[field] = field === '点检日期' ? weekDate(0) : ''
  }
  creating.value = true
}

function closeCreate() {
  creating.value = false
  createError.value = ''
}

function submitCreate() {
  const result = createEntry(meta.key, { ...createForm })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  creating.value = false
  actionOk.value = true
  actionMessage.value = result.message
  reload()
}

onMounted(reload)
</script>
