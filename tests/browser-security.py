"""Exercise hostile imports and public views against the built app and an isolated DB."""
import copy, json, os, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE=os.environ.get('FOOTBALL_TEST_URL','http://127.0.0.1:4173')
OUT=Path('docs/audit/security');OUT.mkdir(parents=True,exist_ok=True)
PAYLOAD='<svg/onload=alert(1)>'
results=[]
with sync_playwright() as pw, tempfile.TemporaryDirectory() as directory:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 def context(bypass=False):
  ctx=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce',accept_downloads=True,bypass_csp=bypass)
  p=ctx.new_page();p.set_default_timeout(12000);p.goto(BASE,wait_until='networkidle');return p
 def click(p,action):
  for confirm in ['scout-confirm','milestone-confirm']:
   if action!=confirm and p.locator('[data-action="'+confirm+'"]').count():p.locator('[data-action="'+confirm+'"]').click()
  old=p.evaluate("localStorage.getItem('second-life-football-v1')")
  p.locator('[data-action="'+action+'"]').first.click()
  if action in ['reveal','candidate-confirm','growth-confirm','play-season','next-season','develop','trial','semipro','sign']:
   p.wait_for_function("old=>localStorage.getItem('second-life-football-v1')!==old",arg=old)
  p.locator('.loading-scene').wait_for(state='hidden')
 def state(p):return p.evaluate("JSON.parse(localStorage.getItem('second-life-football-v1')).current")
 def professional(p,name):
  click(p,'new');click(p,'new-confirm');p.locator('[name="name"]').fill(name);p.locator('#player-form button[type="submit"]').click();p.locator('.candidate-grid').wait_for()
  click(p,'reveal');click(p,'candidate-confirm');click(p,'focus:0');click(p,'focus:2');click(p,'growth-confirm');click(p,'play-season');click(p,'next-season')
  for _ in range(8):
   c=state(p)
   if c['stage']=='offer':break
   if c['stage']=='review':click(p,'next-season')
   elif c['developmentSeasons']<4:click(p,'develop')
   elif c['stage']=='failed':click(p,'semipro')
   else:click(p,'trial')
  assert state(p)['stage']=='offer';click(p,'offer:0');click(p,'signature');click(p,'sign')
 def settings(p,section):
  click(p,'home' if p.locator('[data-action="home"]').count() else 'nav:home');click(p,'settings')
  if not p.locator('[data-action="accordion:'+section+'"]').locator('..').locator('.accordion-content').count():click(p,'accordion:'+section)
 def hostile_import(p,data):
  settings(p,'save');f=Path(directory)/'hostile-save.json';f.write_text(json.dumps(data,ensure_ascii=False))
  with p.expect_file_chooser() as chooser:click(p,'import-save')
  chooser.value.set_files(f);p.locator('[data-action="import-apply"]').wait_for();click(p,'import-apply');click(p,'continue')
 # Disable CSP here so this proves escaping itself prevents execution.
 p=context(True);dialogs=[];errors=[]
 p.on('dialog',lambda dialog:(dialogs.append(dialog.message),dialog.dismiss()))
 p.on('pageerror',lambda error:errors.append(str(error)))
 professional(p,'표시값검증');settings(p,'teams');p.locator('#custom-club').select_option(state(p)['team']);p.locator('#custom-club-name').fill(PAYLOAD);click(p,'custom-club-save');click(p,'nav:home');click(p,'continue')
 assert PAYLOAD in p.locator('.preseason-card h2').inner_text();assert p.locator('svg[onload]').count()==0
 p.screenshot(path=str(OUT/'escaped-club-name.png'))
 settings(p,'save')
 with p.expect_download() as download:click(p,'export-save')
 original=json.loads(Path(download.value.path()).read_text())
 hostile=copy.deepcopy(original);c=hostile['data']['current'];c['stage']='review';c['id']='FC-\"'+PAYLOAD
 c['review']['role']=PAYLOAD;c['review']['injury']=PAYLOAD;c['records'][-1]=copy.deepcopy(c['review'])
 hostile_import(p,hostile)
 assert PAYLOAD in p.locator('.injury-banner').inner_text();assert p.locator('svg[onload]').count()==0
 p.screenshot(path=str(OUT/'escaped-import.png'))
 hostile['data']['current']['stage']='retired';hostile_import(p,hostile)
 button=p.locator('button').filter(has_text='MY CLUB에 저장')
 assert button.get_attribute('data-action')=='club-save:'+c['id'];assert p.locator('svg[onload]').count()==0
 hostile['data']['current']['stage']='candidates';hostile['data']['current']['candidates'][0]['type']=PAYLOAD
 hostile_import(p,hostile)
 assert PAYLOAD in p.locator('.candidate').first.get_attribute('aria-label');assert p.locator('svg[onload]').count()==0
 assert not dialogs and not errors,(dialogs,errors)
 results.append('Club names, imported injury/role, career IDs and candidate labels render as text with CSP disabled')
 p.context.close()
 # Exercise the new projection with the actual public profile, honours and PNG UI.
 p=context();errors=[];p.on('pageerror',lambda error:errors.append(str(error)));p.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
 click(p,'auth');click(p,'auth-toggle');p.locator('#auth-email').fill('security-view@example.test');p.locator('#auth-password').fill('security-view-password');p.locator('#auth-nickname').fill('공개검증');p.locator('[name="consent"]').check();click(p,'auth-submit');p.locator('#auth-form').wait_for(state='hidden')
 professional(p,'공개선수');click(p,'play-season')
 player_id=state(p)['id'];public=p.request.get(BASE+'/api/careers/public',params={'id':player_id}).json()['career']
 assert not any(key in public for key in ['rng','pendingTraining','candidates','coins','inventory','offers'])
 click(p,'home');click(p,'nav:ranking');click(p,'rank-type:live');p.locator('[data-action^="public-view:"]').first.wait_for();p.locator('[data-action^="public-view:"]').first.click()
 assert p.locator('[data-action="tab:season"]').count()==0;assert p.locator('[data-action="export-career-data"]').count()==0
 click(p,'tab:player');click(p,'honours');assert p.locator('.honours-list>div').count()>=80;click(p,'close');p.screenshot(path=str(OUT/'public-profile.png'))
 click(p,'tab:career');click(p,'export-career');p.locator('.career-export-preview').wait_for()
 with p.expect_download() as download:click(p,'card-png-download')
 assert Path(download.value.path()).read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
 assert not errors,errors
 results.append('Projected public profile, achievements and PNG export work under enforced CSP with no console errors')
 p.context.close()
 p=context();p.evaluate("window.__inlineSecurityProbe=0;const s=document.createElement('script');s.textContent='window.__inlineSecurityProbe=1';document.body.append(s)")
 assert p.evaluate('window.__inlineSecurityProbe')==0
 results.append('The built-page CSP blocks injected inline scripts')
 p.context.close();browser.close()
 (OUT/'results.json').write_text(json.dumps({'checks':results,'unexpectedDialogs':0,'uncaughtErrors':0},ensure_ascii=False,indent=2))
 for result in results:print('PASS',result,flush=True)
 print('3 security browser scenarios passed',flush=True)
