import { useSyncExternalStore } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { softwareUpdater } from './software-update';

const menma = require('./assets/menma/settings.png');

export function UpdatePanel() {
  const state = useSyncExternalStore(softwareUpdater.subscribe, softwareUpdater.read, softwareUpdater.read);
  const blocked = ['checking', 'downloading', 'apk-downloading'].includes(state.status);
  const action = (title: string, run: () => Promise<void>, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
      onPress={() => void run()} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );

  return <View style={styles.card}>
    <View style={styles.heading}>
      <Image source={menma} style={styles.avatar} />
      <View><Text style={styles.title}>应用更新</Text><Text style={styles.meta}>{state.version} · {state.revision}</Text></View>
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{state.message}</Text>
    {state.notes ? <Text style={styles.body}>{state.notes}</Text> : null}
    {state.apkProgress ? <Text style={styles.meta}>
      {(state.apkProgress.received / 1e6).toFixed(1)} / {(state.apkProgress.total / 1e6).toFixed(1)} MB
    </Text> : null}
    {state.status === 'ready' ? action('重启应用，使用新版', softwareUpdater.restart) : null}
    {['apk', 'apk-error'].includes(state.status) && state.apk?.downloadUrl ? action('下载安装包', softwareUpdater.downloadApk) : null}
    {state.status === 'apk-downloading' ? action('取消下载', softwareUpdater.cancelApk) : null}
    {state.status === 'apk-ready' ? action('安装新版本', softwareUpdater.installApk) : null}
    {state.status !== 'ready' && state.status !== 'disabled' ? action('检查更新', () => softwareUpdater.check(true), blocked) : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 9, borderWidth: 1, borderColor: '#D6DDD1', borderRadius: 14, backgroundColor: '#FCFAF4' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, resizeMode: 'contain' },
  title: { color: '#222D25', fontSize: 17, fontWeight: '800' },
  meta: { color: '#58665C', fontSize: 12, marginTop: 3 },
  body: { color: '#222D25', fontSize: 14, lineHeight: 20 },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: '#1A5B47' },
  buttonText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.56 },
});
