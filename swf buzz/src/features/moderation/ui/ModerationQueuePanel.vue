<script setup lang="ts">
/**
 * Community moderation queue — reports + audit log. Visible only to the
 * community owner/admin. See docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2b.
 */
import { ref } from "vue";
import StateView from "@/components/StateView.vue";
import BaseButton from "@/components/BaseButton.vue";
import { useCommunityMembers } from "@/features/community-members/useCommunityMembers";
import { useModerationAudit, useModerationReports } from "../useModerationQueue";
import { useModerationActions } from "../useModerationActions";
import { moderationService } from "../ModerationService";
import { userMessageFor, logError } from "@/services/errors";
import type { ResolutionAction } from "@/protocol/moderation";
import type { ModerationReportSummary } from "@/types/domain";

const { myRole, canManage, isLoading: rolesLoading } = useCommunityMembers();
const queueTab = ref<"reports" | "audit">("reports");

const {
  data: reports,
  isLoading: reportsLoading,
  isError: reportsError,
  refetch: refetchReports,
} = useModerationReports("open");

const { data: auditActions, isLoading: auditLoading, isError: auditError } = useModerationAudit();

const { ban, timeout: applyTimeout } = useModerationActions();
const resolvingId = ref<string | null>(null);
const resolveErrors = ref<Record<string, string>>({});

const ONE_DAY_SECS = 24 * 60 * 60;

async function handleResolve(report: ModerationReportSummary, action: ResolutionAction) {
  resolvingId.value = report.id;
  delete resolveErrors.value[report.id];
  try {
    if (action === "ban" || action === "timeout" || action === "kick") {
      const authorPubkey = await moderationService.resolveReportAuthorPubkey(report);
      if (!authorPubkey) {
        throw new Error("Couldn't determine who to act against for this report.");
      }
      if (action === "ban") {
        await ban({ pubkey: authorPubkey, targetRole: null, actingRole: myRole.value });
      } else if (action === "timeout") {
        await applyTimeout({
          pubkey: authorPubkey,
          targetRole: null,
          actingRole: myRole.value,
          expiresAt: Math.floor(Date.now() / 1000) + ONE_DAY_SECS,
        });
      } else if (report.channelId) {
        await moderationService.kickFromChannel({
          channelId: report.channelId,
          pubkey: authorPubkey,
          actingRole: myRole.value,
        });
      } else {
        throw new Error("This report has no associated channel to kick from.");
      }
    }
    await moderationService.resolveReport({
      reportEventId: report.reportEventId,
      action,
      actingRole: myRole.value,
    });
    await refetchReports();
  } catch (err) {
    logError("ModerationQueuePanel.resolve", err);
    resolveErrors.value[report.id] = userMessageFor(err);
  } finally {
    resolvingId.value = null;
  }
}
</script>

<template>
  <div class="moderation-queue-panel">
    <StateView v-if="rolesLoading" kind="loading" />
    <StateView
      v-else-if="!canManage"
      kind="empty"
      title="Moderators only"
      description="The community moderation queue is only visible to the community owner or an admin."
    />
    <template v-else>
      <div class="queue-tabs">
        <button
          type="button"
          class="tab"
          :class="{ active: queueTab === 'reports' }"
          @click="queueTab = 'reports'"
        >
          Reports
        </button>
        <button
          type="button"
          class="tab"
          :class="{ active: queueTab === 'audit' }"
          @click="queueTab = 'audit'"
        >
          Audit log
        </button>
      </div>

      <template v-if="queueTab === 'reports'">
        <StateView v-if="reportsLoading" kind="loading" />
        <StateView
          v-else-if="reportsError"
          kind="error"
          title="Couldn't load reports"
          @retry="refetchReports"
        />
        <StateView v-else-if="!reports?.length" kind="empty" title="No open reports" />
        <ul v-else class="report-list">
          <li v-for="report in reports" :key="report.id" class="report-row">
            <div class="report-meta">
              <span class="report-type">{{ report.reportType }}</span>
              <span class="report-target">{{ report.targetKind }}: {{ report.target.slice(0, 12) }}…</span>
              <span class="report-time">{{ new Date(report.createdAt).toLocaleString() }}</span>
            </div>
            <p v-if="report.note" class="report-note">{{ report.note }}</p>
            <p v-if="resolveErrors[report.id]" class="error-text">{{ resolveErrors[report.id] }}</p>
            <div class="resolve-actions">
              <BaseButton
                variant="ghost"
                :disabled="resolvingId === report.id"
                @click="handleResolve(report, 'dismiss')"
              >
                Dismiss
              </BaseButton>
              <BaseButton
                variant="ghost"
                :disabled="resolvingId === report.id"
                @click="handleResolve(report, 'escalate')"
              >
                Escalate
              </BaseButton>
              <BaseButton
                variant="secondary"
                :disabled="resolvingId === report.id || report.targetKind === 'blob'"
                @click="handleResolve(report, 'timeout')"
              >
                Timeout (24h)
              </BaseButton>
              <BaseButton
                v-if="report.channelId"
                variant="secondary"
                :disabled="resolvingId === report.id || report.targetKind === 'blob'"
                @click="handleResolve(report, 'kick')"
              >
                Kick
              </BaseButton>
              <BaseButton
                variant="danger"
                :disabled="resolvingId === report.id || report.targetKind === 'blob'"
                @click="handleResolve(report, 'ban')"
              >
                Ban
              </BaseButton>
            </div>
          </li>
        </ul>
      </template>

      <template v-else>
        <StateView v-if="auditLoading" kind="loading" />
        <StateView v-else-if="auditError" kind="error" title="Couldn't load the audit log" />
        <StateView v-else-if="!auditActions?.length" kind="empty" title="No moderation actions yet" />
        <ul v-else class="audit-list">
          <li v-for="entry in auditActions" :key="entry.id" class="audit-row">
            <span class="audit-action">{{ entry.action }}</span>
            <span class="audit-time">{{ new Date(entry.createdAt).toLocaleString() }}</span>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>

<style scoped>
.moderation-queue-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.queue-tabs {
  display: flex;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.tab {
  height: 28px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.tab:hover {
  background: var(--color-surface-hover);
}
.tab.active {
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-weight: 600;
}

.report-list,
.audit-list {
  list-style: none;
  margin: 0;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.report-row {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.report-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: baseline;
}

.report-type {
  font-weight: 600;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  text-transform: capitalize;
}

.report-target {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  font-family: monospace;
}

.report-time {
  margin-left: auto;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

.report-note {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.error-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}

.resolve-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.audit-row {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--color-border);
}
.audit-action {
  text-transform: capitalize;
  font-weight: 600;
  color: var(--color-text);
}
</style>
