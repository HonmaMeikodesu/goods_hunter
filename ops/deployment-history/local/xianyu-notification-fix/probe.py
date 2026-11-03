import asyncio,json,sys
from pathlib import Path
sys.path.insert(0,'/app')
import xianyu
original=xianyu.parse_search_response

def inspect(payload, fields, keyword, newest=True):
    result=original(payload,fields,keyword,newest)
    if newest and result['items']:
        main=payload['data']['resultList'][0]['data']['item']['main']
        content=main['exContent']
        fixture={'ret':['SUCCESS::调用成功'],'data':{'resultList':[{'data':{'item':{'main':{'exContent':{k:content[k] for k in ['itemId','title','price','picUrl'] if k in content}}}}}], 'resultInfo':{'hasNextPage':True,'searchResControlFields':{'numFound':1,'hasItems':True}}}}
        evidence={'keyword':keyword,'fields':fields,'rawImage':content.get('picUrl'),'parsedImage':result['items'][0]['thumbnailImageUrl'],'fixture':fixture}
        Path('/evidence/raw-image.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
        print('IMAGE_EVIDENCE '+json.dumps({k:evidence[k] for k in ['rawImage','parsedImage']},ensure_ascii=False),flush=True)
    return result
xianyu.parse_search_response=inspect
async def main():
    r=await xianyu.collect({'keyword':'本间芽衣子'})
    print('RESULT '+json.dumps({'items':len(r['items']),'withImages':sum(bool(i['thumbnailImageUrl']) for i in r['items'])}),flush=True)
    assert all(i['thumbnailImageUrl'] for i in r['items']), 'Product images lost in collector'
asyncio.run(main())
