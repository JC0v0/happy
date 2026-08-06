import * as React from 'react';
import { ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { useLocalSettingMutable, useSocketStatus } from '@/sync/storage';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { getServerUrl, setServerUrl, validateServerUrl, getLogServerUrl, setLogServerUrl } from '@/sync/serverConfig';
import { Switch } from '@/components/Switch';
import { useUnistyles } from 'react-native-unistyles';
import { setLastViewedTitle } from '@/changelog';
import { getCurrentLanguage, localizedText } from '@/text';

const devText = (english: string, simplifiedChinese: string, traditionalChinese: string): string => (
    localizedText(english, simplifiedChinese, traditionalChinese)
);

const getSocketStatusLabel = (status: ReturnType<typeof useSocketStatus>['status']): string => {
    switch (status) {
        case 'disconnected':
            return devText('disconnected', '未连接', '未連線');
        case 'connecting':
            return devText('connecting', '连接中', '連線中');
        case 'connected':
            return devText('connected', '已连接', '已連線');
        case 'error':
            return devText('error', '错误', '錯誤');
    }
};

export default function DevScreen() {
    const router = useRouter();
    const [debugMode, setDebugMode] = useLocalSettingMutable('debugMode');
    const [verboseLogging, setVerboseLogging] = useLocalSettingMutable('verboseLogging');
    const [consoleLoggingEnabled, setConsoleLoggingEnabled] = useLocalSettingMutable('consoleLoggingEnabled');
    const socketStatus = useSocketStatus();
    const anonymousId = sync.encryption!.anonID;
    const { theme } = useUnistyles();

    const handleEditServerUrl = async () => {
        const currentUrl = getServerUrl();

        const newUrl = await Modal.prompt(
            devText('Edit API Endpoint', '编辑 API 地址', '編輯 API 位址'),
            devText('Enter the server URL:', '请输入服务器地址：', '請輸入伺服器位址：'),
            {
                defaultValue: currentUrl,
                confirmText: devText('Save', '保存', '儲存')
            }
        );

        if (newUrl && newUrl !== currentUrl) {
            const validation = validateServerUrl(newUrl);
            if (validation.valid) {
                setServerUrl(newUrl);
                Modal.alert(
                    devText('Success', '成功', '成功'),
                    devText('Server URL updated. Please restart the app for changes to take effect.', '服务器地址已更新，请重启 App 使更改生效。', '伺服器位址已更新，請重新啟動 App 使變更生效。'),
                );
            } else {
                Modal.alert(
                    devText('Invalid URL', '地址无效', '位址無效'),
                    validation.error || devText('Please enter a valid URL', '请输入有效的服务器地址', '請輸入有效的伺服器位址'),
                );
            }
        }
    };

    const handleEditLogServerUrl = async () => {
        const currentUrl = getLogServerUrl() || '';

        const newUrl = await Modal.prompt(
            devText('Remote Log Server', '远程日志服务器', '遠端日誌伺服器'),
            devText(
                'Sends ALL console output as unencrypted plaintext over HTTP to this URL. Use your Mac\'s local IP (e.g. http://192.168.1.5:8787). Run "yarn app-logs" on your Mac to receive. Clear to disable.',
                '所有控制台日志都会通过 HTTP 以未加密的明文发送到此地址。请使用 Mac 的局域网 IP（例如 http://192.168.1.5:8787），并在 Mac 上运行“yarn app-logs”接收日志。清空地址可关闭此功能。',
                '所有主控台日誌都會透過 HTTP 以未加密的純文字傳送到此位址。請使用 Mac 的區域網路 IP（例如 http://192.168.1.5:8787），並在 Mac 上執行「yarn app-logs」接收日誌。清空位址可關閉此功能。',
            ),
            {
                defaultValue: currentUrl,
                confirmText: devText('Save', '保存', '儲存')
            }
        );

        if (newUrl !== undefined && newUrl !== currentUrl) {
            if (!newUrl || !newUrl.trim()) {
                setLogServerUrl(null);
                Modal.alert(
                    devText('Success', '成功', '成功'),
                    devText('Remote logging disabled. Restart app for changes to take effect.', '远程日志已关闭，请重启 App 使更改生效。', '遠端日誌已關閉，請重新啟動 App 使變更生效。'),
                );
            } else {
                const validation = validateServerUrl(newUrl);
                if (validation.valid) {
                    setLogServerUrl(newUrl);
                    Modal.alert(
                        devText('Success', '成功', '成功'),
                        devText('Log server URL updated. Restart app for changes to take effect.', '日志服务器地址已更新，请重启 App 使更改生效。', '日誌伺服器位址已更新，請重新啟動 App 使變更生效。'),
                    );
                } else {
                    Modal.alert(
                        devText('Invalid URL', '地址无效', '位址無效'),
                        validation.error || devText('Please enter a valid URL', '请输入有效的服务器地址', '請輸入有效的伺服器位址'),
                    );
                }
            }
        }
    };

    const handleClearCache = async () => {
        const confirmed = await Modal.confirm(
            devText('Clear Cache', '清除缓存', '清除快取'),
            devText('Are you sure you want to clear all cached data?', '确定要清除所有缓存数据吗？', '確定要清除所有快取資料嗎？'),
            { confirmText: devText('Clear', '清除', '清除'), destructive: true }
        );
        if (confirmed) {
            console.log('Cache cleared');
            Modal.alert(devText('Success', '成功', '成功'), devText('Cache has been cleared', '缓存已清除', '快取已清除'));
        }
    };

    // Helper function to format time ago
    const formatTimeAgo = (timestamp: number | null): string => {
        if (!timestamp) return '';

        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 10) return devText('Just now', '刚刚', '剛剛');
        if (seconds < 60) return devText(`${seconds}s ago`, `${seconds} 秒前`, `${seconds} 秒前`);
        if (minutes < 60) return devText(`${minutes}m ago`, `${minutes} 分钟前`, `${minutes} 分鐘前`);
        if (hours < 24) return devText(`${hours}h ago`, `${hours} 小时前`, `${hours} 小時前`);
        if (days < 7) return devText(`${days}d ago`, `${days} 天前`, `${days} 天前`);

        return new Date(timestamp).toLocaleDateString(getCurrentLanguage());
    };

    // Helper function to get socket status subtitle
    const getSocketStatusSubtitle = (): string => {
        const { status, lastConnectedAt, lastDisconnectedAt } = socketStatus;

        if (status === 'connected' && lastConnectedAt) {
            return devText(`Connected ${formatTimeAgo(lastConnectedAt)}`, `已连接 · ${formatTimeAgo(lastConnectedAt)}`, `已連線 · ${formatTimeAgo(lastConnectedAt)}`);
        } else if ((status === 'disconnected' || status === 'error') && lastDisconnectedAt) {
            return devText(`Last connected ${formatTimeAgo(lastDisconnectedAt)}`, `已断开 · ${formatTimeAgo(lastDisconnectedAt)}`, `已中斷 · ${formatTimeAgo(lastDisconnectedAt)}`);
        } else if (status === 'connecting') {
            return devText('Connecting to server...', '正在连接服务器…', '正在連線伺服器…');
        }

        return devText('No connection info', '暂无连接信息', '暫無連線資訊');
    };

    // Socket status indicator component
    const SocketStatusIndicator = () => {
        switch (socketStatus.status) {
            case 'connected':
                return <Ionicons name="checkmark-circle" size={22} color="#34C759" />;
            case 'connecting':
                return <ActivityIndicator size="small" color={theme.colors.textSecondary} />;
            case 'error':
                return <Ionicons name="close-circle" size={22} color="#FF3B30" />;
            case 'disconnected':
                return <Ionicons name="close-circle" size={22} color="#FF9500" />;
            default:
                return <Ionicons name="help-circle" size={22} color="#8E8E93" />;
        }
    };

    return (
        <ItemList>
            {/* App Information */}
            <ItemGroup title={devText('App Information', '应用信息', '應用程式資訊')}>
                <Item
                    title={devText('Version', '版本', '版本')}
                    detail={Constants.expoConfig?.version || '1.0.0'}
                />
                <Item
                    title={devText('Build Number', '构建号', '建置編號')}
                    detail={Application.nativeBuildVersion || devText('N/A', '不可用', '無法使用')}
                />
                <Item
                    title={devText('SDK Version', 'SDK 版本', 'SDK 版本')}
                    detail={Constants.expoConfig?.sdkVersion || devText('Unknown', '未知', '未知')}
                />
                <Item
                    title={devText('Platform', '平台', '平台')}
                    detail={`${Constants.platform?.ios ? 'iOS' : 'Android'} ${Constants.systemVersion || ''}`}
                />
                <Item
                    title={devText('Anonymous ID', '匿名 ID', '匿名 ID')}
                    detail={anonymousId}
                />
            </ItemGroup>

            {/* Debug Options */}
            <ItemGroup title={devText('Debug Options', '调试选项', '偵錯選項')}>
                <Item
                    title={devText('Debug Mode', '调试模式', '偵錯模式')}
                    rightElement={
                        <Switch
                            value={debugMode}
                            onValueChange={setDebugMode}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={devText('Console Output', '控制台输出', '主控台輸出')}
                    subtitle={devText('Enable console output in production builds', '在生产版本中启用控制台输出', '在正式版本中啟用主控台輸出')}
                    rightElement={
                        <Switch
                            value={consoleLoggingEnabled}
                            onValueChange={setConsoleLoggingEnabled}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={devText('Verbose Logging', '详细日志', '詳細日誌')}
                    subtitle={devText('Log all network requests and responses', '记录所有网络请求和响应', '記錄所有網路請求和回應')}
                    rightElement={
                        <Switch
                            value={verboseLogging}
                            onValueChange={setVerboseLogging}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={devText('View Logs', '查看日志', '查看日誌')}
                    icon={<Ionicons name="document-text-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/logs')}
                />
            </ItemGroup>

            {/* Component Demos */}
            <ItemGroup title={devText('Component Demos', '组件演示', '元件示範')}>
                <Item
                    title="Device-first UI QA"
                    subtitle="Read-only deterministic redesign states"
                    icon={<Ionicons name="desktop-outline" size={28} color={theme.semantic.focus} />}
                    onPress={() => router.push('/dev/device-first-qa')}
                />
                <Item
                    title={devText('Device Info', '设备信息', '裝置資訊')}
                    subtitle={devText('Safe area insets and device parameters', '查看安全区域和设备参数', '查看安全區域和裝置參數')}
                    icon={<Ionicons name="phone-portrait-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/device-info')}
                />
                <Item
                    title={devText('List Components', '列表组件', '清單元件')}
                    subtitle={devText('Demo of Item, ItemGroup, and ItemList', '演示 Item、ItemGroup 和 ItemList', '示範 Item、ItemGroup 和 ItemList')}
                    icon={<Ionicons name="list-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/list-demo')}
                />
                <Item
                    title={devText('Typography', '文字排版', '文字排版')}
                    subtitle={devText('All typography styles', '查看所有文字样式', '查看所有文字樣式')}
                    icon={<Ionicons name="text-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/typography')}
                />
                <Item
                    title={devText('Colors', '颜色', '顏色')}
                    subtitle={devText('Color palette and themes', '查看调色板和主题', '查看調色盤和主題')}
                    icon={<Ionicons name="color-palette-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/colors')}
                />
                <Item
                    title={devText('Inverted List Test', '倒序列表测试', '倒序清單測試')}
                    subtitle={devText('Test inverted FlatList with keyboard', '测试带键盘的倒序 FlatList', '測試搭配鍵盤的倒序 FlatList')}
                    icon={<Ionicons name="swap-vertical-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/inverted-list')}
                />
                <Item
                    title={devText('Shimmer View', '微光加载视图', '微光載入檢視')}
                    subtitle={devText('Shimmer loading effects with masks', '带遮罩的微光加载效果', '帶遮罩的微光載入效果')}
                    icon={<Ionicons name="sparkles-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/shimmer-demo')}
                />
                <Item
                    title={devText('Multi Text Input', '多行文本输入', '多行文字輸入')}
                    subtitle={devText('Auto-growing multiline text input', '可自动增高的多行文本输入框', '可自動增高的多行文字輸入框')}
                    icon={<Ionicons name="create-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/multi-text-input')}
                />
                <Item
                    title={devText('Input Styles', '输入框样式', '輸入框樣式')}
                    subtitle={devText('10+ different input field style variants', '十余种不同的输入框样式', '十多種不同的輸入框樣式')}
                    icon={<Ionicons name="color-palette-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/input-styles')}
                />
                <Item
                    title={devText('Modal System', '弹窗系统', '彈窗系統')}
                    subtitle={devText('Alert, confirm, and custom modals', '提醒、确认和自定义弹窗', '提醒、確認和自訂彈窗')}
                    icon={<Ionicons name="albums-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/modal-demo')}
                />
                <Item
                    title={devText('Unit Tests', '单元测试', '單元測試')}
                    subtitle={devText('Run tests in the app environment', '在 App 环境中运行测试', '在 App 環境中執行測試')}
                    icon={<Ionicons name="flask-outline" size={28} color="#34C759" />}
                    onPress={() => router.push('/dev/tests')}
                />
                <Item
                    title={devText('Unistyles Demo', 'Unistyles 演示', 'Unistyles 示範')}
                    subtitle={devText('React Native Unistyles features and capabilities', 'React Native Unistyles 的功能演示', 'React Native Unistyles 的功能示範')}
                    icon={<Ionicons name="brush-outline" size={28} color="#FF6B6B" />}
                    onPress={() => router.push('/dev/unistyles-demo')}
                />
                <Item
                    title={devText('QR Code Test', '二维码测试', 'QR Code 測試')}
                    subtitle={devText('Test QR code generation with different parameters', '使用不同参数测试二维码生成', '使用不同參數測試 QR Code 產生')}
                    icon={<Ionicons name="qr-code-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/qr-test')}
                />
            </ItemGroup>

            {/* Test Features */}
            <ItemGroup
                title={devText('Test Features', '测试功能', '測試功能')}
                footer={devText('These actions may affect app stability', '这些操作可能影响 App 稳定性', '這些操作可能影響 App 穩定性')}
            >
                <Item
                    title={devText('Test Crash', '崩溃测试', '當機測試')}
                    subtitle={devText('Trigger a test crash', '主动触发一次测试崩溃', '主動觸發一次測試當機')}
                    destructive={true}
                    icon={<Ionicons name="warning-outline" size={28} color="#FF3B30" />}
                    onPress={async () => {
                        const confirmed = await Modal.confirm(
                            devText('Test Crash', '崩溃测试', '當機測試'),
                            devText('This will crash the app. Continue?', '此操作会使 App 崩溃，是否继续？', '此操作會使 App 當機，是否繼續？'),
                            { confirmText: devText('Crash', '继续崩溃', '繼續當機'), destructive: true }
                        );
                        if (confirmed) {
                            throw new Error('Test crash triggered from dev menu');
                        }
                    }}
                />
                <Item
                    title={devText('Clear Cache', '清除缓存', '清除快取')}
                    subtitle={devText('Remove all cached data', '删除所有缓存数据', '刪除所有快取資料')}
                    icon={<Ionicons name="trash-outline" size={28} color="#FF9500" />}
                    onPress={handleClearCache}
                />
                <Item
                    title={devText('Reset Changelog', '重置更新记录', '重設更新記錄')}
                    subtitle={devText("Show 'What's New' banner again", '再次显示“新功能”横幅', '再次顯示「新功能」橫幅')}
                    icon={<Ionicons name="sparkles-outline" size={28} color="#007AFF" />}
                    onPress={() => {
                        setLastViewedTitle('');
                        Modal.alert(
                            devText('Done', '完成', '完成'),
                            devText('Changelog reset. Restart app to see the banner.', '更新记录已重置，请重启 App 查看横幅。', '更新記錄已重設，請重新啟動 App 查看橫幅。'),
                        );
                    }}
                />
                <Item
                    title={devText('Reset App State', '重置 App 状态', '重設 App 狀態')}
                    subtitle={devText('Clear all user data and preferences', '清除所有用户数据和偏好设置', '清除所有使用者資料和偏好設定')}
                    destructive={true}
                    icon={<Ionicons name="refresh-outline" size={28} color="#FF3B30" />}
                    onPress={async () => {
                        const confirmed = await Modal.confirm(
                            devText('Reset App', '重置 App', '重設 App'),
                            devText('This will delete all data. Are you sure?', '此操作会删除所有数据，确定要继续吗？', '此操作會刪除所有資料，確定要繼續嗎？'),
                            { confirmText: devText('Reset', '重置', '重設'), destructive: true }
                        );
                        if (confirmed) {
                            console.log('App state reset');
                        }
                    }}
                />
            </ItemGroup>

            {/* System */}
            <ItemGroup title={devText('System', '系统', '系統')}>
                <Item
                    title={devText('Expo Constants', 'Expo 常量', 'Expo 常數')}
                    subtitle={devText('View expoConfig, manifests, and system constants', '查看 expoConfig、清单和系统常量', '查看 expoConfig、資訊清單和系統常數')}
                    icon={<Ionicons name="information-circle-outline" size={28} color="#007AFF" />}
                    onPress={() => router.push('/dev/expo-constants')}
                />
            </ItemGroup>

            {/* Network */}
            <ItemGroup title={devText('Network', '网络', '網路')}>
                <Item
                    title={devText('API Endpoint', 'API 地址', 'API 位址')}
                    detail={getServerUrl()}
                    onPress={handleEditServerUrl}
                    detailStyle={{ flex: 1, textAlign: 'right', minWidth: '70%' }}
                />
                <Item
                    title={devText('Log Server', '日志服务器', '日誌伺服器')}
                    subtitle={devText('Sends unencrypted console logs over HTTP', '通过 HTTP 发送未加密的控制台日志', '透過 HTTP 傳送未加密的主控台日誌')}
                    detail={getLogServerUrl() || devText('Off', '关闭', '關閉')}
                    onPress={handleEditLogServerUrl}
                    detailStyle={{ flex: 1, textAlign: 'right', minWidth: '50%' }}
                />
                <Item
                    title={devText('Socket.IO Status', 'Socket.IO 状态', 'Socket.IO 狀態')}
                    subtitle={getSocketStatusSubtitle()}
                    detail={getSocketStatusLabel(socketStatus.status)}
                    rightElement={<SocketStatusIndicator />}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
}
