import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from './env';
import type { SessionRole } from '../shared/types';

const COOKIE_NAME = 'pokedex_session';
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function hmac(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export async function credentialsAreValid(provided: string, expected: string, minimumLength = 12): Promise<boolean> {
  if (!expected || expected.length < minimumLength) return false;
  return safeEqual(provided, expected);
}

export async function createSession(c: Context<{ Bindings: Env }>, role: SessionRole): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const payload = `${role}.${expires}`;
  const signature = await hmac(payload, c.env.SESSION_SECRET);
  setCookie(c, COOKIE_NAME, `${payload}.${signature}`, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    maxAge: SESSION_DURATION_SECONDS,
    path: '/',
  });
}

export async function getSessionRole(c: Context<{ Bindings: Env }>): Promise<SessionRole | null> {
  if (!c.env.SESSION_SECRET || c.env.SESSION_SECRET.length < 32) return null;
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  const [role, expires, signature, extra] = token.split('.');
  if (extra || (role !== 'admin' && role !== 'guest') || !expires || !signature) return null;
  if (!/^\d+$/.test(expires) || Number(expires) <= Math.floor(Date.now() / 1000)) return null;
  const payload = `${role}.${expires}`;
  return (await safeEqual(signature, await hmac(payload, c.env.SESSION_SECRET))) ? role : null;
}

export async function isAuthenticated(c: Context<{ Bindings: Env }>): Promise<boolean> {
  return (await getSessionRole(c)) !== null;
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: '/', sameSite: 'Strict', secure: new URL(c.req.url).protocol === 'https:' });
}

export function hasAllowedOrigin(c: Context<{ Bindings: Env }>): boolean {
  const origin = c.req.header('Origin');
  if (!origin) return true;
  const requestOrigin = new URL(c.req.url).origin;
  return origin === requestOrigin || origin === c.env.ALLOWED_ORIGIN;
}
