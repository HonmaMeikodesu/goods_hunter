const fs=require('fs'),path=require('path');
const sdk=require('/tmp/goods-hunter-yahoo-deploy/node_modules/@alicloud/fc20230330');
const {$OpenApiUtil}=require('/tmp/goods-hunter-yahoo-deploy/node_modules/@alicloud/openapi-core');
const d=JSON.parse(fs.readFileSync('/home/admin/project/goods_hunter/src/private/alicloud.json','utf8'));
const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'plan.json'),'utf8'));
const client=new sdk.default(new $OpenApiUtil.Config({accessKeyId:d.accessKeyId,accessKeySecret:d.accessKeySecret,regionId:plan.region,readTimeout:60000,connectTimeout:15000}));
function save(name,value){fs.writeFileSync(path.join(__dirname,name),JSON.stringify(value.toMap?value.toMap():value,null,2),{mode:0o600});}
(async()=>{
 const legacy=(await client.getFunction('fetch-yahoo-fleamarket',new sdk.GetFunctionRequest())).body;
 let f;
 try{f=(await client.getFunction(plan.functionName,new sdk.GetFunctionRequest())).body;}catch(e){if(e.statusCode!==404&&!/NotFound/.test(e.code||''))throw e;}
 if(f){
  if(f.customContainerConfig?.image!==plan.image||f.environmentVariables?.PROXY_ENABLED!=='false')throw new Error('Existing Xianyu function differs from this release');
 }else{
  const body=new sdk.CreateFunctionInput({functionName:plan.functionName,description:'Anonymous Xianyu newest search; source '+plan.sourceHash,runtime:'custom-container',handler:legacy.handler||'index.handler',cpu:1,memorySize:2048,timeout:120,diskSize:512,instanceConcurrency:1,internetAccess:true,environmentVariables:{PROXY_ENABLED:'false',PYTHONUNBUFFERED:'1'},customContainerConfig:new sdk.CustomContainerConfig({image:plan.image,port:9000}),logConfig:legacy.logConfig?new sdk.LogConfig(legacy.logConfig):undefined,resourceGroupId:legacy.resourceGroupId});
  f=(await client.createFunction(new sdk.CreateFunctionRequest({body}))).body;
 }
 save('function.json',f);
 const ts=(await client.listTriggers(plan.functionName,new sdk.ListTriggersRequest())).body.triggers||[];
 let trigger=ts.find(t=>t.triggerName==='httpTrigger');
 if(trigger){const c=JSON.parse(trigger.triggerConfig);if(c.authType!=='function'||JSON.stringify(c.methods)!==JSON.stringify(['POST']))throw new Error('Existing trigger has different authentication or methods');}
 else trigger=(await client.createTrigger(plan.functionName,new sdk.CreateTriggerRequest({body:new sdk.CreateTriggerInput({triggerName:'httpTrigger',triggerType:'http',qualifier:'LATEST',description:'Signed anonymous Xianyu search endpoint',triggerConfig:JSON.stringify({authType:'function',disableURLInternet:false,methods:['POST']})})}))).body;
 save('trigger.json',trigger);
 const url=trigger.httpTrigger?.urlInternet;if(!url)throw new Error('No endpoint URL');
 const result={...plan,url:url.replace(/\/$/,'')+'/search',imageDigest:f.customContainerConfig?.resolvedImageUri,state:f.state};
 save('deployment-public.json',result);
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(JSON.stringify({code:e.code,status:e.statusCode,message:e.code?undefined:e.message}));process.exitCode=1;});
