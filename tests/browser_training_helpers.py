"""Interact with the visible training boards; no engine calls or save mutations."""
def play_attempt(page, click, keyboard=False):
    before=page.evaluate("JSON.parse(localStorage.getItem('second-life-football-v1')).current.pendingTraining.shots.length")
    click('training-start')
    mode=page.locator('.training-arena').get_attribute('data-training-mode')
    if mode=='finish':
        if keyboard:page.keyboard.press('Space')
        else:
            b=page.locator('.goal-target').bounding_box();page.mouse.click(b['x']+b['width']/2,b['y']+b['height']/2)
    elif mode=='passing':page.locator('.training-lanes button').filter(has_text='열린 동료').click()
    elif mode=='position':
        direction=page.locator('.training-pitch>small').inner_text().split(':')[1].strip()
        click('training-lane:'+str(['왼쪽','중앙','오른쪽'].index(direction)))
    elif mode=='dribble':
        sequence=page.locator('.training-slalom>div:first-child>span').all_inner_texts()
        for step in sequence:click('training-step:'+('left' if step.startswith('←') else 'right'))
    elif mode=='reflex':page.wait_for_function("document.querySelector('.training-reaction')?.classList.contains('ready')");click('shoot')
    elif mode in ['tackle','catch']:
        axis='top' if mode=='catch' else 'left'
        page.wait_for_function("axis=>{const e=document.querySelector('#training-mover');return e&&parseFloat(e.style[axis])>=65&&parseFloat(e.style[axis])<=76}",arg=axis)
        click('shoot')
    elif mode=='kicking':
        if keyboard:
            page.keyboard.down('Space');page.wait_for_timeout(300);page.keyboard.down('Space');page.wait_for_timeout(350);page.keyboard.up('Space')
        else:
            b=page.locator('[data-action="training-hold"]').bounding_box();page.mouse.move(b['x']+b['width']/2,b['y']+b['height']/2);page.mouse.down()
            page.wait_for_timeout(650);page.mouse.up()
    elif mode=='sprint':
        for _ in range(10):click('training-tap')
        page.locator('[data-action="training-start"], [data-action="training-finish"]').wait_for(state='visible')
    else:page.wait_for_timeout(220);click('shoot')
    page.wait_for_function("n=>JSON.parse(localStorage.getItem('second-life-football-v1')).current.pendingTraining.shots.length===n+1",arg=before)
