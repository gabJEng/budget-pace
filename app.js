
const APP_VERSION = 10;

const DEFAULT_CATEGORIES = [
  {name:"Groceries", pace:true, defaultBudget:0},
  {name:"Gasoline", pace:true, defaultBudget:0},
  {name:"Restaurants", pace:false, defaultBudget:0},
  {name:"Utilities", pace:false, defaultBudget:0},
  {name:"Housing", pace:false, defaultBudget:0},
  {name:"Transportation", pace:false, defaultBudget:0},
  {name:"Entertainment", pace:false, defaultBudget:0},
  {name:"Health", pace:false, defaultBudget:0},
  {name:"Incidentals", pace:true, defaultBudget:0}
];

const DEFAULT_RULES = [
  {pattern:"SUPERSTORE", category:"Groceries"},
  {pattern:"SAFEWAY", category:"Groceries"},
  {pattern:"COSTCO", category:"Groceries"},
  {pattern:"SHELL", category:"Gasoline"},
  {pattern:"ESSO", category:"Gasoline"},
  {pattern:"PETRO", category:"Gasoline"},
  {pattern:"CC PAYMENT", category:"CC Payment", type:"transfer"},
  {pattern:"CREDIT CARD PAYMENT", category:"CC Payment", type:"transfer"},
  {pattern:"VISA PAYMENT", category:"CC Payment", type:"transfer"},
  {pattern:"MASTERCARD PAYMENT", category:"CC Payment", type:"transfer"}
];

class LocalStorageStore {
  constructor(key="budgetPaceDataV1"){ this.key=key; }
  load(){
    try { return JSON.parse(localStorage.getItem(this.key)) || null; }
    catch { return null; }
  }
  save(data){ localStorage.setItem(this.key, JSON.stringify(data)); }
}

// Future OneDrive implementation can satisfy the same load()/save() contract.
const store = new LocalStorageStore();

function initialData(){
  return {
    version: APP_VERSION,
    categories: DEFAULT_CATEGORIES,
    budgets: {},
    plannedIncome: {},
    transactions: [],
    rules: DEFAULT_RULES,
    closedMonths: {},
    settings: { storageProvider: "local" }
  };
}

let data = store.load() || initialData();
let deferredInstallPrompt = null;
let transactionSort = { key: "date", direction: "desc" };
let transactionFilters = { search: "", category: "", type: "" };
let cloudSync = null;

const $ = id => document.getElementById(id);
const money = v => new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format(Number(v||0));
const round2 = v => Math.round((Number(v)||0)*100)/100;
const monthKeyFromDate = d => String(d).slice(0,7);
const todayISO = () => new Date().toISOString().slice(0,10);

function normalizeLabel(value){
  return String(value||"").trim().toUpperCase();
}

function isCreditCardPaymentCategory(value){
  const v=normalizeLabel(value).replace(/[._-]+/g," ").replace(/\s+/g," ");
  return v==="CC PAYMENT" || v==="CREDIT CARD PAYMENT" || v==="CREDIT CARD PAYMENTS";
}

function isCreditCardPaymentDescription(description){
  const d=normalizeLabel(description);
  return /\bCC PAYMENT\b/.test(d) ||
         /\bCREDIT CARD PAYMENT\b/.test(d) ||
         /\bVISA PAYMENT\b/.test(d) ||
         /\bMASTERCARD PAYMENT\b/.test(d) ||
         /\bMASTER CARD PAYMENT\b/.test(d) ||
         /\bPAYMENT TO VISA\b/.test(d) ||
         /\bPAYMENT TO MASTERCARD\b/.test(d);
}

function migrateCreditCardPayments(){
  let changed=false;

  for(const tx of data.transactions||[]){
    if(isCreditCardPaymentCategory(tx.category) || isCreditCardPaymentDescription(tx.description)){
      if(tx.type!=="transfer" || tx.category!=="CC Payment"){
        tx.type="transfer";
        tx.category="CC Payment";
        changed=true;
      }
    }
  }

  const ccBudgetNames=(data.categories||[])
    .filter(c=>isCreditCardPaymentCategory(c.name))
    .map(c=>c.name);

  if(ccBudgetNames.length){
    data.categories=data.categories.filter(c=>!isCreditCardPaymentCategory(c.name));
    for(const mk of Object.keys(data.budgets||{})){
      for(const name of ccBudgetNames){
        if(Object.prototype.hasOwnProperty.call(data.budgets[mk],name)){
          delete data.budgets[mk][name];
          changed=true;
        }
      }
    }
  }

  for(const rule of data.rules||[]){
    if(isCreditCardPaymentCategory(rule.category) || isCreditCardPaymentDescription(rule.pattern)){
      if(rule.type!=="transfer" || rule.category!=="CC Payment"){
        rule.type="transfer";
        rule.category="CC Payment";
        changed=true;
      }
    }
  }

  const transferPatterns=["CC PAYMENT","CREDIT CARD PAYMENT","VISA PAYMENT","MASTERCARD PAYMENT"];
  for(const pattern of transferPatterns){
    const exists=(data.rules||[]).some(r=>normalizeLabel(r.pattern)===pattern);
    if(!exists){
      data.rules.push({pattern,category:"CC Payment",type:"transfer"});
      changed=true;
    }
  }

  data.version=APP_VERSION;
  if(changed) store.save(data);
  return changed;
}

function currentMonthKey(){
  return $("monthPicker").value || todayISO().slice(0,7);
}

function shiftMonthKey(monthKey,offset){
  const [y,m]=monthKey.split("-").map(Number);
  const d=new Date(y,m-1+offset,1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

function selectMonth(monthKey){
  $("monthPicker").value=monthKey;
  render();
}
function daysInMonth(monthKey){
  const [y,m] = monthKey.split("-").map(Number);
  return new Date(y,m,0).getDate();
}
function elapsedDays(monthKey){
  const now = new Date();
  const [y,m] = monthKey.split("-").map(Number);
  const thisKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  if(monthKey < thisKey) return daysInMonth(monthKey);
  if(monthKey > thisKey) return 0;
  return Math.min(now.getDate(), daysInMonth(monthKey));
}
function monthTransactions(monthKey, type=null){
  return data.transactions.filter(t => monthKeyFromDate(t.date)===monthKey && (!type || t.type===type));
}
function categoryBudget(monthKey, name){
  return Number((data.budgets[monthKey]||{})[name] || 0);
}
function monthBudget(monthKey){
  return data.categories.reduce((s,c)=>s+categoryBudget(monthKey,c.name),0);
}
function monthSpend(monthKey){
  return monthTransactions(monthKey,"expense").reduce((s,t)=>s+Number(t.amount),0);
}
function monthIncome(monthKey){
  return monthTransactions(monthKey,"income").reduce((s,t)=>s+Number(t.amount),0);
}
function categorySpend(monthKey, name){
  return monthTransactions(monthKey,"expense").filter(t=>t.category===name).reduce((s,t)=>s+Number(t.amount),0);
}
function savingsTransferred(monthKey){
  return monthTransactions(monthKey,"savings").reduce((s,t)=>s+Number(t.amount),0);
}
function monthLabel(monthKey){
  const [y,m]=monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric"}).format(new Date(y,m-1,1));
}
function ensureMonth(monthKey){
  if(!data.budgets[monthKey]){
    data.budgets[monthKey] = {};
    const [y,m] = monthKey.split("-").map(Number);
    const prev = new Date(y,m-2,1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,"0")}`;
    data.categories.forEach(c=>{
      let amount = c.defaultBudget || 0;
      if(data.budgets[prevKey] && data.budgets[prevKey][c.name] != null){
        amount = Number(data.budgets[prevKey][c.name]) || 0;
      }
      if(c.name==="Incidentals" && data.closedMonths[prevKey]?.incidentalsCarryover){
        amount += Number(data.closedMonths[prevKey].incidentalsCarryover);
      }
      data.budgets[monthKey][c.name]=round2(amount);
    });
    data.plannedIncome[monthKey] = Number(data.plannedIncome[prevKey]||0);
    save();
  }
}
function save(){
  data.version=APP_VERSION;
  store.save(data);
  if(cloudSync) cloudSync.notifyLocalChange();
  render();
}

function render(){
  const mk=currentMonthKey();
  ensureMonth(mk);
  const spent=monthSpend(mk), budget=monthBudget(mk), remaining=budget-spent;
  const elapsed=elapsedDays(mk), totalDays=daysInMonth(mk);
  const timePct=totalDays ? elapsed/totalDays*100 : 0;
  const spendPct=budget ? spent/budget*100 : 0;
  const forecast=elapsed>0 ? spent/elapsed*totalDays : 0;
  const paceDelta=spendPct-timePct;

  $("monthLabel").textContent=monthLabel(mk);
  renderMonthRecordStatus(mk);
  $("kpiSpent").textContent=money(spent);
  $("kpiBudget").textContent=money(budget);
  $("kpiRemaining").textContent=money(remaining);
  $("kpiForecast").textContent=money(forecast);
  $("forecastNote").textContent= elapsed<7 && elapsed>0 ? "Early-month estimate" : "Linear pace estimate";

  $("timePct").textContent=`${timePct.toFixed(0)}%`;
  $("spendPct").textContent=`${spendPct.toFixed(0)}%`;
  $("timeProgress").value=Math.min(100,timePct);
  $("spendProgress").value=Math.min(100,spendPct);

  let paceText="On pace";
  if(paceDelta>5) paceText=`${paceDelta.toFixed(0)} pts over pace`;
  if(paceDelta<-5) paceText=`${Math.abs(paceDelta).toFixed(0)} pts under pace`;
  $("paceStatus").textContent=paceText;
  $("paceExplanation").textContent = `${elapsed} of ${totalDays} days elapsed. At an even spending pace, about ${timePct.toFixed(0)}% of the monthly budget would be used by now.`;

  const income=monthIncome(mk), planned=Number(data.plannedIncome[mk]||0);
  $("incomeActual").textContent=money(income);
  $("incomePlanned").textContent=money(planned);
  $("netCashFlow").textContent=money(income-spent-savingsTransferred(mk));

  const incidentalsBudget=categoryBudget(mk,"Incidentals");
  const incidentalsSpent=categorySpend(mk,"Incidentals");
  const incidentalsUnused=Math.max(0,incidentalsBudget-incidentalsSpent);
  const nonIncidentalsBudget = data.categories
    .filter(c=>c.name!=="Incidentals")
    .reduce((s,c)=>s+categoryBudget(mk,c.name),0);
  const nonIncidentalsSpend = monthTransactions(mk,"expense")
    .filter(t=>t.category!=="Incidentals")
    .reduce((s,t)=>s+Number(t.amount),0);
  const nonIncidentalsRemaining = Math.max(0, nonIncidentalsBudget-nonIncidentalsSpend);

  $("savingsAvailable").textContent=money(nonIncidentalsRemaining);
  $("savingsTransferred").textContent=money(savingsTransferred(mk));
  $("incidentalsCarryover").textContent=money(data.closedMonths[mk]?.incidentalsCarryover ?? incidentalsUnused);

  renderCategories(mk,timePct);
  renderTransactions(mk);
  renderRules();
}

function renderCategories(mk,timePct){
  let html=`<table><thead><tr><th>Category</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Remaining</th><th class="num">Spent %</th><th>Pace</th></tr></thead><tbody>`;
  for(const c of data.categories){
    const b=categoryBudget(mk,c.name), s=categorySpend(mk,c.name), r=b-s, pct=b?s/b*100:0;
    let pace = "—";
    if(c.pace && b>0){
      const delta=pct-timePct;
      pace = Math.abs(delta)<=5 ? "On pace" : (delta>0 ? `${delta.toFixed(0)} pts over` : `${Math.abs(delta).toFixed(0)} pts under`);
    }
    html+=`<tr class="${r<0?'over':''}">
      <td>${escapeHtml(c.name)}${c.pace?' <small class="muted">• pace</small>':''}</td>
      <td class="num">${money(b)}</td><td class="num">${money(s)}</td><td class="num">${money(r)}</td>
      <td class="num">${pct.toFixed(0)}%</td><td>${pace}</td></tr>`;
  }
  html+=`</tbody></table>`;
  $("categoryTableWrap").innerHTML=html;
}

function compareTransactions(a,b,key){
  if(key==="amount") return Number(a.amount)-Number(b.amount);
  if(key==="date") return String(a.date).localeCompare(String(b.date));
  if(key==="category") return String(a.category||"").localeCompare(String(b.category||""),undefined,{sensitivity:"base"});
  if(key==="description") return String(a.description||"").localeCompare(String(b.description||""),undefined,{sensitivity:"base"});
  return String(a[key]||"").localeCompare(String(b[key]||""),undefined,{sensitivity:"base"});
}

function sortedTransactions(rows){
  const multiplier=transactionSort.direction==="asc" ? 1 : -1;
  return [...rows].sort((a,b)=>{
    const primary=compareTransactions(a,b,transactionSort.key);
    if(primary!==0) return primary*multiplier;
    const byDate=String(b.date).localeCompare(String(a.date));
    if(byDate!==0) return byDate;
    return String(a.description||"").localeCompare(String(b.description||""),undefined,{sensitivity:"base"});
  });
}

function sortIndicator(key){
  if(transactionSort.key!==key) return "";
  return transactionSort.direction==="asc" ? " ▲" : " ▼";
}

function transactionSortHeader(label,key,numeric=false){
  return `<th class="${numeric?"num ":""}sortable" data-sort="${key}" title="Sort by ${label}">${label}<span class="sort-indicator">${sortIndicator(key)}</span></th>`;
}

function refreshTransactionFilterOptions(){
  if(!$("transactionCategoryFilter")) return;
  const current=$("transactionCategoryFilter").value;
  const labels=new Set(data.categories.map(c=>c.name));
  for(const tx of data.transactions){
    if(tx.category) labels.add(tx.category);
  }
  const sorted=[...labels].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
  $("transactionCategoryFilter").innerHTML =
    `<option value="">All categories/labels</option>` +
    sorted.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  if([...$("transactionCategoryFilter").options].some(o=>o.value===current)){
    $("transactionCategoryFilter").value=current;
  }
}

function filteredTransactions(rows){
  const search=transactionFilters.search.trim().toLowerCase();
  return rows.filter(t=>{
    if(transactionFilters.category && String(t.category||"")!==transactionFilters.category) return false;
    if(transactionFilters.type && t.type!==transactionFilters.type) return false;
    if(search){
      const haystack=`${t.description||""} ${t.category||""} ${t.type||""}`.toLowerCase();
      if(!haystack.includes(search)) return false;
    }
    return true;
  });
}

function openEditTransaction(id){
  const tx=data.transactions.find(t=>t.id===id);
  if(!tx) return;
  $("editTxId").value=tx.id;
  $("editTxDate").value=tx.date;
  $("editTxDescription").value=tx.description||"";
  $("editTxAmount").value=Number(tx.amount||0).toFixed(2);
  $("editTxType").value=tx.type||"expense";
  $("editTxCategory").innerHTML=categoryOptions(true);
  $("editTxCategory").value=data.categories.some(c=>c.name===tx.category) ? tx.category : "Incidentals";
  $("editTxCategoryLabel").classList.toggle("hidden",tx.type!=="expense");
  $("editTransactionDialog").showModal();
}

function renderTransactions(mk){
  refreshTransactionFilterOptions();
  const allRows=monthTransactions(mk);
  const rows=sortedTransactions(filteredTransactions(allRows));

  $("transactionSummary").textContent = rows.length===allRows.length
    ? `${allRows.length} transaction${allRows.length===1?"":"s"}`
    : `${rows.length} of ${allRows.length} transactions shown`;

  let html=`<table><thead><tr>
    ${transactionSortHeader("Date","date")}
    ${transactionSortHeader("Description","description")}
    <th>Type</th>
    ${transactionSortHeader("Category","category")}
    ${transactionSortHeader("Amount","amount",true)}
    <th></th>
  </tr></thead><tbody>`;

  for(const t of rows){
    let categoryCell="";
    if(t.type==="expense"){
      categoryCell=`<select class="tx-category-select" data-id="${t.id}">${categoryOptions(true)}</select>`;
    }else{
      categoryCell=escapeHtml(t.category||"");
    }
    html+=`<tr>
      <td>${t.date}</td><td>${escapeHtml(t.description)}</td><td>${t.type}</td><td>${categoryCell}</td>
      <td class="num">${money(t.amount)}</td>
      <td class="actions"><button class="secondary edit-tx" data-id="${t.id}">Edit</button><button class="secondary delete-tx" data-id="${t.id}">Delete</button></td>
    </tr>`;
  }

  if(!rows.length) html+=`<tr><td colspan="6" class="muted">No matching transactions.</td></tr>`;
  html+=`</tbody></table>`;
  $("transactionTableWrap").innerHTML=html;

  document.querySelectorAll("th.sortable[data-sort]").forEach(header=>{
    header.addEventListener("click",()=>{
      const key=header.dataset.sort;
      if(transactionSort.key===key){
        transactionSort.direction=transactionSort.direction==="asc" ? "desc" : "asc";
      }else{
        transactionSort.key=key;
        transactionSort.direction=(key==="date" || key==="amount") ? "desc" : "asc";
      }
      renderTransactions(mk);
    });
  });

  document.querySelectorAll(".tx-category-select").forEach(sel=>{
    const tx=data.transactions.find(t=>t.id===sel.dataset.id);
    if(tx) sel.value=data.categories.some(c=>c.name===tx.category) ? tx.category : "Incidentals";
    sel.addEventListener("change",()=>{
      const tx=data.transactions.find(t=>t.id===sel.dataset.id);
      if(!tx) return;
      if(sel.value==="__new__"){
        const added=promptForNewCategory();
        if(added){
          const previousCategory=tx.category;
          tx.category=added;
          if(previousCategory!==added) learnCategoryCorrection(tx.description,added);
          save();
        }else render();
        return;
      }
      const previousCategory=tx.category;
      tx.category=sel.value;
      if(previousCategory!==sel.value) learnCategoryCorrection(tx.description,sel.value);
      save();
    });
  });

  document.querySelectorAll(".edit-tx").forEach(btn=>btn.addEventListener("click",()=>openEditTransaction(btn.dataset.id)));
  document.querySelectorAll(".delete-tx").forEach(btn=>btn.addEventListener("click",()=>{
    const tx=data.transactions.find(t=>t.id===btn.dataset.id);
    const label=tx ? `${tx.date} — ${tx.description} — ${money(tx.amount)}` : "this transaction";
    if(!window.confirm(`Delete ${label}?`)) return;
    data.transactions=data.transactions.filter(t=>t.id!==btn.dataset.id);
    save();
  }));
}

function renderRules(){
  $("rulesWrap").innerHTML=data.rules.map((r,i)=>`
    <div class="rule-row"><code>${escapeHtml(r.pattern)}</code><span>${escapeHtml(r.type==="transfer" ? "Transfer / CC Payment" : r.category)}</span><button class="secondary delete-rule" data-i="${i}">Delete</button></div>
  `).join("") || `<p class="muted">No rules yet.</p>`;
  document.querySelectorAll(".delete-rule").forEach(btn=>btn.addEventListener("click",()=>{
    data.rules.splice(Number(btn.dataset.i),1); save();
  }));
}

function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
function categoryOptions(includeNew=false){
  const sorted=[...data.categories].sort((a,b)=>
    a.name.localeCompare(b.name,undefined,{sensitivity:"base"})
  );
  const options=sorted.map(c=>`<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  return includeNew ? options + `<option value="__new__">+ New category…</option>` : options;
}
function addCategory(name, pace=false){
  name=String(name||"").trim();
  if(!name) return null;
  const existing=data.categories.find(c=>c.name.toLowerCase()===name.toLowerCase());
  if(existing) return existing.name;

  data.categories.push({name, pace:Boolean(pace), defaultBudget:0});
  for(const mk of Object.keys(data.budgets)){
    if(data.budgets[mk][name] == null) data.budgets[mk][name]=0;
  }
  return name;
}

function promptForNewCategory(){
  const name=window.prompt("New category name:");
  if(name===null) return null;
  const added=addCategory(name,false);
  if(!added){
    alert("Please enter a category name.");
    return null;
  }
  save();
  return added;
}

function findMatchingRule(desc){
  const upper=String(desc||"").toUpperCase();
  const index=data.rules.findIndex(r=>upper.includes(String(r.pattern).toUpperCase()));
  return index>=0 ? {index, rule:data.rules[index]} : null;
}

function autoTransactionType(desc){
  const match=findMatchingRule(desc);
  if(match?.rule?.type) return match.rule.type;
  if(isCreditCardPaymentDescription(desc)) return "transfer";
  return null;
}

function autoCategory(desc){
  const match=findMatchingRule(desc);
  if(match?.rule?.type==="transfer") return "Incidentals";
  return match?.rule?.category || "Incidentals";
}

function suggestedRulePattern(description){
  return String(description||"")
    .trim()
    .replace(/\s+/g," ")
    .toUpperCase()
    .slice(0,80);
}

function learnCategoryCorrection(description, newCategory){
  const match=findMatchingRule(description);

  if(match){
    if(match.rule.category===newCategory) return false;
    const update=window.confirm(
      `Merchant rule "${match.rule.pattern}" currently assigns "${match.rule.category}".\n\n` +
      `Update it so future matching transactions go to "${newCategory}"?`
    );
    if(update){
      data.rules[match.index].category=newCategory;
      data.rules[match.index].type="expense";
      return true;
    }
    return false;
  }

  const suggested=suggestedRulePattern(description);
  const pattern=window.prompt(
    `Remember this categorization for future imports?\n\n` +
    `Enter the text that future transaction descriptions should contain.\n` +
    `Cancel to categorize only this transaction.`,
    suggested
  );

  if(pattern===null) return false;
  const clean=String(pattern).trim();
  if(!clean) return false;

  const duplicate=data.rules.find(r=>String(r.pattern).toUpperCase()===clean.toUpperCase());
  if(duplicate){
    duplicate.category=newCategory;
    duplicate.type="expense";
  }else{
    data.rules.push({pattern:clean, category:newCategory, type:"expense"});
  }
  return true;
}

function id(){ return crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random(); }

function openTransaction(type){
  $("transactionForm").reset();
  $("txType").value=type;
  $("txDate").value=todayISO();
  $("txCategory").innerHTML=categoryOptions(true);
  $("categoryLabel").classList.toggle("hidden",type!=="expense");
  $("transactionDialogTitle").textContent=type==="income" ? "Add income" : (type==="transfer" ? "Add transfer" : "Add expense");
  $("transactionDialog").showModal();
}
$("addExpenseBtn").addEventListener("click",()=>openTransaction("expense"));
$("addTransferBtn").addEventListener("click",()=>openTransaction("transfer"));
$("addIncomeBtn").addEventListener("click",()=>openTransaction("income"));
$("txDescription").addEventListener("input",()=>{
  if($("txType").value==="expense") $("txCategory").value=autoCategory($("txDescription").value);
});
$("txCategory").addEventListener("change",()=>{
  if($("txCategory").value!=="__new__") return;
  const added=promptForNewCategory();
  if(added){
    $("txCategory").innerHTML=categoryOptions(true);
    $("txCategory").value=added;
  }else{
    $("txCategory").value="Incidentals";
  }
});
$("transactionForm").addEventListener("submit",e=>{
  e.preventDefault();
  let type=$("txType").value;
  const description=$("txDescription").value.trim();

  if(type==="expense" && autoTransactionType(description)==="transfer") type="transfer";

  let category=type==="expense" ? $("txCategory").value : (type==="transfer" ? (isCreditCardPaymentDescription(description) ? "CC Payment" : "Transfer") : "");
  if(type==="expense" && category==="__new__"){
    const added=promptForNewCategory();
    if(!added) return;
    category=added;
  }

  const automaticCategory=type==="expense" ? autoCategory(description) : "";
  data.transactions.push({
    id:id(), date:$("txDate").value, description,
    amount:round2($("txAmount").value), type, category
  });
  $("transactionDialog").close();
  if(type==="expense" && category!==automaticCategory){
    learnCategoryCorrection(description,category);
  }
  save();
});

$("addCategoryBtn").addEventListener("click",()=>{
  $("categoryForm").reset();
  $("categoryDialog").showModal();
});

$("categoryForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=$("newCategoryName").value.trim();
  const existing=data.categories.find(c=>c.name.toLowerCase()===name.toLowerCase());
  if(existing){
    alert("That category already exists.");
    return;
  }
  const added=addCategory(name,$("newCategoryPace").checked);
  if(!added) return;

  const mk=currentMonthKey();
  ensureMonth(mk);
  data.budgets[mk][added]=0;
  $("categoryDialog").close();

  // Refresh the open budget form immediately so the new category can be assigned a budget.
  $("budgetFields").innerHTML=data.categories.map(c=>`
    <label>${escapeHtml(c.name)}${c.pace?' (pace tracked)':''}
      <input data-cat="${escapeHtml(c.name)}" type="number" min="0" step="0.01" value="${categoryBudget(mk,c.name)}" />
    </label>`).join("");
  save();
});

$("transactionSearch").addEventListener("input",()=>{
  transactionFilters.search=$("transactionSearch").value;
  renderTransactions(currentMonthKey());
});
$("transactionCategoryFilter").addEventListener("change",()=>{
  transactionFilters.category=$("transactionCategoryFilter").value;
  renderTransactions(currentMonthKey());
});
$("transactionTypeFilter").addEventListener("change",()=>{
  transactionFilters.type=$("transactionTypeFilter").value;
  renderTransactions(currentMonthKey());
});
$("clearTransactionFiltersBtn").addEventListener("click",()=>{
  transactionFilters={search:"",category:"",type:""};
  $("transactionSearch").value="";
  $("transactionCategoryFilter").value="";
  $("transactionTypeFilter").value="";
  renderTransactions(currentMonthKey());
});

$("editTxType").addEventListener("change",()=>{
  $("editTxCategoryLabel").classList.toggle("hidden",$("editTxType").value!=="expense");
});
$("editTxCategory").addEventListener("change",()=>{
  if($("editTxCategory").value!=="__new__") return;
  const added=promptForNewCategory();
  if(added){
    $("editTxCategory").innerHTML=categoryOptions(true);
    $("editTxCategory").value=added;
  }else $("editTxCategory").value="Incidentals";
});
$("editTransactionForm").addEventListener("submit",e=>{
  e.preventDefault();
  const tx=data.transactions.find(t=>t.id===$("editTxId").value);
  if(!tx) return;
  const oldDescription=tx.description;
  const oldCategory=tx.category;
  tx.date=$("editTxDate").value;
  tx.description=$("editTxDescription").value.trim();
  tx.amount=round2($("editTxAmount").value);
  tx.type=$("editTxType").value;
  tx.category=tx.type==="expense" ? $("editTxCategory").value : (tx.type==="savings" ? "Savings" : (tx.type==="transfer" ? "CC Payment" : ""));
  if(tx.type==="expense" && tx.category==="__new__"){
    const added=promptForNewCategory();
    if(!added) return;
    tx.category=added;
  }
  $("editTransactionDialog").close();
  if(tx.type==="expense" && oldCategory!==tx.category){
    learnCategoryCorrection(tx.description,tx.category);
  }else if(tx.type==="expense" && oldDescription!==tx.description){
    const automatic=autoCategory(tx.description);
    if(automatic!==tx.category && window.confirm(`The edited description would normally categorize as "${automatic}". Keep "${tx.category}" and remember a rule for it?`)){
      learnCategoryCorrection(tx.description,tx.category);
    }
  }
  save();
});

$("editBudgetBtn").addEventListener("click",()=>{
  const mk=currentMonthKey(); ensureMonth(mk);
  $("plannedIncomeInput").value=data.plannedIncome[mk]||0;
  $("budgetFields").innerHTML=data.categories.map(c=>`
    <label>${escapeHtml(c.name)}${c.pace?' (pace tracked)':''}
      <input data-cat="${escapeHtml(c.name)}" type="number" min="0" step="0.01" value="${categoryBudget(mk,c.name)}" />
    </label>`).join("");
  $("budgetDialog").showModal();
});
$("budgetForm").addEventListener("submit",e=>{
  e.preventDefault();
  const mk=currentMonthKey();
  data.plannedIncome[mk]=round2($("plannedIncomeInput").value);
  document.querySelectorAll("#budgetFields input[data-cat]").forEach(inp=>{
    data.budgets[mk][inp.dataset.cat]=round2(inp.value);
  });
  $("budgetDialog").close(); save();
});

$("closeMonthBtn").addEventListener("click",()=>{
  const mk=currentMonthKey();
  if(data.closedMonths[mk]){ alert("This month is already closed."); return; }
  const incidentalUnused=Math.max(0,categoryBudget(mk,"Incidentals")-categorySpend(mk,"Incidentals"));
  const nonIncidentalsBudget=data.categories.filter(c=>c.name!=="Incidentals")
    .reduce((s,c)=>s+categoryBudget(mk,c.name),0);
  const nonIncidentalsSpend=monthTransactions(mk,"expense").filter(t=>t.category!=="Incidentals")
    .reduce((s,t)=>s+Number(t.amount),0);
  const savings=Math.max(0,nonIncidentalsBudget-nonIncidentalsSpend);
  if(savings>0){
    const [y,m]=mk.split("-").map(Number);
    const endDate=`${mk}-${String(daysInMonth(mk)).padStart(2,"0")}`;
    data.transactions.push({id:id(),date:endDate,description:"Month-end unused budget",amount:round2(savings),type:"savings",category:"Savings"});
  }
  data.closedMonths[mk]={closedAt:new Date().toISOString(),incidentalsCarryover:round2(incidentalUnused),savingsAmount:round2(savings)};
  const [cy,cm]=mk.split("-").map(Number);
  const nextDate=new Date(cy,cm,1);
  const nextKey=`${nextDate.getFullYear()}-${String(nextDate.getMonth()+1).padStart(2,"0")}`;
  if(data.budgets[nextKey]){
    data.budgets[nextKey]["Incidentals"]=round2(Number(data.budgets[nextKey]["Incidentals"]||0)+incidentalUnused);
  }
  save();
  alert(`Month closed. ${money(savings)} allocated to Savings; ${money(incidentalUnused)} Incidentals will roll forward.`);
});

$("addRuleBtn").addEventListener("click",()=>{
  $("ruleForm").reset(); $("ruleCategory").innerHTML=categoryOptions(); $("ruleDialog").showModal();
});
$("ruleForm").addEventListener("submit",e=>{
  e.preventDefault();
  data.rules.push({pattern:$("rulePattern").value.trim(),category:$("ruleCategory").value});
  $("ruleDialog").close(); save();
});

function csvEscape(value){
  const s=String(value ?? "");
  return `"${s.replace(/"/g,'""')}"`;
}

function monthSnapshotHeaders(){
  return [
    "snapshot_format","snapshot_version","record_type","month","saved_at",
    "date","description","type","category","amount",
    "budget","spent","remaining","pace_tracked",
    "planned_income","actual_income","savings_transferred","incidentals_carryover",
    "closed","closed_at","close_savings_amount"
  ];
}

function buildMonthSnapshotCsv(monthKey){
  ensureMonth(monthKey);
  const headers=monthSnapshotHeaders();
  const savedAt=new Date().toISOString();
  const actualIncome=monthIncome(monthKey);
  const savings=savingsTransferred(monthKey);
  const incBudget=categoryBudget(monthKey,"Incidentals");
  const incSpent=categorySpend(monthKey,"Incidentals");
  const carryover=Number(data.closedMonths[monthKey]?.incidentalsCarryover ?? Math.max(0,incBudget-incSpent));
  const closed=data.closedMonths[monthKey] || null;

  const rows=[];
  const makeRow=values=>headers.map(h=>csvEscape(values[h] ?? "")).join(",");
  rows.push(headers.map(csvEscape).join(","));

  rows.push(makeRow({
    snapshot_format:"BUDGET_PACE_MONTH",
    snapshot_version:1,
    record_type:"metadata",
    month:monthKey,
    saved_at:savedAt,
    budget:monthBudget(monthKey).toFixed(2),
    spent:monthSpend(monthKey).toFixed(2),
    remaining:(monthBudget(monthKey)-monthSpend(monthKey)).toFixed(2),
    planned_income:Number(data.plannedIncome[monthKey]||0).toFixed(2),
    actual_income:actualIncome.toFixed(2),
    savings_transferred:savings.toFixed(2),
    incidentals_carryover:carryover.toFixed(2),
    closed:closed ? "true" : "false",
    closed_at:closed?.closedAt || "",
    close_savings_amount:closed ? Number(closed.savingsAmount||0).toFixed(2) : ""
  }));

  const categories=[...data.categories].sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
  for(const c of categories){
    const b=categoryBudget(monthKey,c.name);
    const s=categorySpend(monthKey,c.name);
    rows.push(makeRow({
      snapshot_format:"BUDGET_PACE_MONTH",
      snapshot_version:1,
      record_type:"category",
      month:monthKey,
      saved_at:savedAt,
      category:c.name,
      budget:b.toFixed(2),
      spent:s.toFixed(2),
      remaining:(b-s).toFixed(2),
      pace_tracked:c.pace ? "true" : "false"
    }));
  }

  const transactions=[...monthTransactions(monthKey)].sort((a,b)=>
    String(a.date).localeCompare(String(b.date)) || String(a.description||"").localeCompare(String(b.description||""),undefined,{sensitivity:"base"})
  );
  for(const t of transactions){
    rows.push(makeRow({
      snapshot_format:"BUDGET_PACE_MONTH",
      snapshot_version:1,
      record_type:"transaction",
      month:monthKey,
      saved_at:savedAt,
      date:t.date,
      description:t.description,
      type:t.type,
      category:t.category||"",
      amount:Number(t.amount||0).toFixed(2)
    }));
  }

  return {csv:rows.join("\n"),savedAt};
}

function ensureSnapshotSettings(){
  data.settings=data.settings || {storageProvider:"local"};
  data.settings.monthSnapshots=data.settings.monthSnapshots || {};
  return data.settings.monthSnapshots;
}

function renderMonthRecordStatus(monthKey){
  const el=$("monthRecordStatus");
  if(!el) return;
  const info=data.settings?.monthSnapshots?.[monthKey];
  if(!info){
    el.textContent=`${monthLabel(monthKey)} · no month snapshot saved or loaded in this browser yet`;
    return;
  }
  const when=info.savedAt || info.loadedAt;
  const dateText=when ? new Date(when).toLocaleString() : "";
  if(info.action==="loaded"){
    el.textContent=`${monthLabel(monthKey)} · loaded from ${info.fileName || "month CSV"}${dateText ? ` on ${dateText}` : ""}`;
  }else{
    el.textContent=`${monthLabel(monthKey)} · last snapshot saved${dateText ? ` ${dateText}` : ""}`;
  }
}

function downloadTextFile(filename,text,type="text/plain"){
  const blob=new Blob([text],{type});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),500);
}

$("saveMonthCsvBtn").addEventListener("click",()=>{
  const mk=currentMonthKey();
  const snapshot=buildMonthSnapshotCsv(mk);
  downloadTextFile(`BudgetPace-${mk}-snapshot.csv`,snapshot.csv,"text/csv");
  const settings=ensureSnapshotSettings();
  settings[mk]={action:"saved",savedAt:snapshot.savedAt};
  store.save(data);
  if(cloudSync) cloudSync.notifyLocalChange();
  renderMonthRecordStatus(mk);
});

function snapshotBoolean(value){
  return String(value||"").trim().toLowerCase()==="true" || String(value||"").trim()==="1";
}

function parseMonthSnapshot(text){
  const rows=parseCSV(text);
  if(rows.length<2) throw new Error("The month CSV is empty.");
  const headers=rows[0].map(h=>String(h||"").replace(/^\uFEFF/,"").trim());
  const index=Object.fromEntries(headers.map((h,i)=>[h,i]));
  const required=["snapshot_format","snapshot_version","record_type","month"];
  for(const name of required){
    if(index[name]===undefined) throw new Error(`This is not a Budget Pace month snapshot: missing ${name}.`);
  }
  const value=(row,name)=>String(row[index[name]] ?? "").trim();
  const records=rows.slice(1).filter(r=>r.some(v=>String(v||"").trim()!==""));
  if(!records.length) throw new Error("The month snapshot contains no records.");
  if(records.some(r=>value(r,"snapshot_format")!=="BUDGET_PACE_MONTH")){
    throw new Error("This CSV is not a Budget Pace month snapshot.");
  }
  const metadata=records.find(r=>value(r,"record_type")==="metadata");
  if(!metadata) throw new Error("The month snapshot is missing its metadata row.");
  const month=value(metadata,"month");
  if(!/^\d{4}-\d{2}$/.test(month)) throw new Error("The snapshot month is invalid.");
  if(records.some(r=>value(r,"month") && value(r,"month")!==month)){
    throw new Error("The snapshot contains records from more than one month.");
  }

  const num=(row,name)=>{
    if(index[name]===undefined) return 0;
    const raw=value(row,name);
    if(raw==="") return 0;
    const n=Number(raw);
    if(!Number.isFinite(n)) throw new Error(`Invalid numeric value in ${name}.`);
    return n;
  };

  const categories=records.filter(r=>value(r,"record_type")==="category").map(r=>({
    name:value(r,"category"),
    budget:round2(num(r,"budget")),
    pace:snapshotBoolean(value(r,"pace_tracked"))
  })).filter(c=>c.name);

  const transactions=records.filter(r=>value(r,"record_type")==="transaction").map(r=>{
    const date=value(r,"date");
    const type=value(r,"type") || "expense";
    const amount=round2(num(r,"amount"));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid transaction date: ${date}`);
    if(monthKeyFromDate(date)!==month) throw new Error(`Transaction ${date} does not belong to ${month}.`);
    if(!["expense","income","savings","transfer"].includes(type)) throw new Error(`Unsupported transaction type: ${type}`);
    return {
      id:id(),
      date,
      description:value(r,"description"),
      type,
      category:value(r,"category"),
      amount
    };
  });

  return {
    month,
    savedAt:value(metadata,"saved_at"),
    plannedIncome:round2(num(metadata,"planned_income")),
    closed:snapshotBoolean(value(metadata,"closed")),
    closedAt:value(metadata,"closed_at"),
    closeSavingsAmount:round2(num(metadata,"close_savings_amount")),
    incidentalsCarryover:round2(num(metadata,"incidentals_carryover")),
    expectedSpent:round2(num(metadata,"spent")),
    categories,
    transactions
  };
}

$("loadMonthCsvFile").addEventListener("change",async e=>{
  const file=e.target.files[0];
  if(!file) return;
  try{
    const snapshot=parseMonthSnapshot(await file.text());
    const txCount=snapshot.transactions.length;
    const ok=window.confirm(
      `Load ${monthLabel(snapshot.month)} from ${file.name}?\n\n`+
      `${snapshot.categories.length} budget categories\n`+
      `${txCount} transactions\n\n`+
      `This replaces only ${monthLabel(snapshot.month)} in the current browser. Other months remain unchanged.`
    );
    if(!ok){ e.target.value=""; return; }

    // Add any historical categories that do not exist globally yet.
    for(const incoming of snapshot.categories){
      const existing=data.categories.find(c=>c.name.toLowerCase()===incoming.name.toLowerCase());
      if(existing){
        // Preserve category identity, but restore pace behavior from the snapshot.
        existing.pace=incoming.pace;
      }else{
        data.categories.push({name:incoming.name,pace:incoming.pace,defaultBudget:0});
      }
    }

    // Replace this month's budget definition.
    data.budgets[snapshot.month]={};
    for(const c of snapshot.categories){
      data.budgets[snapshot.month][c.name]=c.budget;
    }
    data.plannedIncome[snapshot.month]=snapshot.plannedIncome;

    // Replace this month's transactions, leaving every other month untouched.
    data.transactions=data.transactions.filter(t=>monthKeyFromDate(t.date)!==snapshot.month);
    data.transactions.push(...snapshot.transactions);

    if(snapshot.closed){
      data.closedMonths[snapshot.month]={
        closedAt:snapshot.closedAt || snapshot.savedAt || new Date().toISOString(),
        incidentalsCarryover:snapshot.incidentalsCarryover,
        savingsAmount:snapshot.closeSavingsAmount
      };
    }else{
      delete data.closedMonths[snapshot.month];
    }

    const computedSpent=round2(monthSpend(snapshot.month));
    const settings=ensureSnapshotSettings();
    settings[snapshot.month]={
      action:"loaded",
      loadedAt:new Date().toISOString(),
      savedAt:snapshot.savedAt || "",
      fileName:file.name
    };
    data.version=APP_VERSION;
    store.save(data);
    if(cloudSync) cloudSync.notifyLocalChange();
    $("monthPicker").value=snapshot.month;
    transactionFilters={search:"",category:"",type:""};
    $("transactionSearch").value="";
    $("transactionTypeFilter").value="";
    e.target.value="";
    render();

    const delta=Math.abs(computedSpent-snapshot.expectedSpent);
    if(delta>0.01){
      alert(`Month loaded, but the snapshot's saved spending total (${money(snapshot.expectedSpent)}) differs from the transactions recomputed by the app (${money(computedSpent)}). Review the imported month.`);
    }else{
      alert(`${monthLabel(snapshot.month)} loaded successfully.`);
    }
  }catch(err){
    console.error(err);
    alert(`Could not load month CSV: ${err.message}`);
    e.target.value="";
  }
});

function parseCSV(text){
  const rows=[]; let row=[], cell="", q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i], next=text[i+1];
    if(ch==='"' && q && next==='"'){ cell+='"'; i++; }
    else if(ch==='"'){ q=!q; }
    else if(ch===',' && !q){ row.push(cell); cell=""; }
    else if((ch==='\n'||ch==='\r')&&!q){
      if(ch==='\r'&&next==='\n') i++;
      row.push(cell); cell="";
      if(row.some(v=>v.trim()!=="")) rows.push(row);
      row=[];
    } else cell+=ch;
  }
  if(cell.length||row.length){ row.push(cell); rows.push(row); }
  return rows;
}
function normalizeDate(v){
  v=String(v||"").trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  let m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m){
    const month=String(Number(m[1])).padStart(2,"0");
    const day=String(Number(m[2])).padStart(2,"0");
    return `${m[3]}-${month}-${day}`;
  }

  m=v.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if(m){
    const month=String(Number(m[1])).padStart(2,"0");
    const day=String(Number(m[2])).padStart(2,"0");
    return `${m[3]}-${month}-${day}`;
  }

  const d=new Date(v);
  return Number.isNaN(d.getTime()) ? todayISO() : d.toISOString().slice(0,10);
}
function cleanHeader(v){
  return String(v||"").replace(/^\uFEFF/,"").trim().toLowerCase();
}

function parseMoneyCell(v){
  const raw=String(v??"").trim();
  if(!raw) return null;
  const cleaned=raw.replace(/\$/g,"").replace(/,/g,"").replace(/^\((.*)\)$/,"-$1");
  const n=Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isHighConfidenceInternalTransfer(description){
  const d=String(description||"").trim().toUpperCase();
  return /^ONLINE TRANSFER (TO|FROM) DEPOSIT ACCOUNT\b/.test(d) ||
         /^ONLINE BANKING TRANSFER\b/.test(d);
}

$("csvFile").addEventListener("change",async e=>{
  const file=e.target.files[0];
  if(!file) return;

  const rows=parseCSV(await file.text());
  if(!rows.length){
    alert("CSV is empty.");
    e.target.value="";
    return;
  }

  const looksLikeDate=(value)=>{
    const s=String(value||"").trim();
    if(!s) return false;
    if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return true;
    if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return true;
    if(/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) return true;
    const d=new Date(s);
    return !Number.isNaN(d.getTime());
  };

  const parseMoney=(value)=>{
    const raw=String(value??"").trim();
    if(!raw) return 0;
    const negativeParens=/^\(.*\)$/.test(raw);
    const cleaned=raw.replace(/[$,\s()]/g,"");
    let n=Number(cleaned);
    if(!Number.isFinite(n)) return 0;
    if(negativeParens) n=-Math.abs(n);
    return n;
  };

  const firstRow=rows[0] || [];
  const firstCell=String(firstRow[0]||"").trim().toLowerCase();

  // Headerless format detection:
  // Date | Transaction Description | Debit | Credit | Balance | [optional blank]
  const isHeaderlessBankFormat =
    firstRow.length>=5 &&
    looksLikeDate(firstRow[0]) &&
    String(firstRow[1]||"").trim()!=="" &&
    firstCell!=="date" &&
    firstCell!=="transaction date";

  let dataRows=rows;
  let hasHeader=!isHeaderlessBankFormat;

  let accountTypeI=-1, accountNumberI=-1, dateI=-1, chequeI=-1;
  let desc1I=-1, desc2I=-1, descI=-1;
  let cadI=-1, usdI=-1, amtI=-1, debitI=-1, creditI=-1;
  let typeI=-1, catI=-1, balanceI=-1;

  if(isHeaderlessBankFormat){
    dateI=0;
    descI=1;
    debitI=2;
    creditI=3;
    balanceI=4;
    dataRows=rows;
  }else{
    if(rows.length<2){
      alert("CSV does not contain any transaction rows.");
      e.target.value="";
      return;
    }

    const headers=rows[0].map(h=>String(h||"").trim().toLowerCase());
    const find=(names)=>headers.findIndex(h=>names.includes(h));

    accountTypeI=find(["account type"]);
    accountNumberI=find(["account number"]);
    dateI=find(["transaction date","date","posted date"]);
    chequeI=find(["cheque number","check number"]);
    desc1I=find(["description 1","description1"]);
    desc2I=find(["description 2","description2"]);
    descI=find(["transaction description","description","merchant","payee","details","transaction"]);
    cadI=find(["cad$","cad","cad amount","amount cad"]);
    usdI=find(["usd$","usd","usd amount","amount usd"]);
    amtI=find(["amount","transaction amount"]);
    debitI=find(["debit","withdrawal","withdrawals"]);
    creditI=find(["credit","deposit","deposits"]);
    balanceI=find(["balance","running balance"]);
    typeI=find(["type"]);
    catI=find(["category"]);

    dataRows=rows.slice(1);
  }

  const hasBankFormat =
    hasHeader &&
    dateI>=0 &&
    desc1I>=0 &&
    desc2I>=0 &&
    cadI>=0;

  const usableDescription = hasBankFormat || descI>=0 || desc1I>=0;
  const usableAmount = cadI>=0 || amtI>=0 || debitI>=0 || creditI>=0;

  if(dateI<0 || !usableDescription || !usableAmount){
    alert(
      "Could not identify required columns.\n\n" +
      "Supported formats include:\n" +
      "1) Transaction Date, Description 1, Description 2, CAD$\n" +
      "2) Headerless: Date, Transaction Description, Debit, Credit, Balance"
    );
    e.target.value="";
    return;
  }

  const mergedDescription=(r)=>{
    if(desc1I>=0 || desc2I>=0){
      const d1=desc1I>=0 ? String(r[desc1I]||"").trim() : "";
      const d2=desc2I>=0 ? String(r[desc2I]||"").trim() : "";
      return [d1,d2].filter(Boolean).join("--");
    }
    return descI>=0 ? String(r[descI]||"").trim() : "";
  };

  let added=0, duplicates=0, skippedUsdOnly=0, skippedBlank=0, transfers=0, expenses=0, incomes=0;

  for(const r of dataRows){
    if(!r || !r.some(v=>String(v||"").trim()!=="")) continue;

    const date=normalizeDate(r[dateI]);
    const description=mergedDescription(r);

    if(!description){
      skippedBlank++;
      continue;
    }

    let amount=0;
    let type="expense";

    if(cadI>=0){
      const cad=parseMoney(r[cadI]);
      const usd=usdI>=0 ? parseMoney(r[usdI]) : 0;

      if(!cad && usd){
        skippedUsdOnly++;
        continue;
      }

      if(!cad){
        skippedBlank++;
        continue;
      }

      amount=Math.abs(cad);
      type=cad<0 ? "expense" : "income";
    }else if(debitI>=0 || creditI>=0){
      const debit=debitI>=0 ? parseMoney(r[debitI]) : 0;
      const credit=creditI>=0 ? parseMoney(r[creditI]) : 0;

      if(debit){
        amount=Math.abs(debit);
        type="expense";
      }else if(credit){
        amount=Math.abs(credit);
        type="income";
      }else{
        skippedBlank++;
        continue;
      }
    }else if(amtI>=0){
      const raw=parseMoney(r[amtI]);
      if(!raw){
        skippedBlank++;
        continue;
      }
      amount=Math.abs(raw);
      if(typeI>=0){
        const supplied=String(r[typeI]||"").trim().toLowerCase();
        if(["income","expense","transfer","savings"].includes(supplied)) type=supplied;
        else type=raw<0 ? "expense" : "income";
      }else{
        type=raw<0 ? "expense" : "income";
      }
    }

    const detectedType=typeof autoTransactionType==="function"
      ? autoTransactionType(description)
      : null;
    if(detectedType==="transfer") type="transfer";

    let category="";
    if(type==="transfer"){
      category=isCreditCardPaymentDescription(description) ? "CC Payment" : "Transfer";
      transfers++;
    }else if(type==="expense"){
      category=(catI>=0 && r[catI])
        ? String(r[catI]).trim()
        : autoCategory(description);
      expenses++;
    }else if(type==="income"){
      incomes++;
    }

    const fingerprint=[
      date,
      description.toUpperCase(),
      round2(amount),
      type
    ].join("|");

    const exists=data.transactions.some(t=>
      [
        t.date,
        String(t.description||"").toUpperCase(),
        round2(t.amount),
        t.type
      ].join("|")===fingerprint
    );

    if(exists){
      duplicates++;
      continue;
    }

    const sourceMeta={};
    if(hasBankFormat){
      if(accountTypeI>=0) sourceMeta.accountType=String(r[accountTypeI]||"").trim();
      if(accountNumberI>=0) sourceMeta.accountNumber=String(r[accountNumberI]||"").trim();
      if(chequeI>=0) sourceMeta.chequeNumber=String(r[chequeI]||"").trim();
    }
    if(balanceI>=0){
      sourceMeta.balance=parseMoney(r[balanceI]);
    }
    if(isHeaderlessBankFormat){
      sourceMeta.format="headerless-bank";
    }

    data.transactions.push({
      id:id(),
      date,
      description,
      amount:round2(amount),
      type,
      category,
      source:Object.keys(sourceMeta).length ? sourceMeta : undefined
    });

    added++;
  }

  e.target.value="";
  save();

  let message=`${added} transaction(s) imported.`;

  if(hasBankFormat){
    message += `\n\nRecognized headered bank format.`;
    message += `\nDescription 1 and Description 2 were merged using "--".`;
  }else if(isHeaderlessBankFormat){
    message += `\n\nRecognized headerless bank format:`;
    message += `\nDate | Transaction Description | Debit | Credit | Balance`;
    message += `\nThe Balance column was retained as source metadata but is not used in budget calculations.`;
  }

  if(duplicates) message += `\nDuplicates skipped: ${duplicates}`;
  if(skippedUsdOnly) message += `\nUSD-only transactions skipped: ${skippedUsdOnly}`;
  if(skippedBlank) message += `\nBlank/zero rows skipped: ${skippedBlank}`;
  message += `\nExpenses: ${expenses} | Income: ${incomes} | Transfers: ${transfers}`;

  alert(message);
});

function downloadBlob(filename,content,type){
  const blob=new Blob([content],{type});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),500);
}

function validateBackup(candidate){
  if(!candidate || typeof candidate!=="object") return "Backup is not a valid object.";
  if(!Array.isArray(candidate.transactions)) return "Backup is missing transactions.";
  if(!Array.isArray(candidate.categories)) return "Backup is missing categories.";
  if(!candidate.budgets || typeof candidate.budgets!=="object") return "Backup is missing budgets.";
  if(!Array.isArray(candidate.rules)) return "Backup is missing merchant rules.";
  if(!candidate.closedMonths || typeof candidate.closedMonths!=="object") return "Backup is missing month-close data.";
  if(!candidate.plannedIncome || typeof candidate.plannedIncome!=="object") return "Backup is missing planned-income data.";
  return null;
}

$("backupBtn").addEventListener("click",()=>{
  const payload={...data,backupMetadata:{exportedAt:new Date().toISOString(),app:"Budget Pace",appVersion:APP_VERSION}};
  downloadBlob(`BudgetPace-backup-${todayISO()}.json`,JSON.stringify(payload,null,2),"application/json");
});

$("restoreFile").addEventListener("change",async e=>{
  const file=e.target.files[0];
  if(!file) return;
  try{
    const candidate=JSON.parse(await file.text());
    const error=validateBackup(candidate);
    if(error){ alert(`Restore failed: ${error}`); e.target.value=""; return; }
    const ok=window.confirm(`Restore this backup?\n\nTransactions: ${candidate.transactions.length}\nCategories: ${candidate.categories.length}\n\nThis replaces the current Budget Pace data in this browser.`);
    if(!ok){ e.target.value=""; return; }
    data={
      version:Number(candidate.version||APP_VERSION),
      categories:candidate.categories, budgets:candidate.budgets, plannedIncome:candidate.plannedIncome,
      transactions:candidate.transactions, rules:candidate.rules, closedMonths:candidate.closedMonths,
      settings:candidate.settings||{storageProvider:"local"}
    };
    migrateCreditCardPayments();
    store.save(data);
    if(cloudSync) cloudSync.notifyLocalChange();
    transactionFilters={search:"",category:"",type:""};
    $("transactionSearch").value=""; $("transactionTypeFilter").value=""; e.target.value="";
    render();
    alert("Backup restored successfully.");
  }catch(err){
    alert("Restore failed: the selected file is not a valid Budget Pace backup.");
    e.target.value="";
  }
});


// ---------- Native XLSX export ----------
// This creates a standards-based .xlsx ZIP package directly in the browser.
// It intentionally uses no external JavaScript libraries so Excel export
// remains offline-capable and free to run.

function xlsxXmlEscape(value){
  return String(value ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&apos;");
}

function xlsxColumnName(index){
  let n=index+1, name="";
  while(n>0){
    const rem=(n-1)%26;
    name=String.fromCharCode(65+rem)+name;
    n=Math.floor((n-1)/26);
  }
  return name;
}

function xlsxCell(value,style=0){
  return {value,style};
}

function xlsxCellXml(cell,rowIndex,colIndex){
  const ref=`${xlsxColumnName(colIndex)}${rowIndex+1}`;
  const obj=(cell && typeof cell==="object" && Object.prototype.hasOwnProperty.call(cell,"value"))
    ? cell : {value:cell,style:0};
  const value=obj.value;
  const style=Number(obj.style||0);
  const s=style ? ` s="${style}"` : "";

  if(value===null || value===undefined || value===""){
    return `<c r="${ref}"${s}/>`;
  }

  if(typeof value==="number" && Number.isFinite(value)){
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }

  if(typeof value==="boolean"){
    return `<c r="${ref}" t="b"${s}><v>${value?1:0}</v></c>`;
  }

  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xlsxXmlEscape(value)}</t></is></c>`;
}

function xlsxWorksheetXml(rows,widths=[]){
  const maxCols=Math.max(1,...rows.map(r=>r.length));
  const maxRows=Math.max(1,rows.length);
  const lastRef=`${xlsxColumnName(maxCols-1)}${maxRows}`;

  const cols=widths.length
    ? `<cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${Number(w)}" customWidth="1"/>`).join("")}</cols>`
    : "";

  const sheetData=rows.map((row,r)=>
    `<row r="${r+1}">${row.map((cell,c)=>xlsxCellXml(cell,r,c)).join("")}</row>`
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  ${cols}
  <sheetData>${sheetData}</sheetData>
  <autoFilter ref="A1:${lastRef}"/>
</worksheet>`;
}

function xlsxCrc32(bytes){
  if(!xlsxCrc32.table){
    const table=new Uint32Array(256);
    for(let n=0;n<256;n++){
      let c=n;
      for(let k=0;k<8;k++) c=(c&1) ? (0xEDB88320^(c>>>1)) : (c>>>1);
      table[n]=c>>>0;
    }
    xlsxCrc32.table=table;
  }
  let crc=0xFFFFFFFF;
  for(const b of bytes) crc=xlsxCrc32.table[(crc^b)&0xFF]^(crc>>>8);
  return (crc^0xFFFFFFFF)>>>0;
}

function xlsxConcat(parts){
  const total=parts.reduce((s,p)=>s+p.length,0);
  const out=new Uint8Array(total);
  let offset=0;
  for(const p of parts){ out.set(p,offset); offset+=p.length; }
  return out;
}

function xlsxU16(value){
  const b=new Uint8Array(2);
  new DataView(b.buffer).setUint16(0,value,true);
  return b;
}

function xlsxU32(value){
  const b=new Uint8Array(4);
  new DataView(b.buffer).setUint32(0,value>>>0,true);
  return b;
}

function xlsxDosDateTime(date=new Date()){
  const year=Math.max(1980,date.getFullYear());
  const dosTime=(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1);
  const dosDate=((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate();
  return {dosTime,dosDate};
}

function xlsxZipStore(files){
  const encoder=new TextEncoder();
  const localParts=[];
  const centralParts=[];
  let offset=0;
  const {dosTime,dosDate}=xlsxDosDateTime();

  for(const file of files){
    const nameBytes=encoder.encode(file.name);
    const dataBytes=typeof file.data==="string" ? encoder.encode(file.data) : file.data;
    const crc=xlsxCrc32(dataBytes);

    const local=xlsxConcat([
      xlsxU32(0x04034b50),
      xlsxU16(20),
      xlsxU16(0x0800),
      xlsxU16(0),
      xlsxU16(dosTime),
      xlsxU16(dosDate),
      xlsxU32(crc),
      xlsxU32(dataBytes.length),
      xlsxU32(dataBytes.length),
      xlsxU16(nameBytes.length),
      xlsxU16(0),
      nameBytes,
      dataBytes
    ]);
    localParts.push(local);

    const central=xlsxConcat([
      xlsxU32(0x02014b50),
      xlsxU16(20),
      xlsxU16(20),
      xlsxU16(0x0800),
      xlsxU16(0),
      xlsxU16(dosTime),
      xlsxU16(dosDate),
      xlsxU32(crc),
      xlsxU32(dataBytes.length),
      xlsxU32(dataBytes.length),
      xlsxU16(nameBytes.length),
      xlsxU16(0),
      xlsxU16(0),
      xlsxU16(0),
      xlsxU16(0),
      xlsxU32(0),
      xlsxU32(offset),
      nameBytes
    ]);
    centralParts.push(central);
    offset+=local.length;
  }

  const centralDir=xlsxConcat(centralParts);
  const end=xlsxConcat([
    xlsxU32(0x06054b50),
    xlsxU16(0),
    xlsxU16(0),
    xlsxU16(files.length),
    xlsxU16(files.length),
    xlsxU32(centralDir.length),
    xlsxU32(offset),
    xlsxU16(0)
  ]);

  return xlsxConcat([...localParts,centralDir,end]);
}

function xlsxCreateBytes(sheets){
  const safeSheetName=name=>
    String(name).replace(/[\\/?*[\]:]/g," ").slice(0,31) || "Sheet";

  const names=sheets.map(s=>safeSheetName(s.name));
  const worksheetFiles=sheets.map((sheet,i)=>({
    name:`xl/worksheets/sheet${i+1}.xml`,
    data:xlsxWorksheetXml(sheet.rows,sheet.widths||[])
  }));

  const workbookSheets=names.map((name,i)=>
    `<sheet name="${xlsxXmlEscape(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`
  ).join("");

  const workbookRels=sheets.map((_,i)=>
    `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`
  ).join("");

  const contentSheetOverrides=sheets.map((_,i)=>
    `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");

  const files=[
    {
      name:"[Content_Types].xml",
      data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${contentSheetOverrides}
</Types>`
    },
    {
      name:"_rels/.rels",
      data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name:"xl/workbook.xml",
      data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets}</sheets>
  <calcPr calcId="191029"/>
</workbook>`
    },
    {
      name:"xl/_rels/workbook.xml.rels",
      data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRels}
  <Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    {
      name:"xl/styles.xml",
      data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="$#,##0.00;[Red]-$#,##0.00"/>
    <numFmt numFmtId="165" formatCode="0.0%"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0B1F33"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
    },
    ...worksheetFiles
  ];

  return xlsxZipStore(files);
}

function excelExportSheets(){
  const mk=currentMonthKey();
  const spent=monthSpend(mk);
  const budget=monthBudget(mk);
  const income=monthIncome(mk);
  const planned=Number(data.plannedIncome[mk]||0);
  const elapsed=elapsedDays(mk);
  const totalDays=daysInMonth(mk);
  const forecast=elapsed>0 ? spent/elapsed*totalDays : 0;
  const incidentalsUnused=Math.max(0,categoryBudget(mk,"Incidentals")-categorySpend(mk,"Incidentals"));
  const carryover=Number(data.closedMonths[mk]?.incidentalsCarryover ?? incidentalsUnused);
  const transferred=savingsTransferred(mk);

  const summaryRows=[
    [xlsxCell("Metric",1),xlsxCell("Value",1),xlsxCell("Notes",1)],
    ["Month",monthLabel(mk),"Selected month when exported"],
    ["Planned Income",xlsxCell(planned,2),"CAD"],
    ["Actual Income",xlsxCell(income,2),"Transfers excluded"],
    ["Budget",xlsxCell(budget,2),"Expense-category budget"],
    ["Spent",xlsxCell(spent,2),"Expenses only; transfers excluded"],
    ["Remaining",xlsxCell(budget-spent,2),"Budget minus expenses"],
    ["Forecast",xlsxCell(forecast,2),"Linear pace forecast"],
    ["Savings Transferred",xlsxCell(transferred,2),"Month-close savings transfers"],
    ["Net Cash Flow",xlsxCell(income-spent-transferred,2),"Income minus expenses minus savings transfers"],
    ["Incidentals Carryover",xlsxCell(carryover,2),"Unused Incidentals"],
    ["Exported At",new Date().toLocaleString(),"Budget Pace v"+APP_VERSION]
  ];

  const months=new Set([
    ...Object.keys(data.budgets||{}),
    ...Object.keys(data.plannedIncome||{}),
    ...Object.keys(data.closedMonths||{}),
    ...data.transactions.map(t=>monthKeyFromDate(t.date))
  ]);
  const monthlyRows=[
    [xlsxCell("Month",1),xlsxCell("Planned Income",1),xlsxCell("Actual Income",1),
     xlsxCell("Budget",1),xlsxCell("Spent",1),xlsxCell("Remaining",1),
     xlsxCell("Savings Transferred",1),xlsxCell("Net Cash Flow",1),xlsxCell("Incidentals Carryover",1)]
  ];
  [...months].filter(Boolean).sort().forEach(month=>{
    const b=monthBudget(month), s=monthSpend(month), inc=monthIncome(month), sv=savingsTransferred(month);
    const ib=categoryBudget(month,"Incidentals"), is=categorySpend(month,"Incidentals");
    monthlyRows.push([
      month,
      xlsxCell(Number(data.plannedIncome[month]||0),2),
      xlsxCell(inc,2),
      xlsxCell(b,2),
      xlsxCell(s,2),
      xlsxCell(b-s,2),
      xlsxCell(sv,2),
      xlsxCell(inc-s-sv,2),
      xlsxCell(Number(data.closedMonths[month]?.incidentalsCarryover ?? Math.max(0,ib-is)),2)
    ]);
  });

  const transactionRows=[
    [xlsxCell("Date",1),xlsxCell("Description",1),xlsxCell("Type",1),
     xlsxCell("Category / Label",1),xlsxCell("Amount (CAD)",1)]
  ];
  [...data.transactions]
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)) || String(a.description).localeCompare(String(b.description)))
    .forEach(t=>transactionRows.push([
      t.date,
      t.description,
      t.type,
      t.category||"",
      xlsxCell(Number(t.amount||0),2)
    ]));

  const allCategories=new Set(data.categories.map(c=>c.name));
  for(const budgets of Object.values(data.budgets||{})){
    for(const name of Object.keys(budgets||{})) allCategories.add(name);
  }
  for(const t of data.transactions){
    if(t.type==="expense" && t.category) allCategories.add(t.category);
  }
  const sortedCategories=[...allCategories].filter(Boolean).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));

  const budgetRows=[
    [xlsxCell("Month",1),xlsxCell("Category",1),xlsxCell("Budget (CAD)",1),
     xlsxCell("Actual Spent (CAD)",1),xlsxCell("Remaining (CAD)",1),
     xlsxCell("Budget Used",1),xlsxCell("Pace Tracked",1)]
  ];
  [...months].filter(Boolean).sort().forEach(month=>{
    for(const category of sortedCategories){
      const b=categoryBudget(month,category);
      const s=categorySpend(month,category);
      if(!b && !s && !(data.budgets[month] && Object.prototype.hasOwnProperty.call(data.budgets[month],category))) continue;
      const cat=data.categories.find(c=>c.name===category);
      budgetRows.push([
        month,category,xlsxCell(b,2),xlsxCell(s,2),xlsxCell(b-s,2),
        b ? xlsxCell(s/b,3) : "",
        cat?.pace ? "Yes" : "No"
      ]);
    }
  });

  const categoryRows=[
    [xlsxCell("Category",1),xlsxCell("Pace Tracked",1),xlsxCell("Default Budget (CAD)",1)]
  ];
  [...data.categories]
    .sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}))
    .forEach(c=>categoryRows.push([c.name,c.pace?"Yes":"No",xlsxCell(Number(c.defaultBudget||0),2)]));

  const ruleRows=[
    [xlsxCell("Description Contains",1),xlsxCell("Rule Type",1),xlsxCell("Category / Label",1)]
  ];
  [...(data.rules||[])]
    .sort((a,b)=>String(a.pattern).localeCompare(String(b.pattern),undefined,{sensitivity:"base"}))
    .forEach(r=>ruleRows.push([
      r.pattern,
      r.type || (r.category==="CC Payment" ? "transfer" : "expense"),
      r.type==="transfer" ? "CC Payment" : (r.category||"")
    ]));

  return [
    {name:"Summary",rows:summaryRows,widths:[24,22,42]},
    {name:"Monthly Summary",rows:monthlyRows,widths:[12,18,18,16,16,16,20,18,22]},
    {name:"Transactions",rows:transactionRows,widths:[14,42,14,24,18]},
    {name:"Budget Detail",rows:budgetRows,widths:[12,24,18,20,20,16,16]},
    {name:"Categories",rows:categoryRows,widths:[28,16,22]},
    {name:"Merchant Rules",rows:ruleRows,widths:[42,16,24]}
  ];
}

function exportExcelWorkbook(){
  try{
    const bytes=xlsxCreateBytes(excelExportSheets());
    const blob=new Blob([bytes],{
      type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`Budget-Pace-${todayISO()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }catch(err){
    console.error(err);
    alert("Excel export failed. Your Budget Pace data was not changed.");
  }
}

$("exportExcelBtn").addEventListener("click",exportExcelWorkbook);


$("exportBtn").addEventListener("click",()=>{
  const headers=["date","description","type","category","amount"];
  const csv=[headers.join(",")].concat(
    [...data.transactions].sort((a,b)=>a.date.localeCompare(b.date)).map(t=>
      [t.date,t.description,t.type,t.category||"",Number(t.amount).toFixed(2)].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")
    )
  ).join("\n");
  const blob=new Blob([csv],{type:"text/csv"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`budget-history-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href);
});

$("monthPicker").addEventListener("change",render);
$("prevMonthBtn").addEventListener("click",()=>selectMonth(shiftMonthKey(currentMonthKey(),-1)));
$("nextMonthBtn").addEventListener("click",()=>selectMonth(shiftMonthKey(currentMonthKey(),1)));
$("currentMonthBtn").addEventListener("click",()=>selectMonth(todayISO().slice(0,7)));

window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault(); deferredInstallPrompt=e; $("installBtn").classList.remove("hidden");
});
$("installBtn").addEventListener("click",async()=>{
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null; $("installBtn").classList.add("hidden");
});

if("serviceWorker" in navigator &&
   location.protocol==="https:" &&
   location.hostname!=="localhost" &&
   location.hostname!=="127.0.0.1"){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("sw.js?v=1.0").catch(err=>{
      console.warn("Budget Pace service worker registration failed:",err);
    });
  });
}

(function init(){
  if($("appVersion")) $("appVersion").textContent="v1.0";
  const startupMigrationChanged=migrateCreditCardPayments();
  const now=todayISO().slice(0,7);
  $("monthPicker").value=now;
  $("txCategory").innerHTML=categoryOptions(true);
  $("ruleCategory").innerHTML=categoryOptions();
  refreshTransactionFilterOptions();
  render();

  if(globalThis.BudgetPaceCloudSync){
    cloudSync=new BudgetPaceCloudSync({
      getData:()=>data,
      setData:(newData)=>{
        data=newData || initialData();
        data.version=APP_VERSION;
        migrateCreditCardPayments();
        store.save(data);
        refreshTransactionFilterOptions();
        render();
      },
      getAppVersion:()=>"1.0"
    });
    if(startupMigrationChanged) cloudSync.notifyLocalChange();
    cloudSync.initialize();
  }
})();
