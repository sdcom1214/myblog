import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app.js';
import { trainingInput } from './training-input.mjs';
import { playSeason } from '../src/engine.js';

const profile = { name: '부카요 사카', number: 7, position: 'FW', foot: '왼발', preferred: 'arsenal', academy: 'hale-end' };
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'football-server-'));
  const state = { dir, app: createApp({ database: join(dir, 'game.sqlite'), ...options }) };
  async function listen() { await new Promise(r => state.app.server.listen(0, '127.0.0.1', r)); state.url = `http://127.0.0.1:${state.app.server.address().port}`; }
  await listen();
  t.after(async () => { await state.app.close(); await rm(dir, { recursive: true, force: true }); });
  state.restart = async () => { await state.app.close(); state.app = createApp({ database: join(dir, 'game.sqlite'), ...options }); await listen(); };
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
  await a.command('train', { skill: 0 }); await a.command('shot', { input: trainingInput(a.data.current) }); await a.command('season', {}, 400);
  await f.restart(); const result = await a.request('/save'); assert.deepEqual(result.data.current.pendingTraining.shots, [2]);
  for (const score of [2, 1, 0, 2]) await a.command('shot', { input: trainingInput(a.data.current, score) });
  await a.command('finish-training'); assert.equal(a.data.current.lastTraining.score, 7);
  await a.command('train', { skill: 1 }, 400);
});
test('all training games validate inputs on the server and award personal achievements once', async t => {
  const f = await fixture(t);
  for (const position of ['FW','GK']) for (let skill = 0; skill < 5; skill++) {
    const a = f.client(); await a.signup(`train-${position}-${skill}`); await a.command('create', { profile: { ...profile, position } }); await professional(a, false);
    await a.command('train', { skill }); const before = structuredClone(a.data.current.pendingTraining);
    await a.command('shot', { input: { score: 100 } }, 400); await a.command('shot', { marker: 50 }, 400);
    await a.request('/save'); assert.deepEqual(a.data.current.pendingTraining, before);
    for (let i = 0; i < 5; i++) await a.command('shot', { input: trainingInput(a.data.current) });
    await a.command('finish-training'); assert.equal(a.data.current.lastTraining.score, 10);
    const club = await a.request('/club'); assert.ok(club.achievements.some(x => x.key === 'perfect-training'));
    assert.equal(club.achievements.filter(x => x.key === 'first-training').length, 1);
  }
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

test('imported store equipment and coins cannot enter verified careers through creation or progression', async t => {
  const f = await fixture(t), a = f.client(); await a.signup('economy'); await professional(a);
  const trusted = structuredClone(a.data.current);
  const forged = structuredClone(a.data); forged.inventory = ['boots', 'kit']; forged.coins = 999999;
  await a.request('/save', 'PUT', { data: forged, revision: a.revision });
  await a.command('season'); assert.deepEqual(a.data.current.inventory, trusted.inventory);
  assert.equal(a.data.coins, a.data.current.coins); assert.ok(a.data.coins < 999999);
  const expectedCoins = a.data.coins;
  const again = structuredClone(a.data); again.inventory = ['boots']; again.coins = 888888;
  await a.request('/save', 'PUT', { data: again, revision: a.revision });
  await a.command('create', { profile });
  assert.deepEqual(a.data.current.inventory, trusted.inventory); assert.deepEqual(a.data.inventory, trusted.inventory);
  assert.equal(a.data.coins, expectedCoins);
});

test('duels and rebirth inherit server equipment rather than imported store equipment', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(); await a.signup('economyA'); await b.signup('economyB');
  for (const client of [a, b]) {
    await client.command('create', { profile });
    const forged = structuredClone(client.data); forged.inventory = ['boots', 'kit']; forged.coins = 999999;
    await client.request('/save', 'PUT', { data: forged, revision: client.revision });
  }
  const invite = await a.request('/duels', 'POST', { mode: 'friend', position: 'FW', opponentId: b.user.id }, 201);
  await b.request(`/duels/${invite.duel.id}/respond`, 'POST', { accept: true }); await a.request('/save');
  for (const client of [a, b]) { assert.deepEqual(client.data.inventory, []); assert.deepEqual(client.data.current.inventory, []); assert.equal(client.data.coins, 100); }
  await youth(a, false); await a.command('retire');
  const coins = a.data.coins, forged = structuredClone(a.data); forged.coins = 999999; forged.inventory = ['boots'];
  await a.request('/save', 'PUT', { data: forged, revision: a.revision });
  await a.request('/shop/buy', 'POST', { item: 'rebirth' }); await a.request('/club/rebirth', 'POST', { id: a.data.current.id });
  assert.deepEqual(a.data.current.inventory, []); assert.deepEqual(a.data.inventory, []); assert.equal(a.data.coins, coins);
});

test('verified commands reject a save that disagrees with the canonical server career', async t => {
  const f = await fixture(t), a = f.client(); await a.signup('canonical'); await a.command('create', { profile });
  const damaged = structuredClone(a.data); damaged.current.skills[0] += 1;
  f.app.db.prepare('UPDATE saves SET data=? WHERE user_id=?').run(JSON.stringify(damaged), a.user.id);
  await a.command('reveal', {}, 409);
  assert.deepEqual(JSON.parse(f.app.db.prepare('SELECT data FROM careers WHERE id=?').get(a.data.current.id).data).skills, a.data.current.skills);
});

test('public career records omit random state, training challenges, equipment and contract offers', async t => {
  const f = await fixture(t), a = f.client(), anonymous = f.client(); await a.signup('publicsafe'); await professional(a);
  await a.command('train', { skill: 0 });
  const result = await anonymous.request(`/careers/public?id=${a.data.current.id}`);
  for (const key of ['rng', 'coins', 'inventory', 'pendingTraining', 'candidates', 'offers', 'duelId', 'lastTraining', 'trainingUsed']) assert.equal(Object.hasOwn(result.career, key), false, key);
  assert.equal(result.career.public, true); assert.equal(result.career.name, profile.name);
  assert.ok(result.career.achievements.length >= 80);
  assert.deepEqual(result.career.records, a.data.current.records);
  const publicJSON = JSON.stringify(result); assert.ok(!publicJSON.includes(a.user.email)); assert.ok(!publicJSON.includes('football-password'));
  await anonymous.request('/save', 'GET', undefined, 401);
});

test('an online season cannot be replayed from the client-visible offline random state', async t => {
  const f = await fixture(t), a = f.client(); await a.signup('unpredictable'); await professional(a);
  const prediction = playSeason(structuredClone(a.data.current));
  await a.command('season');
  assert.notEqual(a.data.current.rng, prediction.rng);
});

test('malformed URLs, encoded traversal and invalid JSON fail without crashing the server', async t => {
  const f = await fixture(t);
  const raw = path => new Promise((resolve, reject) => {
    const request = httpRequest(f.url, { path }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    }); request.on('error', reject); request.end();
  });
  assert.equal((await raw('http://[')).status, 400);
  assert.equal((await raw('/%2e%2e%2fserver/app.js')).status, 403);
  assert.equal((await raw('/%ZZ')).status, 400);
  for (const payload of ['null', '[]', '{']) {
    const r = await fetch(f.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }); assert.equal(r.status, 400);
  }
  assert.equal((await fetch(f.url + '/api/health')).status, 200);
});

test('malformed command and database identifiers do not leak internal errors or change saves', async t => {
  const f = await fixture(t), a = f.client(); await a.signup('invalidsafe');
  const before = await a.request('/save');
  await a.command('create', { profile: null }, 400); await a.command('create', { profile: [] }, 400);
  await a.request('/career/action', 'POST', { command: 'create', args: 'invalid', revision: a.revision }, 400);
  await a.request('/teams', 'POST', { id: {}, name: 'Unsafe FC', squad: [] }, 400);
  await a.request('/teams', 'POST', { id: '"><svg/onload=alert(1)>', name: 'Unsafe FC', squad: [] }, 400);
  await a.request('/teams', 'POST', { name: 'Unsafe FC', squad: [{}] }, 400);
  await a.request('/club/rename', 'POST', { id: {}, name: 'A' }, 400);
  assert.deepEqual(await a.request('/save'), before);
  await a.command('create', { profile }); await a.command('choose', { index: 0 });
  await a.command('growth', { focus: null, role: '중앙' }, 400);
});

test('other accounts cannot edit teams, rename players or consume tickets through foreign IDs', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(); await a.signup('ownerA'); await b.signup('ownerB');
  await youth(a); await a.command('retire');
  const team = (await a.request('/teams', 'POST', { name: 'Owner FC', squad: [] })).team;
  await b.request('/shop/buy', 'POST', { item: 'rename' }); await b.request('/shop/buy', 'POST', { item: 'rebirth' });
  const before = (await b.request('/shop')).wallet;
  await b.request('/teams', 'POST', { id: team.id, name: 'Stolen FC', squad: [] }, 403);
  await b.request(`/teams/${team.id}`, 'DELETE', {}, 404);
  await b.request('/club/rename', 'POST', { id: a.data.current.id, name: 'Stolen' }, 404);
  await b.request('/club/rebirth', 'POST', { id: a.data.current.id }, 404);
  assert.deepEqual((await b.request('/shop')).wallet, before);
  assert.equal((await a.request('/club')).teams[0].name, 'Owner FC');
});

test('CSRF origins, forged sessions, auth throttling and SQL-like searches are rejected', async t => {
  const f = await fixture(t), a = f.client(), anonymous = f.client(); await a.signup('authsafe');
  await a.request('/shop/reward', 'POST', {}, 403, { Origin: 'null' });
  await a.request('/shop/reward', 'POST', {}, 403, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'same-site' });
  await a.request('/save', 'GET', undefined, 401, { Cookie: 'fc_session=forged' });
  const users = await a.request('/users?q=' + encodeURIComponent("%' OR 1=1--")); assert.deepEqual(users.users, []);
  for (let i = 0; i < 14; i++) await anonymous.request('/auth/login', 'POST', { email: 'authsafe@example.test', password: 'wrong-password' }, 401);
  await anonymous.request('/auth/login', 'POST', { email: 'authsafe@example.test', password: 'wrong-password' }, 429);
  assert.equal((await a.request('/auth/session')).user.id, a.user.id);
});

test('large bodies and internal database errors expose no stack, SQL or filesystem details', async t => {
  const f = await fixture(t), a = f.client(); await a.signup('errorsafe');
  const large = await fetch(f.url + '/api/save', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: a.cookie }, body: ' '.repeat(5_000_001) }); assert.equal(large.status, 413);
  f.app.db.exec('DROP TABLE teams');
  const r = await a.request('/teams', 'POST', { name: 'A FC', squad: [] }, 500);
  assert.equal(r.code, null); assert.equal(r.error, '서버 요청을 처리하지 못했습니다.');
  assert.equal((await a.request('/health')).ok, true);
});

test('built pages and API errors include an enforced security policy', async t => {
  const f = await fixture(t);
  for (const path of ['/', '/api/save', '/%ZZ']) {
    const r = await fetch(f.url + path);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self';/);
    assert.match(r.headers.get('content-security-policy'), /object-src 'none';/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  }
});

test('HTTPS mode uses secure cookies, HSTS and rejects same-host HTTP mutation origins', async t => {
  const f = await fixture(t, { secureCookies: true }), a = f.client(); await a.signup('httpssafe');
  const login = await fetch(f.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'httpssafe@example.test', password: 'football-password-123' }) });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /; Secure/);
  assert.match(login.headers.get('strict-transport-security'), /max-age=31536000/);
  await a.request('/shop/reward', 'POST', {}, 403, { Origin: f.url });
  await a.request('/shop/reward', 'POST', {}, 200, { Origin: f.url.replace('http:', 'https:') });
});

test('Google OAuth never auto-links an email/password account by email alone', async t => {
  const f = await fixture(t, { google: { clientId: 'test-client', clientSecret: 'test-secret', redirectUri: 'https://example.test/api/auth/google/callback' } });
  const owner = f.client(); await owner.signup('oauthcollision');
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return Promise.resolve(Response.json({ access_token: 'test-token' }));
    if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') return Promise.resolve(Response.json({ sub: 'google-subject', email: 'oauthcollision@example.test', email_verified: true }));
    return originalFetch(url, options);
  });
  const start = await fetch(f.url + '/api/auth/google', { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const result = await fetch(f.url + '/api/auth/google/callback?code=test&state=' + state, { headers: { Cookie: start.headers.get('set-cookie').split(';')[0] }, redirect: 'manual' });
  assert.equal(result.status, 409); assert.equal(result.headers.get('set-cookie'), null);
  assert.equal(f.app.db.prepare('SELECT google_id FROM users WHERE id=?').get(owner.user.id).google_id, null);
  assert.equal((await owner.request('/auth/session')).user.id, owner.user.id);
});

test('Google login keeps a stable provider identity and rejects a reused OAuth callback', async t => {
  const f = await fixture(t, { google: { clientId: 'test-client', clientSecret: 'test-secret', redirectUri: 'https://example.test/api/auth/google/callback' } });
  const other = f.client(); await other.signup('separateoauth');
  let email = 'newgoogle@example.test'; const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return Promise.resolve(Response.json({ access_token: 'test-token' }));
    if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') return Promise.resolve(Response.json({ sub: 'stable-subject', email, email_verified: true }));
    return originalFetch(url, options);
  });
  async function login() {
    const start = await fetch(f.url + '/api/auth/google', { redirect: 'manual' });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const url = f.url + '/api/auth/google/callback?code=test&state=' + state;
    const options = { headers: { Cookie: start.headers.get('set-cookie').split(';')[0] }, redirect: 'manual' };
    const response = await fetch(url, options); assert.equal(response.status, 302);
    const session = await fetch(f.url + '/api/auth/session', { headers: { Cookie: response.headers.get('set-cookie').split(';')[0] } });
    assert.equal((await fetch(url, options)).status, 403);
    return (await session.json()).user;
  }
  const first = await login(); email = 'separateoauth@example.test';
  const second = await login(); assert.equal(second.id, first.id); assert.notEqual(second.id, other.user.id);
  assert.equal(f.app.db.prepare('SELECT google_id FROM users WHERE id=?').get(other.user.id).google_id, null);
});

test('static serving blocks dotfiles and symlinks outside the public build directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'football-static-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'public'); await mkdir(root);
  await writeFile(join(root, 'index.html'), '<h1>Game</h1>');
  await writeFile(join(root, '.env.production'), 'PRIVATE_CONFIG=secret');
  await writeFile(join(dir, 'private.json'), '{"secret":"server-only"}');
  await symlink(join(dir, 'private.json'), join(root, 'linked.json'));
  const f = await fixture(t, { staticRoot: root });
  for (const path of ['/.env.production', '/%2eenv.production', '/linked.json']) {
    const result = await fetch(f.url + path);
    assert.equal(result.status, 403, path); assert.doesNotMatch(await result.text(), /PRIVATE_CONFIG|server-only/);
  }
  const home = await fetch(f.url + '/'); assert.equal(home.status, 200); assert.equal(await home.text(), '<h1>Game</h1>');
});

test('unchanged archived careers do not incur writes or move their update timestamps', async t => {
  const f = await fixture(t), a = f.client(); await a.signup('archivecost');
  await youth(a); await a.command('retire'); const archived = a.data.current.id;
  await a.command('create', { profile });
  f.app.db.prepare('UPDATE careers SET updated=1 WHERE id=?').run(archived);
  const changes = () => f.app.db.prepare('SELECT total_changes() AS n').get().n;
  const before = changes(); await a.command('reveal');
  assert.equal(changes() - before, 2, 'only the current career and save snapshot should be written');
  assert.equal(f.app.db.prepare('SELECT updated FROM careers WHERE id=?').get(archived).updated, 1);
  const incoming = structuredClone(a.data); incoming.archives[0].coins++;
  await a.request('/save', 'PUT', { data: incoming, revision: a.revision });
  assert.equal(f.app.db.prepare('SELECT verified FROM careers WHERE id=?').get(archived).verified, 0);
});
