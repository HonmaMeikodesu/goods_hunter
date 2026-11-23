import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator, AppState, FlatList, Image, Linking, NativeModules, Platform, Pressable, StyleSheet,
  Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  ExpiredSession, login, readSession, request, saveSession, sites,
  type ActiveState, type Product, type SearchTask, type Session, type Site, type SiteStatus, type SiteTasks,
} from './api';
import { createSessionUpdater } from './software-update';
import { UpdatePanel } from './update-panel';

const watcher = require('./assets/menma/watch.png');
const waiting = require('./assets/menma/waiting.png');
const phoneSearch: { search(url: string): Promise<{ pageUrl: string; items: string } | null> } | undefined =
  Platform.OS === 'android' ? NativeModules.GoodsHunterPhoneSearch : undefined;

const ink = '#222D25';
const muted = '#58665C';
const green = '#1A5B47';
const warn = '#92432E';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>();
  const [loginError, setLoginError] = useState('');
  useEffect(() => {
    readSession().then(setSession).catch(() => setSession(null));
  }, []);

  async function changeSession(next: Session | null, message = '') {
    if (next) await saveSession(next);
    else {
      if (session && !message) void request(session, 'logout', {}).catch(() => {});
      await saveSession(null).catch(() => {});
    }
    setLoginError(message);
    setSession(next);
  }

  return <SafeAreaProvider>
    <StatusBar style="dark" />
    <SafeAreaView style={styles.root}>
      {session === undefined ? <ActivityIndicator color={green} style={styles.loading} /> :
        session ? <Dashboard session={session} onExit={message => void changeSession(null, message)} /> :
          <SignIn onLogin={changeSession} initialError={loginError} />}
    </SafeAreaView>
  </SafeAreaProvider>;
}

function SignIn({ onLogin, initialError }: { onLogin: (session: Session) => Promise<void>; initialError: string }) {
  const [server, setServer] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy || !server.trim() || !email.trim() || !password || !code.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onLogin(await login(server, email.trim(), password, code.trim()));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <FlatList data={[]} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}
    ListHeaderComponent={<View style={styles.login}>
      <View style={styles.brand}><Image source={watcher} style={styles.menma} /><Text style={styles.title}>谷子猎手</Text></View>
      <Text style={styles.label}>服务地址</Text>
      <TextInput style={styles.input} value={server} onChangeText={setServer} autoCapitalize="none"
        autoCorrect={false} keyboardType="url" placeholder="https://" placeholderTextColor={muted} accessibilityLabel="服务地址" />
      <Text style={styles.label}>邮箱</Text>
      <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none"
        autoCorrect={false} autoComplete="email" keyboardType="email-address" accessibilityLabel="邮箱" />
      <Text style={styles.label}>密码</Text>
      <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry
        autoComplete="current-password" accessibilityLabel="密码" />
      <Text style={styles.label}>连接码</Text>
      <TextInput style={styles.input} value={code} onChangeText={setCode} secureTextEntry autoCapitalize="none"
        autoCorrect={false} autoComplete="off" onSubmitEditing={() => void submit()} accessibilityLabel="连接码" />
      <Action label={busy ? '登录中…' : '登录'} primary disabled={busy || !server || !email || !password || !code} onPress={() => void submit()} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>} renderItem={() => null} />;
}

function Dashboard({ session, onExit }: { session: Session; onExit: (message?: string) => void }) {
  const updater = useMemo(() => createSessionUpdater(session), [session]);
  const update = useSyncExternalStore(updater.subscribe, updater.read, updater.read);
  const [state, setState] = useState<ActiveState | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [taskGroups, setTaskGroups] = useState<SiteTasks[] | null>(null);
  const [tasksError, setTasksError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [panel, setPanel] = useState<'updates' | 'connection' | null>(null);
  const refreshID = useRef(0);
  const tasksRequestID = useRef(0);
  const busy = useRef(false);
  const exit = useRef(onExit);
  exit.current = onExit;
  const running = state?.sites.some(site => site.running) ?? false;
  const updateAvailable = update.apk !== null || update.status === 'ready';

  const showError = useCallback((cause: unknown) => {
    if (cause instanceof ExpiredSession) exit.current(cause.message);
    else setError((cause as Error).message);
  }, []);

  const refresh = useCallback(async () => {
    const id = ++refreshID.current;
    try {
      const [next, items] = await Promise.all([
        request<ActiveState>(session, 'state'), request<Product[]>(session, 'products'),
      ]);
      if (refreshID.current !== id) return;
      setState(next);
      setProducts(items);
      setError('');
    } catch (cause) {
      if (refreshID.current === id) showError(cause);
    }
  }, [session, showError]);

  const refreshTasks = useCallback(async () => {
    const id = ++tasksRequestID.current;
    try {
      const groups = await request<SiteTasks[]>(session, 'tasks');
      if (tasksRequestID.current !== id) return;
      setTaskGroups(groups);
      setTasksError('');
    } catch (cause) {
      if (tasksRequestID.current !== id) return;
      if (cause instanceof ExpiredSession) showError(cause);
      else setTasksError('暂时无法读取定时任务，下拉可刷新。');
    }
  }, [session, showError]);

  useEffect(() => {
    void refresh();
    void refreshTasks();
    void updater.check();
    const listener = AppState.addEventListener('change', status => {
      if (status === 'active') {
        void refresh();
        void refreshTasks();
        void updater.check();
      }
    });
    return () => { listener.remove(); refreshID.current++; tasksRequestID.current++; void updater.cancelApk(); };
  }, [refresh, refreshTasks, updater]);

  useEffect(() => {
    if (!running) return;
    // Keep the previous request alive on slow connections.
    let timer: ReturnType<typeof setTimeout>;
    let finished = false;
    const tick = async () => {
      if (!busy.current) await refresh();
      if (!finished) timer = setTimeout(tick, 2500);
    };
    timer = setTimeout(tick, 2500);
    return () => { finished = true; clearTimeout(timer); };
  }, [refresh, running]);

  async function act(route: string, body: object) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setNotice('');
    setError('');
    refreshID.current++;
    try {
      if (route === 'viewed') {
        await request(session, route, body);
      } else {
        const next = await request<ActiveState>(session, route, body);
        setState(next);
        if (route === 'scan' && next.sites.length === 0) setNotice('当前没有搜索订阅。');
      }
      if (route === 'scan' && !('site' in body)) await Promise.all([refresh(), refreshTasks()]);
      else await refresh();
    } catch (cause) {
      showError(cause);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  async function searchOnPhone(task: SearchTask) {
    if (busy.current || !state?.active || !task.searchUrl || !phoneSearch) return;
    busy.current = true;
    setWorking(true);
    setNotice('');
    setError('');
    try {
      const result = await phoneSearch.search(task.searchUrl);
      if (!result) return;
      const { found } = await request<{ found: number }>(session, 'phone-search', {
        taskId: task.id, pageUrl: result.pageUrl, items: JSON.parse(result.items),
      });
      setNotice(found ? `手机读到 ${found} 件商品，已同步。` : '骏河屋这一页没有匹配商品。');
      await refresh();
    } catch (cause) {
      showError(cause);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  const siteRows = (Object.keys(sites) as Site[]).flatMap(site => {
    const group = taskGroups?.find(row => row.site === site);
    const status = state?.sites.find(row => row.site === site);
    return group || status ? [{ site, group, status }] : [];
  });

  return <FlatList data={products} keyExtractor={item => item.id} contentContainerStyle={styles.page}
    refreshing={refreshing} onRefresh={async () => {
      setRefreshing(true);
      await Promise.all([refresh(), refreshTasks()]);
      setRefreshing(false);
    }}
    ListHeaderComponent={<>
      <View style={styles.masthead}>
        <View style={styles.brand}><Image source={watcher} style={styles.menma} /><Text style={styles.title}>谷子猎手</Text></View>
        <View style={styles.headerActions}>
          <Action label={panel === 'updates' ? '收起更新' : updateAvailable ? '发现新版' : '应用更新'}
            accessibilityLabel="应用更新" onPress={() => setPanel(value => value === 'updates' ? null : 'updates')} />
          <Action label={panel === 'connection' ? '收起设置' : '连接设置'}
            onPress={() => setPanel(value => value === 'connection' ? null : 'connection')} />
        </View>
      </View>
      {panel === 'updates' ? <UpdatePanel updater={updater} /> : null}
      {panel === 'connection' ? <View style={styles.settings}>
        <Text style={styles.subtle}>{state ? '已验证连接 · ' : ''}{session.server}</Text>
        <Action label="退出登录" onPress={() => onExit()} />
      </View> : null}
      {state ? <>
        <View style={styles.mode}>
          <View style={styles.grow}>
            <Text style={styles.modeTitle}>{state.active ? '主动模式' : '被动模式'}</Text>
            <Text style={styles.subtle}>{state.active ? '定时采集的新品会攒在这里，随时可以手动搜索。' : '定时采集，新发现的商品通过邮件通知。'}</Text>
          </View>
          <Switch value={state.active} onValueChange={active => void act('mode', { active })} disabled={working}
            accessibilityLabel="主动模式" trackColor={{ false: '#A4B0A6', true: green }} />
        </View>
        {state.active ? <Action primary label={running ? '正在搜索…' : '搜索最新商品'} disabled={working || running}
          onPress={() => void act('scan', {})} /> : null}
        {siteRows.length ? <View style={styles.siteList}>
          {siteRows.map(row => <SiteRow key={row.site} {...row} tasksLoading={!taskGroups && !tasksError}
            canRetry={state.active && !working} onRetry={site => void act('scan', { site })} onError={showError}
            onPhoneSearch={state.active && phoneSearch ? task => void searchOnPhone(task) : undefined} working={working} />)}
        </View> : null}
        {tasksError ? <Text accessibilityRole="alert" style={styles.error}>{tasksError}</Text> : null}
      </> : error ? <Action label="重新连接" onPress={() => void Promise.all([refresh(), refreshTasks()])} /> : <ActivityIndicator color={green} />}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.subtle}>{notice}</Text> : null}
      <View style={styles.section}>
        <Text style={styles.heading}>最新发现{products.length ? ` · ${products.length}` : ''}</Text>
        {products.length ? <Action label="全部标为已看" disabled={working}
          onPress={() => void act('viewed', { ids: products.map(item => item.id) })} /> : null}
      </View>
    </>}
    renderItem={({ item }) => <ProductRow item={item} onError={showError} />}
    ListEmptyComponent={<View style={styles.empty}><Image source={waiting} style={styles.menma} />
      <Text style={styles.subtle}>{running ? '搜索结果会陆续出现在这里。' : '暂时没有未看的新品。'}</Text></View>}
  />;
}

function SiteRow({ site, group, status, tasksLoading, canRetry, onRetry, onError, onPhoneSearch, working }: {
  site: Site; group?: SiteTasks; status?: SiteStatus; tasksLoading: boolean; canRetry: boolean;
  onRetry: (site: Site) => void; onError: (cause: unknown) => void;
  onPhoneSearch?: (task: SearchTask) => void; working: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = group?.tasks.length ?? 0;
  const name = sites[site];
  return <View style={styles.siteGroup}>
    <View style={styles.siteRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}，${count} 个定时任务${group?.adultModeSupported ? '，支持成人模式' : ''}`}
        aria-expanded={expanded} onPress={() => setExpanded(value => !value)}
        style={({ pressed }) => [styles.siteToggle, pressed && styles.dim]}>
        <Text style={styles.siteCount}>{expanded ? '▾' : '▸'}</Text>
        <View style={styles.grow}>
          <Text style={styles.siteName}>{name}</Text>
          {group?.adultModeSupported ? <Text style={styles.adultMode}>支持成人模式</Text> : null}
          {status?.error ? <Text style={styles.siteError}>{status.error}</Text> : null}
        </View>
        <Text style={styles.siteCount}>{status ? siteProgress(status) : `${count} 个任务`}</Text>
      </Pressable>
      {status && !status.running && status.failed > 0 && canRetry ?
        <Action label="重试" accessibilityLabel={`重试${name}`} onPress={() => onRetry(site)} /> : null}
    </View>
    {expanded ? <View style={styles.taskList}>
      {group ? group.tasks.map(task => {
        const keyword = task.keyword || '任务关键词不可用';
        const url = task.searchUrl;
        let adultLabel = task.includesAdultCategory ? '含成人分类' : '';
        if (task.adultMode) adultLabel = task.adultOnly ? '仅成人' : '成人模式';
        return <View key={task.id} style={styles.taskRow}>
          <View style={styles.grow}>
            <Text style={styles.keyword}>{keyword}</Text>
            {adultLabel ? <Text style={styles.adultMode}>{adultLabel}</Text> : null}
          </View>
          {url && /^https:\/\/[^\s]+$/i.test(url) ? <View style={styles.taskActions}>
            {task.phoneSearch && onPhoneSearch ? <Action label="用手机搜索" disabled={working}
              accessibilityLabel={`用手机搜索 ${keyword}`} onPress={() => onPhoneSearch(task)} /> : null}
            <Pressable accessibilityRole="link" accessibilityLabel={`在${name}搜索 ${keyword}`}
              onPress={() => void Linking.openURL(url).catch(() => onError(new Error('无法打开站点搜索页。')))}
              style={({ pressed }) => [styles.action, pressed && styles.dim]}>
              <Text style={styles.actionText}>去原站搜索 ↗</Text>
            </Pressable>
          </View> : null}
        </View>;
      }) : <Text style={styles.taskPlaceholder}>{tasksLoading ? '正在读取定时任务…' : '暂无可显示的定时任务'}</Text>}
    </View> : null}
  </View>;
}

function siteProgress({ running, succeeded, failed, total }: SiteStatus) {
  if (running) return `${succeeded + failed}/${total} 进行中`;
  if (failed) return `${succeeded} 成功 · ${failed} 失败`;
  return `${succeeded} 项完成`;
}

function ProductRow({ item, onError }: { item: Product; onError: (cause: unknown) => void }) {
  const [badImage, setBadImage] = useState(false);
  const canOpen = /^https?:\/\/[^\s]+$/i.test(item.url);
  return <Pressable style={styles.product} disabled={!canOpen} accessibilityRole="link"
    onPress={() => void Linking.openURL(item.url).catch(() => onError(new Error('无法打开商品链接。')))}>
    {item.image && !badImage && /^https?:\/\//i.test(item.image) ?
      <Image source={{ uri: item.image }} style={styles.thumbnail} resizeMode="cover" onError={() => setBadImage(true)} /> :
      <View style={[styles.thumbnail, styles.noImage]}><Text style={styles.siteCount}>暂无图</Text></View>}
    <View style={styles.grow}>
      <Text style={styles.siteCount}>{sites[item.site]}{item.sold ? ' · 已售出' : ''}</Text>
      <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
      {item.price ? <Text style={styles.price}>{item.price}</Text> : null}
    </View>
  </Pressable>;
}

function Action({ label, onPress, disabled, primary, accessibilityLabel }: {
  label: string; onPress: () => void; disabled?: boolean; primary?: boolean; accessibilityLabel?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, primary && styles.primary, (pressed || disabled) && styles.dim]}>
    <Text style={primary ? styles.primaryText : styles.actionText}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F2EA' },
  loading: { flex: 1 },
  page: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34 },
  login: { gap: 10, paddingTop: 44 },
  masthead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  headerActions: { flexDirection: 'row', marginLeft: 'auto' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  menma: { width: 48, height: 48, resizeMode: 'contain' },
  settings: { gap: 8, paddingVertical: 8 },
  title: { color: ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.7 },
  heading: { fontSize: 20, color: ink, fontWeight: '800' },
  label: { color: ink, fontSize: 14, fontWeight: '700', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#BDC9BC', borderRadius: 12, minHeight: 50, paddingHorizontal: 14, color: ink, backgroundColor: '#FFFEF8' },
  mode: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#E4EBDF', borderRadius: 16, padding: 15, marginVertical: 10 },
  modeTitle: { fontSize: 16, fontWeight: '800', color: ink, marginBottom: 4 },
  subtle: { color: muted, fontSize: 13, lineHeight: 19 },
  grow: { flex: 1, minWidth: 0 },
  action: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 10, paddingHorizontal: 10 },
  actionText: { color: green, fontSize: 14, fontWeight: '700' },
  primary: { backgroundColor: green, minHeight: 49, marginTop: 4 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  dim: { opacity: 0.56 },
  siteList: { borderRadius: 14, borderColor: '#D6DDD1', borderWidth: 1, backgroundColor: '#FCFAF4', marginTop: 12, overflow: 'hidden' },
  siteGroup: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#DBE0D7' },
  siteRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  siteToggle: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, paddingVertical: 9 },
  siteName: { fontWeight: '700', color: ink, fontSize: 13 },
  siteCount: { color: muted, fontSize: 12 },
  siteError: { color: warn, fontSize: 11, marginTop: 3 },
  adultMode: { color: warn, fontSize: 12, marginTop: 3 },
  taskList: { backgroundColor: '#F0F3E9', paddingHorizontal: 12 },
  taskRow: { flexDirection: 'row', alignItems: 'center', minHeight: 49, gap: 6, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#DBE0D7' },
  taskActions: { alignItems: 'flex-end' },
  keyword: { color: ink, fontSize: 14, fontWeight: '600' },
  taskPlaceholder: { color: muted, fontSize: 13, paddingVertical: 12 },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 58, marginTop: 8 },
  product: { flexDirection: 'row', gap: 13, alignItems: 'center', backgroundColor: '#FFFEF8', borderRadius: 14, borderWidth: 1, borderColor: '#E2E2D7', padding: 9, marginBottom: 9 },
  thumbnail: { width: 76, height: 76, borderRadius: 9, backgroundColor: '#E8ECE2' },
  noImage: { alignItems: 'center', justifyContent: 'center' },
  productName: { color: ink, fontSize: 15, lineHeight: 20, fontWeight: '600', marginTop: 3 },
  price: { color: green, fontWeight: '800', marginTop: 3 },
  error: { color: warn, fontSize: 13, marginTop: 8 },
  empty: { alignItems: 'center', gap: 5, paddingVertical: 26 },
});
