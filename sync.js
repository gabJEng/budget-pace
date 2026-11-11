(() => {
"use strict";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const CLOUD_FILENAME = "budget-data.json";
const CONFIG_KEY = "budgetPaceCloudConfigV1";
const META_KEY = "budgetPaceSyncMetaV1";
const AUTH_KEY = "budgetPaceAuthSessionV1";
const PKCE_KEY = "budgetPacePkceV1";

function deepClone(value){
  return JSON.parse(JSON.stringify(value));
}

function nowIso(){
  return new Date().toISOString();
}

function randomId(){
  if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes=new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
}

function loadJson(storage,key,fallback){
  try{
    const raw=storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch{
    return fallback;
  }
}

function saveJson(storage,key,value){
  storage.setItem(key,JSON.stringify(value));
}

function base64Url(bytes){
  let binary="";
  bytes.forEach(b=>binary+=String.fromCharCode(b));
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

async function sha256Base64Url(text){
  const bytes=new TextEncoder().encode(text);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return base64Url(new Uint8Array(digest));
}

function decodeJwtPayload(token){
  try{
    const part=token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    const padded=part+"=".repeat((4-part.length%4)%4);
    return JSON.parse(decodeURIComponent(
      atob(padded).split("").map(c=>"%"+c.charCodeAt(0).toString(16).padStart(2,"0")).join("")
    ));
  }catch{
    return {};
  }
}

function canonicalCategoryName(name){
  return String(name||"").trim().toLowerCase();
}

function hasMeaningfulData(data){
  return Boolean(
    (data?.transactions?.length||0) ||
    Object.keys(data?.budgets||{}).length ||
    Object.keys(data?.plannedIncome||{}).length ||
    Object.keys(data?.closedMonths||{}).length
  );
}

function mergeByKey(primary,secondary,keyFn){
  const out=[];
  const seen=new Set();
  for(const item of [...(primary||[]),...(secondary||[])]){
    const key=keyFn(item);
    if(!key || seen.has(key)) continue;
    seen.add(key);
    out.push(deepClone(item));
  }
  return out;
}

function mergeBudgetData(localData,cloudData,preferLocal){
  const primary=preferLocal ? localData : cloudData;
  const secondary=preferLocal ? cloudData : localData;
  const merged=deepClone(primary||{});

  merged.categories=mergeByKey(
    primary?.categories,
    secondary?.categories,
    c=>canonicalCategoryName(c?.name)
  );

  merged.rules=mergeByKey(
    primary?.rules,
    secondary?.rules,
    r=>`${String(r?.pattern||"").trim().toLowerCase()}|${String(r?.type||"expense").toLowerCase()}`
  );

  const transactionKey=tx=>{
    const sourceAccount=String(tx?.source?.accountNumber||"").trim();
    return [
      String(tx?.date||""),
      String(tx?.description||"").trim().toUpperCase(),
      Number(tx?.amount||0).toFixed(2),
      String(tx?.type||""),
      sourceAccount
    ].join("|");
  };

  const txMap=new Map();
  for(const tx of (secondary?.transactions||[])){
    if(tx) txMap.set(transactionKey(tx),deepClone(tx));
  }
  for(const tx of (primary?.transactions||[])){
    if(tx) txMap.set(transactionKey(tx),deepClone(tx));
  }
  merged.transactions=[...txMap.values()];

  merged.budgets={...(secondary?.budgets||{}),...(primary?.budgets||{})};
  for(const month of Object.keys(secondary?.budgets||{})){
    merged.budgets[month]={
      ...(secondary.budgets[month]||{}),
      ...(primary?.budgets?.[month]||{})
    };
  }

  merged.plannedIncome={
    ...(secondary?.plannedIncome||{}),
    ...(primary?.plannedIncome||{})
  };
  merged.closedMonths={
    ...(secondary?.closedMonths||{}),
    ...(primary?.closedMonths||{})
  };
  merged.settings={
    ...(secondary?.settings||{}),
    ...(primary?.settings||{}),
    storageProvider:"onedrive+local"
  };

  return merged;
}

class BudgetPaceCloudSync {
  constructor(options){
    this.getData=options.getData;
    this.setData=options.setData;
    this.getAppVersion=options.getAppVersion || (()=>"1.0");
    this.config=loadJson(localStorage,CONFIG_KEY,{
      clientId:"",
      accountKind:"personal-appfolder"
    });
    this.migrateLegacySecurityMode();
    this.meta=loadJson(localStorage,META_KEY,{
      deviceId:randomId(),
      dirty:false,
      lastCloudRevision:0,
      cloudETag:null,
      cloudFileId:null,
      lastSyncedAt:null,
      lastLocalChangeAt:null
    });
    if(!this.meta.deviceId) this.meta.deviceId=randomId();
    this.auth=loadJson(sessionStorage,AUTH_KEY,null);
    this.syncTimer=null;
    this.syncInProgress=false;
    this.lastStatus="local";
    this.lastStatusDetail="";
    this.bindUi();
    this.renderStatus();
  }

  migrateLegacySecurityMode(){
    const original=this.config.accountKind;
    if(original==="personal"){
      this.config.accountKind="personal-appfolder";
      this.saveConfig();
      this.securityModeMigratedFrom="personal";
    }else if(original==="work"){
      this.config.accountKind="work-appfolder";
      this.auth=null;
      sessionStorage.removeItem(AUTH_KEY);
      this.saveConfig();
      this.securityModeMigratedFrom="work";
    }
  }

  isPersonalMode(){
    return this.config.accountKind==="personal-appfolder";
  }

  isBroadMode(){
    return this.config.accountKind==="work-broad";
  }

  permissionScope(){
    return this.isBroadMode()
      ? "https://graph.microsoft.com/Files.ReadWrite"
      : "https://graph.microsoft.com/Files.ReadWrite.AppFolder";
  }

  permissionDisplay(){
    if(this.config.accountKind==="personal-appfolder") return "Access: App Folder only";
    if(this.config.accountKind==="work-appfolder") return "Access requested: App Folder only";
    return "Access: Files.ReadWrite (broader)";
  }

  get redirectUri(){
    return `${location.origin}${location.pathname}`;
  }

  scopes(){
    return ["openid","profile","offline_access",this.permissionScope()];
  }

  authorityBase(){
    return this.isPersonalMode()
      ? "https://login.microsoftonline.com/consumers/oauth2/v2.0"
      : "https://login.microsoftonline.com/organizations/oauth2/v2.0";
  }

  saveMeta(){
    saveJson(localStorage,META_KEY,this.meta);
  }

  saveConfig(){
    saveJson(localStorage,CONFIG_KEY,this.config);
  }

  saveAuth(){
    if(this.auth) saveJson(sessionStorage,AUTH_KEY,this.auth);
    else sessionStorage.removeItem(AUTH_KEY);
  }

  isConfigured(){
    return /^[0-9a-fA-F-]{30,40}$/.test(String(this.config.clientId||"").trim());
  }

  isSignedIn(){
    return Boolean(this.auth?.refreshToken || this.auth?.accessToken);
  }

  accountLabel(){
    return this.auth?.claims?.preferred_username ||
           this.auth?.claims?.email ||
           this.auth?.claims?.name ||
           "";
  }

  bindUi(){
    const $=id=>document.getElementById(id);

    $("cloudConfigureBtn")?.addEventListener("click",()=>{
      $("cloudClientId").value=this.config.clientId||"";
      $("cloudAccountKind").value=this.config.accountKind||"personal-appfolder";
      this.renderPermissionChoice();
      $("cloudRedirectUri").value=this.redirectUri;
      $("cloudConfigDialog").showModal();
    });

    $("cloudAccountKind")?.addEventListener("change",()=>this.renderPermissionChoice());

    $("cloudConfigForm")?.addEventListener("submit",e=>{
      e.preventDefault();
      const previousClient=this.config.clientId;
      const previousMode=this.config.accountKind;
      const nextMode=$("cloudAccountKind").value;

      if(nextMode==="work-broad" && !$("broadPermissionAcknowledge")?.checked){
        alert("Broad work/school mode requires explicit acknowledgement because Files.ReadWrite can access files outside the Budget Pace app folder.");
        return;
      }

      this.config.clientId=$("cloudClientId").value.trim();
      this.config.accountKind=nextMode;
      this.saveConfig();

      if((previousClient && previousClient!==this.config.clientId) || previousMode!==nextMode){
        this.auth=null;
        this.saveAuth();
        this.meta.lastCloudRevision=0;
        this.meta.cloudETag=null;
        this.meta.cloudFileId=null;
        this.saveMeta();
      }

      $("cloudConfigDialog").close();
      this.setStatus(this.isConfigured() ? "ready" : "setup");
    });

    $("cloudSignInBtn")?.addEventListener("click",()=>this.signIn());
    $("cloudSyncBtn")?.addEventListener("click",()=>this.sync({manual:true}));
    $("cloudSignOutBtn")?.addEventListener("click",()=>{
      this.auth=null;
      this.saveAuth();
      this.setStatus("signedout","Local data remains available.");
    });

    window.addEventListener("online",()=>{
      this.setStatus(this.meta.dirty ? "unsynced" : "ready");
      if(this.isSignedIn()) this.sync();
    });
    window.addEventListener("offline",()=>this.setStatus("offline","Using local cache."));
  }

  renderPermissionChoice(){
    const $=id=>document.getElementById(id);
    const mode=$("cloudAccountKind")?.value || this.config.accountKind;
    const wrap=$("broadPermissionAcknowledgeWrap");
    const ack=$("broadPermissionAcknowledge");
    if(wrap) wrap.classList.toggle("hidden",mode!=="work-broad");
    if(ack && mode!=="work-broad") ack.checked=false;
  }

  async initialize(){
    try{
      await this.handleAuthorizationCallback();
    }catch(err){
      console.error(err);
      this.setStatus("error",err.message||"Microsoft sign-in failed.");
      return;
    }

    if(!navigator.onLine){
      this.setStatus("offline","Using local cache.");
      return;
    }

    if(!this.isConfigured()){
      this.setStatus("setup","Enter the Microsoft application/client ID.");
      return;
    }

    if(!this.isSignedIn()){
      if(this.securityModeMigratedFrom==="work"){
        this.setStatus("ready","Security upgrade applied: sign in again to request App Folder-only access.");
      }else{
        this.setStatus("ready","Configured; sign in to enable OneDrive sync.");
      }
      return;
    }

    await this.sync();
  }

  notifyLocalChange(){
    this.meta.dirty=true;
    this.meta.lastLocalChangeAt=nowIso();
    this.saveMeta();
    this.setStatus(navigator.onLine ? "unsynced" : "offline",
      navigator.onLine ? "Local changes waiting to sync." : "Saved locally; will sync when online."
    );

    clearTimeout(this.syncTimer);
    if(this.isSignedIn() && navigator.onLine){
      this.syncTimer=setTimeout(()=>this.sync(),1400);
    }
  }

  setStatus(status,detail=""){
    this.lastStatus=status;
    this.lastStatusDetail=detail;
    this.renderStatus();
  }

  renderStatus(){
    const statusEl=document.getElementById("cloudSyncStatus");
    const detailEl=document.getElementById("cloudSyncDetail");
    const accountEl=document.getElementById("cloudAccountLabel");
    const permissionEl=document.getElementById("cloudPermissionLabel");
    const signIn=document.getElementById("cloudSignInBtn");
    const signOut=document.getElementById("cloudSignOutBtn");
    const syncBtn=document.getElementById("cloudSyncBtn");

    const labels={
      setup:"Setup required",
      ready:"Ready",
      local:"Local only",
      signedout:"Signed out",
      syncing:"Syncing…",
      synced:"Synced",
      unsynced:"Unsynced changes",
      offline:"Offline",
      conflict:"Conflict merged",
      error:"Sync error"
    };

    if(statusEl){
      statusEl.textContent=labels[this.lastStatus]||this.lastStatus;
      statusEl.dataset.state=this.lastStatus;
    }

    const last=this.meta.lastSyncedAt
      ? `Last synced ${new Date(this.meta.lastSyncedAt).toLocaleString()}`
      : "Not synced yet";
    if(detailEl){
      detailEl.textContent=this.lastStatusDetail
        ? `${this.lastStatusDetail} ${last}`
        : last;
    }
    if(accountEl){
      accountEl.textContent=this.accountLabel()
        ? `Microsoft account: ${this.accountLabel()}`
        : "";
    }
    if(permissionEl){
      permissionEl.textContent=this.permissionDisplay();
      permissionEl.dataset.scope=this.isBroadMode() ? "broad" : "appfolder";
    }
    if(signIn) signIn.classList.toggle("hidden",this.isSignedIn());
    if(signOut) signOut.classList.toggle("hidden",!this.isSignedIn());
    if(syncBtn) syncBtn.disabled=!this.isSignedIn() || !navigator.onLine || this.syncInProgress;
  }

  async signIn(){
    if(!this.isConfigured()){
      this.setStatus("setup","Configure the Microsoft application/client ID first.");
      document.getElementById("cloudConfigureBtn")?.click();
      return;
    }

    if(location.protocol!=="https:" && location.hostname!=="localhost"){
      alert(
        "For Microsoft SPA sign-in during local testing, open Budget Pace as http://localhost:8001/ " +
        "rather than an http://127.0.0.1 address. HTTPS is required for non-localhost deployments."
      );
      return;
    }

    const verifier=base64Url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge=await sha256Base64Url(verifier);
    const state=randomId();
    const pkce={
      verifier,
      state,
      redirectUri:this.redirectUri,
      createdAt:Date.now()
    };
    saveJson(sessionStorage,PKCE_KEY,pkce);

    const params=new URLSearchParams({
      client_id:this.config.clientId,
      response_type:"code",
      redirect_uri:this.redirectUri,
      response_mode:"query",
      scope:this.scopes().join(" "),
      state,
      code_challenge:challenge,
      code_challenge_method:"S256",
      prompt:"select_account"
    });

    location.assign(`${this.authorityBase()}/authorize?${params.toString()}`);
  }

  async handleAuthorizationCallback(){
    const params=new URLSearchParams(location.search);
    const error=params.get("error");
    const code=params.get("code");
    if(!error && !code) return;

    if(error){
      const desc=params.get("error_description")||error;
      this.cleanAuthQuery();
      throw new Error(desc);
    }

    const pkce=loadJson(sessionStorage,PKCE_KEY,null);
    if(!pkce || !pkce.verifier || params.get("state")!==pkce.state){
      this.cleanAuthQuery();
      throw new Error("Microsoft sign-in state verification failed. Please sign in again.");
    }

    const body=new URLSearchParams({
      client_id:this.config.clientId,
      grant_type:"authorization_code",
      code,
      redirect_uri:pkce.redirectUri,
      code_verifier:pkce.verifier,
      scope:this.scopes().join(" ")
    });

    const response=await fetch(`${this.authorityBase()}/token`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body
    });

    const token=await response.json();
    if(!response.ok){
      this.cleanAuthQuery();
      throw new Error(token.error_description||token.error||"Token exchange failed.");
    }

    this.auth=this.tokenResponseToSession(token);
    this.saveAuth();
    sessionStorage.removeItem(PKCE_KEY);
    this.cleanAuthQuery();
    this.setStatus("ready","Microsoft sign-in complete.");
  }

  cleanAuthQuery(){
    const clean=`${location.origin}${location.pathname}${location.hash||""}`;
    history.replaceState({},document.title,clean);
  }

  tokenResponseToSession(token,oldRefresh=null){
    return {
      accessToken:token.access_token,
      refreshToken:token.refresh_token||oldRefresh||null,
      expiresAt:Date.now()+(Number(token.expires_in||3600)*1000),
      idToken:token.id_token||this.auth?.idToken||null,
      claims:token.id_token ? decodeJwtPayload(token.id_token) : (this.auth?.claims||{})
    };
  }

  async refreshAccessToken(){
    if(!this.auth?.refreshToken) throw new Error("Microsoft sign-in is required.");

    const body=new URLSearchParams({
      client_id:this.config.clientId,
      grant_type:"refresh_token",
      refresh_token:this.auth.refreshToken,
      scope:this.scopes().join(" ")
    });

    const response=await fetch(`${this.authorityBase()}/token`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body
    });

    const token=await response.json();
    if(!response.ok){
      this.auth=null;
      this.saveAuth();
      throw new Error("Microsoft session expired. Sign in again.");
    }

    this.auth=this.tokenResponseToSession(token,this.auth.refreshToken);
    this.saveAuth();
    return this.auth.accessToken;
  }

  async accessToken(forceRefresh=false){
    if(!this.auth) throw new Error("Microsoft sign-in is required.");
    if(!forceRefresh && this.auth.accessToken && Date.now()<Number(this.auth.expiresAt||0)-120000){
      return this.auth.accessToken;
    }
    return this.refreshAccessToken();
  }

  async graph(url,options={},retry=true){
    const token=await this.accessToken();
    const headers=new Headers(options.headers||{});
    headers.set("Authorization",`Bearer ${token}`);
    const response=await fetch(url,{...options,headers});

    if(response.status===401 && retry){
      await this.accessToken(true);
      return this.graph(url,options,false);
    }
    return response;
  }

  async ensureAppRoot(){
    const response=await this.graph(`${GRAPH_ROOT}/me/drive/special/approot`);
    if(!response.ok){
      const text=await response.text();
      if(this.config.accountKind==="work-appfolder" && (response.status===401 || response.status===403)){
        throw new Error(
          "Work/school App Folder-only access was rejected by Microsoft for this account/tenant. " +
          "Microsoft documentation is currently inconsistent on delegated work-account support. " +
          "Keep your local data, then either use a personal OneDrive App Folder or explicitly choose the broader work/school Files.ReadWrite fallback."
        );
      }
      throw new Error(`OneDrive App Folder access failed (${response.status}). ${text.slice(0,180)}`);
    }
    return response.json();
  }

  async readCloud(){
    await this.ensureAppRoot();
    const metaResponse=await this.graph(
      `${GRAPH_ROOT}/me/drive/special/approot:/${encodeURIComponent(CLOUD_FILENAME)}`
    );

    if(metaResponse.status===404) return null;
    if(!metaResponse.ok){
      const text=await metaResponse.text();
      throw new Error(`Could not read OneDrive metadata (${metaResponse.status}). ${text.slice(0,180)}`);
    }

    const item=await metaResponse.json();
    const downloadUrl=item["@microsoft.graph.downloadUrl"];
    if(!downloadUrl){
      throw new Error("OneDrive did not provide a download URL for the budget data file.");
    }

    const fileResponse=await fetch(downloadUrl,{cache:"no-store"});
    if(!fileResponse.ok){
      throw new Error(`Could not download OneDrive data (${fileResponse.status}).`);
    }

    const text=await fileResponse.text();
    let payload;
    try{
      payload=JSON.parse(text);
    }catch{
      throw new Error("The OneDrive budget-data.json file is not valid JSON.");
    }

    if(payload?.data && typeof payload.revision==="number"){
      return {item,payload};
    }

    // Legacy/raw Budget Pace JSON support.
    if(payload?.transactions && payload?.categories){
      return {
        item,
        payload:{
          schemaVersion:1,
          revision:1,
          lastModifiedAt:item.lastModifiedDateTime||nowIso(),
          modifiedByDevice:"legacy",
          appVersion:"legacy",
          data:payload
        }
      };
    }

    throw new Error("The OneDrive data file is not recognized as Budget Pace data.");
  }

  makePayload(data,revision){
    return {
      schemaVersion:1,
      revision,
      lastModifiedAt:nowIso(),
      modifiedByDevice:this.meta.deviceId,
      appVersion:String(this.getAppVersion()),
      data:deepClone(data)
    };
  }

  async uploadCloud(payload,currentItem=null){
    let url;
    const headers={"Content-Type":"application/json; charset=utf-8"};

    if(currentItem?.id){
      url=`${GRAPH_ROOT}/me/drive/items/${encodeURIComponent(currentItem.id)}/content`;
      if(currentItem.eTag) headers["If-Match"]=currentItem.eTag;
    }else{
      await this.ensureAppRoot();
      url=`${GRAPH_ROOT}/me/drive/special/approot:/${encodeURIComponent(CLOUD_FILENAME)}:/content`;
    }

    const response=await this.graph(url,{
      method:"PUT",
      headers,
      body:JSON.stringify(payload,null,2)
    });

    if(response.status===412){
      const err=new Error("OneDrive changed while this device was saving.");
      err.code="PRECONDITION";
      throw err;
    }

    if(!response.ok){
      const text=await response.text();
      throw new Error(`Could not save to OneDrive (${response.status}). ${text.slice(0,180)}`);
    }

    return response.json();
  }

  commitRemoteToLocal(remoteData,remoteItem,remoteRevision){
    this.setData(deepClone(remoteData));
    this.meta.dirty=false;
    this.meta.lastCloudRevision=Number(remoteRevision||0);
    this.meta.cloudETag=remoteItem?.eTag||null;
    this.meta.cloudFileId=remoteItem?.id||null;
    this.meta.lastSyncedAt=nowIso();
    this.meta.lastLocalChangeAt=null;
    this.saveMeta();
  }

  markSynced(item,revision){
    this.meta.dirty=false;
    this.meta.lastCloudRevision=Number(revision||0);
    this.meta.cloudETag=item?.eTag||null;
    this.meta.cloudFileId=item?.id||null;
    this.meta.lastSyncedAt=nowIso();
    this.meta.lastLocalChangeAt=null;
    this.saveMeta();
  }

  async sync(options={}){
    if(this.syncInProgress) return;
    if(!navigator.onLine){
      this.setStatus("offline","Using local cache.");
      return;
    }
    if(!this.isConfigured()){
      this.setStatus("setup","Enter the Microsoft application/client ID.");
      return;
    }
    if(!this.isSignedIn()){
      this.setStatus("ready","Sign in to enable OneDrive sync.");
      return;
    }

    this.syncInProgress=true;
    this.setStatus("syncing",options.manual ? "Manual sync requested." : "");

    try{
      let cloud=await this.readCloud();
      const local=this.getData();
      const localMeaningful=hasMeaningfulData(local);

      if(!cloud){
        const revision=Math.max(0,Number(this.meta.lastCloudRevision||0))+1;
        const payload=this.makePayload(local,revision);
        const item=await this.uploadCloud(payload,null);
        this.markSynced(item,revision);
        this.setStatus("synced","Created the authoritative OneDrive copy.");
        return;
      }

      const remote=cloud.payload;
      const remoteRevision=Number(remote.revision||0);
      const remoteMeaningful=hasMeaningfulData(remote.data);

      // First connection from this browser/device.
      if(Number(this.meta.lastCloudRevision||0)===0){
        if(localMeaningful && remoteMeaningful){
          const preferLocal=Date.parse(this.meta.lastLocalChangeAt||0) >
                            Date.parse(remote.lastModifiedAt||0);
          const merged=mergeBudgetData(local,remote.data,preferLocal);
          const payload=this.makePayload(merged,remoteRevision+1);
          const item=await this.uploadCloud(payload,cloud.item);
          this.setData(deepClone(merged));
          this.markSynced(item,remoteRevision+1);
          this.setStatus("conflict","First sync merged local and OneDrive data.");
          return;
        }

        if(remoteMeaningful && !localMeaningful){
          this.commitRemoteToLocal(remote.data,cloud.item,remoteRevision);
          this.setStatus("synced","Loaded the authoritative OneDrive copy.");
          return;
        }

        const payload=this.makePayload(local,remoteRevision+1);
        const item=await this.uploadCloud(payload,cloud.item);
        this.markSynced(item,remoteRevision+1);
        this.setStatus("synced","Uploaded this device's data to OneDrive.");
        return;
      }

      if(!this.meta.dirty){
        if(remoteRevision>Number(this.meta.lastCloudRevision||0)){
          this.commitRemoteToLocal(remote.data,cloud.item,remoteRevision);
          this.setStatus("synced","Downloaded newer OneDrive data.");
        }else{
          this.markSynced(cloud.item,remoteRevision);
          this.setStatus("synced","OneDrive and local cache are current.");
        }
        return;
      }

      if(remoteRevision<=Number(this.meta.lastCloudRevision||0)){
        const payload=this.makePayload(local,remoteRevision+1);
        const item=await this.uploadCloud(payload,cloud.item);
        this.markSynced(item,remoteRevision+1);
        this.setStatus("synced","Local changes saved to OneDrive.");
        return;
      }

      // Both local and cloud changed since last sync.
      const preferLocal=Date.parse(this.meta.lastLocalChangeAt||0) >
                        Date.parse(remote.lastModifiedAt||0);
      const merged=mergeBudgetData(local,remote.data,preferLocal);
      const payload=this.makePayload(merged,remoteRevision+1);
      const item=await this.uploadCloud(payload,cloud.item);
      this.setData(deepClone(merged));
      this.markSynced(item,remoteRevision+1);
      this.setStatus("conflict","Changes from both devices were merged.");
    }catch(err){
      console.error("Budget Pace sync error:",err);
      if(err.code==="PRECONDITION"){
        this.setStatus("unsynced","OneDrive changed during save; press Sync now to merge.");
      }else{
        this.setStatus("error",err.message||"OneDrive synchronization failed.");
      }
    }finally{
      this.syncInProgress=false;
      this.renderStatus();
    }
  }
}

globalThis.BudgetPaceCloudSync=BudgetPaceCloudSync;
})();