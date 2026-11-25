AppKit.i18n.boot({app:'tracking3d',base:'../i18n/'});
// 岩點貓的相機看線（auto=1）：一開始就藏起「開啟相機」，免得頁面程式還沒跑的那一下閃出來
if(new URLSearchParams(location.search).get('auto')==='1'){document.documentElement.dataset.auto='1';document.documentElement.dataset.embed='1';}
