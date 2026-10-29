const fs=require('fs');
const {createConnection}=require('/home/wangming/project/goods_hunter/node_modules/typeorm');
const {v4:uuid}=require('/home/wangming/project/goods_hunter/node_modules/uuid');
const app='/home/wangming/project/goods_hunter';
const cfg=require(app+'/dist/config/config.default').default({name:'goods-hunter'});
const {User}=require(app+'/dist/model/user');
const {MercariHunter}=require(app+'/dist/model/mercariHunter');
const {YahooFleamarketHunter}=require(app+'/dist/model/yahooFleamarketHunter');
const {YahooFleamarketGoodsRecord}=require(app+'/dist/model/yahooFleamarketGoodsRecord');
const {normalizeYahooFleamarketCondition}=require(app+'/dist/api/site/yahooFleamarket/conditions');
const {YahooFleamarketHunterService}=require(app+'/dist/service/hunterArsenal/yahooFleamarket');
const {YahooFleamarketApi}=require(app+'/dist/api/site/yahooFleamarket');
const {AliCloudApi}=require(app+'/dist/api/alicloud');
const file='/home/wangming/project/.goods_hunter-deployments/yahoo-fleamarket-20261023-db40678834d7/task-registration-20261023.json';
const plan=[{label:'面码',sourceId:'c719c7ae-2069-4ba9-840f-04881d85987c'}, {label:'未闻花名',sourceId:'285d3641-0394-4a56-bb77-19beaa5a4ad3'}];
function save(data){fs.writeFileSync(file,JSON.stringify(data,null,2),{mode:0o600});fs.chmodSync(file,0o600);}
(async()=>{
 const db=await createConnection({...cfg.orm,name:'yahoo-task-registration',logging:false,synchronize:false,entities:[app+'/dist/model/*.js']});
 try{
  const rows=await db.transaction(async manager=>{
   const sources=[];
   for(const item of plan){const source=await manager.findOne(MercariHunter,{where:{hunterInstanceId:item.sourceId},relations:['user']});if(!source?.user?.email)throw new Error('Source Mercari task missing: '+item.label);sources.push({...item,source});}
   const owners=[...new Set(sources.map(item=>item.source.user.email))];if(owners.length!==1)throw new Error('Source tasks have different owners');
   const owner=await manager.findOne(User,{where:{email:owners[0]},select:['email'],lock:{mode:'pessimistic_write'}});if(!owner)throw new Error('Source task owner missing');
   const existing=await manager.find(YahooFleamarketHunter,{where:{user:{email:owner.email}}});
   const results=[];
   for(const item of sources){
    const keyword=JSON.parse(item.source.searchConditionSchema).keyword;
    const condition=normalizeYahooFleamarketCondition({keyword,epoch:1,notifyExisting:false});
    const matches=existing.filter(h=>JSON.parse(h.searchConditionSchema).keyword===condition.keyword);
    if(matches.length>1)throw new Error('Multiple matching Yahoo tasks already exist: '+item.label);
    let task=matches[0],created=false;
    if(task){if(task.schedule!==item.source.schedule||task.freezingStart!==item.source.freezingStart||task.freezingEnd!==item.source.freezingEnd||JSON.stringify(normalizeYahooFleamarketCondition(JSON.parse(task.searchConditionSchema)))!==JSON.stringify(condition))throw new Error('Existing task has different conditions: '+item.label);}
    else{task=manager.create(YahooFleamarketHunter,{hunterInstanceId:uuid(),user:owner,schedule:item.source.schedule,freezingStart:item.source.freezingStart,freezingEnd:item.source.freezingEnd,searchConditionSchema:JSON.stringify(condition),initialized:false});await manager.save(task);created=true;}
    results.push({label:item.label,id:task.hunterInstanceId,sourceId:item.sourceId,keyword:condition.keyword,schedule:task.schedule,freezingStart:task.freezingStart,freezingEnd:task.freezingEnd,created,owner:owner.email});
   }
   return results;
  });
  const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  for(const row of rows)row.created=row.created||Boolean(previous?.tasks?.some(task=>task.id===row.id&&task.created));
  const receipt={registeredAt:previous?.registeredAt||new Date().toISOString(),updatedAt:new Date().toISOString(),tasks:rows};save(receipt);
  console.log('Registered task settings',JSON.stringify(rows.map(({owner,...row})=>row)));
  const fc=new AliCloudApi();fc.alicloudConfig=cfg.alicloudConfig;
  const errors=[];const logger={info:()=>{},warn:()=>{},error:message=>{errors.push(message);console.error(message);}};
  fc.logger=logger;
  const api=new YahooFleamarketApi();api.alicloudApi=fc;
  const hunter=new YahooFleamarketHunterService();hunter.hunterModel=db.getRepository(YahooFleamarketHunter);hunter.goodsRecordModel=db.getRepository(YahooFleamarketGoodsRecord);hunter.yahooFleamarketApi=api;hunter.logger=logger;
  hunter.emailService={sendEmail:async()=>{throw new Error('Unexpected mail during first-scan baseline initialization');}};
  for(const row of rows){
   const task=await hunter.hunterModel.findOne(row.id);
   if(!task.initialized)await hunter.goHunt(row.id);
   const latest=await hunter.hunterModel.findOne(row.id);
   row.initialized=latest.initialized;
   row.baselineItems=await hunter.goodsRecordModel.count({hunter:{hunterInstanceId:row.id}});
   row.pendingNotifications=await hunter.goodsRecordModel.count({hunter:{hunterInstanceId:row.id},notificationPending:true});
   save(receipt);
   console.log('Initial scan',JSON.stringify({label:row.label,initialized:row.initialized,baselineItems:row.baselineItems,pendingNotifications:row.pendingNotifications}));
   if(!row.initialized)throw new Error('Initial search did not complete: '+row.label);
  }
 }finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
