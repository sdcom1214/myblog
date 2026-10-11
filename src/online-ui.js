import * as E from './engine.js';
import { OnlineClient } from './api.js';

export class OnlineFeatures {
  constructor(ctx) {
    this.ctx = ctx; this.client = new OnlineClient(); this.ready = false; this.pending = false;
    this.club = { players: [], teams: [], achievements: [] }; this.ranks = []; this.rankType = 'live'; this.metric = 'score'; this.rankPosition = '';
    this.clubTab = 'players'; this.clubScope = 'season'; this.clubPosition = ''; this.clubSort = 'created'; this.grid = false;
    this.duels = []; this.users = []; this.duelPosition = 'FW'; this.selectedFriend = ''; this.friendQuery = ''; this.teamMode = 'edit'; this.battleMode = 'challenge'; this.battleResult = null;
    this.teamId = ''; this.teamName = '나의 FC'; this.squad = []; this.authMode = 'login'; this.authError = ''; this.authEmail = ''; this.authNickname = '';
    this.items = []; this.ledger = []; this.notices = []; this.accordions = new Set(); this.poll = null;
    this.mini = { mode: 'direction', stage: 'ready', attempts: 0, hits: 0, answer: null, previous: null, detail: '' };
  }
  get user() { return this.client.user; }
  async init() {
    try { await this.client.init(); if (this.user) this.ctx.acceptServer(await this.client.restore(), true); this.ready = true; this.ctx.render(); }
    catch { this.ready = true; this.ctx.render(); }
  }
  async command(command, args, local) {
    if (!this.user || !this.client.verified && command !== 'create') { this.ctx.commitLocal(local()); return; }
    this.ctx.acceptServer(await this.client.command(command, args), false);
  }
  async refreshClub() { if (this.user) { this.club = await this.client.request('/club'); this.client.wallet = this.club.wallet; } }
  async refreshDuels() { if (this.user) this.duels = (await this.client.request('/duels')).duels; }
  async refreshRanks() { const params = new URLSearchParams({ type: this.rankType, metric: this.metric, position: this.rankPosition }); this.ranks = (await this.client.request(`/rankings?${params}`)).rows; }
  async refreshShop() { if (this.user) { const r = await this.client.request('/shop'); this.client.wallet = r.wallet; this.items = r.items; this.ledger = r.ledger; } }
  async open(screen) {
    this.ctx.navigate(screen); this.pending = true; this.ctx.render();
    try {
      if (screen === 'club' || screen === 'team') await this.refreshClub();
      if (screen === 'ranking') await this.refreshRanks();
      if (screen === 'shop') await this.refreshShop();
      if (screen === 'duel' || screen === 'friend') { await this.refreshDuels(); this.startPolling(); }
    } catch (e) { this.ctx.toast(e.message); }
    finally { this.pending = false; this.ctx.render(); }
  }
  duelListing() {
    const { btn, esc } = this.ctx;
    return this.duels.map(d => `<article class="duel-status-card"><small>${{ waiting: '매칭 대기', pending: '신청 대기', active: '커리어 진행 중', complete: '매치 완료', declined: '신청 거절', cancelled: '신청 취소' }[d.status]} · ${E.POSITIONS[d.position]}</small><h2>${esc(d.opponent || '상대를 찾고 있습니다')}</h2>${d.own ? `<div class="duel-progress"><span>나 <b>${d.own.age}세 · LS ${d.own.score}</b></span><span>상대 <b>${d.rival?.age || 18}세 · LS ${d.rival?.score || 0}</b></span></div>` : ''}${d.result ? `<strong class="duel-final">${d.result.scores.join(' : ')} · ${d.result.winnerId === null ? '무승부' : d.result.winnerId === this.user.id ? '승리' : '패배'}</strong>` : ''}${d.incoming ? `${btn('매치 수락 · 새 커리어 시작', `duel-accept:${d.id}`, 'primary')}${btn('거절', `duel-decline:${d.id}`, 'secondary')}` : d.status === 'active' ? btn('커리어 이어하기', 'duel-resume', 'primary') : ['waiting', 'pending'].includes(d.status) ? btn('신청 취소', `duel-cancel:${d.id}`, 'secondary') : ''}</article>`).join('');
  }
  startPolling() {
    clearInterval(this.poll);
    this.poll = setInterval(async () => {
      if (!this.user || !['duel', 'friend'].includes(this.ctx.getScreen())) { clearInterval(this.poll); return; }
      try {
        const screen = this.ctx.getScreen(), user = this.user;
        await this.refreshDuels();
        if (this.ctx.getScreen() !== screen || this.user !== user) return;
        const listing = document.getElementById('duel-list');
        const html = this.duelListing();
        if (listing && listing.innerHTML !== html) listing.innerHTML = html;
        const request = document.querySelector('[data-action="friend-request"], [data-action="match-request"]');
        if (request) request.disabled = this.duels.some(d => ['waiting', 'pending', 'active'].includes(d.status)) || screen === 'friend' && !this.selectedFriend;
      } catch { /* Retry while the matching screen remains open. */ }
    }, 4000);
  }
  header(title, extra = '') { return `<header class="source-menu-header"><h1>${title}</h1>${extra}</header>`; }
  shell(title, content, extra = '', cls = '') { return `<main class="menu-screen ${cls}">${this.header(title, extra)}<div class="menu-content">${content}</div>${this.ctx.nav()}</main>`; }
  loginMessage(text = '로그인과 닉네임 등록이 필요합니다.') { const { btn } = this.ctx; return `<section class="account-message"><p>${text}</p>${btn('로그인', 'auth', 'secondary')}</section>`; }
  loading() { return this.pending ? '<p class="muted" role="status">불러오는 중입니다…</p>' : ''; }
  renderScreen(screen) {
    const { btn, esc, icon, badge } = this.ctx;
    if (this.pending && ['club', 'ranking', 'duel', 'friend', 'team', 'shop'].includes(screen)) return this.shell('불러오는 중', this.loading());
    if (screen === 'settings') {
      const user = this.user;
      return this.shell('환경설정', `<section class="account-card"><strong>${user ? esc(user.nickname) : '비회원으로 플레이 중'}</strong><p>${user ? '온라인 커리어와 MY CLUB 기록은 계정에 저장됩니다.' : '현재 게임과 선수 기록은 이 기기에 자동 저장됩니다.'}</p>${user ? `${btn('서버 저장 기록 불러오기', 'restore-cloud', 'secondary')}${btn('로그아웃', 'logout', 'text-button')}` : btn('로그인', 'auth', 'secondary')}${this.client.error ? `<p role="alert">${esc(this.client.error.message)}</p>` : ''}</section>
        ${this.accordion('teams', 'TEAM SETTINGS', '구단 이름 변경', `<p class="helper">화면에 표시할 구단 이름을 변경합니다.</p><label class="field-label" for="custom-club">구단</label><select id="custom-club">${E.CLUBS.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select><label class="field-label" for="custom-club-name">표시 이름</label><input id="custom-club-name" maxlength="24" placeholder="구단 이름">${btn('변경 내용 저장', 'custom-club-save', 'secondary')}`)}
        ${this.accordion('colors', 'COLOR PRESET', '홈 색상 변경', `<div class="theme-options">${[['green', '그린'], ['blue', '블루'], ['burgundy', '버건디']].map(([id, name]) => btn(name, `theme:${id}`, this.ctx.getData().theme === id ? 'selected' : '')).join('')}</div>`)}

        <div class="legal-heading"><small>LEGAL</small><h2>서비스 정책</h2></div><div class="settings-policy">${btn('이용 안내', 'policy:terms', 'settings-link')}${btn('개인정보·저장 안내', 'policy:privacy', 'settings-link')}</div>
        ${this.accordion('licenses', 'OPEN SOURCE', '오픈소스 라이선스', '<p class="helper">Vite · MIT<br>animejs · MIT<br>Phosphor · MIT<br>Pretendard · SIL OFL<br>Do Hyeon · SIL OFL</p>')}${this.accordion('save', 'SAVE DATA', '저장 파일·효과음', `${btn(`${icon('download')} 전체 저장 파일 내보내기`, 'export-save', 'secondary')}${btn(`${icon('upload')} 저장 파일 불러오기`, 'import-save', 'secondary')}${btn(`${icon('speaker-high')} 효과음 ${this.ctx.getData().muted ? '꺼짐' : '켜짐'}`, 'mute', 'secondary')}`)}`, btn(icon('arrow-left'), 'nav:home', 'settings-back', 'aria-label="홈으로 이동"'), 'settings-screen');
    }
    if (screen === 'club') {
      const data = this.ctx.getData();
      let players = this.user ? this.club.players.filter(p => p.saved).map(p => p.career) : (data.archives || []).filter(c => data.savedPlayers?.includes(c.id));
      if (this.clubPosition) players = players.filter(c => c.position === this.clubPosition);
      if (this.clubSort === 'score') players.sort((a, b) => E.legacy(b) - E.legacy(a));
      if (this.clubSort === 'position') players.sort((a, b) => a.position.localeCompare(b.position));
      if (this.clubSort === 'team') players.sort((a, b) => (a.team || a.preferred).localeCompare(b.team || b.preferred));
      players = players.filter(c => this.clubScope === 'legacy' ? !this.club.players.find(p => p.career.id === c.id)?.verified : !!this.club.players.find(p => p.career.id === c.id)?.verified);
      const tabs = `<div class="source-tabs">${[['firsts', '시즌 업적'], ['players', '선수단'], ['teams', '팀']].map(([id, name]) => btn(name, `club-tab:${id}`, this.clubTab === id ? 'active' : '')).join('')}</div>`;
      let content;
      if (this.clubTab === 'players') content = `<div class="club-toolbar"><h2>시즌선수 ${players.length}명 / ${this.client.wallet?.playerSlots || 20}명</h2><div class="club-view-toggle">${btn(icon('list'), 'club-list-view', this.grid ? '' : 'active', 'aria-label="목록 보기"')}${btn(icon('squares-four'), 'club-grid-view', this.grid ? 'active' : '', 'aria-label="카드 보기"')}</div></div><div class="club-filters"><select id="club-position" aria-label="선수 포지션"><option value="">전체</option>${Object.entries(E.POSITIONS).map(([id, name]) => `<option value="${id}" ${this.clubPosition === id ? 'selected' : ''}>${name}</option>`).join('')}</select><select id="club-sort" aria-label="선수 정렬">${[['created', '저장 순서'], ['score', 'LS'], ['position', '포지션순'], ['team', '소속 구단']].map(([id, name]) => `<option value="${id}" ${this.clubSort === id ? 'selected' : ''}>${name}</option>`).join('')}</select></div><div class="${this.grid ? 'club-grid' : 'club-list'}">${players.map(c => `<article class="collection-card">${badge(c.team || c.preferred)}<div><small>${E.POSITIONS[c.position]} · PRIME ${c.peakOvr.toFixed(1)}</small><h2>${esc(c.name)}</h2><p>LS ${E.legacy(c).toLocaleString()} · ${c.proSeasons}시즌</p></div>${btn('기록 보기', `club-view:${c.id}`, 'soft-button')}${this.user ? btn(icon('x'), `club-delete:${c.id}`, 'small-delete', 'aria-label="선수 보관 해제"') : ''}</article>`).join('') || '<p class="source-empty">이 시즌에 보관된 선수가 없습니다.</p>'}</div>`;
      if (this.clubTab === 'teams') content = `${this.club.teams.map(t => `<article class="collection-card"><div><h2>${esc(t.name)}</h2><p>${t.squad.length}명 · 팀 전력 ${Math.round(t.strength)} · ELO ${t.elo}</p></div>${btn('팀 관리', `team-edit:${t.id}`, 'soft-button')}</article>`).join('') || '<p class="source-empty">보관된 팀이 없습니다.</p>'}${btn('나의 팀 만들기', 'team', 'secondary')}`;
      if (this.clubTab === 'firsts') content = `${this.club.achievements?.map(a => `<article class="achievement-row">${icon('trophy')}<div><strong>${esc(a.title)}</strong><small>${new Date(a.created).toLocaleDateString('ko-KR')}</small></div></article>`).join('') || `<p class="source-empty">${this.user ? '이번 시즌에 획득한 업적이 없습니다.' : '로그인하면 계정의 시즌 업적이 표시됩니다.'}</p>`}${btn('서버 최초 업적 보기', 'rank-type:firsts', 'secondary')}`;
      return this.shell('클럽하우스', `${tabs}${this.loading()}${content}`, `<select id="club-season" aria-label="클럽 시즌"><option value="season" ${this.clubScope === 'season' ? 'selected' : ''}>정규시즌 2026/27</option><option value="legacy" ${this.clubScope === 'legacy' ? 'selected' : ''}>레거시</option></select>`);
    }
    if (screen === 'ranking') {
      const labels = { live: '라이브 랭킹', teams: '팀 배틀 랭킹', rookies: '신인왕 후보', firsts: '서버 최초 업적' };
      const filters = ['live', 'rookies'].includes(this.rankType) ? `<div class="ranking-filters"><select id="ranking-position" aria-label="랭킹 포지션"><option value="">전체 선수</option>${Object.entries(E.POSITIONS).map(([id, name]) => `<option value="${id}" ${this.rankPosition === id ? 'selected' : ''}>${name}</option>`).join('')}</select><select id="ranking-metric" aria-label="랭킹 기록">${[['score', 'LEGACY SCORE'], ['ovr', 'OVR'], ['goals', '골'], ['assists', '도움'], ['saves', '선방'], ['cleanSheets', '클린시트'], ['rating', '평점']].map(([id, name]) => `<option value="${id}" ${this.metric === id ? 'selected' : ''}>${name}</option>`).join('')}</select></div>` : '';
      const rows = this.ranks.map(r => this.rankType === 'firsts' ? `<article class="achievement-row">${icon('trophy')}<div><strong>${esc(r.title)}</strong><small>${esc(r.nickname)} · ${new Date(r.created).toLocaleDateString('ko-KR')}</small></div></article>` : this.rankType === 'teams' ? `<div class="public-rank-row"><b>${r.rank}</b><div><strong>${esc(r.name)}</strong><small>${esc(r.nickname)} · 전력 ${Math.round(r.strength)}</small></div><strong>${r.elo}<small>ELO</small></strong></div>` : btn(`<b>${r.rank}</b>${badge(r.team)}<span><strong>${esc(r.name)}</strong><small>${esc(r.nickname)} · ${E.POSITIONS[r.position]} · ${r.seasons}시즌</small></span><em>${Number(r[this.metric]).toLocaleString()}</em>`, `public-view:${r.id}`, 'public-rank-row')).join('');
      return this.shell(labels[this.rankType], `<div class="source-tabs rank-tabs">${Object.entries(labels).map(([id, name]) => btn(name, `rank-type:${id}`, this.rankType === id ? 'active' : '')).join('')}</div>${filters}${this.loading()}<section class="rank-list">${rows || '<p class="source-empty">아직 등록된 기록이 없습니다.</p>'}</section><p class="helper">서버에서 진행한 온라인 커리어의 기록입니다.</p>`);
    }
    if (screen === 'duel' || screen === 'friend') {
      const friend = screen === 'friend';
      const listing = this.duelListing();
      const busy = this.duels.some(d => ['waiting', 'pending', 'active'].includes(d.status));
      const create = `<section class="panel"><h2>${friend ? '친구를 찾아 신청하세요' : '같은 출발선, 다른 축구 인생'}</h2><p class="muted">같은 초기 능력치 후보로 새 커리어를 시작합니다. 두 선수의 은퇴 후 LEGACY SCORE로 승부합니다.</p><label class="field-label" for="duel-position">포지션</label><select id="duel-position">${Object.entries(E.POSITIONS).map(([id, name]) => `<option value="${id}" ${this.duelPosition === id ? 'selected' : ''}>${name}</option>`).join('')}</select>${friend ? `<label class="field-label" for="friend-query">친구 닉네임</label><div class="friend-search"><input id="friend-query" value="${esc(this.friendQuery)}" minlength="2" maxlength="16" placeholder="닉네임을 입력하세요">${btn('검색', 'friend-search', 'soft-button')}</div><div class="friend-results">${this.users.map(u => btn(`${esc(u.nickname)}${this.selectedFriend === u.id ? icon('check') : ''}`, `friend-select:${u.id}`, this.selectedFriend === u.id ? 'selected' : '')).join('')}</div>` : ''}${btn(friend ? '커리어 매치 신청' : '1:1 커리어 매치 찾기', friend ? 'friend-request' : 'match-request', 'primary', busy || friend && !this.selectedFriend ? 'disabled' : '')}<p class="helper">새 매치가 시작되면 현재 커리어는 기록으로 보존됩니다.</p></section>`;
      return this.shell(friend ? '친구와 커리어매치' : '1:1 커리어 매치', `${this.loading()}${this.user ? `<div id="duel-list">${listing}</div>` + create : this.loginMessage('커리어 매치를 하려면 로그인과 닉네임 등록이 필요합니다.')}${btn('대전 상태 새로고침', 'duel-refresh', 'secondary', !this.user ? 'disabled' : '')}`);
    }
    if (screen === 'team') {
      if (!this.user) return this.shell('팀 배틀', this.loginMessage('로그인하고 MY CLUB에 선수를 보관하면 나만의 팀을 만들 수 있습니다.'));
      const players = this.club.players.filter(p => p.saved).map(p => p.career);
      return this.shell('팀 배틀', `${this.loading()}<div class="source-tabs">${[['edit', '팀 구성'], ['challenge', '도장깨기'], ['ranked', '랭킹전']].map(([mode, label]) => btn(label, `team-mode:${mode}`, this.teamMode === mode ? 'active' : '', `aria-pressed="${this.teamMode === mode}"`)).join('')}</div><label class="field-label" for="online-team-name">팀 이름</label><input id="online-team-name" maxlength="24" value="${esc(this.teamName)}"><div class="squad-count">${icon('users')} ${this.squad.length} / 11명 선택</div><p class="helper">남은 자리는 아카데미 선수로 채워집니다.</p>${players.map(p => btn(`${badge(p.team || p.preferred)}<span><strong>${esc(p.name)}</strong><small>${E.POSITIONS[p.position]} · PRIME ${p.peakOvr.toFixed(1)}</small></span>${this.squad.includes(p.id) ? icon('check') : icon('user')}`, `online-squad:${p.id}`, `squad-player ${this.squad.includes(p.id) ? 'selected' : ''}`)).join('') || '<p class="source-empty">MY CLUB에 보관한 선수가 없습니다.</p>'}${btn('나의 팀 저장', 'online-team-save', 'secondary')}<label class="field-label" for="online-team">출전 팀</label><select id="online-team">${this.club.teams.map(t => `<option value="${esc(t.id)}" ${this.teamId === t.id ? 'selected' : ''}>${esc(t.name)} · ELO ${t.elo}</option>`).join('')}</select>${btn(this.battleMode === 'ranked' ? '랭킹전 시작' : '도장깨기 시작', 'online-battle', 'primary', this.club.teams.length ? '' : 'disabled')}${this.battleResult ? `<section class="match-result"><small>FULL TIME</small><div>${this.battleResult.home}<span>:</span>${this.battleResult.away}</div><h2>${esc(this.battleResult.winner)} 승리!</h2>${this.battleResult.penalties ? `<p>승부차기 ${this.battleResult.penalties.join(' : ')}</p>` : ''}<p>ELO ${this.battleResult.eloDelta >= 0 ? '+' : ''}${this.battleResult.eloDelta}</p></section>` : ''}`);
    }
    if (screen === 'shop') {
      const defaults = [{ id: 'player-slots', name: '선수 슬롯 +12', cost: 100, text: '은퇴 선수 보관 12칸 추가' }, { id: 'team-slot', name: '팀 슬롯 +1', cost: 60, text: '나만의 팀 1개 추가' }, { id: 'slot-set', name: '선수 +12 · 팀 +1 세트', cost: 140, text: '선수 보관 12칸 · 팀 1개 추가' }, { id: 'rebirth', name: '회귀권', cost: 5, text: '은퇴 후 새로운 축구 인생 시작' }, { id: 'rename', name: '개명권', cost: 10, text: '선수 이름 변경' }];
      const wallet = `<div class="shop-header-wallet"><span>${icon('soccer-ball')} 축구 코인</span><b>${this.user ? this.client.wallet?.coins || 0 : '—'}</b>${btn('+', 'daily-reward', '', !this.user ? 'disabled aria-label="출석 보상 받기"' : 'aria-label="출석 보상 받기"')}</div>`;
      return this.shell('상점', `<p class="shop-account-note">${this.user ? '시즌 보상 5 FC · 출석 보상 20 FC' : '로그인과 가입을 완료한 뒤 이용할 수 있습니다.'}</p>${this.loading()}${defaults.map(s => `<article class="source-shop-card"><h2>${s.name}</h2><p>${s.text}</p>${btn(`${icon('soccer-ball')} ${s.cost}<small>${['rebirth', 'rename'].includes(s.id) ? '안내' : '구매'}</small>`, `online-buy:${s.id}`, 'source-buy', !this.user && !['rebirth', 'rename'].includes(s.id) ? 'disabled' : '')}</article>`).join('')}${btn('충전·사용내역', 'ledger', 'secondary ledger-button', this.user ? '' : 'disabled')}<p class="helper">FC는 게임 보상 코인입니다.</p>`, wallet, 'shop-screen');
    }
    if (screen === 'mini') {
      const m = this.mini;
      if (m.mode === 'chance') {
        const c = this.ctx.getData().current;
        return this.shell('그날의 승부', `<section class="mini-score"><small>ONE CHANCE</small><h2>${c ? esc(c.name)+'의 결정적 기회' : '한 번의 슈팅, 한 번의 승부'}</h2><p>${c ? E.POSITIONS[c.position]+' · OVR '+E.ovr(c).toFixed(1) : '기본 선수로 도전합니다.'}</p></section><div class="mini-pitch"><img src="/stadium.png" alt="축구장"><div class="mini-goal"><span>${m.stage === 'result' ? m.hits ? 'GOAL!' : 'SAVE' : '?'}</span></div></div>${m.stage === 'result' ? `<p class="centered">${esc(m.detail)}</p>${btn('다시 도전', 'mini-start:chance', 'primary')}` : `<p class="centered">중앙에 도착할 때 공을 차세요.</p><div class="chance-meter"><i></i><b></b></div>${btn('슈팅', 'chance-shoot', 'primary')}`}`);
      }
      return this.shell(m.mode === 'direction' ? '슈팅 방향 맞추기' : '그날의 승부', `<section class="mini-score"><small>${m.mode === 'direction' ? 'GOALKEEPER TRAINING' : 'ONE CHANCE'}</small><h2>${m.mode === 'direction' ? '골키퍼의 특훈' : '당신의 선수로 도전하는 승부'}</h2><p>${m.attempts} / 5회 · ${m.hits}회 성공</p></section><div class="mini-pitch"><img src="/stadium.png" alt="축구장"><div class="mini-goal"><span>${m.stage === 'ready' ? '?' : m.previous}</span></div></div><p class="centered">${esc(m.detail || '공이 향할 곳을 예상하세요.')}</p><div class="chips">${['왼쪽', '중앙', '오른쪽'].map(direction => btn(direction, `mini-choose:${direction}`, '', m.attempts >= 5 ? 'disabled' : '')).join('')}</div>${m.attempts >= 5 ? `${btn('다시 도전', `mini-start:${m.mode}`, 'primary')}<p class="helper">5번의 승부에서 ${m.hits}번 성공했습니다.</p>` : ''}`);
    }
    return null;
  }
  accordion(id, small, title, content) { const { btn } = this.ctx; return `<section class="settings-section">${btn(`<span><small>${small}</small><strong>${title}</strong></span><b>${this.accordions.has(id) ? '▲' : '▼'}</b>`, `accordion:${id}`, 'accordion-heading')}${this.accordions.has(id) ? `<div class="accordion-content">${content}</div>` : ''}</section>`; }
  renderModal(modal) {
    const { btn, esc, icon } = this.ctx;
    if (!modal) return null;
    let title, content;
    if (modal.type === 'ranking-menu' || modal.type === 'play-menu') {
      const ranking = modal.type === 'ranking-menu';
      const entries = ranking ? [['live', '라이브 랭킹'], ['teams', '팀 배틀 랭킹'], ['rookies', '신인왕 후보'], ['firsts', '서버 최초 업적']] : [['direction', '슈팅 방향 맞추기', '골문을 지키려는 유망주 골키퍼의 특훈'], ['chance', '그날의 승부', '당신의 선수로 도전하는 한 번의 슈팅']];
      return `<div class="source-sheet-backdrop"><section class="source-sheet" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">${ranking ? '랭킹' : '미니게임'}</h2>${btn(icon('x'), 'close', 'sheet-close', 'aria-label="닫기"')}</header>${entries.map(([id, name, description]) => btn(`<span><strong>${name}</strong>${description ? `<small>${description}</small>` : ''}</span><b>›</b>`, ranking ? `rank-type:${id}` : `mini-start:${id}`, 'sheet-item')).join('')}</section></div>`;
    }
    if (modal.type === 'auth') { const signup = this.authMode === 'signup'; title = signup ? '닉네임 등록 · 가입' : '로그인'; content = `${this.client.googleEnabled ? `<a class="google-login" href="/api/auth/google">Google로 로그인</a><p class="helper centered">또는 이메일로 로그인</p>` : ''}<form id="auth-form"><label class="field-label" for="auth-email">이메일</label><input id="auth-email" name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(this.authEmail)}"><label class="field-label" for="auth-password">비밀번호</label><input id="auth-password" name="password" type="password" required minlength="10" maxlength="128" autocomplete="${signup ? 'new-password' : 'current-password'}">${signup ? `<label class="field-label" for="auth-nickname">닉네임</label><input id="auth-nickname" name="nickname" required minlength="2" maxlength="16" autocomplete="nickname" value="${esc(this.authNickname)}"><label class="auth-consent"><input type="checkbox" required name="consent"> 만 14세 이상이며 계정·게임 기록의 서버 저장에 동의합니다.</label>` : ''}<p role="alert" class="auth-error">${esc(this.authError)}</p>${btn(this.pending ? '확인 중…' : signup ? '가입하고 시작하기' : '로그인', 'auth-submit', 'primary', this.pending ? 'disabled' : '')}${btn(signup ? '이미 계정이 있습니다' : '계정 만들기', 'auth-toggle', 'text-button')}</form>`; }
    if (modal.type === 'online-guard') { title = modal.kind === 'friend' ? '친구와 커리어매치' : '1:1 커리어 매치'; return `<div class="modal-backdrop guard-backdrop"><section class="modal guard-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">${title}</h2><p>${title}를 하려면 로그인과 닉네임 등록이 필요합니다.</p>${btn('닫기', 'close', 'secondary guard-close')}</section></div>`; }
    if (modal.type === 'ledger') { title = '충전·사용내역'; content = this.ledger.map(x => `<div class="ledger-row"><div><strong>${esc(x.item)}</strong><small>${new Date(x.created).toLocaleString('ko-KR')}</small></div><b>${x.delta > 0 ? '+' : ''}${x.delta} FC</b></div>`).join('') || '<p class="muted">사용 내역이 없습니다.</p>'; }
    if (modal.type === 'shop-info') { title = modal.item === 'rebirth' ? '회귀권' : '개명권'; content = `<p>${modal.item === 'rebirth' ? '은퇴한 선수를 U18로 되돌려 같은 초기 후보로 새 인생을 시작합니다. MY CLUB에 보관했거나 이미 회귀한 선수는 사용할 수 없습니다.' : '본인의 선수 이름을 바꿉니다. 기록과 능력치는 유지됩니다.'}</p>${this.user ? btn('구매', `online-buy-confirm:${modal.item}`, 'primary') : this.loginMessage()}`; }
    if (modal.type === 'club-delete') { title = 'MY CLUB 보관을 해제할까요?'; content = '<p>선수는 팀에서 제외한 뒤 보관을 해제할 수 있습니다. 커리어 진행 기록은 계정에 유지됩니다.</p>' + btn('보관 해제', `club-delete-confirm:${modal.id}`, 'primary'); }
    if (modal.type === 'rebirth') { title = 'U18로 회귀'; content = '<p>선수의 이름과 초기 능력치 후보를 이어받아 새로운 커리어를 시작합니다. 회귀권 1개를 사용합니다.</p>' + btn('회귀권 사용 · 새 인생 시작', `rebirth-confirm:${modal.id}`, 'primary'); }
    if (modal.type === 'rename') { title = '선수 개명'; content = `<label class="field-label" for="rename-player">새 이름</label><input id="rename-player" maxlength="16" required>${btn('개명권 사용', `rename-confirm:${modal.id}`, 'primary')}`; }
    if (modal.type === 'restore-cloud') { title = '서버 기록을 불러올까요?'; content = '<p>현재 기기 기록을 파일로 백업하고 계정의 서버 기록을 불러옵니다.</p>' + btn('백업하고 서버 기록 불러오기', 'restore-cloud-confirm', 'primary'); }
    if (modal.type === 'policy') { title = modal.kind === 'privacy' ? '개인정보·저장 안내' : '이용 안내'; content = modal.kind === 'privacy' ? '<p>계정 이메일과 닉네임, 비밀번호의 해시, 게임 진행·보관·대전 기록을 앱 서버에 저장합니다. 로그인 세션은 HttpOnly 쿠키를 사용합니다. 로그아웃하면 이 기기의 계정 기록을 닫고 비회원 기록으로 돌아갑니다.</p>' : '<p>이 앱의 시즌·성적·계약은 축구 커리어 시뮬레이션입니다. FC는 게임 코인이며 현금 가치가 없습니다. 유럽 구단 목록은 2025/26의 고정 참고 자료를 사용합니다.</p>'; }
    if (!title) return null;
    return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${btn(icon('x'), 'close', 'icon-button modal-close', 'aria-label="닫기"')}<h2 id="modal-title">${title}</h2>${content}</section></div>`;
  }
  async handle(value) {
    const [action, arg] = value.split(':'), c = this.ctx.getData().current, { btn } = this.ctx;
    const navigate = screen => this.open(screen), modal = value => { this.ctx.setModal(value); this.ctx.render(); };
    if (action === 'settings') { await navigate('settings'); return true; }
    if (action === 'auth') { this.authMode = 'login'; this.authError = ''; modal({ type: 'auth' }); return true; }
    if (action === 'auth-toggle') { this.authMode = this.authMode === 'login' ? 'signup' : 'login'; this.authError = ''; this.ctx.render(); return true; }
    if (action === 'auth-submit') {
      const form = document.querySelector('#auth-form'); if (!form?.reportValidity()) return true;
      const fields = Object.fromEntries(new FormData(form)); this.authEmail = fields.email; this.authNickname = fields.nickname || ''; this.pending = true;
      try { const result = await this.client.authenticate(this.authMode, fields); this.ctx.acceptServer(result, true); this.ctx.setModal(null); this.ctx.toast(`${result.user.nickname}님, 환영합니다.`); }
      catch (e) { this.authError = e.message; }
      finally { fields.password = ''; this.pending = false; this.ctx.render(); } return true;
    }
    if (action === 'logout') { await this.client.logout(); this.ctx.logout(); this.ctx.render(); return true; }
    if (action === 'restore-cloud') { modal({ type: 'restore-cloud' }); return true; }
    if (action === 'restore-cloud-confirm') { this.ctx.backup(); this.ctx.acceptServer(await this.client.restore(), false); this.ctx.setModal(null); this.ctx.render(); return true; }
    if (action === 'accordion') { this.accordions.has(arg) ? this.accordions.delete(arg) : this.accordions.add(arg); this.ctx.render(true); return true; }
    if (action === 'policy') { modal({ type: 'policy', kind: arg }); return true; }
    if (action === 'custom-club-save') { const id = document.querySelector('#custom-club').value, name = document.querySelector('#custom-club-name').value.trim(); if (!name || name.length > 24) throw new Error('구단 이름은 1~24자로 입력해 주세요.'); const d = this.ctx.getData(); d.clubNames = { ...d.clubNames, [id]: name }; this.ctx.save(); this.ctx.toast('구단 이름을 변경했습니다.'); return true; }
    if (action === 'nav') { if (arg === 'ranking' || arg === 'play') { modal({ type: arg === 'ranking' ? 'ranking-menu' : 'play-menu' }); return true; } if (arg === 'club' || arg === 'shop') { await navigate(arg); return true; } }
    if (action === 'duel' || action === 'friend' || action === 'team') { if (!this.user && action !== 'team') { modal({ type: 'online-guard', kind: action }); return true; } await navigate(action); return true; }
    if (action === 'rank-type') { this.rankType = arg; await navigate('ranking'); return true; }
    if (action === 'public-view') { const result = await this.client.request(`/careers/public?id=${encodeURIComponent(arg)}`); this.ctx.viewCareer(result.career); return true; }
    if (action === 'club-tab') { this.clubTab = arg; this.ctx.render(); return true; }
    if (action === 'club-grid-view' || action === 'club-list-view') { this.grid = action === 'club-grid-view'; this.ctx.render(); return true; }
    if (action === 'club-view') { const p = this.club.players.find(x => x.career.id === arg)?.career || this.ctx.getData().archives.find(x => x.id === arg); if (p) this.ctx.viewCareer(p); return true; }
    if (action === 'club-save') { if (!this.user) modal({ type: 'auth' }); else { await this.client.pending; await this.client.request('/club/players', 'POST', { id: arg || c?.id }); await this.refreshClub(); this.ctx.toast('MY CLUB에 보관했습니다.'); this.ctx.render(); } return true; }
    if (action === 'club-delete') { modal({ type: 'club-delete', id: arg }); return true; }
    if (action === 'club-delete-confirm') { await this.client.request(`/club/players/${encodeURIComponent(arg)}`, 'DELETE', {}); await this.refreshClub(); this.ctx.setModal(null); this.ctx.render(); return true; }
    if (action === 'rebirth' || action === 'rename') { modal(this.user ? { type: action, id: arg || c?.id } : { type: 'auth' }); return true; }
    if (action === 'rebirth-confirm') { await this.client.pending; this.ctx.acceptServer(this.client.adopt(await this.client.request('/club/rebirth', 'POST', { id: arg })), false); this.ctx.resume(); return true; }
    if (action === 'rename-confirm') { const name = document.querySelector('#rename-player').value; this.ctx.acceptServer(this.client.adopt(await this.client.request('/club/rename', 'POST', { id: arg, name })), false); this.ctx.setModal(null); this.ctx.render(); return true; }
    if (action === 'friend-search') { const query = document.querySelector('#friend-query').value; this.users = (await this.client.request(`/users?q=${encodeURIComponent(query)}`)).users; this.ctx.render(); return true; }
    if (action === 'friend-select') { this.selectedFriend = arg; this.ctx.render(); return true; }
    if (action === 'friend-request' || action === 'match-request') { this.duelPosition = document.querySelector('#duel-position').value; const result = await this.client.request('/duels', 'POST', { mode: action === 'friend-request' ? 'friend' : 'random', opponentId: this.selectedFriend, position: this.duelPosition }); if (result.data) this.ctx.acceptServer(this.client.adopt(result), false); await this.refreshDuels(); this.ctx.render(); return true; }
    if (action === 'duel-refresh') { await this.refreshDuels(); this.ctx.render(); return true; }
    if (action === 'duel-accept' || action === 'duel-decline') { const result = await this.client.request(`/duels/${arg}/respond`, 'POST', { accept: action === 'duel-accept' }); if (result.data) this.ctx.acceptServer(this.client.adopt(result), false); await this.refreshDuels(); if (action === 'duel-accept') this.ctx.resume(); else this.ctx.render(); return true; }
    if (action === 'duel-cancel') { await this.client.request(`/duels/${arg}`, 'DELETE', {}); await this.refreshDuels(); this.ctx.render(); return true; }
    if (action === 'duel-resume') { this.ctx.acceptServer(await this.client.restore(), false); this.ctx.resume(); return true; }
    if (action === 'online-squad') { this.teamName = document.querySelector('#online-team-name').value; this.squad = this.squad.includes(arg) ? this.squad.filter(x => x !== arg) : this.squad.length < 11 ? [...this.squad, arg] : this.squad; this.ctx.render(true); return true; }
    if (action === 'team-edit') { this.teamMode = 'edit'; const t = this.club.teams.find(t => t.id === arg); if (t) { this.teamId = t.id; this.teamName = t.name; this.squad = [...t.squad]; } await navigate('team'); return true; }
    if (action === 'team-mode') { this.teamMode = arg; if (arg !== 'edit') this.battleMode = arg; this.ctx.render(); return true; }
    if (action === 'online-team-save') { this.teamName = document.querySelector('#online-team-name').value; const result = await this.client.request('/teams', 'POST', { id: this.teamId || undefined, name: this.teamName, squad: this.squad }); this.teamId = result.team.id; await this.refreshClub(); this.ctx.toast('나의 팀을 저장했습니다.'); this.ctx.render(); return true; }
    if (action === 'online-battle') { const teamId = document.querySelector('#online-team').value; this.battleResult = (await this.client.request('/battles', 'POST', { teamId, mode: this.battleMode })).result; await this.refreshClub(); this.ctx.render(); return true; }
    if (action === 'online-buy') { if (['rebirth', 'rename'].includes(arg)) modal({ type: 'shop-info', item: arg }); else { this.client.wallet = (await this.client.request('/shop/buy', 'POST', { item: arg })).wallet; this.ctx.toast('슬롯을 추가했습니다.'); this.ctx.render(); } return true; }
    if (action === 'online-buy-confirm') { this.client.wallet = (await this.client.request('/shop/buy', 'POST', { item: arg })).wallet; this.ctx.setModal(null); this.ctx.toast('구매했습니다.'); this.ctx.render(); return true; }
    if (action === 'daily-reward') { this.client.wallet = (await this.client.request('/shop/reward', 'POST', {})).wallet; this.ctx.toast('출석 보상 20 FC를 받았습니다.'); this.ctx.render(); return true; }
    if (action === 'ledger') { await this.refreshShop(); modal({ type: 'ledger' }); return true; }
    if (action === 'mini-start') { this.chanceStart = performance.now(); this.mini = { mode: arg, stage: 'ready', attempts: 0, hits: 0, previous: null, detail: '' }; await navigate('mini'); return true; }
    if (action === 'chance-shoot') { const m = this.mini; if (m.mode !== 'chance' || m.stage === 'result') return true; const timing = (performance.now() - this.chanceStart) % 1800 / 1800; const marker = timing < .5 ? timing * 200 : (1-timing)*200; const c = this.ctx.getData().current; const quality = c ? E.ovr(c) : 50; m.hits = +(Math.abs(marker-50) <= 10 + quality/5); m.attempts = 1; m.stage = 'result'; m.detail = m.hits ? '골! 결정적인 기회를 살렸습니다.' : '슈팅이 막혔습니다. 다음 기회에 도전하세요.'; this.ctx.render(); return true; }
    if (action === 'mini-choose') { const m = this.mini; if (m.attempts >= 5) return true; const direction = ['왼쪽', '중앙', '오른쪽'][crypto.getRandomValues(new Uint32Array(1))[0] % 3]; const success = arg === direction; m.attempts++; m.hits += +success; m.previous = direction; m.stage = 'result'; m.detail = success ? m.mode === 'direction' ? '방향을 읽고 선방했습니다!' : '골! 결정적인 기회를 살렸습니다.' : m.mode === 'direction' ? '방향을 놓쳤습니다. 다음 공을 준비하세요.' : '슈팅이 막혔습니다. 다시 도전하세요.'; this.ctx.render(); return true; }
    return false;
  }
  async change(target) {
    if (target.id === 'club-season') this.clubScope = target.value;
    else if (target.id === 'club-position') this.clubPosition = target.value;
    else if (target.id === 'club-sort') this.clubSort = target.value;
    else if (target.id === 'ranking-position' || target.id === 'ranking-metric') { target.id === 'ranking-position' ? this.rankPosition = target.value : this.metric = target.value; await this.refreshRanks(); }
    else if (target.id === 'online-team') { this.teamId = target.value; return true; }
    else if (target.id === 'duel-position') this.duelPosition = target.value;
    else return false;
    this.ctx.render(); return true;
  }
}
