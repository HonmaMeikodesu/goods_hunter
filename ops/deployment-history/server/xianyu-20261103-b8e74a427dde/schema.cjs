const fs=require('fs'),path=require('path');
const root=__dirname,stage=path.join(root,'stage');
const {createConnection}=require(stage+'/node_modules/typeorm');
const config=require(stage+'/dist/config/config.default').default({name:'goods-hunter'});
(async()=>{
 const db=await createConnection({...config.orm,name:'xianyu-schema-check',logging:false,synchronize:false,entities:[stage+'/dist/model/*.js']});
 try{
  const log=await db.driver.createSchemaBuilder().log(); const queries=log.upQueries.map(q=>q.query);
  const unsafe=queries.filter(q=>!/^\s*(CREATE TABLE|ALTER TABLE)\s+`xianyu_(hunter|goods_record)`/.test(q));
  if(unsafe.length)throw new Error('Schema includes changes outside new Xianyu tables');
  fs.writeFileSync(root+'/schema-preview.json',JSON.stringify(queries,null,2),{mode:0o600});
  console.log(JSON.stringify({schemaChanges:queries.length,tablesOnly:['xianyu_hunter','xianyu_goods_record']}));
  if(process.argv.includes('--apply')){
   for(const query of queries)await db.query(query);
   const after=await db.driver.createSchemaBuilder().log();
   if(after.upQueries.length)throw new Error('Schema still has pending changes');
   fs.writeFileSync(root+'/schema-applied.json',JSON.stringify({queries:queries.length,at:new Date().toISOString()}),{mode:0o600});
   console.log('Xianyu schema applied and verified');
  }
 }finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
