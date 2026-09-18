<script setup lang="ts">
/**
 * Deployment-wide Platform Admin console — Reports/Feedback/Staff, gated by
 * `GET /probe`. Unlike the reference Buzz's own `admin-web` (which never
 * calls `/probe` and has no resolve/reopen or staffing UI at all — see
 * docs/ROLE_PERMISSION_AUDIT.md §15), this view role-gates itself up front
 * and gives Operators the full report-resolution and staffing surface the
 * backend has always supported.
 */
import { ref } from "vue";
import AppShell from "@/layouts/AppShell.vue";
import StateView from "@/components/StateView.vue";
import BaseButton from "@/components/BaseButton.vue";
import { useAuth } from "@/features/auth/useAuth";
import { useAdminFeedback, useAdminOperators, useAdminProbe, useAdminReports } from "../usePlatformAdmin";
import { userMessageFor } from "@/services/errors";

const { logout } = useAuth();
const { data: probe, isLoading: probeLoading, isError: probeError } = useAdminProbe();

const tab = ref<"reports" | "feedback" | "staff">("reports");

const { data: reports, isLoading: reportsLoading, isError: reportsError, resolve, isResolving } =
  useAdminReports();
const { data: feedback, isLoading: feedbackLoading, isError: feedbackError } = useAdminFeedback();
const {
  data: operators,
  isLoading: operatorsLoading,
  isError: operatorsError,
  canStaff,
  upsert,
  isUpserting,
  upsertError,
  remove,
} = useAdminOperators();

const newOperatorPubkey = ref("");
const newOperatorRole = ref<"operator" | "moderator">("moderator");

async function handleAddOperator() {
  const pubkey = newOperatorPubkey.value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return;
  await upsert({ pubkey, role: newOperatorRole.value });
  newOperatorPubkey.value = "";
}
</script>

<template>
  <AppShell>
    <template #sidebar>
      <div class="sidebar-content">
        <h2>Platform Admin</h2>
        <p v-if="probe" class="role-line">
          Signed in as <strong>{{ probe.role ?? "unauthorized" }}</strong>
        </p>
        <nav class="admin-nav">
          <button type="button" :class="{ active: tab === 'reports' }" @click="tab = 'reports'">
            Reports
          </button>
          <button type="button" :class="{ active: tab === 'feedback' }" @click="tab = 'feedback'">
            Feedback
          </button>
          <button
            v-if="canStaff"
            type="button"
            :class="{ active: tab === 'staff' }"
            @click="tab = 'staff'"
          >
            Staff
          </button>
        </nav>
        <div class="sidebar-footer">
          <BaseButton variant="ghost" @click="logout">Sign out</BaseButton>
        </div>
      </div>
    </template>

    <template #main>
      <StateView v-if="probeLoading" kind="loading" />
      <StateView
        v-else-if="probeError || !probe?.canAct"
        kind="error"
        title="Not authorized"
        description="This identity doesn't hold a platform Operator or Moderator role on this deployment's admin console."
      />

      <div v-else class="admin-content">
        <template v-if="tab === 'reports'">
          <h1>Deployment-wide reports</h1>
          <StateView v-if="reportsLoading" kind="loading" />
          <StateView v-else-if="reportsError" kind="error" title="Couldn't load reports" />
          <StateView v-else-if="!reports?.length" kind="empty" title="No reports" />
          <ul v-else class="report-list">
            <li v-for="report in reports" :key="report.id" class="report-row">
              <div class="report-meta">
                <span class="report-community">{{ report.communityHost }}</span>
                <span class="report-type">{{ report.reportType }}</span>
                <span class="report-status">{{ report.status }}</span>
              </div>
              <div class="resolve-actions">
                <BaseButton
                  variant="ghost"
                  :disabled="isResolving"
                  @click="resolve({ id: report.id, action: 'dismiss' })"
                >
                  Dismiss
                </BaseButton>
                <BaseButton
                  variant="danger"
                  :disabled="isResolving"
                  @click="resolve({ id: report.id, action: 'ban' })"
                >
                  Ban
                </BaseButton>
              </div>
            </li>
          </ul>
        </template>

        <template v-else-if="tab === 'feedback'">
          <h1>Product feedback</h1>
          <StateView v-if="feedbackLoading" kind="loading" />
          <StateView v-else-if="feedbackError" kind="error" title="Couldn't load feedback" />
          <StateView v-else-if="!feedback?.length" kind="empty" title="No feedback yet" />
          <ul v-else class="feedback-list">
            <li v-for="item in feedback" :key="item.id" class="feedback-row">
              <span class="feedback-category">{{ item.category ?? "uncategorized" }}</span>
              <p class="feedback-body">{{ item.bodySummary }}</p>
              <span class="feedback-status">{{ item.status }}</span>
            </li>
          </ul>
        </template>

        <template v-else-if="tab === 'staff' && canStaff">
          <h1>Operator / Moderator roster</h1>
          <form class="add-operator-form" @submit.prevent="handleAddOperator">
            <input
              v-model="newOperatorPubkey"
              class="pubkey-input"
              type="text"
              placeholder="64-char hex pubkey"
              :disabled="isUpserting"
            />
            <select v-model="newOperatorRole" :disabled="isUpserting">
              <option value="moderator">moderator</option>
              <option value="operator">operator</option>
            </select>
            <BaseButton type="submit" variant="primary" :disabled="isUpserting || !newOperatorPubkey.trim()">
              Grant
            </BaseButton>
          </form>
          <p v-if="upsertError" class="error-text">{{ userMessageFor(upsertError) }}</p>

          <StateView v-if="operatorsLoading" kind="loading" />
          <StateView v-else-if="operatorsError" kind="error" title="Couldn't load the roster" />
          <ul v-else class="operator-list">
            <li v-for="op in operators ?? []" :key="op.pubkey" class="operator-row">
              <span class="operator-pubkey">{{ op.pubkey.slice(0, 12) }}…</span>
              <span class="operator-role">{{ op.effectiveRole }}</span>
              <span class="operator-sources">{{ op.sources.join(", ") }}</span>
              <BaseButton
                v-if="!op.sources.includes('config') && !op.sources.includes('owner_fallback')"
                variant="danger"
                @click="remove(op.pubkey)"
              >
                Revoke
              </BaseButton>
            </li>
          </ul>
        </template>
      </div>
    </template>
  </AppShell>
</template>

<style scoped>
.sidebar-content {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  height: 100%;
}
.sidebar-content h2 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-subtle);
}
.role-line {
  margin: 0 0 var(--space-3);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.admin-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.admin-nav button {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-sm);
}
.admin-nav button:hover {
  background: var(--color-surface-hover);
}
.admin-nav button.active {
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-weight: 600;
}
.sidebar-footer {
  margin-top: auto;
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.admin-content {
  padding: var(--space-5);
  overflow-y: auto;
}
.admin-content h1 {
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-lg);
  color: var(--color-text);
}

.report-list,
.feedback-list,
.operator-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.report-row,
.feedback-row,
.operator-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
}

.report-meta {
  display: flex;
  gap: var(--space-2);
  flex: 1;
  font-size: var(--font-size-sm);
}
.report-community {
  font-weight: 600;
}
.report-type,
.report-status {
  color: var(--color-text-subtle);
  text-transform: capitalize;
}

.resolve-actions {
  display: flex;
  gap: var(--space-1);
}

.feedback-body {
  flex: 1;
  margin: 0;
  font-size: var(--font-size-sm);
}
.feedback-category,
.feedback-status {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  text-transform: capitalize;
}

.add-operator-form {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.pubkey-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: monospace;
  font-size: var(--font-size-xs);
}

.error-text {
  margin: 0 0 var(--space-3);
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}

.operator-pubkey {
  font-family: monospace;
  font-size: var(--font-size-xs);
}
.operator-role {
  font-weight: 600;
  text-transform: capitalize;
}
.operator-sources {
  flex: 1;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
</style>
