const express=require('express');
const path=require('path');
const http=require('http');
const {Server}=require('socket.io');
const app=express();
const server=http.createServer(app);
const io=new Server(server);
app.use(express.static(path.join(__dirname,'public')));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/health',(req,res)=>res.json({ok:true}));

const rooms=new Map();
const ROLES=['Governor','Governor','Governor','Assassin','Assassin','Assassin','Cityman','Cityman','Cityman','Investigator','Investigator','Investigator','Advisor','Advisor','Advisor','Contessa','Contessa','Contessa'];
const CLAIM={tax:'Governor',assassinate:'Assassin',steal:'Cityman',view:'Investigator',exchange:'Advisor'};
const BLOCK={steal:['Cityman','Investigator','Advisor'],assassinate:['Contessa']};
const sh=a=>[...a].sort(()=>Math.random()-.5);
const code=()=>{let c; do c=Math.random().toString(36).slice(2,7).toUpperCase(); while(rooms.has(c)); return c};
const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
function roomOf(id){for(const r of rooms.values()) if(r.players.some(p=>p.id===id)) return r}
function getP(r,id){return r.players.find(p=>p.id===id)}
function alive(p){return !!p && p.cards.some(c=>c.alive)}
function livingCards(p){return p.cards.filter(c=>c.alive)}
function publicPlayer(p,self=false){return {id:p.id,name:p.name,coins:p.coins,alive:alive(p),cards:self?p.cards.map(c=>({id:c.id,role:c.role,alive:c.alive})):p.cards.map(c=>({id:c.id,alive:c.alive}))}}
function publicRevealed(r){return r.revealedCards.map(c=>({id:c.id,role:c.role}))}
function visiblePending(r,id){
  const q=r.pending;
  if(!q) return null;
  const out={type:q.type,action:q.action,actor:q.actor,target:q.target,claim:q.claim,expiresAt:q.expiresAt,phase:q.phase,chosenCard:q.chosenCard||null,drawn:q.drawn||null};
  if(q.preview && q.actor===id) out.preview=q.preview;
  if(q.drawn && q.actor===id) out.drawn=q.drawn;
  if(q.reactionTarget===id) out.canReact=true;
  if(q.actor===id) out.isActor=true;
  return out;
}
function snap(r,id){
 const me=getP(r,id);
 return {code:r.code,game:'coup',host:r.host,started:r.started,turn:r.turn,phase:r.phase,winner:r.winner,players:r.players.map(p=>publicPlayer(p,p.id===id)),me:publicPlayer(me,true),revealedCards:publicRevealed(r),pending:visiblePending(r,id),log:r.log.slice(-60)};
}
function send(r){r.players.forEach(p=>io.to(p.id).emit('state',snap(r,p.id)))}
function log(r,msg){r.log.push(msg)}
function nextTurn(r){
 let i=r.turn;
 for(let n=0;n<r.players.length;n++){i=(i+1)%r.players.length;if(alive(r.players[i])){r.turn=i;return}}
}
function checkWinner(r){const a=r.players.filter(alive);if(a.length<=1){r.started=false;r.phase='finished';r.winner=a[0]?.name||'';log(r,`🏆 ${r.winner} победил!`);return true}return false}
function bottom(r,card){if(card)r.deck.unshift(card)}
function loseCard(r,p,cardId){let c=p.cards.find(x=>x.id===cardId&&x.alive);if(!c)c=p.cards.find(x=>x.alive);if(c){c.alive=false;r.revealedCards.push({id:c.id,role:c.role});return c}return null}
function loseTwo(r,p,ids){let left=[...ids];let lost=[];for(const id of left){const c=loseCard(r,p,id);if(c)lost.push(c)}while(lost.length<2){const c=loseCard(r,p);if(!c)break;lost.push(c)}return lost}
function draw(r,n){const a=[];for(let i=0;i<n&&r.deck.length;i++)a.push(r.deck.pop());return a}
function createRoom(s,name){const r={code:code(),host:s.id,players:[{id:s.id,name:(name||'Игрок').slice(0,20),coins:2,cards:[],alive:true}],started:false,turn:0,phase:'lobby',winner:null,pending:null,deck:[],log:[]};rooms.set(r.code,r);s.join(r.code);return r}
function startGame(r){
 r.deck=sh(ROLES.map(role=>({id:uid(),role,alive:true})));
 r.revealedCards=[];
 r.players.forEach(p=>{p.coins=2;p.cards=[r.deck.pop(),r.deck.pop()];p.alive=true});
 r.turn=Math.floor(Math.random()*r.players.length);while(!alive(r.players[r.turn]))r.turn=(r.turn+1)%r.players.length;
 r.started=true;r.phase='play';r.pending=null;r.winner=null;
 log(r,`♛ Игра началась. Первый ход: ${r.players[r.turn].name}.`);send(r)
}
function clearPending(r){if(r.pending?.timer)clearTimeout(r.pending.timer);r.pending=null}
function schedule(r,ms,fn){if(r.pending?.timer)clearTimeout(r.pending.timer);r.pending.timer=setTimeout(()=>{if(r.pending)fn()},ms)}
function finishAction(r,advance){
 const q=r.pending;
 if(advance===undefined) advance=!(q&&q.turnAdvanced);
 clearPending(r);
 if(!checkWinner(r)&&advance){nextTurn(r);r.phase='play'}
 send(r)
}
function settlePrevious(r){if(r.pending && r.pending.phase==='challenge') resolvePending(r); else if(r.pending) clearPending(r)}
function challengeResult(r,challengerId){
 const q=r.pending;
 if(!q)return;
 const challenger=getP(r,challengerId);
 if(!challenger||!alive(challenger))return;
 if(q.phase==='blockChallenge'){
   if(challengerId!==q.blockedBy)return;
   const blocker=getP(r,q.blockedBy),actor=getP(r,q.actor);
   const has=blocker.cards.some(c=>c.alive&&c.role===q.claim);
   if(has){
     loseCard(r,actor);
     log(r,`🛡️ ${blocker.name} доказал роль ${q.claim}. ${actor.name} вскрыл карту.`);
     if(q.blockAction==='steal'){q.blocked=true;finishAction(r,false)}
     else if(q.blockAction==='tax'){q.blocked=true;finishAction(r,false)}
     else if(q.blockAction==='assassinate'){q.blocked=true;finishAction(r,false)}
   } else {
     loseCard(r,blocker);
     log(r,`❌ ${blocker.name} не смог доказать роль ${q.claim} и вскрыл карту.`);
     if(q.blockAction==='steal'){q.blockedBy=null;q.phase='resolve';setTimeout(()=>resolvePending(r),50)}
     else if(q.blockAction==='tax'){q.blockedBy=null;q.phase='resolve';setTimeout(()=>resolvePending(r),50)}
     else if(q.blockAction==='assassinate'){q.blockedBy=null;q.phase='target';q.revealNeeded=q.revealNeeded||1;q.revealed=[];q.expiresAt=0;send(r)}
   }
   return;
 }
 if(q.phase!=='challenge')return;
 const actor=getP(r,q.actor);
 if(challenger.id===actor.id)return;
 const has=actor.cards.some(c=>c.alive&&c.role===q.claim);
 if(has){
   loseCard(r,challenger);
   log(r,`🛡️ ${actor.name} доказал роль ${q.claim}. ${challenger.name} вскрыл карту.`);
   q.challenged=true;
   if(q.action==='assassinate') {q.phase='target';q.revealNeeded=2;q.revealed=[];q.expiresAt=0;send(r)}
   else {q.phase='resolve';setTimeout(()=>resolvePending(r),50)}
 }else{
   loseCard(r,actor);
   log(r,`❌ ${actor.name} не смог доказать роль ${q.claim} и вскрыл карту.`);
   if(q.action==='tax') {finishAction(r,!q.turnAdvanced)}
   else if(q.action==='steal'||q.action==='view'||q.action==='exchange') {if(q.drawnCards)q.drawnCards.forEach(c=>{c.alive=false;bottom(r,c)});finishAction(r,!q.turnAdvanced)}
   else if(q.action==='assassinate'){actor.coins+=3;finishAction(r,false)}
   else finishAction(r,!q.turnAdvanced);
 }
}
function resolvePending(r){
 const q=r.pending;if(!q)return;
 const a=getP(r,q.actor),t=q.target?getP(r,q.target):null;
 if(q.phase==='blockChallenge'){
   if(q.blocked){log(r,`🛡️ Заявленная блокировка роли ${q.claim} принята.`);finishAction(r,false);return}
   return
 }
 if(q.action==='tax2'){if(q.blocked){log(r,`🛡️ Иностранная помощь для ${a.name} заблокирована.`);finishAction(r,false);return}a.coins+=2;log(r,`💰 ${a.name} получил 2 монеты.`);finishAction(r,!q.turnAdvanced);return}
 if(q.action==='tax'){if(q.blocked){log(r,`🛡️ Иностранная помощь для ${a.name} заблокирована.`);finishAction(r,false);return}a.coins+=3;log(r,`💰 ${a.name} получил 3 монеты.`);finishAction(r,!q.turnAdvanced);return}
 if(q.action==='steal'){if(q.blocked){log(r,`🛡️ Воровство ${a.name} было заблокировано.`);finishAction(r,false);return}const n=Math.min(2,t?.coins||0);if(t)t.coins-=n;a.coins+=n;log(r,`🪙 ${a.name} украл ${n} монет у ${t.name}.`);finishAction(r,!q.turnAdvanced);return}
 if(q.action==='assassinate'){
   if(q.blocked){finishAction(r,false);return}
   if(q.phase==='target')return;
   q.phase='target';q.reactionTarget=t.id;q.revealNeeded=q.revealNeeded||1;q.revealed=q.revealed||[];q.expiresAt=0;send(r);return;
 }
 if(q.action==='view'){
   const idx=t.cards.findIndex(c=>c.id===q.chosenCard&&c.alive);
   if(idx>=0){const card=t.cards[idx];q.preview={id:card.id,role:card.role};card.alive=false;bottom(r,card);const replacement=r.deck.pop();if(replacement){replacement.alive=true;t.cards[idx]=replacement;log(r,`👁️ ${a.name} посмотрел карту ${t.name}: ${card.role}. Карта ушла вниз колоды, вместо неё выдана новая.`)} }
   finishAction(r,!q.turnAdvanced);return;
 }
 if(q.action==='exchange'){
   if(q.selected){const all=a.cards.filter(c=>c.alive);const removed=all.filter(c=>!q.selected.includes(c.id));removed.forEach(c=>{c.alive=false;bottom(r,c)});a.cards=a.cards.filter(c=>c.alive);log(r,`🔄 ${a.name} завершил обмен карт.`);finishAction(r,!q.turnAdvanced);return;}
   q.phase='exchangeSelect';send(r);return;
 }
}
function targetReveal(r,playerId,cardId){
 const q=r.pending;if(!q||q.phase!=='target'||q.target!==playerId)return;
 const t=getP(r,playerId),a=getP(r,q.actor);
 if(!t.cards.some(c=>c.id===cardId&&c.alive))return;
 if(q.action==='assassinate'){q.revealed=q.revealed||[];if(q.revealed.includes(cardId))return;q.revealed.push(cardId);loseCard(r,t,cardId);log(r,`🗡️ ${a.name} совершил убийство. ${t.name} вскрыл карту.`);if(q.revealed.length>=(q.revealNeeded||1))finishAction(r)}
 else if(q.action==='coup'){loseCard(r,t,cardId);log(r,`💥 ${a.name} совершил переворот против ${t.name}.`);finishAction(r)}
}
function block(r,playerId){
 const q=r.pending;if(!q)return;
 if(q.action==='assassinate'&&q.phase==='target'&&q.target===playerId){q.blockedBy=playerId;q.blockAction='assassinate';q.phase='blockChallenge';q.claim='Contessa';q.expiresAt=Date.now()+15000;log(r,`👑 ${getP(r,playerId).name} заявил, что Графиня блокирует убийство.`);send(r);schedule(r,15000,()=>resolvePending(r));return}
 if(q.action==='steal'&&q.phase==='challenge'&&q.target===playerId){q.blockedBy=playerId;q.blockAction='steal';q.phase='blockChallenge';q.claim='Cityman';q.expiresAt=Date.now()+15000;log(r,`🛡️ ${getP(r,playerId).name} заявил, что Городовой блокирует воровство.`);send(r);schedule(r,15000,()=>resolvePending(r));return}
 if(q.action==='tax2'&&q.phase==='challenge'&&q.actor!==playerId&&alive(getP(r,playerId))){q.blockedBy=playerId;q.blockAction='tax';q.phase='blockChallenge';q.claim='Governor';q.expiresAt=Date.now()+15000;log(r,`🛡️ ${getP(r,playerId).name} заявил, что Губернатор блокирует иностранную помощь.`);send(r);schedule(r,15000,()=>resolvePending(r));return}
}
function beginAction(r,p,action,targetId){
 if(action==='income3') action='tax';
 if(!r.started||r.players[r.turn]?.id!==p.id||!alive(p))return;
 if(r.pending){
   if(['challenge','blockChallenge'].includes(r.pending.phase)) settlePrevious(r);
   else return;
   if(r.pending) return;
 }
 const t=targetId?getP(r,targetId):null;
 if(['assassinate','steal','view'].includes(action)&&(!t||t.id===p.id||!alive(t)))return;
 if(action==='assassinate'&&p.coins<3)return;
 if(action==='coup'&&p.coins<7)return;
 if(action==='steal'&&t===null)return;
 if(action==='view'&&t===null)return;
 if(action==='assassinate')p.coins-=3;
 if(action==='coup'){p.coins-=7;r.pending={action,actor:p.id,target:t.id,phase:'target',expiresAt:0};log(r,`💥 ${p.name} выбрал цель: ${t.name}.`);send(r);return}
 if(action==='income1'){p.coins+=1;log(r,`🪙 ${p.name} взял 1 монету.`);nextTurn(r);send(r);return}
 if(action==='income2'){r.pending={action:'tax2',actor:p.id,claim:'Governor',phase:'challenge',expiresAt:Date.now()+15000,turnAdvanced:true};log(r,`💰 ${p.name} заявил иностранную помощь и берёт 2 монеты.`);nextTurn(r);send(r);schedule(r,15000,()=>resolvePending(r));return}
 if(action==='tax'){
   r.pending={action,actor:p.id,claim:'Governor',phase:'challenge',expiresAt:Date.now()+15000,turnAdvanced:true};log(r,`💰 ${p.name} заявил роль Губернатора и берёт 3 монеты.`);nextTurn(r);send(r);schedule(r,15000,()=>resolvePending(r));return;
 }
 if(action==='steal'||action==='view'||action==='exchange'||action==='assassinate'){
   const q={action,actor:p.id,target:t?.id,claim:CLAIM[action],phase:'challenge',expiresAt:Date.now()+15000};
   if(action==='view'){q.phase='selectView';q.expiresAt=0}
   if(action==='exchange'){
     q.drawn=draw(r,2);p.cards.push(...q.drawn);q.drawnCards=q.drawn; q.drawn=q.drawn.map(c=>c.id);
   }
   r.pending=q;log(r,`🎭 ${p.name} заявил роль ${q.claim}.`);if(q.phase==='challenge'&&action!=='assassinate'){q.turnAdvanced=true;nextTurn(r)}send(r);if(q.phase==='challenge')schedule(r,15000,()=>resolvePending(r));
 }
 if(action==='assassinate'){
   r.pending={action,actor:p.id,target:t.id,claim:'Assassin',phase:'challenge',expiresAt:Date.now()+15000,turnAdvanced:true};log(r,`🗡️ ${p.name} заявил убийство игрока ${t.name}.`);nextTurn(r);send(r);schedule(r,15000,()=>resolvePending(r));
 }
}
function selectView(r,p,cardId){const q=r.pending;if(!q||q.action!=='view'||q.actor!==p.id||q.phase!=='selectView')return;const t=getP(r,q.target);const card=t.cards.find(c=>c.id===cardId&&c.alive);if(!card)return;q.chosenCard=cardId;q.preview={id:card.id,role:card.role};q.phase='challenge';q.expiresAt=Date.now()+15000;log(r,`👁️ ${p.name} выбрал карту для просмотра.`);send(r);schedule(r,15000,()=>resolvePending(r))}
function selectExchange(r,p,ids){const q=r.pending;if(!q||q.action!=='exchange'||q.actor!==p.id||q.phase!=='exchangeSelect')return;const unique=[...new Set(ids||[])];if(unique.length!==2)return;const kept=[];const all=p.cards.filter(c=>c.alive);for(const c of all){if(unique.includes(c.id))kept.push(c)}if(kept.length!==2)return;q.selected=unique;log(r,`🔄 ${p.name} выбрал две карты для обмена.`);resolvePending(r);send(r)}
io.on('connection',s=>{
 s.on('create',(payload={},cb)=>{try{const name=payload?.name||'Игрок';const r=createRoom(s,name);if(typeof cb==='function')cb({ok:true,code:r.code});send(r)}catch(e){console.error('CREATE_ROOM_ERROR',e);if(typeof cb==='function')cb({ok:false,error:'Не удалось создать комнату. Проверьте сервер.'})}});
 s.on('join',(payload={},cb)=>{const name=payload?.name||'Игрок',c=payload?.code;const r=rooms.get(String(c||'').toUpperCase());if(!r)return cb({ok:false,error:'Комната не найдена'});if(r.started)return cb({ok:false,error:'Игра уже началась'});if(r.players.length>=6)return cb({ok:false,error:'Максимум 6 игроков'});r.players.push({id:s.id,name:(name||'Игрок').slice(0,20),coins:2,cards:[],alive:true});s.join(r.code);cb({ok:true,code:r.code});send(r)});
 s.on('start',()=>{const r=roomOf(s.id);if(r&&r.host===s.id&&!r.started&&r.players.length>=2)startGame(r)});
 s.on('action',({action,targetId})=>{const r=roomOf(s.id);if(!r)return;beginAction(r,getP(r,s.id),action,targetId);send(r)});
 s.on('challenge',()=>{const r=roomOf(s.id);if(r)challengeResult(r,s.id);send(r)});
 s.on('reveal',({cardId})=>{const r=roomOf(s.id);if(r)targetReveal(r,s.id,cardId);send(r)});
 s.on('contessa',()=>{const r=roomOf(s.id);if(r)block(r,s.id);send(r)});
 s.on('cityman',()=>{const r=roomOf(s.id);if(r)block(r,s.id);send(r)});
 s.on('governorBlock',()=>{const r=roomOf(s.id);if(r)block(r,s.id);send(r)});
 s.on('viewCard',({cardId})=>{const r=roomOf(s.id);if(r)selectView(r,getP(r,s.id),cardId);send(r)});
 s.on('exchangeKeep',({ids})=>{const r=roomOf(s.id);if(r)selectExchange(r,getP(r,s.id),ids);send(r)});
 s.on('disconnect',()=>{const r=roomOf(s.id);if(!r)return;r.players=r.players.filter(p=>p.id!==s.id);if(!r.players.length)rooms.delete(r.code);else{if(r.host===s.id)r.host=r.players[0].id;if(r.started&&r.turn>=r.players.length)r.turn=0;send(r)}});
});
server.listen(process.env.PORT||3000,'0.0.0.0');
