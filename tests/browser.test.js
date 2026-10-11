import test from 'node:test';
import assert from 'node:assert/strict';
import { browserStorage, isInAppBrowser, canShareFile } from '../src/browser.js';
import { loadStore, loadGuestStore, emptyStore, STORAGE_KEY } from '../src/storage.js';
import { OnlineClient } from '../src/api.js';

test('a denied storage property allows temporary play instead of blocking startup', () => {
  const storage = browserStorage({ get localStorage() { throw new DOMException('Denied', 'SecurityError'); } });
  assert.equal(loadStore(storage).error, null);
  storage.setItem('guest', '한글'); assert.equal(storage.getItem('guest'), '한글');
  storage.removeItem('guest'); assert.equal(storage.getItem('guest'), null);
  assert.equal(storage.persistent, false);
});

test('a full device preserves readable records while new writes use memory', () => {
  const storage = browserStorage({ localStorage: { getItem: () => 'original', setItem() { throw new DOMException('Full', 'QuotaExceededError'); } } });
  assert.equal(storage.getItem('backup'), 'original'); storage.setItem('current', 'new');
  assert.equal(storage.getItem('current'), 'new'); assert.equal(storage.getItem('backup'), 'original');
  assert.equal(storage.persistent, false);
});

test('corrupt records still require recovery, even when browser storage is wrapped', () => {
  const storage = browserStorage({ localStorage: { getItem: () => '{corrupt' } });
  assert.ok(loadStore(storage).error); assert.equal(storage.getItem(STORAGE_KEY), '{corrupt');
});

test('guest recovery never adopts an account cache or malformed backup', () => {
  const guest = { ...emptyStore(), coins: 321 };
  assert.equal(loadGuestStore({ getItem: key => key.endsWith('-guest') ? JSON.stringify(guest) : 'account' }).coins, 321);
  assert.deepEqual(loadGuestStore({ getItem: () => '{broken' }), emptyStore());
});

test('embedded browser detection and throwing share APIs degrade safely', () => {
  assert.equal(isInAppBrowser('iPhone Instagram 350.0'), true);
  assert.equal(isInAppBrowser('Android [FBAN/FB4A;FBAV/530]'), true);
  assert.equal(isInAppBrowser('Mozilla Safari/605.1.15'), false);
  assert.equal(canShareFile(new Blob(['png']), 'card.png', { share() {}, canShare() { throw new Error('Denied'); } }), false);
});

test('login checks that the WebView accepted the session cookie before adopting the account', async () => {
  const client = new OnlineClient(), calls = [];
  client.request = async path => { calls.push(path); return path === '/auth/login' ? { user: { id: 'player' }, revision: 1 } : { user: null }; };
  await assert.rejects(client.authenticate('login', {}), /쿠키/);
  assert.equal(client.user, null); assert.deepEqual(calls, ['/auth/login', '/auth/session']);
});
