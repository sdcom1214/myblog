import { TRAINING_GAMES } from './training.js';

const button = (text, action, disabled = false, cls = '') => `<button type="button" class="${cls}" data-action="${action}" ${disabled ? 'disabled' : ''}>${text}</button>`;
export class TrainingGame {
  constructor({ career, render, submit, toast, root, isOpen }) {
    Object.assign(this, { career, render, submit, toast, isOpen }); this.active = false; this.frame = 0; this.key = ''; this.aim = { x: 50, y: 50 };
    root.addEventListener('pointerup', event => {
      const goal = event.target.closest('.training-goal');
      if (goal && this.active && this.isOpen()) { const r = goal.getBoundingClientRect(); this.finish({ x: Math.max(0, Math.min(100, (event.clientX - r.left) / r.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - r.top) / r.height * 100)) }); }
      if (this.held && this.isOpen()) this.releasePower();
    });
    root.addEventListener('pointerdown', event => {
      const hold = event.target.closest('[data-action="training-hold"]');
      if (hold && this.active && this.isOpen()) { event.preventDefault(); hold.setPointerCapture(event.pointerId); this.holdPower(); }
    });
    root.addEventListener('pointercancel', () => { if (this.held) this.releasePower(); });
    document.addEventListener('keyup', event => { if (this.isOpen() && this.held && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); this.releasePower(); } });
  }
  get pending() { return this.career()?.pendingTraining; }
  get mode() { return this.pending?.mode || 'legacy'; }
  get round() { return this.pending?.rounds?.[this.pending.shots.length] || { target: 50 }; }
  stop() { cancelAnimationFrame(this.frame); this.active = false; this.held = false; }
  sync() {
    const p = this.pending, next = p ? `${this.career().id}:${this.career().trainedYear}:${p.skill}:${p.shots.length}` : '';
    if (next !== this.key) { this.stop(); this.key = next; this.sequence = []; this.taps = 0; this.value = 0; this.aim = { x: 50, y: 50 }; }
  }
  markup() {
    this.sync(); const mode = this.mode, round = this.round, spec = TRAINING_GAMES[mode];
    if (this.pending.shots.length === 5) return '<p class="centered">5번의 시도를 모두 마쳤습니다!</p>';
    let board = '', controls = '';
    if (mode === 'finish') {
      board = `<button type="button" class="training-goal" data-action="training-goal" aria-label="골문 표적을 눌러 슈팅" ${!this.active ? 'disabled' : ''}><span class="goal-target" style="left:${round.x}%;top:${round.y}%">◎</span><span class="goal-aim" style="left:${this.aim.x}%;top:${this.aim.y}%">+</span></button>`;
    } else if (['passing', 'position'].includes(mode)) {
      board = `<div class="training-pitch"><small>${mode === 'passing' ? '빈 패스 길을 찾으세요' : `슈팅 방향: ${['왼쪽', '중앙', '오른쪽'][round.lane]}`}</small><div class="training-lanes">${[0,1,2].map(i => button(`<span>${mode === 'position' ? '🧤' : '●'}</span><strong>${['왼쪽','중앙','오른쪽'][i]}</strong><small>${mode === 'passing' ? i === round.lane ? '열린 동료' : '수비수 접근' : `${i + 1} 키`}</small>`, `training-lane:${i}`, !this.active, mode === 'passing' && i !== round.lane ? 'covered' : '')).join('')}</div></div>`;
    } else if (mode === 'dribble') {
      board = `<div class="training-slalom"><div>${round.sequence.map((s,i) => `<span class="${i < this.sequence.length ? this.sequence[i] === s ? 'correct' : 'miss' : ''}">${s === 'left' ? '←' : '→'}<small>▲</small></span>`).join('')}</div><div class="training-directions">${button('← 왼쪽', 'training-step:left', !this.active)}${button('오른쪽 →', 'training-step:right', !this.active)}</div></div>`;
    } else if (mode === 'reflex') {
      board = '<div class="training-reaction"><span id="training-signal">대기</span><strong>●</strong></div>'; controls = button('🧤 세이브!', 'shoot', !this.active, 'shoot-button');
    } else if (mode === 'sprint') {
      board = `<div class="training-sprint"><small><span id="training-time">2.0</span>초 · <span id="training-taps">${this.taps}</span>회</small><div><span id="training-runner">●</span><b>FINISH</b></div></div>`; controls = button('달리기!', 'training-tap', !this.active, 'shoot-button');
    } else if (mode === 'catch') {
      board = `<div class="training-highball"><span id="training-mover" style="top:${this.value}%">●</span><b style="top:${round.target}%">🧤</b></div>`; controls = button('캐칭!', 'shoot', !this.active, 'shoot-button');
    } else if (mode === 'tackle') {
      board = `<div class="training-intercept"><b style="left:${round.target}%">태클 구역</b><span id="training-mover" style="left:${this.value}%">●</span></div>`; controls = button('태클!', 'shoot', !this.active, 'shoot-button');
    } else {
      board = `<div class="timing-board"><div class="training-power"><b style="left:${round.target - 8}%;width:16%"></b><i id="training-power-fill" style="width:${this.value}%"></i></div><small>${mode === 'kicking' ? '누르고 있다가 파워 구역에서 놓기' : '중앙에서 멈추기'}</small></div>`; controls = button(mode === 'kicking' ? '누르고 킥!' : '지금 슛!', mode === 'kicking' ? 'training-hold' : 'shoot', !this.active, 'shoot-button');
    }
    return `<div class="training-arena" data-training-mode="${mode}">${board}</div><p class="training-guide">${spec?.guide || '중앙에서 공을 차세요. 스페이스 / Enter로도 플레이할 수 있습니다.'}</p>${!this.active ? button(this.pending.shots.length ? '다음 시도' : '훈련 시작', 'training-start', false, 'shoot-button') : controls}`;
  }
  start() {
    if (this.active || !this.pending || this.pending.shots.length >= 5) return;
    this.active = true; this.sequence = []; this.taps = 0; this.value = 0; this.startTime = performance.now(); this.render(true);
    const tick = time => {
      if (!this.active || !this.isOpen()) return;
      const elapsed = time - this.startTime, mode = this.mode;
      if (mode === 'sprint') {
        document.querySelector('#training-time').textContent = Math.max(0, 2 - elapsed / 1000).toFixed(1);
        if (elapsed >= 2000) { this.finish({ taps: this.taps, duration: 2000 }); return; }
      } else if (mode === 'reflex') {
        const signal = document.querySelector('#training-signal'); if (signal) { const ready = elapsed >= this.round.signalAfter; signal.textContent = ready ? '지금 세이브!' : '대기'; signal.parentElement.classList.toggle('ready', ready); }
        if (elapsed >= this.round.signalAfter + 1800) { this.finish({ reaction: 1800 }); return; }
      } else if (mode === 'kicking') {
        this.value = this.held ? Math.min(100, (time - this.powerStart) / 10) : 0;
        const fill = document.querySelector('#training-power-fill'); if (fill) fill.style.width = `${this.value}%`;
      } else if (['tackle','catch','legacy'].includes(mode)) {
        this.value = mode === 'legacy' ? 50 + Math.sin(elapsed / 650 * Math.PI) * 48 : (elapsed / 12) % 200;
        if (this.value > 100) this.value = 200 - this.value;
        const mover = document.querySelector('#training-mover'); if (mover) mover.style[mode === 'catch' ? 'top' : 'left'] = `${this.value}%`;
        const fill = document.querySelector('#training-power-fill'); if (fill) fill.style.width = `${this.value}%`;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  async finish(input) {
    if (!this.active || this.submitting) return;
    this.stop(); this.submitting = true;
    try { await this.submit(input); } catch (error) { this.toast(error.message); }
    finally { this.submitting = false; this.render(true); }
  }
  holdPower() { if (!this.held) { this.held = true; this.powerStart = performance.now(); } }
  releasePower() { if (this.held) { const value = Math.min(100, (performance.now() - this.powerStart) / 10); this.finish({ position: value }); } }
  handle(action) {
    const [name, arg] = action.split(':');
    if (!['training-start','training-lane','training-step','training-tap','training-hold','training-goal','shoot'].includes(name) || !this.isOpen()) return false;
    if (name === 'training-start') this.start();
    else if (this.active && !this.submitting) {
      if (name === 'training-lane') this.finish({ lane: Number(arg) });
      if (name === 'training-step') { this.sequence.push(arg); if (this.sequence.length === 3) this.finish({ sequence: [...this.sequence] }); else this.render(true); }
      if (name === 'training-tap') { this.taps = Math.min(100, this.taps + 1); document.querySelector('#training-taps').textContent = this.taps; document.querySelector('#training-runner').style.left = `${Math.min(90, this.taps * 9)}%`; }
      if (name === 'shoot') {
        if (this.mode === 'finish') this.finish(this.aim);
        else if (this.mode === 'reflex') this.finish({ reaction: performance.now() - this.startTime - this.round.signalAfter });
        else if (['tackle','catch'].includes(this.mode)) this.finish({ position: this.value });
        else if (this.mode === 'legacy') this.finish(this.value);
      }
    }
    return true;
  }
  keydown(event) {
    if (!this.isOpen() || !this.active) return false;
    if (event.repeat) return [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '1', '2', '3'].includes(event.key);
    const mode = this.mode, key = event.key;
    if (['passing','position'].includes(mode) && ['1','2','3'].includes(key)) this.handle(`training-lane:${Number(key)-1}`);
    else if (mode === 'dribble' && ['ArrowLeft','ArrowRight'].includes(key)) this.handle(`training-step:${key === 'ArrowLeft' ? 'left' : 'right'}`);
    else if (mode === 'finish' && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key)) { this.aim.x = Math.max(0, Math.min(100, this.aim.x + (key === 'ArrowLeft' ? -5 : key === 'ArrowRight' ? 5 : 0))); this.aim.y = Math.max(0, Math.min(100, this.aim.y + (key === 'ArrowUp' ? -5 : key === 'ArrowDown' ? 5 : 0))); const aim = document.querySelector('.goal-aim'); if (aim) { aim.style.left = `${this.aim.x}%`; aim.style.top = `${this.aim.y}%`; } }
    else if ([' ', 'Enter'].includes(key)) { if (mode === 'kicking') this.holdPower(); else this.handle(mode === 'sprint' ? 'training-tap' : 'shoot'); }
    else return false;
    return true;
  }
}
