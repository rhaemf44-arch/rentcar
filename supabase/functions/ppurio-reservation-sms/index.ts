import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { Buffer } from "node:buffer";

const origin = "https://rhaemf44-arch.github.io";
const project = "ky-rent-system";
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
const reply = (status: number, message: string, extra = {}) => Response.json({ message, ...(status>=400?{outcome:"failed"}:{}), ...extra }, { status, headers });
const env = (key: string) => Deno.env.get(key)?.trim() || "";
const digits = (value: string) => value.replace(/[\s()-]/g, "").replace(/^\+820?/, "0");

// Both credential exchange and submission must leave from the registered IPs.
function createPpurioClient(value: string) {
  const url = new URL(value);
  return Deno.createHttpClient({proxy:{
    url: url.origin,
    basicAuth:{username:decodeURIComponent(url.username),password:decodeURIComponent(url.password)}
  }});
}
async function ppurio(path: string, authorization: string, payload: object, client: Deno.HttpClient) {
  const response = await fetch("https://message.ppurio.com/v1/" + path, {
    client, method:"POST", redirect:"error", signal:AbortSignal.timeout(12000),
    headers:{Authorization:authorization,"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  return {status:response.status, data:await response.json()};
}
async function database(path: string, method: string, body?: object, count=false) {
  const secret = env("SUPABASE_SERVICE_ROLE_KEY");
  return fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
    method, headers: { apikey: secret, Authorization: "Bearer " + secret, "Content-Type": "application/json", ...(count?{Prefer:"count=exact"}:{}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(6000)
  });
}
function ledger(query: string, method: string, body?: object, count=false) {
  return database("ppurio_requests" + query, method, body, count);
}
function exactCount(response: Response) {
  const match=response.headers.get("content-range")?.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}
async function acceptedCount(reservationId: string) {
  try {
    const filter=new URLSearchParams({reservation_id:"eq."+reservationId,state:"eq.accepted",select:"id",limit:"1"});
    const response=await ledger("?"+filter,"HEAD",undefined,true);
    return response.ok ? exactCount(response) : null;
  } catch {return null;}
}
async function staffDevice(uid: string) {
  if (env("PPURIO_STAFF_UIDS").split(",").map(s=>s.trim()).includes(uid)) return true;
  const query = new URLSearchParams({uid:"eq."+uid,select:"uid",limit:"1"});
  const result = await database("ppurio_staff_devices?"+query, "GET");
  if (!result.ok) throw new Error("membership lookup");
  return (await result.json()).some((row:{uid:string})=>row.uid===uid);
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, "POST 요청이 필요합니다.");
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  let uid: string;
  try {
    const {payload} = await jwtVerify(token, keys, { algorithms: ["RS256"], issuer: "https://securetoken.google.com/" + project, audience: project, requiredClaims:["sub","iat","exp"] });
    uid = payload.sub!;
  } catch { return reply(401, "예약관리 로그인 상태를 확인하고 다시 열어주세요."); }
  let input;
  try { input=await req.json(); } catch { return reply(400,"요청 내용을 확인하세요."); }
  if(!input || typeof input!=="object")return reply(400,"요청 내용을 확인하세요.");
  try {
    if (input.action==="join-team") {
      if(typeof input.invite!=="string" || !/^[a-f0-9]{64}$/.test(input.invite))return reply(400,"직원용 링크 전체를 열어주세요.");
      const hash = Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input.invite))).toString("hex");
      const response = await database("rpc/redeem_ppurio_staff_link","POST",{invite_hash:hash,device_uid:uid});
      if(!response.ok)throw new Error("join");
      if(await response.json()!==true)return reply(403,"사용 기간이 끝났거나 해제된 직원용 링크입니다. 새 링크를 요청하세요.");
      return reply(200,"이 브라우저에서 뿌리오 문자를 보낼 수 있습니다.");
    }
    if(!await staffDevice(uid))return reply(403,"직원용 예약관리 링크를 이 브라우저에서 한 번 열어주세요.");
  }catch{return reply(503,"직원 권한을 확인할 수 없습니다. 잠시 후 다시 시도하세요.");}
  if(input.action==="history"){
    const {reservationId,offset=0}=input;
    if(typeof reservationId!=="string" || !/^[^/\s]{1,128}$/.test(reservationId) || /^\.{1,2}$/.test(reservationId) || !Number.isSafeInteger(offset) || offset<0)return reply(400,"예약 정보를 확인하세요.");
    try{
      const reservation=await fetch("https://firestore.googleapis.com/v1/projects/"+project+"/databases/(default)/documents/reservations/"+encodeURIComponent(reservationId)+"?mask.fieldPaths=deletedAt",{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(6000)});
      if(!reservation.ok || (await reservation.json()).fields?.deletedAt?.stringValue)return reply(403,"이 예약의 발송내역을 열 수 없습니다.");
      const pageSize=25;
      const query=new URLSearchParams({reservation_id:"eq."+reservationId,state:"eq.accepted",select:"id,kind:notice_kind,phone:recipient,body:message_body,at:accepted_at",order:"accepted_at.desc,id.desc",limit:String(pageSize+1),offset:String(offset)});
      const result=await ledger("?"+query,"GET",undefined,true);
      if(!result.ok)throw new Error("history");
      const rows=await result.json();
      return reply(200,"문자 발송내역",{history:rows.slice(0,pageSize),total:exactCount(result),nextOffset:rows.length>pageSize?offset+pageSize:null});
    }catch{return reply(503,"발송내역을 불러오지 못했습니다. 다시 확인해 주세요.");}
  }
  const account=env("PPURIO_ACCOUNT"), key=env("PPURIO_API_KEY"), from=digits(env("PPURIO_FROM")), proxyUrl=env("FIXIE_URL");
  if (!account || !key || !/^0\d{7,10}$/.test(from) || !/^https?:\/\//.test(proxyUrl)) return reply(503,"뿌리오 계정·발신번호·고정 IP 연결 설정이 필요합니다.");
  try {
    const {action,reservationId,kind,phone,body} = input;
    const authorization="Basic "+Buffer.from(account+":"+key).toString("base64");
    if(action==="check"){
      const proxy=createPpurioClient(proxyUrl);
      try{
        const check=await ppurio("token",authorization,{},proxy);
        if(check.status===200 && check.data.token)return reply(200,"뿌리오 연결을 확인했습니다. 문자 발송을 사용할 수 있습니다.");
        const code=String(check.data.code||check.status).replace(/[^0-9]/g,"").slice(0,8);
        return reply(502,"인증에 실패했습니다. 뿌리오 연동 IP와 API 인증키를 확인하세요. ("+code+")");
      }catch{return reply(502,"고정 IP 경유 연결을 확인할 수 없습니다.");}
      finally{proxy.close();}
    }
    if (typeof reservationId!=="string" || !/^[^/\s]{1,128}$/.test(reservationId) || !["confirmation","reminder"].includes(kind) || typeof phone!=="string" || !/^01[016789]\d{7,8}$/.test(phone) || typeof body!=="string" || !body.trim() || body.length>2000) return reply(400,"예약, 수신번호 또는 내용을 확인하세요.");
    const doc = await fetch("https://firestore.googleapis.com/v1/projects/"+project+"/databases/(default)/documents/reservations/"+encodeURIComponent(reservationId),{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(6000)});
    if(!doc.ok) return reply(409,"서버에서 예약을 확인할 수 없습니다.");
    const {fields:f}=await doc.json();
    const start=f?.start?.stringValue || "";
    const when=Date.parse(/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?$/.test(start)?start+"+09:00":start);
    if(!f || f.deletedAt?.stringValue || ["cancelled","done","active"].includes(f.status?.stringValue) || !(when>Date.now()) || digits(f.phone?.stringValue||"")!==phone) return reply(409,"예약 상태와 저장된 고객 휴대폰 번호를 확인하세요.");
    // One confirmed click is one attempt. Older tabs retain their existing replay key.
    const attempt=input.attemptId;
    if(attempt!==undefined && (typeof attempt!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt)))return reply(400,"발송 요청 번호가 올바르지 않습니다.");
    const identity=attempt===undefined?[reservationId,kind,phone,body]:["sms-attempt",reservationId,uid,attempt];
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(identity)));
    const id=Buffer.from(digest).toString("hex");
    const query="?id=eq."+id;
    const claim=await ledger("","POST",{id,state:"processing",reservation_id:reservationId,notice_kind:kind,recipient:phone,message_body:body});
    if(claim.status===409){
      const existing=await ledger(query+"&select=state,accepted_at,notice_kind,recipient,message_body","GET");
      const rows=existing.ok?await existing.json():[];
      const prior=rows[0];
      if(attempt && prior && (prior.notice_kind!==kind || prior.recipient!==phone || prior.message_body!==body))return reply(409,"발송 요청 번호가 다른 문자에 사용됐습니다.");
      return prior?.state==="accepted"?reply(200,"문자 발송 성공",{accepted:true,duplicate:true,id,at:prior.accepted_at||null,total:await acceptedCount(reservationId)}):reply(409,"처리 중인 요청입니다. 발송내역에서 결과를 확인해 주세요.",{outcome:"unknown"});
    }
    if(!claim.ok) return reply(503,"발송 기록을 준비하지 못했습니다.");
    let submitted=false;
    let proxy: Deno.HttpClient | undefined;
    try {
      proxy=createPpurioClient(proxyUrl);
      const auth=await ppurio("token",authorization,{},proxy);
      if(auth.status!==200 || !auth.data.token) throw new Error("token");
      // Korean characters occupy two bytes in domestic SMS; use LMS if in doubt.
      const bytes=Array.from(body).reduce((n,c)=>n+(c.charCodeAt(0)>127?2:1),0);
      if(bytes>2000){await ledger(query,"DELETE");return reply(400,"장문 문자 길이를 초과했습니다. 내용을 줄여 주세요.");}
      submitted=true;
      const result=await ppurio("message","Bearer "+auth.data.token,{account,from,messageType:bytes>90?"LMS":"SMS",content:body,duplicateFlag:"N",targetCount:1,targets:[{to:phone}],refKey:id.slice(0,32)},proxy);
      if(result.status>=200 && result.status<300 && result.data.messageKey && (!result.data.code || String(result.data.code)==="1000")){
        const at=new Date().toISOString();
        const patch={state:"accepted",provider_id:result.data.messageKey,accepted_at:at};
        // Retry only the database update. Provider acceptance is already final.
        let recorded=false;
        for(let attempt=0;attempt<2 && !recorded;attempt++){
          try{recorded=(await ledger(query,"PATCH",patch)).ok;}catch{/* The client also retains the receipt if storage is unavailable. */}
        }
        return reply(200,recorded?"문자 발송 성공":"문자 발송 성공 · 서버 내역 저장 지연",{accepted:true,id,at,recorded,total:await acceptedCount(reservationId)});
      }
      if(result.status<500 && result.data.code && String(result.data.code)!=="1000" && !result.data.messageKey){
        await ledger(query,"DELETE");
        return reply(422,"뿌리오가 발송을 거절했습니다. 발신번호·잔액·발송 권한을 확인하세요. ("+String(result.data.code).replace(/[^\d]/g,"").slice(0,8)+")");
      }
      throw new Error("unknown");
    } catch {
      if(!submitted){await ledger(query,"DELETE");return reply(502,"뿌리오 인증에 실패했습니다. 등록 IP와 인증키를 확인하세요.");}
      return reply(502,"접수 여부를 확인할 수 없습니다. 뿌리오 발송결과를 먼저 확인하세요.",{outcome:"unknown"});
    } finally { proxy?.close(); }
  } catch { return reply(503,"발송 처리 상태를 확인할 수 없습니다. 뿌리오 발송결과를 확인하세요.",{outcome:"unknown"}); }
});
