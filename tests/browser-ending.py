"""Play to natural retirement, then verify original-inspired ending interactions.
No save edits, engine calls or fabricated API responses.
"""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE=os.environ.get('FOOTBALL_TEST_URL','http://127.0.0.1:4173')
OUT=Path(os.environ.get('FOOTBALL_EVIDENCE_DIR','.local/ending'));OUT.mkdir(parents=True,exist_ok=True)
results=[];errors=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for position,online in [('FW',False),('GK',True)]:
  ctx=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce',has_touch=True,is_mobile=True,accept_downloads=True)
  p=ctx.new_page();p.set_default_timeout(12000)
  p.on('pageerror',lambda e:errors.append(str(e)));p.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
  p.goto(BASE,wait_until='networkidle')
  def state():return p.evaluate("() => JSON.parse(localStorage.getItem('second-life-football-v1')).current")
  def click(action):
   for confirm in ['scout-confirm','milestone-confirm']:
    if action!=confirm and p.locator('[data-action="'+confirm+'"]').count():p.locator('[data-action="'+confirm+'"]').click()
   old=p.evaluate("() => localStorage.getItem('second-life-football-v1')")
   p.locator('[data-action="'+action+'"]').first.click()
   if action in ['reveal','candidate-confirm','growth-confirm','play-season','next-season','develop','trial','semipro','sign'] or action.startswith('event:'):
    p.wait_for_function("old => localStorage.getItem('second-life-football-v1') !== old",arg=old)
   p.locator('.loading-scene').wait_for(state='hidden')
  if online:
   click('auth');click('auth-toggle');p.locator('#auth-email').fill('ending-gk@example.test');p.locator('#auth-password').fill('ending-browser-password');p.locator('#auth-nickname').fill('엔딩골키퍼');p.locator('[name="consent"]').check();click('auth-submit');p.locator('#auth-form').wait_for(state='hidden')
  click('new');click('new-confirm');p.locator('[name="name"]').fill('마지막휘슬'+position);click('position:'+position);p.locator('#player-form button[type="submit"]').click();p.locator('.candidate-grid').wait_for()
  for step in range(170):
   career=state();stage=career['stage']
   if stage=='retired':break
   if not online and career['age']>=35:p.emulate_media(reduced_motion='no-preference')
   if stage=='candidates':click('reveal');click('candidate-confirm')
   elif stage=='growth':click('focus:0');click('focus:1' if position=='GK' else 'focus:2');click('growth-confirm')
   elif stage in ['academyReady','preseason']:click('play-season')
   elif stage=='review':click('next-season')
   elif stage in ['path','failed']:
    if career['developmentSeasons']<4:click('develop')
    else:click('semipro' if stage=='failed' else 'trial')
   elif stage in ['offer','market']:click('offer:0');click('signature');click('sign')
   elif stage=='event':click('event:0')
   else:raise AssertionError(stage)
  else:raise AssertionError('No natural retirement')
  career=state();assert career['stage']=='retired';before=p.evaluate("() => localStorage.getItem('second-life-football-v1')")
  stages=[]
  if not online:
   while p.locator('[data-ending-stage="epilogue"], [data-ending-stage="decision"], [data-ending-stage="number"]').count():
    current=p.locator('.retirement-layer').get_attribute('data-ending-stage');stages.append(current)
    p.locator('[data-action="ending-next"]:not([disabled])').wait_for(timeout=12000);p.screenshot(path=str(OUT/(position+'-'+current+'.png')));click('ending-next')
   p.locator('[data-ending-stage="timeline"]').wait_for();stages.append('timeline')
   p.wait_for_function("() => document.querySelectorAll('.ending-timeline article').length>=3")
   revealed=p.locator('.ending-timeline article').count();p.screenshot(path=str(OUT/(position+'-timeline.png')))
   p.reload(wait_until='networkidle');click('continue');assert p.locator('.ending-timeline article').count()>=revealed
   p.locator('[data-ending-stage="result"]').wait_for(timeout=30000)
  else:
   assert p.locator('.retirement-layer').count()==1;click('ending-skip')
  p.wait_for_function("() => [...document.querySelectorAll('[data-ending-grade]')].every(x=>x.style.visibility==='visible')")
  assert int(p.locator('.ending-result [data-ending-total]').inner_text().replace(',','').replace('점',''))==career['legacyScore']
  values=[int(v.replace(',','')) for v in p.locator('.ending-score dd').all_inner_texts()];assert sum(values)==career['legacyScore']
  p.screenshot(path=str(OUT/(position+'-result.png')));click('ending-records')
  assert p.locator('.ending-card.face-front').count()==1;assert p.locator('.ending-core-stats>div').count()==6
  assert p.evaluate("() => localStorage.getItem('second-life-football-v1')")==before
  p.screenshot(path=str(OUT/(position+'-front.png')))
  p.locator('.ending-player h2').click();assert p.locator('.ending-card.face-back').count()==1
  p.locator('[data-action="ending-card-flip"]').focus();p.keyboard.press('Enter');assert p.locator('.ending-card.face-front').count()==1
  p.locator('.ending-player h2').click();assert p.locator('.ending-card.face-back').count()==1
  click('ending-replay');assert p.locator('.retirement-layer').count()==1;click('ending-skip')
  p.wait_for_function("score => document.querySelector('.ending-result [data-ending-total]')?.textContent === score",arg=f"{career['legacyScore']:,}점")
  click('ending-records');assert state()==career
  click('player-card');assert p.locator('.ending-card-modal .ending-card.face-back').count()==1;click('card-records')
  assert p.locator('.season-log>div').count()==len(career['records'])
  click('home');p.reload(wait_until='networkidle');click('continue');assert p.locator('.retirement-layer').count()==0;assert state()==career
  for width in [320,430]:
   p.set_viewport_size({'width':width,'height':844});p.wait_for_timeout(80)
   assert p.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
  results.append({'position':position,'online':online,'age':career['age'],'seasons':career['proSeasons'],'legacy':career['legacyScore'],'stages':stages,'naturalRetirement':True,'careerUnchanged':True})
  print('PASS ending:',position,'online' if online else 'guest',results[-1],flush=True);ctx.close()
 assert not errors,errors
 browser.close()
(OUT/'results.json').write_text(json.dumps({'careers':results,'consoleErrors':errors},ensure_ascii=False,indent=2))
print('Retirement ceremony, timeline, score reveal, card flip, replay and restoration passed',flush=True)
