import json, sys
from pathlib import Path
sys.path.insert(0,'/home/wangming/project/goods_hunter/tools/yahoo-session')
import session_manager as manager

original=manager.refresh_context
async def observed(*args,**kwargs):
    try:
        return await original(*args,**kwargs)
    except Exception as e:
        text=str(e)
        path=Path('/home/wangming/.local/share/goods-hunter/yahoo-session/login-diagnostic.txt')
        path.write_text(text);path.chmod(0o600)
        signals=['ERR_TUNNEL_CONNECTION_FAILED','ERR_PROXY_CONNECTION_FAILED','ERR_CONNECTION_RESET','ERR_CONNECTION_CLOSED','ERR_TIMED_OUT','ERR_ABORTED','ERR_NAME_NOT_RESOLVED','Timeout','TargetClosed','Execution context was destroyed','UPSTREAM_ERROR','AUTH_UNVERIFIED']
        print(json.dumps({'diagnostic':'[DEBUG-yahoo-reopen]','type':type(e).__name__,'signals':[s for s in signals if s in text]}),flush=True)
        raise
manager.refresh_context=observed
raise SystemExit(manager.main())
