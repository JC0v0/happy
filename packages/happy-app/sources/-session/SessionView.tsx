import { ChatHeaderView } from '@/components/ChatHeaderView';
import { Avatar } from '@/components/Avatar';
import { useIsDataReady, useSession } from '@/sync/storage';
import { t } from '@/text';
import { useDeviceType, useHeaderHeight, useIsLandscape } from '@/utils/responsive';
import { SessionTerminalView } from '@/-session/terminal/SessionTerminalView';
import { resolveTerminalPalette } from '@/-session/terminal/terminalVisualTheme';
import { getSessionAvatarId, getSessionName } from '@/utils/sessionUtils';
import { Ionicons } from '@expo/vector-icons';
import { useNavigateBackFromSession } from '@/hooks/useNavigateToSession';
import * as React from 'react';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';

/**
 * Terminal-only session screen. Chat/agent sessions from older builds are
 * rejected with an explanation instead of the agent UI.
 */
export const SessionView = React.memo((props: { id: string }) => {
    const sessionId = props.id;
    const session = useSession(sessionId);
    const navigateBack = useNavigateBackFromSession(session?.metadata?.machineId);
    const isDataReady = useIsDataReady();
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const headerHeight = useHeaderHeight();

    const terminalPalette = useMemo(
        () => resolveTerminalPalette(theme.semantic, theme.dark ? 'dark' : 'light'),
        [theme],
    );

    const headerProps = useMemo(() => {
        if (!isDataReady) {
            return { title: '', folderName: undefined, isConnected: false };
        }
        if (!session) {
            return { title: t('errors.sessionDeleted'), folderName: undefined, isConnected: false };
        }
        const isConnected = session.presence === 'online';
        const pathSegments = session.metadata?.path?.split(/[/\\]/).filter(Boolean);
        const folderName = pathSegments?.[pathSegments.length - 1];
        return {
            title: getSessionName(session),
            folderName,
            isConnected,
        };
    }, [session, isDataReady]);

    const hideHeader = isLandscape && deviceType === 'phone' && Platform.OS !== 'web';
    const isTerminal = session?.metadata?.flavor === 'terminal';

    return (
        <>
            {/* Stable terminal boundary for landscape safe areas. */}
            {isLandscape && deviceType === 'phone' && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: safeArea.top,
                    backgroundColor: isTerminal ? terminalPalette.chrome : theme.colors.surface,
                    zIndex: 1000,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: isTerminal ? terminalPalette.border : theme.semantic.border,
                }} />
            )}

            {/* Header - always shown on desktop/Mac, hidden in landscape mode only on actual phones */}
            {!hideHeader && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 1000
                }}>
                    <ChatHeaderView
                        title={headerProps.title}
                        folderName={headerProps.folderName}
                        isConnected={headerProps.isConnected}
                        rightSlot={session ? (
                            <Avatar
                                id={getSessionAvatarId(session)}
                                size={28}
                                monochrome={!headerProps.isConnected}
                                flavor={session.metadata?.flavor}
                                clientId={session.metadata?.client?.id}
                            />
                        ) : undefined}
                        onBackPress={navigateBack}
                        backgroundColor={isTerminal ? terminalPalette.chrome : undefined}
                        tintColor={isTerminal ? terminalPalette.text : undefined}
                    />
                </View>
            )}

            {/* Content based on state */}
            <View style={{
                flex: 1,
                paddingTop: !hideHeader ? safeArea.top + headerHeight : 0,
                backgroundColor: isTerminal ? terminalPalette.canvas : theme.colors.surface,
            }}>
                {!isDataReady ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : !session ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <Ionicons name="trash-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={{ color: theme.colors.text, fontSize: 20, marginTop: 16, fontWeight: '600' }}>{t('errors.sessionDeleted')}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 15, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>{t('errors.sessionDeletedDescription')}</Text>
                    </View>
                ) : isTerminal ? (
                    <SessionTerminalView key={sessionId} session={session} />
                ) : (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <Ionicons name="terminal-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={{ color: theme.colors.text, fontSize: 17, marginTop: 16, fontWeight: '600', textAlign: 'center', paddingHorizontal: 32 }}>{t('terminals.unsupportedFlavor')}</Text>
                    </View>
                )}
            </View>
        </>
    );
});
