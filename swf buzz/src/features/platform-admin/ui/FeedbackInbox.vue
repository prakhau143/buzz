<script setup lang="ts">
/**
 * Control plane → Feedback. Lists every kind 42000 submission the deployment
 * received (`GET /api/admin/v1/feedback`, newest 100 — the relay's own cap),
 * with who sent it, from which community, their DERIVED role
 * (feedbackInsights.ts — never a client claim), category, status, and a
 * detail pane with the full message, attachments (read only through the
 * feedback-scoped admin route) and a status control.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useQueries, useQuery } from "@tanstack/vue-query";
import AppIcon from "@/components/AppIcon.vue";
import StateView from "@/components/StateView.vue";
import { useAdminFeedback } from "../usePlatformAdmin";
import { adminConsoleService } from "../AdminConsoleService";
import {
  deriveSubmitterInsight,
  feedbackAttachments,
  sniffAttachment,
  type DerivedRole,
  type SubmitterInsight,
} from "../feedbackInsights";
import { shortNpub } from "@/features/identity/format";
import { userMessageFor } from "@/services/errors";

const { data: feedback, isLoading, isError, refetch, updateStatus, isUpdatingStatus } = useAdminFeedback();

// ---- Derived identity/role per (community, submitter) ----
const pairs = computed(() => {
  const seen = new Map<string, { host: string | null; pubkey: string }>();
  for (const f of feedback.value ?? []) seen.set(`${f.communityHost ?? "-"}|${f.submitterPubkey}`, { host: f.communityHost, pubkey: f.submitterPubkey });
  return [...seen.entries()];
});
const insightQueries = useQueries({
  queries: computed(() =>
    pairs.value.map(([key, p]) => ({
      queryKey: ["admin-feedback-insight", key],
      queryFn: () => deriveSubmitterInsight(p.host, p.pubkey),
      staleTime: 5 * 60_000,
    })),
  ),
});
const insights = computed(() => {
  const map = new Map<string, SubmitterInsight>();
  pairs.value.forEach(([key], i) => {
    const data = insightQueries.value[i]?.data;
    if (data) map.set(key, data);
  });
  return map;
});
const insightFor = (host: string | null, pubkey: string) => insights.value.get(`${host ?? "-"}|${pubkey}`);
const nameFor = (host: string | null, pubkey: string) => insightFor(host, pubkey)?.displayName || shortNpub(pubkey);

// ---- Filters ----
const search = ref("");
const communityFilter = ref("all");
const roleFilter = ref<"all" | DerivedRole | "unverified">("all");
const categoryFilter = ref("all");
const statusFilter = ref<"all" | "new" | "reviewed" | "archived">("all");
const communities = computed(() => [...new Set((feedback.value ?? []).map((f) => f.communityHost ?? "(deleted community)"))].sort());

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (feedback.value ?? []).filter((f) => {
    const host = f.communityHost ?? "(deleted community)";
    const insight = insightFor(f.communityHost, f.submitterPubkey);
    const role = insight?.verified ? insight.role : "unverified";
    if (communityFilter.value !== "all" && host !== communityFilter.value) return false;
    if (categoryFilter.value !== "all" && (f.category ?? "none") !== categoryFilter.value) return false;
    if (statusFilter.value !== "all" && f.status !== statusFilter.value) return false;
    if (roleFilter.value !== "all" && role !== roleFilter.value) return false;
    if (!q) return true;
    return [f.bodySummary, host, f.submitterPubkey, nameFor(f.communityHost, f.submitterPubkey)].some((t) => t.toLowerCase().includes(q));
  });
});

const selectedId = ref<string | null>(null);
watch(filtered, (list) => {
  if (!selectedId.value && list.length) selectedId.value = list[0].id;
});
const selected = computed(() => (feedback.value ?? []).find((f) => f.id === selectedId.value) ?? null);

// ---- Detail ----
const detail = useQuery({
  queryKey: computed(() => ["admin-feedback-detail", selectedId.value]),
  queryFn: () => adminConsoleService.getFeedback(selectedId.value as string),
  enabled: computed(() => !!selectedId.value),
  staleTime: 60_000,
});
/** Body without the appended attachment reference lines. */
const cleanBody = computed(() =>
  (detail.data.value?.body ?? "")
    .split("\n")
    .filter((line) => !/^!?\[[^\]]*\]\(https?:\/\/[^)]+\)$/.test(line.trim()))
    .join("\n")
    .trim(),
);

interface LoadedAttachment {
  sha256: string;
  filename: string | null;
  kind: "image" | "video" | "text" | "file" | "error";
  url?: string;
  text?: string;
  message?: string;
}
const attachments = ref<LoadedAttachment[]>([]);
const objectUrls: string[] = [];
function revoke() {
  objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
}
watch(
  () => detail.data.value,
  async (d) => {
    revoke();
    attachments.value = [];
    if (!d) return;
    const refs = feedbackAttachments(d.tags);
    attachments.value = refs.map((r) => ({ sha256: r.sha256, filename: r.filename, kind: "file" as const }));
    await Promise.all(
      refs.map(async (r, i) => {
        try {
          const buffer = await adminConsoleService.fetchFeedbackAttachment(d.id, r.sha256);
          if (detail.data.value?.id !== d.id) return; // selection moved on
          const bytes = new Uint8Array(buffer);
          const sniffed = sniffAttachment(bytes);
          let entry: LoadedAttachment;
          if (sniffed.kind === "image" || sniffed.kind === "video") {
            const url = URL.createObjectURL(new Blob([bytes], { type: sniffed.mime }));
            objectUrls.push(url);
            entry = { sha256: r.sha256, filename: r.filename, kind: sniffed.kind, url };
          } else if (sniffed.kind === "text") {
            entry = { sha256: r.sha256, filename: r.filename, kind: "text", text: new TextDecoder().decode(bytes) };
          } else {
            const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
            objectUrls.push(url);
            entry = { sha256: r.sha256, filename: r.filename, kind: "file", url };
          }
          attachments.value = attachments.value.map((a, j) => (j === i ? entry : a));
        } catch (err) {
          attachments.value = attachments.value.map((a, j) => (j === i ? { ...a, kind: "error", message: userMessageFor(err) } : a));
        }
      }),
    );
  },
);
onBeforeUnmount(revoke);

const statusError = ref<string | null>(null);
async function setStatus(status: "new" | "reviewed" | "archived") {
  if (!selected.value || selected.value.status === status) return;
  statusError.value = null;
  try {
    await updateStatus({ id: selected.value.id, status });
  } catch (err) {
    statusError.value = userMessageFor(err);
  }
}

const CATEGORY_LABEL: Record<string, string> = { bug: "Bug", praise: "Praise", "needs-work": "Needs work", none: "General" };
const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", "not-a-member": "Not a member" };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
</script>

<template>
  <div class="inbox">
    <div class="list-pane">
      <div class="toolbar">
        <label class="search">
          <AppIcon name="search" :size="16" />
          <input v-model="search" type="search" placeholder="Search feedback" aria-label="Search feedback" data-testid="feedback-search" />
        </label>
        <div class="filters">
          <select v-model="communityFilter" aria-label="Community">
            <option value="all">All communities</option>
            <option v-for="c in communities" :key="c" :value="c">{{ c }}</option>
          </select>
          <select v-model="roleFilter" aria-label="Role">
            <option value="all">All roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="unverified">Not verifiable</option>
          </select>
          <select v-model="categoryFilter" aria-label="Category">
            <option value="all">All categories</option>
            <option value="bug">Bug</option>
            <option value="praise">Praise</option>
            <option value="needs-work">Needs work</option>
            <option value="none">General</option>
          </select>
          <select v-model="statusFilter" aria-label="Status">
            <option value="all">Any status</option>
            <option value="new">New</option>
            <option value="reviewed">Reviewed</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      <StateView v-if="isLoading" kind="loading" title="Loading feedback…" />
      <StateView v-else-if="isError" kind="error" title="Couldn't load feedback" @retry="refetch()" />
      <StateView v-else-if="!feedback?.length" kind="empty" title="No feedback yet" description="Feedback sent from SWF Buzz appears here." />
      <StateView v-else-if="!filtered.length" kind="empty" title="Nothing matches these filters" />
      <ul v-else class="rows" data-testid="feedback-rows">
        <li v-for="f in filtered" :key="f.id">
          <button type="button" class="row" :class="{ active: f.id === selectedId }" @click="selectedId = f.id">
            <span class="row-top">
              <span class="cat" :data-cat="f.category ?? 'none'">{{ CATEGORY_LABEL[f.category ?? "none"] }}</span>
              <span class="status" :data-status="f.status">{{ f.status }}</span>
            </span>
            <span class="summary">{{ f.bodySummary || "(no text)" }}</span>
            <span class="meta">
              <strong>{{ nameFor(f.communityHost, f.submitterPubkey) }}</strong>
              <template v-if="insightFor(f.communityHost, f.submitterPubkey)?.verified">
                · {{ ROLE_LABEL[insightFor(f.communityHost, f.submitterPubkey)!.role!] }}
              </template>
              · {{ f.communityHost ?? "deleted community" }} · {{ when(f.receivedAt) }}
            </span>
          </button>
        </li>
      </ul>
      <p v-if="feedback && feedback.length >= 100" class="cap-note">Showing the newest 100 — the server doesn't page further back.</p>
    </div>

    <div class="detail-pane">
      <StateView v-if="!selected" kind="empty" title="Select feedback to read it" />
      <template v-else>
        <header class="detail-head">
          <span class="cat big" :data-cat="selected.category ?? 'none'">{{ CATEGORY_LABEL[selected.category ?? "none"] }}</span>
          <h2>{{ nameFor(selected.communityHost, selected.submitterPubkey) }}</h2>
          <div class="facts">
            <span>
              <template v-if="insightFor(selected.communityHost, selected.submitterPubkey)?.verified">
                <span class="role verified" data-testid="feedback-role">{{ ROLE_LABEL[insightFor(selected.communityHost, selected.submitterPubkey)!.role!] }}</span>
                <span class="hint">verified from the community's membership list</span>
              </template>
              <template v-else>
                <span class="role" data-testid="feedback-role">Role not verifiable</span>
                <span class="hint">{{ insightFor(selected.communityHost, selected.submitterPubkey)?.note ?? "Checking…" }}</span>
              </template>
            </span>
            <span><AppIcon name="building" :size="16" />{{ selected.communityHost ?? "Deleted community" }}</span>
            <span class="mono">{{ shortNpub(selected.submitterPubkey) }}</span>
            <span>Received {{ when(selected.receivedAt) }}</span>
          </div>
        </header>

        <StateView v-if="detail.isLoading.value" kind="loading" />
        <StateView v-else-if="detail.isError.value" kind="error" title="Couldn't open this feedback" @retry="detail.refetch()" />
        <template v-else-if="detail.data.value">
          <section class="message">
            <p>{{ cleanBody || "(no text)" }}</p>
          </section>

          <section v-if="attachments.length" class="attachments">
            <h3>Attachments</h3>
            <div class="att-grid">
              <figure v-for="a in attachments" :key="a.sha256" class="att" :data-kind="a.kind">
                <img v-if="a.kind === 'image'" :src="a.url" :alt="a.filename ?? 'Attachment'" />
                <video v-else-if="a.kind === 'video'" :src="a.url" controls preload="metadata" />
                <pre v-else-if="a.kind === 'text'" class="diag">{{ a.text }}</pre>
                <a v-else-if="a.kind === 'file' && a.url" :href="a.url" :download="a.filename ?? 'attachment'" class="download">
                  <AppIcon name="download" :size="16" />Download {{ a.filename ?? "file" }}
                </a>
                <span v-else-if="a.kind === 'error'" class="att-error">{{ a.message }}</span>
                <span v-else class="att-loading">Loading…</span>
                <figcaption v-if="a.filename">{{ a.filename }}</figcaption>
              </figure>
            </div>
          </section>

          <section class="status-bar">
            <span class="status-label">Status</span>
            <div class="status-options" role="radiogroup" aria-label="Status">
              <button
                v-for="s in ['new', 'reviewed', 'archived'] as const"
                :key="s"
                type="button"
                role="radio"
                :aria-checked="selected.status === s"
                :class="{ active: selected.status === s }"
                :disabled="isUpdatingStatus"
                :data-testid="`feedback-status-${s}`"
                @click="setStatus(s)"
              >
                {{ s[0].toUpperCase() + s.slice(1) }}
              </button>
            </div>
            <span v-if="statusError" class="att-error">{{ statusError }}</span>
          </section>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.inbox {
  display: grid;
  grid-template-columns: minmax(300px, 420px) minmax(0, 1fr);
  gap: var(--space-4);
  min-height: 0;
  height: 100%;
}
.list-pane,
.detail-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
.toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-text-subtle);
}
.search input {
  flex: 1;
  height: 34px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
}
.filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}
.filters select {
  height: 32px;
  min-width: 0;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
}
.rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
}
.row:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.row.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
}
.row-top {
  display: flex;
  justify-content: space-between;
}
.cat {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 650;
  background: var(--color-surface-muted);
}
.cat[data-cat="bug"] {
  background: var(--color-danger-muted);
  color: var(--color-danger);
}
.cat[data-cat="praise"] {
  background: var(--color-success-muted);
  color: var(--color-success);
}
.cat[data-cat="needs-work"] {
  background: var(--color-warning-muted);
  color: var(--color-warning);
}
.cat.big {
  align-self: flex-start;
  font-size: var(--font-size-sm);
}
.status {
  font-size: var(--font-size-xs);
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-subtle);
}
.status[data-status="new"] {
  color: var(--color-primary);
}
.summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: var(--font-size-sm);
}
.meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.cap-note {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.detail-pane {
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-surface);
}
.detail-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.detail-head h2 {
  margin: 0;
  font-size: var(--font-size-xl);
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.facts > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.role {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--color-surface-muted);
  font-weight: 650;
  color: var(--color-text);
}
.role.verified {
  background: var(--color-primary-muted);
  color: var(--color-primary);
}
.hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.mono {
  font-family: var(--font-mono);
}
.message p {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.6;
}
.attachments h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.att-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-3);
}
.att {
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg);
}
.att img,
.att video {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  background: #000;
}
.att figcaption {
  padding: 6px 10px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.diag {
  margin: 0;
  padding: var(--space-3);
  overflow-x: auto;
  font-size: var(--font-size-xs);
  white-space: pre-wrap;
}
.download {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-3);
}
.att-error {
  display: block;
  padding: var(--space-3);
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}
.att-loading {
  display: block;
  padding: var(--space-3);
  color: var(--color-text-subtle);
}
.status-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: auto;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}
.status-label {
  font-size: var(--font-size-sm);
  font-weight: 600;
}
.status-options {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: var(--color-surface-muted);
}
.status-options button {
  min-height: 30px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.status-options button.active {
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
@media (max-width: 960px) {
  .inbox {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
