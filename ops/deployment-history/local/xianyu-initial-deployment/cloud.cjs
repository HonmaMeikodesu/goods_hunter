const fs=require('fs'),path=require('path');
const root=__dirname;
const sdk=require('/tmp/goods-hunter-yahoo-deploy/node_modules/@alicloud/fc20230330');
const {$OpenApiUtil}=require('/tmp/goods-hunter-yahoo-deploy/node_modules/@alicloud/openapi-core');
const creds=JSON.parse(fs.readFileSync('/home/admin/project/goods_hunter/src/private/alicloud.json','utf8'));
const client=new sdk.default(new $OpenApiUtil.Config({accessKeyId:creds.accessKeyId,accessKeySecret:creds.accessKeySecret,regionId:'cn-hangzhou',readTimeout:60000,connectTimeout:15000}));
function save(name,value){fs.writeFileSync(path.join(root,name),JSON.stringify(value.toMap?value.toMap():value,null,2),{mode:0o600});}
function summary(f){return {name:f.functionName,state:f.state,stateReason:f.stateReason,image:f.customContainerConfig?.image,resolvedImageUri:f.customContainerConfig?.resolvedImageUri,memorySize:f.memorySize,cpu:f.cpu,timeout:f.timeout,instanceConcurrency:f.instanceConcurrency,proxyMode:f.environmentVariables?.PROXY_ENABLED,hasRole:Boolean(f.role),hasLogConfig:Boolean(f.logConfig),registryConfigured:Boolean(f.customContainerConfig?.registryConfig)};}
(async()=>{
 const old=(await client.getFunction('fetch-yahoo-fleamarket',new sdk.GetFunctionRequest())).body;
 save('legacy-function.json',old); console.log('Reference',JSON.stringify(summary(old)));
 try{
  const f=(await client.getFunction('fetch-xianyu',new sdk.GetFunctionRequest())).body;
  save('existing-function.json',f); console.log('Current Xianyu',JSON.stringify(summary(f)));
  const ts=await client.listTriggers('fetch-xianyu',new sdk.ListTriggersRequest());
  save('existing-triggers.json',ts.body);
  console.log('Triggers',JSON.stringify((ts.body.triggers||[]).map(t=>({name:t.triggerName,url:t.httpTrigger?.urlInternet,config:JSON.parse(t.triggerConfig||'{}')}))));
 }catch(e){if(e.statusCode===404||/NotFound/.test(e.code||''))console.log('Xianyu function not yet created');else throw e;}
})().catch(e=>{console.error(JSON.stringify({code:e.code,status:e.statusCode,name:e.name}));process.exitCode=1;});
