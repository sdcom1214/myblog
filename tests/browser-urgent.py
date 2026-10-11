"""Real mouse/touch signatures and PNG card saving, including an online account."""
import json, os, math
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE=os.environ.get('FOOTBALL_TEST_URL','http://127.0.0.1:4173')
OUT=Path(os.environ.get('FOOTBALL_EVIDENCE_DIR','docs/audit/urgent'));OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 errors=[]
 for touch in [False,True]:
  ctx=browser.new_context(viewport={'width':390,'height':844},has_touch=touch,is_mobile=touch,reduced_motion='reduce',accept_downloads=True)
  p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
  p.goto(BASE,wait_until='networkidle')
  def click(a):
   for confirm in ['scout-confirm','milestone-confirm']:
    if a!=confirm and p.locator('[data-action="'+confirm+'"]').count():p.locator('[data-action="'+confirm+'"]').click()
   old=p.evaluate("localStorage.getItem('second-life-football-v1')")
   p.locator('[data-action="'+a+'"]').first.click()
   if a in ['reveal','candidate-confirm','growth-confirm','play-season','next-season','develop','trial','semipro','sign']:
    p.wait_for_function("old=>localStorage.getItem('second-life-football-v1')!==old",arg=old)
   p.locator('.loading-scene').wait_for(state='hidden')
  def state():return p.evaluate("JSON.parse(localStorage.getItem('second-life-football-v1')).current")
  if touch:
   click('auth');click('auth-toggle');p.locator('#auth-email').fill('touch-signature@example.test');p.locator('#auth-password').fill('touch-signature-pass');p.locator('#auth-nickname').fill('터치사인');p.locator('[name="consent"]').check();click('auth-submit');p.locator('#auth-form').wait_for(state='hidden')
  click('new');click('new-confirm');p.locator('[name="name"]').fill('터치사인검증' if touch else '마우스사인검증');p.locator('#player-form button[type="submit"]').click();p.locator('.candidate-grid').wait_for()
  click('reveal');click('candidate-confirm');click('focus:0');click('focus:2');click('growth-confirm');click('play-season');click('next-season')
  for _ in range(8):
   c=state()
   if c['stage']=='offer':break
   if c['stage']=='review':click('next-season')
   elif c['developmentSeasons']<4:click('develop')
   elif c['stage']=='failed':click('semipro')
   else:click('trial')
  assert state()['stage']=='offer';click('offer:0');assert p.locator('[data-action="sign"]').is_disabled()
  click('signature');assert p.locator('[data-action="sign"]').is_enabled();click('signature-clear');assert p.locator('[data-action="sign"]').is_disabled()
  box=p.locator('#signature-pad').bounding_box();x,y=box['x']+25,box['y']+50
  if touch:
   cdp=ctx.new_cdp_session(p);cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
   for i in range(1,20):cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+i*8,'y':y+math.sin(i*.9)*20}]})
   cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  else:
   p.mouse.move(x,y);p.mouse.down()
   for i in range(1,20):p.mouse.move(x+i*8,y+math.sin(i*.9)*20)
   p.mouse.up()
  assert p.locator('#signature-pad polyline').count()>0;assert p.locator('[data-action="sign"]').is_enabled()
  p.screenshot(path=str(OUT/('signature-touch.png' if touch else 'signature-mouse.png')));click('sign');assert state()['stage']=='preseason'
  click('tab:career');before=p.url;click('export-career');p.locator('.career-export-preview').wait_for()
  assert p.url==before and '"format"' not in p.locator('body').inner_text()
  p.screenshot(path=str(OUT/('card-preview-touch.png' if touch else 'card-preview-mouse.png')))
  with p.expect_download() as d:click('card-png-download')
  assert d.value.suggested_filename.endswith('.png');d.value.save_as(OUT/('saved-card-touch.png' if touch else 'saved-card-mouse.png'))
  assert Path(d.value.path()).read_bytes().startswith(b'\x89PNG\r\n\x1a\n');click('close')
  with p.expect_download() as backup:click('export-career-data')
  assert json.loads(Path(backup.value.path()).read_text())['format']=='sfc-career'
  print('PASS', 'touch online' if touch else 'mouse guest', 'signature, PNG card and separate JSON backup',flush=True)
  ctx.close()
 assert not errors,errors
 browser.close()
print('Urgent signature and PNG export checks passed',flush=True)
