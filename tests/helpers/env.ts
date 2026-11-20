import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

export type Role = 'employee' | 'approver';

export const AUTH_URL = process.env.STAGING_AUTH_URL ?? 'https://auth-app-ui-staging.staging.kiotapay.com';

export const storageStatePath = (role: Role) => path.join(__dirname, '..', '..', '.auth', `${role}.json`);

export function creds(role: Role) {
  const prefix = role === 'employee' ? 'EMPLOYEE' : 'APPROVER';
  return {
    username: process.env[`${prefix}_USERNAME`] ?? '',
    password: process.env[`${prefix}_PASSWORD`] ?? '',
  };
}

export function hasCreds(role: Role): boolean {
  const c = creds(role);
  return Boolean(c.username && c.password);
}

/** Name of the env vars missing for a test, or '' when everything is set. */
export function missing(...names: string[]): string {
  return names.filter((n) => !process.env[n]).join(', ');
}

export function hasSession(role: Role): boolean {
  return fs.existsSync(storageStatePath(role));
}
