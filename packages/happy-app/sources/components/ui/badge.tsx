import * as React from 'react';
import { View, type ViewProps } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/ui/text';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

interface BadgeProps extends ViewProps {
    variant?: BadgeVariant;
    children: React.ReactNode;
}

const Badge = React.forwardRef<React.ElementRef<typeof View>, BadgeProps>(
    ({ variant = 'default', style, children, ...props }, ref) => {
        styles.useVariants({ variant: variant === 'default' ? undefined : variant });
        return (
            <View ref={ref} style={[styles.base, style]} {...props}>
                {typeof children === 'string' ? (
                    <Text style={{ color: textColorFor(variant), fontSize: 11, fontWeight: '600' }}>
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

function textColorFor(variant: BadgeVariant): string | undefined {
    switch (variant) {
        case 'default':
        case 'destructive':
            return '#FFFFFF';
        default:
            return undefined;
    }
}

const styles = StyleSheet.create((theme) => ({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'transparent',
        // variant: default
        backgroundColor: theme.colors.text,
        variants: {
            variant: {
                secondary: { backgroundColor: theme.colors.surfaceHigh },
                destructive: { backgroundColor: theme.colors.status.error },
                outline: { backgroundColor: 'transparent', borderColor: theme.colors.divider },
            },
        },
    },
}));

export { Badge };
export type { BadgeProps };
