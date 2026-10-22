// src/screens/FilePickerScreen.tsx
// Sender: pick photos / documents / any files, then Grab.
// Grab broadcasts GRABBED to all receivers and slides up the grab animation.
// The sheet closes when a receiver answers RELEASE_DETECTED (later: the catch gesture).
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { errorCodes, isErrorWithCode, pick, types } from '@react-native-documents/picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SocketManager } from '../services/socket/SocketManager';
import { FileStore, PickedFile, formatSize } from '../services/files/FileStore';
import GrabSheet from '../components/GrabSheet';

type Props = NativeStackScreenProps<RootStackParamList, 'FilePicker'>;

const DARK = '#1A1A1A';

export default function FilePickerScreen({ navigation }: Props) {
  const [files, setFiles] = useState<PickedFile[]>(FileStore.get());
  const [grabbing, setGrabbing] = useState(false);

  useEffect(() => FileStore.subscribe(setFiles), []);

  // Receiver says it caught the files -> animation done, close the sheet.
  useEffect(() => {
    return SocketManager.onMessage((msg) => {
      if (msg.type === 'RELEASE_DETECTED') {
        setGrabbing(false);
        // Next step: TransferEngine starts sending the file bytes from here.
      }
    });
  }, []);

  const choose = async () => {
    try {
      const results = await pick({ allowMultiSelection: true, type: [types.allFiles] });
      FileStore.add(
        results.map((r) => ({
          uri: r.uri,
          name: r.name ?? 'Unnamed file',
          size: r.size ?? null,
          type: r.type ?? null,
        })),
      );
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return;
      Alert.alert('Could not open files', 'Something went wrong while picking files.');
    }
  };

  const grab = () => {
    SocketManager.broadcastControl('GRABBED', {
      files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    });
    setGrabbing(true);
  };

  const cancelGrab = () => {
    SocketManager.broadcastControl('GRAB_CANCELLED');
    setGrabbing(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pick Files</Text>

      <TouchableOpacity style={styles.outlineBtn} onPress={choose} activeOpacity={0.8}>
        <Text style={styles.outlineText}>{files.length ? 'Add more files' : 'Browse files'}</Text>
      </TouchableOpacity>

      <FlatList
        data={files}
        keyExtractor={(f) => f.uri}
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>Photos, videos, documents — anything on your phone.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.fileName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.fileMeta}>{formatSize(item.size)}</Text>
            </View>
            <TouchableOpacity onPress={() => FileStore.remove(item.uri)} hitSlop={10}>
              <Text style={styles.remove}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <TouchableOpacity
        style={[styles.button, files.length === 0 && styles.buttonDisabled]}
        disabled={files.length === 0 || grabbing}
        onPress={grab}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {files.length === 0 ? 'Select files to grab' : `Grab ${files.length} ${files.length === 1 ? 'file' : 'files'}`}
        </Text>
      </TouchableOpacity>

      <GrabSheet visible={grabbing} fileCount={files.length} onCancel={cancelGrab} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', padding: 24, alignItems: 'center' },
  title: { fontSize: 24, fontFamily: 'LuckiestGuy-Regular', color: DARK, marginTop: 40 },
  outlineBtn: {
    width: '100%',
    marginTop: 24,
    borderWidth: 2,
    borderColor: DARK,
    borderRadius: 24,
    paddingVertical: 12,
    alignItems: 'center',
  },
  outlineText: { color: DARK, fontSize: 15, fontWeight: '600' },
  list: { width: '100%', marginTop: 16 },
  empty: { color: '#777', textAlign: 'center', marginTop: 40, fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F3F3',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  rowText: { flex: 1, marginRight: 12 },
  fileName: { color: DARK, fontSize: 15, fontWeight: '600' },
  fileMeta: { color: '#777', fontSize: 12, marginTop: 2 },
  remove: { color: '#999', fontSize: 16 },
  button: {
    marginTop: 12,
    marginBottom: 30,
    backgroundColor: DARK,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 30,
    minWidth: 220,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#B5B5B5' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});