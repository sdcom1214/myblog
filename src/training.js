export const TRAINING_GAMES = {
  finish: { name: '슈팅 정확도', guide: '골문 안의 표적을 직접 눌러 슈팅하세요.', action: '슛!', control: 'goal' },
  passing: { name: '패스 길 찾기', guide: '수비수가 막지 않은 동료를 골라 패스하세요. 1·2·3 키도 사용할 수 있습니다.', action: '패스', control: 'lanes' },
  dribble: { name: '콘 드리블', guide: '표시된 순서대로 왼쪽·오른쪽을 선택해 콘을 통과하세요. 방향키로도 플레이할 수 있습니다.', action: '드리블', control: 'sequence' },
  tackle: { name: '태클 타이밍', guide: '공격수가 태클 구역에 들어왔을 때 공을 빼앗으세요.', action: '태클!', control: 'approach' },
  sprint: { name: '스프린트 인터벌', guide: '2초 동안 달리기 버튼을 빠르게 눌러 결승선에 도전하세요.', action: '달리기!', control: 'sprint' },
  reflex: { name: '반응 세이브', guide: '공이 초록색으로 바뀌면 즉시 세이브! 신호 전에 누르면 실패입니다.', action: '세이브!', control: 'reaction' },
  position: { name: '각도 좁히기', guide: '공격수의 슈팅 방향을 보고 알맞은 골문 위치를 선택하세요. 1·2·3 키도 사용할 수 있습니다.', action: '위치 선택', control: 'lanes' },
  catch: { name: '하이볼 캐칭', guide: '공이 장갑 높이에 내려오면 캐칭하세요.', action: '캐칭!', control: 'vertical' },
  kicking: { name: '롱킥 파워', guide: '킥 버튼을 누르고 있다가 노란 파워 구역에서 놓으세요. 스페이스를 길게 눌러도 됩니다.', action: '누르고 킥!', control: 'power' },
};
export const trainingMode = (position, skill) => (position === 'GK' ? ['reflex', 'position', 'catch', 'kicking', 'sprint'] : ['finish', 'passing', 'dribble', 'tackle', 'sprint'])[skill];
export function trainingChallenge(mode, random) {
  const integer = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  return { x: integer(18, 82), y: integer(22, 70), lane: integer(0, 2), sequence: Array.from({ length: 3 }, () => random() < .5 ? 'left' : 'right'), signalAfter: integer(600, 1200), target: mode === 'catch' ? 72 : mode === 'kicking' ? integer(55, 80) : 68 };
}
export function trainingInputScore(mode, round, input) {
  const invalid = () => { const error = new Error('올바른 훈련 입력이 필요합니다.'); error.status = 400; throw error; };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const number = (key, lo, hi) => { const value = input[key]; if (!Number.isFinite(value) || value < lo || value > hi) invalid(); return value; };
  if (mode === 'finish') { const d = Math.hypot(number('x', 0, 100) - round.x, number('y', 0, 100) - round.y); return d <= 9 ? 2 : d <= 24 ? 1 : 0; }
  if (mode === 'passing' || mode === 'position') { const lane = number('lane', 0, 2); if (!Number.isInteger(lane)) invalid(); return lane === round.lane ? 2 : 0; }
  if (mode === 'dribble') { if (!Array.isArray(input.sequence) || input.sequence.length !== 3 || !input.sequence.every(x => ['left','right'].includes(x))) invalid(); const correct = input.sequence.filter((x, i) => x === round.sequence[i]).length; return correct === 3 ? 2 : correct === 2 ? 1 : 0; }
  if (mode === 'sprint') { const taps = number('taps', 0, 100), duration = number('duration', 0, 2500); if (!Number.isInteger(taps)) invalid(); return duration >= 1800 && duration <= 2500 ? taps >= 9 ? 2 : taps >= 5 ? 1 : 0 : 0; }
  if (mode === 'reflex') { const reaction = number('reaction', -2000, 10000); return reaction >= 0 && reaction <= 180 ? 2 : reaction > 180 && reaction <= 450 ? 1 : 0; }
  if (['tackle','catch','kicking'].includes(mode)) { const d = Math.abs(number('position', 0, 100) - round.target); return d <= 8 ? 2 : d <= 22 ? 1 : 0; }
  return invalid();
}
