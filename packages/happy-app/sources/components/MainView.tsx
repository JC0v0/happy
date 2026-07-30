import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { DevicesHomeView } from './device/DevicesHomeView';
import { Header } from './navigation/Header';
import { HeaderLogo } from './HeaderLogo';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

interface MainViewProps {
    variant: 'phone' | 'sidebar';
}

export const MainView = React.memo(function MainView({ variant }: MainViewProps) {
    const router = useRouter();
    const { theme } = useUnistyles();

    if (variant === 'sidebar') {
        return <DevicesHomeView variant="sidebar" />;
    }

    return (
        <View style={styles.container}>
            <Header
                title={<Text style={styles.title}>{t('terminals.machines')}</Text>}
                headerLeft={() => <HeaderLogo />}
                headerRight={() => (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('settings.title')}
                        hitSlop={8}
                        onPress={() => router.push('/settings')}
                        style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
                    >
                        <Ionicons name="settings-outline" size={21} color={theme.semantic.textPrimary} />
                    </Pressable>
                )}
                headerShadowVisible
            />
            <DevicesHomeView variant="phone" />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.semantic.canvas,
    },
    title: {
        color: theme.semantic.textPrimary,
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    headerButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.geometry.radius.interactive,
    },
    pressed: {
        backgroundColor: theme.semantic.surfaceSelected,
    },
}));
