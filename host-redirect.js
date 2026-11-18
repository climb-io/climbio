// 舊網址 climbio.web.app 一律轉到正式網址 climbio.app（保留路徑、查詢字串與 #）。開發版、本機、自架站都不受影響。
if (location.hostname === 'climbio.web.app') location.replace('https://climbio.app' + location.pathname + location.search + location.hash);
