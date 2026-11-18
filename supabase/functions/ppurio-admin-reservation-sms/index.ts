// The staff customer SMS sender is separate. This relay accepts only a website
// booking alert attested by the other project's active private delivery claim.
import { Buffer } from "node:buffer";

const CALLBACK = "https://omhcaozfzliigqctedus.supabase.co/functions/v1/send-reservation-sms/verify-ppurio";
const PROVIDER = "https://message.ppurio.com/v1/";
const TABLE = "ppurio_admin_reservation_delivery";
const SUBJECT = "경일렌트카 예약접수";
const HEADING = "[경일렌트카 홈페이지 예약접수]\n";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE = /^01[016789]\d{7,8}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_BYTES = 12_000;
const encoder = new TextEncoder();
const reply = (code: number, obj: object) => Response.json(obj, {status:code, headers:{"Cache-Control":"no-store"}});
const digest = async (bytes: Uint8Array) => Buffer.from(await crypto.subtle.digest("SHA-256",bytes)).toString("hex");
const envGetter = (name: string) => Deno.env.get(name)?.trim() || "";
function proxyClient(proxyUrl: string) {
  const url = new URL(proxyUrl);
  if (!["http:","https:"].includes(url.protocol)) throw Error("config");
  return Deno.createHttpClient({proxy:{url:url.origin,basicAuth:{
    username:decodeURIComponent(url.username),password:decodeURIComponent(url.password)
  }}});
}

async function readBody(req: Request) {
  if (!req.body || Number(req.headers.get("content-length") || 0)>MAX_BYTES) return null;
  const reader=req.body.getReader(), chunks:Uint8Array[]=[]; let size=0;
  try {
    for (;;) {
      const part=await reader.read();
      if (part.done) break;
      size+=part.value.length;
      if(size>MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(part.value);
    }
    const raw=new Uint8Array(size); let i=0;
    for(const value of chunks){raw.set(value,i);i+=value.length;}
    return raw;
  } finally {reader.releaseLock();}
}
type Input = {reservationId:string,recipients:string[],subject:string,text:string};
function validInput(input: Input) {
  return input && typeof input==="object" && Object.keys(input).sort().join(",")==="recipients,reservationId,subject,text"
    && typeof input.reservationId==="string" && UUID.test(input.reservationId)
    && Array.isArray(input.recipients) && input.recipients.length===3 && new Set(input.recipients).size===3
    && input.recipients.every(n=>typeof n==="string" && PHONE.test(n)) && input.subject===SUBJECT
    && typeof input.text==="string" && input.text.startsWith(HEADING) && encoder.encode(input.text).length<=2000;
}
type Runtime = {getEnv:typeof envGetter, fetcher:typeof fetch, createClient:typeof proxyClient, now:()=>number};
export function makeHandler({getEnv=envGetter,fetcher=fetch,createClient=proxyClient,now=Date.now}:Partial<Runtime>={}) {
  const dt = () => new Date(now()).toISOString();
  const config=() => {
    // Set the override only after Ppurio approves the number for this account.
    const account=getEnv("PPURIO_ACCOUNT"), key=getEnv("PPURIO_API_KEY"),
      rawFrom=getEnv("PPURIO_ADMIN_RESERVATION_FROM") || getEnv("PPURIO_FROM"),
      proxy=getEnv("FIXIE_URL"), base=getEnv("SUPABASE_URL"), dbKey=getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const from=rawFrom.replace(/[\s()-]/g,"").replace(/^\+820?/,"0");
    if (!account || !key || !/^\d{8,12}$/.test(from) || !proxy || !base || !dbKey) return null;
    return {account,key,from,proxy,base,dbKey};
  };
  return async function handle(req: Request):Promise<Response> {
    const path=new URL(req.url).pathname, conf=config();
    if(req.method==="GET" && path.endsWith("/health")) return reply(conf?200:503,{ok:!!conf,service:"ppurio-admin-reservation-sms",revision:"2026-11-09-sender-v2"});
    if(!path.endsWith("/ppurio-admin-reservation-sms") || req.method!=="POST")return reply(405,{error:"method_not_allowed"});
    if(!conf)return reply(503,{error:"configuration_unavailable"});
    const signature=req.headers.get("x-ky-signature") || "", timestamp=req.headers.get("x-ky-timestamp") || "";
    if(!HEX64.test(signature) || !/^\d{10}$/.test(timestamp) || Math.abs(Math.floor(now()/1000)-Number(timestamp))>120) return reply(401,{error:"unauthorized"});
    let raw:Uint8Array|null, input:Input;
    try {
      raw=await readBody(req); if(!raw)return reply(413,{error:"invalid_payload"});
      input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
      if(!validInput(input))return reply(400,{error:"invalid_payload"});
    } catch {return reply(400,{error:"invalid_payload"});}
    const reservationId=input.reservationId, bodyHash=await digest(raw);
    const accepted=(groupId:string)=>reply(200,{status:"accepted",accepted:true,recipientCount:3,reservationId,groupId});
    const rejected=()=>reply(503,{status:"rejected",accepted:false,recipientCount:0,reservationId});
    const unknown=()=>reply(502,{status:"unknown",reservationId});
    // The callback verifies the MAC using the reservation's active claim token.
    // Never follow redirects or send the text, phone numbers, or a service key.
    try {
      const check=await fetcher(CALLBACK,{method:"POST",redirect:"error",signal:AbortSignal.timeout(5000),
        headers:{"Content-Type":"application/json"},body:JSON.stringify({reservationId,timestamp,digest:bodyHash,signature})});
      if(!check.ok)return reply(check.status===401||check.status===403?401:503,{error:"verification_failed"});
      if((await check.json())?.verified!==true)return reply(401,{error:"unauthorized"});
    }catch{return reply(503,{error:"verification_unavailable"});}

    const db=(method:string,params:Record<string,string>={},body?:object,prefer?:string) => {
      const url=new URL("/rest/v1/"+TABLE,conf.base);
      url.search = new URLSearchParams(params).toString();
      return fetcher(url.toString(), {method,redirect:"error",signal:AbortSignal.timeout(4000),
        headers:{apikey:conf.dbKey,Authorization:"Bearer "+conf.dbKey,"Content-Type":"application/json",...(prefer?{Prefer:prefer}:{})},
        body:body?JSON.stringify(body):undefined});
    };
    const claimId=crypto.randomUUID(), slot={reservation_id:"eq."+reservationId};
    try{
      const inserted=await db("POST",{},{
        reservation_id:reservationId,payload_digest:bodyHash,claim_id:claimId,state:"processing",attempts:1
      });
      if(!inserted.ok){
        if(inserted.status!==409 || (await inserted.json())?.code!=="23505")return unknown();
        const check=await db("GET",{...slot,select:"state,payload_digest,attempts,provider_id",limit:"1"});
        if(!check.ok)return unknown();
        const [seen]=await check.json();
        if(!seen || seen.payload_digest!==bodyHash)return unknown();
        if(seen.state==="accepted" && seen.provider_id)return accepted(seen.provider_id);
        if(seen.state!=="rejected")return unknown();
        if(seen.attempts>=3)return rejected();
        const second=await db("PATCH",{...slot,state:"eq.rejected",attempts:"eq."+seen.attempts,select:"reservation_id"},
          {state:"processing",claim_id:claimId,attempts:seen.attempts+1,updated_at:dt()},"return=representation");
        if(!second.ok || (await second.json()).length!==1)return unknown();
      }
    }catch{return unknown();}
    const finish=async (state:"accepted"|"rejected"|"unknown",providerId:string|null=null) => {
      try {
        const r=await db("PATCH",{...slot,claim_id:"eq."+claimId,state:"eq.processing",select:"reservation_id"},
          {state,provider_id:providerId,updated_at:dt()},"return=representation");
        return r.ok && (await r.json()).length===1;
      } catch{return false;}
    };
    let client:ReturnType<typeof createClient>|undefined;
    let submitting=false;
    try{
      client=createClient(conf.proxy);
      const api=(path:string,authorization:string,body:object) => fetcher(PROVIDER+path,{method:"POST",client,redirect:"error",
        signal:AbortSignal.timeout(8000),headers:{Authorization:authorization,"Content-Type":"application/json"},body:JSON.stringify(body)});
      const auth=await api("token","Basic "+Buffer.from(conf.account+":"+conf.key).toString("base64"),{});
      if(!auth.ok) throw Error("auth");
      const token=(await auth.json())?.token; if(typeof token!=="string" || !token)throw Error("auth");
      submitting=true;
      const result=await api("message","Bearer "+token,{account:conf.account,from:conf.from,messageType:"LMS",
        subject:SUBJECT,content:input.text,duplicateFlag:"N",targetCount:3,targets:input.recipients.map(to=>({to})),refKey:reservationId.replaceAll("-","")});
      const data=await result.json();
      if(result.ok && typeof data?.messageKey==="string" && data.messageKey.length>0 && data.messageKey.length<=128 && (data.code==null || String(data.code)==="1000")){
        // A confirmed provider receipt is final even if the DB acknowledgement
        // is lost: the already committed processing row still prevents replay.
        await finish("accepted",data.messageKey);
        return accepted(data.messageKey);
      }
      // Once submitted, an error for the group is not proof that every target
      // was rejected. Never retry a group against an unconfirmed receipt.
      await finish("unknown");return unknown();
    } catch {
      if(!submitting) return await finish("rejected")?rejected():unknown();
      await finish("unknown");return unknown();
    }finally{try{client?.close();}catch{/* no retry */}}
  }
}
if(typeof Deno!=="undefined")Deno.serve(makeHandler());
