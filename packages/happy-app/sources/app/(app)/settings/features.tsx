import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useSettingMutable, useLocalSettingMutable } from '@/sync/storage';
import { Switch } from '@/components/Switch';
import { localizedText, t } from '@/text';

export default function FeaturesSettingsScreen() {
    const [experiments, setExperiments] = useSettingMutable('experiments');
    const [analyticsOptOut, setAnalyticsOptOut] = useSettingMutable('analyticsOptOut');
    const [agentInputEnterToSend, setAgentInputEnterToSend] = useSettingMutable('agentInputEnterToSend');
    const [commandPaletteEnabled, setCommandPaletteEnabled] = useLocalSettingMutable('commandPaletteEnabled');
    const [markdownCopyV2, setMarkdownCopyV2] = useLocalSettingMutable('markdownCopyV2');
    const [hideInactiveSessions, setHideInactiveSessions] = useSettingMutable('hideInactiveSessions');
    const [expResumeSession, setExpResumeSession] = useSettingMutable('expResumeSession');
    const [fileDiffsSidebar, setFileDiffsSidebar] = useSettingMutable('fileDiffsSidebar');
    const [groupToolCalls, setGroupToolCalls] = useSettingMutable('groupToolCalls');
    const [expImageUpload, setExpImageUpload] = useSettingMutable('expImageUpload');
    const [sortSessionsByActivity, setSortSessionsByActivity] = useSettingMutable('sortSessionsByActivity');

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {/* Interface */}
            <ItemGroup
                title={localizedText('Interface', '界面', '介面')}
                footer={localizedText('Optional panels and layout elements.', '控制可选面板和界面布局。', '控制可選面板和介面配置。')}
            >
                <Item
                    title={localizedText('File Diffs Sidebar', '文件差异侧边栏', '檔案差異側邊欄')}
                    subtitle={localizedText(
                        'Show git changes next to the chat on desktop',
                        '在桌面端聊天旁显示 Git 文件改动',
                        '在桌面端聊天旁顯示 Git 檔案變更',
                    )}
                    icon={<Ionicons name="git-branch-outline" size={29} color="#5AC8FA" />}
                    rightElement={
                        <Switch
                            value={fileDiffsSidebar}
                            onValueChange={setFileDiffsSidebar}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t('settingsFeatures.groupToolCalls')}
                    subtitle={t('settingsFeatures.groupToolCallsSubtitle')}
                    icon={<Ionicons name="layers-outline" size={29} color="#AF52DE" />}
                    rightElement={
                        <Switch
                            value={groupToolCalls}
                            onValueChange={setGroupToolCalls}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={localizedText('Sort by Recent Activity', '按最近活动排序', '依最近活動排序')}
                    subtitle={localizedText(
                        'Order the session list by last activity instead of creation date',
                        '按最后活动时间排列会话，而不是按创建时间',
                        '依最後活動時間排列工作階段，而不是依建立時間',
                    )}
                    icon={<Ionicons name="swap-vertical-outline" size={29} color="#FF9500" />}
                    rightElement={
                        <Switch
                            value={sortSessionsByActivity}
                            onValueChange={setSortSessionsByActivity}
                        />
                    }
                    showChevron={false}
                />
            </ItemGroup>

            {/* Experimental Features */}
            <ItemGroup
                title={t('settingsFeatures.experiments')}
                footer={t('settingsFeatures.experimentsDescription')}
            >
                <Item
                    title={t('settingsFeatures.experimentalFeatures')}
                    subtitle={experiments ? t('settingsFeatures.experimentalFeaturesEnabled') : t('settingsFeatures.experimentalFeaturesDisabled')}
                    icon={<Ionicons name="flask-outline" size={29} color="#5856D6" />}
                    rightElement={
                        <Switch
                            value={experiments}
                            onValueChange={setExperiments}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t('settingsFeatures.markdownCopyV2')}
                    subtitle={t('settingsFeatures.markdownCopyV2Subtitle')}
                    icon={<Ionicons name="text-outline" size={29} color="#34C759" />}
                    rightElement={
                        <Switch
                            value={markdownCopyV2}
                            onValueChange={setMarkdownCopyV2}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t('settingsFeatures.hideInactiveSessions')}
                    subtitle={t('settingsFeatures.hideInactiveSessionsSubtitle')}
                    icon={<Ionicons name="eye-off-outline" size={29} color="#FF9500" />}
                    rightElement={
                        <Switch
                            value={hideInactiveSessions}
                            onValueChange={setHideInactiveSessions}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={localizedText('Resume Session', '恢复会话', '恢復工作階段')}
                    subtitle={localizedText(
                        'Resume disconnected Claude Code and Codex sessions via the machine daemon',
                        '通过设备后台服务恢复已断开的 Claude Code 和 Codex 会话',
                        '透過裝置背景服務恢復已中斷的 Claude Code 和 Codex 工作階段',
                    )}
                    icon={<Ionicons name="play-circle-outline" size={29} color="#30D158" />}
                    rightElement={
                        <Switch
                            value={expResumeSession}
                            onValueChange={setExpResumeSession}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t('settingsFeatures.imageUpload')}
                    subtitle={t('settingsFeatures.imageUploadSubtitle')}
                    icon={<Ionicons name="image-outline" size={29} color="#FF2D55" />}
                    rightElement={
                        <Switch
                            value={expImageUpload}
                            onValueChange={setExpImageUpload}
                        />
                    }
                    showChevron={false}
                />
            </ItemGroup>

            {/* Privacy */}
            <ItemGroup
                title={t('settingsFeatures.privacy')}
                footer={t('settingsFeatures.privacyDescription')}
            >
                <Item
                    title={t('settingsFeatures.disableAnalytics')}
                    subtitle={analyticsOptOut ? t('settingsFeatures.analyticsDisabled') : t('settingsFeatures.analyticsEnabled')}
                    icon={<Ionicons name="analytics-outline" size={29} color="#FF3B30" />}
                    rightElement={
                        <Switch
                            value={analyticsOptOut}
                            onValueChange={setAnalyticsOptOut}
                        />
                    }
                    showChevron={false}
                />
            </ItemGroup>

            {/* Web-only Features */}
            {Platform.OS === 'web' && (
                <ItemGroup 
                    title={t('settingsFeatures.webFeatures')}
                    footer={t('settingsFeatures.webFeaturesDescription')}
                >
                    <Item
                        title={t('settingsFeatures.enterToSend')}
                        subtitle={agentInputEnterToSend ? t('settingsFeatures.enterToSendEnabled') : t('settingsFeatures.enterToSendDisabled')}
                        icon={<Ionicons name="return-down-forward-outline" size={29} color="#007AFF" />}
                        rightElement={
                            <Switch
                                value={agentInputEnterToSend}
                                onValueChange={setAgentInputEnterToSend}
                            />
                        }
                        showChevron={false}
                    />
                    <Item
                        title={t('settingsFeatures.commandPalette')}
                        subtitle={commandPaletteEnabled ? t('settingsFeatures.commandPaletteEnabled') : t('settingsFeatures.commandPaletteDisabled')}
                        icon={<Ionicons name="keypad-outline" size={29} color="#007AFF" />}
                        rightElement={
                            <Switch
                                value={commandPaletteEnabled}
                                onValueChange={setCommandPaletteEnabled}
                            />
                        }
                        showChevron={false}
                    />
                </ItemGroup>
            )}
        </ItemList>
    );
}
