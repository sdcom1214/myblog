// Real award names; winners here are decided by this game's simulated season.
export const LEAGUE_AWARDS = {
  premier: ['프리미어리그 골든부트', '프리미어리그 골든글러브', 'PFA 올해의 선수', 'PFA 올해의 영플레이어'],
  laliga: ['피치치 트로피', '사모라 트로피', '알프레도 디 스테파노 트로피', '라리가 최우수 U23 선수'],
  bundesliga: ['분데스리가 득점왕', '분데스리가 최우수 골키퍼', '분데스리가 올해의 선수', '분데스리가 올해의 신인'],
  seriea: ['카포칸노니에레', '세리에 A 최우수 골키퍼', '세리에 A 시즌 MVP', '세리에 A 최우수 U23 선수'],
  ligue1: ['리그 1 득점왕', 'UNFP 최우수 골키퍼', 'UNFP 올해의 선수', 'UNFP 최우수 유망주'],
  eredivisie: ['에레디비시 득점왕', '에레디비시 최우수 골키퍼', '에레디비시 올해의 선수', '요한 크라위프 트로피'],
  primeira: ['볼라 드 프라타', '프리메이라리가 최우수 골키퍼', '프리메이라리가 올해의 선수', '프리메이라리가 최우수 영플레이어'],
};
const global = ['발롱도르', 'FIFA 올해의 선수', '유러피언 골든슈', 'FIFPRO 월드 XI', '코파 트로피', '골든보이', '야신 트로피', 'FIFA 최우수 골키퍼'];
export const AWARD_CATALOG = [...new Set(['리그 우승', '득점왕', '도움왕', '베스트 XI', '신인상', ...global, ...Object.values(LEAGUE_AWARDS).flat()])].map((title, i) => ({ key: `award-${i}`, title }));

export function majorSeasonAwards(c, r, ability, draw) {
  if (r.level !== '프로' || r.tier !== '1군' || r.games < 15) return [];
  const league = LEAGUE_AWARDS[r.league.leagueId], keeper = c.position === 'GK';
  const impact = keeper ? r.cleanSheets * .6 + r.saves * .025 : c.position === 'DF' ? (r.tackles || 0) * .09 + r.assists * .4 : r.goals * .45 + r.assists * .5;
  const merit = r.rating * 7 + ability * .25 + Math.min(18, impact) + Math.max(0, 8 - r.league.rank);
  const wins = [];
  if (r.goals >= 22) wins.push(league[0]);
  if (keeper && r.cleanSheets >= 12) wins.push(league[1]);
  if (r.rating >= 8.2 && merit >= 87 + draw() * 8) wins.push(league[2]);
  if (r.age <= (r.league.leagueId === 'laliga' || r.league.leagueId === 'seriea' ? 23 : 21) && r.rating >= 7.6 && merit >= 77 + draw() * 7) wins.push(league[3]);
  if (r.games >= 20 && merit >= 90 + draw() * 7) wins.push('FIFPRO 월드 XI');
  if (r.games >= 24 && r.rating >= 8.3 && merit >= 98 + draw() * 8) wins.push('발롱도르');
  if (r.games >= 24 && r.rating >= 8.2 && merit >= 96 + draw() * 8) wins.push('FIFA 올해의 선수');
  const goalWeight = ['eredivisie', 'primeira'].includes(r.league.leagueId) ? 1.5 : 2;
  if (r.goals * goalWeight >= 56 + draw() * 12) wins.push('유러피언 골든슈');
  if (r.age <= 21 && r.games >= 20 && merit >= 80 + draw() * 8) wins.push('코파 트로피');
  if (r.age <= 21 && r.games >= 20 && merit >= 79 + draw() * 8) wins.push('골든보이');
  if (keeper && r.cleanSheets >= 12 && r.rating >= 8 && merit >= 92 + draw() * 7) wins.push('야신 트로피');
  if (keeper && r.saves >= 90 && r.cleanSheets >= 10 && merit >= 90 + draw() * 8) wins.push('FIFA 최우수 골키퍼');
  return wins;
}
