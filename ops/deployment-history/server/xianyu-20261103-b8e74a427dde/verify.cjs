const fs=require('fs');
const root=__dirname,app='/home/wangming/project/goods_hunter';
const {createConnection}=require(app+'/node_modules/typeorm');
const {CronJob}=require(app+'/node_modules/cron');
const {XianyuHunter}=require(app+'/dist/model/xianyuHunter');
const {XianyuGoodsRecord}=require(app+'/dist/model/xianyuGoodsRecord');
const cfg=require(app+'/dist/config/config.default').default({name:'goods-hunter'});
const receipt=JSON.parse(fs.readFileSync(root+'/task-registration.json','utf8'));
const plan=JSON.parse(fs.readFileSync(root+'/deployment-public.json','utf8'));
(async()=>{
 if(cfg.alicloudConfig.xianyuUrl!==plan.url)throw new Error('Live app FC configuration mismatch');
 const db=await createConnection({...cfg.orm,name:'xianyu-live-verification',logging:false,synchronize:false,entities:[app+'/dist/model/*.js']});
 try{
  const changes=await db.driver.createSchemaBuilder().log();if(changes.upQueries.length)throw new Error('Unexpected pending live schema changes');
  const tasks=[];
  for(const requested of receipt.tasks){
   const row=await db.getRepository(XianyuHunter).findOne({where:{hunterInstanceId:requested.id},relations:['user']});
   if(!row||row.user.email!==requested.owner)throw new Error('Task missing or wrong owner');
   const condition=JSON.parse(row.searchConditionSchema);
   if(condition.keyword!==requested.keyword||!plan.keywords.includes(condition.keyword)||condition.notifyExisting!==false)throw new Error('Keyword or baseline mode mismatch');
   const all=await db.getRepository(XianyuHunter).find({where:{user:{email:requested.owner}}});
   if(all.filter(t=>JSON.parse(t.searchConditionSchema).keyword===condition.keyword).length!==1)throw new Error('Duplicate keyword tasks');
   if(!row.initialized)throw new Error('Baseline not initialized');
   const records=db.getRepository(XianyuGoodsRecord);
   tasks.push({id:row.hunterInstanceId,keyword:condition.keyword,schedule:row.schedule,nextRun:new CronJob(row.schedule,()=>{}).nextDate().setZone('Asia/Shanghai').toISO(),initialized:row.initialized,records:await records.count({hunter:{hunterInstanceId:row.hunterInstanceId}}),pendingNotifications:await records.count({hunter:{hunterInstanceId:row.hunterInstanceId},notificationPending:true}),filters:{include:condition.includeKeywords,exclude:condition.excludeKeywords},freezingStart:row.freezingStart,freezingEnd:row.freezingEnd});
  }
  const report={checkedAt:new Date().toISOString(),fcUrl:cfg.alicloudConfig.xianyuUrl,pendingSchemaChanges:changes.upQueries.length,tasks};
  fs.writeFileSync(root+'/live-verification.json',JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify(report));
 }finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
