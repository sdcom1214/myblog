import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';
import { emptyStore, validateStore } from '../src/storage.js';

const hashPassword = promisify(scrypt);
const hash = text => createHash('sha256').update(text).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const seed = () => randomBytes(4).readUInt32LE();
const json = text => JSON.parse(text);
const now = () => Date.now();
const fail = (status, message, code) => { const error = new Error(message); error.status = status; error.code = code; throw error; };
const requireValue = (condition, message, status = 400) => { if (!condition) fail(status, message); };
const safeUser = u => u && ({ id: u.id, nickname: u.nickname, email: u.email });
const profiles = data => [data.current, ...data.archives].filter(Boolean);
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
const catalogue = [
  { id: 'player-slots', name: '선수 슬롯 +12', cost: 100, slots: 12 },
  { id: 'team-slot', name: '팀 슬롯 +1', cost: 60, teams: 1 },
  { id: 'slot-set', name: '선수 +12 · 팀 +1 세트', cost: 140, slots: 12, teams: 1 },
  { id: 'rebirth', name: '회귀권', cost: 5, tickets: 1 },
  { id: 'rename', name: '개명권', cost: 10, renames: 1 },
];

export function createApp({ database = resolve('.local/server.sqlite'), staticRoot = resolve('dist'), secureCookies = process.env.COOKIE_SECURE === 'true', google = null } = {}) {
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, nickname TEXT UNIQUE NOT NULL COLLATE NOCASE, password TEXT, google_id TEXT UNIQUE, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS saves(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS careers(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wallets(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, coins INTEGER NOT NULL DEFAULT 100, player_slots INTEGER NOT NULL DEFAULT 20, team_slots INTEGER NOT NULL DEFAULT 1, tickets INTEGER NOT NULL DEFAULT 0, renames INTEGER NOT NULL DEFAULT 0, reward_day TEXT);
    CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item TEXT NOT NULL, delta INTEGER NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS duels(id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES users(id), guest_id TEXT REFERENCES users(id), position TEXT NOT NULL, seed INTEGER NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL, host_career TEXT, guest_career TEXT, result TEXT, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, squad TEXT NOT NULL, strength REAL NOT NULL, elo INTEGER NOT NULL DEFAULT 1200, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, challenge INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS battles(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), team_id TEXT NOT NULL, opponent TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS achievements(key TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), career_id TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS personal_achievements(user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, career_id TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(user_id,key));
    CREATE TABLE IF NOT EXISTS oauth(state TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
  `);
  const statement = sql => db.prepare(sql);
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const rate = new Map();
  function limit(req, scope, max = 20, interval = 60_000) {
    const key = `${scope}:${req.socket.remoteAddress}`, previous = rate.get(key);
    const entry = previous && previous.until > now() ? previous : { count: 0, until: now() + interval };
    rate.set(key, entry); if (++entry.count > max) fail(429, '잠시 후 다시 시도해 주세요.');
    if (rate.size > 3000) for (const [k, v] of rate) if (v.until < now()) rate.delete(k);
  }
  const wallet = id => statement('SELECT coins, player_slots AS playerSlots, team_slots AS teamSlots, tickets, renames, reward_day AS rewardDay FROM wallets WHERE user_id=?').get(id);
  function getSave(id) {
    const row = statement('SELECT * FROM saves WHERE user_id=?').get(id);
    return row ? { data: json(row.data), revision: row.revision, updated: row.updated } : { data: emptyStore(), revision: 0, updated: null };
  }
  function persist(id, data, revision) {
    requireValue(validateStore(data), '유효한 게임 저장 파일이 아닙니다.');
    statement('INSERT INTO saves(user_id,data,revision,updated) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated=excluded.updated').run(id, JSON.stringify(data), revision, now());
    return { data, revision, updated: now() };
  }
  function careerRow(id, career, verified = false) {
    const previous = statement('SELECT * FROM careers WHERE id=?').get(career.id);
    requireValue(!previous || previous.user_id === id, '다른 계정의 선수 기록입니다.', 403);
    statement('INSERT INTO careers(id,user_id,data,verified,created,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,verified=excluded.verified,updated=excluded.updated').run(career.id, id, JSON.stringify(career), +verified, previous?.created || now(), now());
    if (verified && career.records.length) {
      const t = E.totals(career), milestones = [
        ['first-pro', career.proSeasons > 0, '첫 프로 시즌'], ['first-100-goals', t.goals >= 100, '통산 100골'],
        ['first-100-assists', t.assists >= 100, '통산 100도움'], ['first-national', career.nationalCaps > 0, '첫 국가대표 발탁'],
        ['first-title', career.trophies.length > 0, '첫 리그 우승'], ['first-legend', E.legacy(career) >= 4000, 'LEGACY 4,000'],
      ];
      for (const [key, condition, title] of milestones) if (condition) {
        statement('INSERT OR IGNORE INTO achievements VALUES(?,?,?,?,?)').run(key, id, career.id, title, now());
        statement('INSERT OR IGNORE INTO personal_achievements VALUES(?,?,?,?,?)').run(id, key, career.id, title, now());
      }
    }
    updateDuels(career.id);
  }
  function updateDuels(careerId) {
    const rows = statement('SELECT * FROM duels WHERE status=? AND (host_career=? OR guest_career=?)').all('active', careerId, careerId);
    for (const d of rows) {
      const a = statement('SELECT data,verified FROM careers WHERE id=?').get(d.host_career), b = statement('SELECT data,verified FROM careers WHERE id=?').get(d.guest_career);
      if (!a?.verified || !b?.verified) continue;
      const home = json(a.data), away = json(b.data);
      if (home.stage !== 'retired' || away.stage !== 'retired') continue;
      const scores = [E.legacy(home), E.legacy(away)];
      const result = { homeName: home.name, awayName: away.name, scores, winnerId: scores[0] === scores[1] ? null : scores[0] > scores[1] ? d.host_id : d.guest_id };
      statement('UPDATE duels SET status=?,result=? WHERE id=?').run('complete', JSON.stringify(result), d.id);
    }
  }
  function newAccount(email, nickname, password = null, googleId = null) {
    const id = randomUUID();
    transaction(() => {
      statement('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id, email, nickname, password, googleId, now());
      statement('INSERT INTO wallets(user_id) VALUES(?)').run(id);
      persist(id, emptyStore(), 0);
    });
    return statement('SELECT * FROM users WHERE id=?').get(id);
  }
  function authenticate(req, needed = true) {
    const sessionToken = cookie(req, 'fc_session');
    const u = sessionToken && statement('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').get(hash(sessionToken), now());
    if (needed && !u) fail(401, '로그인과 닉네임 등록이 필요합니다.');
    return u || null;
  }
  function setSession(res, u) {
    const secret = token();
    statement('DELETE FROM sessions WHERE expires<?').run(now());
    statement('INSERT INTO sessions VALUES(?,?,?)').run(hash(secret), u.id, now() + 30 * 86400_000);
    res.setHeader('Set-Cookie', `fc_session=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureCookies ? '; Secure' : ''}`);
  }
  async function body(req) {
    requireValue(req.headers['content-type']?.split(';')[0] === 'application/json', 'JSON 요청이 필요합니다.', 415);
    let text = '', size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 5_000_000) fail(413, '요청 크기는 5MB 이하여야 합니다.'); text += chunk; }
    try { const value = json(text || '{}'); requireValue(value && typeof value === 'object' && !Array.isArray(value), '올바른 요청이 아닙니다.'); return value; } catch (e) { if (e.status) throw e; fail(400, '올바른 JSON 요청이 아닙니다.'); }
  }
  function authorizeMutation(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, '다른 사이트에서 보낸 요청입니다.');
    if (req.headers.origin) {
      let origin; try { origin = new URL(req.headers.origin); } catch { fail(403, '올바른 출처가 아닙니다.'); }
      requireValue(origin.host === req.headers.host, '다른 사이트에서 보낸 요청입니다.', 403);
    }
  }
  const archive = data => {
    if (data.current?.records.length && !data.archives.some(x => x.id === data.current.id)) {
      requireValue(!data.current.pendingTraining, '진행 중인 훈련을 먼저 마쳐주세요.');
      requireValue(data.archives.length < 100, '보관함이 가득 찼습니다. 먼저 백업해 주세요.');
      data.archives.unshift(data.current.stage === 'retired' ? data.current : E.retire(data.current));
    }
  };
  function runCareer(id, command, args) {
    const saved = getSave(id), data = saved.data, c = data.current;
    let next;
    if (command === 'create') {
      archive(data); next = E.newCareer(args.profile, seed()); next.id = `FC-${randomUUID()}`;
    } else {
      requireValue(c, '진행 중인 선수가 없습니다.');
      const row = statement('SELECT * FROM careers WHERE id=? AND user_id=?').get(c.id, id);
      requireValue(row?.verified, '이 선수는 기기 저장 기록입니다. 온라인 커리어를 새로 시작해 주세요.', 409);
      switch (command) {
        case 'choose': next = E.chooseCandidate(c, args.index); break;
        case 'growth': next = E.setGrowth(c, args.focus, args.role, args.technique); break;
        case 'season': next = E.playSeason(c); break;
        case 'next': next = E.continueReview(c); break;
        case 'develop': next = E.develop(c); break;
        case 'trial': next = E.trial(c, args.retry === true); break;
        case 'sign': next = E.signOffer(c, args.index); break;
        case 'event': next = E.chooseEvent(c, args.choice); break;
        case 'train': next = E.beginTraining(c, args.skill); break;
        case 'shot': next = E.trainingShot(c, args.marker); break;
        case 'finish-training': next = E.finishTraining(c); break;
        case 'retire': next = E.retire(c); break;
        case 'focus':
          requireValue(Array.isArray(args.focus) && args.focus.length > 0 && args.focus.length <= 2 && new Set(args.focus).size === args.focus.length && args.focus.every(x => Number.isInteger(x) && x >= 0 && x < 5), '집중 육성은 1~2개입니다.');
          next = structuredClone(c); next.focus = args.focus; break;
        case 'reveal': next = structuredClone(c); for (const [i, candidate] of next.candidates.entries()) if (args.index === undefined || args.index === i) candidate.opened = true; break;
        case 'candidate-back': requireValue(c.stage === 'growth', '후보를 다시 고를 수 없습니다.'); next = structuredClone(c); next.stage = 'candidates'; break;
        default: fail(400, '알 수 없는 진행 명령입니다.');
      }
    }
    next.coins = data.coins + Math.max(0, next.coins - (c?.coins ?? 100)); next.inventory = [...data.inventory];
    data.current = next; data.coins = next.coins;
    transaction(() => { for (const previous of data.archives) { const r = statement('SELECT verified FROM careers WHERE id=? AND user_id=?').get(previous.id, id); careerRow(id, previous, !!r?.verified); } careerRow(id, next, true); persist(id, data, saved.revision + 1); if (command === 'season') statement('UPDATE wallets SET coins=coins+5 WHERE user_id=?').run(id); });
    return { ...getSave(id), verified: true, wallet: wallet(id) };
  }
  function startDuel(d) {
    transaction(() => {
      for (const [side, id] of [['host', d.host_id], ['guest', d.guest_id]]) {
        const old = getSave(id), data = old.data, previous = data.current;
        requireValue(!previous?.pendingTraining, '참가자의 특별훈련이 진행 중입니다.');
        archive(data);
        const preferred = previous?.preferred || 'arsenal', academy = previous?.academy || 'hale-end';
        const nickname = statement('SELECT nickname FROM users WHERE id=?').get(id).nickname;
        const career = E.newCareer({ name: nickname.slice(0, 16), position: d.position, number: 10, foot: '오른발', preferred, academy }, d.seed);
        career.id = `FC-${d.id}-${side}`; career.duelId = d.id; career.coins = data.coins; career.inventory = [...data.inventory]; data.current = career;
        for (const item of data.archives) { const r = statement('SELECT verified FROM careers WHERE id=?').get(item.id); careerRow(id, item, !!r?.verified); }
        careerRow(id, career, true); persist(id, data, old.revision + 1);
        statement(`UPDATE duels SET ${side}_career=? WHERE id=?`).run(career.id, d.id);
      }
      statement('UPDATE duels SET status=? WHERE id=?').run('active', d.id);
    });
  }
  function duelView(d, id) {
    const opponentId = d.host_id === id ? d.guest_id : d.host_id;
    const opponent = opponentId && statement('SELECT nickname FROM users WHERE id=?').get(opponentId);
    const ownId = d.host_id === id ? d.host_career : d.guest_career;
    const opponentCareerId = d.host_id === id ? d.guest_career : d.host_career;
    const own = ownId && statement('SELECT data FROM careers WHERE id=?').get(ownId), rival = opponentCareerId && statement('SELECT data FROM careers WHERE id=?').get(opponentCareerId);
    const summary = row => { const c = row && json(row.data); return c && { name: c.name, age: c.age, stage: c.stage, seasons: c.proSeasons, score: E.legacy(c), ovr: E.ovr(c) }; };
    return { id: d.id, position: d.position, status: d.status, mode: d.mode, incoming: d.guest_id === id && d.status === 'pending', opponent: opponent?.nickname, own: summary(own), rival: summary(rival), result: d.result && json(d.result), created: d.created };
  }
  function publicCareer(row) {
    const c = json(row.data), t = E.totals(c);
    return { id: c.id, userId: row.user_id, nickname: row.nickname, name: c.name, position: c.position, team: c.team || c.preferred, age: c.age, stage: c.stage, score: E.legacy(c), ovr: E.ovr(c), peakOvr: c.peakOvr, seasons: c.proSeasons, goals: t.goals, assists: t.assists, saves: t.saves, cleanSheets: t.cleanSheets, rating: t.games ? E.round(t.rating / t.games) : 0, updated: row.updated };
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://football.internal'), path = url.pathname, method = req.method;
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    try {
      if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(method)) fail(405, '지원하지 않는 요청입니다.');
      if (['POST', 'PUT', 'DELETE'].includes(method)) authorizeMutation(req);
      if (path === '/api/health') return send(200, { ok: true, persistence: 'sqlite' });
      if (path === '/api/auth/session') return send(200, { user: safeUser(authenticate(req, false)), googleEnabled: !!google });
      if (path === '/api/auth/signup' && method === 'POST') {
        limit(req, 'auth', 15, 15 * 60_000); const b = await body(req);
        requireValue(typeof b.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) && b.email.length <= 200, '이메일 주소를 확인해 주세요.');
        requireValue(typeof b.password === 'string' && b.password.length >= 10 && b.password.length <= 128, '비밀번호는 10~128자로 입력해 주세요.');
        requireValue(typeof b.nickname === 'string' && /^[\p{L}\p{N}_ -]{2,16}$/u.test(b.nickname), '닉네임은 2~16자의 글자·숫자로 입력해 주세요.');
        const salt = randomBytes(16).toString('hex'), derived = (await hashPassword(b.password, salt, 64)).toString('hex');
        let u; try { u = newAccount(b.email.trim().toLowerCase(), b.nickname.trim(), `${salt}:${derived}`); } catch (e) { if (e.code?.includes('CONSTRAINT')) fail(409, '이미 사용 중인 이메일 또는 닉네임입니다.'); throw e; }
        setSession(res, u); return send(201, { user: safeUser(u), ...getSave(u.id), wallet: wallet(u.id), verified: false });
      }
      if (path === '/api/auth/login' && method === 'POST') {
        limit(req, 'auth', 15, 15 * 60_000); const b = await body(req);
        requireValue(typeof b.email === 'string' && typeof b.password === 'string' && b.password.length <= 128, '이메일과 비밀번호를 확인해 주세요.');
        const u = statement('SELECT * FROM users WHERE email=?').get(b.email.trim().toLowerCase()), password = u?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
        const [salt, expected] = password.split(':'), actual = await hashPassword(b.password, salt, 64);
        if (!u?.password || !timingSafeEqual(Buffer.from(expected, 'hex'), actual)) fail(401, '이메일 또는 비밀번호가 일치하지 않습니다.');
        setSession(res, u); const saved = getSave(u.id), c = saved.data.current;
        return send(200, { user: safeUser(u), ...saved, wallet: wallet(u.id), verified: !!(c && statement('SELECT verified FROM careers WHERE id=? AND user_id=?').get(c.id, u.id)?.verified) });
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        const secret = cookie(req, 'fc_session'); if (secret) statement('DELETE FROM sessions WHERE token=?').run(hash(secret));
        res.setHeader('Set-Cookie', `fc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookies ? '; Secure' : ''}`); return send(200, { ok: true });
      }
      if (path === '/api/auth/google' && method === 'GET') {
        requireValue(google, 'Google 로그인 연결 설정이 필요합니다.', 503);
        const state = token(), verifier = token(); statement('INSERT INTO oauth VALUES(?,?,?)').run(hash(state), verifier, now() + 600_000);
        res.setHeader('Set-Cookie', `fc_oauth=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secureCookies ? '; Secure' : ''}`);
        const params = new URLSearchParams({ client_id: google.clientId, redirect_uri: google.redirectUri, response_type: 'code', scope: 'openid email profile', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }); return res.end();
      }
      if (path === '/api/auth/google/callback' && method === 'GET') {
        requireValue(google && url.searchParams.get('state') === cookie(req, 'fc_oauth'), '로그인 요청을 다시 시작해 주세요.', 403);
        const state = url.searchParams.get('state'), flow = statement('SELECT * FROM oauth WHERE state=? AND expires>?').get(hash(state), now());
        requireValue(flow && url.searchParams.get('code'), '로그인 요청이 만료됐습니다.', 403); statement('DELETE FROM oauth WHERE state=?').run(hash(state));
        const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: google.clientId, client_secret: google.clientSecret, code: url.searchParams.get('code'), redirect_uri: google.redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier }), signal: AbortSignal.timeout(15_000) });
        const auth = await response.json(); requireValue(response.ok && auth.access_token, 'Google 로그인 연결에 실패했습니다.', 502);
        const infoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${auth.access_token}` }, signal: AbortSignal.timeout(15_000) });
        const info = await infoResponse.json(); requireValue(infoResponse.ok && info.email_verified && typeof info.sub === 'string' && typeof info.email === 'string', 'Google 계정을 확인하지 못했습니다.', 502);
        let u = statement('SELECT * FROM users WHERE google_id=? OR email=?').get(info.sub, info.email.toLowerCase());
        if (!u) u = newAccount(info.email.toLowerCase(), `선수${randomBytes(4).toString('hex')}`, null, info.sub);
        else if (!u.google_id) statement('UPDATE users SET google_id=? WHERE id=?').run(info.sub, u.id);
        setSession(res, u); res.writeHead(302, { Location: '/?login=success' }); return res.end();
      }
      if (path === '/api/rankings' && method === 'GET') {
        const type = url.searchParams.get('type') || 'live';
        if (type === 'firsts') return send(200, { rows: statement('SELECT achievements.*,users.nickname FROM achievements JOIN users ON users.id=achievements.user_id ORDER BY created').all() });
        if (type === 'teams') return send(200, { rows: statement('SELECT teams.id,teams.name,teams.strength,teams.elo,teams.wins,teams.losses,teams.challenge,users.nickname FROM teams JOIN users ON users.id=teams.user_id ORDER BY elo DESC LIMIT 100').all().map((t, i) => ({ ...t, rank: i + 1 })) });
        const metric = ['score', 'ovr', 'goals', 'assists', 'saves', 'cleanSheets', 'rating'].includes(url.searchParams.get('metric')) ? url.searchParams.get('metric') : 'score';
        let rows = statement('SELECT careers.*,users.nickname FROM careers JOIN users ON users.id=careers.user_id WHERE verified=1').all().map(publicCareer).filter(c => c.seasons > 0);
        if (type === 'rookies') rows = rows.filter(c => c.seasons <= 3);
        const position = url.searchParams.get('position'); if (Object.hasOwn(E.POSITIONS, position)) rows = rows.filter(c => c.position === position);
        rows.sort((a, b) => b[metric] - a[metric] || a.updated - b.updated);
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1); return send(200, { rows: rows.slice((page - 1) * 20, page * 20).map((c, i) => ({ ...c, rank: (page - 1) * 20 + i + 1 })), total: rows.length, page });
      }
      if (path === '/api/careers/public' && method === 'GET') {
        const row = statement('SELECT careers.*,users.nickname FROM careers JOIN users ON users.id=careers.user_id WHERE careers.id=? AND verified=1').get(url.searchParams.get('id'));
        requireValue(row, '공개된 선수 기록이 없습니다.', 404); return send(200, { summary: publicCareer(row), career: json(row.data) });
      }
      if (path === '/api/notices' && method === 'GET') return send(200, { notices: [{ id: 'football', title: '유럽 축구 커리어 안내', body: 'U18 아카데미부터 U21·U23 성장, 프로 계약과 은퇴까지. 로그인하면 온라인 커리어와 MY CLUB 기록을 계정에 저장합니다.' }, { id: 'duels', title: '친구와 커리어 매치', body: '같은 초기 능력치 후보로 시작해 두 선수의 은퇴 후 LEGACY SCORE를 비교합니다. 팀 배틀에서는 보관한 선수로 스쿼드를 편성합니다.' }] });
      if (!path.startsWith('/api/')) return serveStatic(path, method, res);
      const u = authenticate(req), id = u.id;
      if (path === '/api/save' && method === 'GET') { const saved = getSave(id), c = saved.data.current; return send(200, { ...saved, wallet: wallet(id), verified: !!(c && statement('SELECT verified FROM careers WHERE id=? AND user_id=?').get(c.id, id)?.verified) }); }
      if (path === '/api/save' && method === 'PUT') {
        const b = await body(req), old = getSave(id); requireValue(Number.isInteger(b.revision) && b.revision === old.revision, '다른 기기에서 기록이 변경됐습니다. 서버 기록을 다시 불러와 주세요.', 409);
        requireValue(validateStore(b.data), '저장 파일을 확인해 주세요.');
        transaction(() => {
          // Imports may change local careers, but cannot replace a competition's server record.
          const participating = statement("SELECT * FROM duels WHERE status IN ('active','complete') AND (host_id=? OR guest_id=?)").all(id, id);
          for (const duel of participating) {
            const careerId = duel.host_id === id ? duel.host_career : duel.guest_career;
            const row = statement('SELECT data FROM careers WHERE id=? AND user_id=?').get(careerId, id);
            const incoming = profiles(b.data).filter(c => c.id === careerId);
            if (duel.status === 'active') {
              requireValue(incoming.length > 0, '진행 중인 대전 선수는 저장 파일로 삭제할 수 없습니다.', 409);
              if (old.data.current?.id === careerId) requireValue(b.data.current?.id === careerId, '진행 중인 대전은 서버에서 계속해 주세요.', 409);
            }
            requireValue(incoming.every(c => row && JSON.stringify(c) === row.data), '대전 선수 기록은 저장 파일로 변경할 수 없습니다. 서버 기록을 불러와 주세요.', 409);
          }
          for (const c of profiles(b.data)) {
            const previous = statement('SELECT * FROM careers WHERE id=?').get(c.id);
            const verified = previous?.user_id === id && previous.verified && JSON.stringify(json(previous.data)) === JSON.stringify(c);
            careerRow(id, c, !!verified);
          }
          persist(id, b.data, old.revision + 1);
        }); const saved = getSave(id), c = saved.data.current;
        return send(200, { ...saved, wallet: wallet(id), verified: !!(c && statement('SELECT verified FROM careers WHERE id=? AND user_id=?').get(c.id, id)?.verified) });
      }
      if (path === '/api/career/action' && method === 'POST') {
        limit(req, `career-${id}`, 240); const b = await body(req), saved = getSave(id);
        requireValue(b.revision === saved.revision, '다른 기기의 진행 기록을 먼저 불러와 주세요.', 409);
        return send(200, runCareer(id, b.command, b.args || {}));
      }
      if (path === '/api/club' && method === 'GET') return send(200, { players: statement('SELECT data,saved,verified FROM careers WHERE user_id=? ORDER BY created DESC').all(id).map(r => ({ career: json(r.data), saved: !!r.saved, verified: !!r.verified })), teams: statement('SELECT * FROM teams WHERE user_id=? ORDER BY updated DESC').all(id).map(t => ({ ...t, squad: json(t.squad) })), achievements: statement('SELECT key,title,created FROM personal_achievements WHERE user_id=? ORDER BY created').all(id), wallet: wallet(id) });
      if (path === '/api/club/players' && method === 'POST') {
        const b = await body(req), row = statement('SELECT * FROM careers WHERE id=? AND user_id=?').get(b.id, id);
        requireValue(row && json(row.data).stage === 'retired', '은퇴한 본인의 선수를 선택해 주세요.');
        requireValue(row.saved || statement('SELECT COUNT(*) AS n FROM careers WHERE user_id=? AND saved=1').get(id).n < wallet(id).playerSlots, '선수 슬롯이 가득 찼습니다.');
        statement('UPDATE careers SET saved=1 WHERE id=? AND user_id=?').run(b.id, id); return send(200, { ok: true });
      }
      if (path.startsWith('/api/club/players/') && method === 'DELETE') {
        const careerId = decodeURIComponent(path.split('/').at(-1)); requireValue(statement('SELECT id FROM careers WHERE id=? AND user_id=? AND saved=1').get(careerId, id), '본인의 보관 선수를 선택해 주세요.', 404);
        const assigned = statement('SELECT squad FROM teams WHERE user_id=?').all(id).some(t => json(t.squad).includes(careerId)); requireValue(!assigned, '팀에 편성된 선수는 먼저 팀에서 제외해 주세요.');
        statement('UPDATE careers SET saved=0 WHERE id=? AND user_id=?').run(careerId, id); return send(200, { ok: true });
      }
      if (path === '/api/club/rebirth' && method === 'POST') {
        const b = await body(req), previous = statement('SELECT * FROM careers WHERE id=? AND user_id=?').get(b.id, id), w = wallet(id);
        requireValue(previous, '본인의 은퇴 선수를 선택해 주세요.', 404); const c = json(previous.data);
        requireValue(previous.verified, '서버에서 진행한 선수만 온라인 회귀를 할 수 있습니다.', 409);
        requireValue(c.stage === 'retired' && !c.reborn && !previous.saved, 'MY CLUB에 보관했거나 이미 회귀한 선수는 회귀할 수 없습니다.'); requireValue(w.tickets > 0, '회귀권이 없습니다.');
        let result;
        transaction(() => {
          const old = getSave(id), data = old.data; archive(data);
          const next = E.newCareer(c, seed()); next.id = `FC-${randomUUID()}`; next.candidates = structuredClone(c.candidates).map(x => ({ ...x, opened: false })); next.rebornFrom = c.id; next.reborn = true; next.coins = data.coins; next.inventory = [...data.inventory];
          c.reborn = true; data.archives = data.archives.map(x => x.id === c.id ? c : x);
          for (const archived of data.archives) { const row = statement('SELECT verified FROM careers WHERE id=? AND user_id=?').get(archived.id, id); careerRow(id, archived, !!row?.verified); }
          careerRow(id, c, !!previous.verified); data.current = next; careerRow(id, next, true); result = persist(id, data, old.revision + 1);
          statement('UPDATE wallets SET tickets=tickets-1 WHERE user_id=?').run(id);
        }); return send(200, { ...result, verified: true, wallet: wallet(id) });
      }
      if (path === '/api/club/rename' && method === 'POST') {
        const b = await body(req); requireValue(typeof b.name === 'string' && b.name.trim().length > 0 && b.name.length <= 16, '이름은 1~16자로 입력해 주세요.');
        const row = statement('SELECT * FROM careers WHERE id=? AND user_id=?').get(b.id, id); requireValue(row, '본인의 선수를 선택해 주세요.', 404); requireValue(wallet(id).renames > 0, '개명권이 없습니다.');
        transaction(() => { const c = json(row.data); c.name = b.name.trim(); careerRow(id, c, !!row.verified); const old = getSave(id); if (old.data.current?.id === c.id) old.data.current = c; old.data.archives = old.data.archives.map(x => x.id === c.id ? c : x); persist(id, old.data, old.revision + 1); statement('UPDATE wallets SET renames=renames-1 WHERE user_id=?').run(id); }); return send(200, { ...getSave(id), wallet: wallet(id) });
      }
      if (path === '/api/users' && method === 'GET') {
        const query = (url.searchParams.get('q') || '').trim(); requireValue(query.length >= 2 && query.length <= 16, '닉네임을 2자 이상 입력해 주세요.');
        return send(200, { users: statement("SELECT id,nickname FROM users WHERE nickname LIKE ? ESCAPE '\\' AND id<>? LIMIT 20").all(`%${query.replace(/[\\%_]/g, x => `\\${x}`)}%`, id) });
      }
      if (path === '/api/duels' && method === 'GET') return send(200, { duels: statement('SELECT * FROM duels WHERE host_id=? OR guest_id=? ORDER BY created DESC LIMIT 50').all(id, id).map(d => duelView(d, id)) });
      if (path === '/api/duels' && method === 'POST') {
        limit(req, `duel-${id}`, 12); const b = await body(req); requireValue(Object.hasOwn(E.POSITIONS, b.position), '포지션을 선택해 주세요.');
        requireValue(!statement("SELECT id FROM duels WHERE (host_id=? OR guest_id=?) AND status IN ('pending','waiting','active')").get(id, id), '진행 중인 커리어 매치를 먼저 마쳐 주세요.');
        const duelId = randomUUID();
        if (b.mode === 'friend') {
          requireValue(typeof b.opponentId === 'string' && b.opponentId !== id && statement('SELECT id FROM users WHERE id=?').get(b.opponentId), '친구를 선택해 주세요.');
          statement('INSERT INTO duels(id,host_id,guest_id,position,seed,status,mode,created) VALUES(?,?,?,?,?,?,?,?)').run(duelId, id, b.opponentId, b.position, seed(), 'pending', 'friend', now());
        } else {
          const waiting = statement("SELECT * FROM duels WHERE status='waiting' AND host_id<>? AND position=? AND created>? ORDER BY created LIMIT 1").get(id, b.position, now() - 86400_000);
          if (waiting) { statement('UPDATE duels SET guest_id=? WHERE id=?').run(id, waiting.id); try { startDuel({ ...waiting, guest_id: id }); } catch (e) { statement('UPDATE duels SET guest_id=NULL WHERE id=?').run(waiting.id); throw e; } return send(200, { duel: duelView(statement('SELECT * FROM duels WHERE id=?').get(waiting.id), id), ...getSave(id), verified: true }); }
          statement('INSERT INTO duels(id,host_id,position,seed,status,mode,created) VALUES(?,?,?,?,?,?,?)').run(duelId, id, b.position, seed(), 'waiting', 'random', now());
        }
        return send(201, { duel: duelView(statement('SELECT * FROM duels WHERE id=?').get(duelId), id) });
      }
      if (/^\/api\/duels\/[^/]+\/respond$/.test(path) && method === 'POST') {
        const b = await body(req), d = statement('SELECT * FROM duels WHERE id=?').get(path.split('/')[3]); requireValue(d && d.guest_id === id && d.status === 'pending', '응답할 수 있는 매치 신청이 없습니다.', 404);
        if (b.accept === true) { requireValue(!statement("SELECT id FROM duels WHERE id<>? AND (host_id=? OR guest_id=?) AND status='active'").get(d.id, id, id), '진행 중인 매치를 먼저 마쳐 주세요.'); startDuel(d); }
        else statement('UPDATE duels SET status=? WHERE id=?').run('declined', d.id);
        return send(200, { duel: duelView(statement('SELECT * FROM duels WHERE id=?').get(d.id), id), ...getSave(id), verified: b.accept === true });
      }
      if (/^\/api\/duels\/[^/]+$/.test(path) && method === 'DELETE') {
        const d = statement('SELECT * FROM duels WHERE id=?').get(path.split('/')[3]); requireValue(d?.host_id === id && ['waiting', 'pending'].includes(d.status), '취소할 수 있는 매치가 없습니다.', 404); statement('UPDATE duels SET status=? WHERE id=?').run('cancelled', d.id); return send(200, { ok: true });
      }
      if (path === '/api/teams' && method === 'POST') {
        const b = await body(req); requireValue(typeof b.name === 'string' && b.name.trim().length > 0 && b.name.length <= 24, '팀 이름은 1~24자로 입력해 주세요.');
        requireValue(Array.isArray(b.squad) && b.squad.length <= 11 && new Set(b.squad).size === b.squad.length, '선수는 최대 11명입니다.');
        const players = b.squad.map(playerId => { const r = statement('SELECT data FROM careers WHERE id=? AND user_id=? AND saved=1 AND verified=1').get(playerId, id); requireValue(r, 'MY CLUB에 보관한 본인의 온라인 선수로 팀을 구성해 주세요.'); return json(r.data); });
        const strength = (players.reduce((sum, c) => sum + c.peakOvr, 0) + (11 - players.length) * 50) / 11;
        const teamId = b.id || randomUUID(), previous = statement('SELECT * FROM teams WHERE id=?').get(teamId);
        requireValue(!previous || previous.user_id === id, '본인의 팀만 수정할 수 있습니다.', 403);
        requireValue(previous || statement('SELECT COUNT(*) AS n FROM teams WHERE user_id=?').get(id).n < wallet(id).teamSlots, '팀 슬롯이 가득 찼습니다.');
        statement('INSERT INTO teams(id,user_id,name,squad,strength,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,squad=excluded.squad,strength=excluded.strength,updated=excluded.updated').run(teamId, id, b.name.trim(), JSON.stringify(b.squad), strength, now());
        return send(200, { team: { ...statement('SELECT * FROM teams WHERE id=?').get(teamId), squad: b.squad } });
      }
      if (path.startsWith('/api/teams/') && method === 'DELETE') { const teamId = path.split('/')[3]; requireValue(statement('SELECT id FROM teams WHERE id=? AND user_id=?').get(teamId, id), '본인의 팀을 선택해 주세요.', 404); statement('DELETE FROM teams WHERE id=? AND user_id=?').run(teamId, id); return send(200, { ok: true }); }
      if (path === '/api/battles' && method === 'GET') return send(200, { battles: statement('SELECT * FROM battles WHERE user_id=? ORDER BY created DESC LIMIT 30').all(id).map(b => ({ ...b, result: json(b.result) })) });
      if (path === '/api/battles' && method === 'POST') {
        limit(req, `battle-${id}`, 30); const b = await body(req), team = statement('SELECT * FROM teams WHERE id=? AND user_id=?').get(b.teamId, id); requireValue(team, '팀을 먼저 저장해 주세요.');
        const opponent = b.mode === 'challenge' ? null : statement('SELECT * FROM teams WHERE user_id<>? ORDER BY abs(elo-?) LIMIT 1').get(id, team.elo);
        const target = b.mode === 'challenge' ? { name: `도전 ${team.challenge + 1}단계 FC`, strength: Math.min(95, 48 + team.challenge * 2) } : opponent;
        requireValue(target, '다른 사용자의 팀이 아직 없습니다. 도장깨기를 먼저 플레이해 주세요.', 409);
        const dummy = { peakOvr: team.strength, records: [], trophies: [], nationalCaps: 0, name: team.name }, result = E.careerMatch(dummy, { ...dummy, peakOvr: target.strength, name: target.name }, seed());
        const won = result.penalties ? result.penalties[0] > result.penalties[1] : result.home > result.away;
        const battleId = randomUUID(), delta = opponent ? Math.round(24 * ((won ? 1 : 0) - 1 / (1 + 10 ** ((opponent.elo - team.elo) / 400)))) : 0;
        transaction(() => {
          statement('UPDATE teams SET elo=elo+?,wins=wins+?,losses=losses+?,challenge=challenge+?,updated=? WHERE id=?').run(delta, +won, +!won, +(won && b.mode === 'challenge'), now(), team.id);
          if (opponent) statement('UPDATE teams SET elo=elo-?,wins=wins+?,losses=losses+?,updated=? WHERE id=?').run(delta, +!won, +won, now(), opponent.id);
          statement('INSERT INTO battles VALUES(?,?,?,?,?,?)').run(battleId, id, team.id, target.name, JSON.stringify({ ...result, eloDelta: delta, mode: b.mode || 'ranked' }), now());
        }); return send(200, { result: { ...result, eloDelta: delta, mode: b.mode || 'ranked' } });
      }
      if (path === '/api/shop' && method === 'GET') return send(200, { wallet: wallet(id), items: catalogue, ledger: statement('SELECT item,delta,created FROM ledger WHERE user_id=? ORDER BY created DESC LIMIT 30').all(id) });
      if (path === '/api/shop/buy' && method === 'POST') {
        const b = await body(req), item = catalogue.find(x => x.id === b.item); requireValue(item, '상품을 선택해 주세요.'); requireValue(wallet(id).coins >= item.cost, '축구 코인이 부족합니다.');
        transaction(() => { statement('UPDATE wallets SET coins=coins-?,player_slots=player_slots+?,team_slots=team_slots+?,tickets=tickets+?,renames=renames+? WHERE user_id=?').run(item.cost, item.slots || 0, item.teams || 0, item.tickets || 0, item.renames || 0, id); statement('INSERT INTO ledger VALUES(?,?,?,?,?)').run(randomUUID(), id, item.name, -item.cost, now()); }); return send(200, { wallet: wallet(id) });
      }
      if (path === '/api/shop/reward' && method === 'POST') {
        const day = new Date().toISOString().slice(0, 10); requireValue(wallet(id).rewardDay !== day, '오늘의 출석 코인은 이미 받았습니다.');
        transaction(() => { statement('UPDATE wallets SET coins=coins+20,reward_day=? WHERE user_id=?').run(day, id); statement('INSERT INTO ledger VALUES(?,?,?,?,?)').run(randomUUID(), id, '출석 보상', 20, now()); }); return send(200, { wallet: wallet(id) });
      }
      fail(404, '요청한 기능을 찾을 수 없습니다.');
    } catch (error) {
      const status = error.status || (error.message && !error.code ? 400 : 500);
      if (!res.headersSent) send(status, { error: status === 500 ? '서버 요청을 처리하지 못했습니다.' : error.message, code: error.code || null }); else res.end();
    }
  }
  function serveStatic(path, method, res) {
    if (!['GET', 'HEAD'].includes(method)) fail(405, '지원하지 않는 요청입니다.');
    const requested = resolve(staticRoot, `.${decodeURIComponent(path)}`); requireValue(requested === staticRoot || requested.startsWith(staticRoot + sep), '올바른 경로가 아닙니다.', 403);
    if (extname(requested) && !existsSync(requested)) fail(404, '파일을 찾을 수 없습니다.');
    const file = extname(requested) ? requested : resolve(staticRoot, 'index.html'); requireValue(existsSync(file), '먼저 npm run build를 실행해 주세요.', 404);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' }); res.end(method === 'HEAD' ? undefined : readFileSync(file));
  }
  const server = createServer(handle); server.requestTimeout = 30_000;
  return { server, db, close: () => new Promise((resolve, reject) => server.close(error => { db.close(); error ? reject(error) : resolve(); })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const google = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: process.env.GOOGLE_REDIRECT_URI } : null;
  const app = createApp({ database: process.env.FOOTBALL_DB || resolve('.local/server.sqlite'), google });
  const port = Number(process.env.API_PORT || process.env.PORT || 4174), host = process.env.HOST || '0.0.0.0';
  app.server.listen(port, host, () => process.stdout.write(`Football API ready on port ${port}\n`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
