export const POSITIONS = { FW: '공격수', MF: '미드필더', DF: '수비수', GK: '골키퍼' };
import { majorSeasonAwards, AWARD_CATALOG, distinctAwards } from './awards.js';
import { trainingMode, trainingChallenge, trainingInputScore } from './training.js';
export { TRAINING_GAMES, trainingMode } from './training.js';
export { AWARD_CATALOG, distinctAwards } from './awards.js';
import { CLUBS, clubById, clubsInLeague, academyById, leagueById } from './data.js';
export { CLUBS, clubById, LEAGUES, ACADEMIES, PLAYER_REFERENCES, clubsInLeague, academyById, leagueById } from './data.js';
export const SKILLS = ['슈팅', '패스', '드리블', '수비', '피지컬'];
export const GK_SKILLS = ['반사신경', '위치선정', '캐칭', '킥', '피지컬'];
export const skillNames = (c) => c.position === 'GK' ? GK_SKILLS : SKILLS;
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const round = (x) => Math.round(x * 10) / 10;
export const ovr = (c) => round(c.skills.reduce((a, b) => a + b, 0));
const copy = (x) => structuredClone(x);
const required = (condition, message) => { if (!condition) throw new Error(message); };

export function random(c) {
  c.rng = (Math.imul(c.rng, 1664525) + 1013904223) >>> 0;
  return c.rng / 4294967296;
}
const int = (c, lo, hi) => Math.floor(random(c) * (hi - lo + 1)) + lo;
const pick = (c, xs) => xs[int(c, 0, xs.length - 1)];
function poisson(c, lambda) {
  let k = 0, product = 1;
  do { product *= Math.max(0.000001, random(c)); k++; } while (product > Math.exp(-lambda) && k < 100);
  return k - 1;
}

export function newCareer(profile, seed = Date.now() >>> 0) {
  required(typeof profile.name === 'string' && profile.name.trim().length > 0 && profile.name.trim().length <= 16, '이름은 1~16자로 입력해 주세요.');
  required(Object.hasOwn(POSITIONS, profile.position), '포지션을 선택해 주세요.');
  required(Number.isInteger(profile.number) && profile.number >= 0 && profile.number <= 99, '등번호는 0~99입니다.');
  required(['오른발', '왼발', '양발'].includes(profile.foot), '주발을 선택해 주세요.');
  required(CLUBS.some(x => x.id === profile.preferred), '희망 구단을 선택해 주세요.');
  const academy = academyById(profile.academy), leagueId = clubById(profile.preferred).leagueId;
  required(academy && academy.leagueId === leagueId, '선택한 리그의 유소년 아카데미를 선택해 주세요.');
  const c = {
    id: `FC-${seed.toString(36).toUpperCase()}-${profile.number}`, rng: seed >>> 0, name: profile.name.trim(),
    number: profile.number, foot: profile.foot, position: profile.position, school: academy.name, academy: academy.id, leagueId, preferred: profile.preferred,
    age: 18, year: 2026, stage: 'candidates', level: 'U18', skills: [10, 10, 10, 10, 10],
    focus: [], style: '밸런스형', role: profile.position === 'GK' ? '수문장' : '중앙', records: [], leagueHistory: [], events: [], offers: [],
    team: null, contractLeft: 0, salary: 0, proSeasons: 0, developmentSeasons: 0, condition: 90,
    trust: 50, popularity: 10, nationalCaps: 0, trainingUsed: [], trainedYear: null, pendingTraining: null,
    coins: 100, inventory: [], peakOvr: 50, peakSkills: [10, 10, 10, 10, 10], trophies: [],
  };
  c.candidates = makeCandidates(c);
  c.birthYear = c.year - c.age; c.height = int(c, profile.position === 'GK' ? 184 : 169, profile.position === 'GK' ? 200 : 195); c.weight = Math.round((c.height - 100) * .85) + int(c, -3, 5);
  return c;
}

function makeCandidates(c) {
  const types = c.position === 'GK' ? ['반사신경형', '포지셔닝형', '빌드업형'] : ['테크니션형', '피지컬형', '전술가형'];
  const boosts = c.position === 'GK' ? [0, 1, 3] : [2, 4, c.position === 'DF' ? 3 : 1];
  return types.map((type, idx) => {
    const raw = Array.from({ length: 5 }, (_, i) => 7 + random(c) * 4 + (i === boosts[idx] ? 4 : 0));
    const sum = raw.reduce((a, b) => a + b, 0);
    const skills = raw.map(x => round(x / sum * 50));
    skills[4] = round(skills[4] + 50 - skills.reduce((a, b) => a + b, 0));
    return { type, skills, opened: false };
  });
}
export function chooseCandidate(c, index) {
  required(c.stage === 'candidates' && Number.isInteger(index) && c.candidates[index], '후보를 선택해 주세요.');
  const n = copy(c); n.skills = [...n.candidates[index].skills]; n.style = n.candidates[index].type;
  n.selectedCandidate = index; n.stage = 'growth'; n.peakSkills = [...n.skills]; return n;
}
export function setGrowth(c, focus, role, technique = '균형') {
  required(c.stage === 'growth' && focus.length > 0 && focus.length <= 2 && new Set(focus).size === focus.length && focus.every(x => Number.isInteger(x) && x >= 0 && x < 5), '집중 육성 능력치를 1~2개 선택해 주세요.');
  const roles = { FW: ['중앙', '왼쪽', '오른쪽'], MF: ['공격형', '중앙', '수비형'], DF: ['중앙', '왼쪽', '오른쪽'], GK: ['스위퍼', '수문장'] };
  required(roles[c.position].includes(role), '선호 역할을 선택해 주세요.');
  required((c.position === 'GK' ? ['빌드업', '반응형', '활동량', '균형'] : ['패스 중심', '개인기', '활동량', '균형']).includes(technique), '플레이 스타일을 선택해 주세요.');
  const n = copy(c); n.focus = [...focus]; n.role = role; n.technique = technique; n.stage = 'academyReady'; return n;
}

function addGrowth(c, budget) {
  budget = Math.min(budget, 100 - ovr(c));
  const weights = c.skills.map((_, i) => c.focus.includes(i) ? 3 : 1);
  const total = weights.reduce((a, b) => a + b, 0);
  c.skills = c.skills.map((s, i) => round(clamp(s + budget * weights[i] / total, 1, 30)));
  if (ovr(c) > 100) c.skills[4] = round(c.skills[4] - (ovr(c) - 100));
  if (ovr(c) >= c.peakOvr) { c.peakOvr = ovr(c); c.peakSkills = [...c.skills]; }
}
export function effectiveAbility(c) {
  let weights = { FW: [4, 1, 3, 0.3, 2], MF: [1.2, 4, 2.5, 1.5, 1.5], DF: [0.4, 1.5, 0.7, 4, 3], GK: [4, 3, 2.5, 1.2, 2] }[c.position];
  if (c.position === 'FW' && c.role !== '중앙') weights = [3, 2, 4, 0.4, 2];
  if (c.position === 'MF' && c.role === '수비형') weights = [0.7, 2.5, 1, 4, 3];
  if (c.position === 'DF' && c.role !== '중앙') weights = [0.7, 2.5, 2, 3, 3];
  if (c.position === 'GK' && c.role === '스위퍼') weights = [3, 3, 2, 3.2, 2];
  const emphasized = c.technique === '패스 중심' ? 1 : c.technique === '개인기' ? 2 : c.technique === '활동량' ? 4 : c.technique === '빌드업' ? 3 : c.technique === '반응형' ? 0 : null;
  if (emphasized !== null) weights[emphasized] *= 1.25;
  return c.skills.reduce((sum, val, i) => sum + val * weights[i], 0) / weights.reduce((a, b) => a + b, 0) * 5 * (0.85 + c.condition * 0.0015);
}

function simulateLeague(c) {
  const clubs = clubsInLeague(clubById(c.team).leagueId);
  const table = clubs.map(x => ({ ...x, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 }));
  const ownMatches = [];
  const play = (a, b, roundNumber) => {
    const ability = (x) => x.strength + (x.id === c.team ? (effectiveAbility(c) - 55) * 0.22 : 0);
    const diff = ability(a) - ability(b);
    const ga = poisson(c, clamp(1.3 + diff / 35, 0.35, 2.8));
    const gb = poisson(c, clamp(1.15 - diff / 35, 0.35, 2.8));
    a.played++; b.played++; a.gf += ga; a.ga += gb; b.gf += gb; b.ga += ga;
    if (ga === gb) { a.draws++; b.draws++; a.points++; b.points++; }
    else { const win = ga > gb ? a : b, lose = ga > gb ? b : a; win.wins++; win.points += 3; lose.losses++; }
    if (a.id === c.team || b.id === c.team) ownMatches.push({ round: roundNumber, opponent: a.id === c.team ? b.name : a.name, goalsFor: a.id === c.team ? ga : gb, goalsAgainst: a.id === c.team ? gb : ga });
  };
  const sortTable = () => table.sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
  const roundRobin = (group, rounds, start) => {
    const rotation = [...group];
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < rotation.length / 2; i++) {
        const a = rotation[i], b = rotation[rotation.length - 1 - i];
        play(r % 2 === 0 ? a : b, r % 2 === 0 ? b : a, start + r + 1);
      }
      rotation.splice(1, 0, rotation.pop());
    }
  };
  roundRobin(table, (clubs.length - 1) * 2, 0);
  const ranked = sortTable();
  return { leagueId: clubById(c.team).leagueId, table: ranked, ownMatches, rank: ranked.findIndex(x => x.id === c.team) + 1, champion: ranked[0].name };
}

export function playSeason(c) {
  required(['academyReady', 'preseason', 'developmentReady'].includes(c.stage) && !c.pendingTraining, '지금은 시즌을 진행할 수 없습니다.');
  const n = copy(c), before = [...n.skills], oldOvr = ovr(n);
  const pro = n.level === '프로';
  const league = pro ? simulateLeague(n) : null;
  const maxGames = pro ? league.ownMatches.length : n.level === 'U18' ? 18 : 20;
  const ability = effectiveAbility(n);
  const tier = pro && ability < 60 ? '육성팀' : pro ? '1군' : n.level;
  const role = tier === '육성팀' ? '육성팀 주전' : pro && ability < 65 ? '로테이션' : ability >= 74 ? '핵심 선수' : '주전';
  const injury = random(n) < (n.age > 30 ? 0.13 : 0.055) ? pick(n, ['햄스트링 부상 · 4경기 결장', '발목 부상 · 6경기 결장']) : null;
  const games = clamp(int(n, Math.max(5, maxGames - (role === '로테이션' ? 19 : 6)), maxGames) - (injury ? 6 : 0), 1, maxGames);
  const minutes = games * int(n, role === '로테이션' ? 25 : 64, role === '로테이션' ? 65 : 90);
  const factor = (minutes / 90) * clamp(ability / 55, 0.5, 1.9);
  const goals = n.position === 'GK' ? 0 : poisson(n, factor * ({ FW: 0.4, MF: 0.17, DF: 0.045 }[n.position]));
  const assists = n.position === 'GK' ? int(n, 0, 1) : poisson(n, factor * ({ FW: 0.14, MF: 0.3, DF: 0.08 }[n.position]));
  const ownTeam = league?.table.find(t => t.id === n.team);
  const actualGoals = ownTeam ? Math.min(goals, ownTeam.gf) : goals;
  const actualAssists = ownTeam ? Math.min(assists, Math.max(0, ownTeam.gf - actualGoals)) : assists;
  const cleanSheets = n.position === 'GK' ? Math.min(games, league ? league.ownMatches.filter(x => x.goalsAgainst === 0).length : int(n, 3, Math.max(4, Math.round(games * 0.6)))) : 0;
  const rating = round(clamp(6.0 + ability / 65 + (random(n) - 0.5) * 0.8 + (actualGoals + actualAssists + cleanSheets) / Math.max(1, games) * 0.8, 5, 9.5));
  const budget = n.age <= 22 ? 3.5 + random(n) * 1.6 : n.age <= 27 ? 2.5 + random(n) * 1.4 : n.age <= 30 ? 0.8 + random(n) : -1.2 - (n.age - 30) * 0.35;
  addGrowth(n, budget + (n.inventory.includes('boots') && budget > 0 ? 0.3 : 0));
  const record = { year: n.year, age: n.age, level: n.level, tier, team: pro ? clubById(n.team).name : `${n.school} ${n.level}`, position: n.position, role, games, minutes, goals: actualGoals, assists: actualAssists,
    saves: n.position === 'GK' ? int(n, games * 2, games * 5) : 0, cleanSheets, tackles: n.position !== 'GK' ? int(n, games, games * (n.position === 'DF' ? 4 : 2)) : 0,
    passRate: round(clamp(67 + n.skills[1] * 1.2 + random(n) * 4, 65, 96)), rating, before, after: [...n.skills], oldOvr, newOvr: ovr(n), injury, league,
    tournaments: n.level === 'U18' ? leagueById(n.leagueId).youth.map((name, i) => ({ name, result: pick(n, i === 0 ? ['12위', '8위', '4위', '준우승', '우승'] : ['16강', '8강', '4강', '준우승', '우승']) })) : [], awards: [] };
  const senior = pro && tier === '1군';
  if (senior && league.rank === 1) { record.awards.push('리그 우승'); n.trophies.push({ year: n.year, name: '리그 우승', team: record.team }); }
  if (senior && actualGoals >= 22) record.awards.push('득점왕');
  if (senior && actualAssists >= 17) record.awards.push('도움왕');
  if (senior && rating >= 8.2) record.awards.push('베스트 XI');
  if (senior && n.proSeasons === 0 && rating >= 7.5) record.awards.push('신인상');
  record.awards.push(...majorSeasonAwards(n, record, ability, () => random(n)));
  if (senior && ovr(n) >= 76 && n.year % 2 === 0) { n.nationalCaps += int(n, 3, 8); record.awards.push('국가대표 발탁'); }
  if (pro) {
    n.proSeasons++; n.contractLeft = Math.max(0, n.contractLeft - 1);
    n.leagueHistory.push({ year: n.year, champion: league.champion, runnerUp: league.table[1].name, league: clubById(n.team).league });
    n.coins += 80 + actualGoals * 5 + actualAssists * 4 + cleanSheets * 5 + distinctAwards(record.awards).length * 50;
  } else { n.coins += 40; if (['U21', 'U23'].includes(n.level)) n.developmentSeasons++; }
  n.trust = clamp(n.trust + Math.round((rating - 6.8) * 6), 0, 100);
  n.popularity = clamp(n.popularity + Math.round((rating - 6.4) * 7) + distinctAwards(record.awards).length * 4, 0, 100);
  n.condition = clamp(n.condition - (injury ? 18 : int(n, 4, 10)), 40, 100);
  n.records.push(record); n.review = record; n.year++; n.age++; n.stage = 'review'; return n;
}

export function continueReview(c) {
  required(c.stage === 'review', '시즌 결과를 먼저 확인해 주세요.');
  const n = copy(c);
  if (n.level !== '프로') n.stage = 'path';
  else if (retirementChance(n) > 0 && random(n) < retirementChance(n)) return retire(n, `${n.review.age}세 시즌을 마친 뒤 기량과 출전 기회를 고려해 선수 생활을 마무리했습니다.`);
  else if (n.contractLeft <= 0) { n.stage = 'market'; n.offers = makeOffers(n, false); }
  else if (n.proSeasons % 3 === 0) n.stage = 'event';
  else { n.stage = 'preseason'; n.condition = Math.min(100, n.condition + 12); }
  return n;
}

// Match the source's age/performance/contract retirement structure with football statistics.
export function retirementChance(c) {
  const r = c.review;
  if (c.level !== '프로' || !r) return 0;
  if (r.age >= 45) return 1;
  if (c.contractLeft > 0) return 0;
  const keeper = c.position === 'GK', minimumAge = keeper ? 29 : 28;
  if (r.age < minimumAge) return 0;
  const quality = ovr(c), recent = c.records.filter(x => x.level === '프로').slice(-3);
  const rating = recent.reduce((sum, x) => sum + x.rating, 0) / recent.length;
  if (quality >= 70 && rating >= 7.5 && r.age <= (keeper ? 41 : 38)) return 0;
  const ages = keeper ? [.03,.06,.1,.15,.21,.29,.38,.48,.59,.69,.79,.86,.91,.95,.97,.98] : [.03,.05,.08,.12,.18,.25,.33,.42,.52,.62,.72,.8,.86,.9,.93,.95,.97];
  const performance = rating >= 8 ? -.15 : rating >= 7.5 ? -.1 : rating >= 7 ? -.05 : rating < 6 ? .12 : 0;
  const ability = quality >= 78 ? -.1 : quality >= 72 ? -.06 : quality >= 65 ? -.02 : quality < 58 ? .08 : 0;
  return clamp(ages[Math.min(ages.length - 1, r.age - minimumAge)] + performance + ability + (r.tier === '육성팀' ? .2 : 0) + (r.injury ? .08 : 0), 0, .95);
}
export function develop(c) {
  required(['path', 'failed'].includes(c.stage) && c.developmentSeasons < 4, 'U21·U23 육성 과정을 모두 마쳤습니다.');
  let n = copy(c); n.level = n.developmentSeasons ? 'U23' : 'U21'; n.stage = 'developmentReady'; n = playSeason(n); n.stage = 'developmentReady'; n = playSeason(n); return n;
}
export function trialChance(c) { return round(clamp(0.33 + (ovr(c) - 50) * 0.027 + (c.developmentSeasons > 0 ? 0.45 : 0), 0.15, 0.95) * 100); }
function makeOffers(c, rookie) {
  const first = clubById(!rookie && c.team ? c.team : c.preferred);
  const others = clubsInLeague(first.leagueId).filter(x => x.id !== first.id).sort((a, b) => a.strength - b.strength);
  const selected = [first, pick(c, others.slice(0, Math.ceil(others.length / 2))), pick(c, others.slice(Math.ceil(others.length / 2)))];
  if (!rookie && ovr(c) >= 72 && c.proSeasons >= 3) selected.push(pick(c, CLUBS.filter(x => x.leagueId !== first.leagueId && x.strength >= 80)));
  return selected.map((club, i) => ({ team: club.id, years: rookie ? 2 : i % 2 + 2,
    salary: Math.round((3300 + Math.max(0, ovr(c) - 50) ** 2 * 48) * (1.8 + club.strength / 100 + i * 0.12)), bonus: rookie ? 3000 : 5000, role: i === 1 ? '주전 경쟁' : '로테이션', rookie }));
}
export function trial(c, semiPro = false) {
  required(['path', 'failed'].includes(c.stage), '지금은 입단 테스트에 참가할 수 없습니다.');
  required(semiPro || c.lastTrialYear !== c.year, '이번 평가의 입단 테스트는 이미 마쳤습니다.');
  required(!semiPro || c.developmentSeasons >= 4, 'U23 리저브 과정을 마친 뒤 재도전할 수 있습니다.');
  const n = copy(c); n.lastTrialYear = n.year;
  if (semiPro || random(n) * 100 < trialChance(n)) { n.stage = 'offer'; n.offers = makeOffers(n, true); n.semiPro = semiPro; }
  else { n.stage = 'failed'; n.events.push({ year: n.year, title: '입단 테스트 미합격', description: '지금의 평가가 당신의 가능성 전부는 아닙니다.' }); }
  return n;
}
export function signOffer(c, index) {
  required(['offer', 'market'].includes(c.stage) && Number.isInteger(index) && c.offers[index], '계약을 선택해 주세요.');
  const n = copy(c), offer = n.offers[index];
  n.team = offer.team; n.contractLeft = offer.years; n.salary = offer.salary; n.level = '프로'; n.stage = 'preseason';
  n.condition = Math.min(100, n.condition + 15); n.trust = 55; n.coins += 100;
  n.events.push({ year: n.year, title: offer.rookie ? '첫 프로 계약' : 'FA 계약', description: `${clubById(n.team).name} · ${offer.years}년 · 연봉 ${offer.salary}만원` }); n.offers = []; return n;
}
export function chooseEvent(c, choice) {
  required(c.stage === 'event' && [0, 1].includes(choice), '커리어 이벤트를 선택해 주세요.');
  const n = copy(c);
  if (choice === 0) { addGrowth(n, 1); n.trust = clamp(n.trust + 8, 0, 100); }
  else { n.condition = 100; n.popularity = clamp(n.popularity + 8, 0, 100); }
  n.events.push({ year: n.year, title: '오프시즌의 선택', description: choice === 0 ? '추가 훈련으로 감독의 신뢰를 얻었습니다.' : '휴식과 팬 미팅으로 컨디션을 회복했습니다.' }); n.stage = 'preseason'; return n;
}

export function beginTraining(c, skill) {
  required(c.stage === 'preseason' && !c.pendingTraining && c.trainingUsed.length < 3 && c.trainedYear !== c.year && !c.trainingUsed.includes(skill) && Number.isInteger(skill) && skill >= 0 && skill < 5, '특별훈련은 시즌당 1회, 커리어당 3회, 능력치마다 1회입니다.');
  const n = copy(c); n.trainingUsed.push(skill); n.trainedYear = n.year;
  const mode = trainingMode(n.position, skill);
  n.pendingTraining = { skill, mode, rounds: Array.from({ length: 5 }, () => trainingChallenge(mode, () => random(n))), shots: [] }; return n;
}
export function timingScore(position) { const distance = Math.abs(position - 50); return distance <= 8 ? 2 : distance <= 23 ? 1 : 0; }
export function trainingShot(c, input) {
  required(c.pendingTraining && c.pendingTraining.shots.length < 5, '훈련을 먼저 시작해 주세요.');
  const n = copy(c), training = n.pendingTraining;
  if (training.mode) training.shots.push(trainingInputScore(training.mode, training.rounds[training.shots.length], input));
  else { required(Number.isFinite(input) && input >= 0 && input <= 100, '올바른 타이밍 입력이 필요합니다.'); training.shots.push(timingScore(input)); }
  return n;
}
export function finishTraining(c) {
  required(c.pendingTraining?.shots.length === 5, '5번의 시도를 모두 완료해 주세요.');
  const n = copy(c), { skill, shots } = n.pendingTraining;
  const bonus = round(Math.max(0, Math.min(shots.reduce((a, b) => a + b, 0) * 0.4, 100 - ovr(n), 30 - n.skills[skill])));
  n.skills[skill] = round(n.skills[skill] + bonus); n.pendingTraining = null;
  if (ovr(n) > n.peakOvr) { n.peakOvr = ovr(n); n.peakSkills = [...n.skills]; }
  n.lastTraining = { skill, bonus, score: shots.reduce((a, b) => a + b, 0) };
  n.events.push({ year: n.year, title: n.lastTraining.score === 10 ? '특별훈련 만점' : '특별훈련 완료', description: `${skillNames(n)[skill]} · ${n.lastTraining.score}/10점 · +${bonus}` }); return n;
}

export function totals(c) {
  const rows = c.records.filter(x => x.level === '프로' && x.tier !== '육성팀');
  return rows.reduce((t, r) => ({ games: t.games + r.games, goals: t.goals + r.goals, assists: t.assists + r.assists, cleanSheets: t.cleanSheets + r.cleanSheets, saves: t.saves + r.saves, minutes: t.minutes + r.minutes, rating: t.rating + r.rating * r.games }), { games: 0, goals: 0, assists: 0, cleanSheets: 0, saves: 0, minutes: 0, rating: 0 });
}
export function seasonMilestones(c) {
  const last = c.records.at(-1);
  if (last?.level !== '프로' || last.tier === '육성팀') return [];
  const previous = totals({ ...c, records: c.records.slice(0, -1) }), current = totals(c);
  const metrics = c.position === 'GK'
    ? [['games', '경기', [100, 300, 500, 1000]], ['saves', '선방', [500, 1000, 1500, 2000]], ['cleanSheets', '클린시트', [50, 100, 200]]]
    : [['games', '경기', [100, 300, 500, 1000]], ['goals', '골', [100, 200, 300, 500]], ['assists', '도움', [100, 200, 300]]];
  return metrics.flatMap(([key, label, thresholds]) => thresholds.filter(value => previous[key] < value && current[key] >= value).map(value => ({ key, label, value })));
}
export function legacy(c) {
  const t = totals(c);
  return Math.round(t.games * 1.5 + t.goals * 8 + t.assists * 7 + t.cleanSheets * 9 + t.saves * 0.2 + c.trophies.length * 180 + c.nationalCaps * 12 + c.records.filter(x => x.level === '프로').reduce((a, b) => a + distinctAwards(b.awards).filter(x => x !== '리그 우승').length * 70, 0));
}
export function careerAchievements(c) {
  const t = totals(c), awards = new Set(c.records.filter(r => r.level === '프로' && r.tier !== '육성팀').flatMap(r => r.awards));
  const entries = [
    ['first-pro', c.proSeasons > 0, '첫 프로 시즌'], ['first-national', c.nationalCaps > 0, '첫 국가대표 발탁'],
    ['first-title', c.trophies.length > 0, '첫 리그 우승'], ['first-legend', legacy(c) >= 4000, 'LEGACY 4,000'],
    ['first-training', c.trainingUsed.length > 0, '특별훈련 첫 도전'], ['master-training', c.trainingUsed.length - (c.pendingTraining ? 1 : 0) === 3, '특별훈련 3종 완료'],
    ['perfect-training', c.lastTraining?.score === 10 || c.events.some(e => e.title === '특별훈련 만점'), '특별훈련 만점'], ['retired', c.stage === 'retired' && c.proSeasons > 0, '마지막 휘슬'],
  ];
  const thresholds = [
    ['games', t.games, [100, 300, 500, 750], '통산 경기'], ['goals', t.goals, [50, 100, 200, 300, 500], '통산 골'],
    ['assists', t.assists, [25, 50, 100, 200, 300], '통산 도움'], ['saves', t.saves, [500, 1000, 1500, 2000], '통산 선방'],
    ['cleanSheets', t.cleanSheets, [25, 50, 100, 200], '통산 클린시트'], ['seasons', c.proSeasons, [5, 10, 15, 20], '프로 시즌'],
    ['titles', c.trophies.length, [3, 5, 10], '리그 우승'], ['caps', c.nationalCaps, [10, 25, 50, 100], '국가대표 출전'],
    ['prime', c.peakOvr, [80, 90, 100], 'PRIME OVR'], ['legacy', legacy(c), [1000, 8000, 12000], 'LEGACY SCORE'],
  ];
  for (const [metric, value, levels, label] of thresholds) for (const n of levels) {
    const key = metric === 'goals' && n === 100 ? 'first-100-goals' : metric === 'assists' && n === 100 ? 'first-100-assists' : `${metric}-${n}`;
    entries.push([key, value >= n, `${label} ${n.toLocaleString()}`]);
  }
  const teams = new Set(c.records.filter(r => r.level === '프로').map(r => r.team)), leagues = new Set(c.records.map(r => r.league?.leagueId).filter(Boolean));
  for (const n of [2, 3, 5]) entries.push([`clubs-${n}`, teams.size >= n, `${n}개 구단에서 활약`]);
  for (const n of [2, 3, 5]) entries.push([`leagues-${n}`, leagues.size >= n, `${n}개 유럽 리그 경험`]);
  for (const award of AWARD_CATALOG) entries.push([award.key, awards.has(award.title), `${award.title} 수상`]);
  return entries.map(([key, unlocked, title]) => ({ key, unlocked, title }));
}
export function retire(c, reason = '선수 본인의 선택으로 축구 인생을 마무리했습니다.') {
  required(!['candidates', 'growth', 'academyReady', 'retired'].includes(c.stage) && !c.pendingTraining, '지금은 은퇴할 수 없습니다.');
  const n = copy(c); n.stage = 'retired'; n.retirementReason = reason; n.legacyScore = legacy(n); return n;
}

export function careerMatch(a, b, seed = Date.now() >>> 0) {
  const c = { rng: seed }, strength = (x) => Math.min(96, x.peakOvr + Math.log1p(legacy(x)) * 1.2);
  const diff = strength(a) - strength(b);
  let home = poisson(c, clamp(1.5 + diff / 25, 0.3, 4)), away = poisson(c, clamp(1.5 - diff / 25, 0.3, 4));
  let penalties = null;
  if (home === away) penalties = random(c) < 0.5 ? [5, 4] : [4, 5];
  const winner = penalties ? penalties[0] > penalties[1] ? a.name : b.name : home > away ? a.name : b.name;
  return { home, away, penalties, winner, homeName: a.name, awayName: b.name, homeStrength: round(strength(a)), awayStrength: round(strength(b)) };
}

export function validateCareer(c) {
  if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 16) return false;
  if (!Object.hasOwn(POSITIONS, c.position) || !Number.isInteger(c.number) || c.number < 0 || c.number > 99) return false;
  if (!Array.isArray(c.skills) || c.skills.length !== 5 || !c.skills.every(x => Number.isFinite(x) && x >= 1 && x <= 30) || ovr(c) > 100.2) return false;
  if (!Number.isInteger(c.age) || c.age < 18 || c.age > 46 || !Number.isInteger(c.year) || c.year < 2026 || c.year > 2054) return false;
  if ([['height',140,220],['weight',40,140],['birthYear',1960,2200]].some(([key,min,max]) => c[key] !== undefined && (!Number.isInteger(c[key]) || c[key] < min || c[key] > max))) return false;
  if (!['candidates', 'growth', 'academyReady', 'review', 'path', 'failed', 'offer', 'preseason', 'market', 'event', 'retired'].includes(c.stage) || !['U18', 'U21', 'U23', '프로'].includes(c.level)) return false;
  if (!Array.isArray(c.records) || c.records.length > 30 || !Array.isArray(c.trophies) || c.trophies.length > 30 || !Array.isArray(c.trainingUsed) || c.trainingUsed.length > 3 || !Array.isArray(c.events) || c.events.length > 100 || !Array.isArray(c.leagueHistory) || c.leagueHistory.length > 30 || !Array.isArray(c.inventory) || !Array.isArray(c.offers) || c.offers.length > 5) return false;
  if (!Number.isInteger(c.rng) || !Number.isFinite(c.peakOvr) || c.peakOvr < 0 || c.peakOvr > 100.2 || typeof c.id !== 'string' || c.id.length > 70 || typeof c.school !== 'string' || c.school.length > 30) return false;
  if (!Array.isArray(c.focus) || c.focus.length > 2 || !c.focus.every(x => Number.isInteger(x) && x >= 0 && x < 5) || !Array.isArray(c.peakSkills) || c.peakSkills.length !== 5 || !c.peakSkills.every(x => Number.isFinite(x) && x >= 1 && x <= 30)) return false;
  if (c.team !== null && !clubById(c.team) || !clubById(c.preferred) || !academyById(c.academy) || academyById(c.academy).leagueId !== c.leagueId || clubById(c.preferred).leagueId !== c.leagueId) return false;
  if (!['contractLeft', 'salary', 'proSeasons', 'developmentSeasons', 'condition', 'trust', 'popularity', 'nationalCaps', 'coins'].every(k => Number.isFinite(c[k]) && c[k] >= 0)) return false;
  if (c.condition > 100 || c.trust > 100 || c.popularity > 100 || c.developmentSeasons > 4 || c.proSeasons > 30 || c.contractLeft > 5 || c.coins > 1e9) return false;
  const text = (x, max) => typeof x === 'string' && x.length <= max;
  const values = (x) => Array.isArray(x) && x.length === 5 && x.every(v => Number.isFinite(v) && v >= 1 && v <= 30);
  if (!text(c.style, 30) || !text(c.role, 20) || !['오른발', '왼발', '양발'].includes(c.foot) || !c.trainingUsed.every(x => Number.isInteger(x) && x >= 0 && x < 5)) return false;
  if (new Set(c.trainingUsed).size !== c.trainingUsed.length) return false;
  if (!Array.isArray(c.candidates) || c.candidates.length !== 3 || !c.candidates.every(x => x && text(x.type, 30) && typeof x.opened === 'boolean' && values(x.skills))) return false;
  if (!c.events.every(x => x && Number.isInteger(x.year) && text(x.title, 100) && text(x.description, 500))) return false;
  if (!c.trophies.every(x => x && Number.isInteger(x.year) && text(x.name, 50) && text(x.team, 50))) return false;
  if (!c.leagueHistory.every(x => x && Number.isInteger(x.year) && text(x.champion, 50) && text(x.runnerUp, 50))) return false;
  if (!c.inventory.every(x => ['boots', 'kit'].includes(x))) return false;
  if (!c.offers.every(x => x && clubById(x.team) && Number.isInteger(x.years) && x.years > 0 && x.years <= 5 && Number.isFinite(x.salary) && x.salary >= 0 && Number.isFinite(x.bonus) && text(x.role, 30))) return false;
  if (c.pendingTraining && (!Number.isInteger(c.pendingTraining.skill) || c.pendingTraining.skill < 0 || c.pendingTraining.skill > 4 || !Array.isArray(c.pendingTraining.shots) || c.pendingTraining.shots.length > 5 || !c.pendingTraining.shots.every(x => [0, 1, 2].includes(x)))) return false;
  if (c.pendingTraining?.mode !== undefined) {
    const training = c.pendingTraining;
    if (training.mode !== trainingMode(c.position, training.skill) || !Array.isArray(training.rounds) || training.rounds.length !== 5) return false;
    if (!training.rounds.every(r => r && ['x','y','target'].every(k => Number.isFinite(r[k]) && r[k] >= 0 && r[k] <= 100) && Number.isInteger(r.lane) && r.lane >= 0 && r.lane <= 2 && Number.isFinite(r.signalAfter) && r.signalAfter >= 600 && r.signalAfter <= 1200 && Array.isArray(r.sequence) && r.sequence.length === 3 && r.sequence.every(x => ['left','right'].includes(x)))) return false;
  }
  if (c.lastTraining && (!Number.isInteger(c.lastTraining.skill) || c.lastTraining.skill < 0 || c.lastTraining.skill > 4 || !Number.isInteger(c.lastTraining.score) || c.lastTraining.score < 0 || c.lastTraining.score > 10 || !Number.isFinite(c.lastTraining.bonus) || c.lastTraining.bonus < 0 || c.lastTraining.bonus > 4)) return false;
  const validLeague = (l) => l === null || l && Array.isArray(l.table) && [18, 20].includes(l.table.length) && l.table.every(t => t && text(t.id, 30) && text(t.name, 50) && ['played', 'wins', 'draws', 'losses', 'gf', 'ga', 'points'].every(k => Number.isFinite(t[k]) && t[k] >= 0)) && Number.isInteger(l.rank) && l.rank > 0 && l.rank <= l.table.length && text(l.champion, 50) && Array.isArray(l.ownMatches) && l.ownMatches.length === (l.table.length - 1) * 2 && l.ownMatches.every(m => m && Number.isInteger(m.round) && text(m.opponent, 50) && Number.isFinite(m.goalsFor) && Number.isFinite(m.goalsAgainst));
  const validRecord = (r) => r && ['games', 'goals', 'assists', 'saves', 'minutes', 'rating', 'cleanSheets', 'year', 'age', 'passRate', 'oldOvr', 'newOvr'].every(k => Number.isFinite(r[k]) && r[k] >= 0) && r.games <= 38 && r.rating <= 10 && text(r.team, 50) && ['U18', 'U21', 'U23', '프로'].includes(r.level) && Array.isArray(r.awards) && r.awards.length < 32 && r.awards.every(x => text(x, 40)) && values(r.before) && values(r.after) && validLeague(r.league) && Array.isArray(r.tournaments) && r.tournaments.length <= 3 && r.tournaments.every(t => t && text(t.name, 50) && text(t.result, 15)) && (r.injury === null || text(r.injury, 100));
  return c.records.every(validRecord) && (!c.review || validRecord(c.review)) && (c.stage !== 'review' || !!c.review);
}
