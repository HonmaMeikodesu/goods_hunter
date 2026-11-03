const fs=require('fs'),path=require('path');
const root=__dirname,app=path.join(root,'stage');
const {createConnection}=require(app+'/node_modules/typeorm');
const {v4:uuid}=require(app+'/node_modules/uuid');
const cfg=require(app+'/dist/config/config.default').default({name:'goods-hunter'});
const {User}=require(app+'/dist/model/user');
const {MercariHunter}=require(app+'/dist/model/mercariHunter');
const {XianyuHunter}=require(app+'/dist/model/xianyuHunter');
const {XianyuGoodsRecord}=require(app+'/dist/model/xianyuGoodsRecord');
const {normalizeXianyuCondition}=require(app+'/dist/api/site/xianyu/conditions');
const {XianyuHunterService}=require(app+'/dist/service/hunterArsenal/xianyu');
const {XianyuApi}=require(app+'/dist/api/site/xianyu');
const {AliCloudApi}=require(app+'/dist/api/alicloud');
const plan=JSON.parse(fs.readFileSync(root+'/deployment-public.json','utf8'));
const file=root+'/task-registration.json';
function save(value){fs.writeFileSync(file,JSON.stringify(value,null,2),{mode:0o600});}
(async()=>{
 const db=await createConnection({...cfg.orm,name:'xianyu-registration',logging:false,synchronize:false,entities:[app+'/dist/model/*.js']});
 try{
  const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  const offset=(new Date().getUTCMinutes()+3)%15;
  const schedules=[offset,(offset+7)%15].map(x=>[x,x+15,x+30,x+45].join(',')+' * * * *');
  const tasks=await db.transaction(async manager=>{
   const references=[];
   for(const id of ['c719c7ae-2069-4ba9-840f-04881d85987c','285d3641-0394-4a56-bb77-19beaa5a4ad3']){
    const row=await manager.findOne(MercariHunter,{where:{hunterInstanceId:id},relations:['user']});
    if(!row?.user?.email)throw new Error('Existing owner-reference task missing');
    references.push(row);
   }
   const owners=[...new Set(references.map(t=>t.user.email))];
   if(owners.length!==1)throw new Error('Owner references disagree');
   const owner=await manager.findOne(User,{where:{email:owners[0]},select:['email'],lock:{mode:'pessimistic_write'}});
   if(!owner)throw new Error('Task owner not found');
   const existing=await manager.find(XianyuHunter,{where:{user:{email:owner.email}}});
   const results=[];
   for(let n=0;n<plan.keywords.length;n++){
    const keyword=plan.keywords[n];
    const condition=normalizeXianyuCondition({keyword,notifyExisting:false});
    const matches=existing.filter(t=>JSON.parse(t.searchConditionSchema).keyword===keyword);
    if(matches.length>1)throw new Error('Duplicate task already exists');
    let task=matches[0],created=false;
    if(task){if(JSON.stringify(normalizeXianyuCondition(JSON.parse(task.searchConditionSchema)))!==JSON.stringify(condition))throw new Error('Existing task uses different filters');}
    else{task=manager.create(XianyuHunter,{hunterInstanceId:uuid(),user:owner,schedule:schedules[n],freezingStart:null,freezingEnd:null,searchConditionSchema:JSON.stringify(condition),initialized:false});await manager.save(task);created=true;}
    results.push({id:task.hunterInstanceId,keyword,schedule:task.schedule,created:created||Boolean(previous?.tasks?.some(t=>t.id===task.hunterInstanceId&&t.created)),owner:owner.email});
   }
   return results;
  });
  const receipt={registeredAt:previous?.registeredAt||new Date().toISOString(),updatedAt:new Date().toISOString(),tasks};save(receipt);
  console.log('Registered',JSON.stringify(tasks.map(({owner,...t})=>t)));
  const fc=new AliCloudApi();fc.alicloudConfig={...cfg.alicloudConfig,xianyuUrl:plan.url};
  const logger={info:m=>console.log(m),warn:m=>console.log(m),error:m=>console.error(m)};fc.logger=logger;
  const api=new XianyuApi();api.alicloudApi=fc;
  const hunter=new XianyuHunterService();hunter.hunterModel=db.getRepository(XianyuHunter);hunter.goodsRecordModel=db.getRepository(XianyuGoodsRecord);hunter.xianyuApi=api;hunter.logger=logger;
  hunter.emailService={sendEmail:async()=>{throw new Error('No email is expected during initial baseline creation');}};
  for(const row of tasks){
   const before=await hunter.hunterModel.findOne(row.id);
   if(!before.initialized)await hunter.goHunt(row.id);
   const current=await hunter.hunterModel.findOne(row.id);
   row.initialized=current.initialized;
   row.baselineItems=await hunter.goodsRecordModel.count({hunter:{hunterInstanceId:row.id}});
   row.pendingNotifications=await hunter.goodsRecordModel.count({hunter:{hunterInstanceId:row.id},notificationPending:true});
   save(receipt);
   console.log('Baseline',JSON.stringify({id:row.id,keyword:row.keyword,initialized:row.initialized,items:row.baselineItems,pending:row.pendingNotifications}));
   if(!row.initialized)throw new Error('Initial cloud scan has not succeeded for '+row.keyword);
   if(row.pendingNotifications)throw new Error('Unexpected initial notifications');
  }
 }finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
