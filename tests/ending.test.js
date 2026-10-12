import test from 'node:test';
import assert from 'node:assert/strict';
import { newCareer, legacy, legacyBreakdown } from '../src/engine.js';
import { careerEnding } from '../src/ending.js';

function player(position = 'FW', seasons = 1) {
  const c = newCareer({ name:'끝까지달린선수', number:10, foot:'오른발', position, preferred:'arsenal', academy:'hale-end' }, 123);
  c.stage = 'retired'; c.team = 'arsenal'; c.proSeasons = seasons;
  c.records = Array.from({ length:seasons }, (_, i) => ({ year:2027+i, level:'프로', tier:'1군', team:'아스널', games:10, goals:2, assists:3, cleanSheets:1, saves:11, minutes:800, rating:7, newOvr:80+i, awards:['발롱도르','발롱도르','리그 우승'] }));
  c.trophies = [{ year:2027, name:'리그 우승', team:'아스널' }]; c.nationalCaps = 5;
  return c;
}

test('ending breakdown preserves the career score and its displayed items sum exactly', () => {
  const c = player(), before = structuredClone(c), result = legacyBreakdown(c);
  assert.equal(result.total, 373); assert.equal(legacy(c), 373);
  assert.deepEqual(result.items.map(x => x.value), [15,48,70,180,60]);
  assert.equal(result.items.reduce((a,b) => a+b.value,0), result.total); assert.deepEqual(c,before);
});

test('fractional save and appearance points retain the original rounding for all positions', () => {
  for (const position of ['FW','MF','DF','GK']) for (let i=0;i<100;i++) {
    const c=player(position); c.records[0].games=i%39; c.records[0].saves=i*7;
    const expected=Math.round(c.records[0].games*1.5+16+21+9+c.records[0].saves*.2+180+60+70);
    const result=legacyBreakdown(c); assert.equal(result.total,expected); assert.equal(result.items.reduce((sum,x)=>sum+x.value,0),expected);
  }
});

test('club honor requires retirement, eight first-team seasons and the legacy threshold', () => {
  const c=player('FW',8); assert.equal(careerEnding(c).honorClub,null);
  c.trophies=Array.from({length:20},(_,i)=>({year:2027+i,name:'리그 우승',team:'아스널'}));
  assert.equal(careerEnding(c).honorClub.id,'arsenal');
  c.stage='preseason';assert.equal(careerEnding(c).honorClub,null);
  c.stage='retired';c.records[0].tier='육성팀';assert.equal(careerEnding(c).honorClub,null);
});

test('ending uses goalkeeper records, distinct award counts, and supports no professional seasons', () => {
  const c=player('GK',3), ending=careerEnding(c);
  assert.deepEqual(ending.coreStats.slice(0,3),[['경기','30'],['선방','33'],['클린시트','3']]);
  assert.equal(ending.achievements.find(x=>x.name==='발롱도르').count,3);
  c.records=[];c.trophies=[];c.nationalCaps=0;c.proSeasons=0;
  const empty=careerEnding(c);assert.equal(empty.score.total,0);assert.equal(empty.honorClub,null);assert.equal(empty.peakYears,'프로 기록 없음');
});
