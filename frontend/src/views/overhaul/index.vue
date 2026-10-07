<template>
  <section class="page" data-module="overhaul">
    <header class="page-head">
      <div>
        <h2>设备检修管理</h2>
        <p class="page-desc">维护检修记录，围绕检修编号、检修设备、检修类别、检修班组做登记、筛选与状态流转；点检判定需维修的设备先进入待安排清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检修记录</button>
        <button class="btn" type="button" @click="exportRows">导出设备检修清单</button>
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

    <section class="pending-plan">
      <h3 class="section-title">设备检修待安排清单</h3>
      <p class="section-tip">点检判定为「需维修」的设备会自动进入本清单，安排班组与工期后再提交开工。</p>
      <table v-if="pendingRows.length" class="data-table">
        <thead>
          <tr>
            <th v-for="column in pendingColumns" :key="column">{{ column }}</th>
            <th>来源</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pendingRows" :key="`pending-${String(row.id)}`">
            <td v-for="column in pendingColumns" :key="column">{{ row[column] || '待安排' }}</td>
            <td>{{ row['来源点检编号'] ? `点检提报 ${row['来源点检编号']}` : '检修登记' }}</td>
            <td><span class="tag tag-pending">{{ row.status }}</span></td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty-panel">设备检修暂无待安排任务。点检判定需维修的设备会自动补充到这里。</div>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td><span :class="['tag', statusTagClass(row.status)]">{{ row.status }}</span></td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无设备检修数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条设备检修记录，其中待安排 {{ pendingRows.length }} 条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  filterRows,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('overhaul')
const columns = ['检修编号', '检修设备', '检修类别', '检修班组', '计划工期', '完工日期', '更换备件', '检修状态']
const pendingColumns = ['检修编号', '检修设备', '检修类别', '检修班组', '计划工期', '更换备件']
const actions = ['提交开工', '确认完工', '申请延期']
const statuses = ['待开工', '检修中', '已完工', '已延期']

const rows = ref<EntryRow[]>([])
const snapshot = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 待安排清单：状态为待开工的任务，既包含点检提报，也包含直接登记的检修。
const pendingRows = computed(() =>
  snapshot.value.filter((row) => String(row.status) === '待开工'),
)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待安排检修', value: pendingRows.value.length },
  { label: '检修中记录', value: rows.value.filter((row) => String(row.status) === '检修中').length },
  { label: '已完工记录', value: rows.value.filter((row) => String(row.status) === '已完工').length },
])

function statusTagClass(status: string | number | boolean): string {
  const text = String(status)
  if (text === '待开工') return 'tag-pending'
  if (text === '检修中') return 'tag-doing'
  if (text === '已完工') return 'tag-ok'
  if (text === '已延期') return 'tag-bad'
  return ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '检修记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const all = listEntries(meta.key).items
    snapshot.value = all
    rows.value = filterRows(all, filters.value)
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设备检修列表读取失败'
  }
}

onMounted(reload)
</script>
