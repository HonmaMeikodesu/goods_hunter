const fs=require('fs'),path=require('path');
const root='/home/wangming/project/.goods_hunter-deployments/yahoo-fleamarket-20261023-db40678834d7';
const stage=path.join(root,'stage');
const {createConnection}=require(stage+'/node_modules/typeorm');
const config=require(stage+'/dist/config/config.default').default({name:'goods-hunter'});
(async()=>{const db=await createConnection({...config.orm,name:'yahoo-deploy-schema-check',logging:false,synchronize:false,entities:[stage+'/dist/model/*.js']});try{const sql=await db.driver.createSchemaBuilder().log();const queries=sql.upQueries.map(q=>q.query);fs.writeFileSync(root+'/schema-preview.json',JSON.stringify(queries),{mode:0o600});const unexpected=queries.filter(q=>!/^\s*(CREATE TABLE|ALTER TABLE)\s+`yahoo_fleamarket_(hunter|goods_record)`/.test(q));console.log(JSON.stringify({schemaChanges:queries.map(q=>q.slice(0,q.indexOf('(')>0?Math.min(q.indexOf('('),160):160)),unexpectedStatements:unexpected.length}));if(unexpected.length)throw new Error('Schema preview includes changes outside the two new platform tables');}finally{await db.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
