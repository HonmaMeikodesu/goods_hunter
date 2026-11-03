const fs=require('fs'),path=require('path');
const repo='/home/admin/project/goods_hunter';
require(repo+'/node_modules/ts-node').register({project:repo+'/tsconfig.json',transpileOnly:true});
const {AliCloudApi}=require(repo+'/src/api/alicloud');
const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'plan.json'),'utf8'));
const fc=new AliCloudApi();
fc.alicloudConfig={...JSON.parse(fs.readFileSync(repo+'/src/private/alicloud.json','utf8')),xianyuUrl:plan.url};
fc.logger={info:()=>{},error:()=>{}};
(async()=>{
 const results=[];
 for(const keyword of (process.argv.length>2?process.argv.slice(2):plan.tasks.map(t=>t.keyword))){
  if(!plan.tasks.map(t=>t.keyword).includes(keyword))throw new Error("Unexpected deployment keyword");
  const start=Date.now();
  try{
   const response=await fc.fetchXianyuSearch({keyword});
   if(!response.items?.length||response.items.some(i=>!i.thumbnailImageUrl?.startsWith('https://'))||response.success!==true||response.keyword!==keyword||response.sort!=='newest'||response.currency!=='CNY'||!Array.isArray(response.items))throw new Error('Invalid live search contract');
   const result={keyword,success:true,elapsedSeconds:(Date.now()-start)/1000,items:response.items.length,withImages:response.items.filter(i=>i.thumbnailImageUrl).length,resultState:response.resultState,samples:response.items.slice(0,3).map(i=>({id:i.id,name:i.name.slice(0,100),priceFen:i.priceFen})),response};
   results.push(result);console.log(JSON.stringify({...result,response:undefined}));
  }catch(e){results.push({keyword,success:false,status:e.response?.status,code:e.response?.data?.code||e.code});console.log(JSON.stringify(results[results.length-1]));}
  fs.writeFileSync(path.join(__dirname,process.argv.length>2?'cloud-image-retry.json':'cloud-image-acceptance.json'),JSON.stringify({url:plan.url,checkedAt:new Date().toISOString(),results},null,2));
 }
 if(results.some(r=>!r.success))process.exitCode=1;
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
