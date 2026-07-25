import * as React from 'react';
import { View, type ViewProps } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/ui/text';

const Card = React.forwardRef<React.ElementRef<typeof View>, ViewProps>(
    ({ style, ...props }, ref) => (
        <View ref={ref} style={[styles.card, style]} {...props} />
    ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<React.ElementRef<typeof View>, ViewProps>(
    ({ style, ...props }, ref) => (
        <View ref={ref} style={[styles.header, style]} {...props} />
    ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<
    React.ElementRef<typeof Text>,
    React.ComponentPropsWithoutRef<typeof Text>
>((props, ref) => <Text ref={ref} variant="title" {...props} />);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
    React.ElementRef<typeof Text>,
    React.ComponentPropsWithoutRef<typeof Text>
>((props, ref) => <Text ref={ref} variant="description" {...props} />);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<React.ElementRef<typeof View>, ViewProps>(
    ({ style, ...props }, ref) => (
        <View ref={ref} style={[styles.content, style]} {...props} />
    ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<React.ElementRef<typeof View>, ViewProps>(
    ({ style, ...props }, ref) => (
        <View ref={ref} style={[styles.footer, style]} {...props} />
    ),
);
CardFooter.displayName = 'CardFooter';

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 2,
        elevation: 1,
    },
    header: {
        flexDirection: 'column',
        gap: 6,
        padding: 16,
    },
    content: {
        padding: 16,
        paddingTop: 0,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        paddingTop: 0,
    },
}));

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
