import { describe, expect, it } from 'vitest';
import { checkOrigin } from './origin';

const app = 'https://quick-notes.example.com';

describe('checkOrigin', () => {
  it.each([
    ['same-origin POST from the app', { method: 'POST', origin: app, secFetchSite: 'same-origin' }, true],
    ['server-to-server (Twilio, cron, curl)', { method: 'POST', origin: null, secFetchSite: null }, true],
    ['same-origin GET without Origin', { method: 'GET', origin: null, secFetchSite: 'same-origin' }, true],
    ['cross-origin GET', { method: 'GET', origin: 'https://evil.test', secFetchSite: 'cross-site' }, false],
    ['cross-origin POST (CSRF)', { method: 'POST', origin: 'https://evil.test', secFetchSite: 'cross-site' }, false],
    ['cross-site form POST with Origin stripped', { method: 'POST', origin: null, secFetchSite: 'cross-site' }, false],
    ['lookalike origin', { method: 'POST', origin: 'https://quick-notes.example.com.evil.test', secFetchSite: 'cross-site' }, false],
    ['http downgrade origin', { method: 'POST', origin: 'http://quick-notes.example.com', secFetchSite: 'same-site' }, false],
    ['preflight', { method: 'OPTIONS', origin: 'https://evil.test', secFetchSite: 'cross-site' }, false],
    ['null origin (sandboxed iframe)', { method: 'POST', origin: 'null', secFetchSite: 'cross-site' }, false],
  ])('%s -> allow=%s', (_l, req, allow) => {
    expect(checkOrigin({ ...req, appOrigin: app }).allow).toBe(allow);
  });
});
