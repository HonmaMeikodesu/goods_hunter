const fs=require('fs');
const root='/home/wangming/project/.goods_hunter-deployments/yahoo-session-20261029-01';
const app='/home/wangming/project/goods_hunter';
const {YahooAuctionApi}=require(root+'/candidate/dist/api/site/yahoo');
const {AliCloudApi}=require(root+'/candidate/dist/api/alicloud');
(async()=>{
 const api=new YahooAuctionApi();
 const fc=new AliCloudApi();
 fc.alicloudConfig=JSON.parse(fs.readFileSync(app+'/src/private/alicloud.json','utf8'));
 fc.logger={info(){},error(){}};
 api.alicloudApi=fc;
 api.sessionConfig={file:'/home/wangming/.local/share/goods-hunter/yahoo-session/session.json',authenticatedSelector:process.env.YAHOO_AUTH_SELECTOR};
 const result=await api.checkCookieHeartBeat();
 console.log(JSON.stringify(result));
 if(!result.result)process.exitCode=1;
})().catch(()=>{console.error('Candidate FC check failed; no credentials logged.');process.exitCode=1;});
