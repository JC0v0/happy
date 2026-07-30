import * as React from 'react';
import { View, type ViewProps } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/ui/text';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

interface BadgeProps extends ViewProps {
    variant?: BadgeVariant;
    children: React.ReactNode;
}

const Badge = React.forwardRef<React.ElementRef<typeof View>, BadgeProps>(
    ({ variant = 'default', style, children, ...props }, ref) => {
        const { theme } = useUnistyles();
        styles.useVariants({ variant: variant === 'default' ? undefined : variant });
        return (
            <View ref={ref} style={[styles.base, style]} {...props}>
                {typeof children === 'string' ? (
                    <Text variant="label" style={{ color: textColorFor(theme.semantic, variant) }}>
                        {children}
                    </Text>
                ) : (
                    children
                )}
            </View>
        );
    },
);
Badge.displayName = 'Badge';

function textColorFor(
    semantic: { textPrimary: string; textInverse: string },
    variant: BadgeVariant,
): string {
    switch (variant) {
        case 'default':
        case 'destructive':
            return semantic.textInverse;
        default:
            return semantic.textPrimary;
    }
}

const styles = StyleSheet.create((theme) => ({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        borderRadius: theme.geometry.radius.interactive,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderWidth: StyleSheet.hairlineWidth,
        // variant: default
        backgroundColor: theme.semantic.control,
        borderColor: theme.semantic.control,
        variants: {
            variant: {
                secondary: {
                    backgroundColor: theme.semantic.surfaceMuted,
                    borderColor: theme.semantic.border,
                },
                destructive: {
                    backgroundColor: theme.semantic.status.error,
                    borderColor: theme.semantic.status.error,
                },
                outline: { backgroundColor: 'transparent', borderColor: theme.semantic.borderStrong },
            },
        },
    },
}));

export { Badge };
export type { BadgeProps };
