let latestOverviewCopyText='',latestUnpaidCopyText='';
const{createClient}=supabase;
const db=createClient(APP_CONFIG.supabaseUrl,APP_CONFIG.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'class-lunch-user-auth'}});
const legacyDb=db;
let adminGatePassed=localStorage.getItem('class-lunch-admin-gate')==='1';
const $=id=>document.getElementById(id),money=n=>'$'+Number(n||0).toLocaleString('zh-TW');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const defaultCutoffForDate=date=>date?date+'T10:00':'';
function applyDefaultSessionCutoff(force=false){
  const date=$('sessionDate')?.value,cutoff=$('sessionCutoff');
  if(!date||!cutoff)return;
  if(force||!cutoff.value)cutoff.value=defaultCutoffForDate(date);
}
let templates=[],sessions=[],students=[],classes=[],editingTemplateId=null,editingSessionId=null,editingSessionOriginalDate='',editingStudentId=null,editingClassId=null,menuEditorItems=[],originalMenuItemIds=[],editingMenuConfigItemId=null,menuConfigVariants=[],menuConfigGroups=[],menuConfigKeySeed=0,editingMarketOrderId=null,marketOrderItems=[],marketFixedTotal=0,realtimeChannel=null,realtimeTimer=null,currentAdminRole='',selectedAdminClassId='',selectedAdminClassCode='',selectedAdminClassName='',selectedAdminStudentCapacity=0,lastAdminRefreshStartedAt=0;
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600)}
function adminPaymentEaster(paid,amount){
  const value=money(amount);
  return paid?'錢包已成功瘦身 '+value:'便當宇宙仍記得這筆 '+value;
}
function renderAdminNightEgg(){
  const el=$('adminNightEgg');
  if(!el)return;
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
  const active=hour>=0&&hour<5;
  el.textContent=active?'這個時間還在管便當，便當之神會記得你的。':'';
  el.classList.toggle('hidden',!active);
}
async function isAdmin(){
  const{data:{session}}=await db.auth.getSession();
  if(!session?.user)return false;
  const{data:self,error}=await db.from('students')
    .select('seat_number,active,role,class_id')
    .eq('auth_user_id',session.user.id)
    .maybeSingle();
  const ok=!error&&!!self?.active&&['system_admin','class_admin'].includes(String(self.role||''));
  currentAdminRole=ok?String(self.role||''):'';
  return ok;
}
async function hasActiveAdminGate(){
  if(!adminGatePassed)return false;
  const{data,error}=await db.functions.invoke('class-lunch-admin-login',{body:{action:'status'}});
  const active=!error&&data?.ok&&data?.active===true;
  if(!active){
    adminGatePassed=false;
    selectedAdminClassId='';
    selectedAdminClassCode='';
    selectedAdminClassName='';
    localStorage.removeItem('class-lunch-admin-gate');
    localStorage.removeItem('class-lunch-admin-class-selected');
    return false;
  }
  selectedAdminClassId=String(data?.class_id||'');
  selectedAdminClassCode=String(data?.class_code||'');
  return true;
}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const username=$('adminUsername').value.trim(),password=$('password').value;

  const{data:{session}}=await legacyDb.auth.getSession();
  if(!session)return toast('請先回首頁登入管理帳號，再進管理頁');

  const{data:self,error:selfError}=await legacyDb.from('students')
    .select('seat_number,active,role,class_id')
    .eq('auth_user_id',session.user.id)
    .maybeSingle();
  if(selfError||!self||!self.active||!['system_admin','class_admin'].includes(String(self.role||'')))return toast('此帳號沒有管理權限');
  currentAdminRole=String(self.role||'');

  const{data,error}=await db.functions.invoke('class-lunch-admin-login',{body:{username,password}});
  if(error||data?.error){
    adminGatePassed=false;
    return toast('管理帳號或密碼錯誤');
  }

  adminGatePassed=true;
  localStorage.setItem('class-lunch-admin-gate','1');
  $('password').value='';
  selectedAdminClassId=String(data?.class_id||'');
  selectedAdminClassCode=String(data?.class_code||'');
  if(currentAdminRole==='system_admin'){
    localStorage.removeItem('class-lunch-admin-class-selected');
    await showAdminClassPicker(true);
  }else{
    await refresh();
  }
});
$('logoutBtn')?.addEventListener('click',async()=>{
  try{await db.functions.invoke('class-lunch-admin-login',{body:{action:'logout'}})}catch{}
  adminGatePassed=false;
  localStorage.removeItem('class-lunch-admin-gate');
  localStorage.removeItem('class-lunch-admin-class-selected');
  await db.auth.signOut({scope:'local'});
  refresh();
});

function renderAdminClassPicker(){
  const activeClasses=(classes||[]).filter(c=>c.active!==false);
  const select=$('adminClassSelect');
  if(!select)return;
  select.innerHTML=activeClasses.map(c=>'<option value="'+esc(c.code)+'">'+esc(c.code+'｜'+(c.name||c.code+'班'))+'</option>').join('');
  if(activeClasses.some(c=>String(c.code)==='99'))select.value='99';
  else if(activeClasses.length)select.value=String(activeClasses[0].code);
}
async function showAdminClassPicker(forceReload=false){
  if(currentAdminRole!=='system_admin')return;
  stopAdminRealtime();
  $('loginBox').classList.add('hidden');
  $('adminApp').classList.add('hidden');
  $('adminClassPickerBox').classList.remove('hidden');
  $('loginStatus').textContent='請選擇管理班級';
  if(forceReload||!classes.length){
    const{data,error}=await db.from('classes').select('id,code,name,active,student_capacity').eq('active',true).order('code');
    if(error)return toast('班級清單讀取失敗');
    classes=data||[];
  }
  renderAdminClassPicker();
}
async function enterSelectedAdminClass(){
  $('loginBox').classList.add('hidden');
  $('adminClassPickerBox').classList.add('hidden');
  $('adminApp').classList.remove('hidden');
  $('loginStatus').textContent='已登入管理者';

  const classesTab=$('classesTabBtn');
  if(classesTab)classesTab.classList.remove('hidden');
  const switchBtn=$('switchAdminClassBtn');
  if(switchBtn)switchBtn.classList.toggle('hidden',currentAdminRole!=='system_admin');
  const classLabel=$('currentAdminClassLabel');
  if(classLabel)classLabel.textContent=selectedAdminClassCode?selectedAdminClassCode+'班':'目前班級';

  const managementTabs=document.querySelector('[data-admin-subgroup="management"]');
  if(managementTabs)managementTabs.style.gridTemplateColumns='repeat(5,minmax(0,1fr))';
  configureClassManagementPanels();

  $('sessionDate').value=today();
  if($('backupDate')&&!$('backupDate').value)$('backupDate').value=today();
  applyDefaultSessionCutoff(true);

  const jobs=[loadSessions(),loadStudents()];
  if(!templates.length)jobs.push(loadTemplates());
  await Promise.all(jobs);

  renderTemplateSelect();
  renderSessionList();
  renderStudentList();
  renderOverviewSelect();

  startAdminRealtime();

  const activeTab=document.querySelector('.tab[data-tab].active')?.dataset?.tab;
  if(activeTab){
    if(['unpaid','history','logs','changes','backups','classes','wallet-balances','wallet-debts','wallet-topups','wallet-settlements','wallet-ledger'].includes(activeTab)){
      document.querySelector('.tab[data-tab="'+activeTab+'"]')?.click();
    }
  }
}
$('adminClassPickerForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const code=String($('adminClassSelect').value||'').trim();
  if(!code)return;
  const btn=e.submitter;
  if(btn){btn.disabled=true;btn.textContent='切換中…';}
  try{
    const{data,error}=await db.rpc('class_lunch_admin_select_class',{p_class_code:code});
    if(error||data?.error)return toast('班級切換失敗，請重新整理後再試');
    selectedAdminClassId=String(data.class_id||'');
    selectedAdminClassCode=String(data.class_code||code);
    selectedAdminClassName=String(data.class_name||'');
    const selectedMeta=classes.find(x=>String(x.code)===selectedAdminClassCode);
    selectedAdminStudentCapacity=Number(selectedMeta?.student_capacity||0);
    localStorage.setItem('class-lunch-admin-class-selected','1');
    await enterSelectedAdminClass();
  }finally{
    if(btn){btn.disabled=false;btn.textContent='進入班級管理';}
  }
});
$('switchAdminClassBtn')?.addEventListener('click',()=>{
  localStorage.removeItem('class-lunch-admin-class-selected');
  showAdminClassPicker(false);
});

$('testSeat99PushBtn')?.addEventListener('click',async()=>{
  const btn=$('testSeat99PushBtn');
  btn.disabled=true;
  btn.textContent='發送中…';
  try{
    const{data:{session}}=await db.auth.getSession();
    if(!session?.access_token){
      toast('99 登入狀態已失效，請重新登入');
      return;
    }

    const response=await fetch(APP_CONFIG.supabaseUrl+'/functions/v1/class-lunch-push',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey':APP_CONFIG.publishableKey,
        'Authorization':'Bearer '+session.access_token
      },
      body:JSON.stringify({action:'test_seat99'})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.error){
      const reason=data?.error||('HTTP '+response.status);
      return toast('測試通知失敗：'+reason);
    }
    if(data?.skipped)return toast('沒有可用的 99 推播裝置');
    toast('已送出 '+Number(data?.sent||0)+' 則 99 測試通知');
  }catch(error){
    toast('測試通知失敗：'+String(error?.message||error));
  }finally{
    btn.disabled=false;
    btn.textContent='發送 99 測試通知';
  }
});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));

async function openAdminTab(tab){
  const button=document.querySelector('.tab[data-tab="'+tab+'"]');
  if(!button)return;
  document.querySelectorAll('.tab[data-tab]').forEach(x=>x.classList.toggle('active',x===button));
  document.querySelectorAll('.tab-page').forEach(p=>p.classList.add('hidden'));
  $('tab-'+tab)?.classList.remove('hidden');
  if(tab==='logs')await loadLogs();
  if(tab==='changes')await loadOrderChanges();
  if(tab==='history')await loadHistoryOrders();
  if(tab==='backups')await loadBackups();
  if(tab==='unpaid')await loadUnpaidOrders();
  if(tab==='classes')await loadClassManagement();
}

document.querySelectorAll('.tab[data-tab]').forEach(b=>b.addEventListener('click',()=>openAdminTab(b.dataset.tab)));

document.querySelectorAll('[data-admin-group]').forEach(b=>b.addEventListener('click',async()=>{
  const group=b.dataset.adminGroup;
  document.querySelectorAll('[data-admin-group]').forEach(x=>x.classList.toggle('active',x===b));
  document.querySelectorAll('[data-admin-subgroup]').forEach(x=>x.classList.toggle('hidden',x.dataset.adminSubgroup!==group));
  await openAdminTab(group==='orders'?'overview':group==='management'?'students':'wallet-balances');
}));

function scopeAdminClass(query){
  return selectedAdminClassId?query.eq('class_id',selectedAdminClassId):query;
}
async function refresh(){
  lastAdminRefreshStartedAt=Date.now();
  const adminIdentity=await isAdmin();
  const gateActive=adminIdentity?await hasActiveAdminGate():false;
  const ok=adminIdentity&&gateActive;
  const pickerNeeded=ok&&currentAdminRole==='system_admin'&&localStorage.getItem('class-lunch-admin-class-selected')!=='1';
  $('loginBox').classList.toggle('hidden',ok);
  $('adminClassPickerBox')?.classList.toggle('hidden',!pickerNeeded);
  $('adminApp').classList.toggle('hidden',!ok||pickerNeeded);
  $('loginStatus').textContent=!ok
    ?(adminIdentity?'管理身分已登入，請輸入管理帳密。':'請先在首頁登入管理帳號。')
    :pickerNeeded?'請選擇管理班級'
    :'已登入管理者';
  if(!ok){stopAdminRealtime();return}
  if(pickerNeeded){stopAdminRealtime();await showAdminClassPicker();return}

  const classesTab=$('classesTabBtn');
  if(classesTab)classesTab.classList.remove('hidden');
  const switchBtn=$('switchAdminClassBtn');
  if(switchBtn)switchBtn.classList.toggle('hidden',currentAdminRole!=='system_admin');
  const classLabel=$('currentAdminClassLabel');
  if(classLabel)classLabel.textContent=selectedAdminClassCode
    ?selectedAdminClassCode+'班'
    :'目前班級';
  const managementTabs=document.querySelector('[data-admin-subgroup="management"]');
  if(managementTabs)managementTabs.style.gridTemplateColumns='repeat(5,minmax(0,1fr))';
  configureClassManagementPanels();
  startAdminRealtime();
  $('sessionDate').value=today();
  if($('backupDate')&&!$('backupDate').value)$('backupDate').value=today();
  applyDefaultSessionCutoff(true);
  await Promise.all([loadTemplates(),loadSessions(),loadStudents()]);
  renderTemplateSelect();renderSessionList();renderStudentList();renderOverviewSelect();
}
