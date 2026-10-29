import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    try:
        async with async_playwright() as p:
            context=await p.chromium.launch_persistent_context('/home/wangming/.local/share/goods-hunter/yahoo-session/profile',channel='chrome',headless=False,chromium_sandbox=True,proxy={'server':'http://127.0.0.1:17890'},timeout=30000)
            await context.close()
            print(json.dumps({'launch':'ok'}))
    except Exception as e:
        text=str(e)
        path=Path('/home/wangming/.local/share/goods-hunter/yahoo-session/launch-diagnostic.txt')
        path.write_text(text);path.chmod(0o600)
        signals=['Singleton','ProcessSingleton','Permission denied','Missing X server','DISPLAY','sandbox','Failed to launch','TargetClosed','SIGKILL','SIGTRAP','SIGSEGV','Connection refused','X connection','GLIBC','cannot open shared object','Timeout']
        print(json.dumps({'launch':'failed','type':type(e).__name__,'signals':[s for s in signals if s in text]}))

asyncio.run(main())
