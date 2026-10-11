"""Instagram UA / restricted WebView checks against real HTTP and isolated SQLite.

This is browser-engine testing, not an installed Instagram app or iOS device test.
Chromium uses CDP finger gestures; WebKit uses taps and mouse drags/holds.
"""
import base64, json, math, os, struct
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FOOTBALL_TEST_URL', 'http://127.0.0.1:4173')
OUT = Path(os.environ.get('FOOTBALL_EVIDENCE_DIR', '.local/instagram'))
OUT.mkdir(parents=True, exist_ok=True)
IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 392.0.0.27.72'
ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 Instagram 392.0.0.27.72 Android'
checks, games, errors = [], [], []

def record(name):
    checks.append(name); print('PASS:', name, flush=True)

with sync_playwright() as pw:
    engines = [('chromium', pw.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--disable-gpu']))]
    if os.environ.get('FOOTBALL_WEBKIT') == '1': engines.append(('webkit', pw.webkit.launch()))
    for engine, browser in engines:
        for case, position, skills in [('android', 'FW', [0, 1, 2]), ('denied', 'GK', [0, 1, 2]), ('legacy' if engine == 'chromium' else 'ios', 'GK', [3, 4]), ('quota', 'FW', [3, 4])]:
            if os.environ.get('FOOTBALL_COMPAT_CASE') and case != os.environ['FOOTBALL_COMPAT_CASE']: continue
            ctx = browser.new_context(viewport={'width':390, 'height':844}, is_mobile=True, has_touch=True, user_agent=ANDROID if case in ['android', 'quota'] else IOS, reduced_motion='reduce')
            ctx.add_init_script("""(() => {
              window.compatEvents = [];
              for (const type of ['click','pointerdown','pointerup','touchstart','touchend']) document.addEventListener(type, e => { window.compatEvents.push([type,e.target.closest?.('[data-action]')?.dataset.action || e.target.id || e.target.tagName]); }, true);
              const original = HTMLCanvasElement.prototype.getContext;
              HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/i.test(type) ? null : original.call(this, type, ...args); };
              CanvasRenderingContext2D.prototype.roundRect = undefined;
              Element.prototype.setPointerCapture = () => { throw new DOMException('Unavailable', 'NotSupportedError'); };
              navigator.canShare = () => { throw new Error('WebView cannot share files'); };
            })()""")
            if case == 'denied': ctx.add_init_script("Object.defineProperty(window, 'localStorage', {get() {throw new DOMException('Blocked', 'SecurityError');}})")
            if case == 'quota': ctx.add_init_script("Storage.prototype.setItem = () => {throw new DOMException('Full', 'QuotaExceededError');}")
            if case == 'legacy': ctx.add_init_script("delete window.PointerEvent")
            p = ctx.new_page(); p.set_default_timeout(12000)
            p.on('pageerror', lambda e: errors.append(str(e)))
            p.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            p.goto(BASE + '/?ref=instagram#preview', wait_until='networkidle')
            def state():
                return p.evaluate("async () => (await (await fetch('/api/save')).json()).data.current")
            def click(action):
                for confirm in ['scout-confirm', 'milestone-confirm']:
                    if action != confirm and p.locator('[data-action="'+confirm+'"]').count(): p.locator('[data-action="'+confirm+'"]').tap()
                target = p.locator('[data-action="'+action+'"]').first
                mutates = action in ['reveal','candidate-confirm','growth-confirm','play-season','next-season','develop','trial','semipro','sign','training-finish'] or action.startswith(('train-skill:', 'event:'))
                if mutates:
                    try:
                        with p.expect_response(lambda r: '/api/career/action' in r.url and r.request.method == 'POST'): target.tap()
                    except Exception:
                        p.screenshot(path=str(OUT/'failure.png')); print('FAILED:', engine, case, action, p.locator('body').inner_text()[-1800:], errors, p.evaluate('() => window.compatEvents.slice(-15)'), flush=True); raise
                else: target.tap()
                p.locator('.loading-scene').wait_for(state='hidden')
            def drag(target, hold=False):
                b = p.locator(target).bounding_box(); x, y = b['x'] + b['width']/2, b['y'] + b['height']/2
                if engine == 'chromium':
                    cdp = ctx.new_cdp_session(p)
                    cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
                    if hold: p.wait_for_timeout(650)
                    else:
                        for i in range(1,18): cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x+i*5,'y':y+math.sin(i*.9)*18}]})
                    cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]}); cdp.detach()
                else:
                    p.mouse.move(x,y); p.mouse.down()
                    if hold: p.wait_for_timeout(650)
                    else:
                        for i in range(1,18): p.mouse.move(x+i*5,y+math.sin(i*.9)*18)
                    p.mouse.up()
                # Chromium suppresses an immediate synthetic tap after a drag,
                # also reproducible in a plain SVG/button page without this app.
                p.wait_for_timeout(450)
            if case == 'denied': assert p.locator('.storage-notice').count() == 1
            click('auth'); click('auth-toggle')
            p.locator('#auth-email').fill(engine+'-'+case+'@example.test')
            p.locator('#auth-password').fill('instagram-browser-password')
            p.locator('#auth-nickname').fill(engine+case)
            p.locator('[name="consent"]').check(); click('auth-submit'); p.locator('#auth-form').wait_for(state='hidden')
            click('new'); click('new-confirm'); p.locator('[name="name"]').fill('인스타'+case); click('position:'+position)
            with p.expect_response(lambda r: '/api/career/action' in r.url and r.request.method == 'POST'): p.locator('#player-form button[type="submit"]').tap()
            p.locator('.candidate-grid').wait_for(); click('reveal'); click('candidate-confirm'); click('focus:0'); click('focus:1' if position=='GK' else 'focus:2'); click('growth-confirm'); click('play-season'); click('next-season')
            for _ in range(14):
                career = state()
                if career['stage'] == 'offer': break
                if career['stage'] == 'review': click('next-season')
                elif career['developmentSeasons'] < 4: click('develop')
                elif career['stage'] == 'failed': click('semipro')
                else: click('trial')
            assert state()['stage'] == 'offer'; click('offer:0'); assert p.locator('[data-action="sign"]').is_disabled()
            drag('#signature-pad'); p.locator('[data-action="sign"]').wait_for()
            assert p.locator('[data-action="sign"]').is_enabled(); click('sign'); assert state()['stage'] == 'preseason'
            record(engine+' '+case+': signup, youth career and freehand contract with unavailable pointer capture')
            for skill in skills:
                career = state()
                if career['stage'] == 'review': click('next-season')
                if state()['stage'] == 'market': click('offer:0'); click('signature'); click('sign')
                if state()['stage'] == 'event': click('event:0')
                click('training'); click('train-skill:'+str(skill)); saved = state()['pendingTraining']; mode = saved['mode']
                if case == 'denied' and skill == 0:
                    p.reload(wait_until='networkidle'); click('continue'); assert state()['pendingTraining'] == saved
                    click('training-start')
                    p.evaluate("() => {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}")
                    p.evaluate("() => {Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));}")
                    assert state()['pendingTraining']['shots'] == []; assert p.locator('[data-action="training-start"]').count() == 1
                for attempt in range(5):
                    click('training-start')
                    if mode == 'finish': p.locator('.goal-target').tap()
                    elif mode == 'passing': p.locator('.training-lanes button').filter(has_text='열린 동료').tap()
                    elif mode == 'position':
                        lane = p.locator('.training-pitch>small').inner_text().split(':')[1].strip(); click('training-lane:'+str(['왼쪽','중앙','오른쪽'].index(lane)))
                    elif mode == 'dribble':
                        for step in p.locator('.training-slalom>div:first-child>span').all_inner_texts(): click('training-step:'+('left' if step.startswith('←') else 'right'))
                    elif mode == 'reflex': p.wait_for_function("() => document.querySelector('.training-reaction')?.classList.contains('ready')"); click('shoot')
                    elif mode in ['tackle','catch']:
                        axis = 'top' if mode == 'catch' else 'left'
                        p.wait_for_function("axis => {const e=document.querySelector('#training-mover');return e && parseFloat(e.style[axis])>=65 && parseFloat(e.style[axis])<=76}", arg=axis); click('shoot')
                    elif mode == 'kicking': drag('[data-action="training-hold"]', hold=True)
                    elif mode == 'sprint':
                        for _ in range(10): click('training-tap')
                    p.wait_for_function("n => [...document.querySelectorAll('.shot-list b')].filter(e => e.textContent !== '—').length === n+1", arg=attempt)
                finished = state()['pendingTraining']; assert finished['rounds'] == saved['rounds']
                click('training-finish'); result = state(); assert result['lastTraining']['score'] == sum(finished['shots']), {'engine':engine,'case':case,'mode':mode,'finished':finished,'result':result['lastTraining'],'pending':result['pendingTraining']}; click('close')
                games.append({'engine':engine,'case':case,'position':position,'skill':skill,'mode':mode,'scores':finished['shots']})
                print('PASS:', engine, case, mode, finished['shots'], flush=True); click('play-season')
            before = state(); p.reload(wait_until='networkidle'); click('continue'); assert state()['id'] == before['id']; assert state()['records'] == before['records']
            if case in ['denied', 'quota']:
                assert '계정' in p.locator('.storage-notice').inner_text()
                assert p.locator('.app-frame').bounding_box()['height'] <= 844
                if case == 'denied': p.screenshot(path=str(OUT/(engine+'-denied-restored.png')))
            click('tab:career'); url = p.url; click('export-career'); image = p.locator('.career-export-preview'); image.wait_for()
            p.wait_for_function("() => document.querySelector('.career-export-preview')?.naturalWidth === 780")
            data = base64.b64decode(image.get_attribute('src').split(',',1)[1])
            assert data.startswith(b'\x89PNG\r\n\x1a\n'); assert struct.unpack('>II', data[16:24]) == (780,1180)
            assert p.locator('[data-action="card-png-download"]').count() == 0
            if case in ['android','denied']: p.screenshot(path=str(OUT/(engine+'-'+case+'-card.png')))
            click('card-save-help'); assert p.url == url and '"format"' not in p.locator('body').inner_text()
            click('browser-help'); assert p.locator('#browser-page-url').input_value() == BASE+'/'
            p.set_viewport_size({'width':390,'height':530}); p.wait_for_timeout(100)
            assert p.locator('.app-frame').bounding_box()['height'] <= 530
            assert p.locator('[data-action="copy-page-url"]').is_visible()
            record(engine+' '+case+': all skill attempts, server restoration, PNG-only preview and resized viewport')
            if case == 'android':
                click('close'); click('home'); click('settings')
                p.evaluate("() => {Storage.prototype.setItem = Storage.prototype.removeItem = () => {throw new DOMException('Full','QuotaExceededError');};}")
                click('logout'); p.reload(wait_until='networkidle')
                assert p.locator('.life-preview').count() == 0
                assert p.locator('.home-tools').inner_text().startswith('로그인')
                record(engine+': logout with unwritable device storage keeps the cached account out of guest play after reload')
            ctx.close()
        # Exercise a WebView that refuses to retain cookies, and the Google UI
        # policy without sending credentials to an external OAuth provider.
        ctx = browser.new_context(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True, user_agent=IOS)
        def session_policy(route):
            route.fulfill(status=200, content_type='application/json', body=json.dumps({'user':None,'googleEnabled':True}))
        ctx.route('**/api/auth/session', session_policy)
        p = ctx.new_page(); p.on('pageerror', lambda e: errors.append(str(e))); p.goto(BASE, wait_until='networkidle')
        p.locator('[data-action="auth"]').tap(); assert p.locator('a[href="/api/auth/google"]').count() == 0
        assert 'Safari' in p.locator('[role="dialog"]').inner_text()
        p.locator('[data-action="auth-toggle"]').tap(); p.locator('#auth-email').fill(engine+'-cookie@example.test'); p.locator('#auth-password').fill('instagram-cookie-password'); p.locator('#auth-nickname').fill(engine+'cookie'); p.locator('[name="consent"]').check(); p.locator('[data-action="auth-submit"]').tap()
        p.wait_for_function("() => document.querySelector('.auth-error')?.textContent.includes('쿠키')")
        assert p.locator('#auth-form').count() == 1
        record(engine+': rejected session cookie has actionable error; embedded Google login offers external-browser guidance')
        ctx.close(); browser.close()
    if not os.environ.get('FOOTBALL_COMPAT_CASE'): assert {g['mode'] for g in games if g['engine']=='chromium'} == {'finish','passing','dribble','tackle','sprint','reflex','position','catch','kicking'}
    assert not errors, errors
(OUT/'results.json').write_text(json.dumps({'checks':checks,'games':games,'consoleErrors':errors,'realInstagramDeviceTest':False}, ensure_ascii=False, indent=2))
print('Instagram browser compatibility checks passed:', len(checks), 'flows,', len(games), 'skill mappings', flush=True)
