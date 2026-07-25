import * as React from 'react';
import { DropdownMenu, DropdownMenuItem } from '@expo/ui/jetpack-compose';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';

interface SessionActionsNativeMenuProps {
    children: React.ReactNode;
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    session: Session;
}

export function SessionActionsNativeMenu({
    children,
    onAfterArchive,
    onAfterDelete,
    session,
}: SessionActionsNativeMenuProps) {
    const {
        archiveSession,
        canArchive,
        canCopySessionMetadata,
        copySessionMetadata,
    } = useSessionQuickActions(session, {
        onAfterArchive,
        onAfterDelete,
    });

    return (
        <DropdownMenu>
            <DropdownMenu.Items>
                {canArchive && (
                    <DropdownMenuItem onClick={archiveSession}>
                        <DropdownMenuItem.Text>Archive</DropdownMenuItem.Text>
                    </DropdownMenuItem>
                )}
                {canCopySessionMetadata && (
                    <DropdownMenuItem onClick={copySessionMetadata}>
                        <DropdownMenuItem.Text>{t('sessionInfo.copyMetadata')}</DropdownMenuItem.Text>
                    </DropdownMenuItem>
                )}
            </DropdownMenu.Items>
            <DropdownMenu.Trigger>{children}</DropdownMenu.Trigger>
        </DropdownMenu>
    );
}
