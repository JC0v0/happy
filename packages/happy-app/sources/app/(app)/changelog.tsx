import React, { useEffect } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { getChangelogEntries, getLatestTitle, setLastViewedTitle } from '@/changelog';
import { Typography, TypeScale } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { t } from '@/text';

export default function ChangelogScreen() {
    const insets = useSafeAreaInsets();
    const entries = getChangelogEntries();

    useEffect(() => {
        const latestTitle = getLatestTitle();
        if (latestTitle) {
            setLastViewedTitle(latestTitle);
        }
    }, []);

    if (entries.length === 0) {
        return (
            <View style={styles.container}>
                <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>
                        {t('changelog.noEntriesAvailable')}
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <ScrollView
                style={styles.container}
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingBottom: insets.bottom + 40,
                        maxWidth: layout.maxWidth,
                        alignSelf: 'center',
                        width: '100%'
                    }
                ]}
                showsVerticalScrollIndicator={false}
            >
                {entries.map((entry) => (
                    <View key={entry.title} style={styles.entryContainer}>
                        <Text style={styles.titleText}>
                            {entry.title}
                        </Text>
                        {entry.summary ? (
                            <Text style={styles.summaryText}>
                                {entry.summary}
                            </Text>
                        ) : null}
                        {entry.markdown ? (
                            <View style={styles.card}>
                                <MarkdownView markdown={entry.markdown} />
                            </View>
                        ) : null}
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.semantic.canvas,
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    entryContainer: {
        marginBottom: 32,
    },
    titleText: {
        ...Typography.default('semiBold'),
        ...TypeScale.heading,
        color: theme.semantic.textPrimary,
        marginBottom: 8,
    },
    summaryText: {
        ...Typography.default('regular'),
        fontSize: 15,
        lineHeight: 22,
        color: theme.semantic.textSecondary,
        marginBottom: 16,
    },
    card: {
        backgroundColor: theme.semantic.surface,
        borderRadius: 0,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.border,
        padding: 16,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    emptyText: {
        ...Typography.default('regular'),
        fontSize: 16,
        lineHeight: 24,
        color: theme.semantic.textSecondary,
        textAlign: 'center',
    }
}));
