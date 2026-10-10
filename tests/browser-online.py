"""Two independent browser sessions exercising the real account and game server."""
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FOOTBALL_TEST_URL', 'http://127.0.0.1:4173')
OUT = Path(__file__).resolve().parents[1] / '.local'
OUT.mkdir(exist_ok=True)
checks = []
def record(name):
    checks.append(name)
    print('PASS:', name, flush=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    contexts = [browser.new_context(viewport={'width':390,'height':844}) for _ in range(2)]
    pages = [c.new_page() for c in contexts]
    errors = []
    for page in pages:
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.set_default_timeout(10000)
        page.goto(BASE, wait_until='networkidle')
    def click(p, action):
        if action=='nav:home' and not p.locator('[data-action="nav:home"]').count(): action='home'
        p.locator(f'[data-action="{action}"]').first.click()
    def state(p):
        return p.evaluate("JSON.parse(localStorage.getItem('second-life-football-v1'))")
    def stage(p, expected):
        p.wait_for_function("s => JSON.parse(localStorage.getItem('second-life-football-v1')).current?.stage === s", arg=expected)
        p.locator('.loading-scene').wait_for(state='hidden')
    suffix = str(time.time_ns())[-9:]
    names = ['Saka'+suffix, 'Yamal'+suffix]
    for p, name in zip(pages, names):
        click(p, 'auth'); click(p, 'auth-toggle')
        p.locator('#auth-email').fill(name+'@example.test')
        p.locator('#auth-password').fill('browser-football-123')
        p.locator('#auth-nickname').fill(name)
        p.locator('[name="consent"]').check()
        click(p, 'auth-submit')
        p.locator('#auth-form').wait_for(state='hidden')
        assert name in p.locator('.home-tools').inner_text()
    record('Independent signup, HttpOnly sessions and account home state')
    a,b=pages
    click(a, 'friend'); a.locator('#friend-query').fill(names[1])
    a.locator('#friend-query').evaluate('(el) => { window.auditSearchInput = el; el.setSelectionRange(2, 4); }')
    with a.expect_response(lambda r: '/api/duels' in r.url and r.request.method == 'GET', timeout=7000):
        pass
    a.wait_for_timeout(100)
    assert a.locator('#friend-query').input_value() == names[1]
    assert a.locator('#friend-query').evaluate('(el) => el === window.auditSearchInput && document.activeElement === el && el.selectionStart === 2 && el.selectionEnd === 4')
    click(a, 'friend-search')
    assert a.locator('#friend-query').input_value() == names[1]
    record('Friend polling preserves the input DOM, typed nickname, focus and selection')
    friend = a.locator('[data-action^="friend-select:"]').first
    friend.click(); click(a, 'friend-request')
    a.wait_for_function("document.querySelector('.duel-status-card')?.innerText.includes('신청 대기')")
    click(b, 'friend'); b.locator('[data-action^="duel-accept:"]').click(); stage(b, 'candidates')
    click(a, 'duel-refresh'); click(a, 'duel-resume'); stage(a, 'candidates')
    assert state(a)['current']['candidates'] == state(b)['current']['candidates']
    assert state(a)['current']['id'] != state(b)['current']['id']
    record('Nickname search, friend invitation/acceptance and equal starting candidates')
    # Complete both careers through the visible controls, including youth and pro.
    for p in pages:
        click(p, 'reveal'); p.wait_for_timeout(500); click(p, 'candidate-confirm')
        click(p, 'focus:0'); click(p, 'focus:2'); click(p, 'growth-confirm')
        stage(p, 'academyReady'); click(p, 'play-season'); stage(p, 'review')
        click(p, 'next-season'); stage(p, 'path')
        click(p, 'develop'); stage(p, 'review'); click(p, 'next-season')
        click(p, 'develop'); stage(p, 'review'); click(p, 'next-season')
        click(p, 'trial')
        p.wait_for_function("['offer','failed'].includes(JSON.parse(localStorage.getItem('second-life-football-v1')).current.stage)")
        p.locator('.loading-scene').wait_for(state='hidden')
        if state(p)['current']['stage']=='failed': click(p, 'semipro')
        stage(p, 'offer')
        click(p, 'offer:0'); click(p, 'signature'); click(p, 'sign'); stage(p, 'preseason')
        click(p, 'play-season'); stage(p, 'review')
        click(p, 'next-season'); stage(p, 'preseason'); click(p, 'retire'); click(p, 'retire-confirm'); stage(p, 'retired')
    record('Server-authoritative U18/U21/U23, professional contracts, seasons and retirement')
    click(a, 'home'); click(a, 'friend')
    assert '매치 완료' in a.locator('.duel-status-card').inner_text()
    assert a.locator('.duel-final').is_visible()
    a.screenshot(path=str(OUT/'screenshots/online-duel-complete.png'))
    record('Both retired careers produce a shared final score and winner')
    for p,index in zip(pages,range(2)):
        click(p,'nav:home');click(p,'continue');click(p,'club-save') if p.locator('[data-action="club-save"]').count() else p.locator('[data-action^="club-save:"]').click()
        click(p,'home');click(p,'nav:club')
        p.locator('.collection-card').first.wait_for()
        assert p.locator('.collection-card').count()==1
        assert state(p)['current']['name'] in p.locator('.collection-card').inner_text()
        click(p,'club-tab:firsts');assert p.locator('.achievement-row').count()>=1
        click(p,'nav:home');click(p,'team')
        p.locator('#online-team-name').fill('Browser FC '+str(index))
        p.locator('[data-action^="online-squad:"]').first.click();click(p,'online-team-save')
        p.wait_for_function("document.querySelector('#online-team')?.options.length === 1")
    record('Explicit MY CLUB storage, personal achievements and owned team squads')
    a.locator('#online-team-name').fill('입력 유지 FC')
    for mode in ['challenge', 'edit', 'ranked']:
        click(a,'team-mode:'+mode)
        selected = a.locator('[data-action="team-mode:'+mode+'"]')
        assert selected.get_attribute('aria-pressed') == 'true'
        assert 'active' in selected.get_attribute('class')
        assert a.locator('[data-action^="team-mode:"].active').count() == 1
        assert a.locator('#online-team-name').input_value() == '입력 유지 FC'
    assert a.locator('[data-action="online-battle"]').inner_text() == '랭킹전 시작'
    record('Team tabs match the selected mode and retain unsaved team names')
    click(a,'online-battle');a.locator('.match-result').wait_for()
    assert 'ELO' in a.locator('.match-result').inner_text()
    record('Shared ranked team battle with server-calculated result and ELO')
    click(a,'nav:shop');click(a,'online-buy:rename');click(a,'online-buy-confirm:rename')
    click(a,'nav:home');click(a,'continue');a.locator('[data-action^="rename:"]').click()
    a.locator('#rename-player').fill('새로운 사카');a.locator('[data-action^="rename-confirm:"]').click()
    a.wait_for_function("JSON.parse(localStorage.getItem('second-life-football-v1')).current.name==='새로운 사카'")
    click(a,'home');click(a,'nav:shop');click(a,'ledger');assert '개명권' in a.locator('.modal').inner_text();click(a,'close')
    click(a,'nav:ranking');click(a,'rank-type:live');a.locator('.public-rank-row').first.wait_for()
    assert '새로운 사카' in a.locator('.rank-list').inner_text()
    record('Server wallet purchase, persistent rename, ledger and shared ranking')
    a.reload(wait_until='networkidle');click(a,'continue');assert state(a)['current']['name']=='새로운 사카'
    click(a,'home');click(a,'settings');click(a,'logout')
    a.wait_for_function("JSON.parse(localStorage.getItem('second-life-football-v1')).current===null")
    click(a,'auth');a.locator('#auth-email').fill(names[0]+'@example.test');a.locator('#auth-password').fill('browser-football-123')
    click(a,'auth-submit');a.locator('#auth-form').wait_for(state='hidden');assert state(a)['current']['name']=='새로운 사카'
    record('Reload synchronization, logout isolation and login restores server career')
    assert not errors, errors
    record('No console errors or uncaught exceptions in either online browser session')
    (OUT/'browser-online-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'console_errors':errors},ensure_ascii=False,indent=2))
    browser.close()
print(f'{len(checks)} online browser checks passed.',flush=True)
