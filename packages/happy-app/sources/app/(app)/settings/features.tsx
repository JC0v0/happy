import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useSettingMutable } from '@/sync/storage';
import { Switch } from '@/components/Switch';
import { localizedText, t } from '@/text';
import { useUnistyles } from 'react-native-unistyles';

export default function FeaturesSettingsScreen() {
    const { theme } = useUnistyles();
    const [hideInactiveSessions, setHideInactiveSessions] = useSettingMutable('hideInactiveSessions');
    const [sortSessionsByActivity, setSortSessionsByActivity] = useSettingMutable('sortSessionsByActivity');

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {/* Interface */}
            <ItemGroup
                title={localizedText('Interface', '界面', '介面')}
                footer={localizedText('Optional panels and layout elements.', '控制可选面板和界面布局。', '控制可選面板和介面配置。')}
            >
                <Item
                    title={localizedText('Sort by Recent Activity', '按最近活动排序', '依最近活動排序')}
                    subtitle={localizedText(
                        'Order the session list by last activity instead of creation date',
                        '按最后活动时间排列会话，而不是按创建时间',
                        '依最後活動時間排列工作階段，而不是依建立時間',
                    )}
                    icon={<Ionicons name="swap-vertical-outline" size={24} color={theme.semantic.status.warning} />}
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
                    title={t('settingsFeatures.hideInactiveSessions')}
                    subtitle={t('settingsFeatures.hideInactiveSessionsSubtitle')}
                    icon={<Ionicons name="eye-off-outline" size={24} color={theme.semantic.status.warning} />}
                    rightElement={
                        <Switch
                            value={hideInactiveSessions}
                            onValueChange={setHideInactiveSessions}
                        />
                    }
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
}
