import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { TerminalSessionRow } from '@/components/TerminalSessionRow';
import { Text } from '@/components/ui/text';
import { MultiTextInput, type MultiTextInputHandle } from '@/components/MultiTextInput';
import type { DeviceWorkspaceProjection } from './deviceWorkspaceModel';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { getMachineDisplayName } from '@/utils/machineUtils';
import { t } from '@/text';

interface DeviceWorkspaceProps {
    projection: DeviceWorkspaceProjection;
    customPath: string;
    onCustomPathChange: (value: string) => void;
    inputRef: React.RefObject<MultiTextInputHandle | null>;
    isSpawning: boolean;
    showAllPaths: boolean;
    onToggleAllPaths: () => void;
    onStartTerminal: () => void;
    onOpenSession: (sessionId: string) => void;
    children?: React.ReactNode;
}

export const DeviceWorkspace = React.memo(function DeviceWorkspace({
    projection,
    customPath,
    onCustomPathChange,
    inputRef,
    isSpawning,
    showAllPaths,
    onToggleAllPaths,
    onStartTerminal,
    onOpenSession,
    children,
}: DeviceWorkspaceProps) {
    const { theme } = useUnistyles();
    const machine = projection.machine;
    if (!machine) return null;

    const machineName = getMachineDisplayName(machine);
    const statusLabel = projection.presence === 'unverified'
        ? t('deviceFirst.presenceUnverified')
        : t(`status.${projection.presence}`);
    const statusColor = projection.presence === 'online'
        ? theme.semantic.status.success
        : projection.presence === 'offline'
            ? theme.semantic.status.offline
            : theme.semantic.status.warning;
    const pathsToShow = showAllPaths ? projection.recentPaths : projection.recentPaths.slice(0, 5);

    return (
        <>
            <View style={styles.identity}>
                <View style={[styles.statusRail, { backgroundColor: statusColor }]} />
                <View style={styles.identityCopy}>
                    <Text variant="label">{t('deviceFirst.workspace')}</Text>
                    <Text variant="display" numberOfLines={1}>{machineName}</Text>
                    <View style={styles.identityMeta}>
                        <Text variant="label" style={{ color: statusColor }}>{statusLabel}</Text>
                        {machine.metadata?.platform && (
                            <Text variant="mono" style={styles.muted}>{machine.metadata.platform}</Text>
                        )}
                    </View>
                </View>
            </View>

            {projection.presence !== 'online' && (
                <ItemGroup>
                    <Item
                        title={projection.presence === 'offline'
                            ? t('machine.offlineUnableToSpawn')
                            : t('deviceFirst.presenceUnverified')}
                        subtitle={projection.presence === 'offline'
                            ? t('machine.offlineHelp')
                            : t('deviceFirst.reconnectToStart')}
                        subtitleLines={0}
                        showChevron={false}
                    />
                </ItemGroup>
            )}

            {projection.activeSessions.length > 0 && (
                <ItemGroup title={t('deviceFirst.activeTerminals')}>
                    {projection.activeSessions.map((session) => (
                        <TerminalSessionRow key={session.id} session={session} onPress={onOpenSession} />
                    ))}
                </ItemGroup>
            )}

            {projection.recentSessions.length > 0 && (
                <ItemGroup title={t('deviceFirst.recentTerminals')}>
                    {projection.recentSessions.map((session) => (
                        <TerminalSessionRow key={session.id} session={session} onPress={onOpenSession} />
                    ))}
                </ItemGroup>
            )}

            {projection.activeSessions.length === 0 && projection.recentSessions.length === 0 && (
                <View style={styles.emptySessions}>
                    <Text variant="title">{t('deviceFirst.noTerminalHistory')}</Text>
                    <Text variant="muted">{t('deviceFirst.noTerminalHistoryDescription')}</Text>
                </View>
            )}

            <ItemGroup title={t('machine.launchNewSessionInDirectory')}>
                <View style={!projection.canSpawn ? styles.disabled : undefined}>
                    <View style={styles.pathInputContainer}>
                        <View style={styles.pathInput}>
                            <MultiTextInput
                                ref={inputRef}
                                value={customPath}
                                onChangeText={onCustomPathChange}
                                placeholder={t('deviceFirst.homeDirectoryPlaceholder')}
                                maxHeight={76}
                                paddingTop={8}
                                paddingBottom={8}
                                paddingRight={48}
                            />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t('deviceFirst.startTerminal')}
                                onPress={onStartTerminal}
                                disabled={!projection.canSpawn || isSpawning}
                                style={({ pressed }) => [
                                    styles.startButton,
                                    (!projection.canSpawn || isSpawning) && styles.startButtonDisabled,
                                    pressed && styles.startButtonPressed,
                                ]}
                            >
                                <Ionicons
                                    name={isSpawning ? 'ellipsis-horizontal' : 'play'}
                                    size={16}
                                    color={projection.canSpawn
                                        ? theme.semantic.textInverse
                                        : theme.semantic.textMuted}
                                />
                            </Pressable>
                        </View>
                    </View>
                    {pathsToShow.map((path, index) => {
                        const display = formatPathRelativeToHome(path, machine.metadata?.homeDir);
                        const selected = customPath.trim() === display;
                        return (
                            <Item
                                key={path}
                                title={display}
                                leftElement={<Ionicons name="folder-outline" size={18} color={theme.semantic.textSecondary} />}
                                onPress={projection.canSpawn ? () => {
                                    onCustomPathChange(display);
                                    setTimeout(() => inputRef.current?.focus(), 50);
                                } : undefined}
                                disabled={!projection.canSpawn}
                                selected={selected}
                                showChevron={false}
                                showDivider={index !== pathsToShow.length - 1 || projection.recentPaths.length > 5}
                            />
                        );
                    })}
                    {projection.recentPaths.length > 5 && (
                        <Item
                            title={showAllPaths
                                ? t('machineLauncher.showLess')
                                : t('machineLauncher.showAll', { count: projection.recentPaths.length })}
                            onPress={onToggleAllPaths}
                            showChevron={false}
                            showDivider={false}
                            titleStyle={{ textAlign: 'center', color: theme.semantic.focus }}
                        />
                    )}
                </View>
            </ItemGroup>

            {children}
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    identity: {
        flexDirection: 'row',
        minHeight: 132,
        marginTop: 12,
        backgroundColor: theme.semantic.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.border,
    },
    statusRail: {
        width: 4,
    },
    identityCopy: {
        flex: 1,
        justifyContent: 'center',
        gap: 6,
        padding: 20,
    },
    identityMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    muted: {
        color: theme.semantic.textMuted,
    },
    emptySessions: {
        gap: 6,
        paddingHorizontal: 20,
        paddingVertical: 28,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.border,
    },
    pathInputContainer: {
        padding: 12,
    },
    pathInput: {
        minHeight: 46,
        position: 'relative',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.borderStrong,
        borderRadius: theme.geometry.radius.interactive,
        backgroundColor: theme.semantic.surfaceMuted,
        paddingHorizontal: 12,
    },
    startButton: {
        position: 'absolute',
        right: 6,
        bottom: 6,
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.geometry.radius.interactive,
        backgroundColor: theme.semantic.control,
    },
    startButtonDisabled: {
        backgroundColor: theme.semantic.surfaceSelected,
    },
    startButtonPressed: {
        opacity: 0.75,
    },
    disabled: {
        opacity: 0.55,
    },
}));
