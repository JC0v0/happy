import React, { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Modal } from '@/modal';
import { CommandPalette } from './CommandPalette';
import { Command } from './types';
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard';
import { useAuth } from '@/auth/AuthContext';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { localizedText } from '@/text';

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { logout } = useAuth();
    const sessions = storage(useShallow((state) => state.sessions));
    const commandPaletteEnabled = storage(useShallow((state) => state.localSettings.commandPaletteEnabled));
    const navigateToSession = useNavigateToSession();

    // Define available commands
    const commands = useMemo((): Command[] => {
        const cmds: Command[] = [
            // Navigation commands
            {
                id: 'sessions',
                title: localizedText('View All Sessions', '查看全部会话', '檢視全部工作階段'),
                subtitle: localizedText('Browse your terminal sessions', '浏览你的终端会话', '瀏覽你的終端機工作階段'),
                icon: 'chatbubbles-outline',
                category: localizedText('Sessions', '会话', '工作階段'),
                action: () => {
                    router.push('/');
                }
            },
            {
                id: 'settings',
                title: localizedText('Settings', '设置', '設定'),
                subtitle: localizedText('Configure your preferences', '配置你的偏好设置', '配置你的偏好設定'),
                icon: 'settings-outline',
                category: localizedText('Navigation', '导航', '導覽'),
                shortcut: '⌘,',
                action: () => {
                    router.push('/settings');
                }
            },
            {
                id: 'account',
                title: localizedText('Account', '账户', '帳戶'),
                subtitle: localizedText('Manage your account', '管理你的账户', '管理你的帳戶'),
                icon: 'person-circle-outline',
                category: localizedText('Navigation', '导航', '導覽'),
                action: () => {
                    router.push('/settings/account');
                }
            },
            {
                id: 'connect',
                title: localizedText('Connect Device', '连接设备', '連線裝置'),
                subtitle: localizedText('Connect a new device via web', '通过网页连接新设备', '透過網頁連線新裝置'),
                icon: 'link-outline',
                category: localizedText('Navigation', '导航', '導覽'),
                action: () => {
                    router.push('/terminal/connect');
                }
            },
        ];

        // Add session-specific commands
        const recentSessions = Object.values(sessions)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 5);

        recentSessions.forEach(session => {
            const sessionName = session.metadata?.name || `${localizedText('Session', '会话', '工作階段')} ${session.id.slice(0, 6)}`;
            cmds.push({
                id: `session-${session.id}`,
                title: sessionName,
                subtitle: session.metadata?.path || localizedText('Switch to session', '切换到会话', '切換到工作階段'),
                icon: 'time-outline',
                category: localizedText('Recent Sessions', '最近会话', '最近工作階段'),
                action: () => {
                    navigateToSession(session.id);
                }
            });
        });

        // System commands
        cmds.push({
            id: 'sign-out',
            title: localizedText('Sign Out', '退出登录', '登出'),
            subtitle: localizedText('Sign out of your account', '退出你的账户', '登出你的帳戶'),
            icon: 'log-out-outline',
            category: localizedText('System', '系统', '系統'),
            action: async () => {
                await logout();
            }
        });

        // Dev commands (if in development)
        if (__DEV__) {
            cmds.push({
                id: 'dev-menu',
                title: localizedText('Developer Menu', '开发者菜单', '開發者選單'),
                subtitle: localizedText('Access developer tools', '访问开发者工具', '存取開發者工具'),
                icon: 'code-slash-outline',
                category: localizedText('Developer', '开发者', '開發者'),
                action: () => {
                    router.push('/dev');
                }
            });
        }

        return cmds;
    }, [router, logout, sessions]);

    const showCommandPalette = useCallback(() => {
        if (Platform.OS !== 'web' || !commandPaletteEnabled) return;
        
        Modal.show({
            component: CommandPalette,
            props: {
                commands,
            }
        } as any);
    }, [commands, commandPaletteEnabled]);

    // Set up global keyboard handler only if feature is enabled
    useGlobalKeyboard(commandPaletteEnabled ? showCommandPalette : () => {});

    return <>{children}</>;
}
