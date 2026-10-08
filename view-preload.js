;(function(){
  const CHROME_VER = '137'
  const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VER}.0.0.0 Safari/537.36`
  const w=window
  try{Object.defineProperty(w,'top',         {get:()=>w,   configurable:true})}catch(e){}
  try{Object.defineProperty(w,'parent',      {get:()=>w,   configurable:true})}catch(e){}
  try{Object.defineProperty(w,'frameElement',{get:()=>null,configurable:true})}catch(e){}
  try{delete w.process}catch(e){}
  try{delete w.require}catch(e){}
  try{delete w.module}catch(e){}
  try{Object.defineProperty(navigator,'userAgent', {get:()=>UA,            configurable:true})}catch(e){}
  try{Object.defineProperty(navigator,'vendor',    {get:()=>'Google Inc.', configurable:true})}catch(e){}
  try{Object.defineProperty(navigator,'webdriver', {get:()=>false,         configurable:true})}catch(e){}
  try{Object.defineProperty(navigator,'plugins',   {get:()=>[1,2,3,4,5],  configurable:true})}catch(e){}
  try{Object.defineProperty(navigator,'userAgentData',{get:()=>({
    brands:[{brand:'Chromium',version:CHROME_VER},{brand:'Not/A)Brand',version:'8'},{brand:'Google Chrome',version:CHROME_VER}],
    mobile:false,platform:'Windows',
    getHighEntropyValues:async()=>({architecture:'x86',bitness:'64',mobile:false,model:'',platform:'Windows',platformVersion:'15.0.0',uaFullVersion:`${CHROME_VER}.0.0.0`})
  }),configurable:true})}catch(e){}
  if(!w.chrome)try{Object.defineProperty(w,'chrome',{value:{app:{isInstalled:false},runtime:{},loadTimes:()=>({}),csi:()=>({})},configurable:true,writable:true})}catch(e){}
})()
