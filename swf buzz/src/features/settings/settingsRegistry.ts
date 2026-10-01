import type { IconName } from "@/components/AppIcon.vue";

/**
 * The SWF Settings sections -- an ALLOWLIST, not a filter.
 *
 * OLD BUZZ builds its Settings nav from every section it has and hides some
 * behind feature gates that fail OPEN (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md
 * \u00A72.2): a gate id missing from the manifest shows the section. SWF does the
 * opposite -- a section exists only if it is listed here. Agents, Compute,
 * Experiments, Hosted communities, Channel templates, Voice and Local archive
 * are deliberately absent and cannot come back through a flag.
 */
export const SETTINGS_SECTION_IDS = [
  "profile",
  "appearance",
  "notifications",
  "shortcuts",
  "custom-emoji",
  "mobile",
  "updates",
  "communities",
  "community",
  "invites",
  "feedback",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export type SettingsGroupId = "profile" | "app" | "communities" | "support";

export interface SettingsSectionDef {
  id: SettingsSectionId;
  group: SettingsGroupId;
  label: string;
  description: string;
  icon: IconName;
  /** Extra words the settings search matches besides the label. */
  keywords: string[];
  /** Shown only to community owners/admins (the relay remains the authority). */
  requiresCommunityManager?: boolean;
}

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "app", label: "App" },
  { id: "communities", label: "Communities" },
  { id: "support", label: "Support" },
];

export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  {
    id: "profile",
    group: "profile",
    label: "Profile",
    description: "Your name, photo and identity across every SWF community.",
    icon: "user",
    keywords: ["name", "avatar", "photo", "about", "bio", "public key", "npub", "nip-05", "identity"],
  },
  {
    id: "appearance",
    group: "app",
    label: "Appearance",
    description: "Theme, color mode, text size and density.",
    icon: "palette",
    keywords: ["theme", "dark", "light", "color", "accent", "font", "text size", "density", "zoom"],
  },
  {
    id: "notifications",
    group: "app",
    label: "Notifications",
    description: "Desktop alerts, sounds and badges.",
    icon: "bell",
    keywords: ["alerts", "sound", "badge", "mentions", "direct messages", "dm", "thread", "needs action"],
  },
  {
    id: "shortcuts",
    group: "app",
    label: "Shortcuts",
    description: "Keyboard shortcuts available in SWF Buzz.",
    icon: "keyboard",
    keywords: ["keyboard", "keys", "hotkeys", "keybindings"],
  },
  {
    id: "custom-emoji",
    group: "app",
    label: "Custom emoji",
    description: "Upload emoji everyone in this community can use.",
    icon: "smile",
    keywords: ["emoji", "reactions", "shortcode", "sticker"],
  },
  {
    id: "communities",
    group: "communities",
    label: "Communities",
    description: "Communities this identity can open, and switching between them.",
    icon: "users",
    keywords: ["communities", "switch", "relay", "membership", "role", "join", "add community", "operator"],
  },
  {
    id: "community",
    group: "communities",
    label: "This community",
    description: "The open community's name, icon, members and roles.",
    icon: "building",
    keywords: ["community", "members", "roles", "icon", "relay", "leave", "admin", "owner"],
  },
  {
    id: "invites",
    group: "communities",
    label: "Invites",
    description: "Invite people to this community.",
    icon: "ticket",
    keywords: ["invite", "link", "join"],
    requiresCommunityManager: true,
  },
  {
    id: "mobile",
    group: "app",
    label: "Mobile",
    description: "Connect the SWF Buzz mobile app.",
    icon: "smartphone",
    keywords: ["phone", "pairing", "qr", "mobile app"],
  },
  {
    id: "updates",
    group: "app",
    label: "Updates",
    description: "Current version and software updates.",
    icon: "download",
    keywords: ["version", "update", "upgrade", "release"],
  },
  {
    id: "feedback",
    group: "support",
    label: "Send feedback",
    description: "Tell the SWF team what's broken, what works, or what could be better.",
    icon: "message",
    keywords: ["feedback", "bug", "report", "praise", "support", "help", "problem"],
  },
];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "profile";

export function isSettingsSection(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

export function settingsSection(id: SettingsSectionId): SettingsSectionDef {
  return SETTINGS_SECTIONS.find((s) => s.id === id)!;
}

/** Sections this person may see, in nav order. */
export function visibleSettingsSections(opts: { canManageCommunity: boolean }): SettingsSectionDef[] {
  return SETTINGS_SECTIONS.filter((s) => !s.requiresCommunityManager || opts.canManageCommunity);
}

/** Case-insensitive match on label, description and keywords. */
export function searchSettings(query: string, sections: readonly SettingsSectionDef[]): SettingsSectionDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sections];
  return sections.filter((s) =>
    [s.label, s.description, ...s.keywords].some((text) => text.toLowerCase().includes(q)),
  );
}
