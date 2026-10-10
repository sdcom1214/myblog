"""Play every skill's game using its actual visible controls."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_training_helpers import play_attempt

BASE=os.environ.get('FOOTBALL_TEST_URL','http://127.0.0.1:4173')
OUT=Path('docs/playthrough/training');OUT.mkdir(parents=True,exist_ok=True)
results=[];errors=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for position,skills in [('FW',[0,1,2]),('FW',[3,4]),('GK',[0,1,2]),('GK',[3,4])]:
  ctx=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce');p=ctx.new_page();p.set_default_timeout(10000)
  p.on('pageerror',lambda e:errors.append(str(e)));p.on('console',lambda m:errors.append(m.text) if m.type=='error' else None);p.goto(BASE,wait_until='networkidle')
  def state():return p.evaluate("JSON.parse(localStorage.getItem('second-life-football-v1')).current")
  def click(a):
   for confirm in ['scout-confirm','milestone-confirm']:
    if a!=confirm and p.locator('[data-action="'+confirm+'"]').count():p.locator('[data-action="'+confirm+'"]').click()
   before=p.evaluate("localStorage.getItem('second-life-football-v1')");p.locator('[data-action="'+a+'"]').first.click()
   if a in ['reveal','candidate-confirm','growth-confirm','play-season','next-season','develop','trial','semipro','sign','training-finish'] or a.startswith(('train-skill:','event:')):
    p.wait_for_function("old=>localStorage.getItem('second-life-football-v1')!==old",arg=before)
   p.locator('.loading-scene').wait_for(state='hidden')
  # Also exercise the new goalkeeper games against the production account server.
  if position=='GK' and skills[0]==3:
   click('auth');click('auth-toggle');p.locator('#auth-email').fill('training-gk@example.test');p.locator('#auth-password').fill('training-gk-password');p.locator('#auth-nickname').fill('특훈골키퍼');p.locator('[name="consent"]').check();click('auth-submit');p.locator('#auth-form').wait_for(state='hidden')
  click('new');click('new-confirm');p.locator('[name="name"]').fill('특훈검증'+position);click('position:'+position);p.locator('#player-form button[type="submit"]').click();p.locator('.candidate-grid').wait_for()
  click('reveal');click('candidate-confirm');click('focus:0');click('focus:1' if position=='GK' else 'focus:2');click('growth-confirm');click('play-season');click('next-season')
  for _ in range(10):
   c=state()
   if c['stage']=='offer':break
   if c['stage']=='review':click('next-season')
   elif c['developmentSeasons']<4:click('develop')
   elif c['stage']=='failed':click('semipro')
   else:click('trial')
  assert state()['stage']=='offer';click('offer:0');click('signature');click('sign')
  for skill in skills:
   if state()['stage']=='review':click('next-season')
   if state()['stage']=='market':click('offer:0');click('signature');click('sign')
   if state()['stage']=='event':click('event:0')
   click('training');click('train-skill:'+str(skill));c=state();mode=c['pendingTraining']['mode'];challenge=c['pendingTraining']['rounds']
   p.screenshot(path=str(OUT/(position+'-'+str(skill)+'-'+mode+'.png')))
   for attempt in range(5):
    play_attempt(p,click,keyboard=mode=='kicking' and attempt==0)
    if position=='FW' and skill==0 and attempt==0:
     saved=state()['pendingTraining'];p.reload(wait_until='networkidle');click('continue');assert state()['pendingTraining']==saved
   c=state();assert len(c['pendingTraining']['shots'])==5;assert c['pendingTraining']['rounds']==challenge
   scores=c['pendingTraining']['shots'];click('training-finish');assert state()['pendingTraining'] is None;assert state()['lastTraining']['score']==sum(scores)
   click('close');results.append({'position':position,'skill':skill,'game':mode,'scores':scores,'bonus':state()['lastTraining']['bonus']});print('PASS training game',position,skill,mode,scores,flush=True)
   click('play-season')
  click('tab:player');click('honours');assert p.locator('.honours-list>div').count()>=80;assert p.locator('.honours-list .unlocked').count()>0
  ctx.close()
 assert len({r['game'] for r in results})==9;assert not errors,errors
 (OUT/'results.json').write_text(json.dumps({'games':results,'consoleErrors':errors},ensure_ascii=False,indent=2));browser.close()
print('All 10 skill mappings / 9 training games and honours UI passed',flush=True)
