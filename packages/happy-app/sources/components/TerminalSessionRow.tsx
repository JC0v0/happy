import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from './Item';
import type { Session } from '@/sync/storageTypes';
import { getSessionName, getSessionSubtitle } from '@/utils/sessionUtils';

export const TerminalSessionRow = React.memo(function TerminalSessionRow({
    session,
    onPress,
}: {
    session: Session;
    onPress: (sessionId: string) => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Item
            title={getSessionName(session)}
            subtitle={getSessionSubtitle(session)}
            detail={session.active ? 'ACTIVE' : undefined}
            detailStyle={{
                color: session.active ? theme.semantic.status.success : theme.semantic.textMuted,
            }}
            onPress={() => onPress(session.id)}
            rightElement={(
                <Ionicons name="chevron-forward" size={18} color={theme.semantic.textMuted} />
            )}
        />
    );
});
