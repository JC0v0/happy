import * as React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/**
 * shadcn-style text component. `variant` maps to the design-system text roles
 * (mirrors the muted/foreground tokens used across the app).
 */
export type TextVariant = 'default' | 'muted' | 'small' | 'xs' | 'title' | 'description';

const Text = React.forwardRef<
    React.ElementRef<typeof RNText>,
    RNTextProps & { variant?: TextVariant }
>(({ variant = 'default', style, ...props }, ref) => (
    <RNText ref={ref} style={[styles[variant], style]} {...props} />
));
Text.displayName = 'Text';

const styles = StyleSheet.create((theme) => ({
    default: {
        fontSize: 14,
        color: theme.colors.text,
    },
    muted: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    small: {
        fontSize: 12,
        color: theme.colors.text,
    },
    xs: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    description: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
}));

export { Text };
