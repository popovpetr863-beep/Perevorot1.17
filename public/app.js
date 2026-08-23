const socket=io({transports:['websocket','polling'],reconnection:true,reconnectionAttempts:10});
let state=null,timer=null;
let socketReady=false;
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const ROLE={
 Governor:{ru:'Губернатор',icon:'♜',ability:'Берёт 3 монеты и блокирует иностранную помощь.'},
 Cityman:{ru:'Городовой',icon:'⚓',ability:'Ворует 2 монеты и блокирует воровство.'},
 Contessa:{ru:'Графиня',icon:'👑',ability:'Блокирует убийство.'},
 Investigator:{ru:'Следователь',icon:'🔎',ability:'Смотрит карту и меняет её или меняет одну свою; блокирует воровство.'},
 Advisor:{ru:'Советник',icon:'♢',ability:'Меняет две свои карты; блокирует воровство.'},
 Assassin:{ru:'Убийца',icon:'🗡️',ability:'Совершает убийство за 3 монеты.'}
};
function setStatus(x){$('status').textContent=x||''}
function setConnection(ok){socketReady=ok; const b=$('create'),j=$('join'); if(b)b.disabled=!ok; if(j)j.disabled=!ok; if(!ok)setStatus('⏳ Подключение к серверу…'); else if($('status').textContent==='⏳ Подключение к серверу…')setStatus('')}
function enter(r){if(!r.ok)return setStatus(r.error);$('lobby').hidden=true;$('game').hidden=false;history.replaceState(null,'',`?room=${r.code}`)}
$('create').onclick=()=>{if(!socketReady)return setStatus('Сервер ещё не подключён. Подождите секунду и попробуйте снова.');$('create').disabled=true;socket.timeout(5000).emit('create',{name:$('name').value.trim()},(err,r)=>{if(err){setStatus('Сервер не ответил. Попробуйте обновить страницу.');$('create').disabled=false;return}enter(r);$('create').disabled=false})};
$('join').onclick=()=>{if(!socketReady)return setStatus('Сервер ещё не подключён. Подождите секунду и попробуйте снова.');socket.timeout(5000).emit('join',{name:$('name').value.trim(),code:$('code').value.trim()},(err,r)=>{if(err){setStatus('Сервер не ответил. Попробуйте обновить страницу.');return}enter(r)})};
$('start').onclick=()=>socket.emit('start');
$('copy').onclick=async()=>{await navigator.clipboard.writeText(location.href);$('copy').textContent='✓ Скопировано';setTimeout(()=>$('copy').textContent='🔗 Ссылка',1500)};
const qs=new URLSearchParams(location.search);if(qs.get('room'))$('code').value=qs.get('room').toUpperCase();
function isMyTurn(){return state?.started&&state.players[state.turn]?.id===state.me.id}
function roleName(r){return ROLE[r]?.ru||r}
function roleCard(c,click=''){return `<div class="card ${c.alive?'':'dead'}" ${click?`onclick="${click}"`:''}><div class="eye">${c.alive?'♢':'×'}</div><div class="role">${ROLE[c.role]?.icon||'?'} ${esc(roleName(c.role))}</div><div class="ability">${esc(ROLE[c.role]?.ability||'')}</div></div>`}
function actionMenu(){return `<div class="actiongroup"><button onclick="incomeMenu()">🪙 Взять монеты</button><button class="danger" onclick="chooseTarget('assassinate')" ${state.me.coins<3?'disabled':''}>🗡️ Убить за 3</button><button class="danger" onclick="chooseTarget('coup')" ${state.me.coins<7?'disabled':''}>💥 Убить за 7</button><button onclick="chooseTarget('steal')">⚓ Украсть 2</button><button onclick="chooseTarget('view')">👁️ Посмотреть карту</button><button onclick="startExchange()">🔄 Обменять 2 карты</button></div>`}
function render(){if(!state)return;$('room').textContent=state.code;$('count').textContent=state.players.length+'/6';$('start').hidden=!(state.host===state.me.id&&!state.started&&state.players.length>=2);let turn=state.started?state.players[state.turn]:null;$('turn').textContent=turn?(turn.id===state.me.id?'ВАШ ХОД':`ХОД: ${esc(turn.name)}`):state.winner?`ПОБЕДИТЕЛЬ: ${esc(state.winner)}`:'ЖДЁМ ИГРОКОВ';renderPlayers();renderLog();renderLastAction();renderGame();renderNotice();startTimer()}
function renderPlayers(){const turnId=state.players[state.turn]?.id;$('players').innerHTML=state.players.map(p=>`<div class="player ${p.id===state.me.id?'me ':''}${p.id===turnId?'turnplayer':''}"><div class="name"><b>${esc(p.name)}</b><span>${p.id===state.host?'👑':''}${!p.alive?' ☠️':''}</span></div><div class="coins">🪙 ${p.coins}</div><div class="mini">${p.id===state.me.id?state.me.cards.filter(c=>c.alive).length+' живых карт':'2 карты · роли скрыты'}</div></div>`).join('')}
function renderLastAction(){const el=$('lastAction');const last=state.log?.[state.log.length-1];el.textContent=last?last:'';el.hidden=!last}
function renderLog(){const el=$('log');el.innerHTML=state.log.map(x=>`<div class="logline">${esc(x)}</div>`).join('');el.scrollTop=el.scrollHeight}
function renderGame(){const q=state.pending;let board='';if(!state.started&&!state.winner){board='<div class="deck">♛</div><div class="tablemark">ЖДЁМ НАЧАЛА ПАРТИИ</div><div class="statusline">Минимум 2 игрока. Хозяин комнаты нажмёт «Начать игру».</div>'}else if(state.winner){board=`<div class="deck">🏆</div><h2>${esc(state.winner)}</h2><div class="statusline">Партия завершена.</div>`}else{board='<div class="deck">♛</div><div class="tablemark">ПЕРЕВОРОТ</div><div class="statusline">Следите за заявками игроков и решайте, кому верить.</div>'}const revealed=state.revealedCards||[];
 board += `<div class="revealed"><div class="revealed-title">Открытые карты</div><div class="revealed-cards">${revealed.length?revealed.map(c=>roleCard({id:c.id,role:c.role,alive:true})).join(''):'<span class="muted">Пока нет открытых карт</span>'}</div></div>`;
 $('board').innerHTML=board;
 $('hand').innerHTML=state.me.cards.filter(c=>c.alive).map(c=>roleCard(c)).join('');
 if(q?.action==='exchange'&&q.phase==='exchangeSelect'&&q.isActor){$('hand').innerHTML=state.me.cards.filter(c=>c.alive).map(c=>roleCard(c,`toggleKeep('${c.id}')`)).join('')}
 renderActions();}
let kept=new Set();
function renderActions(){const q=state.pending;let html='';
 if(q?.phase==='challenge'&&q.actor!==state.me.id){html+=`<button class="danger" onclick="challenge()">❗ Не верю</button>`}
 if(q?.action==='steal'&&q.phase==='challenge'&&q.target===state.me.id){html+=`<button onclick="cityman()">⚓ Городовой — блокировать воровство</button>`}
 if(q?.action==='tax2'&&q.phase==='challenge'&&q.actor!==state.me.id){html+=`<button onclick="governorBlock()">♜ Губернатор — отменить иностранную помощь</button>`}
 if(q?.phase==='blockChallenge'&&q.blockedBy===state.me.id){html+=`<button class="danger" onclick="challenge()">❗ Не верю в блокировку ${esc(roleName(q.claim))}</button>`}
 if(q?.phase==='selectView'&&q.isActor){html+='<div class="statusline">Выберите карту цели для просмотра:</div>';html+=`<div class="targetgrid">${targetCards(q.target)}</div>`}
 if(q?.action==='view'&&q.isActor&&q.preview){html+=`<div class="statusline">Вы посмотрели карту: <b>${esc(roleName(q.preview.role))}</b>. После завершения окна она будет заменена новой картой.</div>`}
 if(q?.action==='assassinate'&&q.phase==='target'&&q.target===state.me.id){html+=`<button onclick="contessa()">👑 Заявить Графиню и заблокировать убийство</button>`;html+=`<div class="statusline">${q.revealNeeded===2?'Вскройте две карты: выберите их по очереди.':'Выберите карту для вскрытия.'}</div>`;html+=myRevealButtons()}
 if(q?.action==='coup'&&q.phase==='target'&&q.target===state.me.id){html+='<div class="statusline">Выберите карту, которую вскрыть:</div>';html+=myRevealButtons()}
 if(q?.action==='exchange'&&q.phase==='exchangeSelect'&&q.isActor){html+=`<div class="statusline">Выберите ровно 2 карты, которые хотите оставить.</div><button class="goldish" onclick="confirmExchange()">Оставить выбранные</button>`}
 // Crucial bluff mechanic: the current player can start a new turn while the previous claim is still inside its challenge window.
 if(state.started&&isMyTurn()&&(!q||['challenge','blockChallenge'].includes(q.phase))){html+=actionMenu()}
 $('actions').innerHTML=html}
function targetCards(id){const p=state.players.find(x=>x.id===id);return (p?.cards||[]).filter(c=>c.alive).map(c=>`<button class="targetbtn" onclick="viewCard('${c.id}')">Карта ${esc(c.id.slice(-3))}</button>`).join('')}
function myRevealButtons(){return `<div class="choicecards">${state.me.cards.filter(c=>c.alive).map(c=>roleCard(c,`reveal('${c.id}')`)).join('')}</div>`}
function incomeMenu(){$('actions').innerHTML='<div class="actiongroup"><button onclick="income(1)">+1 монета</button><button onclick="income(2)">+2 монеты</button><button class="goldish" onclick="income(3)">+3 монеты <small>(Губернатор)</small></button></div>'}
function income(n){socket.emit('action',{action:'income'+n})}
function chooseTarget(action){const candidates=state.players.filter(p=>p.id!==state.me.id&&p.alive);$('actions').innerHTML=`<div class="statusline">Выберите цель:</div><div class="targetgrid">${candidates.map(p=>`<button class="targetbtn" onclick="doTarget('${action}','${p.id}')">${esc(p.name)} · 🪙 ${p.coins}</button>`).join('')}</div>`}
function doTarget(action,id){socket.emit('action',{action,targetId:id})}
function startExchange(){socket.emit('action',{action:'exchange'});kept.clear()}
function toggleKeep(id){if(kept.has(id))kept.delete(id);else if(kept.size<2)kept.add(id);renderActions();$('hand').querySelectorAll('.card').forEach((x,i)=>{const c=state.me.cards.filter(c=>c.alive)[i];if(c&&kept.has(c.id))x.style.outline='3px solid #e5c06c'})}
function confirmExchange(){if(kept.size!==2)return alert('Выберите ровно две карты.');socket.emit('exchangeKeep',{ids:[...kept]});kept.clear()}
function challenge(){socket.emit('challenge')}
function cityman(){socket.emit('cityman')}
function governorBlock(){socket.emit('governorBlock')}
function viewCard(id){socket.emit('viewCard',{cardId:id})}
function contessa(){socket.emit('contessa')}
function reveal(id){socket.emit('reveal',{cardId:id})}
function renderNotice(){const q=state.pending;const el=$('notice');if(!q){el.hidden=true;return}el.hidden=false;let text='';if(q.phase==='challenge'){text=q.actor===state.me.id?'Ваше действие под вопросом.':'Игрок сделал заявление — можно не поверить.'}else if(q.phase==='blockChallenge')text=`Заявлена блокировка: ${roleName(q.claim)}. Игрок, чьё действие блокируют, может не поверить.`;else if(q.phase==='selectView')text='Выберите одну карту цели.';else if(q.phase==='target')text=q.target===state.me.id?'Ваш выбор: Графиня или вскрытие карты.':'Цель выбирает реакцию на убийство.';else if(q.phase==='exchangeSelect')text='Выберите две карты из четырёх.';el.innerHTML=`<span>${text}</span>${q.expiresAt?'<span id="challengeTimer" class="timerSmall"></span>':''}`}
function startTimer(){clearInterval(timer);const q=state.pending;if(!q?.expiresAt)return;const update=()=>{const el=$('challengeTimer');if(!el)return;const left=Math.max(0,q.expiresAt-Date.now());const sec=Math.ceil(left/1000);el.textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;if(left<=0)clearInterval(timer)};update();timer=setInterval(update,200)}
socket.on('connect',()=>setConnection(true));
socket.on('disconnect',()=>setConnection(false));
socket.on('connect_error',()=>setConnection(false));
setConnection(socket.connected);
socket.on('state',s=>{state=s;if(state.started||state.winner||state.players.length){$('lobby').hidden=true;$('game').hidden=false}render()});
