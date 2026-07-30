import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from '@react-navigation/native';
import { Typography } from '@/constants/Typography';
import { formatSecretKeyForBackup } from '@/auth/secretKeyBackup';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { getCurrentLanguage, localizedText, t } from '@/text';
import { layout } from '@/components/layout';
import { useSettingMutable, useProfile } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { useUnistyles } from 'react-native-unistyles';
import { Switch } from '@/components/Switch';
import { useConnectAccount } from '@/hooks/useConnectAccount';
import { getDisplayName } from '@/sync/profile';
import { Image } from 'expo-image';
import { useHappyAction } from '@/hooks/useHappyAction';
import { disconnectGitHub } from '@/sync/apiGithub';
import { fetchPushTokens, type PushToken } from '@/sync/apiPush';
import {
    getCurrentExpoPushToken,
    getCurrentPushDeviceMetadata,
    getPushPermissionInfo,
    requestPushPermissionOrOpenSettings,
    removePushToken,
    syncCurrentPushToken,
    type PushPermissionInfo,
} from '@/sync/pushRegistration';

function formatPushPermissionLabel(permission: PushPermissionInfo | null): string {
    if (!permission) {
        return localizedText('Loading', '加载中', '載入中');
    }
    if (permission.status === 'unsupported') {
        return localizedText('Unavailable', '不可用', '無法使用');
    }
    if (permission.granted) {
        return localizedText('Allowed', '已允许', '已允許');
    }
    if (permission.status === 'denied') {
        return localizedText('Denied', '已拒绝', '已拒絕');
    }
    return localizedText('Not requested', '尚未请求', '尚未要求');
}

function formatPushPermissionSubtitle(permission: PushPermissionInfo | null): string {
    if (!permission) {
        return localizedText(
            'Checking push notification permissions for this device.',
            '正在检查此设备的推送通知权限。',
            '正在檢查此裝置的推播通知權限。',
        );
    }
    if (permission.status === 'unsupported') {
        return localizedText(
            'Push notification permissions are only managed on mobile devices.',
            '推送通知权限只能在移动设备上管理。',
            '推播通知權限只能在行動裝置上管理。',
        );
    }
    if (permission.granted) {
        return localizedText(
            'This device can receive push notifications.',
            '此设备可以接收推送通知。',
            '此裝置可以接收推播通知。',
        );
    }
    if (permission.canAskAgain) {
        return localizedText(
            'The system prompt can still be shown again from the app.',
            'App 仍可再次显示系统权限提示。',
            'App 仍可再次顯示系統權限提示。',
        );
    }
    return localizedText(
        'iOS has stopped prompting. Open system settings to enable notifications again.',
        'iOS 不会再次弹出权限提示，请到系统设置中重新开启通知。',
        'iOS 不會再次顯示權限提示，請到系統設定中重新開啟通知。',
    );
}

function formatPushTokenFingerprint(token: string): string {
    const rawValue = token.replace(/^ExponentPushToken\[/, '').replace(/\]$/, '');
    if (rawValue.length <= 12) {
        return rawValue;
    }
    return `${rawValue.slice(0, 6)}…${rawValue.slice(-6)}`;
}

function formatPushTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString(getCurrentLanguage());
}

function buildPushTokenSubtitle(pushToken: PushToken, options: {
    isCurrentDevice: boolean;
    currentDeviceLabel: string;
    currentAppLabel: string | null;
}): string {
    const lines: string[] = [];
    const separator = localizedText(': ', '：', '：');

    if (options.isCurrentDevice) {
        lines.push(options.currentDeviceLabel);
        if (options.currentAppLabel) {
            lines.push(options.currentAppLabel);
        }
    } else {
        lines.push(localizedText('Other device or stale registration', '其他设备或已失效的注册记录', '其他裝置或已失效的註冊記錄'));
    }

    lines.push(`${localizedText('Registered', '注册时间', '註冊時間')}${separator}${formatPushTimestamp(pushToken.createdAt)}`);
    lines.push(`${localizedText('Last seen', '最后活跃', '最後活躍')}${separator}${formatPushTimestamp(pushToken.updatedAt)}`);
    lines.push(`${localizedText('Server ID', '服务器 ID', '伺服器 ID')}${separator}${pushToken.id}`);
    lines.push(`${localizedText('Token', '令牌', '權杖')}${separator}${formatPushTokenFingerprint(pushToken.token)}`);
    return lines.join('\n');
}

export default React.memo(() => {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const [showSecret, setShowSecret] = useState(false);
    const [copiedRecently, setCopiedRecently] = useState(false);
    const [analyticsOptOut, setAnalyticsOptOut] = useSettingMutable('analyticsOptOut');
    const { connectAccount, isLoading: isConnecting } = useConnectAccount();
    const profile = useProfile();
    const currentPushDevice = useMemo(() => getCurrentPushDeviceMetadata(), []);
    const [pushTokens, setPushTokens] = useState<PushToken[]>([]);
    const [pushPermission, setPushPermission] = useState<PushPermissionInfo | null>(null);
    const [currentPushToken, setCurrentPushToken] = useState<string | null>(null);
    const [loadingPushSettings, setLoadingPushSettings] = useState(false);
    const [requestingPushPermission, setRequestingPushPermission] = useState(false);
    const [refreshingPushToken, setRefreshingPushToken] = useState(false);
    const [deletingPushToken, setDeletingPushToken] = useState<string | null>(null);

    // Get the current secret key
    const currentSecret = auth.credentials?.secret || '';
    const formattedSecret = currentSecret ? formatSecretKeyForBackup(currentSecret) : '';

    // Profile display values
    const displayName = getDisplayName(profile);
    const githubUsername = profile.github?.login;

    const loadPushSettings = useCallback(async (showError = false) => {
        if (!auth.credentials) {
            setPushTokens([]);
            setPushPermission(null);
            setCurrentPushToken(null);
            return;
        }

        setLoadingPushSettings(true);
        try {
            const [tokens, permission, liveToken] = await Promise.all([
                fetchPushTokens(auth.credentials),
                getPushPermissionInfo(),
                getCurrentExpoPushToken(),
            ]);
            setPushTokens(tokens);
            setPushPermission(permission);
            setCurrentPushToken(liveToken);
        } catch (error) {
            console.error('Failed to load push notification settings:', error);
            if (showError) {
                Modal.alert(t('common.error'), localizedText(
                    'Failed to load push notification settings.',
                    '加载推送通知设置失败。',
                    '載入推播通知設定失敗。',
                ));
            }
        } finally {
            setLoadingPushSettings(false);
        }
    }, [auth.credentials]);

    useEffect(() => {
        void loadPushSettings();
    }, [loadPushSettings]);

    useFocusEffect(
        useCallback(() => {
            void loadPushSettings();
        }, [loadPushSettings])
    );

    // GitHub disconnection
    const [disconnecting, handleDisconnectGitHub] = useHappyAction(async () => {
        const confirmed = await Modal.confirm(
            t('modals.disconnectGithub'),
            t('modals.disconnectGithubConfirm'),
            { confirmText: t('modals.disconnect'), destructive: true }
        );
        if (confirmed) {
            await disconnectGitHub(auth.credentials!);
        }
    });

    const handleShowSecret = () => {
        setShowSecret(!showSecret);
    };

    const handleCopySecret = async () => {
        try {
            await Clipboard.setStringAsync(formattedSecret);
            setCopiedRecently(true);
            setTimeout(() => setCopiedRecently(false), 2000);
            Modal.alert(t('common.success'), t('settingsAccount.secretKeyCopied'));
        } catch (error) {
            Modal.alert(t('common.error'), t('settingsAccount.secretKeyCopyFailed'));
        }
    };

    const handleLogout = async () => {
        const confirmed = await Modal.confirm(
            t('common.logout'),
            t('settingsAccount.logoutConfirm'),
            { confirmText: t('common.logout'), destructive: true }
        );
        if (confirmed) {
            auth.logout();
        }
    };

    const handlePushPermissionRequest = useCallback(async () => {
        if (!auth.credentials) {
            return;
        }

        setRequestingPushPermission(true);
        try {
            const result = await requestPushPermissionOrOpenSettings();
            setPushPermission(result.permission);

            if (result.granted) {
                await syncCurrentPushToken(auth.credentials);
                await loadPushSettings();
                Modal.alert(t('common.success'), localizedText(
                    'Push notifications are enabled for this device.',
                    '此设备已开启推送通知。',
                    '此裝置已開啟推播通知。',
                ));
                return;
            }

            await loadPushSettings();

            if (result.openedSettings) {
                Modal.alert(
                    localizedText('Open Settings', '打开系统设置', '開啟系統設定'),
                    localizedText(
                        'The system will not show the permission prompt again, so Happy opened Settings instead.',
                        '系统不会再次显示权限提示，Happy 已为您打开系统设置。',
                        '系統不會再次顯示權限提示，Happy 已為您開啟系統設定。',
                    ),
                );
                return;
            }

            Modal.alert(t('common.error'), localizedText(
                'Push notification permission was not granted.',
                '未获得推送通知权限。',
                '未取得推播通知權限。',
            ));
        } catch (error) {
            console.error('Failed to request push permission:', error);
            Modal.alert(t('common.error'), localizedText(
                'Failed to request push notification permission.',
                '请求推送通知权限失败。',
                '要求推播通知權限失敗。',
            ));
        } finally {
            setRequestingPushPermission(false);
        }
    }, [auth.credentials, loadPushSettings]);

    const handleRefreshCurrentPushToken = useCallback(async () => {
        if (!auth.credentials) {
            return;
        }

        setRefreshingPushToken(true);
        try {
            const result = await syncCurrentPushToken(auth.credentials);
            setPushPermission(result.permission);
            await loadPushSettings();

            if (!result.permission.granted) {
                Modal.alert(t('common.error'), localizedText(
                    'Push notifications are not enabled for this device yet.',
                    '此设备尚未开启推送通知。',
                    '此裝置尚未開啟推播通知。',
                ));
                return;
            }

            Modal.alert(t('common.success'), localizedText(
                'This device push token was refreshed.',
                '此设备的推送令牌已刷新。',
                '此裝置的推播權杖已重新整理。',
            ));
        } catch (error) {
            console.error('Failed to refresh push token:', error);
            Modal.alert(t('common.error'), localizedText(
                'Failed to refresh this device push token.',
                '刷新此设备的推送令牌失败。',
                '重新整理此裝置的推播權杖失敗。',
            ));
        } finally {
            setRefreshingPushToken(false);
        }
    }, [auth.credentials, loadPushSettings]);

    const handleDeletePushToken = useCallback(async (pushToken: PushToken) => {
        if (!auth.credentials) {
            return;
        }

        const confirmed = await Modal.confirm(
            localizedText('Delete Push Token', '删除推送令牌', '刪除推播權杖'),
            localizedText(
                `Remove ${formatPushTokenFingerprint(pushToken.token)} from your account?`,
                `要从账户中删除 ${formatPushTokenFingerprint(pushToken.token)} 吗？`,
                `要從帳戶中刪除 ${formatPushTokenFingerprint(pushToken.token)} 嗎？`,
            ),
            { confirmText: t('common.delete'), destructive: true }
        );

        if (!confirmed) {
            return;
        }

        setDeletingPushToken(pushToken.token);
        try {
            await removePushToken(auth.credentials, pushToken.token);
            await loadPushSettings();
        } catch (error) {
            console.error('Failed to delete push token:', error);
            Modal.alert(t('common.error'), localizedText(
                'Failed to delete push token.',
                '删除推送令牌失败。',
                '刪除推播權杖失敗。',
            ));
        } finally {
            setDeletingPushToken(null);
        }
    }, [auth.credentials, loadPushSettings]);

    return (
        <>
            <ItemList>
                {/* Account Info */}
                <ItemGroup title={t('settingsAccount.accountInformation')}>
                    <Item
                        title={t('settingsAccount.status')}
                        detail={auth.isAuthenticated ? t('settingsAccount.statusActive') : t('settingsAccount.statusNotAuthenticated')}
                        showChevron={false}
                    />
                    <Item
                        title={t('settingsAccount.anonymousId')}
                        detail={sync.anonID || t('settingsAccount.notAvailable')}
                        showChevron={false}
                        copy={!!sync.anonID}
                    />
                    <Item
                        title={t('settingsAccount.publicId')}
                        detail={sync.serverID || t('settingsAccount.notAvailable')}
                        showChevron={false}
                        copy={!!sync.serverID}
                    />
                    {Platform.OS !== 'web' && (
                        <Item
                            title={t('settingsAccount.linkNewDevice')}
                            subtitle={isConnecting ? t('common.scanning') : t('settingsAccount.linkNewDeviceSubtitle')}
                            icon={<Ionicons name="qr-code-outline" size={24} color={theme.semantic.focus} />}
                            onPress={connectAccount}
                            disabled={isConnecting}
                            showChevron={false}
                        />
                    )}
                </ItemGroup>

                {/* Profile Section */}
                {(displayName || githubUsername || profile.avatar) && (
                    <ItemGroup title={t('settingsAccount.profile')}>
                        {displayName && (
                            <Item
                                title={t('settingsAccount.name')}
                                detail={displayName}
                                showChevron={false}
                            />
                        )}
                        {githubUsername && (
                            <Item
                                title={t('settingsAccount.github')}
                                detail={`@${githubUsername}`}
                                subtitle={t('settingsAccount.tapToDisconnect')}
                                onPress={handleDisconnectGitHub}
                                loading={disconnecting}
                                showChevron={false}
                                icon={profile.avatar?.url ? (
                                    <Image
                                        source={{ uri: profile.avatar.url }}
                                        style={{ width: 29, height: 29, borderRadius: 14.5 }}
                                        placeholder={{ thumbhash: profile.avatar.thumbhash }}
                                        contentFit="cover"
                                        transition={200}
                                        cachePolicy="memory-disk"
                                    />
                                ) : (
                                    <Ionicons name="logo-github" size={29} color={theme.colors.textSecondary} />
                                )}
                            />
                        )}
                    </ItemGroup>
                )}

                {/* Backup Section */}
                <ItemGroup
                    title={t('settingsAccount.backup')}
                    footer={t('settingsAccount.backupDescription')}
                >
                    <Item
                        title={t('settingsAccount.secretKey')}
                        subtitle={showSecret ? t('settingsAccount.tapToHide') : t('settingsAccount.tapToReveal')}
                        icon={<Ionicons name={showSecret ? "eye-off-outline" : "eye-outline"} size={24} color={theme.semantic.status.warning} />}
                        onPress={handleShowSecret}
                        showChevron={false}
                    />
                </ItemGroup>

                {/* Secret Key Display */}
                {showSecret && (
                    <ItemGroup>
                        <Pressable onPress={handleCopySecret}>
                            <View style={{
                                backgroundColor: theme.colors.surface,
                                paddingHorizontal: 16,
                                paddingVertical: 14,
                                width: '100%',
                                maxWidth: layout.maxWidth,
                                alignSelf: 'center'
                            }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                    <Text style={{
                                        fontSize: 11,
                                        color: theme.colors.textSecondary,
                                        letterSpacing: 0.5,
                                        textTransform: 'uppercase',
                                        ...Typography.default('semiBold')
                                    }}>
                                        {t('settingsAccount.secretKeyLabel')}
                                    </Text>
                                    <Ionicons
                                        name={copiedRecently ? "checkmark-circle" : "copy-outline"}
                                        size={18}
                                        color={copiedRecently ? theme.semantic.status.success : theme.semantic.textSecondary}
                                    />
                                </View>
                                <Text style={{
                                    fontSize: 13,
                                    letterSpacing: 0.5,
                                    lineHeight: 20,
                                    color: theme.colors.text,
                                    ...Typography.mono()
                                }}>
                                    {formattedSecret}
                                </Text>
                            </View>
                        </Pressable>
                    </ItemGroup>
                )}

                {/* Analytics Section */}
                <ItemGroup
                    title={t('settingsAccount.privacy')}
                    footer={t('settingsAccount.privacyDescription')}
                >
                    <Item
                        title={t('settingsAccount.analytics')}
                        subtitle={analyticsOptOut ? t('settingsAccount.analyticsDisabled') : t('settingsAccount.analyticsEnabled')}
                        rightElement={
                            <Switch
                                value={!analyticsOptOut}
                                onValueChange={(value) => {
                                    const optOut = !value;
                                    setAnalyticsOptOut(optOut);
                                }}
                                trackColor={{ false: theme.semantic.borderStrong, true: theme.semantic.status.success }}
                                thumbColor={theme.semantic.surface}
                            />
                        }
                        showChevron={false}
                    />
                </ItemGroup>

                <ItemGroup
                    title={localizedText('Push Notifications', '推送通知', '推播通知')}
                    footer={localizedText(
                        'Shows every push token registered on your account. Tap an old token to delete it.',
                        '这里会显示账户中注册过的所有推送令牌。点击旧令牌即可删除。',
                        '這裡會顯示帳戶中註冊過的所有推播權杖。點按舊權杖即可刪除。',
                    )}
                >
                    <Item
                        title={localizedText('Permission', '通知权限', '通知權限')}
                        detail={formatPushPermissionLabel(pushPermission)}
                        subtitle={formatPushPermissionSubtitle(pushPermission)}
                        icon={<Ionicons name="notifications-outline" size={24} color={theme.semantic.focus} />}
                        loading={loadingPushSettings}
                        showChevron={false}
                    />
                    <Item
                        title={localizedText('Request Permission Again', '重新请求通知权限', '重新要求通知權限')}
                        subtitle={pushPermission?.status === 'unsupported'
                            ? localizedText(
                                'Push notification permissions are only available on iPhone and Android.',
                                '推送通知权限仅适用于 iPhone 和 Android。',
                                '推播通知權限僅適用於 iPhone 和 Android。',
                            )
                            : pushPermission?.canAskAgain
                            ? localizedText(
                                'Shows the system prompt again if iOS still allows it.',
                                '如果 iOS 允许，将再次显示系统权限提示。',
                                '如果 iOS 允許，將再次顯示系統權限提示。',
                            )
                            : localizedText(
                                'Opens system settings when iOS will not prompt again.',
                                '如果 iOS 不再弹出提示，将直接打开系统设置。',
                                '如果 iOS 不再顯示提示，將直接開啟系統設定。',
                            )}
                        icon={<Ionicons name="shield-checkmark-outline" size={24} color={theme.semantic.status.success} />}
                        onPress={handlePushPermissionRequest}
                        loading={requestingPushPermission}
                        disabled={requestingPushPermission || loadingPushSettings || pushPermission?.status === 'unsupported' || !auth.credentials}
                        showChevron={false}
                    />
                    <Item
                        title={localizedText('Re-register This Device', '重新注册此设备', '重新註冊此裝置')}
                        subtitle={currentPushToken
                            ? localizedText(
                                `Current token ${formatPushTokenFingerprint(currentPushToken)}`,
                                `当前令牌：${formatPushTokenFingerprint(currentPushToken)}`,
                                `目前權杖：${formatPushTokenFingerprint(currentPushToken)}`,
                            )
                            : localizedText(
                                'Fetches the current Expo token and registers it again.',
                                '重新获取当前 Expo 推送令牌并完成注册。',
                                '重新取得目前 Expo 推播權杖並完成註冊。',
                            )}
                        icon={<Ionicons name="refresh-outline" size={24} color={theme.semantic.status.warning} />}
                        onPress={handleRefreshCurrentPushToken}
                        loading={refreshingPushToken}
                        disabled={refreshingPushToken || loadingPushSettings || !auth.credentials}
                        showChevron={false}
                    />
                </ItemGroup>

                <ItemGroup
                    title={localizedText(
                        `Registered Tokens (${pushTokens.length})`,
                        `已注册的令牌（${pushTokens.length}）`,
                        `已註冊的權杖（${pushTokens.length}）`,
                    )}
                    footer={localizedText(
                        'Current-device metadata comes from this phone. Older tokens use their token fingerprint plus server timestamps.',
                        '当前设备信息来自这台手机；旧令牌会显示令牌摘要和服务器记录时间。',
                        '目前裝置資訊來自這支手機；舊權杖會顯示權杖摘要和伺服器記錄時間。',
                    )}
                >
                    {pushTokens.length === 0 ? (
                        <Item
                            title={localizedText('No registered push tokens', '暂无已注册的推送令牌', '暫無已註冊的推播權杖')}
                            subtitle={localizedText(
                                'Once this device is registered, it will appear here.',
                                '此设备注册成功后会显示在这里。',
                                '此裝置註冊成功後會顯示在這裡。',
                            )}
                            showChevron={false}
                        />
                    ) : (
                        <>
                            {pushTokens.map((pushToken) => {
                                const isCurrentDevice = currentPushToken === pushToken.token;
                                return (
                                    <Item
                                        key={pushToken.id}
                                        title={formatPushTokenFingerprint(pushToken.token)}
                                        detail={isCurrentDevice ? localizedText('This device', '当前设备', '目前裝置') : undefined}
                                        subtitle={buildPushTokenSubtitle(pushToken, {
                                            isCurrentDevice,
                                            currentDeviceLabel: currentPushDevice.deviceLabel,
                                            currentAppLabel: currentPushDevice.appLabel
                                                ?.replace('build ', `${localizedText('build', '构建', '建置')} `)
                                                .replace('simulator', localizedText('simulator', '模拟器', '模擬器')) ?? null,
                                        })}
                                        subtitleLines={0}
                                        icon={(
                                            <Ionicons
                                                name={isCurrentDevice ? 'phone-portrait-outline' : 'trash-outline'}
                                                size={29}
                                                color={isCurrentDevice ? theme.semantic.textSecondary : theme.semantic.status.error}
                                            />
                                        )}
                                        onPress={isCurrentDevice ? undefined : () => handleDeletePushToken(pushToken)}
                                        loading={deletingPushToken === pushToken.token}
                                        disabled={deletingPushToken !== null}
                                        showChevron={false}
                                        copy={isCurrentDevice ? pushToken.token : false}
                                    />
                                );
                            })}
                        </>
                    )}
                </ItemGroup>

                {/* Danger Zone */}
                <ItemGroup title={t('settingsAccount.dangerZone')}>
                    <Item
                        title={t('settingsAccount.logout')}
                        subtitle={t('settingsAccount.logoutSubtitle')}
                        icon={<Ionicons name="log-out-outline" size={24} color={theme.semantic.status.error} />}
                        destructive
                        onPress={handleLogout}
                    />
                </ItemGroup>
            </ItemList>
        </>
    );
});
