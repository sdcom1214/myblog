import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { majorSeasonAwards } from '../src/awards.js';
import { emptyStore, parseSave, serializeCareer, serializeSave, validateStore, loadStore } from '../src/storage.js';

const profile = (position = 'FW') => ({ name: '테스트선수', number: 10, foot: '왼발', position, academy: 'hale-end', preferred: 'arsenal' });
function youth(position = 'FW', seed = 42, focus = [0, 2]) {
  return E.setGrowth(E.chooseCandidate(E.newCareer(profile(position), seed), 0), focus, position === 'GK' ? '수문장' : '중앙');
}
function pro(position = 'FW', seed = 42) {
  let c = E.continueReview(E.playSeason(youth(position, seed)));
  c = E.continueReview(E.develop(c)); c = E.trial(c);
  if (c.stage === 'failed') { c = E.continueReview(E.develop(c)); c = E.trial(c); }
  if (c.stage === 'failed') c = E.trial(c, true);
  return E.signOffer(c, 0);
}
function nextPreseason(c) {
  c = E.continueReview(c);
  if (c.stage === 'market') c = E.signOffer(c, 0);
  if (c.stage === 'event') c = E.chooseEvent(c, 0);
  return c;
}

test('all positions get three distinct candidates with exactly 50 starting points', () => {
  for (const position of Object.keys(E.POSITIONS)) {
    const c = E.newCareer(profile(position), 1);
    assert.equal(c.candidates.length, 3);
    assert.equal(new Set(c.candidates.map(x => x.type)).size, 3);
    for (const candidate of c.candidates) assert.equal(E.round(candidate.skills.reduce((a, b) => a + b, 0)), 50);
  }
});
test('invalid player profiles and invalid state transitions are rejected', () => {
  assert.throws(() => E.newCareer({ ...profile(), name: '' }));
  assert.throws(() => E.newCareer({ ...profile(), number: -1 }));
  assert.throws(() => E.newCareer({ ...profile(), position: 'HACK' }));
  const c = E.newCareer(profile(), 2);
  assert.throws(() => E.playSeason(c));
  assert.throws(() => E.signOffer(c, 0));
  assert.throws(() => E.setGrowth(E.chooseCandidate(c, 0), [0, 1, 2], '중앙'));
});
test('seeded seasons are reproducible and do not mutate the prior save', () => {
  const c = youth(); const before = structuredClone(c);
  assert.deepEqual(E.playSeason(c), E.playSeason(c));
  assert.deepEqual(c, before);
});
test('focus changes growth distribution while keeping its total unchanged', () => {
  const focused = E.playSeason(youth('FW', 55, [0]));
  const other = E.playSeason(youth('FW', 55, [1]));
  assert.equal(E.ovr(focused), E.ovr(other));
  assert.ok(focused.skills[0] > other.skills[0]);
  assert.ok(other.skills[1] > focused.skills[1]);
});
test('U18, U21 and U23 preserve the two-year career checkpoints', () => {
  let c = E.playSeason(youth());
  assert.equal(c.records[0].level, 'U18'); assert.equal(c.age, 19); assert.equal(c.year, 2027); assert.equal(c.records.length, 1);
  c = E.develop(E.continueReview(c));
  assert.equal(c.level, 'U21'); assert.equal(c.age, 21); assert.equal(c.developmentSeasons, 2); assert.equal(c.records.length, 3);
  c = E.develop(E.continueReview(c));
  assert.equal(c.level, 'U23'); assert.equal(c.age, 23); assert.equal(c.developmentSeasons, 4);
  assert.throws(() => E.develop(E.continueReview(c)));
});
test('failed trial cannot be rerolled at the same checkpoint, academy development remains available', () => {
  let failed;
  for (let seed = 1; seed < 100; seed++) {
    const c = E.trial(E.continueReview(E.playSeason(youth('FW', seed))));
    if (c.stage === 'failed') { failed = c; break; }
  }
  assert.ok(failed); assert.throws(() => E.trial(failed));
  assert.equal(E.develop(failed).developmentSeasons, 2);
});
test('the professional league has 38 matches per club and conserves goals and points', () => {
  const c = E.playSeason(pro()); const league = c.review.league;
  assert.equal(league.table.length, 20); assert.equal(league.ownMatches.length, 38);
  for (const t of league.table) { assert.equal(t.played, 38); assert.equal(t.wins + t.draws + t.losses, 38); assert.equal(t.points, t.wins * 3 + t.draws); }
  assert.equal(league.table.reduce((a, b) => a + b.gf, 0), league.table.reduce((a, b) => a + b.ga, 0));
  assert.ok(c.review.goals + c.review.assists <= league.table.find(t => t.id === c.team).gf);
});
test('every European league uses its own clubs and two fixtures against each opponent', () => {
  for (const league of E.LEAGUES) {
    const academy = E.ACADEMIES.find(x => x.leagueId === league.id);
    let c = E.newCareer({ ...profile(), preferred: academy.club, academy: academy.id }, 82);
    c = E.setGrowth(E.chooseCandidate(c, 0), [0, 2], '중앙');
    c = E.continueReview(E.playSeason(c));
    c = E.continueReview(E.develop(c)); c = E.continueReview(E.develop(c));
    c = E.signOffer(E.trial(c, true), 0); c = E.playSeason(c);
    const result = c.review.league, rounds = (league.size - 1) * 2;
    assert.equal(result.table.length, league.size); assert.equal(result.ownMatches.length, rounds);
    assert.ok(result.table.every(x => x.leagueId === league.id && x.played === rounds));
    const counts = new Map();
    for (const match of result.ownMatches) counts.set(match.opponent, (counts.get(match.opponent) || 0) + 1);
    assert.equal(counts.size, league.size - 1); assert.ok([...counts.values()].every(x => x === 2));
    assert.equal(result.table.reduce((sum, x) => sum + x.gf - x.ga, 0), 0);
    assert.ok(E.validateCareer(parseSave(serializeCareer(c)).value));
  }
});
test('goalkeeper seasons produce goalkeeper records with no outfield goals', () => {
  let c = pro('GK', 13);
  for (let i = 0; i < 5; i++) { c = E.playSeason(c); assert.equal(c.review.goals, 0); assert.ok(c.review.saves >= c.review.games * 2); assert.ok(c.review.cleanSheets <= c.review.games); c = nextPreseason(c); }
});
test('training limits and five attempts survive a saved game round trip', () => {
  let c = E.beginTraining(pro(), 0);
  assert.throws(() => E.beginTraining(c, 1)); assert.throws(() => E.playSeason(c));
  c = E.trainingShot(c, 50); c = E.trainingShot(c, 20);
  c = parseSave(serializeCareer(c)).value;
  assert.deepEqual(c.pendingTraining.shots, [2, 0]);
  c = E.trainingShot(c, 50); c = E.trainingShot(c, 35); c = E.trainingShot(c, 10);
  const before = c.skills[0]; c = E.finishTraining(c);
  assert.equal(c.lastTraining.score, 5); assert.equal(c.skills[0], E.round(before + 2));
  assert.throws(() => E.beginTraining(c, 1)); assert.throws(() => E.finishTraining(c));
  c = nextPreseason(E.playSeason(c));
  assert.throws(() => E.beginTraining(c, 0));
});
test('three lifetime training opportunities cannot be exceeded', () => {
  let c = pro();
  for (const skill of [0, 1, 2]) {
    c = E.beginTraining(c, skill);
    for (let i = 0; i < 5; i++) c = E.trainingShot(c, 50);
    c = E.finishTraining(c); c = nextPreseason(E.playSeason(c));
  }
  assert.throws(() => E.beginTraining(c, 3));
});
test('contract expiry opens a real renewal market, high ability unlocks transfers between European leagues', () => {
  let c = pro(); const team = c.team;
  c = nextPreseason(E.playSeason(c));
  c = E.continueReview(E.playSeason(c)); assert.equal(c.stage, 'market');
  c.skills = [18, 15, 15, 15, 15]; c.proSeasons = 4; c.stage = 'review'; c.contractLeft = 0;
  c = E.continueReview(c);
  const europe = c.offers.findIndex(o => E.clubById(o.team).leagueId !== E.clubById(team).leagueId);
  assert.ok(europe >= 0); c = E.signOffer(c, europe);
  assert.notEqual(c.team, team); assert.ok(c.contractLeft > 0);
  assert.equal(E.playSeason(c).review.league.table.length, 20);
});
test('aging reduces ability and a complete career ends with a valid retired save', () => {
  let c = pro('MF', 22); let decline = false; let guard = 0;
  while (c.stage !== 'retired' && guard++ < 30) {
    const old = E.ovr(c); c = E.playSeason(c);
    if (c.review.age > 31 && E.ovr(c) < old) decline = true;
    assert.equal(E.validateCareer(c), true);
    c = nextPreseason(c);
  }
  assert.equal(c.stage, 'retired'); assert.ok(c.age >= 29 && c.age <= 46); assert.ok(decline);
  assert.equal(c.legacyScore, E.legacy(c)); assert.throws(() => E.playSeason(c));
  assert.ok(E.validateCareer(parseSave(serializeCareer(c)).value));
});
test('retirement respects remaining contracts, recent performance and the final age limit', () => {
  const c = E.playSeason(pro('FW', 22));
  c.review.age = 38; c.age = 39; c.contractLeft = 2;
  assert.equal(E.retirementChance(c), 0); assert.notEqual(E.continueReview(c).stage, 'retired');
  c.contractLeft = 0; c.skills = [16, 15, 15, 15, 15]; c.review.age = 35; c.review.rating = 8;
  assert.equal(E.retirementChance(c), 0);
  c.review.age = 45; c.age = 46;
  assert.equal(E.retirementChance(c), 1); assert.equal(E.continueReview(c).stage, 'retired');
});
test('career matches are deterministic for a seed and resolve draws by penalties', () => {
  const a = pro(), b = pro('DF', 8);
  assert.deepEqual(E.careerMatch(a, b, 18), E.careerMatch(a, b, 18));
  let drawn;
  for (let seed = 1; seed < 100; seed++) { const m = E.careerMatch(a, b, seed); if (m.penalties) { drawn = m; break; } }
  assert.ok(drawn); assert.notEqual(drawn.penalties[0], drawn.penalties[1]);
});
test('valid saves round trip and malformed imported structures are rejected', () => {
  const store = { ...emptyStore(), current: pro() };
  assert.ok(validateStore(store)); assert.deepEqual(parseSave(serializeSave(store)).value, store);
  for (const change of [c => c.skills[0] = NaN, c => c.records[0].league = {}, c => c.candidates = [], c => c.condition = 1000, c => c.pendingTraining = { skill: 100, shots: [] }]) {
    const invalid = structuredClone(store); change(invalid.current);
    assert.throws(() => parseSave(serializeSave(invalid)));
  }
  assert.throws(() => parseSave('not json')); assert.throws(() => parseSave('x'.repeat(5_000_001)));
});
test('corrupted local storage is preserved instead of silently overwritten', () => {
  const storage = { getItem: () => '{broken' };
  const loaded = loadStore(storage); assert.ok(loaded.error); assert.equal(loaded.data.current, null);
});


test('elite attacking seasons can reach scoring and assist awards without a sampling ceiling', () => {
  let topScorer = false, topAssister = false;
  for (const position of ['FW', 'MF']) {
    for (let seed = 1; seed <= 100; seed++) {
      const c = pro(position, seed); c.skills = position === 'FW' ? [27, 12, 27, 7, 27] : [12, 30, 25, 13, 20]; c.age = 25; c.condition = 100;
      const r = E.playSeason(c).review;
      if (r.goals >= 22) { assert.ok(r.awards.includes('득점왕')); topScorer = true; }
      if (r.assists >= 17) { assert.ok(r.awards.includes('도움왕')); topAssister = true; }
    }
  }
  assert.ok(topScorer, 'The 22-goal award must be reachable');
  assert.ok(topAssister, 'The 17-assist award must be reachable');
});

test('career milestones count senior matches and appear only in the season that crosses a threshold', () => {
  const c = pro(), row = { ...E.playSeason(c).review, tier: '1군', games: 30, goals: 30, assists: 12 };
  c.records = [row, row, row, row];
  assert.deepEqual(E.seasonMilestones(c).map(m => m.key), ['games', 'goals']);
  c.records.push(row); assert.deepEqual(E.seasonMilestones(c), []);
  c.records = [{ ...row, level: 'U18', games: 90, goals: 90 }, { ...row, tier: '육성팀', games: 90, goals: 90 }, row];
  assert.deepEqual(E.seasonMilestones(c), []);
  const gk = { ...c, position: 'GK', records: [{ ...row, saves: 300, cleanSheets: 30 }, { ...row, saves: 300, cleanSheets: 30 }] };
  assert.deepEqual(E.seasonMilestones(gk).map(m => m.key), ['saves', 'cleanSheets']);
});

test('major football awards respect senior level, age, league and goalkeeper eligibility', () => {
  const c = pro(), r = { ...E.playSeason(c).review, level: '프로', tier: '1군', age: 20, games: 34, rating: 9, goals: 34, assists: 20, tackles: 100, cleanSheets: 0, saves: 0 };
  r.league.rank = 1;
  const wins = majorSeasonAwards(c, r, 100, () => .3);
  for (const award of ['발롱도르', 'FIFA 올해의 선수', '유러피언 골든슈', '코파 트로피', '골든보이', 'FIFPRO 월드 XI', '프리미어리그 골든부트']) assert.ok(wins.includes(award));
  assert.ok(!wins.includes('야신 트로피'));
  const older = majorSeasonAwards(c, { ...r, age: 24 }, 100, () => .3); assert.ok(!older.includes('코파 트로피') && !older.includes('골든보이'));
  assert.deepEqual(majorSeasonAwards(c, { ...r, tier: '육성팀' }, 100, () => .3), []);
  assert.deepEqual(majorSeasonAwards(c, { ...r, level: 'U18' }, 100, () => .3), []);
  const gk = majorSeasonAwards({ ...c, position: 'GK' }, { ...r, goals: 0, assists: 0, cleanSheets: 20, saves: 150 }, 100, () => .3);
  for (const award of ['야신 트로피', 'FIFA 최우수 골키퍼', '프리미어리그 골든글러브']) assert.ok(gk.includes(award));
  assert.ok(!gk.includes('유러피언 골든슈'));
});

test('expanded achievements do not count youth statistics as senior honours', () => {
  const c = pro(); const list = E.careerAchievements(c); assert.ok(list.length >= 80);
  assert.equal(list.find(a => a.key === 'first-pro').unlocked, false);
  const row = { ...E.playSeason(c).review, level: 'U18', goals: 500, assists: 300, awards: ['발롱도르'] };
  c.records = [row];
  assert.equal(E.careerAchievements(c).find(a => a.title === '발롱도르 수상').unlocked, false);
  assert.equal(E.careerAchievements(c).find(a => a.key === 'first-100-goals').unlocked, false);
});
