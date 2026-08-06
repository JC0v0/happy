import * as z from 'zod';
import { DEFAULT_USER_MESSAGE_BUBBLE_COLOR } from '../utils/userMessageBubbleColor';

//
// Settings Schema
//

// Current schema version for backward compatibility
export const SUPPORTED_SCHEMA_VERSION = 2;

// Where (and whether) the branch/model/effort/context status bar renders
// around the composer. 'hiddenOnMobile' hides it on phones but shows it
// below the composer on tablet/desktop/web.
export const SESSION_STATUS_BAR_DISPLAY_MODES = ['hidden', 'hiddenOnMobile', 'above', 'below'] as const;
export type SessionStatusBarDisplay = typeof SESSION_STATUS_BAR_DISPLAY_MODES[number];

export const SettingsSchema = z.object({
    // Schema version for compatibility detection
    schemaVersion: z.number().default(SUPPORTED_SCHEMA_VERSION).describe('Settings schema version for compatibility checks'),

    viewInline: z.boolean().describe('Whether to view inline tool calls'),
    inferenceOpenAIKey: z.string().nullish().describe('OpenAI API key for inference'),
    expandTodos: z.boolean().describe('Whether to expand todo lists'),
    showLineNumbers: z.boolean().describe('Whether to show line numbers in diffs'),
    showLineNumbersInToolViews: z.boolean().describe('Whether to show line numbers in tool view diffs'),
    wrapLinesInDiffs: z.boolean().describe('Whether to wrap long lines in diff views'),
    diffStyle: z.enum(['unified', 'split']).describe('Diff view style (split is web-only)'),
    experiments: z.boolean().describe('Whether to enable experimental features'),
    alwaysShowContextSize: z.boolean().describe('Always show context size in agent input'),
    agentInputEnterToSend: z.boolean().describe('Whether pressing Enter submits/sends in the agent input (web)'),
    avatarStyle: z.string().describe('Avatar display style'),
    showFlavorIcons: z.boolean().describe('Whether to show AI provider icons in avatars'),
    userMessageBubbleColor: z.string().describe('User message bubble color preset'),
    sessionStatusBarDisplay: z.enum(SESSION_STATUS_BAR_DISPLAY_MODES).describe('Whether/where to show the branch, model, effort, and context status bar'),

    hideInactiveSessions: z.boolean().describe('Hide inactive sessions in the main list'),
    sortSessionsByActivity: z.boolean().describe('Sort the session list by last activity instead of creation date'),
    expResumeSession: z.boolean().describe('Enable experimental session resume feature'),
    fileDiffsSidebar: z.boolean().describe('Show the file diffs sidebar next to the chat on desktop'),
    groupToolCalls: z.boolean().describe('Collapse consecutive tool calls into grouped containers in chat'),
    expImageUpload: z.boolean().describe('Enable experimental image upload in chat'),
    reviewPromptAnswered: z.boolean().describe('Whether the review prompt has been answered'),
    reviewPromptLikedApp: z.boolean().nullish().describe('Whether user liked the app when asked'),
    preferredLanguage: z.string().nullable().describe('Preferred UI language (null for auto-detect from device locale)'),
    recentMachinePaths: z.array(z.object({
        machineId: z.string(),
        path: z.string()
    })).describe('Last 10 machine-path combinations, ordered by most recent first'),
    lastUsedAgent: z.string().nullable().describe('Last selected agent type (inert — no agent backends remain)'),
    lastUsedPermissionMode: z.string().nullable().describe('Last selected permission mode for new sessions'),
    lastUsedModelMode: z.string().nullable().describe('Last selected model mode for new sessions'),
    // Agent overrides are inert — all agent backends have been removed, but the
    // field still exists in synced settings so older clients don't lose data.
    agentDefaultOverrides: z.record(z.string(), z.unknown()).default({}).describe('User-selected agent defaults (inert — no agent backends remain).'),
    // Dismissed CLI warning banners. Kept as a generic record for backward
    // compatibility — per-agent keys (claude/codex/gemini/openclaw) are inert
    // since all agent backends were removed.
    dismissedCLIWarnings: z.object({
        perMachine: z.record(z.string(), z.record(z.string(), z.boolean()).default({})).default({}),
        global: z.record(z.string(), z.boolean()).default({}),
    }).default({ perMachine: {}, global: {} }).describe('Tracks which CLI installation warnings user has dismissed (per-machine or globally)'),
});

//
// NOTE: Settings must be a flat object with no to minimal nesting, one field == one setting,
// you can name them with a prefix if you want to group them, but don't nest them.
// You can nest if value is a single value (like image with url and width and height)
// Settings are always merged with defaults and field by field.
//
// This structure must be forward and backward compatible. Meaning that some versions of the app
// could be missing some fields or have a new fields. Everything must be preserved and client must
// only touch the fields it knows about.
//

const SettingsSchemaPartial = SettingsSchema.partial();

const REMOVED_VOICE_SETTING_KEYS = [
    'voiceAssistantLanguage',
    'voiceCustomAgentId',
    'voiceBypassToken',
] as const;

function removeLegacyVoiceSettings(settings: Record<string, unknown>) {
    for (const key of REMOVED_VOICE_SETTING_KEYS) {
        delete settings[key];
    }
}

export type Settings = z.infer<typeof SettingsSchema>;

//
// Defaults
//

export const settingsDefaults: Settings = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    viewInline: false,
    inferenceOpenAIKey: null,
    expandTodos: true,
    showLineNumbers: true,
    showLineNumbersInToolViews: false,
    wrapLinesInDiffs: true,
    diffStyle: 'unified',
    experiments: false,
    alwaysShowContextSize: false,
    agentInputEnterToSend: true,
    avatarStyle: 'brutalist',
    showFlavorIcons: false,
    userMessageBubbleColor: DEFAULT_USER_MESSAGE_BUBBLE_COLOR,
    // Hidden everywhere by default — the context usage indicator is still too
    // raw to roll out; users can opt back in from appearance settings.
    sessionStatusBarDisplay: 'hidden',

    hideInactiveSessions: false,
    sortSessionsByActivity: false,
    expResumeSession: false,
    fileDiffsSidebar: false,
    groupToolCalls: false,
    expImageUpload: false,
    reviewPromptAnswered: false,
    reviewPromptLikedApp: null,
    preferredLanguage: null,
    recentMachinePaths: [],
    lastUsedAgent: null,
    lastUsedPermissionMode: null,
    lastUsedModelMode: null,
    agentDefaultOverrides: {},
    dismissedCLIWarnings: { perMachine: {}, global: {} },
};
Object.freeze(settingsDefaults);

//
// Resolving
//

export function settingsParse(settings: unknown): Settings {
    // Handle null/undefined/invalid inputs
    if (!settings || typeof settings !== 'object') {
        return { ...settingsDefaults };
    }

    const parsed = SettingsSchemaPartial.safeParse(settings);
    if (!parsed.success) {
        // For invalid settings, preserve unknown fields but use defaults for known fields
        const unknownFields = { ...(settings as any) };
        // Remove all known schema fields from unknownFields
        const knownFields = Object.keys(SettingsSchema.shape);
        knownFields.forEach(key => delete unknownFields[key]);
        removeLegacyVoiceSettings(unknownFields);
        return { ...settingsDefaults, ...unknownFields };
    }

    // Migration: Convert old 'zh' language code to 'zh-Hans'
    if (parsed.data.preferredLanguage === 'zh') {
        console.log('[Settings Migration] Converting language code from "zh" to "zh-Hans"');
        parsed.data.preferredLanguage = 'zh-Hans';
    }

    // Merge defaults, parsed settings, and preserve unknown fields
    const unknownFields = { ...(settings as any) };
    // Remove known fields from unknownFields to preserve only the unknown ones
    Object.keys(parsed.data).forEach(key => delete unknownFields[key]);
    removeLegacyVoiceSettings(unknownFields);

    return { ...settingsDefaults, ...parsed.data, ...unknownFields };
}

//
// Applying changes
// NOTE: May be something more sophisticated here around defaults and merging, but for now this is fine.
//

export function applySettings(settings: Settings, delta: Partial<Settings>): Settings {
    // Original behavior: start with settings, apply delta, fill in missing with defaults
    const result = { ...settings, ...delta };

    // Fill in any missing fields with defaults
    Object.keys(settingsDefaults).forEach(key => {
        if (!(key in result)) {
            (result as any)[key] = (settingsDefaults as any)[key];
        }
    });

    return result;
}

export function settingsToSyncPayload(settings: Settings): Partial<Settings> {
    const result: Partial<Settings> = { ...settings };
    removeLegacyVoiceSettings(result as Record<string, unknown>);
    // Strip empty agent default overrides to keep the payload small.
    // The field is inert (no agent backends remain) but preserved for
    // backward compatibility with older clients.
    const overrides = settings.agentDefaultOverrides ?? {};
    const compacted = Object.fromEntries(
        Object.entries(overrides).filter(([, value]) => (
            value && typeof value === 'object' && Object.keys(value as object).length > 0
        )),
    );
    if (Object.keys(compacted).length === 0) {
        delete result.agentDefaultOverrides;
    } else {
        result.agentDefaultOverrides = compacted;
    }
    return result;
}
