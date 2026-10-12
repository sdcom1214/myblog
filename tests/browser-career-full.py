"""Play complete careers through visible controls, without forced retirement or save edits."""
import json, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_training_helpers import play_attempt

BASE=os.environ.get('FOOTBALL_TEST_URL','http://127.0.0.1:4173')
OUT=Path(os.environ.get('FOOTBALL_EVIDENCE_DIR','docs/playthrough/implementation'));OUT.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 errors=[]
 def session():
  ctx=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce',accept_downloads=True)
  page=ctx.new_page();page.set_default_timeout(10000)
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
  page.goto(BASE,wait_until='networkidle');return page
 def click(p,a):
  if a != 'milestone-confirm' and p.locator('[data-action="milestone-confirm"]').count(): p.locator('[data-action="milestone-confirm"]').click()
  if a != 'scout-confirm' and p.locator('[data-action="scout-confirm"]').count(): p.locator('[data-action="scout-confirm"]').click()
  control=p.locator('[data-action="'+a+'"]');control.first.wait_for(state='visible')
  previous=p.evaluate("localStorage.getItem('second-life-football-v1')")
  control.first.click()
  commands={'reveal','candidate-confirm','growth-confirm','play-season','next-season','develop','trial','semipro','sign','training-finish','shoot'}
  if a in commands or a.startswith(('train-skill:','event:')):
   p.wait_for_function("old=>localStorage.getItem('second-life-football-v1')!==old",arg=previous)
  p.locator('.loading-scene').wait_for(state='hidden')
 def state(p):return p.evaluate("JSON.parse(localStorage.getItem('second-life-football-v1')).current")
 def career(p,label):
  for artifact in OUT.glob(label+'-*.png'):artifact.unlink()
  trace=[];trained=set();transfers=0;restored=False;milestone_popups=0
  for step in range(180):
   c=state(p);stage=c['stage'];trace.append({'stage':stage,'year':c['year'],'age':c['age'],'ovr':round(sum(c['skills']),1),'proSeasons':c['proSeasons'],'team':c['team']})
   if stage=='retired':break
   if stage=='candidates':click(p,'reveal');click(p,'candidate-confirm')
   elif stage=='growth':click(p,'focus:'+('1' if label=='online-1' else '0'));click(p,'focus:'+('3' if label=='online-1' else '1' if c['position']=='GK' else '2'));click(p,'growth-confirm')
   elif stage in ['academyReady','preseason']:
    if stage=='preseason' and len(trained)<3:
     skill=len(trained);click(p,'training');click(p,'train-skill:'+str(skill))
     for _ in range(5):play_attempt(p,lambda action:click(p,action))
     click(p,'training-finish');click(p,'close');trained.add(skill)
    click(p,'play-season')
   elif stage=='review':
    if p.locator('[data-action="milestone-confirm"]').count():
     senior=[r for r in c['records'] if r['level']=='프로' and r['tier']!='육성팀']
     metrics=[('games','경기',[100,300,500,1000])]+([('saves','선방',[500,1000,1500,2000]),('cleanSheets','클린시트',[50,100,200])] if c['position']=='GK' else [('goals','골',[100,200,300,500]),('assists','도움',[100,200,300])])
     expected=[str(n)+' '+label+' 달성!!' for key,label,levels in metrics for n in levels if sum(r[key] for r in senior[:-1])<n<=sum(r[key] for r in senior)]
     actual=[' '.join(text.replace(',','').split()) for text in p.locator('.milestone-list>div').all_inner_texts()]
     assert expected and actual==expected,(actual,expected)
     if milestone_popups==0:p.screenshot(path=str(OUT/(label+'-milestone.png')))
     click(p,'milestone-confirm');milestone_popups+=1
     if milestone_popups==1:click(p,'milestone-report');assert p.locator('.milestone-list').is_visible();click(p,'milestone-confirm')
    if c['review']['level']=='U18':
     p.locator('[data-action="scout-confirm"]').wait_for();assert c['name'] in p.locator('.modal').inner_text()
     p.screenshot(path=str(OUT/(label+'-scout.png')));click(p,'scout-confirm')
    if c['proSeasons']==1 or c['proSeasons']%5==0:
     p.screenshot(path=str(OUT/(label+'-'+str(c['proSeasons'])+'-seasons.png')))
    if c['proSeasons']==5 and not restored:
     before=state(p);p.reload(wait_until='networkidle');click(p,'continue');assert state(p)==before;restored=True
    click(p,'next-season')
   elif stage in ['path','failed']:
    if c['developmentSeasons']<4:click(p,'develop')
    else:click(p,'semipro' if stage=='failed' else 'trial')
   elif stage in ['offer','market']:
    index=1 if stage=='market' and len(c['offers'])>1 else 0
    previous=c['team'];click(p,'offer:'+str(index));click(p,'signature');click(p,'sign')
    transfers+=bool(previous and state(p)['team']!=previous)
   elif stage=='event':click(p,'event:'+str(c['proSeasons']%2))
   else:raise AssertionError('Unknown screen '+stage)
  else:raise AssertionError('Career failed to reach natural retirement')
  c=state(p);assert c['stage']=='retired' and c['proSeasons']>=5
  if p.locator('[data-action="ending-skip"]').count():click(p,'ending-skip')
  if p.locator('[data-action="ending-records"]').count():click(p,'ending-records')
  assert c['retirementReason']!='선수 본인의 선택으로 축구 인생을 마무리했습니다.'
  assert len(c['records'])==c['proSeasons']+5
  assert len(trained)==3 and len(c['trainingUsed'])==3
  assert milestone_popups>0
  assert c['pendingTraining'] is None
  assert all(r['before'] and r['after'] for r in c['records'])
  assert c['retirementReason'] in p.locator('.retirement-summary').inner_text()
  p.locator('.retirement-summary').scroll_into_view_if_needed();p.screenshot(path=str(OUT/(label+'-retirement-reason.png')))
  p.evaluate('window.scrollTo(0,0)')
  p.screenshot(path=str(OUT/(label+'-retired.png')))
  click(p,'player-card');p.screenshot(path=str(OUT/(label+'-card.png')));click(p,'card-records')
  assert p.locator('.season-log>div').count()==len(c['records'])
  click(p,'export-career');p.locator('.career-export-preview').wait_for()
  with p.expect_download() as png:click(p,'card-png-download')
  assert Path(png.value.path()).read_bytes().startswith(b'\x89PNG\r\n\x1a\n') and png.value.suggested_filename.endswith('.png')
  click(p,'close')
  with p.expect_download() as d:click(p,'export-career-data')
  payload=json.loads(Path(d.value.path()).read_text());assert payload['format']=='sfc-career'
  click(p,'home');p.reload(wait_until='networkidle');click(p,'continue');assert state(p)==c
  result={'name':label,'position':c['position'],'finalAge':c['age'],'seasons':c['proSeasons'],'peakOvr':c['peakOvr'],'legacy':c['legacyScore'],'transfers':transfers,'milestonePopups':milestone_popups,'reason':c['retirementReason'],'records':len(c['records']),'statistics':[{'year':r['year'],'age':r['age'],'level':r['level'],'tier':r['tier'],'goals':r['goals'],'assists':r['assists'],'awards':r['awards']} for r in c['records']],'trace':trace}
  results.append(result);(OUT/'results.json').write_text(json.dumps({'careers':results,'consoleErrors':errors,'forcedRetirement':False},ensure_ascii=False,indent=2));print('PASS full career:',label,c['age'],c['proSeasons'],flush=True)
 for position in ['FW','MF','DF','GK']:
  p=session();click(p,'new');click(p,'new-confirm');p.locator('input[name="name"]').fill('전체플레이'+position)
  click(p,'position:'+position);p.locator('#player-form button[type="submit"]').click();career(p,position);p.context.close()
 # Real online matching with two separate account/cookie sessions.
 pages=[session(),session()];names=['FullA'+str(time.time_ns())[-7:],'FullB'+str(time.time_ns())[-7:]]
 for p,name in zip(pages,names):
  click(p,'auth');click(p,'auth-toggle');p.locator('#auth-email').fill(name+'@example.test');p.locator('#auth-password').fill('full-career-password');p.locator('#auth-nickname').fill(name);p.locator('[name="consent"]').check();click(p,'auth-submit');p.locator('#auth-form').wait_for(state='hidden')
 a,b=pages;click(a,'friend');a.locator('#friend-query').fill(names[1]);click(a,'friend-search');a.locator('[data-action^="friend-select:"]').first.click();click(a,'friend-request')
 click(b,'friend');b.locator('[data-action^="duel-accept:"]').click();b.locator('.candidate-grid').wait_for()
 click(a,'duel-refresh');click(a,'duel-resume');a.locator('.candidate-grid').wait_for();assert state(a)['candidates']==state(b)['candidates']
 for i,p in enumerate(pages):career(p,'online-'+str(i));click(p,'home')
 scores=[c['legacy'] for c in results[-2:]]
 for i,p in enumerate(pages):
  click(p,'friend');assert '매치 완료' in p.locator('.duel-status-card').inner_text();assert p.locator('.duel-final').is_visible()
  final=p.locator('.duel-final').inner_text();assert all(str(score) in final for score in scores)
  assert ('무승부' if scores[0]==scores[1] else '승리' if scores[i]>scores[1-i] else '패배') in final
 a.screenshot(path=str(OUT/'online-natural-duel-complete.png'))
 assert not errors,errors
 (OUT/'results.json').write_text(json.dumps({'careers':results,'consoleErrors':errors,'forcedRetirement':False},ensure_ascii=False,indent=2))
 browser.close()
print('6 full careers and shared natural-retirement duel passed',flush=True)
