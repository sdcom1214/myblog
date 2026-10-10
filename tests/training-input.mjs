export function trainingInput(c, score = 2) {
  const t = c.pendingTraining, r = t.rounds[t.shots.length], offset = score === 2 ? 0 : score === 1 ? 15 : 35;
  if (t.mode === 'finish') return { x: r.x + (r.x > 50 ? -1 : 1) * offset, y: r.y };
  if (['passing','position'].includes(t.mode)) return { lane: score === 2 ? r.lane : (r.lane + 1) % 3 };
  if (t.mode === 'dribble') return { sequence: r.sequence.map((x,i) => score === 2 || score === 1 && i < 2 ? x : x === 'left' ? 'right' : 'left') };
  if (t.mode === 'sprint') return { taps: score === 2 ? 10 : score === 1 ? 6 : 1, duration: 2000 };
  if (t.mode === 'reflex') return { reaction: score === 2 ? 100 : score === 1 ? 300 : -100 };
  return { position: r.target + (r.target > 50 ? -1 : 1) * offset };
}
