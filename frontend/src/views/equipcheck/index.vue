<template>
  <section class="page" data-module="equipcheck">
    <header class="page-head">
      <div>
        <h2>设备点检管理</h2>
        <p class="page-desc">维护设备点检记录，围绕点检编号、点检设备、点检部位、点检方法做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openEntryForm">登记设备点检记录</button>
        <button class="btn" type="button" @click="exportRows">导出设备点检清单</button>
      </div>
    </header>

    <div v-if="loadError" class="load-failure">
      <p class="load-failure-text">点检数据拉取失败：{{ loadError }}</p>
      <div class="load-failure-actions">
        <button class="btn primary" type="button" @click="load">重新拉取</button>
        <button class="btn ghost" type="button" @click="restoreDefaults">恢复示例数据</button>
      </div>
    </div>

    <template v-else>
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

      <section class="plan-board">
        <div class="plan-head">
          <h3>点检计划（按周）</h3>
          <div class="week-nav">
            <button class="btn ghost" type="button" @click="weekOffset -= 1">上一周</button>
            <span class="week-label">{{ week.label }}</span>
            <button class="btn ghost" type="button" @click="weekOffset += 1">下一周</button>
            <button v-if="weekOffset !== 0" class="link" type="button" @click="weekOffset = 0">回到本周</button>
          </div>
          <button class="btn" type="button" @click="openPlanForm">登记点检计划</button>
        </div>
        <p v-if="!weekPlans.length" class="empty-state plan-empty">
          本周暂无点检计划，可先点「登记点检计划」安排排班。
        </p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>计划日期</th>
              <th>点检设备</th>
              <th>点检部位</th>
              <th>点检方法</th>
              <th>点检人员</th>
              <th>排班状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in weekPlans" :key="String(plan.id)">
              <td>{{ plan['计划日期'] }}</td>
              <td>{{ plan['点检设备'] }}</td>
              <td>{{ plan['点检部位'] || '—' }}</td>
              <td>{{ plan['点检方法'] || '—' }}</td>
              <td>
                <template v-if="assigningId === Number(plan.id)">
                  <input
                    v-model="assignName"
                    class="assign-input"
                    placeholder="点检员姓名"
                    @keyup.enter="confirmAssign(plan)"
                  />
                  <button class="link" type="button" @click="confirmAssign(plan)">确定</button>
                  <button class="link" type="button" @click="assigningId = null">取消</button>
                </template>
                <template v-else>{{ plan['点检人员'] || '—' }}</template>
              </td>
              <td>
                <span v-if="isStaffed(plan)" class="tag ok">已排班</span>
                <span v-else class="tag warn">未排点检员</span>
              </td>
              <td class="row-actions">
                <button v-if="!isStaffed(plan)" class="link" type="button" @click="startAssign(plan)">排班</button>
                <button class="link" type="button" @click="generateFromPlan(plan)">生成点检记录</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <form class="filter-bar" @submit.prevent="applyFilters">
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
            <th>点检计划</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)" class="clickable" @click="openDetail(row)">
            <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
            <td>{{ planLabel(row) }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions" @click.stop>
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
            <td :colspan="columns.length + 3" class="empty-state">暂无设备点检数据，可先登记设备点检记录</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条设备点检记录</span>
        <span v-if="cleanupNotice" class="muted-text">{{ cleanupNotice }}</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
      </footer>
    </template>

    <div v-if="showEntryForm" class="modal-mask" @click.self="showEntryForm = false">
      <div class="modal">
        <h3>登记设备点检记录</h3>
        <label>
          <span>点检编号（同一台设备下不能重号）</span>
          <input v-model="entryForm.点检编号" placeholder="如 EQUI-0005" />
        </label>
        <label>
          <span>点检设备</span>
          <input v-model="entryForm.点检设备" list="known-devices" placeholder="如 1号焚烧炉" />
        </label>
        <label>
          <span>点检部位</span>
          <input v-model="entryForm.点检部位" placeholder="如 炉排及给料口" />
        </label>
        <label>
          <span>点检方法</span>
          <input v-model="entryForm.点检方法" placeholder="如 目视+听音" />
        </label>
        <label>
          <span>点检人员（点检员岗位，必填）</span>
          <input v-model="entryForm.点检人员" placeholder="未排点检人会被挡回" />
        </label>
        <label>
          <span>点检日期</span>
          <input v-model="entryForm.点检日期" type="date" />
        </label>
        <label>
          <span>点检结果（可后补）</span>
          <input v-model="entryForm.点检结果" placeholder="可先留空" />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitEntry">提交登记</button>
          <button class="btn ghost" type="button" @click="showEntryForm = false">取消</button>
        </div>
      </div>
    </div>

    <div v-if="showPlanForm" class="modal-mask" @click.self="showPlanForm = false">
      <div class="modal">
        <h3>登记点检计划</h3>
        <label>
          <span>点检设备</span>
          <input v-model="planForm.点检设备" list="known-devices" placeholder="如 汽轮发电机组" />
        </label>
        <label>
          <span>计划日期</span>
          <input v-model="planForm.计划日期" type="date" />
        </label>
        <label>
          <span>点检部位</span>
          <input v-model="planForm.点检部位" placeholder="如 前轴承" />
        </label>
        <label>
          <span>点检方法</span>
          <input v-model="planForm.点检方法" placeholder="如 振动仪测温" />
        </label>
        <label>
          <span>点检人员（可后补，空着会标成待排班）</span>
          <input v-model="planForm.点检人员" placeholder="点检员姓名" />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitPlan">提交计划</button>
          <button class="btn ghost" type="button" @click="showPlanForm = false">取消</button>
        </div>
      </div>
    </div>

    <datalist id="known-devices">
      <option v-for="device in knownDevices" :key="device" :value="device" />
    </datalist>

    <div v-if="detail" class="modal-mask" @click.self="closeDetail">
      <div class="modal">
        <h3>点检详情 · {{ detail['点检编号'] }}</h3>
        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd :class="{ missing: isFieldMissing(detail, field) }">
              {{ isFieldMissing(detail, field) ? '未填写' : detail[field] || '—' }}
            </dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detail.status }}</dd>
          <dt>点检计划</dt>
          <dd>{{ planLabel(detail) }}</dd>
        </dl>
        <p v-if="detailMissing.length" class="error-text">
          该记录还缺 {{ detailMissing.join('、') }}，提交点检前请先在点检计划里排班补齐。
        </p>
        <p v-if="linkedOverhaul" class="success-text">
          已转入设备检修待安排清单：{{ linkedOverhaul['检修编号'] }}（{{ linkedOverhaul.status }}）
        </p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, filterRows } from '@/api/local-service'
import {
  assignPlanInspector,
  CHECK_KEY,
  createCheckPlan,
  findLinkedOverhaul,
  fmtDate,
  generateEntryFromPlan,
  inWeek,
  loadCheckPageData,
  registerCheckEntry,
  REQUIRED_ROLE,
  resetCheckData,
  runCheckAction,
  suggestCheckNo,
  weekRange,
} from '@/api/equipcheck-service'
import type { EntryRow } from '@/data/types'

const columns = ["点检编号", "点检设备", "点检部位", "点检方法", "点检结果", "点检人员", "点检日期", "点检状态"]
const actions = ["提交点检", "判定正常", "提出维修"]
const statuses = ["待点检", "点检中", "状态正常", "需维修"]
const filterFields = columns.slice(0, 3)
const detailFields = ["点检编号", "点检设备", "点检部位", "点检方法", "点检结果", "点检人员", "点检日期"]

const allEntries = ref<EntryRow[]>([])
const plans = ref<EntryRow[]>([])
const loadError = ref('')
const cleanupNotice = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const weekOffset = ref(0)
const detailId = ref<number | null>(null)
const showEntryForm = ref(false)
const showPlanForm = ref(false)
const formError = ref('')
const assigningId = ref<number | null>(null)
const assignName = ref('')

const todayText = () => fmtDate(new Date())
const entryForm = ref({ 点检编号: '', 点检设备: '', 点检部位: '', 点检方法: '', 点检人员: '', 点检日期: todayText(), 点检结果: '' })
const planForm = ref({ 点检设备: '', 计划日期: todayText(), 点检部位: '', 点检方法: '', 点检人员: '' })

// 列表、统计、详情都从 allEntries 这一份数据算出来，保证两边看到的数一致。
const rows = computed(() => filterRows(allEntries.value, filters.value))
const total = computed(() => rows.value.length)
const week = computed(() => weekRange(weekOffset.value))
const weekPlans = computed(() =>
  plans.value.filter((plan) => inWeek(String(plan['计划日期'] ?? ''), week.value)),
)
const stats = computed(() => [
  { label: '待点检设备', value: allEntries.value.filter((row) => row.status === '待点检').length },
  { label: '状态正常设备', value: allEntries.value.filter((row) => row.status === '状态正常').length },
  { label: '需维修设备', value: allEntries.value.filter((row) => row.status === '需维修').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: allEntries.value.filter((row) => String(row.status) === status).length,
  })),
)
const knownDevices = computed(() => {
  const names = [...allEntries.value, ...plans.value].map((row) => String(row['点检设备'] ?? '').trim())
  return [...new Set(names.filter(Boolean))]
})
const detail = computed(() => allEntries.value.find((row) => Number(row.id) === detailId.value) ?? null)
const detailMissing = computed(() => {
  if (!detail.value) return []
  const missing: string[] = []
  if (!String(detail.value['点检人员'] ?? '').trim()) missing.push(`点检人（${REQUIRED_ROLE}岗位）`)
  if (!String(detail.value['点检部位'] ?? '').trim()) missing.push('点检部位')
  if (!String(detail.value['点检方法'] ?? '').trim()) missing.push('点检方法')
  return missing
})
const linkedOverhaul = computed(() =>
  detail.value ? findLinkedOverhaul(String(detail.value['点检编号'] ?? '')) : undefined,
)

function clearMessages() {
  errorMessage.value = ''
  successMessage.value = ''
}

function load() {
  loadError.value = ''
  cleanupNotice.value = ''
  try {
    const data = loadCheckPageData()
    allEntries.value = data.entries
    plans.value = data.plans
    if (data.cleaned > 0) {
      cleanupNotice.value = `已按「同一台设备同一编号只留一条」清理 ${data.cleaned} 条重复登记`
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '设备点检列表读取失败'
  }
}

function restoreDefaults() {
  resetCheckData()
  load()
}

function applyFilters() {
  clearMessages()
}

function resetFilters() {
  filters.value = {}
  clearMessages()
}

function exportRows() {
  downloadEntries(CHECK_KEY)
}

function isStaffed(plan: EntryRow): boolean {
  return String(plan['点检人员'] ?? '').trim() !== ''
}

function isFieldMissing(row: EntryRow, field: string): boolean {
  return ['点检部位', '点检方法', '点检人员'].includes(field) && String(row[field] ?? '').trim() === ''
}

function planLabel(row: EntryRow): string {
  const hit = plans.value.find(
    (plan) =>
      String(plan['点检设备'] ?? '') === String(row['点检设备'] ?? '') &&
      String(plan['计划日期'] ?? '') === String(row['点检日期'] ?? ''),
  )
  if (!hit) return '未排计划'
  const who = String(hit['点检人员'] ?? '').trim()
  return who ? `${hit['计划日期']} · ${who}` : `${hit['计划日期']} · 未排点检员`
}

function openEntryForm() {
  entryForm.value = { 点检编号: suggestCheckNo(), 点检设备: '', 点检部位: '', 点检方法: '', 点检人员: '', 点检日期: todayText(), 点检结果: '' }
  formError.value = ''
  showEntryForm.value = true
}

function submitEntry() {
  formError.value = ''
  const result = registerCheckEntry({ ...entryForm.value })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  showEntryForm.value = false
  clearMessages()
  successMessage.value = result.message
  load()
}

function openPlanForm() {
  planForm.value = { 点检设备: '', 计划日期: fmtDate(week.value.start), 点检部位: '', 点检方法: '', 点检人员: '' }
  formError.value = ''
  showPlanForm.value = true
}

function submitPlan() {
  formError.value = ''
  const result = createCheckPlan({ ...planForm.value })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  showPlanForm.value = false
  clearMessages()
  successMessage.value = result.message
  load()
}

function startAssign(plan: EntryRow) {
  assigningId.value = Number(plan.id)
  assignName.value = ''
}

function confirmAssign(plan: EntryRow) {
  const result = assignPlanInspector(Number(plan.id), assignName.value)
  if (!result.ok) {
    clearMessages()
    errorMessage.value = result.message
    return
  }
  assigningId.value = null
  clearMessages()
  successMessage.value = result.message
  load()
}

function generateFromPlan(plan: EntryRow) {
  const result = generateEntryFromPlan(Number(plan.id))
  clearMessages()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  load()
}

function runAction(action: string, row: EntryRow) {
  clearMessages()
  const result = runCheckAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  load()
}

function openDetail(row: EntryRow) {
  detailId.value = Number(row.id)
}

function closeDetail() {
  detailId.value = null
}

onMounted(load)
</script>
