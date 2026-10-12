import * as E from './engine.js';
import { careerEnding } from './ending.js';
import { escapeHTML as esc } from './html.js';

const icon = name => `<img class="icon" src="/icons/${name}.svg" alt="" aria-hidden="true">`;
const button = (label, action, cls = '', disabled = false) => `<button type="button" data-action="${action}" class="${cls}" ${disabled ? 'disabled' : ''}>${label}</button>`;
const badge = (id, label) => `<img class="club-badge" src="/clubs/${id}.png" alt="${esc(label)}">`;
const grade = value => value >= 90 ? 'S' : value >= 80 ? 'A' : value >= 70 ? 'B' : value >= 60 ? 'C' : value >= 50 ? 'D' : 'E';
const seasonArticle = (r, i, count, position) => `<article><small>${r.year} · ${r.age}세</small><h3>${esc(r.team)}</h3><p>${r.games}경기 · ${position === 'GK' ? `${r.saves}선방 · ${r.cleanSheets}클린시트` : `${r.goals}골 · ${r.assists}도움`} · 평점 ${r.rating.toFixed(1)}</p><strong>${esc(r.awards[0] || (i === 0 ? '프로 무대 첫 시즌' : i === count - 1 ? '현역 마지막 시즌' : '그라운드의 한 해'))}</strong></article>`;

export function endingCard(player, { face = 'front', interactive = false, progress = 1, showGrades = true, teamName } = {}) {
  const ending = careerEnding(player), club = E.clubById(player.team || player.preferred);
  const label = teamName || club?.name || player.school;
  const header = `<header class="ending-player">${club ? badge(club.id, label) : icon('soccer-ball')}<div><h2>${esc(player.name)}${ending.honorClub ? `<img class="ending-crown" src="/icons/crown.svg" alt="구단 영구결번 헌정">` : ''}</h2><strong>${esc(label)}</strong><small>${E.POSITIONS[player.position]} · No.${player.number} · 은퇴 ${player.age}세</small></div></header>`;
  const front = `<section class="ending-review"><small>CAREER REVIEW</small><strong>${esc(ending.review)}</strong><span>${ending.seasons.length}시즌 · 은퇴 나이 ${player.age}세</span><i aria-hidden="true">${esc(player.name)}</i></section><dl class="ending-core-stats">${ending.coreStats.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')}</dl>${button(`<small>주요 업적</small><span class="ending-awards">${ending.achievements.slice(0, 5).map(a => `<b>${icon('trophy')}${esc(a.name)}${a.count > 1 ? ` · ${a.count}회` : ''}</b>`).join('') || '<em>그라운드에서의 시간이 기록으로 남았습니다.</em>'}${ending.achievements.length > 5 ? icon('arrow-right') : ''}</span>`, 'honours', 'ending-achievements')}`;
  const back = `<section class="ending-score"><header><small>LEGACY SCORE</small><strong data-ending-total>${Math.floor(ending.score.total * progress).toLocaleString()}점</strong></header><dl>${ending.score.items.map(item => `<div><dt>${item.label}</dt><dd>${item.value.toLocaleString()}</dd></div>`).join('')}</dl></section><section class="ending-prime"><header><small>PRIME ABILITY</small><strong>${ending.peakYears}</strong></header>${E.skillNames(player).map((name, i) => { const value = Math.min(100, Math.round(player.peakSkills[i] * 5)), rank = grade(value); return `<div><span>${name}</span><b>${value}</b><strong class="grade grade-${rank}" data-ending-grade ${!showGrades ? 'style="visibility:hidden"' : ''}>${rank}</strong><i><b data-ending-bar="${value}" style="width:${value * progress}%"></b></i></div>`; }).join('')}</section>`;
  return `<article class="ending-card ${ending.honorClub ? 'ending-card-gold' : ''} face-${face}" ${interactive ? `role="button" tabindex="0" data-action="ending-card-flip" aria-pressed="${face === 'back'}" aria-label="${esc(player.name)}의 카드 ${face === 'front' ? '뒷면' : '앞면'} 보기"` : 'aria-label="은퇴 선수 카드"'}>${header}${face === 'front' ? front : back}</article>`;
}

// UI checkpoints live outside canonical career data and server competition state.
export class RetirementSequence {
  constructor({ root, storage, account, render, finish }) {
    Object.assign(this, { root, storage, account, render, finish });
    this.active = false; this.timers = []; this.frame = 0;
    document.addEventListener('visibilitychange', () => {
      if (!this.active) return;
      this.clearTimers(); this.entered = null;
      if (!document.hidden) this.afterRender();
    });
  }
  key(player) { return `second-life-football-ending-v1:${this.account()}:${player.id}`; }
  hasSeen(player) { try { return JSON.parse(this.storage.getItem(this.key(player)))?.done === true; } catch { return false; } }
  start(player, replay = false) {
    if (player.stage !== 'retired' || player.public || !replay && this.hasSeen(player)) return false;
    this.stop(); this.player = player; this.summary = careerEnding(player); this.active = true;
    this.stage = this.summary.honorClub ? 'epilogue' : 'timeline'; this.revealed = 1; this.ready = false;
    if (!replay) {
      try {
        const saved = JSON.parse(this.storage.getItem(this.key(player)));
        if (['epilogue','decision','number','timeline','calculating','result'].includes(saved?.stage) && (this.summary.honorClub || !['epilogue','decision','number'].includes(saved.stage))) this.stage = saved.stage;
        if (Number.isInteger(saved?.revealed)) this.revealed = Math.max(1, Math.min(this.summary.seasons.length, saved.revealed));
      } catch { /* Start from the beginning if a visual checkpoint is invalid. */ }
    }
    this.persist(); return true;
  }
  persist(done = false) { this.storage.setItem(this.key(this.player), JSON.stringify({ stage: this.stage, revealed: this.revealed, done })); }
  clearTimers() { for (const timer of this.timers) clearTimeout(timer); this.timers = []; cancelAnimationFrame(this.frame); }
  stop() { this.clearTimers(); this.active = false; this.entered = null; }
  later(fn, delay) { this.timers.push(setTimeout(() => { if (this.active && !document.hidden) fn(); }, delay)); }
  advance(stage) { this.clearTimers(); this.entered = null; this.stage = stage; this.ready = false; this.persist(); this.render(true); }
  handle(action) {
    if (!this.active || !['ending-next','ending-skip','ending-records'].includes(action)) return false;
    if (action === 'ending-skip') this.advance('result');
    else if (action === 'ending-records' && this.stage === 'result') { this.persist(true); this.stop(); this.finish(); }
    else if (this.ready) this.advance({ epilogue:'decision', decision:'number', number:'timeline' }[this.stage] || 'result');
    return true;
  }
  markup() {
    if (!this.active) return '';
    const player = this.player, ending = this.summary, honor = ending.honorClub;
    let content = '';
    if (this.stage === 'epilogue') content = `<section class="ending-epilogue"><p>${esc(player.name)}의 선수 생활은 끝났지만</p><h2>아직 마지막 이야기가<br>남았습니다.</h2></section>`;
    if (this.stage === 'decision') content = `<section class="ending-decision"><h2>${esc(honor.name)}은<br>${esc(player.name)}의 이름을<br>구단 역사에 남기기로 했습니다.</h2></section>`;
    if (this.stage === 'number') content = `<section class="ending-number"><div class="ending-uniform"><img src="/retirement-jersey.png" alt=""><span>${esc(player.name)}</span><strong>${player.number}</strong><em>${esc(player.name)}</em></div><h2>${player.number}번은 이제,<br>${esc(player.name)}의 이름으로 남습니다.</h2><p>${ending.seasons.length}시즌 · ${ending.coreStats[0][1]}경기 · ${ending.coreStats[1][1]}${player.position === 'GK' ? '선방' : '골'}</p><strong>${esc(honor.name)} 영구결번</strong><small>게임 커리어에 따른 구단 헌정입니다.</small></section>`;
    if (this.stage === 'timeline') content = `<section class="ending-timeline-screen"><header><small>MY FOOTBALL LIFE</small><h2>${esc(player.name)}의 축구 인생</h2><span data-ending-count>${Math.min(this.revealed, ending.seasons.length)} / ${ending.seasons.length} 시즌</span></header><div class="ending-timeline">${ending.seasons.slice(0, this.revealed).map((r, i) => seasonArticle(r,i,ending.seasons.length,player.position)).join('') || '<p>유소년의 꿈과 도전도 당신의 이야기로 남습니다.</p>'}</div></section>`;
    if (this.stage === 'calculating') content = `<section class="ending-calculating">${icon('soccer-ball')}<small>LEGACY SCORE</small><h2>${esc(player.name)}의 커리어 집계 중</h2><p>통산 성적 · 수상 · 우승 · 국가대표 기록을 계산합니다.</p></section>`;
    if (this.stage === 'result') content = `<section class="ending-result" role="dialog" aria-modal="true" aria-label="${esc(player.name)}의 최종 커리어 카드"><button type="button" class="ending-close" data-action="ending-records" aria-label="최종 카드 닫기">${icon('x')}</button>${endingCard(player, { face:'back', progress:0, showGrades:false })}${button(`통산 기록 보기 ${icon('arrow-right')}`, 'ending-records', 'primary')}</section>`;
    return `<div class="retirement-layer stage-${this.stage}" data-ending-stage="${this.stage}" role="region" aria-label="은퇴 연출" tabindex="-1"><div class="ending-controls">${this.stage !== 'result' ? button('연출 건너뛰기', 'ending-skip', 'ending-skip') : ''}</div>${content}${['epilogue','decision','number'].includes(this.stage) ? button(`${this.ready ? '탭하여 계속' : '당신의 이야기를 기억하는 중'} ${icon('arrow-right')}`, 'ending-next', 'ending-next', !this.ready) : ''}</div>`;
  }
  afterRender() {
    if (!this.active || document.hidden) return;
    const timeline = this.root.querySelector('.ending-timeline');
    if (timeline) timeline.scrollTo({ top:timeline.scrollHeight, behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (this.entered === this.stage) return;
    this.entered = this.stage;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (['epilogue','decision','number'].includes(this.stage)) this.later(() => { this.ready = true; const next = this.root.querySelector('[data-action="ending-next"]'); if (next) { next.disabled = false; next.innerHTML = `탭하여 계속 ${icon('arrow-right')}`; } }, reduced ? 100 : { epilogue:3500, decision:3000, number:6200 }[this.stage]);
    if (this.stage === 'timeline') {
      const tick = () => {
        if (this.revealed >= this.summary.seasons.length) { this.later(() => this.advance('calculating'), reduced ? 150 : 1200); return; }
        this.revealed++; this.persist();
        const timeline = this.root.querySelector('.ending-timeline'), count = this.root.querySelector('[data-ending-count]');
        timeline?.insertAdjacentHTML('beforeend', seasonArticle(this.summary.seasons[this.revealed-1],this.revealed-1,this.summary.seasons.length,this.player.position));
        if (count) count.textContent = `${this.revealed} / ${this.summary.seasons.length} 시즌`;
        timeline?.scrollTo({ top:timeline.scrollHeight, behavior:reduced ? 'auto' : 'smooth' });
        this.later(tick, reduced ? 50 : Math.max(650, Math.min(850, 14000 / this.summary.seasons.length)));
      };
      this.later(tick, reduced ? 50 : 650);
    }
    if (this.stage === 'calculating') this.later(() => this.advance('result'), reduced ? 100 : 950);
    if (this.stage === 'result') {
      let start;
      const tick = time => {
        if (!this.active || this.stage !== 'result') return;
        start ??= time; const elapsed = time - start, progress = reduced ? 1 : Math.min(1, elapsed / 2000);
        const score = this.root.querySelector('.ending-result [data-ending-total]'); if (score) score.textContent = `${Math.floor(this.summary.score.total * progress).toLocaleString()}점`;
        for (const bar of this.root.querySelectorAll('.ending-result [data-ending-bar]')) bar.style.width = `${Number(bar.dataset.endingBar) * progress}%`;
        if (reduced || elapsed >= 2700) { for (const grade of this.root.querySelectorAll('.ending-result [data-ending-grade]')) grade.style.visibility = 'visible'; return; }
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    }
  }
}
