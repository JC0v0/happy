import * as React from 'react';
import { Redirect } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { DeviceList } from '@/components/device/DeviceList';
import { DeviceWorkspace } from '@/components/device/DeviceWorkspace';
import type { DeviceWorkspaceProjection } from '@/components/device/deviceWorkspaceModel';
import { DEVICE_FIRST_QA_FIXTURES } from '@/components/device/deviceFirstQaFixtures';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { DeviceHomeProjection } from '@/utils/machineUtils';
import { useLocalSetting } from '@/sync/storage';
import type { MultiTextInputHandle } from '@/components/MultiTextInput';

function isHomeProjection(value: unknown): value is DeviceHomeProjection {
    return Boolean(value && typeof value === 'object' && 'online' in value && 'offline' in value);
}

function isWorkspaceProjection(value: unknown): value is DeviceWorkspaceProjection {
    return Boolean(value && typeof value === 'object' && 'canSpawn' in value && 'recentSessions' in value);
}

export default function DeviceFirstQaScreen() {
    const devModeEnabled = useLocalSetting('devModeEnabled');
    const [selectedId, setSelectedId] = React.useState('mixed-presence');
    const [offlineExpanded, setOfflineExpanded] = React.useState(true);
    const inputRef = React.useRef<MultiTextInputHandle>(null);
    const fixture = DEVICE_FIRST_QA_FIXTURES.find((item) => item.id === selectedId)!;

    if (!__DEV__ && !devModeEnabled) {
        return <Redirect href="/" />;
    }

    const projection = fixture.expectedProjection;
    const displayedHomeProjection = isHomeProjection(projection)
        ? { ...projection, offlineExpanded }
        : null;

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.heading}>
                <Text variant="label">Read-only deterministic fixtures</Text>
                <Text variant="display">Device-first UI QA</Text>
                <Text variant="muted">These controls only switch local projections; no production operation is imported.</Text>
            </View>
            <View style={styles.fixturePicker}>
                {DEVICE_FIRST_QA_FIXTURES.map((item) => (
                    <Button
                        key={item.id}
                        size="sm"
                        variant={item.id === selectedId ? 'default' : 'secondary'}
                        onPress={() => setSelectedId(item.id)}
                    >
                        {item.id}
                    </Button>
                ))}
            </View>
            <View style={styles.preview}>
                <Text variant="label" style={styles.previewLabel}>{fixture.title}</Text>
                {displayedHomeProjection ? (
                    <DeviceList
                        projection={displayedHomeProjection}
                        selectedMachineId={displayedHomeProjection.online[0]?.machine.id ?? null}
                        onSelectMachine={() => undefined}
                        onToggleOffline={() => setOfflineExpanded((value) => !value)}
                    />
                ) : isWorkspaceProjection(projection) ? (
                    <DeviceWorkspace
                        projection={projection}
                        customPath=""
                        onCustomPathChange={() => undefined}
                        inputRef={inputRef}
                        isSpawning={false}
                        showAllPaths={false}
                        onToggleAllPaths={() => undefined}
                        onStartTerminal={() => undefined}
                        onOpenSession={() => undefined}
                    />
                ) : (
                    <View style={styles.routeState}>
                        <Text variant="title">{fixture.title}</Text>
                        <Text variant="mono">{JSON.stringify(projection)}</Text>
                    </View>
                )}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: { flex: 1, backgroundColor: theme.semantic.canvas },
    content: { paddingBottom: 48 },
    heading: { gap: 6, padding: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.semantic.border },
    fixturePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 },
    preview: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.semantic.border },
    previewLabel: { padding: 16 },
    routeState: { gap: 8, minHeight: 220, padding: 20, backgroundColor: theme.semantic.surface },
}));
