import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const sites = {
  Mercari: 'Mercari',
  Yahoo: 'Yahoo! オークション',
  Surugaya: '骏河屋',
  Mandarake: 'Mandarake',
  YahooFleamarket: 'Yahoo! フリマ',
  Xianyu: '闲鱼',
};

export type Site = keyof typeof sites;

export type SiteStatus = {
  site: Site;
  running: boolean;
  total: number;
  succeeded: number;
  failed: number;
  error?: string;
};

export type ActiveState = { active: boolean; sites: SiteStatus[] };

export type SearchTask = {
  id: string;
  keyword: string;
  searchUrl?: string;
  adultMode?: boolean;
  adultOnly?: boolean;
  includesAdultCategory?: boolean;
  phoneSearch?: boolean;
};

export type SiteTasks = { site: Site; adultModeSupported: boolean; tasks: SearchTask[] };

export type Product = {
  id: string;
  site: Site;
  name: string;
  price: string;
  url: string;
  image: string;
  sold: boolean;
  foundAt: string;
};

export type Session = { server: string; token: string };

const sessionKey = 'goodsHunter.session';

export async function readSession(): Promise<Session | null> {
  if (Platform.OS === 'web') return null;
  const saved = await SecureStore.getItemAsync(sessionKey);
  if (!saved) return null;
  const session = JSON.parse(saved) as Session;
  if (!/^[A-Za-z0-9_-]{43}$/.test(session.token)) {
    await saveSession(null);
    return null;
  }
  return { server: serverAddress(session.server), token: session.token };
}

export async function saveSession(session: Session | null) {
  if (Platform.OS === 'web') return;
  if (session) await SecureStore.setItemAsync(sessionKey, JSON.stringify(session));
  else await SecureStore.deleteItemAsync(sessionKey);
}

export class ExpiredSession extends Error {}

function serverAddress(value: string) {
  const input = value.trim();
  if (!input) throw new Error('请输入谷子猎手的 HTTPS 服务地址。');
  let address: URL;
  try {
    address = new URL(input.includes('://') ? input : `https://${input}`);
  } catch {
    throw new Error('请输入有效的服务地址。');
  }
  const local = ['localhost', '127.0.0.1', '10.0.2.2'].includes(address.hostname);
  if (address.protocol !== 'https:' && !(__DEV__ && local && address.protocol === 'http:')) {
    throw new Error('公网服务地址需要 HTTPS。');
  }
  if (!address.hostname || address.username || address.password || address.search || address.hash ||
      (address.pathname !== '/' && address.pathname !== '')) {
    throw new Error('服务地址只需要主机名和端口。');
  }
  return address.origin;
}

export async function login(address: string, email: string, password: string, connectionCode: string): Promise<Session> {
  const server = serverAddress(address);
  const { token } = await request<{ token: string }>({ server, token: '' }, 'login', { email, password, connectionCode });
  return { server, token };
}

export async function request<T>(session: Session, route: string, body?: object): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  let reply: { code: string; data: T };
  try {
    response = await fetch(`${session.server}/api/mobile/${route}`, {
      method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body),
      signal: controller.signal, redirect: 'error',
    });
    reply = await response.json();
  } catch {
    throw new Error('服务连接失败，请检查网络和服务地址。');
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 401) throw new ExpiredSession('登录已过期，请重新登录。');
  if (reply.code === '030301') throw new Error('邮箱或密码错误。');
  if (reply.code === '040002') throw new Error('请先开启主动模式。');
  if (reply.code === '040003') throw new Error('连接验证失败，请核对连接码和服务地址。');
  if (reply.code === '040004') throw new Error('手机搜索结果与当前任务的条件不匹配，请下拉刷新后重试。');
  if (route === 'phone-search' && ['030502', '030503'].includes(reply.code)) throw new Error('该定时任务已不可用，请下拉刷新。');
  if (!response.ok || reply.code !== '200') throw new Error('操作失败，请稍后重试。');
  return reply.data;
}
