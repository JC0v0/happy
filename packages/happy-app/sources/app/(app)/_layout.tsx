import { Stack } from 'expo-router';
import 'react-native-reanimated';
import * as React from 'react';
import { Typography } from '@/constants/Typography';
import { createHeader } from '@/components/navigation/Header';
import { Platform, TouchableOpacity, Text } from 'react-native';
import { isRunningOnMac } from '@/utils/platform';
import { useUnistyles } from 'react-native-unistyles';
import { localizedText, t } from '@/text';

export const unstable_settings = {
    initialRouteName: 'index',
};

export default function RootLayout() {
    // Use custom header on Android and Mac Catalyst, native header on iOS (non-Catalyst)
    const shouldUseCustomHeader = Platform.OS === 'android' || isRunningOnMac() || Platform.OS === 'web';
    const { theme } = useUnistyles();

    return (
        <Stack
            initialRouteName='index'
            screenOptions={{
                header: shouldUseCustomHeader ? createHeader : undefined,
                headerBackTitle: t('common.back'),
                headerShadowVisible: false,
                contentStyle: {
                    backgroundColor: theme.colors.surface,
                },
                headerStyle: {
                    backgroundColor: theme.colors.header.background,
                },
                headerTintColor: theme.colors.header.tint,
                headerTitleStyle: {
                    color: theme.colors.header.tint,
                    ...Typography.default('semiBold'),
                },

            }}
        >
            <Stack.Screen
                name="index"
                options={{
                    headerShown: false,
                    headerTitle: ''
                }}
            />
            <Stack.Screen
                name="settings/index"
                options={{
                    headerShown: true,
                    headerTitle: t('settings.title'),
                    headerBackTitle: t('common.home')
                }}
            />
            <Stack.Screen
                name="session/[id]"
                options={{
                    headerShown: false
                }}
            />
            <Stack.Screen
                name="settings/account"
                options={{
                    headerTitle: t('settings.account'),
                }}
            />
            <Stack.Screen
                name="settings/appearance"
                options={{
                    headerTitle: t('settings.appearance'),
                }}
            />
            <Stack.Screen
                name="settings/features"
                options={{
                    headerTitle: t('settings.features'),
                }}
            />
            <Stack.Screen
                name="settings/language"
                options={{
                    headerTitle: t('settingsLanguage.title'),
                }}
            />
            <Stack.Screen
                name="terminal/connect"
                options={{
                    headerTitle: t('navigation.connectTerminal'),
                }}
            />
            <Stack.Screen
                name="terminal/index"
                options={{
                    headerTitle: t('navigation.connectTerminal'),
                }}
            />
            <Stack.Screen
                name="restore/index"
                options={{
                    headerShown: true,
                    headerTitle: t('navigation.linkNewDevice'),
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="restore/manual"
                options={{
                    headerShown: true,
                    headerTitle: t('navigation.restoreWithSecretKey'),
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="changelog"
                options={{
                    headerShown: true,
                    headerTitle: t('navigation.whatsNew'),
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="text-selection"
                options={{
                    headerShown: true,
                    headerTitle: t('textSelection.title'),
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="dev/index"
                options={{
                    headerTitle: t('settings.developerTools'),
                }}
            />

            <Stack.Screen
                name="dev/list-demo"
                options={{
                    headerTitle: localizedText('List Components Demo', '列表组件演示', '清單元件示範'),
                }}
            />
            <Stack.Screen
                name="dev/typography"
                options={{
                    headerTitle: localizedText('Typography', '字体排版', '字型排版'),
                }}
            />
            <Stack.Screen
                name="dev/colors"
                options={{
                    headerTitle: localizedText('Colors', '颜色', '顏色'),
                }}
            />
            <Stack.Screen
                name="dev/shimmer-demo"
                options={{
                    headerTitle: localizedText('Shimmer View Demo', '微光加载演示', '微光載入示範'),
                }}
            />
            <Stack.Screen
                name="dev/multi-text-input"
                options={{
                    headerTitle: localizedText('Multi Text Input', '多行文本输入', '多行文字輸入'),
                }}
            />
            <Stack.Screen
                name="dev/logs"
                options={{ headerTitle: localizedText('Logs', '日志', '日誌') }}
            />
            <Stack.Screen
                name="dev/device-info"
                options={{ headerTitle: localizedText('Device Info', '设备信息', '裝置資訊') }}
            />
            <Stack.Screen
                name="dev/inverted-list"
                options={{ headerTitle: localizedText('Inverted List Test', '倒序列表测试', '倒序清單測試') }}
            />
            <Stack.Screen
                name="dev/input-styles"
                options={{ headerTitle: localizedText('Input Styles', '输入框样式', '輸入框樣式') }}
            />
            <Stack.Screen
                name="dev/modal-demo"
                options={{ headerTitle: localizedText('Modal Demo', '弹窗演示', '彈窗示範') }}
            />
            <Stack.Screen
                name="dev/tests"
                options={{ headerTitle: localizedText('Tests', '单元测试', '單元測試') }}
            />
            <Stack.Screen
                name="dev/unistyles-demo"
                options={{ headerTitle: localizedText('Unistyles Demo', 'Unistyles 演示', 'Unistyles 示範') }}
            />
            <Stack.Screen
                name="dev/qr-test"
                options={{ headerTitle: localizedText('QR Code Test', '二维码测试', 'QR Code 測試') }}
            />
            <Stack.Screen
                name="dev/purchases"
                options={{ headerTitle: localizedText('Purchases', '购买信息', '購買資訊') }}
            />
            <Stack.Screen
                name="dev/expo-constants"
                options={{ headerTitle: localizedText('Expo Constants', 'Expo 配置信息', 'Expo 設定資訊') }}
            />
            <Stack.Screen
                name="session/recent"
                options={{
                    headerShown: true,
                    headerTitle: t('sessionHistory.title'),
                    headerBackTitle: t('common.back'),
                }}
            />
        </Stack>
    );
}
