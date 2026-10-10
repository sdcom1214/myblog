"""Run with the development server on port 4173 and Python Playwright installed."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parents[1] / '.local'
OUT.mkdir(exist_ok=True)
SHOTS = OUT / 'screenshots'
SHOTS.mkdir(exist_ok=True)
checks = []
def record(name):
    checks.append(name)
    print('PASS:', name, flush=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1440,'height':1000}, accept_downloads=True)
    page = context.new_page()
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type=='error' else None)
    page.set_default_timeout(10000)
    def click(action):
        if action != 'milestone-confirm' and page.locator('[data-action="milestone-confirm"]').count(): page.locator('[data-action="milestone-confirm"]').click()
        if action != 'scout-confirm' and page.locator('[data-action="scout-confirm"]').count(): page.locator('[data-action="scout-confirm"]').click()
        page.locator(f'[data-action="{action}"]').first.click()
    def state():
        return page.evaluate("JSON.parse(localStorage.getItem('second-life-football-v1'))")
    def wait_stage(stage):
        page.wait_for_function("stage => JSON.parse(localStorage.getItem('second-life-football-v1')).current.stage === stage", arg=stage)
        page.locator('.loading-scene').wait_for(state='hidden')
    def shot(name):
        page.screenshot(path=str(SHOTS / name))
    def new_player(name, position='FW'):
        click('new'); click('new-confirm')
        page.locator('input[name="name"]').fill(name)
        page.locator('#academy').select_option('hale-end')
        if position!='FW': click('position:'+position)
        page.locator('#player-form button[type="submit"]').click()
        click('reveal')
        page.wait_for_timeout(600)
        click('candidate-confirm'); click('focus:0'); click('focus:2' if position!='GK' else 'focus:1')
        click('growth-confirm')
    page.goto(os.environ.get('FOOTBALL_TEST_URL','http://127.0.0.1:4173/'),wait_until='networkidle')
    shot('home-desktop.png')
    click('new'); click('new-confirm')
    for league,size in [('premier',20),('laliga',20),('bundesliga',18),('seriea',20),('ligue1',18),('eredivisie',18),('portugal',18)]:
        page.locator('#league').select_option(league)
        assert page.locator('#preferred option').count()==size
        assert page.locator('#academy option').count()>=4
    page.locator('#league').select_option('laliga')
    page.locator('#reference-player').select_option('라민 야말')
    assert page.locator('input[name="name"]').input_value()=='라민 야말'
    assert page.locator('#preferred').input_value()=='barcelona'
    assert page.locator('#academy').input_value()=='la-masia'
    assert page.locator('#reference-player').input_value()=='라민 야말'
    assert page.locator('[data-action="foot:왼발"]').get_attribute('aria-pressed')=='true'
    page.locator('#league').select_option('premier')
    page.locator('#reference-player').select_option('부카요 사카')
    assert page.locator('input[name="name"]').input_value()=='부카요 사카'
    record('Seven real leagues, matching clubs/academies and historical academy player references')
    page.locator('#academy').select_option('hale-end')
    shot('create-desktop.png')
    page.locator('#player-form button[type="submit"]').click()
    click('reveal'); page.wait_for_timeout(600); shot('candidates-desktop.png')
    page.set_viewport_size({'width':390,'height':844}); shot('candidates-mobile.png')
    click('candidate-confirm'); click('technique:패스 중심'); click('focus:0'); click('focus:2'); shot('growth-mobile.png'); click('growth-confirm')
    assert state()['current']['technique']=='패스 중심'
    click('play-season'); wait_stage('review')
    assert state()['current']['records'][0]['level']=='U18'
    shot('highschool-result-mobile.png'); record('Player creation, three cards, growth and U18 academy season')
    click('next-season'); wait_stage('path'); click('develop'); wait_stage('review')
    assert state()['current']['developmentSeasons']==2
    click('next-season'); click('trial')
    page.wait_for_function("['offer','failed'].includes(JSON.parse(localStorage.getItem('second-life-football-v1')).current.stage)")
    page.locator('.loading-scene').wait_for(state='hidden')
    if state()['current']['stage']=='failed':
        click('develop'); wait_stage('review'); click('next-season'); click('trial')
        page.wait_for_function("['offer','failed'].includes(JSON.parse(localStorage.getItem('second-life-football-v1')).current.stage)")
        page.locator('.loading-scene').wait_for(state='hidden')
        if state()['current']['stage']=='failed': click('semipro'); wait_stage('offer')
    click('offer:0'); shot('contract-mobile.png'); assert page.locator('[data-action="sign"]').is_disabled()
    click('signature'); click('sign'); wait_stage('preseason'); record('U21 academy checkpoint, trial and signed rookie contract')
    click('training'); click('train-skill:0'); click('training-start')
    page.wait_for_timeout(350); page.keyboard.press('Space')
    assert len(state()['current']['pendingTraining']['shots'])==1
    page.reload(wait_until='networkidle'); click('continue')
    assert len(state()['current']['pendingTraining']['shots'])==1
    for _ in range(4):
        click('training-start'); page.wait_for_timeout(220); click('shoot')
    assert len(state()['current']['pendingTraining']['shots'])==5
    shot('training-mobile.png'); click('training-finish'); click('close')
    assert state()['current']['pendingTraining'] is None
    assert page.locator('[data-action="training"]').is_disabled()
    record('Five-shot keyboard/touch training, reload recovery and per-season limit')
    click('play-season'); wait_stage('review'); shot('pro-result-mobile.png')
    click('league'); assert page.locator('.league-row').count()==21; click('close')
    click('tab:career'); shot('career-mobile.png')
    click('tab:player'); shot('player-mobile.png')
    click('tab:history'); assert page.locator('.history-table').inner_text().find('2029')>=0
    click('tab:season'); record('Professional season, 38-round league, career/profile/history tabs')
    click('next-season'); click('play-season'); wait_stage('review'); click('next-season'); wait_stage('market')
    old_team=state()['current']['team']; click('offer:1'); click('signature'); click('sign')
    assert state()['current']['team']!=old_team
    click('play-season'); wait_stage('review'); click('next-season'); wait_stage('event'); click('event:0')
    record('Contract expiry, transfer and offseason event')
    click('retire'); click('retire-confirm'); wait_stage('retired'); shot('retired-profile-mobile.png')
    click('player-card'); shot('legacy-mobile.png'); click('close')
    click('export-career'); page.locator('.career-export-preview').wait_for()
    with page.expect_download() as image_download: click('card-png-download')
    image_path=Path(image_download.value.path()); assert image_path.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
    assert image_download.value.suggested_filename.endswith('.png'); click('close')
    with page.expect_download() as download:
        click('export-career-data')
    career_file=OUT/'tested-career.json'; download.value.save_as(career_file)
    assert json.loads(career_file.read_text())['format']=='sfc-career'
    record('Retirement and portable career-card export')
    click('home'); new_player('김수문', 'GK'); click('play-season'); wait_stage('review')
    assert state()['current']['records'][0]['goals']==0
    assert state()['current']['records'][0]['saves']>0
    assert len(state()['archives'])==1
    record('Goalkeeper records and previous-career preservation')
    click('home'); click('nav:club'); assert page.locator('.collection-card').count()==0
    shot('club-empty-mobile.png'); click('nav:home'); click('continue'); click('next-season'); wait_stage('path')
    record('MY CLUB shows explicitly saved players; current career resumes from home')
    click('home'); click('duel'); assert '로그인과 닉네임 등록' in page.locator('.modal').inner_text(); click('close')
    click('friend'); assert '친구와 커리어매치' in page.locator('.modal').inner_text(); click('close')
    click('team'); assert page.locator('.account-message').is_visible()
    record('Anonymous online matching and team battle present functional login entry')
    click('nav:home'); click('nav:play'); assert page.locator('.sheet-item').count()==2
    shot('play-menu-mobile.png'); click('mini-start:direction')
    for _ in range(5): click('mini-choose:중앙')
    assert '5 / 5회' in page.locator('.mini-score').inner_text()
    click('nav:home'); click('nav:ranking'); assert page.locator('.sheet-item').count()==4
    shot('ranking-menu-mobile.png'); click('rank-type:live'); page.locator('#ranking-metric').wait_for()
    click('nav:home'); click('nav:shop'); assert page.locator('.source-shop-card').count()==5
    shot('shop-mobile.png'); record('Bottom-sheet menus, five-attempt minigame, shared ranking and source shop catalog')
    click('nav:home'); click('settings'); click('accordion:colors'); click('theme:blue'); click('accordion:save')
    with page.expect_download() as download: click('export-save')
    save_file=OUT/'tested-save.json'; download.value.save_as(save_file)
    with page.expect_file_chooser() as chooser: click('import-save')
    chooser.value.set_files(save_file)
    page.locator('[data-action="import-apply"]').wait_for()
    with page.expect_download(): click('import-apply')
    assert state()['theme']=='blue'
    page.reload(wait_until='networkidle'); assert state()['current']['name']=='김수문'
    record('Theme, full save import/export, backup and persistence after reload')
    click('settings'); click('accordion:colors'); click('theme:green'); click('nav:home')
    for width,height in [(320,568),(390,844),(430,932),(1440,1000)]:
        page.set_viewport_size({'width':width,'height':height})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        buttons=page.locator('.home-nav button').all()
        for b in buttons:
            box=b.bounding_box(); assert box['y']>=0 and box['y']+box['height']<=height+1
    page.set_viewport_size({'width':390,'height':844}); shot('home-with-save-mobile.png')
    record('320/390/430px mobile and desktop layout, visible persistent navigation')
    assert not errors, errors
    record('No browser console errors or uncaught exceptions')
    (OUT/'browser-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'console_errors':errors},ensure_ascii=False,indent=2))
    browser.close()
print(f'{len(checks)} browser checks passed.',flush=True)
