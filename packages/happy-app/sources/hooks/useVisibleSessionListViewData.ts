import * as React from 'react';
import { SessionListViewItem, useSessionListViewData, useSetting } from '@/sync/storage';

/**
 * Keep only terminal-flavor sessions in list view data, dropping headers,
 * project groups and the archive toggle that end up empty. Used by the
 * terminal-only home view.
 */
export function filterTerminalListViewData(data: SessionListViewItem[] | null): SessionListViewItem[] | null {
    if (!data) {
        return data;
    }

    const out: SessionListViewItem[] = [];
    let pendingHeader: SessionListViewItem | null = null;
    let pendingProjectGroup: SessionListViewItem | null = null;
    let hasKeptInactive = false;

    const flushPending = () => {
        if (pendingHeader) {
            out.push(pendingHeader);
        }
        if (pendingProjectGroup) {
            out.push(pendingProjectGroup);
        }
        pendingHeader = null;
        pendingProjectGroup = null;
    };

    for (const item of data) {
        switch (item.type) {
            case 'active-sessions': {
                const sessions = item.sessions.filter((s) => s.flavor === 'terminal');
                if (sessions.length > 0) {
                    out.push({ type: 'active-sessions', sessions });
                }
                break;
            }
            case 'archive-toggle':
                break; // re-inserted at the end only when inactive terminals exist
            case 'header':
                pendingHeader = item;
                pendingProjectGroup = null;
                break;
            case 'project-group':
                pendingProjectGroup = item;
                break;
            case 'session':
                if (item.session.flavor === 'terminal') {
                    flushPending();
                    out.push(item);
                    hasKeptInactive = true;
                }
                break;
        }
    }

    if (hasKeptInactive) {
        const toggle = data.find((i) => i.type === 'archive-toggle');
        if (toggle) {
            const firstNonActive = out.findIndex((i) => i.type !== 'active-sessions');
            out.splice(firstNonActive === -1 ? out.length : firstNonActive, 0, toggle);
        }
    }

    return out;
}

export function useVisibleSessionListViewData(): SessionListViewItem[] | null {
    const data = useSessionListViewData();
    const hideInactiveSessions = useSetting('hideInactiveSessions');

    return React.useMemo(() => {
        if (!data) {
            return data;
        }

        const result: SessionListViewItem[] = [];
        let hasInactive = false;

        // First pass: add active sessions group and check if inactive sessions exist
        for (const item of data) {
            if (item.type === 'active-sessions') {
                result.push(item);
            } else if (item.type === 'session' && !item.session.active) {
                hasInactive = true;
            }
        }

        // Insert archive toggle if there are inactive sessions
        if (hasInactive) {
            result.push({ type: 'archive-toggle', hidden: hideInactiveSessions });
        }

        // If not hiding, add all remaining items (headers, project groups, inactive sessions)
        if (!hideInactiveSessions) {
            let pendingProjectGroup: SessionListViewItem | null = null;

            for (const item of data) {
                if (item.type === 'active-sessions') {
                    continue; // already added
                }

                if (item.type === 'project-group') {
                    pendingProjectGroup = item;
                    continue;
                }

                if (item.type === 'session') {
                    if (!item.session.active) {
                        if (pendingProjectGroup) {
                            result.push(pendingProjectGroup);
                            pendingProjectGroup = null;
                        }
                        result.push(item);
                    }
                    continue;
                }

                pendingProjectGroup = null;

                if (item.type === 'header') {
                    result.push(item);
                }
            }
        }

        return result;
    }, [data, hideInactiveSessions]);
}
