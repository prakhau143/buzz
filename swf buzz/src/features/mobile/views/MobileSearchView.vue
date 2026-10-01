<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppIcon from "@/components/AppIcon.vue";
import MessagePreview from "@/features/mentions/MessagePreview";
import AvatarCircle from "@/components/AvatarCircle.vue";
import MobileLayout from "../ui/MobileLayout.vue";
import MobileHeader from "../ui/MobileHeader.vue";
import MobileListSkeleton from "../ui/MobileListSkeleton.vue";
import { useChannels } from "@/features/channels/useChannels";
import { sidebarChannels } from "@/features/channels/channelVisibility";
import { useDmList } from "@/features/dm/useDmList";
import { useCommunityMembers } from "@/features/community-members/useCommunityMembers";
import { useMessageSearch } from "@/features/search/useMessageSearch";
import type { SearchHit } from "@/features/search/SearchService";
import { snippet } from "@/features/search/paletteModel";
import { useProfileMap } from "@/composables/useProfile";
import { activeRelayUrl, communities, relayHost } from "@/features/communities/relayCommunities";
import { fromSearchHit } from "@/features/navigation/messageTarget";
import { useOpenMessageTarget } from "@/features/navigation/useOpenMessageTarget";
import { useSessionStore } from "@/stores/session";
import { useUiStore } from "@/stores/ui";
import { ALL_TAB_LIMIT, SEARCH_TABS, canSearch, isSearchTab, rankLocal, type SearchTab } from "../searchPresentation";
import { shortTime } from "../inboxPresentation";

/**
 * Mobile Search — a phone screen over the SAME search the desktop palette uses:
 * messages are the relay's NIP-50 answer (`useMessageSearch`: debounced,
 * community-scoped cache, access enforced by the relay — nothing is searched
 * client-side), and channels / DMs / people are local matches over what this
 * community already shows you, ranked by the palette's `matchScore`.
 *
 * Opening: a message → its `MessageTarget` → THE deep-link opener (exact
 * message, thread reply or DM, C2 reveal); a person → the mobile profile sheet
 * (`ui.openProfile`); a channel / DM → its mobile route. The query and tab live
 * in `?q=&t=` (replace), so back restores them and nothing is held globally.
 */
const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const ui = useUiStore();
const { openMessageTarget } = useOpenMessageTarget();

const text = ref(typeof route.query?.q === "string" ? route.query.q : "");
const tab = computed<SearchTab>(() => (isSearchTab(route.query?.t) ? route.query.t : "all"));
const input = ref<HTMLInputElement | null>(null);

const search = useMessageSearch(text);
const active = computed(() => canSearch(text.value));

function syncQuery(q: string, t: SearchTab) {
  const next: Record<string, string> = {};
  if (q) next.q = q;
  if (t !== "all") next.t = t;
  if (route.query?.q === next.q && (route.query?.t ?? undefined) === next.t) return;
  void router.replace({ query: next });
}
// Follow the debounced query (what was actually searched), not every keystroke.
watch(search.submittedQuery, (q) => syncQuery(q, tab.value));
const pickTab = (t: SearchTab) => syncQuery(search.submittedQuery.value, t);

function clear() {
  text.value = "";
  input.value?.focus();
}

// ---- sources (all existing, community-scoped) ----
const { data: channels } = useChannels();
const { data: conversations } = useDmList();
const { data: members } = useCommunityMembers();

const otherOf = (c: { dmParticipants?: string[] }) => c.dmParticipants?.find((p) => p !== session.pubkey) ?? null;
const dmIds = computed(() => new Set((conversations.value ?? []).map((c) => c.id)));
const hits = computed<SearchHit[]>(() => (active.value ? (search.data.value ?? []) : []));
const people = computed(() => (members.value ?? []).filter((m) => m.pubkey !== session.pubkey));

const pubkeys = computed(() => [
  ...people.value.map((m) => m.pubkey),
  ...(conversations.value ?? []).map(otherOf).filter((p): p is string => !!p),
  ...hits.value.map((h) => h.message.authorPubkey),
]);
const { profiles, displayNames } = useProfileMap(pubkeys);
const nameOf = (pubkey: string | null) => (pubkey ? (displayNames.value.get(pubkey) ?? pubkey.slice(0, 8)) : "Conversation");

const channelList = computed(() => sidebarChannels(channels.value));
const channelName = (id: string) => (channels.value ?? []).find((c) => c.id === id)?.name ?? null;
const communityName = computed(
  () => communities.value.find((c) => c.relayUrl === activeRelayUrl.value)?.name ?? relayHost(activeRelayUrl.value ?? ""),
);

const q = computed(() => text.value.trim());
const matchedChannels = computed(() => (active.value ? rankLocal(channelList.value, (c) => c.name, q.value) : []));
const matchedDms = computed(() =>
  active.value ? rankLocal(conversations.value ?? [], (c) => nameOf(otherOf(c)), q.value) : [],
);
const matchedPeople = computed(() => (active.value ? rankLocal(people.value, (m) => nameOf(m.pubkey), q.value) : []));

const limit = <T,>(list: T[]) => (tab.value === "all" ? list.slice(0, ALL_TAB_LIMIT) : list);
const show = (section: SearchTab) => tab.value === "all" || tab.value === section;

const messagesLoading = computed(() => active.value && search.isFetching.value && !search.data.value);
const messagesError = computed(() => active.value && search.isError.value && !search.data.value);
const counts = computed(() => ({
  messages: hits.value.length,
  people: matchedPeople.value.length + matchedDms.value.length,
  channels: matchedChannels.value.length,
}));
const nothing = computed(() => {
  if (!active.value || search.isFetching.value || messagesError.value) return false;
  if (tab.value === "all") return !counts.value.messages && !counts.value.people && !counts.value.channels;
  return counts.value[tab.value] === 0;
});

function hitWhere(hit: SearchHit): string {
  if (dmIds.value.has(hit.channelId)) {
    const dm = (conversations.value ?? []).find((c) => c.id === hit.channelId);
    return `DM with ${nameOf(dm ? otherOf(dm) : null)}`;
  }
  const name = channelName(hit.channelId);
  return name ? `#${name}` : "a channel";
}

async function openHit(hit: SearchHit) {
  const target = fromSearchHit(hit, dmIds.value.has(hit.channelId));
  if (target) await openMessageTarget(target);
}
const openChannel = (channelId: string) => router.push({ name: "mobile-channel", params: { channelId } });
const openDm = (conversationId: string) => router.push({ name: "mobile-dm", params: { conversationId } });
const openPerson = (pubkey: string) => ui.openProfile(pubkey);
const roleLabel = (role: string) => (role === "owner" ? "Owner" : role === "admin" ? "Admin" : null);

onMounted(() => {
  // Arriving fresh: straight to typing. Coming back to a search: don't pop the keyboard.
  if (!text.value) input.value?.focus();
});
</script>

<template>
  <MobileLayout show-nav>
    <template #header>
      <MobileHeader title="Search" />
      <div class="field-row">
        <label class="field">
          <AppIcon name="search" :size="20" class="field-icon" />
          <input
            ref="input"
            v-model="text"
            type="search"
            enterkeyhint="search"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            class="field-input"
            :placeholder="`Search ${communityName}`"
            aria-label="Search messages, people and channels"
            data-testid="mobile-search-input"
            @keydown.enter.prevent="input?.blur()"
          />
          <button v-if="text" type="button" class="field-clear" aria-label="Clear search" data-testid="mobile-search-clear" @click="clear">
            <AppIcon name="close" :size="20" />
          </button>
        </label>
      </div>
      <div v-if="active" class="tabs" role="tablist" aria-label="Search results" data-hscroll data-testid="mobile-search-tabs">
        <button
          v-for="t in SEARCH_TABS"
          :key="t.value"
          type="button"
          role="tab"
          class="tab"
          :class="{ active: tab === t.value }"
          :aria-selected="tab === t.value"
          :data-testid="`mobile-search-tab-${t.value}`"
          @click="pickTab(t.value)"
        >
          {{ t.label }}
        </button>
      </div>
    </template>

    <div class="m-search" data-testid="mobile-search">
      <!-- Before a query: where you already work (no invented "recent searches"). -->
      <template v-if="!active">
        <p class="hint">
          {{ text.trim() ? "Type at least 2 characters." : `Messages, people and channels in ${communityName}.` }}
        </p>
        <section v-if="channelList.length" class="section" aria-labelledby="s-jump-ch">
          <h2 id="s-jump-ch" class="section-title">Channels</h2>
          <button v-for="c in channelList.slice(0, 5)" :key="c.id" type="button" class="row" data-testid="search-channel-row" @click="openChannel(c.id)">
            <span class="glyph" aria-hidden="true"><AppIcon :name="c.visibility === 'private' ? 'lock' : 'hash'" :size="20" /></span>
            <span class="text"><span class="title">{{ c.name }}</span></span>
          </button>
        </section>
        <section v-if="conversations?.length" class="section" aria-labelledby="s-jump-dm">
          <h2 id="s-jump-dm" class="section-title">Direct messages</h2>
          <button v-for="d in conversations.slice(0, 5)" :key="d.id" type="button" class="row" data-testid="search-dm-row" @click="openDm(d.id)">
            <AvatarCircle :name="nameOf(otherOf(d))" :avatar-url="profiles.get(otherOf(d) ?? '')?.avatarUrl" :pubkey="otherOf(d) ?? undefined" :size="36" />
            <span class="text"><span class="title">{{ nameOf(otherOf(d)) }}</span></span>
          </button>
        </section>
      </template>

      <template v-else>
        <!-- Messages: the relay's answer -->
        <section v-if="show('messages')" class="section" aria-labelledby="s-msg" :aria-busy="messagesLoading">
          <h2 v-if="tab === 'all' && (hits.length || messagesLoading)" id="s-msg" class="section-title">Messages</h2>
          <h2 v-else id="s-msg" class="visually-hidden">Messages</h2>
          <MobileListSkeleton v-if="messagesLoading" :rows="3" label="Searching messages" />
          <div v-else-if="messagesError" class="error" role="alert" data-testid="mobile-search-error">
            <p>Couldn't search messages.</p>
            <button type="button" class="retry" data-testid="mobile-search-retry" @click="search.refetch()">Retry</button>
          </div>
          <template v-else>
            <button
              v-for="hit in limit(hits)"
              :key="hit.message.id"
              type="button"
              class="row msg"
              data-testid="search-message-row"
              @click="openHit(hit)"
            >
              <AvatarCircle
                :name="nameOf(hit.message.authorPubkey)"
                :avatar-url="profiles.get(hit.message.authorPubkey)?.avatarUrl"
                :pubkey="hit.message.authorPubkey"
                :size="36"
              />
              <span class="text">
                <span class="line1">
                  <span class="title">{{ nameOf(hit.message.authorPubkey) }}</span>
                  <span class="when">{{ shortTime(hit.message.createdAt) }}</span>
                </span>
                <span class="sub">{{ hitWhere(hit) }}<template v-if="hit.message.thread.rootId"> · thread</template></span>
                <span class="preview" data-testid="search-hit-preview"
                  ><MessagePreview
                    raw
                    :content="snippet(hit.message.content, q, 120)"
                    :mentions="hit.message.mentions"
                    :mentions-everyone="!!hit.message.mentionsEveryone"
                /></span>
              </span>
            </button>
            <button v-if="tab === 'all' && hits.length > ALL_TAB_LIMIT" type="button" class="see-all" @click="pickTab('messages')">
              See all {{ hits.length }} messages
            </button>
          </template>
        </section>

        <!-- People: community members and DM partners -->
        <section v-if="show('people') && counts.people" class="section" aria-labelledby="s-ppl">
          <h2 id="s-ppl" :class="tab === 'all' ? 'section-title' : 'visually-hidden'">People</h2>
          <button v-for="d in limit(matchedDms)" :key="`dm-${d.id}`" type="button" class="row" data-testid="search-dm-row" @click="openDm(d.id)">
            <AvatarCircle :name="nameOf(otherOf(d))" :avatar-url="profiles.get(otherOf(d) ?? '')?.avatarUrl" :pubkey="otherOf(d) ?? undefined" :size="36" />
            <span class="text">
              <span class="title">{{ nameOf(otherOf(d)) }}</span>
              <span class="sub">Direct message</span>
            </span>
          </button>
          <button v-for="m in limit(matchedPeople)" :key="m.pubkey" type="button" class="row" data-testid="search-person-row" @click="openPerson(m.pubkey)">
            <AvatarCircle :name="nameOf(m.pubkey)" :avatar-url="profiles.get(m.pubkey)?.avatarUrl" :pubkey="m.pubkey" :size="36" />
            <span class="text">
              <span class="title">{{ nameOf(m.pubkey) }}</span>
              <span class="sub">{{ roleLabel(m.role) ?? "Member" }} · {{ communityName }}</span>
            </span>
          </button>
          <button v-if="tab === 'all' && (matchedDms.length > ALL_TAB_LIMIT || matchedPeople.length > ALL_TAB_LIMIT)" type="button" class="see-all" @click="pickTab('people')">
            See all people
          </button>
        </section>

        <!-- Channels -->
        <section v-if="show('channels') && counts.channels" class="section" aria-labelledby="s-ch">
          <h2 id="s-ch" :class="tab === 'all' ? 'section-title' : 'visually-hidden'">Channels</h2>
          <button v-for="c in limit(matchedChannels)" :key="c.id" type="button" class="row" data-testid="search-channel-row" @click="openChannel(c.id)">
            <span class="glyph" aria-hidden="true"><AppIcon :name="c.visibility === 'private' ? 'lock' : 'hash'" :size="20" /></span>
            <span class="text">
              <span class="title">{{ c.name }}</span>
              <span class="sub">{{ c.visibility === "private" ? "Private" : "Public" }}<template v-if="c.topic"> · {{ c.topic }}</template></span>
            </span>
          </button>
          <button v-if="tab === 'all' && counts.channels > ALL_TAB_LIMIT" type="button" class="see-all" @click="pickTab('channels')">
            See all {{ counts.channels }} channels
          </button>
        </section>

        <div v-if="nothing" class="nothing" role="status" data-testid="mobile-search-empty">
          <span class="nothing-icon" aria-hidden="true"><AppIcon name="search" :size="24" /></span>
          <p class="nothing-title">Nothing found</p>
          <p class="nothing-sub">No {{ tab === "all" ? "results" : tab }} for “{{ q }}”.</p>
        </div>
      </template>
    </div>
  </MobileLayout>
</template>

<style scoped>
.field-row {
  padding: 0 var(--space-4) var(--space-2);
}
.field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-1) 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bg);
}
.field:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-muted);
}
.field-icon {
  flex: none;
  color: var(--color-text-subtle);
}
.field-input {
  flex: 1;
  min-width: 0;
  height: 42px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 16px; /* no iOS zoom on focus */
}
.field-input::-webkit-search-cancel-button {
  display: none;
}
.field-clear {
  flex: none;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: none;
  color: var(--color-text-subtle);
}
.field-clear:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -4px;
}

.tabs {
  display: flex;
  padding: 0 var(--space-2);
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tab {
  position: relative;
  flex: none;
  min-width: 44px;
  min-height: 44px;
  padding: 0 var(--space-3);
  border: none;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 600;
}
.tab.active {
  color: var(--color-primary);
}
.tab.active::after {
  content: "";
  position: absolute;
  left: var(--space-3);
  right: var(--space-3);
  bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--color-primary);
}
.tab:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -4px;
}

.m-search {
  padding-bottom: var(--space-4);
}
.hint {
  margin: var(--space-4) var(--space-4) var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.section {
  margin-top: var(--space-2);
}
.section-title {
  margin: 0;
  padding: var(--space-3) var(--space-4) var(--space-1);
  color: var(--color-text-subtle);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.row {
  width: 100%;
  min-height: 56px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border: none;
  background: none;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.row.msg {
  align-items: flex-start;
  padding-top: var(--space-3);
  padding-bottom: var(--space-3);
}
.row:active {
  background: var(--color-surface-muted);
}
.row:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
}
.glyph {
  flex: none;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.line1 {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.when {
  flex: none;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.preview {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.see-all {
  min-height: 44px;
  margin-left: calc(var(--space-4) + 36px + var(--space-3));
  padding: 0;
  border: none;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 700;
}
.error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: var(--space-2) var(--space-4);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-danger-muted);
  font-size: var(--font-size-sm);
}
.error p {
  margin: 0;
}
.retry {
  min-height: 44px;
  min-width: 44px;
  padding: 0 var(--space-3);
  border: none;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-weight: 700;
}
.nothing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-8, 3rem) var(--space-6, 2rem);
  text-align: center;
}
.nothing-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
}
.nothing-title {
  margin: 0;
  font-weight: 700;
}
.nothing-sub {
  margin: 0;
  max-width: 280px;
  overflow-wrap: anywhere;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
