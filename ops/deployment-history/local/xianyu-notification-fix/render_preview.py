import asyncio,json,sys
from pathlib import Path
sys.path.insert(0,'/app')
from bypass_cloudflare import connect_to_chrome
async def main():
    driver,browser=await connect_to_chrome()
    context=await browser.new_context()
    try:
        page=await context.new_page()
        reports=[]
        for width in (390,1000):
            await page.set_viewport_size({'width':width,'height':850})
            await page.set_content(Path('/evidence/mail-preview.html').read_text(),wait_until='load')
            await page.locator('img').evaluate('(img) => img.decode()')
            metrics=await page.locator('p[title]').evaluate_all('(els)=>els.map(e=>({height:e.getBoundingClientRect().height,scrollHeight:e.scrollHeight,lineHeight:parseFloat(getComputedStyle(e).lineHeight),clamp:getComputedStyle(e).webkitLineClamp}))')
            assert metrics[0]['height'] <= 2*metrics[0]['lineHeight']+.1 and metrics[0]['scrollHeight']>metrics[0]['height'],metrics
            assert metrics[0]['clamp']=='2' and metrics[1]['height']<=metrics[1]['lineHeight']+.1,metrics
            image=await page.locator('img').evaluate('(img)=>({width:img.naturalWidth,height:img.naturalHeight})')
            assert image['width']>0 and image['height']>0
            await page.screenshot(path=f'/evidence/mail-preview-{width}.png',full_page=True)
            reports.append({'viewport':width,'titles':metrics,'image':image})
        Path('/evidence/preview-checks.json').write_text(json.dumps(reports,indent=2))
        print(json.dumps(reports),flush=True)
    finally:
        await context.close();await driver.stop()
asyncio.run(main())
