import { CLUBS, totals, legacyBreakdown, distinctAwards } from './engine.js';

// Derive the ending from saved results; presentation never changes the career.
export function careerEnding(career) {
  const seasons = career.records.filter(r => r.level === '프로');
  const senior = seasons.filter(r => r.tier !== '육성팀');
  const score = legacyBreakdown(career), stats = totals(career);
  const years = new Map(), awards = new Map();
  for (const record of senior) {
    years.set(record.team, (years.get(record.team) || 0) + 1);
    for (const name of distinctAwards(record.awards).filter(name => name !== '리그 우승')) awards.set(name, (awards.get(name) || 0) + 1);
  }
  const [honorTeam, tenure] = [...years].sort((a, b) => b[1] - a[1])[0] || [];
  const honored = career.stage === 'retired' && tenure >= 8 && score.total >= 4000;
  const honorClub = honored ? CLUBS.find(c => c.name === honorTeam) : null;
  const peak = seasons.length ? [...seasons].sort((a, b) => b.newOvr - a.newOvr || a.year - b.year)[0] : null;
  const peakYear = peak?.year;
  const keeper = career.position === 'GK';
  const average = stats.games ? (stats.rating / stats.games).toFixed(2) : '–';
  const coreStats = [
    ['경기', stats.games.toLocaleString()], [keeper ? '선방' : '골', (keeper ? stats.saves : stats.goals).toLocaleString()],
    [keeper ? '클린시트' : '도움', (keeper ? stats.cleanSheets : stats.assists).toLocaleString()],
    ['평균 평점', average], ['출전 시간', stats.minutes.toLocaleString()], ['국가대표', `${career.nationalCaps}경기`],
  ];
  const achievements = [...awards].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  if (career.trophies.length) achievements.unshift({ name: '리그 우승', count: career.trophies.length });
  const review = honorClub ? `${honorClub.name}에 영원히 남은 번호` : score.total >= 8000 ? '유럽 축구에 이름을 새긴 전설' : score.total >= 4000 ? '그라운드에 오래 기억될 선수' : seasons.length >= 10 ? '한 시대의 그라운드를 누빈 선수' : seasons.length ? '자신만의 축구 인생을 완성한 선수' : '꿈을 향해 달린 시간도 기록으로 남습니다';
  return { seasons, score, coreStats, achievements, honorClub: honorClub || null, review, peakYears: peakYear ? `${Math.max(seasons[0].year, peakYear - 1)}–${Math.min(seasons.at(-1).year, peakYear + 1)}` : '프로 기록 없음' };
}
