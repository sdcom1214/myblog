import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

const profile = { name: '부카요 사카', number: 7, position: 'FW', foot: '왼발', preferred: 'arsenal', academy: 'hale-end' };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'football-server-'));
  const state = { dir, app: createApp({ database: join(dir, 'game.sqlite') }) };
  async function listen() { await new Promise(r => state.app.server.listen(0, '127.0.0.1', r)); state.url = `http://127.0.0.1:${state.app.server.address().port}`; }
  await listen();
  t.after(async () => { await state.app.close(); await rm(dir, { recursive: true, force: true }); });
  state.restart = async () => { await state.app.close(); state.app = createApp({ database: join(dir, 'game.sqlite') }); await listen(); };
  state.client = () => {
    const client = { cookie: '', revision: 0, data: null };
    client.request = async (path, method = 'GET', body, expected = 200, headers = {}) => {
      const response = await fetch(state.url + '/api' + path, { method, headers: { ...(client.cookie ? { Cookie: client.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const result = await response.json();
      assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
      const session = response.headers.get('set-cookie'); if (session) client.cookie = session.split(';')[0];
      if (result.data) { client.data = result.data; client.revision = result.revision; }
      return result;
    };
    client.signup = async name => { const r = await client.request('/auth/signup', 'POST', { nickname: name, email: `${name}@example.test`, password: 'football-password-123' }, 201); client.user = r.user; return r; };
    client.command = (command, args = {}, expected = 200) => client.request('/career/action', 'POST', { command, args, revision: client.revision }, expected);
    return client;
  };
  return state;
}
async function youth(c, create = true) {
  if (create) await c.command('create', { profile });
  await c.command('reveal'); await c.command('choose', { index: 0 }); await c.command('growth', { focus: [0, 2], role: c.data.current.position === 'GK' ? '수문장' : '중앙' }); await c.command('season'); await c.command('next');
}
async function professional(c, create = true) {
  await youth(c, create); await c.command('develop'); await c.command('next'); await c.command('develop'); await c.command('next'); await c.command('trial', { retry: true }); await c.command('sign', { index: 0 });
}

test('accounts use hashed passwords, HttpOnly sessions and distinct private saves', async t => {
  const f = await fixture(t), a = f.client(), b = f.client();
  await a.signup('saka'); await b.signup('foden'); await a.command('create', { profile });
  assert.equal((await b.request('/save')).data.current, null);
  assert.notEqual(a.cookie, b.cookie);
  const stored = f.app.db.prepare('SELECT password FROM users WHERE id=?').get(a.user.id).password;
  assert.ok(stored.includes(':')); assert.ok(!stored.includes('football-password'));
  const response = await fetch(f.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'saka@example.test', password: 'football-password-123' }) });
  assert.match(response.headers.get('set-cookie'), /HttpOnly/); assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  await a.request('/auth/logout', 'POST', {}); await a.request('/save', 'GET', undefined, 401);
  await a.request('/auth/login', 'POST', { email: 'saka@example.test', password: 'wrong-password' }, 401);
});
test('other accounts cannot overwrite owned careers and stale revisions cannot overwrite newer saves', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(); await a.signup('arsenal'); await b.signup('city');
  await a.command('create', { profile });
  await b.request('/save', 'PUT', { data: a.data, revision: b.revision }, 403);
  const previousRevision = a.revision; await a.command('reveal');
  await a.request('/save', 'PUT', { data: a.data, revision: previousRevision }, 409);
  assert.equal((await a.request('/save')).data.current.candidates.every(x => x.opened), true);
});
test('server career commands enforce transitions and imported edits are excluded from public rankings', async t => {
  const f = await fixture(t), a = f.client(); await a.signup('online'); await professional(a);
  await a.command('season');
  const rankings = await a.request('/rankings'); assert.equal(rankings.rows.length, 1); assert.equal(rankings.rows[0].id, a.data.current.id);
  await a.command('sign', { index: 0 }, 400);
  const tampered = structuredClone(a.data); tampered.current.skills[0] += 1;
  assert.equal((await a.request('/save', 'PUT', { data: tampered, revision: a.revision })).verified, false);
  assert.equal((await a.request('/rankings')).rows.length, 0);
  await a.command('next', {}, 409);
});
test('five training shots and limits are enforced and preserved by server restart', async t => {
  const f = await fixture(t), a = f.client(); await a.signup('training'); await professional(a);
  await a.command('train', { skill: 0 }); await a.command('shot', { marker: 50 }); await a.command('season', {}, 400);
  await f.restart(); const result = await a.request('/save'); assert.deepEqual(result.data.current.pendingTraining.shots, [2]);
  for (const marker of [50, 35, 10, 50]) await a.command('shot', { marker });
  await a.command('finish-training'); assert.equal(a.data.current.lastTraining.score, 7);
  await a.command('train', { skill: 1 }, 400);
});
test('friends start equal candidate careers and the server compares both retired careers', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(), outsider = f.client();
  await a.signup('yamal'); await b.signup('gavi'); await outsider.signup('outsider');
  assert.equal((await a.request('/users?q=ga')).users[0].id, b.user.id);
  const invite = await a.request('/duels', 'POST', { mode: 'friend', position: 'FW', opponentId: b.user.id }, 201);
  await outsider.request(`/duels/${invite.duel.id}/respond`, 'POST', { accept: true }, 404);
  await b.request(`/duels/${invite.duel.id}/respond`, 'POST', { accept: true }); await a.request('/save');
  assert.deepEqual(a.data.current.candidates, b.data.current.candidates);
  assert.notEqual(a.data.current.id, b.data.current.id);
  await professional(a, false); await professional(b, false);
  await a.command('season'); await b.command('season'); await a.command('retire'); await b.command('retire');
  const duel = (await a.request('/duels')).duels[0]; assert.equal(duel.status, 'complete'); assert.equal(duel.result.scores.length, 2);
  assert.ok(duel.result.scores.every(Number.isFinite)); assert.ok(duel.result.scores.every(x => x >= 0));
});
test('random matchmaking pairs users of the same position and supports cancelling pending requests', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(); await a.signup('keeper1'); await b.signup('keeper2');
  const waiting = await a.request('/duels', 'POST', { mode: 'random', position: 'GK' }, 201); assert.equal(waiting.duel.status, 'waiting');
  await a.request(`/duels/${waiting.duel.id}`, 'DELETE', {});
  await a.request('/duels', 'POST', { mode: 'random', position: 'GK' }, 201);
  const matched = await b.request('/duels', 'POST', { mode: 'random', position: 'GK' }); assert.equal(matched.duel.status, 'active');
  await a.request('/save'); assert.equal(a.data.current.position, 'GK');
  assert.deepEqual(a.data.current.candidates, b.data.current.candidates);
});
test('MY CLUB ownership, stored team players, server battle results and team ELO are persistent', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(); await a.signup('teamA'); await b.signup('teamB');
  await professional(a); await a.command('retire'); await a.request('/club/players', 'POST', { id: a.data.current.id });
  await b.request('/teams', 'POST', { name: 'B FC', squad: [a.data.current.id] }, 400);
  const teamA = (await a.request('/teams', 'POST', { name: 'A FC', squad: [a.data.current.id] })).team;
  const teamB = (await b.request('/teams', 'POST', { name: 'B FC', squad: [] })).team;
  await a.request(`/club/players/${a.data.current.id}`, 'DELETE', {}, 400);
  const battle = await a.request('/battles', 'POST', { teamId: teamA.id, mode: 'ranked' }); assert.equal(typeof battle.result.home, 'number');
  const rankings = (await a.request('/rankings?type=teams')).rows;
  assert.equal(rankings.length, 2); assert.equal(rankings.reduce((sum, x) => sum + x.elo, 0), 2400);
  assert.equal((await a.request('/battles')).battles.length, 1);
  assert.ok(rankings.some(x => x.id === teamB.id));
});
test('shop purchases, daily grants, rename and one-time rebirth use server balances', async t => {
  const f = await fixture(t), a = f.client(); await a.signup('rebirth'); await youth(a); await a.command('retire');
  const initial = structuredClone(a.data.current);
  await a.request('/shop/buy', 'POST', { item: 'rebirth' });
  await a.request('/shop/buy', 'POST', { item: 'rename' });
  const renamed = await a.request('/club/rename', 'POST', { id: initial.id, name: '새로운 사카' });
  assert.equal(renamed.wallet.renames, 0);
  const reborn = await a.request('/club/rebirth', 'POST', { id: initial.id });
  assert.equal(reborn.data.current.name, '새로운 사카'); assert.equal(reborn.data.current.age, 18); assert.equal(reborn.data.current.rebornFrom, initial.id);
  assert.deepEqual(reborn.data.current.candidates.map(x => x.skills), initial.candidates.map(x => x.skills));
  await a.request('/shop/buy', 'POST', { item: 'rebirth' }); await a.request('/club/rebirth', 'POST', { id: initial.id }, 400);
  await a.request('/shop/reward', 'POST', {}); await a.request('/shop/reward', 'POST', {}, 400);
  assert.equal((await a.request('/shop')).ledger.filter(x => x.item === '출석 보상').length, 1);
  await a.request('/shop/buy', 'POST', { item: 'slot-set' }, 400);
});
test('cross-site writes and missing JSON are rejected; unavailable Google auth reports its configuration state', async t => {
  const f = await fixture(t), a = f.client(); await a.signup('secure');
  await a.request('/shop/reward', 'POST', {}, 403, { Origin: 'https://unrelated.example' });
  await a.request('/shop/reward', 'POST', {}, 403, { 'Sec-Fetch-Site': 'cross-site' });
  await a.request('/auth/login', 'POST', {}, 415, { 'Content-Type': 'text/plain' });
  await a.request('/auth/google', 'GET', undefined, 503);
  assert.equal((await a.request('/auth/session')).googleEnabled, false);
});

test('duel imports reject changed or removed active careers atomically and still allow normal completion', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(); await a.signup('protectedA'); await b.signup('protectedB');
  const invite = await a.request('/duels', 'POST', { mode: 'friend', position: 'FW', opponentId: b.user.id }, 201);
  await b.request(`/duels/${invite.duel.id}/respond`, 'POST', { accept: true }); await a.request('/save');
  await professional(a, false); await professional(b, false); await b.command('retire');
  const before = structuredClone(a.data), revision = a.revision;
  const edited = structuredClone(before); edited.current.stage = 'retired'; edited.current.peakOvr = 99; edited.current.nationalCaps = 999;
  await a.request('/save', 'PUT', { data: edited, revision }, 409);
  const removed = structuredClone(before); removed.current = null;
  await a.request('/save', 'PUT', { data: removed, revision }, 409);
  const restored = await a.request('/save'); assert.equal(restored.revision, revision); assert.equal(restored.verified, true); assert.deepEqual(restored.data, before);
  assert.equal((await a.request('/duels')).duels[0].status, 'active');
  const preferences = structuredClone(before); preferences.muted = !preferences.muted;
  assert.equal((await a.request('/save', 'PUT', { data: preferences, revision })).verified, true);
  await a.command('retire'); assert.equal((await a.request('/duels')).duels[0].status, 'complete');
  const complete = structuredClone(a.data); complete.current.nationalCaps = 999;
  await a.request('/save', 'PUT', { data: complete, revision: a.revision }, 409);
});

test('unverified imported careers cannot become verified through rebirth or consume a ticket', async t => {
  const f = await fixture(t), a = f.client(); await a.signup('imported'); await youth(a); await a.command('retire');
  const edited = structuredClone(a.data); edited.current.skills[0] += 1;
  await a.request('/save', 'PUT', { data: edited, revision: a.revision });
  await a.request('/shop/buy', 'POST', { item: 'rebirth' });
  const before = await a.request('/save');
  await a.request('/club/rebirth', 'POST', { id: a.data.current.id }, 409);
  const after = await a.request('/save'); assert.deepEqual(after, before);
});

test('duel result calculation ignores previously unverified participant records', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(); await a.signup('oldA'); await b.signup('oldB');
  const invite = await a.request('/duels', 'POST', { mode: 'friend', position: 'GK', opponentId: b.user.id }, 201);
  await b.request(`/duels/${invite.duel.id}/respond`, 'POST', { accept: true }); await a.request('/save');
  await youth(a, false); await youth(b, false); await a.command('retire');
  // Simulate an unverified row left by an older version, without trusting imported data again.
  f.app.db.prepare('UPDATE careers SET verified=0 WHERE id=?').run(a.data.current.id);
  await b.command('retire');
  const duel = (await b.request('/duels')).duels[0]; assert.equal(duel.status, 'active'); assert.equal(duel.result, null);
});


test('same-named teams get wins, losses and ELO from the score rather than their names', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(); await a.signup('sameA'); await b.signup('sameB');
  const teamA = (await a.request('/teams', 'POST', { name: 'United FC', squad: [] })).team;
  const teamB = (await b.request('/teams', 'POST', { name: 'United FC', squad: [] })).team;
  let wins = 0;
  for (let i = 0; i < 12; i++) {
    const { result } = await a.request('/battles', 'POST', { teamId: teamA.id, mode: 'ranked' });
    const won = result.penalties ? result.penalties[0] > result.penalties[1] : result.home > result.away;
    wins += +won; assert.equal(result.eloDelta > 0, won);
  }
  const teams = (await a.request('/rankings?type=teams')).rows;
  assert.equal(teams.find(x => x.id === teamA.id).wins, wins);
  assert.equal(teams.find(x => x.id === teamB.id).wins, 12 - wins);
  assert.equal(teams.reduce((sum, x) => sum + x.elo, 0), 2400);
});
