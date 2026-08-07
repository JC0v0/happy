import * as React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography, TypeScale } from '@/constants/Typography';

/**
 * shadcn-style text component. `variant` maps to the design-system text roles
 * (mirrors the muted/foreground tokens used across the app).
 */
export type TextVariant = 'default' | 'muted' | 'small' | 'xs' | 'title' | 'description' | 'label' | 'mono' | 'display' | 'headline' | 'heading' | 'subtitle';

const Text = React.forwardRef<
    React.ElementRef<typeof RNText>,
    RNTextProps & { variant?: TextVariant }
>(({ variant = 'default', style, ...props }, ref) => (
    <RNText ref={ref} style={[styles[variant], style]} {...props} />
));
Text.displayName = 'Text';

const styles = StyleSheet.create((theme) => ({
    default: {
        ...Typography.proportionalBody(),
        color: theme.semantic.textPrimary,
    },
    muted: {
        ...Typography.proportionalBody(),
        color: theme.semantic.textSecondary,
    },
    small: {
        ...Typography.default(),
        ...TypeScale.bodySmall,
        color: theme.semantic.textPrimary,
    },
    xs: {
        ...Typography.mono(),
        ...TypeScale.label,
        color: theme.semantic.textMuted,
    },
    title: {
        ...Typography.title(),
        color: theme.semantic.textPrimary,
    },
    description: {
        ...Typography.default(),
        ...TypeScale.bodySmall,
        color: theme.semantic.textSecondary,
    },
    label: {
        ...Typography.label(),
        color: theme.semantic.textSecondary,
        textTransform: 'uppercase',
    },
    mono: {
        ...Typography.monoDeveloper(),
        color: theme.semantic.textPrimary,
    },
    display: {
        ...Typography.default('semiBold'),
        ...TypeScale.display,
        color: theme.semantic.textPrimary,
    },
    headline: {
        ...Typography.default('semiBold'),
        ...TypeScale.headline,
        color: theme.semantic.textPrimary,
    },
    heading: {
        ...Typography.default('semiBold'),
        ...TypeScale.heading,
        color: theme.semantic.textPrimary,
    },
    subtitle: {
        ...Typography.default(),
        ...TypeScale.subtitle,
        color: theme.semantic.textSecondary,
    },
}));

export { Text };
