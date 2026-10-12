'use strict';
/* holdem.html의 ENGINE 블록에서 자동 생성 — 직접 고치지 마세요 */

const SUITS=['s','h','d','c'];
const SUIT_CH={s:'♠',h:'♥',d:'♦',c:'♣'};
const RANK_CH={11:'J',12:'Q',13:'K',14:'A'};
const rankCh=r=>RANK_CH[r]||String(r);
const cardTxt=c=>rankCh(c.r)+SUIT_CH[c.s];
const LEVELS=[[10,20],[20,40],[30,60],[50,100],[75,150],[100,200],[150,300],[200,400],[300,600]];
const HANDS_PER_LEVEL=6;
const HAND_NAMES=['하이카드','원 페어','투 페어','트리플','스트레이트','플러시','풀하우스','포카드','스트레이트 플러시'];
let EQ_SCALE=1;
function setEqScale(x){EQ_SCALE=x;}

function newDeck(){const d=[];for(const s of SUITS)for(let r=2;r<=14;r++)d.push({r,s});return d;}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

function straightHigh(set){
  for(let h=14;h>=5;h--){
    let ok=true;
    for(let i=0;i<5;i++){let r=h-i;if(r===1)r=14;if(!set.has(r)){ok=false;break;}}
    if(ok)return h;
  }
  return 0;
}
function evaluate(cards){
  const counts=new Map();const suits={s:[],h:[],d:[],c:[]};
  for(const c of cards){counts.set(c.r,(counts.get(c.r)||0)+1);suits[c.s].push(c.r);}
  let flush=null;
  for(const s of SUITS)if(suits[s].length>=5)flush=suits[s].slice().sort((a,b)=>b-a);
  if(flush){const h=straightHigh(new Set(flush));if(h)return{score:[8,h],cat:8,royal:h===14};}
  const g=[...counts].map(([r,c])=>({r,c})).sort((a,b)=>b.c-a.c||b.r-a.r);
  if(g[0].c===4){const k=Math.max(...g.slice(1).map(x=>x.r),0);return{score:[7,g[0].r,k],cat:7};}
  if(g[0].c===3&&g.length>1&&g[1].c>=2)return{score:[6,g[0].r,g[1].r],cat:6};
  if(flush)return{score:[5,...flush.slice(0,5)],cat:5};
  const sh=straightHigh(new Set(counts.keys()));
  if(sh)return{score:[4,sh],cat:4};
  if(g[0].c===3){const ks=g.slice(1).map(x=>x.r).sort((a,b)=>b-a).slice(0,2);return{score:[3,g[0].r,...ks],cat:3};}
  if(g[0].c===2&&g[1]&&g[1].c===2){const k=Math.max(...g.slice(2).map(x=>x.r),0);return{score:[2,g[0].r,g[1].r,k],cat:2};}
  if(g[0].c===2){const ks=g.slice(1).map(x=>x.r).sort((a,b)=>b-a).slice(0,3);return{score:[1,g[0].r,...ks],cat:1};}
  return{score:[0,...g.map(x=>x.r).sort((a,b)=>b-a).slice(0,5)],cat:0};
}
function cmp(a,b){const n=Math.max(a.length,b.length);for(let i=0;i<n;i++){const d=(a[i]||0)-(b[i]||0);if(d)return d;}return 0;}
function handName(ev){return ev.royal?'로열 플러시':HAND_NAMES[ev.cat];}

/* 랜덤 상대를 가정한 몬테카를로 승률 (무승부는 지분 계산) */
function equity(hole,board,nOpp,iters){
  if(nOpp<1)return 1;
  iters=Math.max(20,Math.round((iters||250)*EQ_SCALE));
  const key=c=>c.r*10+SUITS.indexOf(c.s);
  const used=new Set(hole.concat(board).map(key));
  const rest=newDeck().filter(c=>!used.has(key(c)));
  const need=5-board.length;
  const m=need+2*nOpp;
  let win=0;
  for(let it=0;it<iters;it++){
    for(let i=0;i<m;i++){const j=i+Math.floor(Math.random()*(rest.length-i));const t=rest[i];rest[i]=rest[j];rest[j]=t;}
    const full=board.concat(rest.slice(0,need));
    const me=evaluate(hole.concat(full)).score;
    let best=true,ties=0;
    for(let o=0;o<nOpp;o++){
      const oc=rest.slice(need+2*o,need+2*o+2);
      const c=cmp(evaluate(oc.concat(full)).score,me);
      if(c>0){best=false;break;}
      if(c===0)ties++;
    }
    if(best)win+=1/(ties+1);
  }
  return win/iters;
}

function createGame(defs,chips,opts){
  const players=defs.map((d,i)=>({id:i,name:d.name,tag:d.tag||'',human:!!d.human,
    style:d.style||{tight:0,aggr:.5,bluff:.1,loose:.2},
    stack:chips,bet:0,total:0,cards:[],inHand:false,out:false,allIn:false,acted:false,
    lastAction:'',revealed:false,won:0,returned:0,bestName:'',ev:null}));
  return{players,dealer:-1,sbI:-1,bbI:-1,handNo:0,sb:LEVELS[0][0],bb:LEVELS[0][1],level:0,
    pot:0,board:[],deck:[],currentBet:0,minRaise:LEVELS[0][1],street:'idle',turn:-1,result:null,showdown:false,aggr:-1,runout:false,idx:0,
    mp:!!(opts&&opts.mp)};
}
function nextIdx(G,from,pred){
  const n=G.players.length;
  for(let i=1;i<=n;i++){const k=(from+i)%n;if(pred(G.players[k]))return k;}
  return -1;
}
function commit(G,p,amt){
  amt=Math.max(0,Math.min(amt,p.stack));
  p.stack-=amt;p.bet+=amt;p.total+=amt;G.pot+=amt;
  if(p.stack===0)p.allIn=true;
  return amt;
}

function buildPots(P,potTotal){
  const live=P.filter(p=>p.inHand);
  const levels=[...new Set(live.map(p=>p.total))].sort((a,b)=>a-b);
  const pots=[];let prev=0;
  for(const lvl of levels){
    let amount=0;
    for(const p of P)amount+=Math.max(0,Math.min(p.total,lvl)-prev);
    const elig=live.filter(p=>p.total>=lvl);
    if(amount>0)pots.push({amount,elig});
    prev=lvl;
  }
  const sum=pots.reduce((s,x)=>s+x.amount,0);
  if(pots.length&&sum!==potTotal)pots[pots.length-1].amount+=potTotal-sum;
  return pots;
}

function aiDecide(G,p,info){
  const live=G.players.filter(q=>q.inHand).length;
  const e=equity(p.cards,G.board,live-1,G.board.length?240:200);
  const fair=1/live,st=p.style,pot=G.pot,toCall=info.toCall;
  const strong=fair+(1-fair)*(0.33+st.tight*0.4);
  const medium=fair+(1-fair)*(0.17+st.tight*0.3);
  const rnd=Math.random(),post=G.board.length>=3;
  const R=(a,b)=>a+Math.random()*(b-a);
  const clampTo=t=>{
    t=Math.max(info.minTo,Math.min(info.maxTo,t));
    if(t>=p.bet+p.stack*0.7)t=info.maxTo;
    return t;
  };
  const to=frac=>clampTo(G.currentBet+Math.max(G.minRaise,Math.round(frac*(pot+toCall)/5)*5));

  if(toCall===0){
    if(info.canRaise){
      if(e>=strong&&rnd<0.5+0.45*st.aggr)return{type:'raise',to:to(R(0.55,0.95))};
      if(e>=medium&&rnd<0.5*st.aggr)return{type:'raise',to:to(R(0.35,0.6))};
      if(post&&e<medium&&rnd<st.bluff*0.5)return{type:'raise',to:to(R(0.4,0.7))};
    }
    return{type:'call'};
  }
  if(G.street==='preflop'&&G.currentBet<=G.bb&&info.canRaise&&e>=medium&&rnd<0.2+0.5*st.aggr){
    return{type:'raise',to:clampTo(Math.round(G.bb*R(2.5,3.5)/5)*5)};
  }
  const press=Math.min(1,toCall/Math.max(1,pot-toCall));
  const eff=e*(1-0.3*press);
  const odds=toCall/(pot+toCall);
  const need=odds*(G.street==='preflop'?0.62:0.95)+0.02+st.tight*0.5;
  if(info.canRaise&&e>=strong&&rnd<0.3+0.55*st.aggr){
    return{type:'raise',to:(e>=strong+0.18&&rnd<0.25)?info.maxTo:to(R(0.7,1.2))};
  }
  if(eff>=need)return{type:'call'};
  if(toCall<=pot*0.25&&rnd<st.loose)return{type:'call'};
  if(info.canRaise&&post&&rnd<st.bluff*0.3)return{type:'raise',to:to(R(0.7,1.0))};
  return{type:'fold'};
}

function applyAction(G,H,p,act,info){
  let type=act.type;
  if(type==='raise'&&!info.canRaise)type='call';
  if(type==='fold'&&info.toCall===0)type='call';
  const kind=(p.human&&!G.mp)?'you':'';
  if(type==='fold'){
    p.inHand=false;p.acted=true;p.lastAction='폴드';
    H.log(`${p.name} 폴드`,'fold');
    if(p.human&&!G.mp){
      const opps=G.players.filter(o=>!o.human&&o.cards.length);
      for(const o of opps)o.revealed=true;
      if(opps.length)H.log('상대 패 · '+opps.map(o=>`${o.name} ${o.cards.map(cardTxt).join(' ')}`).join(' / '),'street');
    }
    return;
  }
  if(type==='call'){
    const a=commit(G,p,info.toCall);p.acted=true;
    if(info.toCall===0){p.lastAction='체크';H.log(`${p.name} 체크`,kind);}
    else{p.lastAction=p.allIn?`콜 ${a} · 올인`:`콜 ${a}`;H.log(`${p.name} 콜 ${a}${p.allIn?' (올인)':''}`,kind);}
    return;
  }
  let to=Math.round(act.to);
  to=Math.max(info.minTo,Math.min(info.maxTo,to));
  const wasBet=G.currentBet===0;
  commit(G,p,to-p.bet);
  const size=to-G.currentBet;
  if(size>=G.minRaise)G.minRaise=size;
  G.currentBet=Math.max(G.currentBet,to);
  G.aggr=p.id;
  for(const o of G.players)if(o!==p)o.acted=false;
  p.acted=true;
  const verb=wasBet?'벳':'레이즈';
  p.lastAction=p.allIn?`올인 ${to}`:`${verb} ${to}`;
  H.log(`${p.name} ${wasBet?'벳':'레이즈 →'} ${to}${p.allIn?' (올인)':''}`,kind);
}

async function takeTurn(G,H,p){
  G.turn=p.id;
  const toCall=Math.min(G.currentBet-p.bet,p.stack);
  const others=G.players.some(o=>o!==p&&o.inHand&&!o.allIn);
  const maxTo=p.bet+p.stack;
  const minTo=Math.min(G.currentBet+G.minRaise,maxTo);
  const info={toCall,minTo,maxTo,canRaise:others&&maxTo>G.currentBet,currentBet:G.currentBet};
  H.render();
  let act;
  if(p.human)act=await H.askHuman(info,p);
  else{await H.sleep(650+Math.random()*600);act=aiDecide(G,p,info);}
  applyAction(G,H,p,act,info);
  G.turn=-1;
  H.render();
}

async function bettingRound(G,H,start){
  const P=G.players,n=P.length;
  const c0=P.filter(p=>p.inHand&&!p.allIn);
  if(c0.length===0)return;
  if(c0.length===1&&c0[0].bet>=G.currentBet)return;
  let idx=start;
  G.idx=idx;H.save&&H.save();
  while(true){
    if(P.filter(p=>p.inHand).length<=1)return;
    const can=P.filter(p=>p.inHand&&!p.allIn);
    if(can.every(p=>p.acted&&p.bet===G.currentBet))return;
    const p=P[idx];
    if(p.inHand&&!p.allIn&&!(p.acted&&p.bet===G.currentBet)){
      await takeTurn(G,H,p);
      idx=(idx+1)%n;
      G.idx=idx;H.save&&H.save();
    }else idx=(idx+1)%n;
  }
}

async function finishHand(G,H){
  const P=G.players,n=P.length;
  G.street='over';G.turn=-1;
  const live=P.filter(p=>p.inHand);
  if(live.length===1){
    const w=live[0];
    w.stack+=G.pot;w.won+=G.pot;
    G.result={text:`${w.name} 승리 · +${G.pot}`,winners:[w.id],showdown:false};
    H.log(`${w.name} 모두 폴드시키고 ${G.pot} 획득`,'win');
  }else{
    G.showdown=true;
    for(const p of live){p.revealed=true;p.ev=evaluate(p.cards.concat(G.board));p.bestName=handName(p.ev);}
    H.render();await H.sleep(900);
    for(const p of live)H.log(`${p.name}: ${p.cards.map(cardTxt).join(' ')} → ${p.bestName}`,'street');
    const pots=buildPots(P,G.pot);
    for(const pt of pots){
      let winners;
      if(pt.elig.length===1){
        winners=[pt.elig[0]];
        winners[0].stack+=pt.amount;winners[0].returned+=pt.amount;
        continue;
      }
      let best=null;
      for(const p of pt.elig)if(!best||cmp(p.ev.score,best)>0)best=p.ev.score;
      winners=pt.elig.filter(p=>cmp(p.ev.score,best)===0);
      winners.sort((a,b)=>((a.id-G.dealer-1+n)%n)-((b.id-G.dealer-1+n)%n));
      const share=Math.floor(pt.amount/winners.length);
      let rem=pt.amount-share*winners.length;
      for(const w of winners){const g=share+(rem>0?1:0);if(rem>0)rem--;w.stack+=g;w.won+=g;}
    }
    const ws=P.filter(p=>p.won>0).sort((a,b)=>b.won-a.won);
    G.result={text:ws.map(w=>`${w.name} +${w.won} (${w.bestName})`).join(' · '),winners:ws.map(w=>w.id),showdown:true};
    for(const w of ws)H.log(`${w.name} +${w.won} 획득 (${w.bestName})`,'win');
    for(const p of P)if(p.returned>0)H.log(`${p.name} 미콜 베팅 ${p.returned} 반환`,'');
  }
  G.pot=0;
  H.render();
}

async function playHand(G,H,resume){
  const P=G.players;
  if(!resume){
  G.handNo++;
  const lv=Math.min(LEVELS.length-1,Math.floor((G.handNo-1)/HANDS_PER_LEVEL));
  G.level=lv;G.sb=LEVELS[lv][0];G.bb=LEVELS[lv][1];
  for(const p of P)Object.assign(p,{cards:[],bet:0,total:0,inHand:p.stack>0,out:p.stack<=0,allIn:false,acted:false,lastAction:'',revealed:false,won:0,returned:0,bestName:'',ev:null});
  Object.assign(G,{board:[],pot:0,currentBet:0,minRaise:G.bb,street:'preflop',turn:-1,result:null,showdown:false,aggr:-1,runout:false,idx:0});
  G.dealer=nextIdx(G,G.dealer,p=>p.inHand);
  const alive=P.filter(p=>p.inHand).length;
  G.sbI=alive===2?G.dealer:nextIdx(G,G.dealer,p=>p.inHand);
  G.bbI=nextIdx(G,G.sbI,p=>p.inHand);
  H.log(`핸드 #${G.handNo} · 블라인드 ${G.sb}/${G.bb}`,'hand');
  commit(G,P[G.sbI],G.sb);commit(G,P[G.bbI],G.bb);
  G.currentBet=Math.max(...P.map(p=>p.bet));
  P[G.sbI].lastAction=`SB ${P[G.sbI].bet}`;
  P[G.bbI].lastAction=`BB ${P[G.bbI].bet}`;
  G.deck=shuffle(newDeck());
  for(let r=0;r<2;r++)for(const p of P)if(p.inHand)p.cards.push(G.deck.pop());
  if(!G.mp)H.log(`내 카드: ${P[0].cards.length?P[0].cards.map(cardTxt).join(' '):'—'}`,'you');
  H.render();await H.sleep(800);
  }

  const streets=[['preflop',0],['flop',3],['turn',1],['river',1]];
  let runout=!!G.runout;
  let first=!!resume;
  for(const [name,nc] of streets){
    if(first&&name!==G.street)continue;
    if(P.filter(p=>p.inHand).length<=1)break;
    G.street=name;
    if(name!=='preflop'&&!first){
      for(const p of P){p.bet=0;p.acted=false;p.lastAction=p.inHand?(p.allIn?'올인':''):'폴드';}
      G.currentBet=0;G.minRaise=G.bb;G.aggr=-1;
      G.deck.pop();
      for(let i=0;i<nc;i++)G.board.push(G.deck.pop());
      H.log(`${name==='flop'?'플랍':name==='turn'?'턴':'리버'} · ${G.board.map(cardTxt).join(' ')}`,'street');
      H.render();await H.sleep(runout?1100:600);
    }
    const start=first?G.idx:(name==='preflop'?nextIdx(G,G.bbI,p=>p.inHand):nextIdx(G,G.dealer,p=>p.inHand));
    first=false;
    await bettingRound(G,H,start);
    if(P.filter(p=>p.inHand).length>1&&P.filter(p=>p.inHand&&!p.allIn).length<=1&&!runout){
      runout=true;G.runout=true;
      for(const p of P)if(p.inHand)p.revealed=true;
      H.render();await H.sleep(900);
    }
  }
  await finishHand(G,H);
  H.save&&H.save();
}
/* ---- 코칭: 승률의 근거와 생각할 점 (순수 함수) ---- */
function ncr2(n){return n*(n-1)/2;}
function hitChance(outs,U,toCome){
  if(outs<=0)return 0;
  if(toCome===1)return outs/U;
  return 1-ncr2(U-outs)/ncr2(U);
}
/* Chen 공식: 시작 패의 강도를 점수로 */
function chenScore(cs){
  const val=r=>r===14?10:r===13?8:r===12?7:r===11?6:r/2;
  const hi=Math.max(cs[0].r,cs[1].r),lo=Math.min(cs[0].r,cs[1].r);
  let s=val(hi);
  if(hi===lo)s=Math.max(5,val(hi)*2);
  else{
    if(cs[0].s===cs[1].s)s+=2;
    const gap=hi-lo-1;
    s-=gap===0?0:gap===1?1:gap===2?2:gap===3?4:5;
    if(gap<=1&&hi<12)s+=1;
  }
  return Math.ceil(s);
}
/* 내 카드가 족보 형성에 쓰였는지 (킥커만 다른 경우는 제외) */
const DEF_LEN=[0,2,3,2,2,6,3,2,2];
function sameMade(a,b){
  if(a.cat!==b.cat||a.cat<1)return false;
  const n=DEF_LEN[a.cat];
  for(let i=0;i<n;i++)if(a.score[i]!==b.score[i])return false;
  return true;
}
function coachAnalyze(o){
  const why=[],think=[];
  const add=(tone,text)=>why.push({tone,text});
  const hole=o.hole,board=o.board,pot=o.pot,toCall=o.toCall,opps=Math.max(1,o.opps),eq=o.eq;
  const pct=x=>Math.round(x*100);
  const fair=1/(opps+1);
  const pre=board.length===0;
  const hr=hole.map(c=>c.r);
  let drawShown=false,drawPct=0;

  /* 1) 내 패 */
  if(pre){
    const hi=Math.max(hr[0],hr[1]),lo=Math.min(hr[0],hr[1]);
    const pair=hi===lo,suited=hole[0].s===hole[1].s,gap=hi-lo-1;
    const sc=chenScore(hole);
    const tier=sc>=12?'프리미엄 핸드':sc>=9?'강한 편':sc>=6?'보통 (자리와 상황에 따라 플레이)':'약한 편';
    const nm=pair?`포켓 페어 ${rankCh(hi)}${rankCh(hi)}`:`${rankCh(hi)}${rankCh(lo)} ${suited?'수티드':'오프수트'}`;
    add(sc>=9?'good':sc>=6?'info':'warn',`${nm}: Chen 점수 ${sc}점 → ${tier}`);
    if(pair){
      add('good','포켓 페어는 플랍에서 셋(트리플)이 될 확률이 약 12%예요');
      if(hi<=7)add('warn','작은 포켓 페어는 공용 카드에 높은 카드가 깔리면 약해져요');
    }else{
      if(suited)add('info','같은 무늬라서 플러시를 노릴 수 있고 승률이 조금 올라가요');
      if(gap<=1)add('info',gap===0?'숫자가 이어져 있어요. 스트레이트를 노릴 수 있어요':'숫자가 한 칸 떨어져 있어요. 스트레이트를 노릴 수 있어요');
      if(lo>=10)add('info','높은 카드 둘이에요. 페어를 맞추면 탑 페어가 돼요');
      if(hi===14&&lo<=9&&!suited)add('warn','약한 에이스예요. 에이스 페어를 맞춰도 더 좋은 킥커의 에이스에게 질 수 있어요');
      if(sc<6&&!suited&&gap>1)add('bad','높지도 이어지지도 않은 패예요. 맞춰도 큰 팟에서 지기 쉬워요');
    }
  }else{
    const all=hole.concat(board);
    const ev=evaluate(all),evB=evaluate(board);
    const name=handName(ev);
    const bRanks=[...new Set(board.map(c=>c.r))].sort((a,b)=>b-a);
    const bTop=bRanks[0];
    if(sameMade(ev,evB)){
      add('bad',`지금 ${name}은 공용 카드만으로 만들어진 족보예요. 내 패는 도움이 안 돼요`);
    }else if(ev.cat===0){
      add('warn',`아직 아무것도 못 만들었어요 (내 가장 높은 카드 ${rankCh(Math.max(hr[0],hr[1]))})`);
    }else if(ev.cat===1){
      const pr=ev.score[1],pocket=hr[0]===hr[1];
      if(!hr.includes(pr)){
        add('warn',`공용 카드의 페어(${rankCh(pr)})에 내 킥커 ${rankCh(Math.max(hr[0],hr[1]))}가 더해졌어요. 사실상 높은 카드 싸움이에요`);
      }else if(pocket){
        if(pr>bTop)add('good',`오버페어 ${rankCh(pr)}${rankCh(pr)}: 내 포켓 페어가 공용 카드보다 높아요`);
        else add('warn',`포켓 페어 ${rankCh(pr)}${rankCh(pr)}가 공용 카드의 높은 카드보다 낮아요`);
      }else{
        const kicker=hr[0]===pr?hr[1]:hr[0];
        if(pr===bTop)add(kicker>=11?'good':'info',`탑 페어(${rankCh(pr)}), 킥커 ${rankCh(kicker)}${kicker>=11?'':'. 킥커가 약해서 같은 페어에게 져요'}`);
        else if(pr===bRanks[1])add('warn',`미들 페어(${rankCh(pr)}): 공용 카드에 더 높은 카드가 있어요`);
        else add('bad',`가장 낮은 페어(${rankCh(pr)}): 이기는 경우가 제한적이에요`);
      }
    }else if(ev.cat===2){
      const used=[ev.score[1],ev.score[2]].filter(r=>hr.includes(r)).length;
      if(used===2)add('good','투 페어: 내 두 장을 모두 써서 만들었어요');
      else add('info','투 페어지만 한 쌍은 공용 카드에서 나왔어요. 상대와 공유하는 쌍이에요');
    }else if(ev.cat===3){
      const mine=hr.filter(r=>r===ev.score[1]).length;
      if(mine===2)add('good','셋: 포켓 페어에 공용 카드 1장이 붙었어요. 상대가 알아채기 어려운 강한 패예요');
      else add('good','트립스: 공용 카드의 페어에 내 한 장이 붙었어요. 같은 카드를 가진 상대와는 킥커 싸움이에요');
    }else if(ev.cat===4){
      add('good','스트레이트 완성');
    }else if(ev.cat===5){
      const ss=SUITS.find(s=>all.filter(c=>c.s===s).length>=5);
      if(hole.some(c=>c.s===ss&&c.r===14))add('good','A 하이 플러시: 가장 높은 플러시예요');
      else add('good','플러시 완성. 더 높은 플러시를 가진 상대가 있을 수 있어요');
    }else{
      add('good',`${name}: 매우 강한 족보예요`);
    }

    /* 아웃츠: 아직 카드가 더 나올 때 */
    if(board.length<5&&ev.cat<4){
      const used=new Set(all.map(c=>c.r*10+SUITS.indexOf(c.s)));
      let outs=0,fl=0,st=0,pr=0,U=0;
      for(const s of SUITS)for(let r=2;r<=14;r++){
        if(used.has(r*10+SUITS.indexOf(s)))continue;
        U++;
        const c={r,s};
        const evN=evaluate(all.concat(c));
        if(evN.cat<=ev.cat)continue;
        if(sameMade(evN,evaluate(board.concat(c))))continue;
        outs++;
        if(evN.cat===5||evN.cat===8)fl++;else if(evN.cat===4)st++;else pr++;
      }
      if((fl+st>0||ev.cat===0)&&outs>=3){
        const parts=[];
        if(fl)parts.push(fl>=9?`플러시 드로우 ${fl}장`:`플러시 ${fl}장`);
        if(st)parts.push(st>=8?`양쪽 스트레이트 드로우 ${st}장`:st===4?`한쪽(거트샷) 스트레이트 ${st}장`:`스트레이트 ${st}장`);
        if(pr)parts.push(`페어 이상 ${pr}장`);
        const left=5-board.length;
        drawPct=hitChance(outs,U,left);
        drawShown=true;
        add(fl+st>=8?'good':'info',`아웃 ${outs}장 (${parts.join(' · ')}) → ${left===2?'리버까지':'리버 한 장에'} 맞을 확률 약 ${pct(drawPct)}%`);
      }
    }
  }

  /* 2) 팟 오즈와 평균 승률 */
  if(o.allIn){
    add('info',`올인한 상태예요. 남은 카드로 승부가 갈려요 (내 승률 ${pct(eq)}%)`);
  }else if(toCall>0){
    const need=toCall/(pot+toCall);
    const diff=eq-need;
    add('info',`콜 금액 ${toCall} / 콜 후 팟 ${pot+toCall} → 필요 승률 ${pct(need)}% (내 승률 ${pct(eq)}%)`);
    if(diff>=0.05)add('good','승률이 필요 승률보다 높아요. 콜하면 평균적으로 이득이에요');
    else if(diff>=-0.05)add('warn','승률이 필요 승률과 거의 같아요. 포지션과 상대 성향이 판단 기준이에요');
    else add('bad','승률이 필요 승률보다 낮아요. 드로우가 있다면 맞췄을 때 얼마를 더 받을지(임플라이드 오즈)를 따져 보세요');
    if(o.raised)add('info','이 승률은 상대가 아무 패나 들었다고 가정한 값이에요. 상대가 베팅했다면 실제 승률은 더 낮을 수 있어요');
  }else{
    if(eq>=fair+0.15)add('good',`체크는 공짜예요. 그래도 내 승률 ${pct(eq)}%는 평균 ${pct(fair)}%보다 훨씬 높아서 베팅해 팟을 키울 후보예요`);
    else if(eq<fair)add('info',`체크는 공짜예요. 내 승률 ${pct(eq)}%는 평균 ${pct(fair)}%보다 낮아서 돈을 더 넣을 이유가 약해요`);
    else add('info',`체크는 공짜예요. 승률이 평균 ${pct(fair)}% 근처라 작게 베팅하거나 체크할 수 있는 구간이에요`);
  }
  add('info',`남은 상대 ${opps}명: 아무 패나 들면 평균 승률은 ${pct(fair)}%예요`);

  /* 3) 공용 카드의 위험 */
  if(!pre){
    const ev=evaluate(hole.concat(board));
    const sc={s:0,h:0,d:0,c:0};
    board.forEach(c=>sc[c.s]++);
    const ms=SUITS.reduce((a,s)=>sc[s]>sc[a]?s:a,'s');
    if(sc[ms]>=3&&ev.cat<5){
      const mine=hole.filter(c=>c.s===ms).length;
      add('warn',`공용 카드에 같은 무늬 ${sc[ms]}장: 상대가 플러시를 가졌을 수 있어요${mine?'':' (내 패에는 그 무늬가 없어요)'}`);
    }
    const rs=new Set(board.map(c=>c.r));if(rs.has(14))rs.add(1);
    let sw=false;
    for(let lo=1;lo<=10;lo++){let k=0;for(let r=lo;r<lo+5;r++)if(rs.has(r))k++;if(k>=3)sw=true;}
    if(sw&&ev.cat<4)add('warn','공용 카드가 이어져 있어서 상대가 스트레이트를 가졌을 수 있어요');
    if(new Set(board.map(c=>c.r)).size<board.length&&ev.cat<6)add('warn','공용 카드에 페어가 있어요. 상대가 트리플이나 풀하우스일 수 있어요');
  }

  /* 4) 자리와 칩 */
  const pos=o.pos||{};
  if(pos.role==='BTN')add('good','버튼: 플랍 이후 가장 늦게 행동해서 정보가 가장 많아요');
  else if(pos.role==='SB')add('warn','스몰 블라인드: 플랍 이후 가장 먼저 행동해서 불리해요');
  else if(pos.role==='BB')add('info',`빅 블라인드: 이미 ${o.bb}을 냈어요. 그만큼 팟 오즈가 유리해져요`);
  else if(!pre&&pos.order==='last')add('good','남은 사람 중 내가 마지막에 행동해요. 상대 행동을 보고 정할 수 있어요');
  else if(!pre&&pos.order==='first')add('warn','남은 사람 중 내가 가장 먼저 행동해요. 정보가 부족해요');
  const bbs=Math.round(o.stack/o.bb*10)/10;
  if(o.stack>0&&bbs<=10)add('warn',`내 칩은 ${bbs}BB뿐이에요. 이제는 올인 아니면 폴드가 기본이에요`);
  else if(o.stack>0&&bbs<=20)add('warn',`내 칩은 ${bbs}BB로 얕아요. 레이즈는 곧 올인이 되기 쉬워요`);

  /* 지금 생각할 것 */
  if(o.allIn){
    think.push('올인하기 전에 필요 승률과 내 승률을 비교했나요? 결과와 상관없이 그 판단이 맞았는지 복기해 보세요');
  }else if(pre){
    if(o.raised)think.push(`${o.aggrName||'상대'}의 레이즈는 어떤 패일까요? 내 패는 그 범위에서 어디쯤인가요?`);
    else if(toCall===0&&pos.role==='BB')think.push('아무도 올리지 않았어요. 공짜로 플랍을 볼까요, 올려서 주도권을 잡을까요?');
    else think.push('이 자리에서 이 패로 들어가도 되는 기준을 넘나요? 내 뒤에 행동할 사람은 몇 명인가요?');
    think.push('들어간다면 플랍 이후에 어떻게 이길 계획인가요? (페어 · 드로우 · 상대가 포기)');
  }else if(toCall>0){
    think.push(`${o.aggrName||'상대'}는 왜 이 금액을 걸었을까요? (강한 패 · 드로우 · 블러프)`);
    if(drawShown)think.push(`드로우가 맞을 확률(${pct(drawPct)}%)과 필요 승률(${pct(toCall/(pot+toCall))}%) 중 어느 쪽이 큰가요?`);
    else think.push('콜한다면 다음 카드에서 내가 이기는 경우는 언제인가요? 못 이기면 접을 건가요?');
  }else if(eq>=fair+0.15){
    think.push('지금 베팅하면 어떤 패가 콜할까요? 약한 패를 접게 하고 싶은가요, 강한 패에게 돈을 받고 싶은가요?');
  }else{
    think.push('체크하면 공짜 카드를 볼 수 있어요. 상대가 베팅하면 접을 준비가 됐나요?');
  }
  if(opps>=2)think.push(`상대가 ${opps}명이에요. 그중 한 명이라도 나보다 강할 가능성을 얼마나 보나요?`);

  return{why:why.slice(0,9),think:think.slice(0,3)};
}

module.exports={createGame,playHand,setEqScale};
