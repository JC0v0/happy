import { MMKV } from 'react-native-mmkv';

// Separate MMKV instance for server config that persists across logouts
const serverConfigStorage = new MMKV({ id: 'server-config' });

const SERVER_KEY = 'custom-server-url';
const LOG_SERVER_KEY = 'log-server-url';
const DEFAULT_SERVER_URL = 'https://121.40.138.143:443';

export function getServerUrl(): string {
    // Priority: 1) runtime-injected config, 2) explicit user setting,
    // 3) build-time default (EXPO_PUBLIC_HAPPY_SERVER_URL, inlined by Expo),
    // 4) hardcoded fallback.
    //
    // The user setting must beat the build-time default: a dev build bakes
    // EXPO_PUBLIC_HAPPY_SERVER_URL (e.g. http://127.0.0.1:3005) into the
    // bundle, which is unreachable from a physical device. Pointing the app
    // at the dev machine's LAN address from Dev > Server only works if the
    // stored value wins over the inlined one.
    const injected = (globalThis as any).__HAPPY_CONFIG__?.serverUrl;
    if (injected) return injected;

    const stored = serverConfigStorage.getString(SERVER_KEY);
    if (stored) return stored;

    return process.env.EXPO_PUBLIC_HAPPY_SERVER_URL ||
           DEFAULT_SERVER_URL;
}

export function setServerUrl(url: string | null): void {
    if (url && url.trim()) {
        serverConfigStorage.set(SERVER_KEY, url.trim());
    } else {
        serverConfigStorage.delete(SERVER_KEY);
    }
}

export function getLogServerUrl(): string | null {
    return serverConfigStorage.getString(LOG_SERVER_KEY) ||
           process.env.EXPO_PUBLIC_LOG_SERVER_URL ||
           null;
}

export function setLogServerUrl(url: string | null): void {
    if (url && url.trim()) {
        serverConfigStorage.set(LOG_SERVER_KEY, url.trim());
    } else {
        serverConfigStorage.delete(LOG_SERVER_KEY);
    }
}

export function isUsingCustomServer(): boolean {
    return getServerUrl() !== DEFAULT_SERVER_URL;
}

export function getServerInfo(): { hostname: string; port?: number; isCustom: boolean } {
    const url = getServerUrl();
    const isCustom = isUsingCustomServer();
    
    try {
        const parsed = new URL(url);
        const port = parsed.port ? parseInt(parsed.port) : undefined;
        return {
            hostname: parsed.hostname,
            port,
            isCustom
        };
    } catch {
        // Fallback if URL parsing fails
        return {
            hostname: url,
            port: undefined,
            isCustom
        };
    }
}

export function validateServerUrl(url: string): { valid: boolean; error?: string } {
    if (!url || !url.trim()) {
        return { valid: false, error: 'Server URL cannot be empty' };
    }
    
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { valid: false, error: 'Server URL must use HTTP or HTTPS protocol' };
        }
        return { valid: true };
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }
}
