import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useSettingMutable, useLocalSettingMutable } from '@/sync/storage';
import { useRouter } from 'expo-router';
import * as Localization from 'expo-localization';
import { useUnistyles, UnistylesRuntime } from 'react-native-unistyles';
import { Switch } from '@/components/Switch';
import { Appearance, View } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { darkTheme, lightTheme } from '@/theme';
import { t, getLanguageNativeName, SUPPORTED_LANGUAGES } from '@/text';

// Define known avatar styles for this version of the app
type KnownAvatarStyle = 'pixelated' | 'gradient' | 'brutalist';

const isKnownAvatarStyle = (style: string): style is KnownAvatarStyle => {
    return style === 'pixelated' || style === 'gradient' || style === 'brutalist';
};

export default function AppearanceSettingsScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [avatarStyle, setAvatarStyle] = useSettingMutable('avatarStyle');
    const [showFlavorIcons, setShowFlavorIcons] = useSettingMutable('showFlavorIcons');
    const [themePreference, setThemePreference] = useLocalSettingMutable('themePreference');
    const [preferredLanguage] = useSettingMutable('preferredLanguage');

    // Ensure we have a valid style for display, defaulting to gradient for unknown values
    const displayStyle: KnownAvatarStyle = isKnownAvatarStyle(avatarStyle) ? avatarStyle : 'gradient';

    const applyThemePreference = (nextTheme: 'light' | 'dark' | 'adaptive') => {
        setThemePreference(nextTheme);
        if (nextTheme === 'adaptive') {
            // Enable adaptive themes and follow the system theme
            UnistylesRuntime.setAdaptiveThemes(true);
            const systemTheme = Appearance.getColorScheme();
            const color = systemTheme === 'dark' ? darkTheme.colors.groupped.background : lightTheme.colors.groupped.background;
            UnistylesRuntime.setRootViewBackgroundColor(color);
            SystemUI.setBackgroundColorAsync(color);
        } else {
            // Disable adaptive themes and set explicit theme
            UnistylesRuntime.setAdaptiveThemes(false);
            UnistylesRuntime.setTheme(nextTheme);
            const color = nextTheme === 'dark' ? darkTheme.colors.groupped.background : lightTheme.colors.groupped.background;
            UnistylesRuntime.setRootViewBackgroundColor(color);
            SystemUI.setBackgroundColorAsync(color);
        }
    };

    // Language display
    const getLanguageDisplayText = () => {
        if (preferredLanguage === null) {
            const deviceLocale = Localization.getLocales()?.[0]?.languageTag ?? 'en-US';
            const deviceLanguage = deviceLocale.split('-')[0].toLowerCase();
            const detectedLanguageName = deviceLanguage in SUPPORTED_LANGUAGES ?
                                        getLanguageNativeName(deviceLanguage as keyof typeof SUPPORTED_LANGUAGES) :
                                        getLanguageNativeName('en');
            return `${t('settingsLanguage.automatic')} (${detectedLanguageName})`;
        } else if (preferredLanguage && preferredLanguage in SUPPORTED_LANGUAGES) {
            return getLanguageNativeName(preferredLanguage as keyof typeof SUPPORTED_LANGUAGES);
        }
        return t('settingsLanguage.automatic');
    };
    return (
        <ItemList style={{ paddingTop: 0 }}>

            {/* Theme Settings */}
            <ItemGroup
                title={t('settingsAppearance.theme')}
                footer={themePreference === 'adaptive' ? t('settingsAppearance.themeDescriptions.adaptive') : themePreference === 'light' ? t('settingsAppearance.themeDescriptions.light') : t('settingsAppearance.themeDescriptions.dark')}
            >
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                    <SegmentedControl
                        accessibilityLabel={t('settingsAppearance.theme')}
                        options={[
                            { value: 'adaptive', label: t('settingsAppearance.themeOptions.adaptive'), icon: 'contrast-outline' },
                            { value: 'light', label: t('settingsAppearance.themeOptions.light'), icon: 'sunny-outline' },
                            { value: 'dark', label: t('settingsAppearance.themeOptions.dark'), icon: 'moon-outline' },
                        ]}
                        value={themePreference}
                        onChange={applyThemePreference}
                    />
                </View>
            </ItemGroup>

            {/* Language Settings */}
            <ItemGroup title={t('settingsLanguage.title')} footer={t('settingsLanguage.description')}>
                <Item
                    title={t('settingsLanguage.currentLanguage')}
                    icon={<Ionicons name="language-outline" size={24} color={theme.semantic.focus} />}
                    detail={getLanguageDisplayText()}
                    onPress={() => router.push('/settings/language')}
                />
            </ItemGroup>

            {/* Display Settings */}
            <ItemGroup title={t('settingsAppearance.display')} footer={t('settingsAppearance.displayDescription')}>
                <Item
                    title={t('settingsAppearance.showFlavorIcons')}
                    subtitle={t('settingsAppearance.showFlavorIconsDescription')}
                    icon={<Ionicons name="apps-outline" size={24} color={theme.semantic.focus} />}
                    rightElement={
                        <Switch
                            value={showFlavorIcons}
                            onValueChange={setShowFlavorIcons}
                        />
                    }
                />
            </ItemGroup>

            {/* Avatar Style */}
            <ItemGroup title={t('settingsAppearance.avatarStyle')} footer={t('settingsAppearance.avatarStyleDescription')}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                    <SegmentedControl
                        accessibilityLabel={t('settingsAppearance.avatarStyle')}
                        options={[
                            { value: 'pixelated' as const, label: t('settingsAppearance.avatarOptions.pixelated') },
                            { value: 'gradient' as const, label: t('settingsAppearance.avatarOptions.gradient') },
                            { value: 'brutalist' as const, label: t('settingsAppearance.avatarOptions.brutalist') },
                        ]}
                        value={displayStyle}
                        onChange={(nextStyle) => setAvatarStyle(nextStyle)}
                    />
                </View>
            </ItemGroup>
        </ItemList>
    );
}
