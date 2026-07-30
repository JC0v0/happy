import type { Router } from "expo-router"
import { useRouter } from "expo-router"
import * as React from 'react';
import { storage } from '@/sync/storage';
import { trackSessionSwitched } from '@/track';
import { getNavigatorCanGoBack } from '@/navigation/browserNavigation';
import { resolveSessionBackIntent } from '@/navigation/deviceNavigation';
import { useBrowserNavigationStore } from '@/navigation/browserNavigationStore';

export function navigateToSession(router: Router, sessionId: string) {
    const session = storage.getState().sessions[sessionId];
    if (session) {
        trackSessionSwitched(session);
    }

    router.push(`/session/${encodeURIComponent(sessionId)}`);
}

export function useNavigateToSession() {
    const router = useRouter();
    return (sessionId: string) => {
        navigateToSession(router, sessionId);
    }
}

export function navigateBackFromSession(router: Router, machineId?: string | null) {
    const navigation = useBrowserNavigationStore.getState();
    const intent = resolveSessionBackIntent(
        navigation.routeHistory,
        machineId,
        getNavigatorCanGoBack(router),
    );

    if (intent.kind === 'back') {
        navigation.markRouteBack();
        router.back();
        return;
    }

    router.replace(intent.pathname as never);
}

export function useNavigateBackFromSession(machineId?: string | null) {
    const router = useRouter();
    return React.useCallback(() => {
        navigateBackFromSession(router, machineId);
    }, [machineId, router]);
}
