// Sources: official OTE day-ahead 15-minute results and official CNB exchange rate.
// The function runs on Netlify (not in Safari), avoiding browser CORS restrictions.
const OTE='https://www.ote-cr.cz/cs/kratkodobe-trhy/elektrina/denni-trh';
const CNB='https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt';
const headers={'User-Agent':'SpotovaElektrinaPersonal/1.0 (public data)','Accept':'text/html,text/plain;q=0.9,*/*;q=0.8'};
function decode(s){return s.replace(/&nbsp;|&#160;/gi,' ').replace(/&ndash;|&#8211;/gi,'–').replace(/&minus;|&#8722;/gi,'−').replace(/&amp;/gi,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n));}
function clean(s){return decode(s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim()}
function parsePrice(s){const n=Number(s.replace(/\s/g,'').replace(/\u2212/g,'-').replace(/,/g,'.'));return Number.isFinite(n)?n:null}
function parseOte(html){
 const rows=[];
 // The public OTE HTML contains a table with 'Časový interval' and '15min cena (EUR/MWh)'.
 // Read the FIRST two cells of each time-series row; reject rows without a valid price.
 for(const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>clean(x[1]));
  if(cells.length<2)continue;
  const time=cells[0].match(/^(\d{1,2}):(\d{2})\s*[-–−]\s*(\d{1,2}):(\d{2})$/);
  if(!time)continue;
  const price=parsePrice(cells[1]);if(price===null)continue;
  rows.push({hour:+time[1],minute:+time[2],priceEUR:price});
 }
 const uniq=[...new Map(rows.map(x=>[`${x.hour}:${x.minute}`,x])).values()].sort((a,b)=>a.hour-b.hour||a.minute-b.minute);
 if(uniq.length<90||uniq.length>100)throw Error('OTE vrátilo '+uniq.length+' intervalů místo očekávaných 92–100. Struktura stránky se mohla změnit.');
 return uniq;
}
async function getText(url){const r=await fetch(url,{headers,signal:AbortSignal.timeout(14000)});if(!r.ok)throw Error('Zdroj vrátil HTTP '+r.status);return await r.text()}
async function getFx(){const txt=await getText(CNB);const line=txt.split(/\r?\n/).find(x=>/\|EUR\|/.test(x));if(!line)throw Error('Kurz EUR není dostupný na ČNB');const f=line.split('|');const rate=parsePrice(f[4])/Number(f[2]);if(!Number.isFinite(rate)||rate<=0)throw Error('Neplatný kurz ČNB');return {rate,date:txt.split(/\r?\n/)[0].split(' #')[0].trim()}}
function isoDate(date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const v=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${v.year}-${v.month}-${v.day}`}
export default async function handler(){
 try{
  const now=new Date(),today=isoDate(now),tomorrow=isoDate(new Date(now.getTime()+86400000));
  const [fx,t,tom]=await Promise.allSettled([getFx(),getText(OTE+'?date='+today+'&time_resolution=PT15M'),getText(OTE+'?date='+tomorrow+'&time_resolution=PT15M')]);
  if(fx.status!=='fulfilled')throw Error('ČNB: '+fx.reason.message);
  if(t.status!=='fulfilled')throw Error('OTE dnes: '+t.reason.message);
  const hoursToday=parseOte(t.value);
  let hoursTomorrow=[];if(tom.status==='fulfilled'){try{hoursTomorrow=parseOte(tom.value)}catch(_){/* tomorrow may not yet be published */}}
  return new Response(JSON.stringify({hoursToday,hoursTomorrow,eurCzk:fx.value.rate,fxDate:fx.value.date,source:'OTE + ČNB',today,tomorrow}),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300'}})
 }catch(e){return new Response(JSON.stringify({error:String(e.message||e)}),{status:502,headers:{'Content-Type':'application/json; charset=utf-8'}})}
}
export const config={path:'/.netlify/functions/ote-prices'};
