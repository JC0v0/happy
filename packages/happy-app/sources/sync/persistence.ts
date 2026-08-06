import { MMKV } from 'react-native-mmkv';
import { randomUUID } from 'expo-crypto';
import { Settings, settingsDefaults, settingsParse, settingsToSyncPayload, SettingsSchema } from './settings';
import { LocalSettings, localSettingsDefaults, localSettingsParse } from './localSettings';
import { Profile, profileDefaults, profileParse } from './profile';

type PermissionModeKey = string;

const mmkv = new MMKV();
const NEW_SESSION_DRAFT_KEY = 'new-session-draft-v1';
const REGISTERED_PUSH_TOKEN_KEY = 'registered-push-token-v1';
const TERMINAL_HISTORY_KEY = 'terminal-command-history-v1';
const TERMINAL_HISTORY_ENABLED_KEY = 'terminal-command-history-enabled-v1';
const TERMINAL_DRAFT_PREFIX = 'terminal-command-draft-v1:';
const TERMINAL_LAST_BLOCK_PREFIX = 'terminal-last-block-v1:';
const TERMINAL_FONT_SIZE_KEY = 'terminal-font-size-v1';
const TERMINAL_VIEW_MODE_KEY = 'terminal-view-mode-v1';
const TERMINAL_DEVICE_ID_KEY = 'terminal-device-id-v1';
const MAX_TERMINAL_HISTORY_ENTRIES = 500;

export interface PersistedTerminalHistoryEntry {
    id: string;
    sessionId: string;
    machineId?: string;
    host?: string;
    command: string;
    cwd?: string;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    exitCode: number;
    favorite: boolean;
}

export type TerminalViewMode = 'blocks' | 'raw';

/**
 * Stable identity for this app/browser installation. Terminal sessions use it
 * to select a private PTY while still receiving every device's block records.
 */
export function loadOrCreateTerminalDeviceId(): string {
    const existing = mmkv.getString(TERMINAL_DEVICE_ID_KEY);
    if (existing) {
        return existing;
    }
    const created = `device-${randomUUID()}`;
    mmkv.set(TERMINAL_DEVICE_ID_KEY, created);
    return created;
}

export type NewSessionAgentType = 'claude' | 'codex' | 'gemini' | 'openclaw' | 'agy' | 'terminal';
export type NewSessionSessionType = 'simple' | 'worktree';

export interface NewSessionDraft {
    input: string;
    selectedMachineId: string | null;
    selectedPath: string | null;
    agentType: NewSessionAgentType;
    permissionMode: PermissionModeKey | null;
    modelMode: string | null;
    effortLevel: string | null;
    sessionType: NewSessionSessionType;
    worktreeKey: string | null;
    updatedAt: number;
}

export function loadSettings(): { settings: Settings, version: number | null } {
    const settings = mmkv.getString('settings');
    if (settings) {
        try {
            const parsed = JSON.parse(settings);
            return { settings: settingsParse(parsed.settings), version: parsed.version };
        } catch (e) {
            console.error('Failed to parse settings', e);
            return { settings: { ...settingsDefaults }, version: null };
        }
    }
    return { settings: { ...settingsDefaults }, version: null };
}

export function saveSettings(settings: Settings, version: number) {
    mmkv.set('settings', JSON.stringify({ settings: settingsToSyncPayload(settings), version }));
}

export function loadPendingSettings(): Partial<Settings> {
    const pending = mmkv.getString('pending-settings');
    if (pending) {
        try {
            const parsed = JSON.parse(pending);
            return SettingsSchema.partial().parse(parsed);
        } catch (e) {
            console.error('Failed to parse pending settings', e);
            return {};
        }
    }
    return {};
}

export function savePendingSettings(settings: Partial<Settings>) {
    mmkv.set('pending-settings', JSON.stringify(settings));
}

export function loadLocalSettings(): LocalSettings {
    const localSettings = mmkv.getString('local-settings');
    if (localSettings) {
        try {
            const parsed = JSON.parse(localSettings);
            return localSettingsParse(parsed);
        } catch (e) {
            console.error('Failed to parse local settings', e);
            return { ...localSettingsDefaults };
        }
    }
    return { ...localSettingsDefaults };
}

export function saveLocalSettings(settings: LocalSettings) {
    mmkv.set('local-settings', JSON.stringify(settings));
}

export function loadThemePreference(): 'light' | 'dark' | 'adaptive' {
    const localSettings = mmkv.getString('local-settings');
    if (localSettings) {
        try {
            const parsed = JSON.parse(localSettings);
            const settings = localSettingsParse(parsed);
            return settings.themePreference;
        } catch (e) {
            console.error('Failed to parse local settings for theme preference', e);
            return localSettingsDefaults.themePreference;
        }
    }
    return localSettingsDefaults.themePreference;
}

export function loadSessionDrafts(): Record<string, string> {
    const drafts = mmkv.getString('session-drafts');
    if (drafts) {
        try {
            return JSON.parse(drafts);
        } catch (e) {
            console.error('Failed to parse session drafts', e);
            return {};
        }
    }
    return {};
}

export function saveSessionDrafts(drafts: Record<string, string>) {
    mmkv.set('session-drafts', JSON.stringify(drafts));
}

export function loadNewSessionDraft(): NewSessionDraft | null {
    const raw = mmkv.getString(NEW_SESSION_DRAFT_KEY);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        const input = typeof parsed.input === 'string' ? parsed.input : '';
        const selectedMachineId = typeof parsed.selectedMachineId === 'string' ? parsed.selectedMachineId : null;
        const selectedPath = typeof parsed.selectedPath === 'string' ? parsed.selectedPath : null;
        const agentType: NewSessionAgentType = parsed.agentType === 'codex' || parsed.agentType === 'gemini' || parsed.agentType === 'openclaw' || parsed.agentType === 'agy' || parsed.agentType === 'terminal'
            ? parsed.agentType
            : 'claude';
        const permissionMode: PermissionModeKey | null = typeof parsed.permissionMode === 'string'
            ? parsed.permissionMode
            : null;
        const modelMode: string | null = typeof parsed.modelMode === 'string' ? parsed.modelMode : null;
        const effortLevel: string | null = typeof parsed.effortLevel === 'string' ? parsed.effortLevel : null;
        const sessionType: NewSessionSessionType = parsed.sessionType === 'worktree' ? 'worktree' : 'simple';
        const worktreeKey = typeof parsed.worktreeKey === 'string' ? parsed.worktreeKey : null;
        const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now();

        return {
            input,
            selectedMachineId,
            selectedPath,
            agentType,
            permissionMode,
            modelMode,
            effortLevel,
            sessionType,
            worktreeKey,
            updatedAt,
        };
    } catch (e) {
        console.error('Failed to parse new session draft', e);
        return null;
    }
}

export function saveNewSessionDraft(draft: NewSessionDraft) {
    mmkv.set(NEW_SESSION_DRAFT_KEY, JSON.stringify(draft));
}

export function clearNewSessionDraft() {
    mmkv.delete(NEW_SESSION_DRAFT_KEY);
}

export function loadRegisteredPushToken(): string | null {
    return mmkv.getString(REGISTERED_PUSH_TOKEN_KEY) ?? null;
}

export function saveRegisteredPushToken(token: string) {
    mmkv.set(REGISTERED_PUSH_TOKEN_KEY, token);
}

export function clearRegisteredPushToken() {
    mmkv.delete(REGISTERED_PUSH_TOKEN_KEY);
}

function parseTerminalHistoryEntry(value: unknown): PersistedTerminalHistoryEntry | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const entry = value as Record<string, unknown>;
    if (
        typeof entry.id !== 'string' ||
        typeof entry.sessionId !== 'string' ||
        typeof entry.command !== 'string' ||
        typeof entry.startedAt !== 'number' ||
        typeof entry.endedAt !== 'number' ||
        typeof entry.durationMs !== 'number' ||
        typeof entry.exitCode !== 'number'
    ) {
        return null;
    }
    return {
        id: entry.id,
        sessionId: entry.sessionId,
        ...(typeof entry.machineId === 'string' ? { machineId: entry.machineId } : {}),
        ...(typeof entry.host === 'string' ? { host: entry.host } : {}),
        command: entry.command,
        ...(typeof entry.cwd === 'string' ? { cwd: entry.cwd } : {}),
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        durationMs: entry.durationMs,
        exitCode: entry.exitCode,
        favorite: entry.favorite === true,
    };
}

export function loadTerminalHistory(): PersistedTerminalHistoryEntry[] {
    const raw = mmkv.getString(TERMINAL_HISTORY_KEY);
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.map(parseTerminalHistoryEntry).filter((entry): entry is PersistedTerminalHistoryEntry => entry !== null)
            : [];
    } catch (e) {
        console.error('Failed to parse terminal command history', e);
        return [];
    }
}

function saveTerminalHistory(entries: PersistedTerminalHistoryEntry[]): void {
    mmkv.set(TERMINAL_HISTORY_KEY, JSON.stringify(entries));
}

export function upsertTerminalHistoryEntry(entry: Omit<PersistedTerminalHistoryEntry, 'favorite'>): void {
    if (!isTerminalHistoryEnabled()) {
        return;
    }
    const entries = loadTerminalHistory();
    const existing = entries.find((item) => item.id === entry.id);
    const next = [
        { ...entry, favorite: existing?.favorite ?? false },
        ...entries.filter((item) => item.id !== entry.id),
    ].sort((a, b) => b.endedAt - a.endedAt);
    const favorites = next.filter((item) => item.favorite);
    const recent = next.filter((item) => !item.favorite)
        .slice(0, Math.max(0, MAX_TERMINAL_HISTORY_ENTRIES - favorites.length));
    saveTerminalHistory([...favorites, ...recent].sort((a, b) => b.endedAt - a.endedAt));
}

export function setTerminalHistoryFavorite(id: string, favorite: boolean): void {
    saveTerminalHistory(loadTerminalHistory().map((entry) => entry.id === id ? { ...entry, favorite } : entry));
}

export function clearTerminalHistory(): void {
    mmkv.delete(TERMINAL_HISTORY_KEY);
}

export function isTerminalHistoryEnabled(): boolean {
    return mmkv.getBoolean(TERMINAL_HISTORY_ENABLED_KEY) ?? true;
}

export function setTerminalHistoryEnabled(enabled: boolean): void {
    mmkv.set(TERMINAL_HISTORY_ENABLED_KEY, enabled);
}

export function loadTerminalCommandDraft(sessionId: string): string {
    return mmkv.getString(`${TERMINAL_DRAFT_PREFIX}${sessionId}`) ?? '';
}

export function saveTerminalCommandDraft(sessionId: string, draft: string): void {
    const key = `${TERMINAL_DRAFT_PREFIX}${sessionId}`;
    if (draft.length === 0) {
        mmkv.delete(key);
    } else {
        mmkv.set(key, draft);
    }
}

export function loadTerminalLastBlock(sessionId: string): string | null {
    return mmkv.getString(`${TERMINAL_LAST_BLOCK_PREFIX}${sessionId}`) ?? null;
}

export function saveTerminalLastBlock(sessionId: string, commandId: string): void {
    mmkv.set(`${TERMINAL_LAST_BLOCK_PREFIX}${sessionId}`, commandId);
}

export function loadTerminalFontSize(fallback: number): number {
    const value = mmkv.getNumber(TERMINAL_FONT_SIZE_KEY);
    return typeof value === 'number' && value >= 8 && value <= 24 ? value : fallback;
}

export function saveTerminalFontSize(value: number): void {
    mmkv.set(TERMINAL_FONT_SIZE_KEY, value);
}

export function loadTerminalViewMode(): TerminalViewMode {
    return mmkv.getString(TERMINAL_VIEW_MODE_KEY) === 'raw' ? 'raw' : 'blocks';
}

export function saveTerminalViewMode(mode: TerminalViewMode): void {
    mmkv.set(TERMINAL_VIEW_MODE_KEY, mode);
}

export function loadProfile(): Profile {
    const profile = mmkv.getString('profile');
    if (profile) {
        try {
            const parsed = JSON.parse(profile);
            return profileParse(parsed);
        } catch (e) {
            console.error('Failed to parse profile', e);
            return { ...profileDefaults };
        }
    }
    return { ...profileDefaults };
}

export function saveProfile(profile: Profile) {
    mmkv.set('profile', JSON.stringify(profile));
}

// Simple temporary text storage for passing large strings between screens
export function storeTempText(content: string): string {
    const id = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    mmkv.set(`temp_text_${id}`, content);
    return id;
}

export function retrieveTempText(id: string): string | null {
    const content = mmkv.getString(`temp_text_${id}`);
    if (content) {
        // Auto-delete after retrieval
        mmkv.delete(`temp_text_${id}`);
        return content;
    }
    return null;
}

export function clearPersistence() {
    mmkv.clearAll();
}
