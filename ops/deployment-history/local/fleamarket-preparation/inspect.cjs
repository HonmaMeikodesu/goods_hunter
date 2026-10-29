const fs=require('fs');
const sdk=require('@alicloud/fc20230330');
const {$OpenApiUtil}=require('@alicloud/openapi-core');
const creds=JSON.parse(fs.readFileSync('/home/admin/project/goods_hunter/src/private/alicloud.json','utf8'));
const client=new sdk.default(new $OpenApiUtil.Config({accessKeyId:creds.accessKeyId,accessKeySecret:creds.accessKeySecret,regionId:'cn-hangzhou',readTimeout:30000,connectTimeout:10000}));
function safeError(e){let message=e.message||'';for(const value of [creds.accessKeyId,creds.accessKeySecret])message=message.split(value).join('<redacted>');console.error(JSON.stringify({code:e.code,statusCode:e.statusCode,message}));}
(async()=>{
 const list=await client.listFunctions(new sdk.ListFunctionsRequest({limit:100}));
 console.log('Relevant functions:',JSON.stringify((list.body.functions||[]).filter(f=>/fetch|goods|yahoo/i.test(f.functionName)).map(f=>({name:f.functionName,runtime:f.runtime,state:f.state}))));
 const old=(await client.getFunction('fetch-surugaya',new sdk.GetFunctionRequest())).body;
 fs.writeFileSync('/tmp/goods-hunter-yahoo-deploy/legacy-function.json',JSON.stringify(old.toMap?old.toMap():old),{mode:0o600});
 console.log('Existing function:',JSON.stringify({name:old.functionName,runtime:old.runtime,state:old.state,cpu:old.cpu,memorySize:old.memorySize,timeout:old.timeout,instanceConcurrency:old.instanceConcurrency,image:old.customContainerConfig?.image,port:old.customContainerConfig?.port,environmentKeys:Object.keys(old.environmentVariables||{}),hasRegistryCredentials:Boolean(old.customContainerConfig?.registryConfig),hasLogConfig:Boolean(old.logConfig),hasRole:Boolean(old.role)}));
 const ts=await client.listTriggers('fetch-surugaya',new sdk.ListTriggersRequest());
 fs.writeFileSync('/tmp/goods-hunter-yahoo-deploy/legacy-triggers.json',JSON.stringify(ts.body.toMap?ts.body.toMap():ts.body),{mode:0o600});
 console.log('Existing triggers:',JSON.stringify((ts.body.triggers||[]).map(t=>({name:t.triggerName,type:t.triggerType,config:JSON.parse(t.triggerConfig||'{}'),internetUrl:t.httpTrigger?.urlInternet}))));
 try{const next=(await client.getFunction('fetch-yahoo-fleamarket',new sdk.GetFunctionRequest())).body;fs.writeFileSync('/tmp/goods-hunter-yahoo-deploy/previous-yahoo-function.json',JSON.stringify(next.toMap?next.toMap():next),{mode:0o600});console.log('New function already exists:',true);}catch(e){if(e.statusCode===404||/NotFound/.test(e.code||''))console.log('New function already exists:',false);else throw e;}
})().catch(e=>{safeError(e);process.exitCode=1;});
