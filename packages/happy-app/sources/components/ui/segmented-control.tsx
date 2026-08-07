import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/ui/text';

export interface SegmentedControlOption<T extends string> {
    value: T;
    label: string;
    icon?: keyof typeof Ionicons.glyphMap;
    accessibilityLabel?: string;
}

interface SegmentedControlProps<T extends string> {
    options: ReadonlyArray<SegmentedControlOption<T>>;
    value: T;
    onChange: (value: T) => void;
    accessibilityLabel?: string;
}

/**
 * Square-geometry segmented control matching the app's OpenCode-inspired
 * design language: muted track, surface-raised selected segment, hairline
 * borders, compact/interactive radii from the geometry tokens.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: SegmentedControlProps<T>) {
    return (
        <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <Pressable
                        key={option.value}
                        onPress={() => {
                            if (!selected) {
                                onChange(option.value);
                            }
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={option.accessibilityLabel ?? option.label}
                        style={({ pressed }) => [
                            styles.segment,
                            selected && styles.segmentSelected,
                            pressed && !selected && styles.segmentPressed,
                        ]}
                    >
                        {option.icon ? (
                            <Ionicons
                                name={option.icon}
                                size={15}
                                color={selected ? styles.iconSelected.color : styles.icon.color}
                            />
                        ) : null}
                        <Text variant="small" style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    track: {
        flexDirection: 'row',
        gap: 2,
        padding: 2,
        backgroundColor: theme.semantic.surfaceMuted,
        borderRadius: theme.geometry.radius.interactive,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.border,
    },
    segment: {
        flex: 1,
        minHeight: 36,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 8,
        borderRadius: theme.geometry.radius.compact,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'transparent',
    },
    segmentSelected: {
        backgroundColor: theme.semantic.surfaceRaised,
        borderColor: theme.semantic.borderStrong,
    },
    segmentPressed: {
        backgroundColor: theme.semantic.surfaceSelected,
    },
    label: {
        color: theme.semantic.textSecondary,
    },
    labelSelected: {
        color: theme.semantic.textPrimary,
        fontWeight: '600',
    },
    icon: {
        color: theme.semantic.textSecondary,
    },
    iconSelected: {
        color: theme.semantic.textPrimary,
    },
}));
