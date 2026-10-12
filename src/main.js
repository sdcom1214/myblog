import { animate, stagger } from 'animejs';
import * as E from './engine.js';
import { STORAGE_KEY, loadStore, loadGuestStore, parseSave, serializeSave, serializeCareer } from './storage.js';
import { OnlineFeatures } from './online-ui.js';
import { signaturePad, bindSignature } from './signature.js';
import { careerCardBlob, downloadBlob, imageDataURL } from './career-export.js';
import { TrainingGame } from './training-ui.js';
import { escapeHTML as esc } from './html.js';
import { browserStorage, isInAppBrowser, canShareFile, fitMobileViewport } from './browser.js';
import { RetirementSequence, endingCard } from './retirement-ui.js';
import './style.css';
import './parity.css';
import './retirement.css';

const deviceStorage = browserStorage();
const loaded = loadStore(deviceStorage);
fitMobileViewport();
// A cached account must never become a guest save when the WebView drops its
// cookies or cannot remove old storage. Restore account data only via /api/save.
let data = deviceStorage.getItem(`${STORAGE_KEY}-account`) ? loadGuestStore(deviceStorage) : loaded.data;
let screen = 'home', tab = 'season', modal = null, viewing = null, endingFace = 'front';
const defaultForm = () => ({ name: '', number: 10, foot: '오른발', position: 'FW', leagueId: 'premier', preferred: 'arsenal', academy: 'hale-end', reference: '' });
let selectedCard = 0, focus = [], growthRole = null, growthTechnique = '균형', form = defaultForm();
let duelResult = null, friend = null, squad = [], teamResult = null, busy = false;
let storageBlocked = !!loaded.error;
const app = document.querySelector('#app');
const icon = (name, cls = '') => `<img class="icon ${cls}" src="/icons/${name}.svg" alt="" aria-hidden="true">`;
const btn = (label, action, cls = '', extra = '') => `<button type="button" class="${esc(cls)}" data-action="${esc(action)}" ${extra}>${label}</button>`;
const arrow = () => icon('arrow-right');
const primary = (label, action, extra = '') => btn(`${label}${arrow()}`, action, 'primary', extra);
const money = (value) => value >= 10000 ? `${(value / 10000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}억` : `${Math.round(value).toLocaleString()}만`;
const c = () => viewing || data.current;
const allCareers = () => [data.current, ...data.archives].filter(Boolean).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i);
const validCards = () => allCareers().filter(x => x.records.length > 0);
const club = (id) => { const original = E.clubById(id); return original && { ...original, name: data.clubNames?.[id] || original.name }; };
const badge = (id, cls = '') => { const t = club(id); return t ? `<img class="club-badge ${cls}" src="/clubs/${t.id}.png" alt="${esc(t.name)}">` : icon('soccer-ball', `club-badge ${cls}`); };
const sectionTitle = (small, title, extra = '') => `<div class="section-title"><small>${small}</small><h1>${title}</h1>${extra}</div>`;
const chips = (label, values, chosen, action) => `<label class="field-label">${label}</label><div class="chips">${values.map(v => btn(esc(v), `${action}:${v}`, chosen === v ? 'selected' : '', `aria-pressed="${chosen === v}"`)).join('')}</div>`;
const stat = (label, value) => `<div class="stat"><small>${label}</small><strong>${value}</strong></div>`;
const empty = (heading, text, action = '') => `<div class="empty">${icon('soccer-ball')}<h2>${heading}</h2><p>${text}</p>${action}</div>`;
const progress = (label, value, max = 100) => `<div class="progress-row"><span>${label}</span><strong>${Number(value).toFixed(1)}</strong><div class="track"><i style="width:${E.clamp(value / max * 100, 0, 100)}%"></i></div></div>`;
const features = new OnlineFeatures({
  btn, esc, icon, badge, nav: homeNav, navigate, render, toast, save,
  getData: () => data, getScreen: () => screen, setModal: value => { modal = value; },
  deviceStorageAvailable: () => deviceStorage.persistent,
  commitLocal: commit,
  acceptServer: (result, login = false) => {
    if (login && !deviceStorage.getItem(`${STORAGE_KEY}-account`)) deviceStorage.setItem(`${STORAGE_KEY}-guest`, JSON.stringify(data));
    if (result.data) { data = result.data; storageBlocked = false; deviceStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    if (features.user) deviceStorage.setItem(`${STORAGE_KEY}-account`, features.user.id);
    viewing = null;
  },
  logout: () => { data = loadGuestStore(deviceStorage); deviceStorage.removeItem(`${STORAGE_KEY}-account`); deviceStorage.setItem(STORAGE_KEY, JSON.stringify(data)); navigate('home'); },
  backup: () => exportFile(serializeSave(data), 'football-before-cloud-restore.json'),
  resume: () => { screen = 'game'; viewing = null; tab = 'season'; modal = null; selectedCard = 0; focus = []; growthRole = null; if (data.current?.stage === 'retired') retirement.start(data.current); render(); },
  viewCareer: player => { viewing = player; screen = 'game'; tab = 'career'; modal = null; render(); },
});
const retirement = new RetirementSequence({ root:app, storage:deviceStorage, account:() => features.user?.id || 'guest', render, finish:() => { tab = 'season'; endingFace = 'front'; modal = null; render(true); } });
const trainingGame = new TrainingGame({
  root: app, career: () => data.current, render, toast, isOpen: () => modal?.type === 'training',
  submit: async input => { await changeCareer('shot', typeof input === 'number' ? { marker: input } : { input }, x => E.trainingShot(x, input)); sound(); },
});

function save() {
  if (storageBlocked) { toast('기존 저장 파일 보존을 위해 저장이 중단됐습니다. 설정에서 백업 후 새 저장을 시작해 주세요.'); return; }
  deviceStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  if (features.user) features.client.save(data).catch(error => toast(error.message));
}
function commit(career) { data.current = career; data.coins = career.coins; data.inventory = [...career.inventory]; save(); }
function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div'); el.className = 'toast'; el.role = 'status'; el.textContent = text; app.append(el);
  setTimeout(() => el.remove(), 4200);
}
function sound() {
  if (data.muted) return;
  try { const audio = new AudioContext(), osc = audio.createOscillator(), gain = audio.createGain(); osc.connect(gain); gain.connect(audio.destination); osc.frequency.value = 660; gain.gain.setValueAtTime(0.04, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.16); osc.start(); osc.stop(audio.currentTime + 0.17); osc.onended = () => audio.close(); } catch { /* Audio is optional. */ }
}

function homeNav() {
  return `<nav class="home-nav" aria-label="홈 메뉴">${[['home', 'house', '홈'], ['club', 'buildings', '클럽하우스'], ['play', 'soccer-ball', '킥오프'], ['ranking', 'chart-bar', '랭킹'], ['shop', 'storefront', '상점']].map(([a, i, label]) => btn(`${icon(i)}<span>${label}</span>`, `nav:${a}`, screen === a ? 'active' : '', screen === a ? 'aria-current="page"' : '')).join('')}</nav>`;
}
function standardHeader(title, small = 'SECOND LIFE : FOOTBALL') {
  return `<header class="standard-header">${btn(icon('arrow-left'), 'home', 'icon-button', 'aria-label="홈으로 이동"')}<div><small>${small}</small><strong>${title}</strong></div>${btn(icon('gear'), 'settings', 'icon-button', 'aria-label="환경설정"')}</header>`;
}
function home() {
  const p = data.current;
  const resumable = p && p.stage !== 'retired';
  return `<main class="home-screen"><img class="stadium-art" src="/stadium.png" alt=""><header class="home-tools">${btn(features.user ? esc(features.user.nickname) : '로그인', features.user ? 'settings' : 'auth', 'glass-button')}${btn(icon('gear'), 'settings', 'glass-button square', 'aria-label="환경설정"')}</header>
    <div class="home-logo"><img src="/logo.png" alt="이번 생은 축구다! FOOTBALL CAREER SIMULATION"></div>
    <div class="home-bottom">${p ? `<div class="life-preview">${badge(p.team || p.preferred)}<div><strong>${esc(p.name)} <span>#${p.number}</span></strong><small>${p.age}세 · ${E.POSITIONS[p.position]} · OVR ${E.ovr(p).toFixed(1)}</small></div><span class="save-dot" title="${features.user ? '계정에 자동 저장' : deviceStorage.persistent ? '이 브라우저에 자동 저장' : '앱을 닫으면 기록이 사라질 수 있습니다'}">${features.user && features.client.verified ? '온라인' : deviceStorage.persistent ? '자동 저장' : '임시 저장'}</span></div>` : ''}
      ${btn(`${p ? resumable ? '이어서 플레이' : `${esc(p.name)} 기록 보기` : '새로운 인생 시작'} ${arrow()}`, p ? 'continue' : 'new', 'home-start')}
      ${p ? btn(`새로운 인생 시작 ${arrow()}`, 'new', 'home-secondary-new') : ''}
      <div class="home-versus">${btn('1:1 커리어 매치', 'duel', 'home-secondary')}${btn('친구와 커리어 매치', 'friend', 'home-secondary')}</div>
      ${btn(`팀 배틀 : 당신의 팀을 증명하세요 ${arrow()}`, 'team', 'home-battle')}
      ${btn(`${icon('flag')}<b>공지</b><i></i><span>새로운 무대, 새로운 축구 인생</span>${arrow()}`, 'notice', 'notice-strip')}
    </div>${homeNav()}</main>`;
}

function creation() {
  return `<main class="create-screen"><div class="create-story"><img src="/stadium.png" alt="">${btn(icon('arrow-left'), 'home', 'icon-button', 'aria-label="홈으로 이동"')}<h1>이번 생은 축구다!</h1><small>SECOND LIFE : FOOTBALL</small><p>축구 보러 갔다가 날아온 공에 맞았다.<br>눈을 떠보니, 내가 유럽의 유소년 선수?<br>이번 생, 어디까지 올라갈 수 있을까?</p></div>
    <form id="player-form" class="create-form"><div class="form-heading"><div><small>CHAPTER 01</small><h2>선수 생성</h2></div>${btn('랜덤 생성', 'random', 'soft-button')}</div><p class="muted">2026/27 시즌, 18세 유망주의 도전이 시작됩니다.</p>
    <div class="input-row"><label>이름 <span id="name-count">${form.name.length}/16</span><input name="name" maxlength="16" required value="${esc(form.name)}" placeholder="이름을 입력하세요" autocomplete="off"></label><label>등번호<input name="number" type="number" min="0" max="99" required value="${form.number}"></label></div>
    ${chips('주발', ['오른발', '왼발', '양발'], form.foot, 'foot')}
    <div id="position-label" class="field-label">포지션</div><div class="position-grid" role="group" aria-labelledby="position-label">${Object.entries(E.POSITIONS).map(([key, label]) => btn(`<strong>${label}</strong><small>${key}</small>`, `position:${key}`, form.position === key ? 'selected' : '', `aria-pressed="${form.position === key}"`)).join('')}</div>
    <label class="field-label" for="league">꿈꾸는 리그</label><select id="league" name="leagueId">${E.LEAGUES.map(x => `<option value="${x.id}" ${form.leagueId === x.id ? 'selected' : ''}>${x.country} · ${x.name}</option>`).join('')}</select>
    <label class="field-label" for="preferred">희망 구단</label><select id="preferred" name="preferred">${E.clubsInLeague(form.leagueId).map(x => `<option value="${x.id}" ${form.preferred === x.id ? 'selected' : ''}>${x.name}</option>`).join('')}</select>
    <label class="field-label" for="academy">출신 유소년 아카데미</label><select id="academy" name="academy">${E.ACADEMIES.filter(x => x.leagueId === form.leagueId).map(x => `<option value="${x.id}" ${form.academy === x.id ? 'selected' : ''}>${x.name}</option>`).join('')}</select>
    <label class="field-label" for="reference-player">아카데미 출신 선수 참고</label><select id="reference-player" name="reference"><option value="">직접 입력한 이름으로 플레이</option>${E.PLAYER_REFERENCES.filter(x => x.academy === form.academy).map(x => `<option value="${esc(x.name)}" ${form.reference === x.name ? 'selected' : ''}>${esc(x.name)} · ${x.position}</option>`).join('')}</select>
    <p class="helper">참고 선수를 고르면 이름·포지션·주발이 적용됩니다. 성적과 이적은 게임에서 새로 만들어집니다.</p><button class="primary" type="submit">다음 · 능력치 후보 확인 ${arrow()}</button>
    </form></main>`;
}
function playerHeader(p) {
  const team = p.team || p.preferred;
  return `<header class="player-header">${btn(icon('house'), 'home', 'icon-button', 'aria-label="홈으로 이동"')}${badge(team)}<div class="player-header-name"><strong>${esc(p.name)}</strong><small>${E.POSITIONS[p.position]} · ${p.age}세</small></div><div class="header-ovr"><small>OVR</small><strong>${E.ovr(p).toFixed(1)}</strong></div>${btn(icon(data.muted ? 'speaker-slash' : 'speaker-high'), 'mute', 'icon-button', `aria-label="${data.muted ? '효과음 켜기' : '효과음 끄기'}"`)}</header>`;
}
function gameTabs(p) {
  const tabs = p.public ? [['player', '선수'], ['career', '커리어'], ['history', '우승 연혁']] : p.stage === 'retired' ? [['season', '선수카드'], ['history', '리그 기록실'], ['career', '커리어']] : [['season', '시즌'], ['career', '커리어'], ['player', '선수'], ['history', '우승 연혁']];
  return `<nav class="game-tabs" aria-label="선수 기록">${tabs.map(([id, name]) => btn(name, `tab:${id}`, tab === id ? 'active' : '', `aria-selected="${tab === id}"`)).join('')}</nav>`;
}
function candidateScreen(p) {
  const anyOpen = p.candidates.some(x => x.opened);
  const candidate = p.candidates[selectedCard];
  return `<div class="candidate-heading"><h1>${E.POSITIONS[p.position]} 후보 3명</h1></div><div class="candidate-grid">${p.candidates.map((x, i) => btn(`<small>0${i + 1}</small>${icon(i === 1 ? 'shield-check' : i === 2 ? 'flag' : 'soccer-ball')}<strong>${x.opened ? esc(x.type) : '?'}</strong><span>${x.opened ? '능력치 공개' : '탭하여 공개'}</span>`, `card:${i}`, `candidate ${x.opened ? 'revealed' : ''} ${selectedCard === i && x.opened ? 'selected' : ''}`, `aria-label="${i + 1}번 후보 ${x.opened ? esc(x.type) : '공개'}"`)).join('')}</div>
    ${anyOpen && candidate.opened ? `<section class="panel scout-report"><div class="panel-label"><b>SCOUT REPORT</b><small>능력치 합 ${candidate.skills.reduce((a, b) => a + b, 0).toFixed(1)}</small></div>${candidate.skills.map((val, i) => progress(E.skillNames(p)[i], val, Math.ceil(Math.max(...candidate.skills)))).join('')}</section>${primary('이 후보로 진행', 'candidate-confirm')}${p.candidates.some(x => !x.opened) ? btn('나머지 후보 모두 공개', 'reveal', 'text-button') : ''}` : `<div class="reveal-guide"><p>선수 카드를 오픈하세요</p>${btn('3개 모두 오픈', 'reveal', 'soft-button')}</div>`}`;
}
function growthScreen(p) {
  const roles = { FW: ['중앙', '왼쪽', '오른쪽'], MF: ['공격형', '중앙', '수비형'], DF: ['중앙', '왼쪽', '오른쪽'], GK: ['스위퍼', '수문장'] }[p.position];
  return `<div class="growth-heading"><h1>성장방향 결정</h1>${btn(`${icon('arrow-left')} 후보 다시 선택`, 'candidate-back', 'soft-button')}</div>
    <section class="growth-block"><h2>선호 역할 선택</h2><p class="helper">원하는 역할을 선택하세요.</p><div class="growth-choices">${roles.map(role => btn(role, `role:${role}`, (growthRole || p.role) === role ? 'selected' : '', `aria-pressed="${(growthRole || p.role) === role}"`)).join('')}</div></section>
    <section class="growth-block"><h2>플레이 스타일 선택</h2><p class="helper">선수의 장점을 살릴 스타일을 선택하세요.</p><div class="growth-choices">${(p.position === 'GK' ? ['빌드업', '반응형', '활동량', '균형'] : ['패스 중심', '개인기', '활동량', '균형']).map(type => btn(type, `technique:${type}`, growthTechnique === type ? 'selected' : '', `aria-pressed="${growthTechnique === type}"`)).join('')}</div></section>
    <div class="field-label">집중 육성 능력치 <span>최대 2개</span></div><div class="focus-grid">${E.skillNames(p).map((s, i) => btn(`<span>${s}</span><strong>${p.skills[i].toFixed(1)}</strong>${focus.includes(i) ? icon('check') : ''}`, `focus:${i}`, focus.includes(i) ? 'selected' : '', `aria-pressed="${focus.includes(i)}"`)).join('')}</div>
    <div class="info-banner">성장 총량은 같고, 배분만 달라집니다.<br><small>집중 육성한 능력치는 일반 능력치보다 3배의 성장 비중을 갖습니다.</small></div>
    ${primary('이대로 선수 생성', 'growth-confirm', focus.length ? '' : 'disabled')}`;
}
function readySchool(p) {
  return `${sectionTitle('U18 · YOUTH ACADEMY', '당신의 첫 시즌')}<div class="football-card"><img src="/stadium.png" alt=""><small>NEW FOOTBALLER</small><div class="shirt-number">${p.number}</div><h2>${esc(p.name)}</h2><p>${esc(p.school)} · ${E.POSITIONS[p.position]} · ${p.foot}</p><span>${esc(p.style)}</span></div><section class="panel"><h3>${E.leagueById(p.leagueId).country} 유소년 무대에 도전하세요</h3><p class="muted">아카데미에서의 한 시즌이 첫 프로 계약을 향한 스카우트 평가로 이어집니다.</p><div class="tournament-list">${E.leagueById(p.leagueId).youth.map((s, i) => `<div><small>${['리그', '컵', '초청'][i]}</small><strong>${s}</strong><span>출전 예정</span></div>`).join('')}</div></section>${primary('U18 아카데미 시즌 시작', 'play-season')}`;
}
function seasonReview(p) {
  const r = p.review;
  const keeper = p.position === 'GK';
  return `${sectionTitle(r.level === '프로' ? `${club(p.team).league} · PRO ${p.proSeasons}` : `${r.level} · ACADEMY`, `${r.year}/${String(r.year + 1).slice(-2)} 시즌 결과`)}<p class="muted">${esc(r.role)} · ${E.POSITIONS[p.position]} · ${r.games}경기</p>
    <div class="review-banner"><small>SEASON REVIEW</small><strong>${r.rating >= 8 ? '팬들의 기대를 뛰어넘은 시즌' : r.rating >= 7.2 ? '다음 무대의 가능성을 보여준 시즌' : '내일의 성장을 준비한 시즌'}</strong></div>
    <div class="stats-grid three">${stat('출전', r.games)}${stat(keeper ? '선방' : '골', keeper ? r.saves : r.goals)}${stat(keeper ? '클린시트' : '도움', keeper ? r.cleanSheets : r.assists)}</div>
    <div class="stats-grid three compact">${stat('평균 평점', r.rating.toFixed(1))}${stat('출전 시간', r.minutes.toLocaleString())}${stat('패스 성공률', `${r.passRate}%`)}</div>
    ${r.injury ? `<div class="injury-banner">${icon('shield-check')} ${esc(r.injury)}</div>` : ''}
    ${r.awards.length ? `<div class="award-chips">${r.awards.map(a => `<span>${icon('trophy')}${esc(a)}</span>`).join('')}</div>` : ''}
    ${r.tournaments.length ? `<section class="panel tournaments"><h3>유소년 대회 결과</h3><div class="tournament-list">${r.tournaments.map((t, i) => `<div><small>${['리그', '컵', '초청'][i]}</small><strong>${esc(t.name)}</strong><span class="${t.result === '우승' ? 'gold' : ''}">${t.result === '우승' ? icon('trophy') : ''}${esc(t.result)}</span></div>`).join('')}</div></section>` : ''}
    ${r.league ? `<section class="panel team-summary"><small>${r.tier === '육성팀' ? '1군 구단 결과' : 'TEAM RESULT'}</small><div>${badge(p.team)}<h3>${esc(r.team)}</h3><strong>${r.league.rank}위</strong></div><p class="muted">${r.league.table.find(x => x.id === p.team).wins}승 ${r.league.table.find(x => x.id === p.team).draws}무 ${r.league.table.find(x => x.id === p.team).losses}패 · ${r.league.table.find(x => x.id === p.team).points}점</p>${btn('리그 순위표 · 경기 기록', 'league', 'soft-button')}</section>` : ''}
    <div class="ovr-banner"><h3>OVR 변화</h3><span class="ovr-change">${r.oldOvr.toFixed(1)} ${icon('arrow-right')} ${r.newOvr.toFixed(1)}</span></div><section class="panel growth-panel">${E.skillNames(p).map((s, i) => `<div class="growth-row"><span>${s}</span><small>${r.before[i].toFixed(1)} →</small><strong>${r.after[i].toFixed(1)}</strong><em class="${r.after[i] < r.before[i] ? 'decline' : ''}">${r.after[i] >= r.before[i] ? '+' : ''}${E.round(r.after[i] - r.before[i]).toFixed(1)}</em></div>`).join('')}</section>
    ${r.level === 'U18' ? btn('스카우팅 리포트', 'scout-report', 'secondary') : ''}
    ${E.seasonMilestones(p).length ? btn('통산 기록 달성', 'milestone-report', 'secondary') : ''}
    <section class="panel fan-feed"><small>FAN FEED</small>${[`우리 ${esc(p.name)}, ${r.rating >= 7.4 ? '공을 잡을 때마다 기대된다!' : '다음 시즌엔 더 좋은 모습을 보여줄 거야.'}`, `${esc(r.team)}에서 차근차근 성장하는 게 보인다.`, r.injury ? '몸 잘 챙겨요. 건강하게 돌아오는 게 먼저!' : `${keeper ? '끝까지 골문을 지키는' : '끝까지 뛰어주는'} 선수, 응원합니다.`].map((s, i) => `<p><span>${['M', 'J', 'K'][i]}</span>${s}</p>`).join('')}</section>
    ${primary(p.level === '프로' ? '다음 시즌 준비' : '다음 커리어 선택', 'next-season')}`;
}
function careerPath(p) {
  const complete = p.developmentSeasons >= 4, next = p.developmentSeasons ? 'U23 리저브' : 'U21 육성';
  if (p.stage === 'failed') return `${sectionTitle('SCOUTING RESULT', '아직 끝난 게 아닙니다')}<section class="panel"><h2>입단 테스트 미합격</h2><p class="muted">구단들이 이번에는 다른 선수를 선택했습니다. 아카데미에서 기량을 더 키울 수 있습니다.</p></section>${complete ? primary('성인 무대 입단에 재도전', 'semipro') : primary(`${next} 팀에서 2년 더 성장`, 'develop')}${btn('축구 인생 마무리', 'retire', 'text-button')}`;
  return `${sectionTitle('ACADEMY · CAREER PATH', p.developmentSeasons ? '1군으로 올라갈 시간' : '아카데미 이후의 선택')}
    <section class="path-card"><div class="path-icon">${icon('soccer-ball')}</div><h2>프로 입단 테스트</h2><p>${E.leagueById(p.leagueId).name} 구단의 첫 프로 계약에 도전합니다.</p><div class="path-details"><div><small>입단 확률</small><strong>${E.trialChance(p)}%</strong></div><div><small>스카우트 평가</small><strong>${E.ovr(p) > 66 ? '유망주' : '성장 기대'}</strong></div></div>${primary('입단 테스트 참가', 'trial')}</section>
    ${!complete ? `<section class="path-card"><div class="path-icon">${icon('buildings')}</div><h2>${next} 팀에서 성장</h2><p>${esc(p.school)}에서 두 시즌을 더 뛰고, 기량을 끌어올린 뒤 프로 계약에 다시 도전합니다.</p><div class="path-details"><div><small>성장 기간</small><strong>2시즌</strong></div><div><small>평가 시점</small><strong>${p.developmentSeasons ? '23세' : '21세'}</strong></div></div>${btn(`${next} 과정 시작 →`, 'develop', 'secondary')}</section>` : ''}`;
}
function offers(p) {
  return `${sectionTitle(p.stage === 'offer' ? 'ROOKIE CONTRACT' : 'TRANSFER MARKET', p.stage === 'offer' ? '프로의 문이 열렸습니다' : '새로운 무대를 선택하세요')}<p class="muted">${p.stage === 'offer' ? '각 구단의 제안을 확인하고 첫 계약에 사인하세요.' : '계약이 만료됐습니다. 새 계약과 이적을 선택합니다.'}</p>${p.offers.map((o, i) => `<section class="offer-card">${badge(o.team)}<div><small>${club(o.team).league}${o.team === p.preferred ? ' · 꿈꾸던 구단' : ''}</small><h2>${esc(club(o.team).name)}</h2><p>${o.years}년 계약 · ${esc(o.role)}</p></div><div class="offer-money">${stat('연봉', `${money(o.salary)}원`)}${stat('계약금', `${money(o.bonus)}원`)}</div>${primary('계약서 확인', `offer:${i}`)}</section>`).join('')}${p.stage === 'market' ? btn('현역 은퇴', 'retire', 'text-button') : ''}`;
}
function preseason(p) {
  const trainable = p.trainingUsed.length < 3 && p.trainedYear !== p.year;
  return `${sectionTitle(`PRO SEASON ${p.proSeasons + 1} · OFFSEASON`, `${p.year}년 프리시즌`)}<section class="preseason-card">${badge(p.team, 'large')}<small>${club(p.team).league}</small><h2>${esc(club(p.team).name)}</h2><strong>${esc(p.name)} <span>#${p.number}</span></strong><p>${p.age}세 · ${E.POSITIONS[p.position]} · ${esc(p.style)}</p><div class="preseason-stats"><div>계약 잔여<strong>${p.contractLeft}년</strong></div><div>연봉<strong>${money(p.salary)}원</strong></div><div>컨디션<strong>${p.condition}%</strong></div></div></section>
    <div class="info-banner">${p.proSeasons === 0 ? '꿈꾸던 무대에서 첫 프로 시즌을 준비합니다.' : E.ovr(p) >= 74 ? '팀의 핵심 전력으로 기대를 모으고 있습니다.' : '꾸준한 훈련과 실전 경험이 다음 기회를 만듭니다.'}</div>
    ${btn(`${icon('lightning')}<span>${p.pendingTraining ? '특별훈련 이어하기' : '특별훈련'}<small>${p.pendingTraining ? '진행 중인 훈련을 마치세요' : p.trainedYear === p.year ? '이번 시즌 훈련 완료' : `커리어 잔여 ${3 - p.trainingUsed.length}회`}</small></span>${arrow()}`, 'training', 'training-launch', !trainable && !p.pendingTraining ? 'disabled' : '')}
    ${primary('시즌 진행', 'play-season', p.pendingTraining ? 'disabled' : '')}${btn('집중 육성 방향 변경', 'change-focus', 'secondary')}${btn('현역 은퇴', 'retire', 'text-button')}`;
}
function eventScreen() {
  return `${sectionTitle('OFFSEASON EVENT', '이번 겨울, 당신의 선택')}<section class="panel"><h2>더 높은 곳을 향해</h2><p class="muted">감독이 개인 훈련을 제안했습니다. 한편 오랜 시즌을 보낸 몸에는 휴식도 필요합니다.</p></section>${btn(`<strong>추가 훈련에 집중한다</strong><small>능력치 총합 +1 · 구단 신뢰 +8</small>`, 'event:0', 'event-choice')}${btn(`<strong>휴식과 팬 미팅을 선택한다</strong><small>컨디션 100 · 인기도 +8</small>`, 'event:1', 'event-choice')}`;
}
function legacyCard(p) {
  const t = E.totals(p), goalkeeper = p.position === 'GK';
  return `${sectionTitle('MY FOOTBALL LIFE', `${esc(p.name)}의 축구 인생`)}<div class="legacy-card"><small>${E.legacy(p) > 4000 ? 'FOOTBALL LEGEND' : E.legacy(p) > 1500 ? 'CLUB HERO' : 'MY CAREER'}</small><div class="legacy-top"><span>${p.peakOvr.toFixed(1)}<small>PRIME OVR</small></span>${icon('soccer-ball')}<span>${p.position}<small>#${p.number}</small></span></div><h2>${esc(p.name)}</h2><p>${p.team ? esc(club(p.team).name) : esc(p.school)}</p><div class="legacy-score"><small>LEGACY SCORE</small><strong>${E.legacy(p).toLocaleString()}<span>점</span></strong></div><div class="legacy-totals">${stat('경기', t.games)}${stat(goalkeeper ? '선방' : '골', goalkeeper ? t.saves : t.goals)}${stat(goalkeeper ? '클린시트' : '도움', goalkeeper ? t.cleanSheets : t.assists)}</div></div><section class="panel"><h3>마지막 휘슬, 남겨진 이야기</h3><p class="muted">${esc(p.retirementReason || '아직 당신의 축구 인생은 진행 중입니다.')}</p><p>${p.proSeasons}번의 프로 시즌. ${p.trophies.length}번의 우승.<br>그라운드에서 보낸 시간은 기록으로 남습니다.</p></section>${primary('MY CLUB에 저장', `club-save:${p.id}`)}${btn('U18로 회귀', `rebirth:${p.id}`, 'secondary')}${btn('선수 개명', `rename:${p.id}`, 'text-button')}${primary('커리어 카드 이미지 저장', 'export-career')+(p.public ? '' : btn('커리어 데이터 백업 (JSON)', 'export-career-data', 'text-button'))}${btn('새로운 인생 시작', 'new', 'secondary')}`;
}
function retiredProfile(p) {
  return `${endingCard(p, { face:endingFace, interactive:true, teamName:p.team ? club(p.team).name : p.school })}<p class="ending-flip-hint">${icon('arrows-counter-clockwise')} 카드를 눌러 ${endingFace === 'front' ? '뒷면' : '앞면'} 보기</p><div class="ending-value-strip"><div><small>프로 경력</small><strong>${p.proSeasons}시즌</strong></div><div><small>전성기 OVR</small><strong>${p.peakOvr.toFixed(1)}</strong></div></div><section class="panel retirement-summary"><small>FINAL WHISTLE</small><p class="muted">${esc(p.retirementReason || '마지막 시즌을 마치고 은퇴했습니다.')}</p></section>${btn('은퇴 연출 다시 보기', 'ending-replay', 'text-button')}${primary('전체 시즌 기록 보기', 'ending-season-records')}${primary('선수 카드 보기', 'player-card')}${primary('MY CLUB에 저장', `club-save:${p.id}`)}${btn('U18로 회귀', `rebirth:${p.id}`, 'secondary')}${btn('선수 개명', `rename:${p.id}`, 'text-button')}${primary('커리어 카드 이미지 저장', 'export-career')+(p.public ? '' : btn('커리어 데이터 백업 (JSON)', 'export-career-data', 'text-button'))}${btn('새로운 인생 시작', 'new', 'secondary')}`;
}
function careerScreen(p) {
  const t = E.totals(p), rating = t.games ? (t.rating / t.games).toFixed(2) : '–';
  const pro = p.records.filter(r => r.level === '프로');
  return `${sectionTitle('CAREER', p.stage === 'retired' ? '완성된 커리어' : '진행 중 커리어')}<div class="stats-grid three">${stat('프로 경력', `${p.proSeasons}시즌`)}${stat('거친 구단', new Set(pro.map(x => x.team)).size)}${stat('국가대표', `${p.nationalCaps}경기`)}</div><h3 class="subheading"><small>CAREER TOTALS · FIRST TEAM</small>1군 통산 핵심 기록</h3><div class="stats-grid three">${stat('경기', t.games)}${stat(p.position === 'GK' ? '선방' : '골', p.position === 'GK' ? t.saves : t.goals)}${stat(p.position === 'GK' ? '클린시트' : '도움', p.position === 'GK' ? t.cleanSheets : t.assists)}${stat('평균 평점', rating)}${stat('우승', p.trophies.length)}${stat('전성기 OVR', p.peakOvr.toFixed(1))}</div>
    <h3 class="subheading"><small>RECENT FORM</small>최근 5시즌 평점</h3><div class="form-chart">${pro.slice(-5).map(r => `<div><strong>${r.rating.toFixed(1)}</strong><i style="height:${(r.rating - 4) * 22}px"></i><small>${r.year}</small></div>`).join('') || '<p class="muted">첫 프로 시즌을 마치면 기록이 표시됩니다.</p>'}</div>
    <h3 class="subheading"><small>SEASON LOG</small>전체 시즌 기록</h3><div class="season-log">${[...p.records].reverse().map(r => `<div><span>${r.year}</span><p><strong>${esc(r.team)}</strong><small>${esc(r.tier || r.level)} · ${r.games}경기 · ${p.position === 'GK' ? `${r.saves}선방` : `${r.goals}골 ${r.assists}도움`}</small></p><b>${r.rating.toFixed(1)}</b></div>`).join('') || '<p class="muted">아직 시즌 기록이 없습니다.</p>'}</div>
    <h3 class="subheading"><small>CAREER MOMENTS</small>커리어의 순간들</h3>${p.events.map(e => `<div class="timeline"><small>${e.year}</small><strong>${esc(e.title)}</strong><p>${esc(e.description)}</p></div>`).join('') || '<p class="muted">당신의 이야기가 곧 시작됩니다.</p>'}${primary('커리어 카드 이미지 저장', 'export-career')+(p.public ? '' : btn('커리어 데이터 백업 (JSON)', 'export-career-data', 'text-button'))}`;
}
function profileScreen(p) {
  const names = E.skillNames(p), order = p.skills.map((v, i) => ({ v, i })).sort((a,b) => b.v-a.v);
  return `${sectionTitle('PLAYER', '선수 프로필')}${btn('수상·업적 보기', 'honours', 'secondary')}<section class="profile-archetype"><h2>${esc(p.style)}</h2><p>${names[order[0].i]} 능력이 돋보이는 ${E.POSITIONS[p.position]}입니다.</p><div class="profile-strength"><small>강점</small><strong>${order.slice(0,3).map(x => names[x.i]).join(' · ')}</strong></div><div class="profile-strength"><small>약점</small><strong>${names[order.at(-1).i]}</strong></div></section>
    <section class="panel profile-table source-profile"><div>${p.birthYear || p.year-p.age}년생 · ${esc(p.school)}</div><div><span>${p.height || (p.position === 'GK' ? 190 : 180)}cm / ${p.weight || 78}kg</span><span>${p.foot}</span></div><div><span>${E.POSITIONS[p.position]}</span><span>${esc(p.role)}</span></div><div class="profile-focus"><small>집중 육성</small><strong>${p.focus.map(i => names[i]).join(' · ') || '미선택'}</strong></div><div class="profile-club"><small>소속팀</small><strong>${p.team ? `${badge(p.team)} ${esc(club(p.team).name)} · ${p.proSeasons}시즌` : p.level}</strong></div><div><small>국가대표</small><strong>${p.nationalCaps ? p.nationalCaps+'경기' : '–'}</strong></div><div class="profile-relations">${progress('구단 신뢰', p.trust)}${progress('인기도', p.popularity)}${progress('컨디션', p.condition)}</div></section><p class="helper career-id">Career ID · ${esc(p.id)}</p>`;
}

function historyScreen(p) {
  return `${sectionTitle('FOOTBALL HISTORY', '우승 연혁')}<p class="muted">당신의 시뮬레이션에서 만들어진 프로 리그 결과입니다.</p><div class="history-table"><div class="table-head"><span>시즌</span><span>우승</span><span>준우승</span></div>${p.leagueHistory.map(r => `<div><strong>${r.year}<small>${esc(r.league || '')}</small></strong><span>${icon('trophy')}${esc(r.champion)}</span><span>${esc(r.runnerUp)}</span></div>`).join('') || '<p class="muted">프로 시즌을 마치면 우승팀이 기록됩니다.</p>'}</div>`;
}
function game() {
  const p = c();
  if (!p) { screen = 'home'; return home(); }
  let contents;
  if (tab === 'career') contents = careerScreen(p);
  else if (tab === 'player') contents = profileScreen(p);
  else if (tab === 'history') contents = historyScreen(p);
  else contents = ({ candidates: candidateScreen, growth: growthScreen, academyReady: readySchool, review: seasonReview, path: careerPath, failed: careerPath, offer: offers, market: offers, preseason, event: eventScreen, retired: retiredProfile }[p.stage] || readySchool)(p);
  return `<main class="game-screen">${playerHeader(p)}${gameTabs(p)}<div class="game-content">${contents}</div></main>`;
}
function clubhouse() {
  return `<main class="menu-screen">${standardHeader('클럽하우스')}<div class="menu-content">${sectionTitle('YOUR FOOTBALL STORIES', '나의 커리어 컬렉션')}<p class="muted">이 브라우저에 저장된 선수들입니다.</p>${allCareers().map(p => `<section class="collection-card">${badge(p.team || p.preferred)}<div><small>${p.stage === 'retired' ? '은퇴' : '현역'} · ${E.POSITIONS[p.position]}</small><h2>${esc(p.name)} <span>#${p.number}</span></h2><p>${p.proSeasons}시즌 · PRIME ${p.peakOvr.toFixed(1)} · ${E.legacy(p).toLocaleString()}점</p></div>${btn('기록 보기', `view:${p.id}`, 'soft-button')}</section>`).join('') || empty('첫 번째 이야기를 시작하세요', '그라운드에 남긴 모든 기록이 이곳에 모입니다.', primary('새로운 인생 시작', 'new'))}<div class="info-banner">새 인생을 시작해도 완료한 시즌이 있는 이전 커리어는 보존됩니다.</div>${primary('전체 저장 파일 내보내기', 'export-save')}</div>${homeNav()}</main>`;
}
function ranking() {
  return `<main class="menu-screen">${standardHeader('랭킹')}<div class="menu-content">${sectionTitle('LOCAL HALL OF FAME', '이 기기의 명예의 전당')}<p class="muted">저장된 커리어의 누적 성과로 계산한 로컬 랭킹입니다.</p><section class="rank-list">${validCards().sort((a, b) => E.legacy(b) - E.legacy(a)).map((p, i) => `<button type="button" data-action="view:${esc(p.id)}"><b>${i === 0 ? icon('crown') : String(i + 1).padStart(2, '0')}</b>${badge(p.team || p.preferred)}<span><strong>${esc(p.name)}</strong><small>${p.proSeasons}시즌 · ${E.POSITIONS[p.position]}</small></span><em>${E.legacy(p).toLocaleString()}<small>점</small></em></button>`).join('') || empty('아직 등록된 기록이 없습니다', '첫 시즌을 마치고 당신의 기록을 남겨보세요.', primary('새로운 인생 시작', 'new'))}</section><div class="info-banner">경기 · 골 · 도움 · 선방 · 우승 · 국가대표 경력을 합산합니다. 원본 사이트의 온라인 랭킹과 연결되지 않습니다.</div></div>${homeNav()}</main>`;
}
const shopItems = [{ id: 'boots', name: '엘리트 축구화', cost: 350, icon: 'lightning', text: '성장하는 시즌의 능력치 총합 +0.3' }, { id: 'recovery', name: '회복 프로그램', cost: 200, icon: 'shield-check', text: '현재 선수의 컨디션을 100으로 회복 · 1회 사용' }, { id: 'kit', name: '레전드 트레이닝 킷', cost: 500, icon: 't-shirt', text: '프로필 카드에 레전드 배지 표시' }];
function shop() {
  return `<main class="menu-screen">${standardHeader('상점')}<div class="menu-content">${sectionTitle('FOOTBALL CLUB SHOP', '다음 시즌을 위한 준비')}<div class="coin-wallet">${icon('coins')}<div><small>보유 코인</small><strong>${data.coins.toLocaleString()}<span>FC</span></strong></div></div><p class="muted">시즌을 플레이해 얻는 게임 코인만 사용합니다.</p>${shopItems.map(s => `<section class="shop-card"><div class="shop-art">${icon(s.icon)}</div><div><h2>${s.name}</h2><p>${s.text}</p>${btn(data.inventory.includes(s.id) ? '보유 중' : `${s.cost} FC · 구매`, `buy:${s.id}`, 'secondary', data.inventory.includes(s.id) || data.coins < s.cost || s.id === 'recovery' && !data.current ? 'disabled' : '')}</div></section>`).join('')}</div>${homeNav()}</main>`;
}
function rival() {
  let p = E.newCareer({ name: '라이벌 제이미', number: 7, foot: '오른발', position: 'FW', preferred: 'man-city', academy: 'city-academy' }, 314159);
  p = E.chooseCandidate(p, 0); p = E.setGrowth(p, [0, 2], '중앙'); p = E.playSeason(p); p = E.continueReview(p); p = E.develop(p); p = E.continueReview(p); p = E.trial(p);
  if (p.stage === 'failed') { p = E.develop(p); p = E.continueReview(p); p = E.trial(p); if (p.stage === 'failed') p = E.trial(p, true); }
  p = E.signOffer(p, 0);
  for (let i = 0; i < 5; i++) { p = E.playSeason(p); p = E.continueReview(p); if (p.stage === 'market') p = E.signOffer(p, 0); if (p.stage === 'event') p = E.chooseEvent(p, 0); }
  return p;
}
let aiRival;
function matchPage() {
  const cards = validCards(), own = cards[0];
  const opponent = screen === 'friend' ? friend : cards[1] || (aiRival ||= rival());
  return `<main class="menu-screen">${standardHeader(screen === 'friend' ? '친구와 커리어 매치' : '1:1 커리어 매치')}<div class="menu-content">${sectionTitle('CAREER MATCH', '기록으로 겨루는 한 판')}<p class="muted">전성기 능력치와 누적 커리어로 승부합니다.</p>${own ? `<div class="matchup"><div>${badge(own.team || own.preferred)}<strong>${esc(own.name)}</strong><small>PRIME ${own.peakOvr.toFixed(1)}</small></div><b>VS</b><div>${opponent ? `${badge(opponent.team || opponent.preferred)}<strong>${esc(opponent.name)}</strong><small>PRIME ${opponent.peakOvr.toFixed(1)}</small>` : `${icon('user')}<strong>친구의 선수</strong><small>카드를 불러오세요</small>`}</div></div>${screen === 'friend' ? `<div class="info-banner">친구가 내보낸 커리어 JSON 파일을 불러오세요. 파일로 비교하는 로컬 매치이며 실시간 온라인 대전은 아닙니다.</div>${btn(`${icon('upload')} 친구 카드 불러오기`, 'import-friend', 'secondary')}${btn(`${icon('download')} 내 카드 내보내기`, 'export-own', 'secondary')}` : `<p class="helper centered">${cards[1] ? '이 기기에 저장된 두 커리어의 대결' : '실제 엔진으로 생성한 가상 라이벌과의 대결'}</p>`}${primary('킥오프', 'duel-start', opponent ? '' : 'disabled')}${duelResult ? `<section class="match-result"><small>FULL TIME</small><div>${duelResult.home}<span>:</span>${duelResult.away}</div>${duelResult.penalties ? `<p>승부차기 ${duelResult.penalties.join(' : ')}</p>` : ''}<h2>${esc(duelResult.winner)} 승리!</h2><p>새 경기마다 경기 운이 달라집니다.</p></section>` : ''}` : empty('한 시즌을 먼저 마쳐주세요', '첫 커리어 카드가 만들어지면 매치에 참가할 수 있습니다.', primary('새로운 인생 시작', 'new'))}</div>${homeNav()}</main>`;
}
function teamBattle() {
  const players = validCards();
  squad = squad.filter(id => players.some(p => p.id === id));
  return `<main class="menu-screen">${standardHeader('팀 배틀')}<div class="menu-content">${sectionTitle('YOUR TEAM, YOUR LEGACY', '당신의 팀을 증명하세요')}<p class="muted">최대 11명의 저장된 선수를 고릅니다. 남은 자리는 OVR 50의 가상 아카데미 선수로 채웁니다.</p><div class="squad-count">${icon('users')} ${squad.length} / 11명 선택 <span>팀 전력 ${Math.round((squad.reduce((a, id) => a + players.find(p => p.id === id).peakOvr, 0) + (11 - squad.length) * 50) / 11)}</span></div>${players.map(p => btn(`${badge(p.team || p.preferred)}<span><strong>${esc(p.name)}</strong><small>${E.POSITIONS[p.position]} · PRIME ${p.peakOvr.toFixed(1)}</small></span>${squad.includes(p.id) ? icon('check') : icon('user')}`, `squad:${p.id}`, `squad-player ${squad.includes(p.id) ? 'selected' : ''}`, `aria-pressed="${squad.includes(p.id)}"`)).join('') || empty('선수를 육성해 컬렉션을 채우세요', '지금은 아카데미 팀으로도 도전할 수 있습니다.')}<label class="field-label" for="battle-opponent">상대 구단</label><select id="battle-opponent">${E.CLUBS.map(x => `<option value="${x.id}">${x.name} · 전력 ${x.strength}</option>`).join('')}</select>${primary('팀 배틀 시작', 'team-start')}${teamResult ? `<section class="match-result"><small>TEAM BATTLE · FULL TIME</small><div>${teamResult.home}<span>:</span>${teamResult.away}</div><h2>${esc(teamResult.winner)} 승리!</h2>${teamResult.penalties ? `<p>승부차기 ${teamResult.penalties.join(' : ')}</p>` : ''}</section>` : ''}</div>${homeNav()}</main>`;
}

function modalContent() {
  if (!modal) return '';
  const extended = features.renderModal(modal); if (extended !== null) return extended;
  const p = c(), close = btn(icon('x'), 'close', 'icon-button modal-close', 'aria-label="닫기"');
  if (modal.type === 'player-card') {
    if (p.stage === 'retired') return `<div class="modal-backdrop"><section class="modal ending-card-modal" role="dialog" aria-modal="true" aria-label="${esc(p.name)}의 최종 선수 카드">${close}${endingCard(p, { face:'back', teamName:p.team ? club(p.team).name : p.school })}${primary('통산 기록 보기', 'card-records')}</section></div>`;
    const pro = p.records.filter(r => r.level === '프로'), from = pro[0]?.year || 2026, until = pro.at(-1)?.year || from;
    return `<div class="modal-backdrop"><section class="modal prime-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${close}<div class="prime-player-card"><header>${badge(p.team || p.preferred)}<div><h2 id="modal-title">${esc(p.name)}</h2><strong>${p.team ? esc(club(p.team).name) : esc(p.school)}</strong><small>${E.POSITIONS[p.position]} · No.${p.number} · 은퇴 ${p.age}세</small></div></header><div class="prime-score"><b>LEGACY SCORE</b><strong>${E.legacy(p).toLocaleString()}점</strong></div><section class="prime-abilities"><header><b>PRIME ABILITY</b><strong>${from}–${until}</strong></header>${E.skillNames(p).map((name,i) => { const value = Math.min(100, Math.round(p.peakSkills[i] * 5)), grade = value >= 90 ? 'S' : value >= 80 ? 'A' : value >= 70 ? 'B' : value >= 60 ? 'C' : value >= 50 ? 'D' : 'E'; return `<div><span>${name}</span><strong>${value}</strong><b class="grade grade-${grade}">${grade}</b><i><em style="width:${value}%"></em></i></div>`; }).join('')}</section></div>${primary('통산 기록 보기', 'card-records')}</section></div>`;
  }
  let body = '', title = '', small = '';
  if (modal.type === 'new') { small = 'NEW LIFE'; title = '새로 시작하시겠습니까?'; body = `<p>완료한 시즌이 있는 이전 커리어는 클럽하우스에 보관합니다.</p><div class="modal-actions">${btn('취소', 'close', 'secondary')}${primary('새로운 인생 시작', 'new-confirm')}</div>`; }
  if (modal.type === 'card-export') {
    small = 'CAREER CARD'; title = '커리어 카드 이미지 저장';
    body = `<img class="career-export-preview" src="${modal.url}" alt="${esc(modal.name)}의 커리어 카드">${isInAppBrowser() ? `${primary('사진 저장 안내', 'card-save-help')}<p class="helper card-save-instructions">위 이미지를 길게 눌러 ‘사진에 저장’ 또는 ‘이미지 다운로드’를 선택하세요. 저장 메뉴가 없으면 Safari 또는 Chrome에서 열어 주세요.</p>${btn('외부 브라우저에서 열기 안내', 'browser-help', 'secondary')}` : primary('PNG 이미지 저장', 'card-png-download')}${canShareFile(modal.blob, modal.filename) ? btn('공유 · 사진에 저장', 'card-png-share', 'secondary') : ''}<p class="helper">카드는 PNG 이미지입니다. 데이터 백업은 별도 메뉴에서 내보낼 수 있습니다.</p>`;
  }
  if (modal.type === 'browser-help') {
    small = 'BROWSER'; title = 'Safari · Chrome에서 열기';
    body = `<p class="helper">인스타그램의 ⋯ 메뉴에서 ‘외부 브라우저에서 열기’를 선택하세요. 메뉴가 없으면 아래 주소를 복사해 Safari 또는 Chrome에 붙여 넣으세요.</p><label class="field-label" for="browser-page-url">게임 주소</label><input id="browser-page-url" readonly value="${esc(location.origin + location.pathname)}">${primary('게임 주소 복사', 'copy-page-url')}<p class="helper">로그인한 기록은 같은 계정으로 불러올 수 있습니다. 비회원 기록은 설정에서 저장 파일을 백업해 주세요.</p>`;
  }
  if (modal.type === 'milestones') {
    small = 'CAREER MILESTONE'; title = '통산 기록 달성';
    body = `<div class="milestone-list">${E.seasonMilestones(p).map(m => `<div>${icon('trophy')}<strong>${m.value.toLocaleString()}</strong><span>${m.label} 달성!!</span></div>`).join('')}</div>${primary('시즌 결과 보기', 'milestone-confirm')}`;
  }
  if (modal.type === 'honours') {
    const achievements = p.public ? p.achievements : E.careerAchievements(p), awards = [...new Set(p.records.flatMap(r => r.awards))];
    small = 'HONOURS & ACHIEVEMENTS'; title = '수상·업적';
    body = `<p class="muted">${achievements.filter(a => a.unlocked).length} / ${achievements.length} 업적 달성</p><div class="award-chips">${awards.map(a => `<span>${icon('trophy')}${esc(a)}</span>`).join('') || '<p>프로 시즌부터 수상에 도전할 수 있습니다.</p>'}</div><p class="helper">주요 축구상의 이름을 사용하며, 게임의 시즌 기록으로 수상자를 결정합니다.</p><div class="honours-list">${achievements.map(a => `<div class="${a.unlocked ? 'unlocked' : 'locked'}">${icon('trophy')}<span>${esc(a.title)}</span><small>${a.unlocked ? '달성' : '도전 중'}</small></div>`).join('')}</div>`;
  }
  if (modal.type === 'scout-report') {
    const r = p.review, names = E.skillNames(p), order = p.skills.map((v, i) => ({ v, i })).sort((a,b) => b.v-a.v);
    small = `${r.year} · ${r.level} SCOUT REPORT`; title = '스카우팅 리포트';
    body = `<div class="scout-player"><h3>${esc(p.name)}</h3><p class="muted">${esc(p.school)} · ${E.POSITIONS[p.position]} · ${p.height || 180}cm / ${p.weight || 78}kg</p></div><div class="scout-report-body"><section class="scout-section"><h3>선수 유형</h3><p>${esc(p.role)} 역할의 ${E.POSITIONS[p.position]}로, ${names[order[0].i]}과 ${names[order[1].i]}에서 강점을 보였습니다. ${names[order.at(-1).i]}를 더 다듬으면 플레이의 균형을 높일 수 있습니다.</p></section><section class="scout-section"><h3>이번 시즌</h3><p>${r.games}경기 · ${p.position === 'GK' ? `${r.saves}선방 · ${r.cleanSheets}클린시트` : `${r.goals}골 · ${r.assists}도움`} · 평점 ${r.rating.toFixed(1)}</p><p>OVR ${r.oldOvr.toFixed(1)} → ${r.newOvr.toFixed(1)}. ${r.newOvr > r.oldOvr ? '경기 경험이 능력 성장으로 이어졌습니다.' : '다음 시즌에는 컨디션과 출전 기회를 살펴보세요.'}</p></section><section class="scout-section"><h3>육성 전망</h3><p>${p.focus.map(i => names[i]).join(' · ')} 중심의 육성을 선택했습니다. 현재 프로 입단 평가 확률은 ${E.trialChance(p)}%이며, U21·U23에서 두 시즌씩 성장한 뒤 다시 평가받을 수 있습니다.</p><p class="helper">현재 경기 기록에 따른 평가이며 입단 결과를 보장하지 않습니다.</p></section></div>${primary('확인', 'scout-confirm')}`;
  }
  if (modal.type === 'retire') { small = 'CAREER DECISION'; title = '현역 은퇴하시겠습니까?'; body = `<p>${esc(p.name)}의 커리어를 마무리합니다. 은퇴한 선수의 시즌은 다시 진행할 수 없습니다.</p><div class="modal-actions">${btn('계속 선수 생활', 'close', 'secondary')}${primary('은퇴 확정', 'retire-confirm')}</div>`; }
  if (modal.type === 'contract') { const o = p.offers[modal.index]; small = o.rookie ? 'ROOKIE CONTRACT' : 'FA CONTRACT'; title = o.rookie ? '프로 계약서에 사인하시겠습니까?' : '새 계약서에 사인하시겠습니까?'; body = `<p>${esc(club(o.team).name)} · ${o.years}년 계약 · 연봉 ${money(o.salary)}원</p>${signaturePad(modal, esc(p.name))}<p class="helper">직접 사인하거나 이름 사인을 사용할 수 있습니다.</p><div class="signature-actions">${btn('이름 사인 사용', 'signature', 'secondary')}${btn('다시 사인', 'signature-clear', 'secondary')}</div>${primary(o.rookie ? '사인하고 프로 입단' : '사인하고 계약 체결', 'sign', modal.signed ? '' : 'disabled')}`; }
  if (modal.type === 'training-select') { small = `OFFSEASON · 잔여 ${3 - p.trainingUsed.length}회`; title = '특별훈련'; body = `<div class="info-banner">시즌당 1회 · 커리어 전체 3회<br>능력치마다 1회만 훈련할 수 있습니다.</div>${E.skillNames(p).map((s, i) => btn(`<span>${s} 강화 훈련<small>${E.TRAINING_GAMES[E.trainingMode(p.position,i)].name}</small></span><strong>${p.skills[i].toFixed(1)}</strong>`, `train-skill:${i}`, 'training-choice', p.trainingUsed.includes(i) ? 'disabled' : '')).join('')}<p class="helper">능력치별 다른 게임 · 5번의 시도 · 획득 점수 × 0.4 능력 상승</p>`; }
  if (modal.type === 'training') { small = 'SPECIAL TRAINING'; title = `${E.skillNames(p)[p.pendingTraining.skill]} 강화 훈련`; const shots = p.pendingTraining.shots; body = `<div class="training-score"><strong>특별훈련 · ${Math.min(shots.length + 1, 5)} / 5</strong><b>${shots.reduce((a, b) => a + b, 0)} / 10점</b></div><div class="shot-list">${Array.from({ length: 5 }, (_, i) => `<span class="${i === shots.length ? 'active' : ''}">${i + 1}회 <b>${shots[i] === undefined ? '—' : `${shots[i]}점`}</b></span>`).join('')}</div>${trainingGame.markup()}${shots.length === 5 ? primary('결과 보기', 'training-finish') : ''}`; }
  if (modal.type === 'training-result') { small = 'TRAINING RESULT'; title = '훈련 결과'; body = `<div class="training-bonus"><small>${E.skillNames(p)[p.lastTraining.skill]}</small><strong>+${p.lastTraining.bonus.toFixed(1)}</strong><p>${p.lastTraining.score}점 × 0.4</p></div>${primary('스토브리그로', 'close')}`; }
  if (modal.type === 'focus') { small = 'PLAYER DEVELOPMENT'; title = '집중 육성 방향 변경'; body = `<p>성장 총량은 같고, 배분만 달라집니다.</p><div class="focus-grid">${E.skillNames(p).map((s, i) => btn(`<span>${s}</span><strong>${p.skills[i].toFixed(1)}</strong>`, `focus:${i}`, focus.includes(i) ? 'selected' : '', `aria-pressed="${focus.includes(i)}"`)).join('')}</div>${primary('성장 방향 저장', 'focus-save', focus.length ? '' : 'disabled')}`; }
  if (modal.type === 'settings') { small = 'ENVIRONMENT'; title = '환경설정 · 저장 관리'; body = `<p class="helper">모든 기록은 이 브라우저에 자동 저장됩니다. 다른 기기로 옮기려면 저장 파일을 내보내 주세요.</p><label class="field-label">테마</label><div class="theme-options">${[['green', '그린'], ['blue', '블루'], ['burgundy', '버건디']].map(([id, name]) => btn(name, `theme:${id}`, data.theme === id ? 'selected' : '')).join('')}</div>${btn(`${icon(data.muted ? 'speaker-slash' : 'speaker-high')} 효과음 ${data.muted ? '꺼짐' : '켜짐'}`, 'mute', 'secondary')}${btn(`${icon('download')} 전체 저장 파일 내보내기`, 'export-save', 'secondary')}${btn(`${icon('upload')} 저장 파일 불러오기`, 'import-save', 'secondary')}${storageBlocked ? `${btn('기존 원본 데이터 백업', 'export-raw', 'secondary')}${btn('백업 후 새 저장 시작', 'reset-storage', 'secondary')}` : ''}<p class="helper">게임 코인은 현금 가치가 없습니다. 온라인 로그인 없이 플레이합니다.</p>`; }
  if (modal.type === 'import-confirm') { small = 'IMPORT SAVE'; title = '저장 파일로 교체할까요?'; body = `<p>현재 기록을 파일로 백업한 뒤, 선택한 저장 파일을 불러옵니다.</p>${btn('현재 기록 백업', 'export-save', 'secondary')}${primary('백업하고 불러오기', 'import-apply')}`; }
  if (modal.type === 'notice') { small = 'WELCOME TO THE PITCH'; title = '새로운 무대, 새로운 축구 인생'; body = `<p>유소년 선수 생성 → 후보 3장 → 집중 육성 → U18 시즌 → 프로 계약 또는 U21·U23 육성 → 프로 시즌 → 계약·이적 → 은퇴.</p><p>공격수·미드필더·수비수·골키퍼는 서로 다른 능력과 기록으로 평가됩니다.</p><p class="helper">7개 유럽 리그와 유명 아카데미에서 시작하세요. 구단 목록은 2025/26 기준이며, 이후 시즌의 성적과 이적은 시뮬레이션입니다.</p>${primary('그라운드로', 'close')}`; }
  if (modal.type === 'league') { const r = p.review; small = `${club(p.team).league} · ${r.year}/${String(r.year + 1).slice(-2)}`; title = '리그 순위표'; body = `<div class="league-table"><div class="league-row heading"><span>순위</span><b>구단</b><span>경기</span><span>득실</span><strong>승점</strong></div>${r.league.table.map((t, i) => `<div class="league-row ${t.id === p.team ? 'own' : ''}"><span>${i + 1}</span><b>${esc(t.name)}</b><span>${t.played}</span><span>${t.gf - t.ga}</span><strong>${t.points}</strong></div>`).join('')}</div><h3>우리 팀 경기 기록</h3><div class="match-log">${r.league.ownMatches.map(m => `<div><small>${m.round}R</small><span>${esc(m.opponent)}</span><b>${m.goalsFor} : ${m.goalsAgainst}</b></div>`).join('')}</div>`; }
  return `<div class="modal-backdrop"><section class="modal ${modal.type === 'scout-report' ? 'scout-report-modal' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">${close}<small>${small}</small><h2 id="modal-title">${title}</h2>${body}</section></div>`;
}

function render(preserveScroll = false) {
  const scroll = document.querySelector('.game-content, .menu-content')?.scrollTop || 0;
  const oldFocus = document.activeElement?.dataset?.action;
  app.dataset.theme = data.theme;
  const temporary = !deviceStorage.persistent;
  const notice = temporary ? `<div class="storage-notice" role="status">${features.user ? '기기 저장이 제한되어 계정에 기록을 저장합니다.' : `임시 플레이 중 · 앱을 닫으면 기록이 사라질 수 있습니다. ${btn('로그인', 'auth', 'text-button')}`}</div>` : '';
  app.innerHTML = `<div class="app-frame" data-temporary-storage="${temporary}">${notice}${features.renderScreen(screen) ?? ({ home, create: creation, game, club: clubhouse, ranking, shop, duel: matchPage, friend: matchPage, team: teamBattle, play: () => home() }[screen] || home)()}${modalContent()}${retirement.markup()}${busy ? `<div class="loading-scene" role="status"><div>${icon('soccer-ball')}<small>SEASON SIMULATION</small><h2>당신의 시즌을 만들고 있습니다</h2><p>경기 일정 · 선수 기록 · 성장 · 구단 순위</p><div class="loading-dots"><i></i><i></i><i></i></div></div></div>` : ''}</div>`;
  if (preserveScroll) document.querySelector('.game-content, .menu-content')?.scrollTo(0, scroll);
  if (modal) { document.querySelector('[role="dialog"] button:not([disabled]), [role="dialog"] input')?.focus({ preventScroll: true }); }
  else if (oldFocus && preserveScroll) [...document.querySelectorAll('[data-action]')].find(el => el.dataset.action === oldFocus)?.focus({ preventScroll: true });
  if (retirement.active) {
    const main = app.querySelector('.app-frame>main'); if (main) { main.inert = true; main.setAttribute('aria-hidden', 'true'); }
    app.querySelector('.retirement-layer')?.focus({ preventScroll:true });
  }
  retirement.afterRender();
}
function revealAnimation() {
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) animate('.candidate.revealed', { opacity: [0.2, 1], y: [12, 0], duration: 450, delay: stagger(90), ease: 'outCubic' });
}
function navigate(next) { stopMarker(); retirement.stop(); endingFace = 'front'; screen = next; modal = null; viewing = null; duelResult = null; teamResult = null; render(); }
function getForm() {
  const f = document.querySelector('#player-form'); if (!f) return;
  const values = new FormData(f); form.name = String(values.get('name')); form.number = Number(values.get('number')); form.preferred = String(values.get('preferred')); form.academy = String(values.get('academy')); form.leagueId = String(values.get('leagueId'));
}
async function changeCareer(command, args, operation) {
  const alreadyBusy = busy, previous = data.current; busy = true;
  try { await features.command(command, args, () => operation(data.current)); }
  finally { busy = alreadyBusy; }
  if (previous?.stage !== 'retired' && data.current?.stage === 'retired' && data.current.id === previous?.id) { modal = null; endingFace = 'front'; retirement.start(data.current); }
}
async function simulate(operation, command, args = {}) {
  if (busy) return; busy = true; render();
  await new Promise(r => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 1150));
  let failure;
  try { await changeCareer(command, args, operation); tab = 'season'; } catch (error) { failure = error.message; }
  busy = false;
  if (!failure && command === 'season' && data.current?.review?.level === 'U18') modal = { type: 'scout-report' };
  else if (!failure && command === 'season' && E.seasonMilestones(data.current).length) modal = { type: 'milestones' };
  render(); if (failure) toast(failure);
}
function stopMarker() { trainingGame.stop(); }
function exportFile(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function pickFile(mode) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    if (file.size > 5_000_000) { toast('파일 크기는 5MB 이하여야 합니다.'); return; }
    try {
      const parsed = parseSave(await file.text());
      if (mode === 'friend') {
        const p = parsed.type === 'career' ? parsed.value : parsed.value.current;
        if (!p?.records.length) throw new Error('완료한 시즌이 있는 친구의 커리어 카드를 선택해 주세요.');
        friend = p; render(); toast('친구의 커리어 카드를 불러왔습니다.');
      } else {
        if (parsed.type !== 'save') throw new Error('전체 저장 파일을 선택해 주세요. 커리어 카드는 친구 매치에서 사용합니다.');
        modal = { type: 'import-confirm', incoming: parsed.value }; render();
      }
    } catch (error) { toast(error.message); }
  };
  input.click();
}
function archiveCurrent() {
  const p = data.current;
  if (p?.records.length && !data.archives.some(x => x.id === p.id)) {
    if (data.archives.length >= 100) throw new Error('커리어 보관함이 가득 찼습니다. 전체 기록을 먼저 내보내 주세요.');
    data.archives.unshift(p.stage === 'retired' ? p : E.retire(p, '새로운 축구 인생을 시작하기 위해 커리어를 마무리했습니다.'));
  }
}

async function action(value) {
  if (retirement.handle(value)) return;
  if (retirement.active) return;
  if (busy) return;
  const [a, raw] = value.split(':'), i = Number(raw), p = c();
  try {
    if (trainingGame.handle(value)) return;
    if (await features.handle(value)) return;
    if (a === 'home') return navigate('home');
    if (a === 'nav') { if (raw === 'play') return data.current ? action('continue') : action('new'); return navigate(raw); }
    if (a === 'new') { if (data.current?.pendingTraining) { screen = 'game'; viewing = null; tab = 'season'; modal = { type: 'training' }; render(); toast('진행 중인 훈련을 먼저 마쳐주세요.'); return; } modal = { type: 'new' }; }
    if (a === 'new-confirm') { screen = 'create'; modal = null; viewing = null; form = defaultForm(); }
    if (a === 'continue') { screen = 'game'; viewing = null; tab = 'season'; modal = data.current?.pendingTraining ? { type: 'training' } : null; endingFace = 'front'; if (data.current?.stage === 'retired') retirement.start(data.current); }
    if (a === 'ending-card-flip') endingFace = endingFace === 'front' ? 'back' : 'front';
    if (a === 'ending-replay' && p?.stage === 'retired') retirement.start(p, true);
    if (a === 'scout-report') modal = { type: 'scout-report' };
    if (a === 'scout-confirm') modal = null;
    if (a === 'milestone-report') modal = { type: 'milestones' };
    if (a === 'milestone-confirm') modal = null;
    if (a === 'honours') modal = { type: 'honours' };
    if (a === 'player-card') modal = { type: 'player-card' };
    if (a === 'card-records' || a === 'ending-season-records') { modal = null; tab = 'career'; }
    if (a === 'close') { if (modal?.type === 'training' && data.current.pendingTraining) { stopMarker(); modal = null; } else modal = null; }
    if (a === 'browser-help') modal = { type: 'browser-help' };
    if (a === 'copy-page-url') { try { await navigator.clipboard.writeText(location.origin + location.pathname); toast('게임 주소를 복사했습니다. Safari 또는 Chrome에 붙여 넣어 주세요.'); } catch { const input = document.querySelector('#browser-page-url'); input?.focus(); input?.select(); toast('주소를 길게 눌러 복사해 주세요.'); } return; }
    if (a === 'settings' || a === 'notice') modal = { type: a };
    if (a === 'random') { const ref = E.PLAYER_REFERENCES[Math.floor(Math.random() * E.PLAYER_REFERENCES.length)]; const academy = E.academyById(ref.academy); form = { ...defaultForm(), ...ref, reference: ref.name, leagueId: academy.leagueId, preferred: academy.club }; }
    if (a === 'foot' || a === 'position') { getForm(); form[a] = raw; }
    if (a === 'card' || a === 'reveal') { await changeCareer('reveal', a === 'card' ? { index: i } : {}, x => { const n = structuredClone(x); n.candidates.forEach((candidate, index) => { if (a === 'reveal' || index === i) candidate.opened = true; }); return n; }); if (a === 'card') selectedCard = i; }
    if (a === 'candidate-confirm') { await changeCareer('choose', { index: selectedCard }, x => E.chooseCandidate(x, selectedCard)); focus = []; growthRole = null; growthTechnique = '균형'; }
    if (a === 'candidate-back') { await changeCareer('candidate-back', {}, x => { const n = structuredClone(x); n.stage = 'candidates'; return n; }); }
    if (a === 'role') growthRole = raw;
    if (a === 'technique') growthTechnique = raw;
    if (a === 'focus') { if (focus.includes(i)) focus = focus.filter(x => x !== i); else if (focus.length < 2) focus.push(i); else { toast('집중 육성은 최대 2개입니다. 먼저 하나를 해제해 주세요.'); return; } }
    if (a === 'growth-confirm') { const role = growthRole || p.role; await changeCareer('growth', { focus, role, technique: growthTechnique }, x => E.setGrowth(x, focus, role, growthTechnique)); }
    if (a === 'play-season') return simulate(E.playSeason, 'season');
    if (a === 'next-season') await changeCareer('next', {}, E.continueReview);
    if (a === 'develop') return simulate(E.develop, 'develop');
    if (a === 'trial') return simulate(E.trial, 'trial');
    if (a === 'semipro') return simulate(x => E.trial(x, true), 'trial', { retry: true });
    if (a === 'offer') modal = { type: 'contract', index: i, signed: false };
    if (a === 'signature' && modal?.type === 'contract') { modal.signed = true; modal.signatureMode = 'name'; modal.strokes = []; }
    if (a === 'signature-clear' && modal?.type === 'contract') { modal.signed = false; modal.signatureMode = 'pen'; modal.strokes = []; }
    if (a === 'sign') { if (modal?.type !== 'contract' || !modal.signed) { toast('계약서에 먼저 사인해 주세요.'); return; } const index = modal.index; await changeCareer('sign', { index }, x => E.signOffer(x, index)); modal = null; sound(); }
    if (a === 'event') await changeCareer('event', { choice: i }, x => E.chooseEvent(x, i));
    if (a === 'tab') { tab = raw; modal = null; }
    if (a === 'training') modal = { type: data.current.pendingTraining ? 'training' : 'training-select' };
    if (a === 'train-skill') { await changeCareer('train', { skill: i }, x => E.beginTraining(x, i)); modal = { type: 'training' }; }
    if (a === 'training-finish') { stopMarker(); await changeCareer('finish-training', {}, E.finishTraining); modal = { type: 'training-result' }; }
    if (a === 'change-focus') { focus = [...p.focus]; modal = { type: 'focus' }; }
    if (a === 'focus-save') { await changeCareer('focus', { focus }, x => ({ ...x, focus: [...focus] })); modal = null; }
    if (a === 'retire') modal = { type: 'retire' };
    if (a === 'retire-confirm') { await changeCareer('retire', {}, E.retire); modal = null; tab = 'season'; sound(); }
    if (a === 'league') modal = { type: 'league' };
    if (a === 'view') { viewing = raw === data.current?.id ? null : allCareers().find(x => x.id === raw); screen = 'game'; tab = 'season'; modal = null; }
    if (a === 'theme') { data.theme = raw; save(); }
    if (a === 'mute') { data.muted = !data.muted; save(); sound(); }
    if (a === 'export-save') { exportFile(serializeSave(data), 'football-save.json'); toast('전체 저장 파일을 내보냈습니다.'); return; }
    if (a === 'export-career') { const blob = await careerCardBlob(p, p.team ? club(p.team).name : p.school); modal = { type: 'card-export', blob, url: await imageDataURL(blob), filename: `football-career-${p.id}.png`, name: p.name }; render(); return; }
    if (a === 'card-save-help' && modal?.type === 'card-export') { document.querySelector('.career-export-preview')?.scrollIntoView({ block: 'center' }); toast('카드 이미지를 길게 눌러 사진에 저장하세요. 메뉴가 없으면 외부 브라우저에서 열어 주세요.'); return; }
    if (a === 'card-png-download' && modal?.type === 'card-export') { downloadBlob(modal.blob, modal.filename); toast('PNG 파일 저장을 요청했습니다. 다운로드 목록을 확인해 주세요.'); return; }
    if (a === 'card-png-share' && modal?.type === 'card-export') { try { await navigator.share({ files: [new File([modal.blob], modal.filename, { type: 'image/png' })], title: `${modal.name}의 축구 커리어` }); } catch (error) { if (error.name !== 'AbortError') toast('PNG 이미지 저장을 이용해 주세요.'); } return; }
    if (a === 'export-career-data' || a === 'export-own') { const target = a === 'export-own' ? validCards()[0] : p; exportFile(serializeCareer(target), `football-career-${target.id}.json`); toast('커리어 데이터 백업을 내보냈습니다.'); return; }
    if (a === 'export-raw') { exportFile(deviceStorage.getItem(STORAGE_KEY) || '{}', 'football-original-backup.json'); return; }
    if (a === 'reset-storage') { deviceStorage.setItem(`${STORAGE_KEY}-backup`, deviceStorage.getItem(STORAGE_KEY) || '{}'); storageBlocked = false; save(); modal = null; }
    if (a === 'import-save') return pickFile('save');
    if (a === 'import-friend') return pickFile('friend');
    if (a === 'import-apply') { exportFile(serializeSave(data), 'football-before-import.json'); data = modal.incoming; storageBlocked = false; save(); modal = null; viewing = null; screen = 'home'; }
    if (a === 'duel' || a === 'friend' || a === 'team') { navigate(a); return; }
    if (a === 'duel-start') { const cards = validCards(); const opponent = screen === 'friend' ? friend : cards[1] || (aiRival ||= rival()); if (!cards[0] || !opponent) return; duelResult = E.careerMatch(cards[0], opponent); data.matches.unshift({ ...duelResult, type: screen }); data.matches = data.matches.slice(0, 100); save(); sound(); }
    if (a === 'squad') { if (squad.includes(raw)) squad = squad.filter(x => x !== raw); else if (squad.length < 11) squad.push(raw); else { toast('선수는 최대 11명입니다.'); return; } }
    if (a === 'team-start') {
      const opponent = club(document.querySelector('#battle-opponent').value);
      const ownStrength = (squad.reduce((sum, id) => sum + validCards().find(p => p.id === id).peakOvr, 0) + (11 - squad.length) * 50) / 11;
      const dummy = { ...rival(), name: '나의 FC', peakOvr: ownStrength, records: [], trophies: [], nationalCaps: 0 };
      const opponentCard = { ...dummy, name: opponent.name, peakOvr: opponent.strength };
      teamResult = E.careerMatch(dummy, opponentCard); sound();
    }
    if (a === 'buy') {
      const item = shopItems.find(x => x.id === raw); if (!item || data.inventory.includes(item.id) || data.coins < item.cost) return;
      if (item.id === 'recovery' && (!data.current || viewing)) return;
      data.coins -= item.cost;
      if (item.id === 'recovery') data.current.condition = 100; else data.inventory.push(item.id);
      if (data.current) { data.current.coins = data.coins; data.current.inventory = [...data.inventory]; } save(); sound();
    }
    render(['card', 'reveal', 'focus', 'shoot', 'mute'].includes(a));
    if (a === 'reveal' || a === 'card') revealAnimation();
  } catch (error) { toast(error.message); }
}
app.addEventListener('click', (event) => {
  if (event.target.matches('.modal-backdrop, .source-sheet-backdrop')) { action('close'); return; }
  const target = event.target.closest('[data-action]');
  if (target && !target.disabled) action(target.dataset.action);
});
app.addEventListener('input', (event) => {
  if (screen === 'create') { getForm(); if (event.target.name === 'name' && form.name !== form.reference) { form.reference = ''; document.querySelector('#reference-player').value = ''; } const count = document.querySelector('#name-count'); if (count) count.textContent = `${form.name.length}/16`; }
});
app.addEventListener('input', event => {
  if (event.target.id === 'friend-query') features.friendQuery = event.target.value;
  if (event.target.id === 'online-team-name') features.teamName = event.target.value;
});
app.addEventListener('change', async (event) => {
  if (await features.change(event.target)) return;
  if (screen !== 'create' || event.target.tagName !== 'SELECT') return;
  const id = event.target.id, value = event.target.value;
  const scroll = document.querySelector('.create-screen').scrollTop;
  getForm();
  if (id === 'league') {
    form.leagueId = value;
    const academy = E.ACADEMIES.find(x => x.leagueId === value);
    form.academy = academy.id; form.preferred = academy.club;
  }
  if (id === 'preferred') {
    const academy = E.ACADEMIES.find(x => x.club === value);
    if (academy) form.academy = academy.id;
  }
  if (id === 'reference-player') {
    form.reference = value;
    const reference = E.PLAYER_REFERENCES.find(x => x.name === value && x.academy === form.academy);
    if (reference) Object.assign(form, reference);
  }
  if (!E.PLAYER_REFERENCES.some(x => x.name === form.reference && x.academy === form.academy)) form.reference = '';
  render();
  document.querySelector('.create-screen').scrollTop = scroll;
  document.getElementById(id)?.focus({ preventScroll: true });
});
app.addEventListener('submit', async (event) => {
  if (event.target.id === 'auth-form') { event.preventDefault(); await action('auth-submit'); return; }
  if (event.target.id !== 'player-form') return; event.preventDefault(); getForm();
  try { await changeCareer('create', { profile: form }, () => { const next = E.newCareer(form); archiveCurrent(); next.coins = data.coins; next.inventory = [...data.inventory]; return next; }); screen = 'game'; tab = 'season'; selectedCard = 0; focus = []; growthRole = null; render(); } catch (error) { toast(error.message); }
});
document.addEventListener('keydown', (event) => {
  if (retirement.active && event.key === 'Escape') { event.preventDefault(); retirement.handle(retirement.stage === 'result' ? 'ending-records' : 'ending-skip'); return; }
  if (retirement.active && event.key === 'Tab') {
    const controls = [...app.querySelectorAll('.retirement-layer button:not([disabled])')], first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first?.focus(); }
    return;
  }
  if (event.target.matches('[data-action="ending-card-flip"]') && ['Enter',' '].includes(event.key)) { event.preventDefault(); if (!event.repeat) action('ending-card-flip'); return; }
  if (modal) {
    if (event.key === 'Escape') { event.preventDefault(); action('close'); return; }
    if (event.key === 'Tab') {
      const els = [...document.querySelectorAll('[role="dialog"] button:not([disabled]), [role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea, [role="dialog"] a')];
      const first = els[0], last = els.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  if (trainingGame.keydown(event)) event.preventDefault();
});
bindSignature(app, () => modal);
render();
if (loaded.error) toast(loaded.error);
features.init();
