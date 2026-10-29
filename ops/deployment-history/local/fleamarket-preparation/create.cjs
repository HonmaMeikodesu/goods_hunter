const fs=require('fs');const sdk=require('@alicloud/fc20230330');const {$OpenApiUtil}=require('@alicloud/openapi-core');
const d=JSON.parse(fs.readFileSync('/home/admin/project/goods_hunter/src/private/alicloud.json','utf8'));
const legacy=JSON.parse(fs.readFileSync('legacy-function.json','utf8'));
const client=new sdk.default(new $OpenApiUtil.Config({accessKeyId:d.accessKeyId,accessKeySecret:d.accessKeySecret,regionId:'cn-hangzhou',readTimeout:60000,connectTimeout:20000}));
const image='crpi-4kc62280obihdvgw.cn-hangzhou.personal.cr.aliyuncs.com/honmameiko/fetch-surugaya:yahoo-fleamarket-20261023-db40678834d7';
const name='fetch-yahoo-fleamarket';
function save(name,value){fs.writeFileSync(name,JSON.stringify(value.toMap?value.toMap():value),{mode:0o600});}
function summary(f){return {name:f.functionName,state:f.state,stateReason:f.stateReason,image:f.customContainerConfig?.image,resolvedImageUri:f.customContainerConfig?.resolvedImageUri,memorySize:f.memorySize,instanceConcurrency:f.instanceConcurrency};}
(async()=>{
 if(!legacy.environmentVariables?.SECRET_KEY_K||!legacy.environmentVariables?.GOODS_HUNTER_SERVER_URL)throw new Error('Existing function lacks required proxy environment');
 const input=new sdk.CreateFunctionInput({functionName:name,description:'Yahoo Fleamarket public search collector; source db40678834d7',runtime:'custom-container',handler:legacy.handler||'index.handler',cpu:1,memorySize:2048,timeout:120,diskSize:512,instanceConcurrency:1,internetAccess:true,environmentVariables:legacy.environmentVariables,customContainerConfig:new sdk.CustomContainerConfig({image,port:9000}),logConfig:legacy.logConfig?new sdk.LogConfig(legacy.logConfig):undefined,resourceGroupId:legacy.resourceGroupId});
 const created=await client.createFunction(new sdk.CreateFunctionRequest({body:input}));save('new-function.json',created.body);console.log('Created function',JSON.stringify(summary(created.body)));
 const triggerInput=new sdk.CreateTriggerInput({triggerName:'httpTrigger',triggerType:'http',qualifier:'LATEST',description:'Signed Yahoo Fleamarket search endpoint',triggerConfig:JSON.stringify({authType:'function',disableURLInternet:false,methods:['POST']})});
 const trigger=await client.createTrigger(name,new sdk.CreateTriggerRequest({body:triggerInput}));save('new-trigger.json',trigger.body);
 const url=trigger.body.httpTrigger?.urlInternet;
 if(!url)throw new Error('Created trigger has no public endpoint');
 fs.writeFileSync('deployment-public.json',JSON.stringify({functionName:name,region:'cn-hangzhou',image,url,sourceHash:'db40678834d7'}),{mode:0o600});
 console.log('Created signed trigger',JSON.stringify({name:trigger.body.triggerName,url,authType:JSON.parse(trigger.body.triggerConfig).authType}));
})().catch(e=>{let m=e.message||'';for(const v of [d.accessKeyId,d.accessKeySecret,...Object.values(legacy.environmentVariables||{})])if(v)m=m.split(v).join('<redacted>');console.error(JSON.stringify({code:e.code,message:m,status:e.statusCode}));process.exitCode=1;});
