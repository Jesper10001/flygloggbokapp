// BLADES — Joint Logbook · marketing site v3. Pilot + drone, English.
const { useState, useEffect, useRef } = React;

// role glyphs (inline, currentColor)
const RGlyph = {
  pilot: (s=16)=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10.2 3.3a1.7 1.7 0 0 1 3.6 0V9l8 4.5v2.2L13.8 13v4.2l2.4 1.8v1.8L12 19.6 7.8 20.8V19l2.4-1.8V13L2 15.7v-2.2L10.2 9V3.3z"/></svg>,
  drone: (s=16)=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="9.5" y="9.5" width="5" height="5" rx="1.2"/><path d="M9.5 9.5 7 7M14.5 9.5 17 7M9.5 14.5 7 17M14.5 14.5 17 17"/><circle cx="5.5" cy="5.5" r="2.3"/><circle cx="18.5" cy="5.5" r="2.3"/><circle cx="5.5" cy="18.5" r="2.3"/><circle cx="18.5" cy="18.5" r="2.3"/></svg>,
};
const Ico = {
  apple:(s=16)=><svg width={s} height={s} viewBox="0 0 24 24"><path fill="currentColor" d="M17.05 12.04c-.03-2.6 2.13-3.85 2.22-3.91-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.47 7.83 1.3 10.39.86 1.25 1.89 2.66 3.24 2.61 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.29-1.28 3.15-2.54.99-1.46 1.4-2.87 1.42-2.94-.03-.01-2.72-1.05-2.75-4.15M14.6 4.4c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.55-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.58 3.03-1.45"/></svg>,
  arrow:(s=16)=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>,
  check:(s=14)=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5 9 17.5 20 6.5"/></svg>,
  menu:(s=20)=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>,
};

// ── content ──────────────────────────────────────────
const ROLE_DATA = {
  pilot: {
    label:'Pilot', accent:'#00C8E8', accentSoft:'rgba(0,200,232,.13)', accentLine:'rgba(0,200,232,.34)',
    heroA:'Log it in seconds.', heroB:'Copy it into your paper logbook.',
    sub:'Helicopter and fixed-wing. Log a flight right after shutdown, then open the same page as your physical logbook — row for row, totals carried forward — and write it straight across.',
    stats:[['Seconds','to log a flight'],['1:1','your paper logbook, on screen'],['Offline','no account, your data stays yours']],
    points:[
      ['Mixed-rule flights','Log a Y or Z flight in one row — VFR/IFR splits compute against your route.'],
      ['Night & NVG, automatic','Civil twilight from your departure ICAO. Night splits out automatically for NVG time.'],
      ['Your paper logbook, mirrored','Pick your logbook layout. Every flight lands on the right row and page, with totals carried forward.'],
    ],
  },
  drone: {
    label:'Drone Pilot', accent:'#FF8C42', accentSoft:'rgba(255,140,66,.13)', accentLine:'rgba(255,140,66,.34)',
    heroA:'Every mission you fly,', heroB:'logged in seconds.',
    sub:'Open A1/A2/A3 and Specific category. Mission logs, flight modes and your drone fleet in one place.',
    stats:[['Seconds','to log a mission'],['Fleet','every drone, one place'],['Offline','no account, your data stays yours']],
    points:[
      ['Category-aware logging','A1/A2/A3 and Specific, VLOS/EVLOS/BVLOS, mission type — captured the way you actually fly.'],
      ['Your drone fleet','Models, registrations and categories, ready to pick when you log.'],
      ['Your logbook, page by page','Every mission laid out on a logbook spread in the app.'],
    ],
  },
};

const HOW = [
  ['01','Log in seconds','Quicklog captures the essentials: route, times, aircraft, role. Night and totals fill themselves in.'],
  ['02','Open your logbook page','The latest spread opens full-screen in landscape, laid out like your paper book. Copy the rows, check the totals, sign.'],
  ['03','See where you stand','Licence progress, 14-day flight load and your year in the air update the moment you save.'],
];
const FEATURES = [
  { tag:'Flight Load', title:'14-day rolling load', desc:'Calibrated to your own baseline — not a generic stress number.', viz:'bars' },
  { tag:'Licence', title:'CPL / ATPL progress', desc:'Track PIC, IFR, night and cross-country hours live, per requirement.', viz:'rows' },
  { tag:'Quicklog', title:'Logged before you leave the ramp', desc:'The essentials in one screen. Or photograph your flight data and let AI fill it in.', viz:'quick' },
  { tag:'Insights', title:'Your year in the air', desc:'Best week, longest XC, hours over time — surfaced automatically.', viz:'bars2' },
  { tag:'Logbook', title:'Your paper book, on screen', desc:'Your logbook\u2019s own columns and page size, so copying by hand is row for row.', viz:'book' },
  { tag:'Offline-first', title:'Your data, your device', desc:'No account, no cloud scraping. Export anytime as CSV.', viz:'lock' },
];
const PLANS = [
  { name:'Free', amt:'0', per:'forever', feats:['Up to 20 manual flights','Every feature unlocked — share cards, CPL/ATPL tracking, full ICAO database','Free Blade-coins to try AI import & lookup','Offline-first, no account'] },
  { name:'Premium', amt:'39', per:'kr / month', badge:'Premium', feat:true, feats:['Unlimited manual flights','Blade-coins refilled every month','Everything on Free, without the flight limit','No ads, no account'] },
];
const REVIEWS = [
  ['Scanned 14 years of paper logs in an afternoon. It caught a totals mistake I made in 2019.','Erik L.','Helicopter · 4 200 h','EL'],
  ['Logged before I left the ramp, copied into my paper book the same evening.','Hanna B.','CPL(A) · IFR · 2 100 h','HB'],
  ['Finally a logbook that does not pretend drones do not exist. A2 and Specific in one place.','Marcus T.','Drone · A1/A2/A3','MT'],
];
// map pins (%) — placeholder positions
const PINS = [[24,42],[30,34],[46,30],[52,44],[58,36],[64,52],[38,56],[70,40],[80,58],[18,52],[44,66],[56,62]];

// ── scroll reveal ────────────────────────────────────
function useReveal(){
  useEffect(()=>{
    const io=new IntersectionObserver((es)=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}}),{threshold:.12,rootMargin:'0px 0px -8% 0px'});
    document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
    return ()=>io.disconnect();
  },[]);
}
function useCountUp(target, run){
  const [v,setV]=useState(0);
  useEffect(()=>{ if(!run)return; let r; const t0=performance.now(); const d=1200;
    const tick=(n)=>{const p=Math.min(1,(n-t0)/d);setV(target*(1-Math.pow(1-p,3)));if(p<1)r=requestAnimationFrame(tick);else setV(target);};
    r=requestAnimationFrame(tick);return ()=>cancelAnimationFrame(r);
  },[run,target]);
  return v;
}

// ── licence insights (ATPL) — graph ↔ hours, exactly like the app ──
const ATPL = {
  code:'ATPL(A)', ref:'FCL.510.A', startYear:2020, nowMonth:58,
  reqs:[
    {label:'Total time',    key:'tt', have:921, req:1500, rate:22, color:'#00C8E8'},
    {label:'PIC',           key:'pic',have:281, req:250,  rate:6,  color:'#00E8A0'},
    {label:'Cross-country', key:'xc', have:242, req:200,  rate:7,  color:'#9B8CFF'},
    {label:'Instrument',    key:'if', have:96,  req:75,   rate:4,  color:'#5DA9FF'},
    {label:'Multi-crew',    key:'mp', have:182, req:500,  rate:13, color:'#FFB830'},
    {label:'Night',         key:'nt', have:45,  req:100,  rate:3,  color:'#FF6B5B'},
  ],
};
function yearLabel(startYear, month){ const y=startYear+Math.floor(month/12); const m=String((month%12)+1).padStart(2,'0'); return m+'/'+String(y).slice(2); }

function LicenceGraph(){
  const D=ATPL, W=232, H=150, padL=6, padR=6, padT=14, padB=22;
  const now=D.nowMonth;
  const rows=D.reqs.map(r=>{
    const met=r.have>=r.req;
    const cross = met ? now*(r.req/r.have) : now+(r.req-r.have)/r.rate;
    return {...r, met, cross};
  });
  const maxM=Math.max(now,...rows.map(r=>r.cross))*1.02;
  const yMax=1.25;
  const x=m=>padL+m/maxM*(W-padL-padR);
  const y=f=>padT+(1-Math.min(f,yMax)/yMax)*(H-padT-padB);
  const y100=y(1);
  const years=[]; for(let m=0;m<=maxM;m+=12) years.push(m);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:'block'}}>
      <line x1={padL} y1={y100} x2={W-padR} y2={y100} stroke="#FFB830" strokeWidth="1" strokeDasharray="3 3" opacity=".55"/>
      <text x={padL} y={y100-4} fontFamily="var(--mono)" fontSize="7" fontWeight="700" fill="#FFB830">TARGET 100%</text>
      {years.map((m,i)=><g key={i}><line x1={x(m)} y1={padT} x2={x(m)} y2={H-padB} stroke="var(--sep)" strokeWidth="1"/><text x={x(m)} y={H-padB+11} textAnchor="middle" fontFamily="var(--mono)" fontSize="7.5" fontWeight="700" fill="var(--ink4)">{D.startYear+m/12}</text></g>)}
      <line x1={x(now)} y1={padT} x2={x(now)} y2={H-padB} stroke="var(--ink3)" strokeWidth="1" strokeDasharray="1 3" opacity=".5"/>
      <text x={x(now)} y={padT-4} textAnchor="middle" fontFamily="var(--mono)" fontSize="6.5" fontWeight="700" fill="var(--ink3)">NOW</text>
      {rows.map((r,i)=>{
        const hist = r.met ? `M ${x(0)} ${y(0)} L ${x(r.cross)} ${y100}` : `M ${x(0)} ${y(0)} L ${x(now)} ${y(r.have/r.req)}`;
        const proj = r.met ? '' : `M ${x(now)} ${y(r.have/r.req)} L ${x(r.cross)} ${y100}`;
        return <g key={i}>
          <path d={hist} fill="none" stroke={r.color} strokeWidth="1.8" strokeLinecap="round"/>
          {proj&&<path d={proj} fill="none" stroke={r.color} strokeWidth="1.4" strokeDasharray="3 3" opacity=".85"/>}
          <circle cx={x(r.cross)} cy={y100} r="3.6" fill={r.met?r.color:'var(--bg)'} stroke={r.color} strokeWidth="1.8"/>
        </g>;
      })}
    </svg>
  );
}
function LicenceHours(){
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {ATPL.reqs.map((r,i)=>{const met=r.have>=r.req;const pct=Math.min(100,r.have/r.req*100);const cross=met?ATPL.nowMonth*(r.req/r.have):ATPL.nowMonth+(r.req-r.have)/r.rate;
        return <div className="ins-row" key={i}>
          <div className="ins-rt"><span className="ins-rl">{r.label}</span>
            <span className="ins-rv" style={{color:'var(--ink)'}}>{Math.round(r.have)}<span style={{color:'var(--ink4)',fontWeight:400}}>/{r.req}h</span></span></div>
          <div className="ins-bar"><i style={{width:pct+'%',background:met?'#00E8A0':r.color}}></i></div>
          <div style={{display:'flex',justifyContent:'space-between'}}>
            <span style={{fontFamily:'var(--mono)',fontSize:7.5,color:'var(--ink4)'}}>{met?'✓ complete':'in progress'}</span>
            <span style={{fontFamily:'var(--mono)',fontSize:7.5,color:met?'#00E8A0':'var(--ink4)'}}>{met?'✓ '+yearLabel(ATPL.startYear,cross):'→ '+yearLabel(ATPL.startYear,cross)}</span></div>
        </div>;})}
    </div>
  );
}
function LicenceInsights(){
  const [view,setView]=useState('graph');
  const met=ATPL.reqs.filter(r=>r.have>=r.req).length;
  const overall=Math.round(ATPL.reqs.reduce((s,r)=>s+Math.min(1,r.have/r.req),0)/ATPL.reqs.length*100);
  return (
    <div className="ph-card" style={{gap:10}}>
      <div style={{display:'flex',alignItems:'center',gap:7}}>
        <span className="ph-chip">Next licence</span>
        <span style={{flex:1}}></span>
        <span style={{fontFamily:'var(--mono)',fontSize:8.5,fontWeight:700,color:'var(--ink4)'}}>{met}/6 met</span>
      </div>
      <div style={{display:'flex',alignItems:'baseline',gap:8}}>
        <span style={{fontFamily:'var(--serif)',fontWeight:500,fontSize:24,color:'var(--ink)',letterSpacing:'-.02em'}}>{ATPL.code}</span>
        <span style={{fontFamily:'var(--mono)',fontSize:8,color:'var(--ink4)'}}>{ATPL.ref}</span>
        <span style={{flex:1}}></span>
        <span style={{fontFamily:'var(--serif)',fontWeight:600,fontSize:22,color:'var(--acc)'}}>{overall}%</span>
      </div>
      <div className="ins-seg">
        <button className={view==='graph'?'on':''} onClick={()=>setView('graph')}>Graph</button>
        <button className={view==='hours'?'on':''} onClick={()=>setView('hours')}>Hours</button>
      </div>
      {view==='graph'?<LicenceGraph/>:<LicenceHours/>}
    </div>
  );
}

// ── phone screen — live ATPL insights mockup ─────────
function Phone({ role }){
  const drone = role==='drone';
  return (
    <div className="stage">
      <div className="phone">
        <div className="ph-badge tr">{drone?'Mission log':'Live progress'}</div>
        <div className="ph-badge bl">{drone?'A1/A2/A3':'EASA ready'}</div>
        <div className="notch"></div>
        <div className="screen">
          <div className="ph-fill" style={{padding:'44px 14px 16px',gap:10,overflowY:'auto'}}>
            <span className="ph-chip">Insights · Licence journey</span>
            <LicenceInsights/>
            <div className="ph-card" style={{gap:6}}>
              <span className="ph-chip" style={{color:'var(--ink4)'}}>{drone?'Latest mission':'Latest flight'}</span>
              <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                <span style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:15,color:'var(--ink)'}}>{drone?'A2 · VLOS':'ESSB → ESGG'}</span>
                <span style={{flex:1}}></span>
                <span style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--acc)'}}>{drone?'0:32':'1:24'}</span>
              </div>
              <span style={{fontFamily:'var(--mono)',fontSize:8.5,color:'var(--ink4)'}}>{drone?'Logged · page 4, row 7':'Logged · page 38, row 9'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatViz({ kind }){
  if(kind==='bars'||kind==='bars2'){const hs=kind==='bars'?[40,62,48,70,55,80,60,44,66]:[30,50,44,66,58,74,52];return <div className="v-bars">{hs.map((h,i)=><i key={i} className={h>=74?'pk':''} style={{height:h+'%'}}></i>)}</div>;}
  if(kind==='rows')return <div className="v-rows">{[82,60,45,30].map((w,i)=><div key={i} className="v-row"><div className="t"><i style={{width:w+'%'}}></i></div></div>)}</div>;
  if(kind==='rings')return <div style={{display:'flex',gap:12,alignItems:'center',justifyContent:'center',width:'100%'}}>{[1,.7,.45,1].map((p,i)=>{const R=15,C=2*Math.PI*R;return <svg key={i} width="38" height="38" style={{transform:'rotate(-90deg)'}}><circle cx="19" cy="19" r={R} stroke="var(--sep)" strokeWidth="4" fill="none"/><circle cx="19" cy="19" r={R} stroke="var(--acc)" strokeWidth="4" fill="none" strokeLinecap="round" strokeDasharray={`${C*p} ${C}`}/></svg>;})}</div>;
  if(kind==='certs')return <div className="v-rows">{[['#00E8A0',82],['#FFB830',54],['#FF6B5B',26]].map(([c,w],i)=><div key={i} className="v-row"><span className="v-dot" style={{background:c}}></span><div className="t"><i style={{width:w+'%',background:c}}></i></div></div>)}</div>;
  if(kind==='quick')return <div className="v-quick">{[['DEP','ESSB'],['ARR','ESGG'],['TIME','1:24'],['A/C','AS350']].map(([k,v],i)=><div key={i}><span>{k}</span><b>{v}</b></div>)}</div>;
  if(kind==='book')return <div className="v-book"><div className="pg">{[0,1,2,3,4].map(i=><i key={i}></i>)}</div><div className="pg">{[0,1,2,3,4].map(i=><i key={i}></i>)}</div></div>;
  if(kind==='lock')return <div style={{display:'grid',placeItems:'center',width:'100%',color:'var(--acc)'}}><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div>;
  return null;
}

// ── spinnable globe with country pins (orthographic, canvas) ─────────
const GLOBE_PTS = [
  ['Stockholm',59.3,18.1,1],['Oslo',59.9,10.7],['Copenhagen',55.6,12.6],['Helsinki',60.2,24.9],
  ['London',51.5,-0.1],['Paris',48.9,2.4],['Amsterdam',52.3,4.8],['Frankfurt',50.0,8.6],
  ['Munich',48.1,11.6],['Zurich',47.4,8.5],['Vienna',48.1,16.4],['Rome',41.9,12.5],
  ['Madrid',40.4,-3.7],['Barcelona',41.4,2.2],['Lisbon',38.7,-9.1],['Athens',38.0,23.7],
  ['Istanbul',41.0,28.9],['Warsaw',52.2,21.0],['Reykjavik',64.1,-21.9],['Dublin',53.3,-6.3],
  ['Moscow',55.8,37.6],['Dubai',25.3,55.4],['Doha',25.3,51.5],['Cairo',30.1,31.4],
  ['Nairobi',-1.3,36.9],['Johannesburg',-26.1,28.2],['Lagos',6.6,3.3],['Casablanca',33.4,-7.6],
  ['New York',40.6,-73.8],['Toronto',43.7,-79.6],['Chicago',41.9,-87.9],['Los Angeles',33.9,-118.4],
  ['Miami',25.8,-80.3],['Mexico City',19.4,-99.1],['Sao Paulo',-23.4,-46.5],['Buenos Aires',-34.8,-58.5],
  ['Bogota',4.7,-74.1],['Tokyo',35.6,140.0],['Seoul',37.5,127.0],['Beijing',40.1,116.6],
  ['Shanghai',31.1,121.8],['Hong Kong',22.3,113.9],['Singapore',1.4,103.9],['Bangkok',13.7,100.7],
  ['Delhi',28.6,77.1],['Mumbai',19.1,72.9],['Sydney',-33.9,151.2],['Auckland',-37.0,174.8],
];
const HUBS = ['London','Frankfurt','New York','Dubai','Tokyo','Sao Paulo'];
function Globe(){
  const ref=useRef(null);
  useEffect(()=>{
    const cv=ref.current, ctx=cv.getContext('2d');
    let raf, rotY=20, rotX=-18, vY=.12, vX=0, drag=false, lastX=0, lastY=0, dpr=Math.min(2,window.devicePixelRatio||1);
    const home=GLOBE_PTS.find(p=>p[3]);
    function size(){ const r=cv.getBoundingClientRect(); cv.width=r.width*dpr; cv.height=r.height*dpr; }
    size(); window.addEventListener('resize',size);
    const D2R=Math.PI/180;
    function proj(lat,lon){
      const la=lat*D2R, lo=(lon+rotY)*D2R;
      let x=Math.cos(la)*Math.sin(lo), y=Math.sin(la), z=Math.cos(la)*Math.cos(lo);
      const rx=rotX*D2R, y2=y*Math.cos(rx)-z*Math.sin(rx), z2=y*Math.sin(rx)+z*Math.cos(rx);
      return {x, y:y2, z:z2};
    }
    function slerp(a,b,t){ const d=a.x*b.x+a.y*b.y+a.z*b.z; const o=Math.acos(Math.max(-1,Math.min(1,d))); if(o<1e-4)return a; const s=Math.sin(o); const k0=Math.sin((1-t)*o)/s, k1=Math.sin(t*o)/s; return {x:a.x*k0+b.x*k1,y:a.y*k0+b.y*k1,z:a.z*k0+b.z*k1}; }
    function unit(lat,lon){ const la=lat*D2R, lo=lon*D2R; return {x:Math.cos(la)*Math.sin(lo),y:Math.sin(la),z:Math.cos(la)*Math.cos(lo)}; }
    function draw(){
      const W=cv.width, H=cv.height, cx=W/2, cy=H/2, Rr=Math.min(W,H)*.4;
      const acc=(getComputedStyle(document.documentElement).getPropertyValue('--acc')||'#00C8E8').trim();
      ctx.clearRect(0,0,W,H);
      // glow
      const gl=ctx.createRadialGradient(cx,cy,Rr*.6,cx,cy,Rr*1.5); gl.addColorStop(0,acc+'22'); gl.addColorStop(1,'transparent');
      ctx.fillStyle=gl; ctx.beginPath(); ctx.arc(cx,cy,Rr*1.5,0,7); ctx.fill();
      // ocean sphere
      const og=ctx.createRadialGradient(cx-Rr*.3,cy-Rr*.35,Rr*.2,cx,cy,Rr); og.addColorStop(0,'#12294A'); og.addColorStop(1,'#0A1628');
      ctx.fillStyle=og; ctx.beginPath(); ctx.arc(cx,cy,Rr,0,7); ctx.fill();
      ctx.strokeStyle=acc+'44'; ctx.lineWidth=dpr; ctx.beginPath(); ctx.arc(cx,cy,Rr,0,7); ctx.stroke();
      // graticule
      ctx.strokeStyle='rgba(127,168,200,.16)'; ctx.lineWidth=dpr*.7;
      for(let lat=-60;lat<=60;lat+=30){ ctx.beginPath(); let started=false; for(let lon=-180;lon<=180;lon+=4){ const p=proj(lat,lon); if(p.z>0){ const sx=cx+p.x*Rr, sy=cy-p.y*Rr; if(!started){ctx.moveTo(sx,sy);started=true;}else ctx.lineTo(sx,sy);} else started=false; } ctx.stroke(); }
      for(let lon=-180;lon<180;lon+=30){ ctx.beginPath(); let started=false; for(let lat=-90;lat<=90;lat+=4){ const p=proj(lat,lon); if(p.z>0){ const sx=cx+p.x*Rr, sy=cy-p.y*Rr; if(!started){ctx.moveTo(sx,sy);started=true;}else ctx.lineTo(sx,sy);} else started=false; } ctx.stroke(); }
      // arcs from home
      const hp=proj(home[1],home[2]); const hU=unit(home[1],home[2]);
      HUBS.forEach(name=>{ const t=GLOBE_PTS.find(p=>p[0]===name); if(!t)return; const tU=unit(t[1],t[2]);
        ctx.strokeStyle=acc+'88'; ctx.lineWidth=dpr*1.1; ctx.beginPath(); let started=false;
        for(let k=0;k<=24;k++){ const v=slerp(hU,tU,k/24); const lat=Math.asin(v.y)/D2R; const lon=Math.atan2(v.x,v.z)/D2R; const p=proj(lat,lon); if(p.z>0){ const sx=cx+p.x*Rr,sy=cy-p.y*Rr; if(!started){ctx.moveTo(sx,sy);started=true;}else ctx.lineTo(sx,sy);} else started=false; }
        ctx.stroke();
      });
      // pins
      GLOBE_PTS.forEach(p=>{ const pr=proj(p[1],p[2]); if(pr.z<=0)return; const sx=cx+pr.x*Rr, sy=cy-pr.y*Rr; const home=p[3];
        const r=(home?4.5:2.6)*dpr*(0.6+pr.z*0.4);
        ctx.fillStyle=acc+'33'; ctx.beginPath(); ctx.arc(sx,sy,r*2.4,0,7); ctx.fill();
        ctx.fillStyle=home?'#FFFFFF':acc; ctx.beginPath(); ctx.arc(sx,sy,r,0,7); ctx.fill();
        if(home){ ctx.fillStyle=acc; ctx.beginPath(); ctx.arc(sx,sy,r*.5,0,7); ctx.fill(); }
      });
      if(!drag){ rotY+=vY; rotX+=vX; vX*=.94; if(Math.abs(vY)<.12&&!drag) vY+=(.12-vY)*.02; }
      raf=requestAnimationFrame(draw);
    }
    draw();
    const down=e=>{drag=true;lastX=e.clientX;lastY=e.clientY;vY=0;vX=0;cv.setPointerCapture(e.pointerId);};
    const move=e=>{if(!drag)return; const dx=e.clientX-lastX, dy=e.clientY-lastY; rotY+=dx*.35; rotX=Math.max(-85,Math.min(85,rotX-dy*.35)); vY=dx*.35; vX=-dy*.02; lastX=e.clientX; lastY=e.clientY;};
    const up=()=>{drag=false; if(Math.abs(vY)<.05)vY=.12;};
    cv.addEventListener('pointerdown',down); cv.addEventListener('pointermove',move); cv.addEventListener('pointerup',up); cv.addEventListener('pointerleave',up);
    return ()=>{cancelAnimationFrame(raf); window.removeEventListener('resize',size);};
  },[]);
  return <canvas ref={ref} className="globe-cv"></canvas>;
}

// ── paper logbook spread (the app's fill view) ──
const SPREAD_ROWS=[
  ['03/09','ESSB','ESGG','AS350','SE-JUX','1:24','1:24','','1','0'],
  ['03/09','ESGG','ESSB','AS350','SE-JUX','1:18','1:18','0:22','0','1'],
  ['05/09','ESSB','ESSB','AW109','SE-JRH','0:48','','','2','0'],
  ['08/09','ESSB','ESOW','AS350','SE-JUX','0:36','0:36','','1','0'],
  ['08/09','ESOW','ESSB','AS350','SE-JUX','0:40','0:40','0:40','0','1'],
  ['11/09','ESSB','ESKN','AW109','SE-JRH','0:52','','','1','0'],
  ['11/09','ESKN','ESSB','AW109','SE-JRH','0:55','','0:15','0','1'],
];
function Spread(){
  const L=['Date','From','To','Type','Reg','Total'], Rc=['PIC','Night','Ldg D','Ldg N'];
  const blank=Array.from({length:3});
  return (
    <div className="spread-scroll"><div className="spread">
      <div className="sp-page">
        <div className="sp-row sp-h" style={{gridTemplateColumns:'.9fr 1fr 1fr 1fr 1.1fr .9fr'}}>{L.map(h=><span key={h}>{h}</span>)}</div>
        {SPREAD_ROWS.map((r,i)=><div className="sp-row" key={i} style={{gridTemplateColumns:'.9fr 1fr 1fr 1fr 1.1fr .9fr'}}>{r.slice(0,6).map((c,j)=><span key={j}>{c}</span>)}</div>)}
        {blank.map((_,i)=><div className="sp-row" key={'b'+i} style={{gridTemplateColumns:'.9fr 1fr 1fr 1fr 1.1fr .9fr'}}>{L.map((_,j)=><span key={j}></span>)}</div>)}
        <div className="sp-tot"><span>Total this page</span><b>6:33</b></div>
        <div className="sp-tot"><span>Brought forward</span><b>912:08</b></div>
        <div className="sp-tot big"><span>Total to date</span><b>918:41</b></div>
        <span className="sp-pn">38</span>
      </div>
      <div className="sp-page">
        <div className="sp-row sp-h" style={{gridTemplateColumns:'1fr 1fr .8fr .8fr 2fr'}}>{[...Rc,'Remarks'].map(h=><span key={h}>{h}</span>)}</div>
        {SPREAD_ROWS.map((r,i)=><div className="sp-row" key={i} style={{gridTemplateColumns:'1fr 1fr .8fr .8fr 2fr'}}>{r.slice(6).map((c,j)=><span key={j}>{c}</span>)}<span></span></div>)}
        {blank.map((_,i)=><div className="sp-row" key={'b'+i} style={{gridTemplateColumns:'1fr 1fr .8fr .8fr 2fr'}}>{[0,1,2,3,4].map(j=><span key={j}></span>)}</div>)}
        <div className="sp-tot"><span>This page</span><b>4:38 · 1:17 · 5 · 3</b></div>
        <div className="sp-tot"><span>Brought forward</span><b>281:20 · 44:05</b></div>
        <div className="sp-tot big"><span>Total to date</span><b>285:58 · 45:22</b></div>
        <span className="sp-pn r">39</span>
      </div>
    </div></div>
  );
}

function Nav({ role, setRole }){
  const [open,setOpen]=useState(false);
  return (
    <nav className="nav"><div className="wrap nav-in">
      <a href="#top" className="brand"><img className="brand-lockup" src="web-v3/blades-lockup-h.png" alt="BLADES — Pilot Logbook"/></a>
      <div className="roletog">
        <span className="role-pill" style={{left:role==='pilot'?3:'50%',width:'calc(50% - 3px)'}}></span>
        {['pilot','drone'].map(r=><button key={r} className={'role-tab'+(role===r?' on':'')} onClick={()=>setRole(r)}>{ROLE_DATA[r].label}</button>)}
      </div>
      <div className="nav-links">
        <a className="nav-link" href="#logbook">Logbook</a>
        <a className="nav-link" href="#how">How it works</a>
        <a className="nav-link" href="#features">Features</a>
        <a className="nav-link" href="#pricing">Pricing</a>
        <a className="btn btn-primary nav-cta" href="#download">{Ico.apple(15)} Download</a>
      </div>
      <button className="burger" onClick={()=>setOpen(o=>!o)}>{Ico.menu(20)}</button>
    </div></nav>
  );
}

function Site(){
  const [role,setRole]=useState('pilot');
  const R=ROLE_DATA[role];
  useReveal();
  useEffect(()=>{
    const s=document.documentElement.style;
    s.setProperty('--acc',R.accent); s.setProperty('--acc-soft',R.accentSoft); s.setProperty('--acc-line',R.accentLine);
  },[role]);
  const [heroIn,setHeroIn]=useState(false);
  useEffect(()=>{const t=setTimeout(()=>setHeroIn(true),200);return()=>clearTimeout(t);},[]);

  return (
    <div id="top">
      <Nav role={role} setRole={setRole}/>

      {/* HERO */}
      <header className="hero"><div className="wrap hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">BLADES · Pilot Logbook</span>
          <h1>{R.heroA}<br/><span className="l2">{R.heroB}</span></h1>
          <p className="hero-sub">{R.sub}</p>
          <div className="hero-ctas">
            <a className="btn btn-primary" href="#download">{Ico.apple(16)} Download on the App Store</a>
            <a className="btn btn-ghost" href="#how">See how it works {Ico.arrow(16)}</a>
          </div>
          <div className="hero-stats">{R.stats.map(([v,k],i)=><div className="stat" key={i}><b>{v}</b><span>{k}</span></div>)}</div>
        </div>
        <Phone role={role}/>
      </div></header>

      {/* PAPER LOGBOOK */}
      <section className="section" id="logbook"><div className="wrap">
        <div className="head reveal">
          <span className="eyebrow">Your physical logbook, in the app</span>
          <h2 className="stitle">Open the page. <em>Copy it across.</em></h2>
          <p className="ssub">Choose the layout of the logbook you actually carry. BLADES puts every flight on the right page and row, carries the totals forward and shows the latest spread full-screen, so writing it into the paper book takes a minute and no maths.</p>
        </div>
        <div className="reveal" style={{marginTop:40}}><Spread/></div>
        <p className="spread-cap reveal">The same spread you get in the app. Turn the phone sideways and it fills the screen.</p>
      </div></section>

      {/* MAKER */}
      <section className="section" id="maker"><div className="wrap">
        <div className="maker reveal">
          <span className="eyebrow">Why it exists</span>
          <h2 className="stitle">I built it <em>for myself</em></h2>
          <div className="maker-body">
            <p>I fly for a living. After every flight I wanted two things: to get it logged in seconds, and to copy it into my paper logbook without adding up columns by hand. No app did both, so I built one.</p>
            <p>BLADES is the logbook I use myself, made exactly the way I want it. Every feature in it is something I needed on my own flights.</p>
          </div>
          <span className="maker-sig">The pilot behind BLADES</span>
        </div>
      </div></section>

      {/* ROLES */}
      <section className="section" id="roles"><div className="wrap">
        <div className="head reveal">
          <span className="eyebrow">Built for how you fly</span>
          <h2 className="stitle">One app, <em>{role==='pilot'?'every cockpit':'every mission'}</em>.</h2>
          <p className="ssub">Switch the toggle up top — the whole app tailors its fields and exports to your world.</p>
        </div>
        <div className="role-detail reveal">
          <div className="role-points">
            {R.points.map(([h,p],i)=><div className="rp" key={i}><div className="rp-ic">{RGlyph[role](19)}</div><div><h4>{h}</h4><p>{p}</p></div></div>)}
          </div>
          <Phone role={role}/>
        </div>
      </div></section>

      {/* HOW */}
      <section className="section" id="how"><div className="wrap">
        <div className="head reveal"><span className="eyebrow">How it works</span><h2 className="stitle">Cockpit to logbook, <em>fast</em>.</h2></div>
        <div className="how">{HOW.map(([n,h,p],i)=><div className="how-step reveal" key={i} style={{transitionDelay:(i*70)+'ms'}}><div className="how-n">{n}</div><div className="how-b"><h3>{h}</h3><p>{p}</p></div></div>)}</div>
      </div></section>

      {/* FEATURES */}
      <section className="section" id="features" style={{background:'linear-gradient(180deg,transparent,rgba(8,15,28,.6))'}}><div className="wrap">
        <div className="head c reveal"><span className="eyebrow c">What you get</span><h2 className="stitle">Built the way pilots <em>actually work</em>.</h2></div>
        <div className="feat-grid">{FEATURES.map((f,i)=><div className="feat reveal" key={i} style={{transitionDelay:(i%3*70)+'ms'}}><div className="feat-viz"><FeatViz kind={f.viz}/></div><div className="feat-b"><span className="feat-tag">{f.tag}</span><h3>{f.title}</h3><p>{f.desc}</p></div></div>)}</div>
      </div></section>

      {/* WORLD MAP */}
      <section className="section" id="map"><div className="wrap">
        <div className="head c reveal"><span className="eyebrow c">Your world of flights</span><h2 className="stitle">Every airport you’ve <em>touched</em>.</h2><p className="ssub" style={{textAlign:'center'}}>Your flights, projected onto the globe — every field, every country, one map.</p></div>
        <div className="map-wrap reveal">
          <Globe/>
          <div className="map-stats">
            <div className="map-stat"><b>58</b><span>Airports</span></div>
            <div className="map-stat"><b>19</b><span>Countries</span></div>
            <div className="map-stat"><b>2 371</b><span>NM longest</span></div>
          </div>
          <div className="globe-hint">Drag to spin · placeholder data</div>
        </div>
      </div></section>

      {/* PRICING */}
      <section className="section" id="pricing"><div className="wrap">
        <div className="head c reveal"><span className="eyebrow c">Pricing</span><h2 className="stitle">Free to start. <em>No surprises.</em></h2></div>
        <div className="price-grid">{PLANS.map((p,i)=><div className={'plan reveal'+(p.feat?' feat-plan':'')} key={i} style={{transitionDelay:(i*70)+'ms'}}>
          <div className="plan-top"><span className="plan-name">{p.name}</span>{p.badge&&<span className="plan-badge">{p.badge}</span>}</div>
          <div className="plan-price"><span className="plan-amt">{p.amt}</span><span className="plan-per">{p.per}</span></div>
          <ul className="plan-feats">{p.feats.map((f,j)=><li key={j}>{Ico.check(14)}{f}</li>)}</ul>
          <a className={'btn '+(p.feat?'btn-primary':'btn-ghost')} href="#download" style={{width:'100%'}}>{p.name==='Free'?'Get started':'Go Premium'}</a>
        </div>)}</div>
      </div></section>


      {/* CLOSER */}
      <section className="section closer" id="download"><div className="wrap">
        <div className="closer-card reveal">
          <img src="web-v3/blades-lockup-h.png" alt="BLADES — Pilot Logbook" style={{width:'min(320px,72%)',height:'auto',position:'relative'}}/>
          <h2>Your logbook, finally<br/>worth opening.</h2>
          <p>Free to start — 20 flights with every feature unlocked, plus free Blade-coins to try the AI features. Premium is 39 kr/month for unlimited flights. No account.</p>
          <div className="hero-ctas" style={{justifyContent:'center',position:'relative'}}>
            <a className="btn btn-primary" href="#">{Ico.apple(16)} Download on the App Store</a>
            <a className="btn btn-ghost" href="#how">See how it works {Ico.arrow(16)}</a>
          </div>
        </div>
      </div></section>

      <footer className="footer"><div className="wrap footer-in">
        <a href="#top" className="brand"><img className="brand-lockup" src="web-v3/blades-lockup-h.png" alt="BLADES — Pilot Logbook" style={{height:22}}/></a>
        <nav className="footer-links"><a href="#how">How it works</a><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
        <span className="footer-copy">© 2026 BLADES · Built by a pilot, in Sweden</span>
      </div></footer>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<Site/>);
