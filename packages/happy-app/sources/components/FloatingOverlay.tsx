import * as React from 'react';
import Animated from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        borderRadius: 0,
        overflow: 'hidden',
        backgroundColor: theme.semantic.surfaceRaised,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.borderStrong,
        elevation: 0,
    },
}));

interface FloatingOverlayProps {
    children: React.ReactNode;
    maxHeight?: number;
    showScrollIndicator?: boolean;
    keyboardShouldPersistTaps?: boolean | 'always' | 'never' | 'handled';
}

export const FloatingOverlay = React.memo((props: FloatingOverlayProps) => {
    const styles = stylesheet;
    const { 
        children, 
        maxHeight = 240, 
        showScrollIndicator = false, 
        keyboardShouldPersistTaps = 'handled' 
    } = props;

    return (
        <Animated.View style={[styles.container, { maxHeight }]}>
            <Animated.ScrollView
                style={{ maxHeight }}
                keyboardShouldPersistTaps={keyboardShouldPersistTaps}
                showsVerticalScrollIndicator={showScrollIndicator}
            >
                {children}
            </Animated.ScrollView>
        </Animated.View>
    );
});
