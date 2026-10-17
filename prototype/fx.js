/* Nông Trại DeFi · prototype/fx.js
 * Dynamic effects ("juice") for the village map, driven only through window.FARM hooks.
 *  - Day/night light: one multiply pass from a small cached light buffer (dawn, day, golden hour,
 *    dusk, night) with warm window/lantern pools, the player's lantern and faint moonlight.
 *  - Weather: layered slanted rain, splashes and pond ripples, wet paths with puddles, overcast,
 *    storm lightning with a short shake (none of that under prefers-reduced-motion).
 *  - Ambient life: butterflies, fireflies, pollen, falling orchard leaves, kitchen smoke,
 *    cloud shadows, pond glints, ripples, fish jumps, passing birds.
 *  - Interaction feedback: footstep dust, golden zone ring + bouncing chevron, particle bursts and
 *    pop-in floaters, glowing letters with sparkle trails and landing flashes, gate shimmer.
 *  - Ripe trees twinkle, the lettuce field shimmers when yield piles up, vignette + light grading.
 * Public: window.FarmFX (visual time of day for HUD/minimap, burst/ring/shake helpers, stats).
 * Never mutates the map or the simulation; everything is pooled, culled and capped. */
(()=>{
'use strict';
const F=window.FARM;
if(!F||typeof F.on!=='function'||window.FarmFX)return;

/* ================================================================ shorthands */
const T=F.T||32,W=F.W||46,H=F.H||30;
const TL=F.TILE||{G:0,P:1,WA:2,D:3,F:4,B:5,PL:6,SA:7,K:8};
const map=F.map,st=F.st,player=F.player,butler=F.butler||{x:0,y:0,walk:0,dir:1},cam=F.cam,shake=F.shake;
const letters=F.letters||[],floaters=F.floaters||[],FLAGS=F.FLAGS||{},cv=F.cv;
if(!map||!st||!player||!cam||!shake||!cv)return;
const REDUCE=!!F.reduce,Q=REDUCE?.25:1;
const R=Math.random,PI=Math.PI,TAU=PI*2;
const sin=Math.sin,cos=Math.cos,sqrt=Math.sqrt,abs=Math.abs,round=Math.round,floor=Math.floor,min=Math.min,max=Math.max;
const rr=(a,b)=>a+(b-a)*R();
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,k)=>a+(b-a)*k;
const sstep=(a,b,v)=>{const x=clamp((v-a)/(b-a),0,1);return x*x*(3-2*x)};
const frac=v=>v-floor(v);
const backOut=k=>{const c=1.70158,u=k-1;return 1+(c+1)*u*u*u+c*u*u};
const hsh=typeof F.hsh==='function'?F.hsh:((x,y,s=0)=>{let h=(x*374761393+y*668265263+s*982451653)|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295});
const tileW=(wx,wy)=>{const x=floor(wx/T),y=floor(wy/T);return(x<0||y<0||x>=W||y>=H)?-1:map[y*W+x]};
const isRipe=l=>{try{return!!l&&typeof F.ripe==='function'&&F.ripe(l)}catch(e){return false}};
const SPOTS=F.SPOTS||[],BEDS=F.BEDS||[];
const cntRate=(rate,dt)=>{const v=rate*dt;let n=floor(v);if(R()<v-n)n++;return n};
function ell(g,x,y,rx,ry){g.beginPath();g.ellipse(x,y,rx>.1?rx:.1,ry>.1?ry:.1,0,0,TAU)}

/* ================================================================ sprites (pre-rendered once) */
function mk(w,h){const c=document.createElement('canvas');c.width=max(1,w|0);c.height=max(1,h|0);return{c,g:c.getContext('2d')}}
/** soft radial blob, dithered so large upscales never band */
function radial(size,r,g,b,pow,peak){
  const o=mk(size,size),x=o.g;if(!x)return o.c;
  try{
    const id=x.createImageData(size,size),d=id.data,h=size/2;
    for(let j=0;j<size;j++)for(let i=0;i<size;i++){
      const dx=(i+.5-h)/h,dy=(j+.5-h)/h,q=1-sqrt(dx*dx+dy*dy);
      const a=q<=0?0:Math.pow(q*q*(3-2*q),pow)*peak,k=(j*size+i)*4;
      d[k]=r;d[k+1]=g;d[k+2]=b;d[k+3]=a<=0?0:min(255,floor(a*255+R()));
    }
    x.putImageData(id,0,0);
  }catch(e){
    const gr=x.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
    gr.addColorStop(0,'rgba('+r+','+g+','+b+','+peak+')');gr.addColorStop(1,'rgba('+r+','+g+','+b+',0)');
    x.fillStyle=gr;x.fillRect(0,0,size,size);
  }
  return o.c;
}
const PUFF={dust:0,sand:1,stone:2,grass:3,smoke:4,spray:5,wood:6,steam:7};
const G_GOLD=0,G_WARM=1,G_SKY=2,G_FIRE=3,G_RED=4,G_WHITE=5,G_MOON=6,G_GREEN=7;
const SP={
  puff:[radial(32,222,196,148,1.3,1),radial(32,238,222,172,1.3,1),radial(32,214,210,198,1.3,1),radial(32,182,208,132,1.3,1),
        radial(32,232,232,226,1.1,1),radial(32,214,238,250,1.3,1),radial(32,200,160,110,1.3,1),radial(32,250,250,246,1.1,1)],
  glow:[radial(64,255,204,92,2,1),radial(64,255,170,80,2,1),radial(64,120,200,245,2,1),radial(64,196,255,110,2.2,1),
        radial(64,255,96,72,2,1),radial(64,255,248,230,2,1),radial(64,200,220,255,2,1),radial(64,140,235,120,2,1)],
  /* light pools painted into the light buffer: lamp, player lantern, red beacon, cool */
  pool:[radial(64,255,212,156,.9,1),radial(64,255,232,190,.9,1),radial(64,255,160,150,.9,1),radial(64,200,218,255,.9,1)],
  moon:radial(64,182,202,250,.7,1),
  haze:[radial(64,255,184,96,1.2,1),radial(64,255,146,150,1.2,1)],
  cloud:[],band:null
};
for(let s=0;s<3;s++){
  const o=mk(128,64),g=o.g;if(!g){SP.cloud.push(o.c);continue}
  for(let i=0;i<7;i++){
    const cx=22+hsh(i,s,1)*84,cy=22+hsh(i,s,2)*20,r=13+hsh(i,s,3)*15;
    const gr=g.createRadialGradient(cx,cy,0,cx,cy,r);
    gr.addColorStop(0,'rgba(10,32,22,1)');gr.addColorStop(.55,'rgba(10,32,22,.7)');gr.addColorStop(1,'rgba(10,32,22,0)');
    g.fillStyle=gr;g.beginPath();g.arc(cx,cy,r,0,TAU);g.fill();
  }
  SP.cloud.push(o.c);
}
{ // a slanted light band that sweeps across the lettuce field when yield piles up
  const o=mk(160,256),g=o.g;
  if(g){const gr=g.createLinearGradient(-26,0,26,0);
    gr.addColorStop(0,'rgba(255,236,150,0)');gr.addColorStop(.5,'rgba(255,236,150,.9)');gr.addColorStop(1,'rgba(255,236,150,0)');
    g.fillStyle=gr;for(let y=0;y<256;y+=4){g.setTransform(1,0,0,1,130-y*.4,y);g.fillRect(-26,0,52,4)}g.setTransform(1,0,0,1,0,0)}
  SP.band=o.c;
}

/* palettes (constant strings, so no per-frame string building) */
const GOLDS=['#f2c14e','#fff3b0','#ffd76a','#ffffff'];
const SKIES=['#cfeffa','#ffffff','#8fd0e4'];
const GREENS=['#86d36f','#5fae4c','#a6e08c'];
const REDS=['#e8604a','#ff9a86','#b8432f'];
const WHITES=['#ffffff','#fff6d8','#f3ecd9'];
const WATERS=['#8fd0e4','#cfeffa','#ffffff'];
const LEAVES=['#d9a441','#c8743a','#8fbf4a','#e3c35a','#7fb24a'];
const BF=[['#fff6e0','#f2c14e'],['#f6a04d','#8a4a1e'],['#a7d8f0','#3d6f9e'],['#ffffff','#d0d0c8'],['#f7b6d2','#b35a86']];
const pick=a=>a[floor(R()*a.length)];

/* ================================================================ particle pool */
const DUST=1,SPLASH=2,RIPPLE=3,GLINT=4,LEAF=5,SMOKE=6,BFLY=7,FFLY=8,POLLEN=9,SPARK=10,GLOW=11,RING=12,COIN=13,SHARD=14,BLEAF=15,DROP=16;
/* pass: 1 ground (under sprites) · 2 world (over sprites) · 3 ambient glow (after night light) · 5 juice glow · 4 juice solid */
const PASS=new Uint8Array(17);
PASS[DUST]=PASS[SPLASH]=PASS[RIPPLE]=PASS[GLINT]=1;
PASS[LEAF]=PASS[SMOKE]=PASS[BFLY]=2;
PASS[FFLY]=PASS[POLLEN]=3;
PASS[SPARK]=PASS[GLOW]=PASS[RING]=5;
PASS[COIN]=PASS[SHARD]=PASS[BLEAF]=PASS[DROP]=4;
const AMBIENT=new Uint8Array(17);AMBIENT[BFLY]=AMBIENT[FFLY]=AMBIENT[POLLEN]=AMBIENT[GLINT]=AMBIENT[LEAF]=AMBIENT[SMOKE]=1;
const MAXP=REDUCE?100:400,RESERVE=floor(MAXP*.3);
const pool=new Array(MAXP),freeIx=new Int16Array(MAXP),cnt=new Int16Array(17);
let freeTop=0;
for(let i=0;i<MAXP;i++){pool[i]={i,a:0,k:0,x:0,y:0,z:0,vx:0,vy:0,vz:0,t:0,l:1,s:1,r:0,vr:0,al:1,g:0,q:0,hx:0,hy:0,gi:0,c:'#fff'};freeIx[freeTop++]=MAXP-1-i}
function spawn(k){
  if(freeTop===0)return null;
  const p=pool[freeIx[--freeTop]];
  p.a=1;p.k=k;p.t=0;p.l=1;p.z=0;p.vx=0;p.vy=0;p.vz=0;p.s=1;p.r=0;p.vr=0;p.al=1;p.g=0;p.q=0;p.gi=0;
  cnt[k]++;return p;
}
/** ambient spawns never eat the last 30% of the pool, so bursts always have room */
const spawnAmb=k=>freeTop>RESERVE?spawn(k):null;
function kill(p){if(!p.a)return;p.a=0;cnt[p.k]--;freeIx[freeTop++]=p.i}

/* ================================================================ view */
let sc=1,vx0=0,vy0=0,vx1=1,vy1=1,TNOW=0;
function updView(){
  const z=+F.zoom||1,d=+F.dpr||1;sc=z*d;if(!(sc>0))sc=1;
  vx0=cam.x-shake.x;vy0=cam.y-shake.y;vx1=vx0+(cv.width||1)/sc;vy1=vy0+(cv.height||1)/sc;
}
const inView=(x,y,m)=>x>vx0-m&&x<vx1+m&&y>vy0-m&&y<vy1+m;
const rectView=(x0,y0,x1,y1)=>x1>vx0&&x0<vx1&&y1>vy0&&y0<vy1;
let RTX=0,RTY=0;
/** random tile in (or near) the view whose type is in the bitmask */
function randTile(mask,tries,m){
  const x0=max(0,floor((vx0-m)/T)),x1=min(W-1,floor((vx1+m)/T)),y0=max(0,floor((vy0-m)/T)),y1=min(H-1,floor((vy1+m)/T));
  if(x1<x0||y1<y0)return false;
  for(let k=0;k<tries;k++){const x=x0+floor(R()*(x1-x0+1)),y=y0+floor(R()*(y1-y0+1));if(mask&(1<<map[y*W+x])){RTX=x;RTY=y;return true}}
  return false;
}

/* ================================================================ static geometry (from the map) */
const WATER=[],DEEPW=[];
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  if(map[y*W+x]!==TL.WA)continue;
  WATER.push(x,y);
  const w=(a,b)=>{const t=(a<0||b<0||a>=W||b>=H)?-1:map[b*W+a];return t===TL.WA};
  if(w(x-1,y)&&w(x+1,y)&&w(x,y-1)&&w(x,y+1))DEEPW.push(x,y);
}
let PX0=W*T,PY0=H*T,PX1=0,PY1=0;
for(let i=0;i<WATER.length;i+=2){PX0=min(PX0,WATER[i]*T);PY0=min(PY0,WATER[i+1]*T);PX1=max(PX1,WATER[i]*T+T);PY1=max(PY1,WATER[i+1]*T+T)}
const pondVis=()=>WATER.length>0&&rectView(PX0,PY0,PX1,PY1);
const MOONX=PX0+(PX1-PX0)*.72,MOONY=PY0+T*1.2;
const FIELD=[2*T,2*T,12*T,10*T];
const HOUSES=[[14,3,19,7],[25,19,31,23],[34,18,38,21]];
const GATE={x:22*T,y:1.1*T};

/* lights: FarmArt.lights (world px rects/points, or tiles) when art provides them, else from the default art */
const LIGHTS=[];let lightsFrom='default';
function parseColor(c){
  if(Array.isArray(c)&&c.length>=3)return[c[0]|0,c[1]|0,c[2]|0];
  if(typeof c!=='string')return null;
  const s=c.trim();
  if(s[0]==='#'){
    if(s.length===4||s.length===5)return[parseInt(s[1]+s[1],16),parseInt(s[2]+s[2],16),parseInt(s[3]+s[3],16)];
    if(s.length>=7){const v=[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)];return v.every(n=>n>=0)?v:null}
    return null;
  }
  const m=/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  return m?[+m[1]|0,+m[2]|0,+m[3]|0]:null;
}
function hueSat(r,g,b){
  const mx=max(r,g,b),mn=min(r,g,b),d=mx-mn,s=mx?d/mx:0;let h=0;
  if(d){h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;h*=60;if(h<0)h+=360}
  HUE=h;SAT=s;
}
let HUE=0,SAT=0;
function lightOf(x,y,r,g,i,c,gi,kind){return{x,y,r,g,i,c,gi,kind,f:R()*TAU}}
function defaultLights(){
  const L=[];
  for(const[x0,y0,x1,y1]of HOUSES){
    const X=x0*T,Y=y0*T,Wd=(x1-x0+1)*T,Ht=(y1-y0+1)*T;
    L.push(lightOf(X+25,Y+Ht-23,64,13,1,0,G_WARM,'window'),lightOf(X+Wd-25,Y+Ht-23,64,13,1,0,G_WARM,'window'),lightOf(X+Wd/2,Y+Ht-6,58,10,.75,0,G_WARM,'door'));
  }
  for(const[x,y]of[[14,18.2],[17.2,18.2],[14,21.6],[17.2,21.6]])L.push(lightOf(x*T+1.2*T,y*T+10,76,18,.95,0,G_WARM,'lantern'));
  L.push(lightOf(20.5*T,1.7*T,84,20,1,0,G_WARM,'gate'),lightOf(23.5*T,1.7*T,84,20,1,0,G_WARM,'gate'));
  for(const z of F.ZONES||[])if(z.sx!=null)L.push(lightOf(z.sx*T,z.sy*T-12,46,9,.55,0,G_WARM,'sign'));
  if(WATER.length)L.push(lightOf(7.5*T,20.8*T,66,14,.8,0,G_WARM,'lantern'));
  L.push(lightOf(17*T,3*T-17,32,8,.85,2,G_RED,'beacon'));
  return L;
}
function parseLight(e){
  if(!e)return null;
  let x,y,w=0,h=0,r=null,i=1,col=null,kind='';
  if(Array.isArray(e)){x=+e[0];y=+e[1];if(e.length>2)r=+e[2]}
  else if(typeof e==='object'){
    x=+(e.x??e.cx);y=+(e.y??e.cy);w=+(e.w??e.width??0)||0;h=+(e.h??e.height??0)||0;
    r=e.r??e.radius??null;if(r!=null)r=+r;i=+(e.i??e.intensity??1);col=e.color??e.c??e.col??null;kind=String(e.kind??e.type??'');
  }else return null;
  if(!isFinite(x)||!isFinite(y))return null;
  if(w>0||h>0){x+=w/2;y+=h/2}
  const big=max(w,h);
  if(!(r>0))r=big>0?big*1.6+34:62;
  let c=0,gi=G_WARM;const rgb=parseColor(col);
  if(rgb){hueSat(rgb[0],rgb[1],rgb[2]);
    if(SAT>.25&&(HUE<20||HUE>330)){c=2;gi=G_RED}else if(SAT>.2&&HUE>170&&HUE<270){c=3;gi=G_SKY}else if(SAT>.25&&HUE>=80&&HUE<=170)gi=G_GREEN}
  if(!isFinite(i))i=1;
  return lightOf(x,y,r,big>0?min(28,big*.7+6):clamp(r*.22,6,24),clamp(i,0,1.5),c,gi,kind);
}
function loadLights(){
  let src=null;
  try{const A=window.FarmArt;if(A)src=typeof A.lights==='function'?A.lights(F):A.lights}catch(e){src=null}
  LIGHTS.length=0;
  if(Array.isArray(src)&&src.length){
    let mx=0,my=0;const tmp=[];
    for(const e of src){const L=parseLight(e);if(L){tmp.push(L);mx=max(mx,L.x);my=max(my,L.y)}}
    if(tmp.length){
      const tiles=mx<=W+1&&my<=H+1;
      for(const L of tmp){if(tiles){L.x*=T;L.y*=T;if(L.r<=12)L.r*=T;if(L.g<=4)L.g*=T}LIGHTS.push(L)}
      lightsFrom='art';return;
    }
  }
  for(const L of defaultLights())LIGHTS.push(L);
  lightsFrom='default';
}
/* chimney / cooking smoke sources (world px); FarmArt.chimneys overrides */
const SMOKES=[];
function loadSmokes(){
  SMOKES.length=0;let src=null;
  try{const A=window.FarmArt;if(A)src=typeof A.chimneys==='function'?A.chimneys(F):A.chimneys}catch(e){src=null}
  if(Array.isArray(src))for(const e of src){
    const x=+(Array.isArray(e)?e[0]:e&&e.x),y=+(Array.isArray(e)?e[1]:e&&e.y);
    if(isFinite(x)&&isFinite(y))SMOKES.push({x:x<=W+1?x*T:x,y:y<=H+1?y*T:y,steam:!!(e&&e.steam)});
  }
  if(SMOKES.length)return;
  const[b,c,h]=HOUSES;
  SMOKES.push({x:b[0]*T+(b[2]-b[0]+1)*T*.74,y:b[1]*T+8,steam:false});
  SMOKES.push({x:c[0]*T+(c[2]-c[0]+1)*T*.28,y:c[1]*T+8,steam:false});
  SMOKES.push({x:h[0]*T+(h[2]-h[0]+1)*T*.7,y:h[1]*T+8,steam:false});
  SMOKES.push({x:14*T+16,y:21.6*T+20,steam:true}); // phở pot at the market stall
}
loadLights();loadSmokes();

/* ================================================================ visual clock (time of day) */
/* frac(st.day) is the time of day. In the simulation a day lasts 3 s at 1x, which would strobe;
   so the light follows frac(st.day) exactly when days pass slowly (on-chain: 60 s/day) and caps the
   visual cycle to ~60 s (40 s at 7x) when they pass faster. Paused game = still light. */
const CAP=1/60;
let vt=frac(+st.day||0),lastDay=+st.day||0,rateS=0,pinned=null;
function updClock(dt){
  const day=+st.day||0,d=day-lastDay;lastDay=day;
  if(pinned!=null){vt=pinned;return}
  if(!(dt>0))return;
  if(abs(d)<.5)rateS+=(d/dt-rateS)*min(1,dt*4);
  if(!(d>0)||!(rateS>1e-5))return; // paused (or a backwards correction): the light holds still
  if(rateS>CAP*1.25){vt=frac(vt+CAP*clamp(1+Math.log10(rateS/.3333)*.6,1,1.8)*dt);return}
  const target=frac(day),fwd=frac(target-vt);
  if(fwd<1e-4||fwd>1-1e-4){vt=target;return}
  const step=(rateS+CAP*1.5)*dt;
  if(fwd>.9)vt=(1-fwd)<=step?target:frac(vt-step);
  else vt=fwd<=step?target:frac(vt+step);
}
/* keyframes: hour, multiply r,g,b, lamps, golden, dawn, sun */
const KF=[
  [0,   .50,.57,.84, 1,  0,  0,  0],
  [4.6, .50,.57,.84, 1,  0,  0,  0],
  [5.4, .68,.60,.84, .85,0,  .5, .1],
  [6.2, 1,  .80,.68, .3, 0,  1,  .6],
  [7.3, 1,  .94,.87, 0,  0,  .3, 1],
  [8.6, 1, .985,.955,0,  0,  0,  1],
  [16,  1, .985,.955,0,  0,  0,  1],
  [17,  1,  .93,.78, 0,  .75,0,  1],
  [18,  1,  .80,.66, .25,1,  0,  .7],
  [18.8,.82,.64,.82, .6, .35,0,  .3],
  [19.8,.60,.58,.84, .9, 0,  0,  .05],
  [21,  .50,.57,.84, 1,  0,  0,  0],
  [24,  .50,.57,.84, 1,  0,  0,  0]];
let MR=1,MG=1,MB=1,LAMP=0,GOLD=0,DAWN=0,SUN=1,NIGHT=0,BRIGHT=1;
function updLight(){
  const h=vt*24;let i=0;while(i<KF.length-2&&KF[i+1][0]<=h)i++;
  const a=KF[i],b=KF[i+1],u=clamp((h-a[0])/((b[0]-a[0])||1),0,1),s=u*u*(3-2*u);
  MR=lerp(a[1],b[1],s);MG=lerp(a[2],b[2],s);MB=lerp(a[3],b[3],s);
  LAMP=lerp(a[4],b[4],s);GOLD=lerp(a[5],b[5],s);DAWN=lerp(a[6],b[6],s);SUN=lerp(a[7],b[7],s);
  NIGHT=sstep(.55,1,LAMP);
  const ra=min(1,rainAmt/.62);
  MR*=lerp(1,.84,ra)*lerp(1,.78,stormAmt);MG*=lerp(1,.87,ra)*lerp(1,.80,stormAmt);MB*=lerp(1,.93,ra)*lerp(1,.88,stormAmt);
  let L=.299*MR+.587*MG+.114*MB;
  if(L<.55){const k=.55/L;MR=min(1,MR*k);MG=min(1,MG*k);MB=min(1,MB*k);L=.299*MR+.587*MG+.114*MB} // never darker than ~45%
  BRIGHT=L;
  SUN*=1-.85*ra;GOLD*=1-.8*ra;DAWN*=1-.8*ra;
  LAMP=max(LAMP,stormAmt*.4,ra*.12);
}
function phaseName(h){return h>=4.6&&h<6.9?'Bình minh':h>=6.9&&h<16.3?'Ban ngày':h>=16.3&&h<18.4?'Hoàng hôn':h>=18.4&&h<19.9?'Chạng vạng':'Ban đêm'}

/* ================================================================ weather state */
let rainAmt=0,stormAmt=0,wet=0,wind=8;
function updWeather(dt,t){
  const w=st.weather,tr=w==='bão'?1:w==='mưa'?.62:0,ts=w==='bão'?1:0;
  rainAmt+=(tr-rainAmt)*min(1,dt*.9);stormAmt+=(ts-stormAmt)*min(1,dt*.7);
  if(rainAmt<.002)rainAmt=0;if(stormAmt<.002)stormAmt=0;
  wet=rainAmt>.15?min(1,wet+dt*.22*rainAmt):max(0,wet-dt*.045);
  wind=6+5*sin(t*.07)+stormAmt*50+rainAmt*8;
}

/* lightning + shake */
let boltT=rr(2,4),flashT=-1,shakeT=0,shakeAmp=0,shakeDur=.45,shaking=false,thunderIn=-1;
function updStorm(dt){
  if(stormAmt>.6){boltT-=dt;if(boltT<=0){boltT=REDUCE?rr(9,14):rr(3.5,9);flashT=0;if(!REDUCE)thunderIn=rr(.18,.4)}}
  if(flashT>=0){flashT+=dt;if(flashT>1.3)flashT=-1}
  if(thunderIn>=0){thunderIn-=dt;if(thunderIn<0)kick(2.6,.45)}
}
function flashA(){
  if(flashT<0)return 0;
  if(REDUCE)return sin(PI*min(1,flashT/1.3))*.07; // one slow, soft brightening, never a flash
  const a1=flashT<.3?.5*Math.exp(-flashT*16):0,a2=flashT>.13?.34*Math.exp(-(flashT-.13)*10):0;
  return min(.55,a1+a2);
}
function kick(a,d){if(REDUCE)return;if(a>shakeAmp*(shakeT/shakeDur||0)){shakeAmp=a;shakeDur=d;shakeT=d}}
function updShake(dt){
  if(shakeT>0&&!REDUCE){
    shakeT-=dt;const k=max(0,shakeT/shakeDur),a=shakeAmp*k*k;
    shake.x=round((R()*2-1)*a*2)/2;shake.y=round((R()*2-1)*a*2)/2;shaking=true;
    if(shakeT<=0){shake.x=0;shake.y=0;shaking=false;shakeT=0}
  }else if(shaking){shake.x=0;shake.y=0;shaking=false}
}

/* ================================================================ rain (screen space, 3 depth layers) */
const MAXD=REDUCE?75:300;
const rx=new Float32Array(MAXD),ry=new Float32Array(MAXD),rv=new Float32Array(MAXD),rl=new Float32Array(MAXD),rland=new Float32Array(MAXD),rlay=new Uint8Array(MAXD);
let nDrops=0,slant=.15,rW=0,rH=0;
function resetDrop(i,w,h,d,fresh){
  const lay=i%5<2?0:i%5<4?1:2;rlay[i]=lay;
  rv[i]=(lay===0?520:lay===1?760:1000)+R()*140;
  rl[i]=(lay===0?7:lay===1?12:18)*d*(.8+R()*.4);
  rx[i]=rr(-w*.25,w);ry[i]=fresh?rr(-h*.3,h):-rr(0,h*.35)-rl[i];
  rland[i]=rr(h*.08,h*1.02);
}
function updRain(dt){
  const w=cv.width||1,h=cv.height||1,d=+F.dpr||1;
  if(rW!==w||rH!==h){if(rW>0){const kx=w/rW,ky=h/rH;for(let i=0;i<MAXD;i++){rx[i]*=kx;ry[i]*=ky;rland[i]*=ky}}rW=w;rH=h}
  slant=.1+stormAmt*.32+clamp(wind,0,80)*.0015;
  const target=round(MAXD*clamp(rainAmt,0,1));
  for(let i=nDrops;i<target;i++)resetDrop(i,w,h,d,true);
  nDrops=target;
  for(let i=0;i<nDrops;i++){
    const v=rv[i]*d;ry[i]+=v*dt;rx[i]+=v*slant*dt;
    if(rlay[i]>0&&ry[i]>=rland[i]){if((i&1)===0)landDrop(rx[i],ry[i]);resetDrop(i,w,h,d,false)}
    else if(ry[i]>h+rl[i]||rx[i]>w+80)resetDrop(i,w,h,d,false);
  }
}
function landDrop(sx,sy){
  const wx=sx/sc+vx0,wy=sy/sc+vy0,tt=tileW(wx,wy);
  if(tt<0)return;
  if(tt===TL.WA){if(cnt[RIPPLE]<40*Q)ripple(wx,wy,1,7+R()*4,.55,.5,'#e6f6ff',true);return}
  if(cnt[SPLASH]>=70*Q)return;
  const p=spawnAmb(SPLASH);if(!p)return;
  p.x=wx;p.y=wy;p.l=rr(.16,.24);p.al=tt===TL.G?.45:.7;
}

/* wet ground: a half-resolution sheen layer built from the map on first rain */
let wetC=null;const PUD=new Float32Array(600);let nPud=0;
function buildWet(){
  const S=.5,o=mk(W*T*S,H*T*S),g=o.g;if(!g)return;
  g.setTransform(S,0,0,S,0,0);nPud=0;
  const pud=(cx,cy,rx)=>{const ry=rx*.42;
    g.fillStyle='rgba(88,132,170,.55)';ell(g,cx,cy,rx,ry);g.fill();
    g.fillStyle='rgba(150,192,222,.5)';ell(g,cx-1,cy-.6,rx*.7,ry*.6);g.fill();
    g.fillStyle='rgba(236,248,255,.6)';g.fillRect(cx-rx*.55,cy-ry*.55,rx*.5,1.2);
    if(nPud<200){PUD[nPud*3]=cx;PUD[nPud*3+1]=cy;PUD[nPud*3+2]=rx;nPud++}};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const t=map[y*W+x],px=x*T,py=y*T;
    if(t===TL.P){g.fillStyle='rgba(38,30,24,.24)';g.fillRect(px,py,T,T);if(hsh(x,y,71)<.42)pud(px+7+hsh(x,y,72)*18,py+8+hsh(x,y,73)*16,5+hsh(x,y,74)*8)}
    else if(t===TL.PL){g.fillStyle='rgba(30,36,48,.2)';g.fillRect(px,py,T,T);g.fillStyle='rgba(210,230,248,.24)';g.fillRect(px,py+T-3,T,1);if(hsh(x,y,75)<.22)pud(px+8+hsh(x,y,76)*16,py+9+hsh(x,y,77)*14,4+hsh(x,y,78)*6)}
    else if(t===TL.D){g.fillStyle='rgba(28,16,8,.2)';g.fillRect(px,py,T,T);g.fillStyle='rgba(150,188,215,.22)';for(let k=5;k<T;k+=8)g.fillRect(px,py+k,T,1)}
    else if(t===TL.SA){g.fillStyle='rgba(70,48,18,.16)';g.fillRect(px,py,T,T)}
    else if(t===TL.K){g.fillStyle='rgba(30,18,8,.22)';g.fillRect(px+5,py,T-10,T)}
  }
  wetC=o.c;
}

/* ================================================================ effects state */
let gateFlare=0,fieldS=0,ringZ=null,ringA=0,chevA=0,stepP=-1,stepB=-1,bLastX=butler.x,bLastY=butler.y;
let OK_B=false,OK_F=false,OK_P=false,OK_G=false;
const fish={on:0,x:0,y:0,d:1,t:0,dur:.8,c1:'#f08a3c',c2:'#fff4e6'};let fishT=rr(2,5);
const birds={on:0,x:0,y:0,vx:0,vy:0,d:1,n:0};let birdT=rr(6,12);
const BOFF=[0,0,-13,-8,-13,8,-26,-16,-26,16];
const clouds=[];for(let i=0;i<5;i++)clouds.push({x:rr(-200,W*T),y:rr(-150,H*T-100),s:rr(3.2,5.4),k:i%3,v:rr(.7,1.3)});

/* ================================================================ spawners */
function ripple(x,y,s,grow,life,al,col,amb){const p=amb?spawnAmb(RIPPLE):spawn(RIPPLE);if(!p)return;p.x=x;p.y=y;p.s=s;p.vr=grow;p.l=life;p.al=al;p.c=col}
function glow(x,y,r,life,gi,al){const p=spawn(GLOW);if(!p)return;p.x=x;p.y=y;p.s=r;p.l=life;p.gi=gi;p.al=al}
function ring(x,y,s,grow,life,col,al){const p=spawn(RING);if(!p)return;p.x=x;p.y=y;p.s=s;p.vr=grow;p.l=life;p.c=col;p.al=al==null?.7:al;p.q=.5}
function spark(x,y,col,gi,size,life,vx,vy,amb){const p=amb?spawnAmb(SPARK):spawn(SPARK);if(!p)return null;p.x=x;p.y=y;p.c=col;p.gi=gi;p.s=size;p.l=life;p.vx=vx;p.vy=vy;p.al=1;return p}
function sparks(x,y,n,pal,gi,spd){
  spd=spd||70;
  for(let i=0;i<n;i++){const a=R()*TAU,v=rr(.25,1)*spd;spark(x+rr(-3,3),y+rr(-3,3),pick(pal),gi,R()<.35?2:1,rr(.45,.85),cos(a)*v,sin(a)*v*.8-12)}
}
function solid(k,x,y,pal,vz0,vz1,vxs,g,l0,l1){
  const p=spawn(k);if(!p)return;
  p.x=x+rr(-4,4);p.y=y+20;p.z=20+rr(-3,3);p.vx=rr(-vxs,vxs);p.vy=rr(-12,22);p.vz=rr(vz0,vz1);p.g=g;
  p.vr=rr(7,15)*(R()<.5?-1:1);p.r=R()*TAU;p.l=rr(l0,l1);p.c=pick(pal);
}
/** burst at world px; kind gold|leaf|red|water|spark */
function burst(x,y,kind,n){
  if(!isFinite(x)||!isFinite(y)||!inView(x,y,140))return;
  n=max(2,round((n||12)*Q));
  let gi=G_WHITE,rc='#fff6d8';
  if(kind==='gold'){for(let i=0;i<round(n*.7);i++)solid(COIN,x,y,GOLDS,70,140,55,330,1.1,1.5);sparks(x,y,round(n*.6),GOLDS,G_GOLD);gi=G_GOLD;rc='#f2c14e'}
  else if(kind==='leaf'){for(let i=0;i<n;i++)solid(BLEAF,x,y,GREENS,50,110,55,150,1.2,1.7);sparks(x,y,round(n*.35),['#d8ffc0','#ffffff'],G_GREEN);gi=G_GREEN;rc='#a6e08c'}
  else if(kind==='red'){for(let i=0;i<n;i++)solid(SHARD,x,y,REDS,60,125,70,340,.8,1.1);gi=G_RED;rc='#ff9a86'}
  else if(kind==='water'){for(let i=0;i<n;i++)solid(DROP,x,y,WATERS,60,115,42,360,.7,1);sparks(x,y,round(n*.3),SKIES,G_SKY);gi=G_SKY;rc='#cfeffa'}
  else sparks(x,y,n,WHITES,G_WHITE);
  glow(x,y,24,.5,gi,.55);ring(x,y+18,5,24,.55,rc,.65);
}
function classify(c){
  const rgb=parseColor(String(c||''))||[242,193,78];hueSat(rgb[0],rgb[1],rgb[2]);
  if(SAT<.2)return'spark';
  if(HUE<25||HUE>=330)return'red';
  if(HUE<70)return'gold';
  if(HUE<165)return'leaf';
  if(HUE<260)return'water';
  return'spark';
}
function stepFx(x,y,dir){
  if(!inView(x,y,40))return;
  const tt=tileW(x,y);
  if(tt===TL.WA||tt<0)return;
  if(wet>.35&&tt!==TL.G&&tt!==TL.D){
    ripple(x+rr(-3,3),y+1,1,5,.35,.5,'#e6f6ff',false);
    for(let i=0;i<(REDUCE?1:2);i++){const p=spawn(DROP);if(!p)break;p.x=x+rr(-3,3);p.y=y;p.z=1;p.vx=rr(-22,22)-dir*8;p.vy=rr(-6,6);p.vz=rr(30,55);p.g=300;p.l=rr(.3,.45);p.c=pick(WATERS)}
    return;
  }
  const pi=tt===TL.P?PUFF.dust:tt===TL.SA?PUFF.sand:tt===TL.PL?PUFF.stone:tt===TL.K?PUFF.wood:tt===TL.D?PUFF.wood:PUFF.grass;
  for(let i=0;i<(REDUCE?1:2);i++){
    const p=spawn(DUST);if(!p)return;
    p.x=x+rr(-4,4)-dir*2;p.y=y+rr(-1,1.5);p.vx=-dir*rr(6,16)+rr(-6,6);p.vy=rr(-4,2);p.vz=rr(4,9);
    p.s=rr(3,4.6);p.l=rr(.4,.62);p.gi=pi;p.al=pi===PUFF.grass?.32:.55;
  }
}

/* ================================================================ per-frame update */
function updNear(dt){
  const z=F.near;if(z)ringZ=z;
  ringA+=((z?1:0)-ringA)*min(1,dt*10);
  const open=!!(ringZ&&F.current===ringZ.id);
  chevA+=((z&&!open?1:0)-chevA)*min(1,dt*10);
  if(!z&&ringA<.005){ringZ=null;ringA=0;chevA=0}
}
function footsteps(){
  if(player.moving){const s=floor((+player.walk||0)/PI);if(s!==stepP){stepP=s;stepFx(player.x*T,player.y*T,player.dir||1)}}else stepP=-1;
  if(st.butler&&st.butler.hired){
    const moved=abs(butler.x-bLastX)+abs(butler.y-bLastY)>.0005;bLastX=butler.x;bLastY=butler.y;
    if(moved){const s=floor((+butler.walk||0)/PI);if(s!==stepB){stepB=s;stepFx(butler.x*T,butler.y*T,butler.dir||1)}}
  }
}
function ambient(dt,t){
  OK_B=SUN>.45&&rainAmt<.25&&NIGHT<.1;
  OK_F=NIGHT>.35&&rainAmt<.45;
  OK_P=rainAmt<.3&&(SUN>.3||GOLD>.2);
  OK_G=SUN>.3&&rainAmt<.4;
  // butterflies over grass
  if(OK_B&&cnt[BFLY]<round(7*Q)&&R()<dt*1.6&&randTile(1<<TL.G,8,0)){
    const p=spawnAmb(BFLY);
    if(p){p.x=p.hx=RTX*T+rr(4,28);p.y=p.hy=RTY*T+rr(4,28);p.z=rr(8,16);p.r=R()*TAU;p.vr=R()*TAU;p.vx=rr(16,26);p.l=rr(14,26);p.gi=floor(R()*BF.length)}
  }
  // fireflies over grass, fields and the pond shore
  const fT=OK_F?round(26*Q*NIGHT):0;
  if(cnt[FFLY]<fT&&R()<dt*8&&randTile((1<<TL.G)|(1<<TL.D)|(1<<TL.SA),8,0)){
    const p=spawnAmb(FFLY);
    if(p){p.hx=RTX*T+rr(0,T);p.hy=RTY*T+rr(0,T);p.x=p.hx;p.y=p.hy;p.vx=rr(-4,4);p.vy=rr(-3,3);p.r=R()*TAU;p.l=rr(7,13)}
  }
  // drifting pollen motes (golden at golden hour)
  const pT=OK_P?round(20*Q*clamp(SUN*.55+GOLD*.9,0,1)):0;
  if(cnt[POLLEN]<pT&&R()<dt*8){
    const p=spawnAmb(POLLEN);
    if(p){p.x=rr(vx0,vx1);p.y=rr(vy0,vy1);p.z=rr(6,26);p.r=R()*TAU;p.l=rr(4,8);p.al=rr(.35,.7);p.c=GOLD>.35?(R()<.6?'#ffd98a':'#fff1c8'):(R()<.7?'#fff6d8':'#f6ffd0')}
  }
  // the pond: glints, idle ripples, fish
  if(pondVis()){
    if(OK_G&&cnt[GLINT]<round(10*Q)&&R()<dt*10){
      for(let k=0;k<4;k++){const j=floor(R()*WATER.length/2)*2,x=WATER[j]*T+rr(2,30),y=WATER[j+1]*T+rr(4,28);
        if(!inView(x,y,0))continue;const p=spawnAmb(GLINT);if(!p)break;p.x=x;p.y=y;p.l=rr(.5,1.1);p.s=R()<.3?2:1;p.c=GOLD>.4?'#ffe9a8':'#ffffff';p.al=rr(.6,.95)*SUN;break}
    }
    if(rainAmt<.2&&R()<dt*.7*Q){const j=floor(R()*WATER.length/2)*2;ripple(WATER[j]*T+rr(4,28),WATER[j+1]*T+rr(6,26),2,10,1.4,.35,'#e6f6ff',true)}
  }
  // leaves drifting down from the orchard trees (more in wind and storms)
  const lr=.22*Q*(1+stormAmt*4+max(0,wind-10)/40);
  for(let i=0;i<SPOTS.length;i++){
    const lk=st.locks&&st.locks[i];if(!lk)continue;
    const sx=SPOTS[i][0]*T,sy=SPOTS[i][1]*T;if(!inView(sx,sy,50))continue;
    if(R()<dt*lr){
      const pr=clamp((st.day-lk.start)/(lk.days||1),0,1),sz=.4+.6*pr,p=spawnAmb(LEAF);
      if(p){p.hx=p.x=sx+rr(-13,13)*sz;p.y=sy+rr(-2,5);p.z=rr(16,32)*sz;p.vz=rr(9,15);p.r=R()*TAU;p.vr=rr(2,3.4);p.l=60;p.c=pick(LEAVES)}
    }
    // ripe trees twinkle
    if(isRipe(lk)){let n=cntRate(2.2*Q,dt);while(n-->0)spark(sx+rr(-15,15),sy-24+rr(-14,8),R()<.6?'#fff3b0':'#ffffff',G_GOLD,R()<.3?2:1,rr(.5,.9),rr(-4,4),rr(-10,-2),true)}
  }
  // kitchen smoke (khói bếp), busiest at dawn and dusk
  const sr=Q*(1.3+1.4*(DAWN+GOLD))*(1-.6*rainAmt);
  for(let i=0;i<SMOKES.length;i++){
    const s=SMOKES[i];if(!inView(s.x,s.y,90))continue;
    if(R()<dt*sr*(s.steam?.8:1)){const p=spawnAmb(SMOKE);if(p){p.x=s.x+rr(-2,2);p.y=s.y;p.vy=rr(10,14);p.r=R()*TAU;p.s=s.steam?rr(2.5,3.5):rr(3.5,5);p.l=s.steam?rr(1.6,2.4):rr(3,4.5);p.al=s.steam?.28:.34;p.gi=s.steam?PUFF.steam:PUFF.smoke}}
  }
  // lettuce field shimmer when yield piles up
  const acc=+(st.lend&&st.lend.acc)||0,fs=acc>.02?.1+.9*clamp(Math.log10(acc/.02)/1.5,0,1):0;
  fieldS+=(fs-fieldS)*min(1,dt*2);
  if(fieldS>.05&&rectView(FIELD[0],FIELD[1],FIELD[2],FIELD[3])){
    const beds=min(BEDS.length,Math.ceil((+(st.lend&&st.lend.p)||0)/40));
    if(beds>0){let n=cntRate(4*Q*fieldS,dt);while(n-->0){const b=BEDS[floor(R()*beds)];spark(b[0]*T+rr(-9,9),b[1]*T+rr(-6,2),R()<.6?'#fff3b0':'#f2c14e',G_GOLD,1,rr(.9,1.4),rr(-3,3),rr(-16,-9),true)}}
  }
  // rain rings in puddles
  if(rainAmt>.2&&wetC&&nPud>0){let n=cntRate(10*Q*rainAmt,dt);while(n-->0){const j=floor(R()*nPud)*3,x=PUD[j],y=PUD[j+1];if(inView(x,y,0))ripple(x+rr(-2,2),y+rr(-1,1),.6,PUD[j+2]*.5,.5,.5,'#eef8ff',true)}}
}
function updParticles(dt,t){
  const m=220;
  for(let i=0;i<MAXP;i++){
    const p=pool[i];if(!p.a)continue;
    p.t+=dt;if(p.t>=p.l){kill(p);continue}
    const k=p.k;
    if(AMBIENT[k]&&(p.x<vx0-m||p.x>vx1+m||p.y<vy0-m||p.y>vy1+m)){kill(p);continue}
    switch(k){
      case DUST:p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vx*=1-min(1,dt*4);p.vy*=1-min(1,dt*4);break;
      case LEAF:
        if(p.z>0){p.z-=p.vz*dt;p.r+=p.vr*dt;p.hx+=(wind*.35)*dt;p.x=p.hx+sin(p.r)*6;if(p.z<=0){p.z=0;p.l=p.t+1.6}}
        break;
      case SMOKE:p.y-=p.vy*dt;p.x+=(wind*.55+sin(t*1.3+p.r)*4)*dt;p.vy*=1-min(1,dt*.15);break;
      case BFLY:{
        if(!OK_B&&p.l-p.t>1.2)p.l=p.t+1.2;
        let h=p.vr+sin(t*1.7+p.r*3)*2.2*dt;
        const dx=p.hx-p.x,dy=p.hy-p.y;
        if(dx*dx+dy*dy>3600){let d=Math.atan2(dy,dx)-h;d=Math.atan2(sin(d),cos(d));h+=d*dt*1.6}
        p.vr=h;p.x+=cos(h)*p.vx*dt;p.y+=sin(h)*p.vx*dt*.8;p.z=10+sin(t*2.3+p.r)*3.5;
        break;}
      case FFLY:
        if(!OK_F&&p.l-p.t>1.5)p.l=p.t+1.5;
        p.hx+=p.vx*dt;p.hy+=p.vy*dt;
        p.x=p.hx+sin(t*.8+p.r)*14+sin(t*.37+p.r*2.1)*9;p.y=p.hy+cos(t*.6+p.r*1.3)*10;p.z=7+sin(t*1.1+p.r)*3;
        break;
      case POLLEN:
        if(!OK_P&&p.l-p.t>1)p.l=p.t+1;
        p.x+=(wind*.6+sin(t*.9+p.r)*5)*dt;p.y+=cos(t*.7+p.r)*4*dt;p.z+=sin(t*1.2+p.r)*2*dt;
        break;
      case SPARK:p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=1-min(1,dt*2.5);p.vy*=1-min(1,dt*2.5);break;
      case COIN:case SHARD:case BLEAF:case DROP:phys(p,dt);break;
      default:break; // SPLASH, RIPPLE, GLINT, GLOW, RING only age
    }
  }
}
function phys(p,dt){
  if(p.k===BLEAF){const d=1-min(1,dt*2.2);p.vx*=d;p.vy*=d;if(p.vz<-34)p.vz=-34;p.x+=sin(p.r)*14*dt}
  p.vz-=p.g*dt;p.z+=p.vz*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.r+=p.vr*dt;
  if(p.z<0){
    p.z=0;
    if(p.k===BLEAF||p.k===DROP){p.vz=0;p.g=0;p.vx*=.3;p.vy*=.3;p.vr*=.2}
    else{p.vz=-p.vz*.42;p.vx*=.55;p.vy*=.55;p.vr*=.6;if(p.vz<18){p.vz=0;p.g=0}}
  }
}
function updFish(dt){
  if(!fish.on){
    fishT-=dt;
    if(fishT<=0){
      fishT=rr(3.5,8)/(st.lp?1.4:1);
      if(pondVis()&&DEEPW.length){
        const j=floor(R()*DEEPW.length/2)*2;fish.x=DEEPW[j]*T+16;fish.y=DEEPW[j+1]*T+18;
        fish.d=R()<.5?1:-1;if(tileW(fish.x+fish.d*32,fish.y)!==TL.WA)fish.d=-fish.d;
        fish.dur=rr(.65,.85);fish.t=0;fish.on=1;
        const koi=R()<.6;fish.c1=koi?'#f08a3c':'#c9d6dc';fish.c2=koi?'#fff4e6':'#eef6fa';
        if(inView(fish.x,fish.y,40))splashAt(fish.x,fish.y,3);
      }
    }
  }else{
    fish.t+=dt;
    if(fish.t>=fish.dur){fish.on=0;const x=fish.x+fish.d*30;if(inView(x,fish.y,40))splashAt(x,fish.y,4)}
  }
}
function splashAt(x,y,n){
  ripple(x,y,2,13,.9,.6,'#e6f6ff',false);ripple(x,y,1,7,.6,.5,'#ffffff',false);
  n=max(1,round(n*Q));
  for(let i=0;i<n;i++){const p=spawn(DROP);if(!p)break;p.x=x+rr(-3,3);p.y=y;p.z=1;p.vx=rr(-26,26);p.vy=rr(-6,6);p.vz=rr(40,75);p.g=320;p.l=rr(.35,.55);p.c=pick(WATERS)}
}
function updBirds(dt){
  if(!birds.on){
    birdT-=dt;
    if(birdT<=0){
      birdT=rr(18,38);
      if(SUN>.4&&rainAmt<.3&&NIGHT<.2){
        birds.d=R()<.5?1:-1;birds.vx=birds.d*rr(62,82);birds.vy=rr(-12,12);
        birds.x=birds.d>0?vx0-60:vx1+60;birds.y=vy0+(vy1-vy0)*rr(.12,.7);birds.n=3+floor(R()*3);birds.on=1;
      }
    }
  }else{
    birds.x+=birds.vx*dt;birds.y+=birds.vy*dt;
    if((birds.d>0&&birds.x>vx1+160)||(birds.d<0&&birds.x<vx0-160)||birds.y<vy0-300||birds.y>vy1+300)birds.on=0;
  }
}
function updClouds(dt){
  for(let i=0;i<clouds.length;i++){
    const c=clouds[i];c.x+=(wind*.9+6)*c.v*dt;c.y+=1.5*c.v*dt;
    if(c.x>W*T+150||c.y>H*T+100){c.x=-128*c.s-rr(0,320);c.y=rr(-200,H*T-120)}
  }
}
/* letters: shared position helper (eased arc gate <-> zone) */
let LX=0,LY=0,LGX=0,LGY=0,LE=0;
function lpos(L){
  const k=clamp(+L.t||0,0,1),e=k*k*(3-2*k),x0=L.x0*T,y0=L.y0*T,dx=L.x1*T-x0,dy=L.y1*T-y0;
  const arc=40+sqrt(dx*dx+dy*dy)*.12;
  LGX=x0+dx*e;LGY=y0+dy*e;LX=LGX;LY=LGY-sin(e*PI)*arc;LE=e;return k;
}
const toGate=L=>abs(L.x1-22)<.05&&L.y1<1.5;
function lettersTrail(dt){
  for(let i=0;i<letters.length;i++){
    const L=letters[i];if(!L)continue;lpos(L);if(!inView(LX,LY,40))continue;
    const tg=toGate(L);let n=cntRate(26*Q,dt);
    while(n-->0){if(!spark(LX+rr(-5,5),LY+rr(-4,4),tg?(R()<.5?'#cfeffa':'#ffffff'):(R()<.6?'#f2c14e':'#fff3b0'),tg?G_SKY:G_GOLD,R()<.3?2:1,rr(.35,.7),rr(-10,10),rr(-6,14),false))break}
  }
}
/* landing detection: a tracked letter that vanished after t>0.8 just arrived */
const TRK=24,trkL=new Array(TRK).fill(null),trkT=new Float32Array(TRK),trkX=new Float32Array(TRK),trkY=new Float32Array(TRK),trkG=new Uint8Array(TRK),trkS=new Uint8Array(TRK);
function trackLetters(){
  trkS.fill(0);
  for(let i=0;i<letters.length;i++){
    const L=letters[i];if(!L)continue;let j=-1;
    for(let q=0;q<TRK;q++)if(trkL[q]===L){j=q;break}
    if(j<0)for(let q=0;q<TRK;q++)if(trkL[q]===null){j=q;trkL[q]=L;break}
    if(j>=0){trkT[j]=+L.t||0;trkX[j]=L.x1*T;trkY[j]=L.y1*T;trkG[j]=toGate(L)?1:0;trkS[j]=1}
  }
  for(let q=0;q<TRK;q++)if(trkL[q]!==null&&!trkS[q]){if(trkT[q]>.8)landFlash(trkX[q],trkY[q],trkG[q]);trkL[q]=null}
}
function landFlash(x,y,tg){
  if(tg)gateFlare=1;
  if(!inView(x,y,80))return;
  glow(x,y,26,.55,tg?G_SKY:G_GOLD,.7);
  ring(x,y+6,4,26,.5,tg?'#cfeffa':'#f2c14e',.8);
  sparks(x,y,round(8*Q)||2,tg?SKIES:GOLDS,tg?G_SKY:G_GOLD,60);
}

/* ================================================================ drawing: particles */
function drawPass(ctx,pass,t){
  const m=40;
  for(let i=0;i<MAXP;i++){
    const p=pool[i];if(!p.a||PASS[p.k]!==pass)continue;
    const x=p.x,y=p.y;if(x<vx0-m||x>vx1+m||y-p.z<vy0-m||y-p.z>vy1+m)continue;
    const u=p.t/p.l;
    switch(p.k){
      case DUST:{const r=p.s*(.6+u*.9);ctx.globalAlpha=(1-u)*p.al;ctx.drawImage(SP.puff[p.gi],x-r,y-r-p.z,r*2,r*2);break}
      case SPLASH:{
        const a=(1-u)*p.al,r=1+u*4;ctx.globalAlpha=a;ctx.strokeStyle='#dcefff';ctx.lineWidth=.8;ell(ctx,x,y,r,r*.45);ctx.stroke();
        const h=round(sin(u*PI)*3),o=round(1+u*4);ctx.fillStyle='#eef8ff';ctx.fillRect(round(x)-o,round(y)-1-h,1,1);ctx.fillRect(round(x)+o,round(y)-1-h,1,1);break}
      case RIPPLE:{const r=p.s+u*p.vr;ctx.globalAlpha=(1-u)*p.al;ctx.strokeStyle=p.c;ctx.lineWidth=1;ell(ctx,x,y,r,r*.42);ctx.stroke();break}
      case GLINT:{
        const s=sin(u*PI),L=round(p.s*s+.4),X=round(x),Y=round(y);ctx.globalAlpha=s*p.al;ctx.fillStyle=p.c;
        ctx.fillRect(X-L,Y,L*2+1,1);if(L>0)ctx.fillRect(X,Y-L,1,L*2+1);break}
      case LEAF:{
        const a=min(1,(p.l-p.t)/1.2),X=round(x),Y=round(y-p.z),w=max(1,round(2.6*abs(cos(p.r))));
        if(p.z>2){ctx.globalAlpha=.15*a;ctx.fillStyle='#000';ctx.fillRect(round(x)-1,round(y),2,1)}
        ctx.globalAlpha=a;ctx.fillStyle=p.c;ctx.fillRect(X-(w>>1),Y,w,2);break}
      case SMOKE:{const r=p.s*(.5+u*1.7);ctx.globalAlpha=sstep(0,.12,u)*(1-u)*p.al;ctx.drawImage(SP.puff[p.gi],x-r,y-r,r*2,r*2);break}
      case BFLY:{
        const a=min(1,p.t/.6,(p.l-p.t)/1.2),X=round(x),Y=round(y-p.z),fl=abs(sin(t*15+p.r*7)),ww=1+round(fl*2),pal=BF[p.gi];
        ctx.globalAlpha=a;ctx.fillStyle=pal[0];ctx.fillRect(X-ww,Y-2,ww,3);ctx.fillRect(X+1,Y-2,ww,3);
        ctx.fillStyle=pal[1];ctx.fillRect(X-ww,Y+1,max(1,ww-1),1);ctx.fillRect(X+1,Y+1,max(1,ww-1),1);
        ctx.fillStyle='#2b1d14';ctx.fillRect(X,Y-2,1,4);break}
      case FFLY:{
        let b=max(0,sin(t*1.9+p.r*3));b*=b;const a=min(1,p.t/1,(p.l-p.t)/1.5)*b*clamp(NIGHT*1.4,0,1);if(a<.01)break;
        const X=x,Y=y-p.z;ctx.globalAlpha=a*.85;ctx.drawImage(SP.glow[G_FIRE],X-7,Y-7,14,14);
        ctx.globalAlpha=a;ctx.fillStyle='#f6ffb0';ctx.fillRect(round(X),round(Y),1,1);break}
      case POLLEN:{
        const a=p.al*min(1,p.t/.8,(p.l-p.t)/.8)*(.6+.4*sin(t*3+p.r));if(a<.01)break;
        ctx.globalAlpha=a;ctx.fillStyle=p.c;ctx.fillRect(round(x),round(y-p.z),1,1);break}
      case SPARK:{
        const s=u<.15?u/.15:1-(u-.15)/.85,X=round(x),Y=round(y),L=p.s;ctx.globalAlpha=s*p.al;
        if(L>=2){ctx.drawImage(SP.glow[p.gi],X-6,Y-6,12,12)}
        ctx.fillStyle=p.c;ctx.fillRect(X-L,Y,L*2+1,1);ctx.fillRect(X,Y-L,1,L*2+1);break}
      case GLOW:{const r=p.s*(1+u*.6),a=(1-u);ctx.globalAlpha=a*a*p.al;ctx.drawImage(SP.glow[p.gi],x-r,y-r,r*2,r*2);break}
      case RING:{const r=p.s+(1-(1-u)*(1-u))*p.vr;ctx.globalAlpha=(1-u)*p.al;ctx.strokeStyle=p.c;ctx.lineWidth=1.8*(1-u)+.5;ell(ctx,x,y,r,r*p.q);ctx.stroke();break}
      case COIN:{
        const a=u>.7?1-(u-.7)/.3:1,X=round(x),Y=round(y-p.z),G=round(y),w=max(1,round(5*abs(cos(p.r)))),hx=X-(w>>1);
        ctx.globalAlpha=.25*a;ctx.fillStyle='#000';ctx.fillRect(X-2,G+1,5,1);
        ctx.globalAlpha=a;ctx.fillStyle='#8a5a12';ctx.fillRect(hx-1,Y-2,w+2,5);ctx.fillRect(hx,Y-3,w,7);
        ctx.fillStyle='#f2c14e';ctx.fillRect(hx,Y-2,w,5);ctx.fillStyle='#c8922a';ctx.fillRect(hx,Y+2,w,1);
        if(w>2){ctx.fillStyle='#fff6cf';ctx.fillRect(hx,Y-2,1,2)}break}
      case SHARD:{
        const a=u>.65?1-(u-.65)/.35:1,X=round(x),Y=round(y-p.z),o=(floor(p.r*1.3)&3);
        ctx.globalAlpha=.22*a;ctx.fillStyle='#000';ctx.fillRect(X-1,round(y)+1,3,1);
        ctx.globalAlpha=a;ctx.fillStyle=p.c;
        if(o===0)ctx.fillRect(X-1,Y,3,1);else if(o===1)ctx.fillRect(X,Y-1,1,3);else if(o===2){ctx.fillRect(X-1,Y-1,2,1);ctx.fillRect(X,Y,2,1)}else{ctx.fillRect(X,Y-1,2,1);ctx.fillRect(X-1,Y,2,1)}
        break}
      case BLEAF:{
        const a=u>.7?1-(u-.7)/.3:1,X=round(x),Y=round(y-p.z),w=max(1,round(3*abs(cos(p.r))));
        ctx.globalAlpha=a;ctx.fillStyle=p.c;ctx.fillRect(X-(w>>1),Y,w,2);if(w>1){ctx.fillStyle='#3f7f32';ctx.fillRect(X-(w>>1),Y+1,w,1)}break}
      case DROP:{const a=u>.6?1-(u-.6)/.4:1;ctx.globalAlpha=a;ctx.fillStyle=p.c;ctx.fillRect(round(x),round(y-p.z),1,2);break}
    }
  }
}
function drawGroundShadows(ctx,t){
  if(SUN<.05)return;
  ctx.fillStyle='#000';
  for(let i=0;i<MAXP;i++){
    const p=pool[i];if(!p.a||p.k!==BFLY||!inView(p.x,p.y,20))continue;
    ctx.globalAlpha=.16*SUN*min(1,p.t/.6,(p.l-p.t)/1.2);ctx.fillRect(round(p.x)-1,round(p.y),3,1);
  }
  if(birds.on){
    ctx.globalAlpha=.11*SUN;
    for(let j=0;j<birds.n;j++){const bx=round(birds.x+BOFF[j*2]*birds.d+34),by=round(birds.y+BOFF[j*2+1]+86);if(inView(bx,by,10))ctx.fillRect(bx-3,by,7,2)}
  }
}
function drawWet(ctx){
  if(wet<.01)return;
  if(!wetC){buildWet();if(!wetC)return}
  const x0=clamp(floor(vx0),0,W*T),y0=clamp(floor(vy0),0,H*T),x1=clamp(Math.ceil(vx1),0,W*T),y1=clamp(Math.ceil(vy1),0,H*T);
  if(x1-x0<2||y1-y0<2)return;
  ctx.imageSmoothingEnabled=false;ctx.globalAlpha=wet*.95;
  ctx.drawImage(wetC,x0*.5,y0*.5,(x1-x0)*.5,(y1-y0)*.5,x0,y0,x1-x0,y1-y0);
  ctx.imageSmoothingEnabled=true;
}
function drawRing(ctx,t){
  const z=ringZ;if(!z||ringA<.01)return;
  const cx=z.ax*T,cy=z.ay*T;if(!inView(cx,cy,60))return;
  const k=ringA*(F.current===z.id?.5:1),pulse=REDUCE?.5:.5+.5*sin(t*4.4);
  ctx.globalAlpha=k*(.2+.12*pulse);ctx.drawImage(SP.glow[G_GOLD],cx-32,cy-13,64,26);
  ctx.lineWidth=3.6;ctx.strokeStyle='#1c2a23';ctx.globalAlpha=k*.3;ell(ctx,cx,cy+1,21,8.4);ctx.stroke();
  ctx.lineWidth=2;ctx.strokeStyle='#f2c14e';ctx.globalAlpha=k*(.75+.25*pulse);ell(ctx,cx,cy,20+pulse*1.5,8+pulse*.6);ctx.stroke();
  if(!REDUCE){const ph=(t*.85)%1;ctx.lineWidth=1.4*(1-ph)+.4;ctx.globalAlpha=k*(1-ph)*.7;ell(ctx,cx,cy,20+ph*15,8+ph*6);ctx.stroke()}
  ctx.fillStyle='#fff3b0';
  for(let i=0;i<4;i++){const a=(REDUCE?.6:t*1.8)+i*PI/2;ctx.globalAlpha=k*(.55+.45*sin(a*2+t*3));ctx.fillRect(round(cx+cos(a)*21)-1,round(cy+sin(a)*8.4)-1,2,2)}
}
function drawClouds(ctx){
  const a=.1*SUN*(1-rainAmt)*(1-NIGHT);if(a<.004)return;
  ctx.globalAlpha=a;
  for(let i=0;i<clouds.length;i++){const c=clouds[i],dw=128*c.s,dh=64*c.s;if(c.x>vx1||c.x+dw<vx0||c.y>vy1||c.y+dh<vy0)continue;ctx.drawImage(SP.cloud[c.k],c.x,c.y,dw,dh)}
}
function drawFish(ctx){
  if(!fish.on)return;
  const u=fish.t/fish.dur,x=fish.x+fish.d*u*30,h=sin(u*PI)*20,y=fish.y-h;if(!inView(x,y,40))return;
  ctx.globalAlpha=.22*(1-h/24);ctx.fillStyle='#0d3347';ell(ctx,x,fish.y+2,6,2);ctx.fill();
  const ang=Math.atan2(-cos(u*PI)*PI*20/fish.dur,30/fish.dur);
  ctx.globalAlpha=1;ctx.save();ctx.translate(round(x),round(y));ctx.scale(fish.d,1);ctx.rotate(ang);
  ctx.fillStyle=fish.c1;ctx.fillRect(-5,-2,10,4);ctx.fillRect(-4,-3,7,1);ctx.fillRect(-4,2,7,1);
  ctx.fillRect(-9,-3,3,2);ctx.fillRect(-9,1,3,2);ctx.fillRect(-7,-1,2,2);
  ctx.fillStyle=fish.c2;ctx.fillRect(-1,-2,3,2);
  ctx.fillStyle='#1c2a23';ctx.fillRect(3,-1,1,1);
  ctx.restore();
}
function drawBirds(ctx,t){
  if(!birds.on)return;
  ctx.fillStyle='#24312b';ctx.globalAlpha=.9;
  for(let j=0;j<birds.n;j++){
    const bx=round(birds.x+BOFF[j*2]*birds.d),by=round(birds.y+BOFF[j*2+1]+sin(t*1.4+j*1.9)*2);if(!inView(bx,by,12))continue;
    const wy=round(sin(t*9+j*1.3)*2);
    ctx.fillRect(bx-1,by,3,1);
    ctx.fillRect(bx-3,by+(wy>>1),2,1);ctx.fillRect(bx-5,by+wy,2,1);
    ctx.fillRect(bx+2,by+(wy>>1),2,1);ctx.fillRect(bx+4,by+wy,2,1);
  }
}

/* ================================================================ drawing: light, weather, screen */
let lb=null,lbg=null,lbW=0,lbH=0,LS=4,mulKey=-1,mulStr='rgb(255,255,255)';
const flick=(f,t)=>.9+.06*sin(t*6.3+f)+.04*sin(t*13.7+f*2.1);
function mulColor(){
  const r=round(MR*255),g=round(MG*255),b=round(MB*255),k=(r<<16)|(g<<8)|b;
  if(k!==mulKey){mulKey=k;mulStr='rgb('+r+','+g+','+b+')'}
  return mulStr;
}
function ensureLB(w,h){
  LS=max((+F.dpr||1)>=1.75?6:4,Math.ceil(w/480));
  const bw=Math.ceil(w/LS)+1,bh=Math.ceil(h/LS)+1;
  if(!lb){const o=mk(bw,bh);lb=o.c;lbg=o.g}
  if(lb.width!==bw||lb.height!==bh){lb.width=bw;lb.height=bh}
  lbW=bw;lbH=bh;
}
/** one multiply pass: time-of-day colour, overcast, warm light pools, player lantern, moonlight */
function lightPass(ctx,w,h,t){
  const col=mulColor();
  if(LAMP<.015&&NIGHT<.015){
    if(mulKey===0xffffff)return;
    ctx.globalCompositeOperation='multiply';ctx.fillStyle=col;ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='source-over';return;
  }
  ensureLB(w,h);const g=lbg;if(!g)return;
  g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='source-over';g.globalAlpha=1;g.fillStyle=col;g.fillRect(0,0,lbW,lbH);
  if(NIGHT>.01){g.globalAlpha=NIGHT*.5*(1-.7*rainAmt);g.drawImage(SP.moon,-lbW*.5,-lbH*.7,lbW*1.6,lbH*1.7)}
  const k=sc/LS,ox=(-cam.x+shake.x)*k,oy=(-cam.y+shake.y)*k;
  for(let i=0;i<LIGHTS.length;i++){
    const L=LIGHTS[i],a=LAMP*L.i*flick(L.f,t)*(L.kind==='gate'?1+gateFlare*.6:1);if(a<.01)continue;
    const r=L.r*k,x=L.x*k+ox,y=L.y*k+oy;if(x+r<0||y+r<0||x-r>lbW||y-r>lbH)continue;
    g.globalAlpha=min(1,a*.92);g.drawImage(SP.pool[L.c],x-r,y-r,r*2,r*2);
  }
  if(NIGHT>.01){
    const r=96*k,x=player.x*T*k+ox,y=(player.y*T-12)*k+oy;g.globalAlpha=NIGHT*.78*flick(1.3,t);g.drawImage(SP.pool[1],x-r,y-r,r*2,r*2);
    if(st.butler&&st.butler.hired){const br=52*k,bx=butler.x*T*k+ox,by=(butler.y*T-14)*k+oy;g.globalAlpha=NIGHT*.55;g.drawImage(SP.pool[3],bx-br,by-br,br*2,br*2)}
  }
  ctx.globalCompositeOperation='multiply';ctx.drawImage(lb,0,0,lbW,lbH,0,0,lbW*LS,lbH*LS);ctx.globalCompositeOperation='source-over';
}
/** additive warm bloom over lit windows and lanterns, moon on the pond, gate shimmer, ripe trees, field band */
function bloom(ctx,t){
  if(LAMP>.02){
    for(let i=0;i<LIGHTS.length;i++){
      const L=LIGHTS[i];if(!inView(L.x,L.y,L.g*3))continue;
      const a=LAMP*L.i*flick(L.f,t)*.62*(L.kind==='gate'?1+gateFlare*.5:1);if(a<.01)continue;
      const r=L.g*2.4;ctx.globalAlpha=min(1,a);ctx.drawImage(SP.glow[L.gi],L.x-r,L.y-r,r*2,r*2);
    }
  }
  if(NIGHT>.02){const x=player.x*T,y=player.y*T-14;ctx.globalAlpha=NIGHT*.22*flick(2.1,t);ctx.drawImage(SP.glow[G_WARM],x-34,y-34,68,68)}
  if(NIGHT>.05&&pondVis()&&rainAmt<.8){
    ctx.globalAlpha=NIGHT*.16;ctx.drawImage(SP.glow[G_MOON],MOONX-30,MOONY-8,60,46);
    ctx.fillStyle='#d6e4ff';
    for(let j=0;j<9;j++){
      const yy=MOONY+j*6,w=(11-j*.7)*(.55+.45*sin(t*2.1+j*1.7)),xx=MOONX+sin(t*1.3+j)*2;
      ctx.globalAlpha=NIGHT*.34*(1-j/11)*(1-rainAmt);ctx.fillRect(round(xx-w/2),round(yy),max(1,round(w)),1);
    }
  }
  if(gateFlare>.01&&inView(GATE.x,GATE.y,90)){ctx.globalAlpha=gateFlare*gateFlare*.5;ctx.drawImage(SP.glow[G_GOLD],GATE.x-80,GATE.y-46,160,92)}
  for(let i=0;i<SPOTS.length;i++){
    const lk=st.locks&&st.locks[i];if(!lk||!isRipe(lk))continue;
    const x=SPOTS[i][0]*T,y=SPOTS[i][1]*T-24;if(!inView(x,y,40))continue;
    ctx.globalAlpha=.16+.08*sin(t*2.2+i);ctx.drawImage(SP.glow[G_GOLD],x-30,y-30,60,60);
  }
  if(fieldS>.01&&SP.band&&rectView(FIELD[0],FIELD[1],FIELD[2],FIELD[3])){
    const fw=FIELD[2]-FIELD[0],ph=REDUCE?.5:(t*.2)%1,bx=FIELD[0]-160+ph*(fw+160);
    ctx.save();ctx.beginPath();ctx.rect(FIELD[0],FIELD[1],fw,FIELD[3]-FIELD[1]);ctx.clip();
    ctx.globalAlpha=fieldS*.3*(1-.6*NIGHT);ctx.drawImage(SP.band,bx,FIELD[1],160,256);
    ctx.restore();
  }
}
function haze(ctx,w,h){
  const S=max(w,h)*.95;
  if(GOLD>.02){ctx.globalCompositeOperation='screen';ctx.globalAlpha=GOLD*.3;ctx.drawImage(SP.haze[0],-S,-S*.9,S*2,S*2)}
  if(DAWN>.02){ctx.globalCompositeOperation='screen';ctx.globalAlpha=DAWN*.26;ctx.drawImage(SP.haze[1],w-S,-S*.9,S*2,S*2)}
  ctx.globalCompositeOperation='source-over';
}
function drawRain(ctx){
  if(nDrops<=0)return;
  const d=+F.dpr||1,b=.6+.4*BRIGHT,q=.55+.45*clamp(rainAmt,0,1);
  ctx.globalCompositeOperation='source-over';ctx.strokeStyle='#cfe0f2';ctx.lineCap='butt';
  for(let lay=0;lay<3;lay++){
    ctx.lineWidth=(lay===0?.8:lay===1?1:1.4)*d;ctx.globalAlpha=(lay===0?.2:lay===1?.3:.42)*b*q;
    ctx.beginPath();
    for(let i=0;i<nDrops;i++){if(rlay[i]!==lay)continue;const x=rx[i],y=ry[i],L=rl[i];ctx.moveTo(x,y);ctx.lineTo(x-slant*L,y-L)}
    ctx.stroke();
  }
}
let vig=null,vigW=0,vigH=0,vigAt=-9;
function buildVig(w,h){
  const vw=max(2,min(512,Math.ceil(w/2))),vh=max(2,round(vw*h/w));
  if(!vig)vig=mk(vw,vh);else{vig.c.width=vw;vig.c.height=vh}
  vigW=w;vigH=h;const g=vig.g;if(!g)return;
  try{
    const id=g.createImageData(vw,vh),d=id.data,cx=vw/2,cy=vh/2;
    for(let y=0;y<vh;y++){const ny=(y+.5-cy)/cy;for(let x=0;x<vw;x++){
      const nx=(x+.5-cx)/cx,dd=sqrt(nx*nx*.85+ny*ny);let a=(dd-.5)/.95;a=a<=0?0:a>=1?1:a*a*(3-2*a);
      const o=(y*vw+x)*4;d[o]=12;d[o+1]=22;d[o+2]=20;d[o+3]=min(255,floor(a*.46*255+R()));
    }}
    g.putImageData(id,0,0);
  }catch(e){
    g.clearRect(0,0,vw,vh);const gr=g.createRadialGradient(vw/2,vh/2,min(vw,vh)*.3,vw/2,vh/2,max(vw,vh)*.75);
    gr.addColorStop(0,'rgba(12,22,20,0)');gr.addColorStop(1,'rgba(12,22,20,.46)');g.fillStyle=gr;g.fillRect(0,0,vw,vh);
  }
}
function vignette(ctx,w,h){
  if((!vig||vigW!==w||vigH!==h)&&(!vig||TNOW-vigAt>.25)){vigAt=TNOW;buildVig(w,h)}
  if(!vig)return;
  ctx.globalCompositeOperation='source-over';ctx.globalAlpha=clamp(.7+.3*NIGHT+.15*stormAmt,0,1);ctx.drawImage(vig.c,0,0,w,h);
}
function drawLetters(ctx,t){
  for(let i=0;i<letters.length;i++){
    const L=letters[i];if(!L)continue;
    const k=lpos(L);if(!inView(LX,LY,60))continue;
    const tg=toGate(L),s=REDUCE?1:(k<.1?backOut(k/.1):k>.9?1-(k-.9)*4.5:1),lift=sin(LE*PI);
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=.18*(1-.55*lift);ctx.fillStyle='#000';ell(ctx,LGX,LGY+2,7-2*lift,2.6-.8*lift);ctx.fill();
    ctx.globalCompositeOperation='lighter';ctx.globalAlpha=(.5+.18*sin(t*9+i*2))*min(1,max(0,s));ctx.drawImage(SP.glow[tg?G_SKY:G_GOLD],LX-22,LY-22,44,44);
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
    ctx.save();ctx.translate(round(LX),round(LY));ctx.rotate(REDUCE?0:sin(t*5+i*1.7)*.14);const ss=max(.05,s);if(ss!==1)ctx.scale(ss,ss);
    ctx.fillStyle='#6f5f45';ctx.fillRect(-8,-6,16,12);
    ctx.fillStyle='#fbf6ea';ctx.fillRect(-7,-5,14,10);
    ctx.fillStyle='#e6dbc0';ctx.fillRect(-7,2,14,3);
    ctx.strokeStyle='#b3a585';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-7,-4.5);ctx.lineTo(0,1);ctx.lineTo(7,-4.5);ctx.stroke();
    ctx.fillStyle=tg?'#3d8db4':'#e8604a';ctx.fillRect(-2,-1,4,4);ctx.fillStyle=tg?'#8fd0e4':'#ff9a86';ctx.fillRect(-2,-1,2,1);
    ctx.restore();
  }
}
const FONT='800 13px "Baloo 2","Be Vietnam Pro",system-ui,sans-serif';
function drawFloaters(ctx){
  if(!floaters.length)return;
  ctx.globalCompositeOperation='source-over';ctx.font=FONT;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.miterLimit=2;
  for(let i=0;i<floaters.length;i++){
    const f=floaters[i];if(!f||f.text==null)continue;
    const k=clamp(+f.t||0,0,1),fx=(+f.x||0)*T,fy=(+f.y||0)*T;if(!inView(fx,fy,120))continue;
    let off=0;for(let j=0;j<i;j++){const o=floaters[j];if(o&&abs(o.x-f.x)<1.6&&abs(o.y-f.y)<1&&abs((+o.t||0)-k)<.12)off+=16}
    const a=k<.06?k/.06:k>.7?1-(k-.7)/.3:1,s=REDUCE?1:(k<.16?backOut(k/.16):1-max(0,k-.8)*.5);
    const rise=(1-(1-k)*(1-k)*(1-k))*34;
    ctx.save();ctx.translate(fx,fy-rise+off);if(s!==1)ctx.scale(max(.05,s),max(.05,s));
    const txt=String(f.text);
    ctx.globalAlpha=a*.4;ctx.lineWidth=4.4;ctx.strokeStyle='#0b120f';ctx.strokeText(txt,.5,2.2);
    ctx.globalAlpha=a;ctx.lineWidth=3.4;ctx.strokeStyle='#1c2a23';ctx.strokeText(txt,0,0);
    ctx.fillStyle=f.color||'#f2c14e';ctx.fillText(txt,0,0);
    ctx.restore();
  }
}
function drawChevron(ctx,t){
  const z=ringZ;if(!z||chevA<.01)return;
  let x,y;if(z.sx!=null){x=z.sx*T;y=z.sy*T-29}else{x=z.ax*T;y=z.ay*T-46}
  if(!inView(x,y,40))return;
  y=round(y-(REDUCE?0:abs(sin(t*4.2))*5));x=round(x);
  ctx.globalCompositeOperation='lighter';ctx.globalAlpha=chevA*.4;ctx.drawImage(SP.glow[G_GOLD],x-15,y-15,30,30);
  ctx.globalCompositeOperation='source-over';ctx.globalAlpha=chevA;
  ctx.fillStyle='#1c2a23';ctx.beginPath();ctx.moveTo(x-8,y-6);ctx.lineTo(x+8,y-6);ctx.lineTo(x,y+4);ctx.closePath();ctx.fill();
  ctx.fillStyle='#f2c14e';ctx.beginPath();ctx.moveTo(x-5.5,y-4.5);ctx.lineTo(x+5.5,y-4.5);ctx.lineTo(x,y+1.6);ctx.closePath();ctx.fill();
  ctx.fillStyle='#fff3b0';ctx.fillRect(x-4,y-4,4,1);
}

/* ================================================================ hooks */
const dead=Object.create(null),errs=Object.create(null);
function hook(name,fn,onDeath){
  F.on(name,function(a,b,c,d){
    if(dead[name])return;
    try{fn(a,b,c,d)}catch(e){
      errs[name]=(errs[name]||0)+1;
      if(errs[name]<=2)console.warn('[fx '+name+']',e);
      if(errs[name]>=6){dead[name]=true;try{onDeath&&onDeath()}catch(_){}}
    }
  });
}
FLAGS.nearRing=false;FLAGS.letters=false;FLAGS.floaters=false;FLAGS.weather=false;

hook('frame',(dt,now)=>{
  dt=+dt||0;if(dt<0)dt=0;if(dt>.1)dt=.1;
  const t=(+now||0)/1000;TNOW=t;
  updClock(dt);updWeather(dt,t);updLight();updStorm(dt);updShake(dt);
  updView();updNear(dt);
  ambient(dt,t);updParticles(dt,t);
  updRain(dt);updFish(dt);updBirds(dt);updClouds(dt);
  footsteps();lettersTrail(dt);
  gateFlare=max(0,gateFlare-dt*.9);
},()=>{shake.x=0;shake.y=0});

hook('ground',(ctx,t)=>{
  updView();ctx.save();
  try{
    drawWet(ctx);
    ctx.imageSmoothingEnabled=true;
    drawPass(ctx,1,t);drawGroundShadows(ctx,t);drawRing(ctx,t);
  }finally{ctx.restore()}
},()=>{FLAGS.nearRing=true});

hook('world',(ctx,t)=>{
  ctx.save();
  try{ctx.imageSmoothingEnabled=true;drawClouds(ctx);drawPass(ctx,2,t);ctx.imageSmoothingEnabled=false;drawFish(ctx)}
  finally{ctx.restore()}
});

hook('worldTop',(ctx,t)=>{ctx.save();try{drawBirds(ctx,t)}finally{ctx.restore()}});

hook('screen',(ctx,t,w,h)=>{
  w=w||cv.width;h=h||cv.height;if(!(w>0&&h>0))return;
  updView();trackLetters();
  ctx.save();
  try{
    ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=true;
    lightPass(ctx,w,h,t);
    const ox=(-cam.x+shake.x)*sc,oy=(-cam.y+shake.y)*sc;
    ctx.setTransform(sc,0,0,sc,ox,oy);ctx.globalCompositeOperation='lighter';
    bloom(ctx,t);drawPass(ctx,3,t);
    ctx.setTransform(1,0,0,1,0,0);
    haze(ctx,w,h);drawRain(ctx);
    const fa=flashA();if(fa>.002){ctx.globalCompositeOperation='source-over';ctx.globalAlpha=fa;ctx.fillStyle='#e8efff';ctx.fillRect(0,0,w,h)}
    vignette(ctx,w,h);
    ctx.setTransform(sc,0,0,sc,ox,oy);
    ctx.globalCompositeOperation='lighter';drawPass(ctx,5,t);
    ctx.globalCompositeOperation='source-over';drawPass(ctx,4,t);
    drawLetters(ctx,t);drawFloaters(ctx);drawChevron(ctx,t);
  }finally{ctx.restore()}
},()=>{FLAGS.weather=true;FLAGS.letters=true;FLAGS.floaters=true});

hook('floater',e=>{
  if(!e)return;const x=(+e.x||0)*T,y=(+e.y||0)*T,kind=classify(e.color);
  updView();burst(x,y+4,kind,12);
  if(kind==='red')kick(1.6,.28);
});
hook('tx',()=>{
  gateFlare=1;updView();if(!inView(GATE.x,GATE.y,120))return;
  ring(GATE.x,GATE.y+26,6,30,.7,'#f2c14e',.5);
  const n=round(8*Q)||2;for(let i=0;i<n;i++)spark(rr(19.8*T,24.2*T),rr(.3*T,1.7*T),pick(GOLDS),G_GOLD,R()<.3?2:1,rr(.8,1.3),rr(-4,4),rr(-30,-12),false);
});
hook('open',id=>{
  const z=F.Z&&F.Z[id];if(!z)return;updView();
  const x=(z.sx!=null?z.sx:z.ax)*T,y=z.sx!=null?z.sy*T-14:(z.ay-1)*T;if(!inView(x,y,60))return;
  sparks(x,y,round(7*Q)||2,GOLDS,G_GOLD,55);glow(x,y,18,.4,G_GOLD,.45);
});
hook('resize',()=>{loadLights();loadSmokes()});

/* ================================================================ public API */
window.FarmFX={
  version:1,
  /** visual time of day 0..1 (0 = midnight); equals frac(st.day) whenever days pass at most ~1 per minute */
  get tod(){return vt},
  get hour(){return vt*24},
  /** Vietnamese label for the light: Bình minh, Ban ngày, Hoàng hôn, Chạng vạng, Ban đêm */
  get phase(){return phaseName(vt*24)},
  get night(){return NIGHT},get lamps(){return LAMP},get rain(){return rainAmt},get storm(){return stormAmt},get wet(){return wet},
  get lightsFrom(){return lightsFrom},
  /** pin the light to a time of day (0..1) for demos; null follows the game again */
  setTimeOfDay(v){pinned=(v==null||!isFinite(+v))?null:frac(+v);if(pinned==null)vt=frac(+st.day||0)},
  /** particle burst at tiles (x,y): kind gold|leaf|red|water|spark */
  burst(x,y,kind,n){updView();burst((+x||0)*T,(+y||0)*T,kind||'gold',n||12)},
  ring(x,y,color){updView();ring((+x||0)*T,(+y||0)*T,4,26,.55,color||'#f2c14e',.8)},
  /** short camera shake in world px (ignored under prefers-reduced-motion) */
  shake(a,d){kick(clamp(+a||2,0,8),clamp(+d||.35,.05,1.5))},
  reloadLights(){loadLights();loadSmokes()},
  stats(){return{particles:MAXP-freeTop,cap:MAXP,drops:nDrops,lights:LIGHTS.length,errors:Object.assign({},errs)}}
};
})();
