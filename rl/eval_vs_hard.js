// 评测：网络 对 「困难」档（推演）。用法：MODEL=ddz_nn.bin node eval_vs_hard.js <推演毫秒> <副数>
// 输出 JSON：网络当地主/农民 对 困难 的胜场，以及 困难 对 困难 的地主胜场（基线）。同一副牌换位各打一次；建议多进程并行，合计 ≥250 副。
const path=require('path').join(__dirname,'..')+'/';
const DDZ=require(path+'engine.js'); const NN=require(path+'nn.js'); const fs=require('fs');
const b=fs.readFileSync(process.env.MODEL||(path+'ddz_nn.bin')); const model=NN.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const MS=+process.argv[2]||500, N=+process.argv[3]||20;
function playGame(deck, agents){
  const hands=[deck.slice(0,17),deck.slice(17,34),deck.slice(34,51)].map(DDZ.sortHand); const bottom=deck.slice(51);
  hands[0]=DDZ.sortHand(hands[0].concat(bottom));
  const played=new Array(18).fill(0), playedBy=[0,1,2].map(()=>new Array(18).fill(0));
  let last=null,lastBy=-1,passes=0,turn=0,bombs=0,history=[],steps=0;
  while(steps++<400){
    const p=turn; const ctx={hand:hands[p],last:last&&last.info,lastBy,me:p,landlord:0,counts:hands.map(h=>h.length),played,playedBy,bottom,passes,level:2,history,bombs};
    const ag=agents[p]; let mv;
    if(ag==='nn') mv=NN.pick(model,ctx,DDZ); else if(ag==='hard') mv=DDZ.aiPlayMC(ctx,Math.random,{ms:MS}); else mv=DDZ.aiPlay(Object.assign(ctx,{level:ag}));
    if(mv){const info=DDZ.classify(mv.cards);const ids=new Set(mv.cards.map(c=>c.id));hands[p]=hands[p].filter(c=>!ids.has(c.id));
      last={info,cards:mv.cards};lastBy=p;passes=0;for(const c of mv.cards){played[c.rank]++;playedBy[p][c.rank]++;}
      if(info.type==='bomb'||info.type==='rocket')bombs++;history.push({cards:mv.cards});if(!hands[p].length)return p;}
    else{history.push({cards:null});passes++;}
    if(passes===2){last=null;passes=0;turn=lastBy;}else turn=(p+1)%3;
  } return -1;
}
let nnLL=0,nnF=0,hardLL=0,hardF=0;
for(let i=0;i<N;i++){ const d=DDZ.shuffle(DDZ.newDeck());
  if(playGame(d.slice(),['nn','hard','hard'])===0) nnLL++;       // 网络当地主
  if(playGame(d.slice(),['hard','nn','nn'])!==0) nnF++;           // 网络当农民
  if(playGame(d.slice(),['hard','hard','hard'])===0) hardLL++;    // 基线：困难 vs 困难（地主胜）
}
console.log(JSON.stringify({N,nnLL,nnF,hardLL}));
