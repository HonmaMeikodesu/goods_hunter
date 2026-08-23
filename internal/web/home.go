package web

const homePage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Goods Hunter</title><style>
body{font-family:system-ui,sans-serif;background:#f6f7f9;margin:0;padding:32px;color:#222}.card{max-width:560px;margin:auto;background:white;padding:24px;border-radius:12px;box-shadow:0 4px 24px #0001}
label{display:block;margin-top:12px}input{width:100%;box-sizing:border-box;padding:10px;margin-top:4px}button{margin-top:16px;padding:10px 16px;cursor:pointer}.row{display:flex;gap:8px}.status{white-space:pre-wrap;margin-top:16px}
</style></head><body><main class="card"><h1>Goods Hunter</h1><p>登录后可通过 watcher 路由管理商品监控任务。</p>
<label>邮箱<input id="email" type="email" autocomplete="email"></label><label>密码<input id="password" type="password" autocomplete="current-password"></label>
<div class="row"><button onclick="submitForm('/login')">登录</button><button onclick="submitForm('/register')">申请注册</button><button onclick="listWatchers()">列出 watcher</button></div><div id="status" class="status"></div>
</main><script>
const statusNode=document.getElementById('status');
async function submitForm(path){const body=new URLSearchParams({email:document.getElementById('email').value,password:document.getElementById('password').value});const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});statusNode.textContent=await response.text();}
async function listWatchers(){const response=await fetch('/goods/listGoodsWatcher');statusNode.textContent=await response.text();}
</script></body></html>`
