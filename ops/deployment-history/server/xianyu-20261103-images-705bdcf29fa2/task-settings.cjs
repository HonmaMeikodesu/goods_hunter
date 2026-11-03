const fs=require('fs');const root=__dirname,app='/home/wangming/project/goods_hunter';const {createConnection}=require(app+'/node_modules/typeorm');const cfg=require(app+'/dist/config/config.default').default({name:'goods-hunter'});const plan=JSON.parse(fs.readFileSync(root+'/plan.json'));
const mode=process.argv[2]||'verify';
(async()=>{const db=await createConnection({...cfg.orm,name:'xianyu-task-settings',logging:false,synchronize:false,entities:[app+'/dist/model/*.js']});try{
const beforeFile=root+'/task-settings-before.json';
await db.transaction(async manager=>{
 const rows=[];for(const spec of plan.tasks){const row=await manager.getRepository('XianyuHunter').findOne({where:{hunterInstanceId:spec.id},relations:['user'],lock:{mode:'pessimistic_write'}});if(!row||JSON.parse(row.searchConditionSchema).keyword!==spec.keyword||!row.initialized)throw Error('Task identity or baseline mismatch');rows.push(row);}
 if(rows[0].user.email!==rows[1].user.email)throw Error('Task owners differ');
 const references=await manager.getRepository('MercariHunter').find({where:{user:{email:rows[0].user.email}}});if(!references.length||references.some(r=>r.freezingStart!==plan.freezingStart||r.freezingEnd!==plan.freezingEnd))throw Error('Reference freeze settings changed');
 if(mode==='apply'){
  if(fs.existsSync(beforeFile))throw Error('Settings already backed up; inspect before re-applying');
  const backup=rows.map(r=>({id:r.hunterInstanceId,schedule:r.schedule,freezingStart:r.freezingStart,freezingEnd:r.freezingEnd,searchConditionSchema:r.searchConditionSchema,initialized:r.initialized}));fs.writeFileSync(beforeFile,JSON.stringify(backup,null,2),{mode:0o600});
  for(const spec of plan.tasks)await manager.getRepository('XianyuHunter').update({hunterInstanceId:spec.id},{schedule:spec.schedule,freezingStart:plan.freezingStart,freezingEnd:plan.freezingEnd});
 }else if(mode==='restore'){
  for(const old of JSON.parse(fs.readFileSync(beforeFile)))await manager.getRepository('XianyuHunter').update({hunterInstanceId:old.id},{schedule:old.schedule,freezingStart:old.freezingStart,freezingEnd:old.freezingEnd});
 }else{
  for(const [index,spec] of plan.tasks.entries()){const row=rows[index];if(row.schedule!==spec.schedule||row.freezingStart!==plan.freezingStart||row.freezingEnd!==plan.freezingEnd)throw Error('Live schedule/freeze mismatch');}
 }
});
const tasks=[];for(const spec of plan.tasks){const row=await db.getRepository('XianyuHunter').findOne(spec.id);const records=await db.query('SELECT COUNT(*) total,SUM(thumbnailImageUrl <> ?) images,SUM(notificationPending) pending FROM xianyu_goods_record WHERE hunterInstanceId=?',['',spec.id]);tasks.push({id:spec.id,keyword:spec.keyword,schedule:row.schedule,freezingStart:row.freezingStart,freezingEnd:row.freezingEnd,initialized:row.initialized,records:records[0]});}
const result={mode,checkedAt:new Date().toISOString(),tasks};fs.writeFileSync(root+'/task-settings-'+mode+'.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
}finally{await db.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});
