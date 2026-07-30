import type { RouteHistoryState } from './browserNavigation';

export type DeviceBackIntent =
    | { kind: 'back' }
    | { kind: 'replace'; pathname: string };

export function getMachineWorkspacePath(machineId: string): string {
    return `/machine/${encodeURIComponent(machineId)}`;
}

export function getSessionPath(sessionId: string): string {
    return `/session/${encodeURIComponent(sessionId)}`;
}

function normalizePathname(pathname: string): string {
    const withoutQuery = pathname.split(/[?#]/, 1)[0] || '/';
    return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery;
}

export function resolveSessionBackIntent(
    history: RouteHistoryState | null,
    machineId: string | null | undefined,
    navigatorCanGoBack = true,
): DeviceBackIntent {
    const workspacePath = machineId ? getMachineWorkspacePath(machineId) : '/';
    const previousPath = history && history.cursor > 0
        ? history.stack[history.cursor - 1]
        : null;

    if (navigatorCanGoBack && previousPath && normalizePathname(previousPath) === workspacePath) {
        return { kind: 'back' };
    }

    return { kind: 'replace', pathname: workspacePath };
}

export function resolveSelectedMachineId(
    pathname: string,
    sessionMachineId?: string | null,
): string | null {
    const match = normalizePathname(pathname).match(/^\/machine\/([^/]+)$/);
    if (match) {
        try {
            return decodeURIComponent(match[1]);
        } catch {
            return match[1];
        }
    }

    if (/^\/session\/[^/]+$/.test(normalizePathname(pathname))) {
        return sessionMachineId ?? null;
    }

    return null;
}
