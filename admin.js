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
async function loadTemplates(){
  const{data,error}=await db.from('menu_templates').select('*').order('created_at',{ascending:false});
  if(error)return toast(error.message);
  templates=data||[];$('templateCount').textContent=templates.length+' 份';renderTemplateList();
}
async function loadSessions(){
  let q=db.from('meal_sessions').select('*,menu_templates(name,image_url)');
  q=scopeAdminClass(q);
  const{data,error}=await q.order('meal_date',{ascending:false}).order('created_at',{ascending:false});
  if(error)return toast(error.message);
  sessions=data||[];renderSessionList();renderOverviewSelect();
  if(!$('tab-history')?.classList.contains('hidden'))loadHistoryOrders();
}
async function loadStudents(){
  let q=db.from('students').select('id,auth_user_id,seat_number,name,active,must_setup,role,class_id,created_at');
  if(selectedAdminClassCode==='99'&&currentAdminRole==='system_admin'){
    q=q.or('class_id.eq.'+selectedAdminClassId+',role.eq.system_admin');
  }else{
    q=scopeAdminClass(q);
  }
  const{data,error}=await q.order('seat_number');
  if(error)return toast(error.message);
  students=data||[];renderStudentList();
  if(!$('tab-classes')?.classList.contains('hidden'))renderClassRosterManagement();
}
async function callClassManager(body){
  const{data,error}=await db.functions.invoke('class-lunch-classes',{body});
  let payload=data||null;
  if(!payload&&error?.context){
    try{payload=await error.context.clone().json()}catch{}
  }
  if(error||payload?.error){
    const code=String(payload?.error||'class_management_failed');
    const map={
      unauthorized:'登入狀態已失效，請重新登入 99',
      system_admin_required:'只有 99 可以管理班級',
      admin_session_required:'管理驗證已失效，請重新輸入管理帳密',
      class_exists:'此班級已存在',
      invalid_class_code:'班級代碼不正確，或與學生座號／99 衝突',
      invalid_student_count:'學生人數必須介於 1～98；99 號保留給系統管理員',
      invalid_class_name:'班級名稱不正確',
      invalid_admin_gate_credentials:'班級管理頁帳號或密碼格式不正確',
      invalid_gate_username:'班級管理頁帳號格式不正確',
      invalid_gate_password:'班級管理頁密碼至少需要 4 碼',
      invalid_password:'班級管理員主登入密碼至少需要 4 碼',
      class_not_found:'找不到這個班級',
      class_admin_not_found:'找不到這個班級的管理員帳號',
      class_create_failed:'班級建立失敗，請檢查班級代碼與學生人數後再試',
      class_update_failed:'班級設定儲存失敗，請重新整理後再試',
      password_reset_failed:'班級管理員密碼重設失敗，請稍後再試',
      admin_account_create_failed:'班級管理員帳號建立失敗，請稍後再試',
      admin_account_bind_failed:'班級管理員帳號綁定失敗，請稍後再試',
      list_users_failed:'帳號資料讀取失敗，請稍後再試',
      server_config_error:'伺服器設定異常，請稍後再試',
      class_management_failed:'班級管理暫時無法使用，請重新整理後再試'
    };
    throw new Error(map[code]||'班級管理操作失敗，請重新整理後再試');
  }
  return payload;
}
function configureClassManagementPanels(){
  const globalTools=currentAdminRole==='system_admin'&&selectedAdminClassCode==='99';
  $('systemClassCreatePanel')?.classList.toggle('hidden',!globalTools);
  $('systemClassListPanel')?.classList.toggle('hidden',!globalTools);
}
function renderClassRosterManagement(){
  const activeSeats=students
    .filter(s=>s.role==='student'&&s.active)
    .map(s=>Number(s.seat_number))
    .filter(Number.isInteger)
    .sort((a,b)=>a-b);
  selectedAdminStudentCapacity=activeSeats.length;
  const box=$('classRosterSeats');
  if(box){
    box.innerHTML=activeSeats.length
      ?activeSeats.map(seat=>'<button class="small-btn" type="button" data-roster-seat="'+seat+'">'+seat+'號</button>').join('')
      :'<span class="hint">目前沒有啟用中的學生座號</span>';
    box.querySelectorAll('[data-roster-seat]').forEach(btn=>btn.addEventListener('click',()=>{
      if($('classRosterSeat'))$('classRosterSeat').value=String(btn.dataset.rosterSeat||'');
    }));
  }
  if($('classRosterHint'))$('classRosterHint').textContent=
    selectedAdminClassCode+'班目前 '+activeSeats.length+' 位學生；座號：'+(activeSeats.join('、')||'無')+'。移除座號只會停用帳號，歷史訂單、錢包與金流保留。';
}
async function loadClassManagement(){
  configureClassManagementPanels();
  if(!selectedAdminClassId)return;
  if(!students.length)await loadStudents();
  renderClassRosterManagement();
  if(currentAdminRole==='system_admin'&&selectedAdminClassCode==='99')await loadClasses();
}
async function addSelectedClassSeat(seat){
  const n=Number(seat);
  if(!Number.isInteger(n)||n<1||n>98)return toast('學生座號必須介於 1～98；99 號保留給系統管理員');
  const{data,error}=await db.rpc('class_lunch_admin_add_student_seat',{p_seat_number:n});
  if(error||data?.error)return toast('新增座號失敗：'+(error?.message||data?.error||'未知錯誤'));
  await loadStudents();
  renderClassRosterManagement();
  renderOverviewSelect();
  if($('classRosterSeat'))$('classRosterSeat').value='';
  toast(n+'號已加入目前班級');
}
async function removeSelectedClassSeat(seat){
  const n=Number(seat);
  if(!Number.isInteger(n)||n<1||n>98)return toast('學生座號必須介於 1～98；99 號保留給系統管理員');
  const target=students.find(s=>s.role==='student'&&s.active&&Number(s.seat_number)===n);
  if(!target)return toast(n+'號目前沒有在使用');
  if(!confirm('確定移除 '+n+' 號？\n帳號會停用，但歷史訂單、錢包與金流會保留。'))return;
  const{data,error}=await db.rpc('class_lunch_admin_remove_student_seat',{p_seat_number:n});
  if(error||data?.error)return toast('移除座號失敗：'+(error?.message||data?.error||'未知錯誤'));
  await loadStudents();
  renderClassRosterManagement();
  renderOverviewSelect();
  if($('classRosterSeat'))$('classRosterSeat').value='';
  toast(n+'號已從目前班級移除');
}
$('classRosterForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=e.submitter;if(btn){btn.disabled=true;btn.textContent='處理中…';}
  try{await addSelectedClassSeat($('classRosterSeat').value)}
  finally{if(btn){btn.disabled=false;btn.textContent='新增／恢復座號';}}
});
$('removeClassRosterSeatBtn')?.addEventListener('click',async()=>{
  const btn=$('removeClassRosterSeatBtn');btn.disabled=true;btn.textContent='處理中…';
  try{await removeSelectedClassSeat($('classRosterSeat').value)}
  finally{btn.disabled=false;btn.textContent='移除座號';}
});

async function loadClasses(){
  if(currentAdminRole!=='system_admin')return;
  const data=await callClassManager({action:'list'}).catch(error=>{toast(error.message);return null});
  if(!data)return;
  classes=data.classes||[];
  renderClassList();
}
function renderClassList(){
  const el=$('classList');if(!el)return;
  $('classCount').textContent=classes.length+' 班';
  el.innerHTML=classes.map(c=>{
    const admin=c.class_admin||null;
    const status=c.active?'啟用中':'已停用';
    const adminText=admin
      ?' · 班管 '+esc(String(admin.seat_number))+' · '+(admin.auth_bound?'班管已建立 Auth':'班管尚未首次登入')
      :' · 無班管';
    return '<div class="student-row">'+
      '<span class="seat-badge">'+esc(c.code)+'</span>'+
      '<div><b>'+esc(c.name||c.code+'班')+'</b><br>'+
      '<span class="hint">啟用學生 '+Number(c.student_count||0)+' 人 · '+status+
      adminText+
      ' · 管理頁 '+esc(c.admin_gate_username||'—')+'</span></div>'+
      '<div class="actions"><button class="small-btn" type="button" onclick="openClassDialog(\''+c.id+'\')">編輯</button></div>'+
    '</div>';
  }).join('')||'<div class="loading">尚無班級</div>';
}
function syncClassCreateDefaults(){
  const code=String($('classCode')?.value||'').trim();
  if(!code)return;
  if(!$('className').value.trim())$('className').placeholder='留空自動使用「'+code+'班」';
  if(!$('classGateUsername').value.trim())$('classGateUsername').placeholder='留空自動使用 tnfsh'+code;
  if(!$('classGatePassword').value)$('classGatePassword').placeholder='留空自動使用 tnfsh'+code;
}
$('classCode')?.addEventListener('input',syncClassCreateDefaults);
$('classCreateForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(currentAdminRole!=='system_admin')return toast('只有 99 可以新增班級');
  const code=String($('classCode').value||'').trim();
  const studentCount=Number($('classStudentCount').value);
  if(!/^\d{2,4}$/.test(code))return toast('班級代碼請輸入 2～4 位數字');
  if(!Number.isInteger(studentCount)||studentCount<1||studentCount>98)return toast('學生人數請輸入 1～98；99 號保留給系統管理員');
  if(Number(code)===99||Number(code)<=studentCount)return toast('班級代碼不可與學生座號或 99 衝突');
  const btn=e.submitter; if(btn){btn.disabled=true;btn.textContent='建立中…';}
  try{
    const data=await callClassManager({
      action:'create',
      code,
      student_count:studentCount,
      name:String($('className').value||'').trim()||code+'班',
      gate_username:String($('classGateUsername').value||'').trim()||'tnfsh'+code,
      gate_password:$('classGatePassword').value||'tnfsh'+code
    });
    toast('已建立 '+code+' 班，共 '+studentCount+' 位學生');
    e.target.reset();
    $('classStudentCount').value='35';
    syncClassCreateDefaults();
    await loadClasses();
  }catch(error){toast(error.message)}
  finally{if(btn){btn.disabled=false;btn.textContent='建立班級';}}
});
$('refreshClassesBtn')?.addEventListener('click',loadClasses);
function openClassDialog(id){
  if(currentAdminRole!=='system_admin')return toast('只有 99 可以管理班級');
  const c=classes.find(x=>x.id===id);if(!c)return;
  editingClassId=id;
  $('editClassCode').textContent='班級 '+c.code+' · 學生設定 '+Number(c.student_capacity||0)+' 人';
  $('editClassName').value=c.name||c.code+'班';
  $('editClassActive').checked=!!c.active;
  $('editClassGateUsername').value=c.admin_gate_username||'tnfsh'+c.code;
  $('editClassGatePassword').value='';
  $('editClassAdminPassword').value='';
  const admin=c.class_admin||null;
  const info=$('editClassAccountInfo');
  const passwordField=$('editClassAdminPassword')?.closest('label');
  const resetBtn=$('resetClassAdminPasswordBtn');
  if(info){
    info.classList.toggle('hidden',!admin);
    info.textContent=admin?'班管主登入：'+c.code+' / '+String(admin.seat_number)+'；'+(admin.auth_bound?'Auth 已建立':'尚未首次登入'):'';
  }
  if(passwordField)passwordField.classList.toggle('hidden',!admin);
  if(resetBtn)resetBtn.classList.toggle('hidden',!admin);
  $('classDialog').showModal();
}
$('classEditForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const c=classes.find(x=>x.id===editingClassId);if(!c)return;
  const btn=e.submitter;if(btn){btn.disabled=true;btn.textContent='儲存中…';}
  try{
    const data=await callClassManager({
      action:'update',
      class_id:c.id,
      name:$('editClassName').value.trim(),
      active:$('editClassActive').checked,
      gate_username:$('editClassGateUsername').value.trim(),
      gate_password:$('editClassGatePassword').value
    });
    classes=data.classes||classes;
    renderClassList();
    $('classDialog').close();
    toast('班級設定已更新');
  }catch(error){toast(error.message)}
  finally{if(btn){btn.disabled=false;btn.textContent='儲存班級';}}
});
$('resetClassAdminPasswordBtn')?.addEventListener('click',async()=>{
  const c=classes.find(x=>x.id===editingClassId);if(!c)return;
  const btn=$('resetClassAdminPasswordBtn');btn.disabled=true;btn.textContent='重設中…';
  try{
    const password=$('editClassAdminPassword').value;
    await callClassManager({action:'reset_admin_password',class_id:c.id,password});
    $('editClassAdminPassword').value='';
    toast(password?'班管主登入密碼已重設':'班管主登入密碼已恢復預設');
    await loadClasses();
    openClassDialog(c.id);
  }catch(error){toast(error.message)}
  finally{btn.disabled=false;btn.textContent='重設班管主登入密碼';}
});
$('resetClassGateBtn')?.addEventListener('click',async()=>{
  const c=classes.find(x=>x.id===editingClassId);if(!c)return;
  const btn=$('resetClassGateBtn');btn.disabled=true;btn.textContent='恢復中…';
  try{
    const data=await callClassManager({action:'update',class_id:c.id,reset_gate_default:true});
    classes=data.classes||classes;
    renderClassList();
    openClassDialog(c.id);
    toast('管理頁帳密已恢復預設');
  }catch(error){toast(error.message)}
  finally{btn.disabled=false;btn.textContent='管理頁帳密恢復預設';}
});

function renderTemplateSelect(){
  $('sessionTemplate').innerHTML=templates.filter(t=>t.active).map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('');
  $('editSessionTemplate').innerHTML=templates.map(t=>'<option value="'+t.id+'">'+esc(t.name)+(t.active?'':'（停用）')+'</option>').join('');
}
function renderTemplateList(){$('templateList').innerHTML=templates.map(t=>'<div class="admin-item">'+(t.image_url?'<img src="'+esc(t.image_url)+'" alt="">':'<div></div>')+'<div><b>'+esc(t.name)+'</b><br><span class="hint">'+(t.active?'使用中':'已停用')+'</span></div><div class="actions"><button class="small-btn" onclick="openTemplateDialog('+t.id+')">編輯</button></div></div>').join('')||'<div class="loading">尚無菜單</div>'}
function renderSessionList(){
  const current=sessions.filter(s=>s.meal_date>=today()).sort((a,b)=>a.meal_date.localeCompare(b.meal_date)||Number(a.id)-Number(b.id));
  $('sessionCount').textContent=current.length+' 個';
  $('sessionList').innerHTML=current.map(s=>'<div class="admin-item">'+(s.menu_templates?.image_url?'<img src="'+esc(s.menu_templates.image_url)+'" alt="">':'<div></div>')+'<div><b>'+esc(s.menu_templates?.name||'菜單')+'</b><br>'+esc(s.meal_date)+(s.cutoff_at?' · 截止 '+esc(new Date(s.cutoff_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):'')+'<br><span class="hint">'+(s.is_active?'開放':'關閉')+'</span></div><div class="actions"><button class="small-btn" onclick="openSessionDialog('+s.id+')">編輯</button></div></div>').join('')||'<div class="loading">今天起沒有訂餐日期</div>';
}
function renderStudentList(){
  const visible=students.filter(s=>{
    if(s.role==='system_admin')return selectedAdminClassCode==='99'&&currentAdminRole==='system_admin';
    return currentAdminRole==='system_admin'||s.role!=='class_admin';
  });
  $('studentCount').textContent=visible.length+' 人';
  $('studentList').innerHTML=visible.map(s=>{
    const canEdit=s.role!=='system_admin'&&(currentAdminRole==='system_admin'||s.role!=='class_admin');
    const roleLabel=s.role==='teacher'?'老師':s.role==='class_admin'?'班級管理員':s.role==='system_admin'?'系統管理員':'學生';
    return '<div class="student-row"><span class="seat-badge">'+s.seat_number+'號</span><div><b>'+esc(s.name||'尚未設定姓名')+'</b><br><span class="hint">'+roleLabel+' · '+(s.auth_user_id?'帳號已建立':'尚未初始化')+' · '+(s.active?'啟用中':'已停用')+(s.must_setup?' · 待首次設定':'')+'</span></div><div class="actions">'+(canEdit?'<button class="small-btn" onclick="openStudentDialog(\''+s.id+'\')">編輯</button>':'')+'</div></div>';
  }).join('')||'<div class="loading">尚無學生</div>';
}
$('templateForm').addEventListener('submit',async e=>{
  e.preventDefault();const f=$('templateImage').files[0],name=$('templateName').value.trim();if(!f||!name)return;if(f.size>12*1024*1024)return toast('圖片請小於 12MB');
  const url=await uploadMenuImage(f);if(!url)return;
  const{error}=await db.from('menu_templates').insert({name,image_url:url,active:true});
  if(error){await removeMenuImageUrl(url);return toast(error.message)}
  e.target.reset();toast('菜單已存入');await loadTemplates();renderTemplateSelect();
});
async function compressMenuImage(file){
  if(!file||!String(file.type||'').startsWith('image/'))return {blob:file,ext:(file?.name?.split('.').pop()||'jpg').toLowerCase(),contentType:file?.type||'image/jpeg'};
  if(file.type==='image/gif'||file.type==='image/svg+xml')return {blob:file,ext:(file.name.split('.').pop()||'jpg').toLowerCase(),contentType:file.type};

  let source=null,revokeUrl='';
  try{
    if('createImageBitmap' in window){
      source=await createImageBitmap(file);
    }else{
      const url=URL.createObjectURL(file);revokeUrl=url;
      source=await new Promise((resolve,reject)=>{
        const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url;
      });
    }

    const width=Number(source.width||source.naturalWidth||0),height=Number(source.height||source.naturalHeight||0);
    if(!width||!height)return {blob:file,ext:(file.name.split('.').pop()||'jpg').toLowerCase(),contentType:file.type||'image/jpeg'};

    const maxEdge=2000;
    const scale=Math.min(1,maxEdge/Math.max(width,height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));
    canvas.height=Math.max(1,Math.round(height*scale));
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)return {blob:file,ext:(file.name.split('.').pop()||'jpg').toLowerCase(),contentType:file.type||'image/jpeg'};
    ctx.drawImage(source,0,0,canvas.width,canvas.height);

    const makeBlob=(type,quality)=>new Promise(resolve=>canvas.toBlob(resolve,type,quality));
    let blob=await makeBlob('image/webp',0.82);
    let ext='webp',contentType='image/webp';
    if(!blob){
      blob=await makeBlob('image/jpeg',0.84);
      ext='jpg';contentType='image/jpeg';
    }
    if(!blob)return {blob:file,ext:(file.name.split('.').pop()||'jpg').toLowerCase(),contentType:file.type||'image/jpeg'};

    if(scale===1&&blob.size>=file.size){
      return {blob:file,ext:(file.name.split('.').pop()||'jpg').toLowerCase(),contentType:file.type||'image/jpeg'};
    }
    return {blob,ext,contentType};
  }finally{
    try{source?.close?.()}catch{}
    if(revokeUrl)URL.revokeObjectURL(revokeUrl);
  }
}
async function uploadMenuImage(f){
  const compressed=await compressMenuImage(f);
  const path='templates/'+crypto.randomUUID()+'.'+compressed.ext;
  const{error}=await db.storage.from('menu-images').upload(path,compressed.blob,{
    contentType:compressed.contentType,
    cacheControl:'31536000',
    upsert:false
  });
  if(error){toast('圖片上傳失敗：'+error.message);return null}
  return db.storage.from('menu-images').getPublicUrl(path).data.publicUrl;
}
function menuImageStoragePath(url){
  if(!url)return '';
  try{
    const u=new URL(url);
    const marker='/storage/v1/object/public/menu-images/';
    const pos=u.pathname.indexOf(marker);
    return pos>=0?decodeURIComponent(u.pathname.slice(pos+marker.length)):'';
  }catch{return ''}
}
async function removeMenuImageUrl(url){
  const storagePath=menuImageStoragePath(url);
  if(!storagePath)return false;
  const{error}=await db.storage.from('menu-images').remove([storagePath]);
  if(error){console.warn('menu_image_cleanup_failed',error);return false}
  return true;
}
async function openTemplateDialog(id){
  const t=templates.find(x=>x.id===id);if(!t)return;
  editingTemplateId=id;
  $('editTemplateName').value=t.name;$('editTemplateActive').checked=t.active;$('editTemplateImage').value='';$('ocrRawText').value='';$('ocrProgress').textContent='';
  const{data,error}=await db.from('menu_items').select('id,category,name,price,is_market_price,active,sort_order').eq('menu_template_id',id).order('sort_order').order('id');
  if(error)return toast('讀取品項失敗：'+error.message);
  menuEditorItems=(data||[]).map(x=>({...x}));
  originalMenuItemIds=(data||[]).map(x=>x.id);
  renderMenuItemEditor();
  $('templateDialog').showModal();
}
function renderMenuItemEditor(){
  $('menuItemEditor').innerHTML=menuEditorItems.length?menuEditorItems.map((x,i)=>
    '<div class="menu-item-row">'+
    '<input data-k="category" data-i="'+i+'" value="'+esc(x.category||'')+'" placeholder="分類">'+
    '<input data-k="name" data-i="'+i+'" value="'+esc(x.name||'')+'" placeholder="品項名稱">'+
    '<input data-k="price" data-i="'+i+'" type="number" min="0" max="10000" value="'+Number(x.price||0)+'" placeholder="'+(x.is_market_price?'時價':'價格')+'" '+(x.is_market_price?'disabled':'')+'>'+
    '<label class="mini-check"><input data-k="is_market_price" data-i="'+i+'" type="checkbox" '+(x.is_market_price?'checked':'')+'>時價</label>'+
    '<label class="mini-check"><input data-k="active" data-i="'+i+'" type="checkbox" '+(x.active!==false?'checked':'')+'>啟用</label>'+
    '<button type="button" class="small-btn combo-config-btn" onclick="openMenuConfigDialogByIndex('+i+')" '+(x.id?'':'disabled title="先儲存品項再設定"')+'>組合設定</button>'+
    '<button type="button" class="small-btn danger" onclick="removeMenuItemRow('+i+')">刪除</button>'+
    '</div>'
  ).join(''):'<div class="hint">尚無品項，可按「辨識菜單」或手動新增。</div>';
  $('menuItemEditor').querySelectorAll('input[data-i]').forEach(el=>el.addEventListener('input',syncMenuEditorInput));
}
function syncMenuEditorInput(e){
  const i=Number(e.target.dataset.i),k=e.target.dataset.k;if(!menuEditorItems[i])return;
  menuEditorItems[i][k]=k==='price'?Number(e.target.value||0):(k==='active'||k==='is_market_price')?e.target.checked:e.target.value;
  if(k==='is_market_price'){if(e.target.checked)menuEditorItems[i].price=0;renderMenuItemEditor()}
}
function removeMenuItemRow(i){menuEditorItems.splice(i,1);renderMenuItemEditor()}
$('addMenuItemRowBtn').addEventListener('click',()=>{menuEditorItems.push({category:'',name:'',price:0,is_market_price:false,active:true,sort_order:menuEditorItems.length});renderMenuItemEditor()});


function nextMenuConfigKey(prefix){
  menuConfigKeySeed+=1;
  return prefix+'-tmp-'+menuConfigKeySeed;
}
async function openMenuConfigDialogByIndex(i){
  const item=menuEditorItems[Number(i)];
  if(!item?.id)return toast('請先儲存這個品項，再設定組合');
  editingMenuConfigItemId=Number(item.id);
  $('menuConfigItemName').textContent=item.name||'品項';

  const [vr,gr]=await Promise.all([
    db.from('menu_item_variants')
      .select('id,menu_item_id,name,price_delta,is_default,active,sort_order')
      .eq('menu_item_id',editingMenuConfigItemId).order('sort_order').order('id'),
    db.from('menu_option_groups')
      .select('id,menu_item_id,variant_id,name,min_select,max_select,active,sort_order')
      .eq('menu_item_id',editingMenuConfigItemId).order('sort_order').order('id')
  ]);
  if(vr.error)return toast('讀取點餐方式失敗：'+vr.error.message);
  if(gr.error)return toast('讀取選項群組失敗：'+gr.error.message);

  menuConfigVariants=(vr.data||[]).map(v=>({...v,_key:'v-'+v.id,_deleted:false}));
  const groups=gr.data||[];
  let choices=[];
  if(groups.length){
    const cr=await db.from('menu_option_choices')
      .select('id,group_id,name,price_delta,is_default,active,sort_order')
      .in('group_id',groups.map(g=>g.id)).order('sort_order').order('id');
    if(cr.error)return toast('讀取加購選項失敗：'+cr.error.message);
    choices=cr.data||[];
  }
  menuConfigGroups=groups.map(g=>({
    ...g,
    _key:'g-'+g.id,
    _variantKey:g.variant_id==null?'':('v-'+g.variant_id),
    _deleted:false,
    choices:choices.filter(ch=>Number(ch.group_id)===Number(g.id)).map(ch=>({...ch,_key:'c-'+ch.id,_deleted:false}))
  }));
  renderMenuConfigEditor();
  $('menuConfigDialog').showModal();
}
function renderMenuConfigEditor(){
  const visibleVariants=menuConfigVariants.filter(v=>!v._deleted);
  $('menuVariantEditor').innerHTML=visibleVariants.length?menuConfigVariants.map((v,i)=>v._deleted?'':(
    '<div class="combo-admin-row variant-row">'+
      '<input value="'+esc(v.name||'')+'" placeholder="例如：單點 / 套餐 / 大杯" oninput="setMenuVariantField('+i+',\'name\',this)">'+
      '<label>加價<input type="number" min="-10000" max="10000" value="'+Number(v.price_delta||0)+'" oninput="setMenuVariantField('+i+',\'price_delta\',this)"></label>'+
      '<label class="mini-check"><input type="checkbox" '+(v.is_default?'checked':'')+' onchange="setMenuVariantField('+i+',\'is_default\',this)">預設</label>'+
      '<label class="mini-check"><input type="checkbox" '+(v.active!==false?'checked':'')+' onchange="setMenuVariantField('+i+',\'active\',this)">啟用</label>'+
      '<button class="small-btn danger" type="button" onclick="removeMenuVariant('+i+')">移除</button>'+
    '</div>'
  )).join(''):'<div class="hint">沒有點餐方式＝直接使用品項原價。需要「單點 / 套餐」或尺寸時再新增。</div>';

  const variantOptions='<option value="">所有點餐方式都顯示</option>'+
    visibleVariants.map(v=>'<option value="'+esc(v._key)+'">'+esc(v.name||'未命名方式')+'</option>').join('');

  $('menuOptionGroupEditor').innerHTML=menuConfigGroups.length?menuConfigGroups.map((g,gi)=>{
    if(g._deleted)return '';
    const choiceRows=(g.choices||[]).map((ch,ci)=>ch._deleted?'':(
      '<div class="combo-choice-admin-row">'+
        '<input value="'+esc(ch.name||'')+'" placeholder="選項名稱" oninput="setMenuChoiceField('+gi+','+ci+',\'name\',this)">'+
        '<label>加價<input type="number" min="-10000" max="10000" value="'+Number(ch.price_delta||0)+'" oninput="setMenuChoiceField('+gi+','+ci+',\'price_delta\',this)"></label>'+
        '<label class="mini-check"><input type="checkbox" '+(ch.is_default?'checked':'')+' onchange="setMenuChoiceField('+gi+','+ci+',\'is_default\',this)">預設</label>'+
        '<label class="mini-check"><input type="checkbox" '+(ch.active!==false?'checked':'')+' onchange="setMenuChoiceField('+gi+','+ci+',\'active\',this)">啟用</label>'+
        '<button class="small-btn danger" type="button" onclick="removeMenuChoice('+gi+','+ci+')">移除</button>'+
      '</div>'
    )).join('');
    return '<div class="combo-group-card">'+
      '<div class="combo-group-head">'+
        '<input value="'+esc(g.name||'')+'" placeholder="群組名稱，例如：飲料" oninput="setMenuGroupField('+gi+',\'name\',this)">'+
        '<select onchange="setMenuGroupField('+gi+',\'_variantKey\',this)">'+variantOptions.replace('value="'+esc(g._variantKey)+'"','value="'+esc(g._variantKey)+'" selected')+'</select>'+
        '<label>至少<input type="number" min="0" max="20" value="'+Number(g.min_select||0)+'" oninput="setMenuGroupField('+gi+',\'min_select\',this)"></label>'+
        '<label>最多<input type="number" min="1" max="20" value="'+Number(g.max_select||1)+'" oninput="setMenuGroupField('+gi+',\'max_select\',this)"></label>'+
        '<label class="mini-check"><input type="checkbox" '+(g.active!==false?'checked':'')+' onchange="setMenuGroupField('+gi+',\'active\',this)">啟用</label>'+
        '<button class="small-btn danger" type="button" onclick="removeMenuOptionGroup('+gi+')">移除群組</button>'+
      '</div>'+
      '<div class="combo-choice-admin-list">'+choiceRows+'</div>'+
      '<button class="small-btn" type="button" onclick="addMenuChoice('+gi+')">＋新增選項</button>'+
    '</div>';
  }).join(''):'<div class="hint">尚無選項群組。</div>';
}
function setMenuVariantField(i,key,el){
  const v=menuConfigVariants[Number(i)];if(!v)return;
  v[key]=key==='price_delta'?Number(el.value||0):(key==='is_default'||key==='active')?!!el.checked:el.value;
  if(key==='is_default'&&v.is_default){
    menuConfigVariants.forEach((other,idx)=>{if(idx!==Number(i))other.is_default=false});
    renderMenuConfigEditor();
  }
}
function removeMenuVariant(i){
  const v=menuConfigVariants[Number(i)];if(!v)return;
  v._deleted=true;v.active=false;v.is_default=false;
  menuConfigGroups.forEach(g=>{if(g._variantKey===v._key){g._deleted=true;g.active=false}});
  renderMenuConfigEditor();
}
function setMenuGroupField(i,key,el){
  const g=menuConfigGroups[Number(i)];if(!g)return;
  g[key]=(key==='min_select'||key==='max_select')?Number(el.value||0):key==='active'?!!el.checked:el.value;
}
function removeMenuOptionGroup(i){
  const g=menuConfigGroups[Number(i)];if(!g)return;
  g._deleted=true;g.active=false;
  renderMenuConfigEditor();
}
function setMenuChoiceField(gi,ci,key,el){
  const ch=menuConfigGroups[Number(gi)]?.choices?.[Number(ci)];if(!ch)return;
  ch[key]=key==='price_delta'?Number(el.value||0):(key==='is_default'||key==='active')?!!el.checked:el.value;
}
function removeMenuChoice(gi,ci){
  const ch=menuConfigGroups[Number(gi)]?.choices?.[Number(ci)];if(!ch)return;
  ch._deleted=true;ch.active=false;ch.is_default=false;
  renderMenuConfigEditor();
}
$('addMenuVariantBtn')?.addEventListener('click',()=>{
  menuConfigVariants.push({
    id:null,menu_item_id:editingMenuConfigItemId,name:'',price_delta:0,is_default:menuConfigVariants.filter(v=>!v._deleted&&v.active!==false).length===0,
    active:true,sort_order:menuConfigVariants.length,_key:nextMenuConfigKey('v'),_deleted:false
  });
  renderMenuConfigEditor();
});
$('addMenuOptionGroupBtn')?.addEventListener('click',()=>{
  menuConfigGroups.push({
    id:null,menu_item_id:editingMenuConfigItemId,variant_id:null,name:'',min_select:0,max_select:1,active:true,sort_order:menuConfigGroups.length,
    _key:nextMenuConfigKey('g'),_variantKey:'',_deleted:false,choices:[]
  });
  renderMenuConfigEditor();
});
function addMenuChoice(gi){
  const g=menuConfigGroups[Number(gi)];if(!g)return;
  g.choices=g.choices||[];
  g.choices.push({
    id:null,group_id:g.id||null,name:'',price_delta:0,is_default:false,active:true,sort_order:g.choices.length,
    _key:nextMenuConfigKey('c'),_deleted:false
  });
  renderMenuConfigEditor();
}
$('menuConfigForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!editingMenuConfigItemId)return;
  const activeVariants=menuConfigVariants.filter(v=>!v._deleted&&v.active!==false);
  if(activeVariants.some(v=>!String(v.name||'').trim()))return toast('點餐方式名稱不能空白');
  if(activeVariants.filter(v=>v.is_default).length>1)return toast('點餐方式只能有一個預設');
  if(menuConfigVariants.some(v=>!Number.isInteger(Number(v.price_delta))||Number(v.price_delta)<-10000||Number(v.price_delta)>10000))return toast('點餐方式加價格式不正確');

  for(const g of menuConfigGroups.filter(g=>!g._deleted&&g.active!==false)){
    if(!String(g.name||'').trim())return toast('選項群組名稱不能空白');
    if(!Number.isInteger(Number(g.min_select))||!Number.isInteger(Number(g.max_select))||Number(g.min_select)<0||Number(g.max_select)<1||Number(g.min_select)>Number(g.max_select)||Number(g.max_select)>20)return toast('選項群組的必選數量設定不正確');
    if(g._variantKey&&!activeVariants.some(v=>v._key===g._variantKey))return toast('選項群組指定了不存在的點餐方式');
    const activeChoices=(g.choices||[]).filter(ch=>!ch._deleted&&ch.active!==false);
    if(activeChoices.length<Number(g.min_select))return toast('「'+g.name+'」啟用中的選項不足');
    if(activeChoices.some(ch=>!String(ch.name||'').trim()))return toast('「'+g.name+'」有未命名選項');
    if(activeChoices.some(ch=>!Number.isInteger(Number(ch.price_delta))||Number(ch.price_delta)<-10000||Number(ch.price_delta)>10000))return toast('「'+g.name+'」有加價格式不正確');
    if(activeChoices.filter(ch=>ch.is_default).length>Number(g.max_select))return toast('「'+g.name+'」預設選項數量不能超過最多可選數');
  }

  const submit=e.submitter; if(submit){submit.disabled=true;submit.textContent='儲存中…'}
  try{
    const clearDefault=await db.from('menu_item_variants').update({is_default:false,updated_at:new Date().toISOString()}).eq('menu_item_id',editingMenuConfigItemId);
    if(clearDefault.error)throw clearDefault.error;

    const keyToVariantId=new Map();
    for(let i=0;i<menuConfigVariants.length;i++){
      const v=menuConfigVariants[i];
      if(v._deleted){
        if(v.id){
          const rr=await db.from('menu_item_variants').update({active:false,is_default:false,updated_at:new Date().toISOString()}).eq('id',v.id);
          if(rr.error)throw rr.error;
        }
        continue;
      }
      const patch={
        menu_item_id:editingMenuConfigItemId,
        name:String(v.name||'').trim(),
        price_delta:Number(v.price_delta||0),
        is_default:!!v.is_default&&v.active!==false,
        active:v.active!==false,
        sort_order:i,
        updated_at:new Date().toISOString()
      };
      if(v.id){
        const rr=await db.from('menu_item_variants').update(patch).eq('id',v.id).select('id').single();
        if(rr.error)throw rr.error;
        keyToVariantId.set(v._key,Number(rr.data.id));
      }else{
        const oldKey=v._key;
        const rr=await db.from('menu_item_variants').insert(patch).select('id').single();
        if(rr.error)throw rr.error;
        v.id=Number(rr.data.id);v._key='v-'+v.id;
        keyToVariantId.set(oldKey,v.id);
        keyToVariantId.set(v._key,v.id);
      }
    }
    for(const v of menuConfigVariants.filter(v=>!v._deleted&&v.id))keyToVariantId.set(v._key,Number(v.id));

    for(let gi=0;gi<menuConfigGroups.length;gi++){
      const g=menuConfigGroups[gi];
      if(g._deleted){
        if(g.id){
          const rr=await db.from('menu_option_groups').update({active:false,updated_at:new Date().toISOString()}).eq('id',g.id);
          if(rr.error)throw rr.error;
          const cr=await db.from('menu_option_choices').update({active:false,updated_at:new Date().toISOString()}).eq('group_id',g.id);
          if(cr.error)throw cr.error;
        }
        continue;
      }
      const variantId=g._variantKey?keyToVariantId.get(g._variantKey):null;
      const patch={
        menu_item_id:editingMenuConfigItemId,
        variant_id:variantId||null,
        name:String(g.name||'').trim(),
        min_select:Number(g.min_select||0),
        max_select:Number(g.max_select||1),
        active:g.active!==false,
        sort_order:gi,
        updated_at:new Date().toISOString()
      };
      let groupId=g.id?Number(g.id):null;
      if(groupId){
        const rr=await db.from('menu_option_groups').update(patch).eq('id',groupId).select('id').single();
        if(rr.error)throw rr.error;
      }else{
        const rr=await db.from('menu_option_groups').insert(patch).select('id').single();
        if(rr.error)throw rr.error;
        groupId=Number(rr.data.id);g.id=groupId;g._key='g-'+groupId;
      }

      for(let ci=0;ci<(g.choices||[]).length;ci++){
        const ch=g.choices[ci];
        if(ch._deleted){
          if(ch.id){
            const rr=await db.from('menu_option_choices').update({active:false,is_default:false,updated_at:new Date().toISOString()}).eq('id',ch.id);
            if(rr.error)throw rr.error;
          }
          continue;
        }
        const chPatch={
          group_id:groupId,
          name:String(ch.name||'').trim(),
          price_delta:Number(ch.price_delta||0),
          is_default:!!ch.is_default&&ch.active!==false,
          active:ch.active!==false,
          sort_order:ci,
          updated_at:new Date().toISOString()
        };
        if(ch.id){
          const rr=await db.from('menu_option_choices').update(chPatch).eq('id',ch.id);
          if(rr.error)throw rr.error;
        }else{
          const rr=await db.from('menu_option_choices').insert(chPatch).select('id').single();
          if(rr.error)throw rr.error;
          ch.id=Number(rr.data.id);ch._key='c-'+ch.id;
        }
      }
    }

    await db.from('menu_templates').update({updated_at:new Date().toISOString()}).eq('id',editingTemplateId);
    const affected=await syncMenuPriceChangesToOrders(editingTemplateId);
    $('menuConfigDialog').close();
    toast(affected?'組合設定已儲存，並重算 '+affected+' 張訂單':'組合設定已儲存');
  }catch(error){
    toast('組合設定儲存失敗：'+(error?.message||error));
  }finally{
    if(submit){submit.disabled=false;submit.textContent='儲存組合設定'}
  }
});

function normalizeOcrLine(line){
  return String(line||'')
    .replace(/[|｜]/g,' ')
    .replace(/[—–_]/g,' ')
    .replace(/[＄$]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}
function parseOcrMenu(text){
  const rows=[],seen=new Set(),lines=String(text||'').split(/\r?\n/).map(normalizeOcrLine).filter(Boolean);
  const ignored=/^(咖哩系列|特餐|鍋燒系列|丼飯|點心|炸物|點心炸物|外帶專用|菜單|樂品屋)$/;
  for(const line of lines){
    const plain=line.replace(/[＊*#◆◇●○•·：:]/g,'').trim();
    if(ignored.test(plain))continue;

    const matches=[...line.matchAll(/(.*?)(?:\s|[.．·…,:：-])+(\d{2,3})(?=\s|元|$)/g)];
    if(!matches.length){
      const m=line.match(/^(.*?)(\d{2,3})\s*(?:元)?$/);
      if(m)matches.push(m);
    }
    for(const m of matches){
      let name=String(m[1]||'').replace(/^[^\u3400-\u9fff]+|[^\u3400-\u9fff0-9()（）+\-]+$/g,'').trim();
      const price=Number(m[2]);
      const han=(name.match(/[\u3400-\u9fff]/g)||[]).length;

      // 菜名至少要有 2 個中文字；排除 OCR 英文亂碼與過長雜訊。
      if(han<2||name.length>22||price<20||price>500)continue;
      if(/[A-Za-z]/.test(name))continue;

      const key=name+'|'+price;
      if(seen.has(key))continue;
      seen.add(key);
      rows.push({category:'',name,price,active:true,sort_order:rows.length});
    }
  }
  return rows;
}
async function loadOcrImage(url){
  return await new Promise((resolve,reject)=>{
    const img=new Image();img.crossOrigin='anonymous';
    img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('菜單圖片載入失敗'));img.src=url+(url.includes('?')?'&':'?')+'ocr='+Date.now();
  });
}
function buildOcrCrop(img,xRatio,wRatio){
  const sx=Math.max(0,Math.floor(img.naturalWidth*xRatio));

  // 樂品屋這類直式菜單：
  // 上方約 20% 是 Logo / 店家資訊 / 分類標題；
  // 下方約 11% 是注意事項小字，全部排除。
  const yStart=0.205;
  const yEnd=0.89;
  const sy=Math.floor(img.naturalHeight*yStart);
  const sw=Math.min(img.naturalWidth-sx,Math.floor(img.naturalWidth*wRatio));
  const sh=Math.floor(img.naturalHeight*(yEnd-yStart));

  const targetW=Math.min(1900,Math.max(1200,Math.round(sw*2.5)));
  const scale=targetW/sw,targetH=Math.round(sh*scale);
  const canvas=document.createElement('canvas');canvas.width=targetW;canvas.height=targetH;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(img,sx,sy,sw,sh,0,0,targetW,targetH);
  const d=ctx.getImageData(0,0,targetW,targetH),p=d.data;
  for(let i=0;i<p.length;i+=4){
    const g=0.299*p[i]+0.587*p[i+1]+0.114*p[i+2];
    let v=(g-128)*1.45+150;
    v=Math.max(0,Math.min(255,v));
    p[i]=p[i+1]=p[i+2]=v;
  }
  ctx.putImageData(d,0,0);
  return canvas.toDataURL('image/jpeg',0.94);
}
async function recognizeMenuColumns(url){
  const img=await loadOcrImage(url);
  const parts=[
    {name:'左欄',data:buildOcrCrop(img,0.035,0.465)},
    {name:'右欄',data:buildOcrCrop(img,0.505,0.46)}
  ];
  const texts=[];
  const worker=await Tesseract.createWorker('chi_tra+eng',1,{
    logger:m=>{
      if(m.status==='recognizing text')$('ocrProgress').textContent='辨識中 '+Math.round((m.progress||0)*100)+'%';
      else if(m.status)$('ocrProgress').textContent=m.status;
    }
  });
  try{
    await worker.setParameters({
      tessedit_pageseg_mode:'6',
      preserve_interword_spaces:'1'
    });
    for(let i=0;i<parts.length;i++){
      $('ocrProgress').textContent='正在辨識'+parts[i].name+'（'+(i+1)+'/2）';
      const r=await worker.recognize(parts[i].data);
      texts.push('【'+parts[i].name+'】\n'+(r?.data?.text||''));
    }
  }finally{
    await worker.terminate();
  }
  return texts.join('\n');
}
$('ocrMenuBtn').addEventListener('click',async()=>{
  const t=templates.find(x=>x.id===editingTemplateId);if(!t?.image_url)return toast('這份菜單沒有圖片');
  if(!window.Tesseract)return toast('OCR 元件尚未載入，請重新整理後再試');
  const b=$('ocrMenuBtn');b.disabled=true;b.textContent='辨識中…';$('ocrProgress').textContent='正在放大並切成左右兩欄…';
  try{
    const text=await recognizeMenuColumns(t.image_url);
    $('ocrRawText').value=text;
    const parsed=parseOcrMenu(text);
    if(parsed.length>=3){
      menuEditorItems=parsed;renderMenuItemEditor();
      toast('辨識到 '+parsed.length+' 個可能品項，請檢查後再儲存');
    }else{
      toast('這次辨識可信品項太少，沒有覆蓋原本清單');
    }
  }catch(err){toast('OCR 失敗：'+(err?.message||err))}
  finally{b.disabled=false;b.textContent='辨識菜單';$('ocrProgress').textContent='';}
});
async function syncMenuPriceChangesToOrders(menuTemplateId){
  const{data,error}=await db.rpc('sync_class_lunch_menu_prices',{p_menu_template_id:menuTemplateId});
  if(error)throw new Error('同步既有訂單金額失敗：'+error.message);
  return Number(data?.orders_updated||0);
}

async function deleteCurrentTemplate(){
  const t=templates.find(x=>x.id===editingTemplateId);if(!t)return;
  const{count:sessionCount,error:sessionError}=await db.from('meal_sessions')
    .select('id',{count:'exact',head:true})
    .eq('menu_template_id',t.id);
  if(sessionError)return toast('檢查訂餐日期失敗：'+sessionError.message);
  if((sessionCount||0)>0)return toast('這份菜單已被訂餐日期使用，不能永久刪除；請改為停用');

  const{data:itemRows,error:itemError}=await db.from('menu_items')
    .select('id')
    .eq('menu_template_id',t.id);
  if(itemError)return toast('檢查菜單品項失敗：'+itemError.message);
  const itemIds=(itemRows||[]).map(x=>Number(x.id));
  if(itemIds.length){
    const{count:orderItemCount,error:orderItemError}=await db.from('order_items')
      .select('id',{count:'exact',head:true})
      .in('menu_item_id',itemIds);
    if(orderItemError)return toast('檢查既有訂單失敗：'+orderItemError.message);
    if((orderItemCount||0)>0)return toast('這份菜單已有訂單紀錄，不能永久刪除；請改為停用');
  }

  if(!confirm('永久刪除「'+t.name+'」？\n\n菜單、品項與圖片都會刪除，且無法復原。'))return;

  const{error}=await db.from('menu_templates').delete().eq('id',t.id);
  if(error)return toast('刪除菜單失敗：'+error.message);

  if(t.image_url){
    try{
      const u=new URL(t.image_url);
      const marker='/storage/v1/object/public/menu-images/';
      const pos=u.pathname.indexOf(marker);
      if(pos>=0){
        const storagePath=decodeURIComponent(u.pathname.slice(pos+marker.length));
        if(storagePath)await db.storage.from('menu-images').remove([storagePath]);
      }
    }catch(error){console.warn('menu_image_cleanup_failed',error)}
  }

  $('templateDialog').close();
  editingTemplateId=null;
  toast('菜單已永久刪除');
  await loadTemplates();renderTemplateSelect();await loadSessions();
}
$('deleteTemplateBtn').addEventListener('click',deleteCurrentTemplate);

$('templateEditForm').addEventListener('submit',async e=>{
  e.preventDefault();const t=templates.find(x=>x.id===editingTemplateId);if(!t)return;
  const name=$('editTemplateName').value.trim();if(!name)return toast('菜單名稱不能空白');
  const patch={name,active:$('editTemplateActive').checked,updated_at:new Date().toISOString()},f=$('editTemplateImage').files[0];
  let uploadedImageUrl='';
  if(f){
    if(f.size>12*1024*1024)return toast('圖片請小於 12MB');
    uploadedImageUrl=await uploadMenuImage(f);
    if(!uploadedImageUrl)return;
    patch.image_url=uploadedImageUrl;
  }
  const{error}=await db.from('menu_templates').update(patch).eq('id',editingTemplateId);
  if(error){
    if(uploadedImageUrl)await removeMenuImageUrl(uploadedImageUrl);
    return toast(error.message);
  }
  if(uploadedImageUrl&&t.image_url&&t.image_url!==uploadedImageUrl)await removeMenuImageUrl(t.image_url);
  const cleaned=menuEditorItems.map((x,i)=>({id:x.id||null,menu_template_id:editingTemplateId,category:String(x.category||'').trim(),name:String(x.name||'').trim(),price:x.is_market_price?0:Number(x.price||0),is_market_price:!!x.is_market_price,active:x.active!==false,sort_order:i})).filter(x=>x.name);
  if(cleaned.some(x=>!Number.isInteger(x.price)||x.price<0||x.price>10000))return toast('品項價格格式不正確');

  const{data:currentItems,error:currentItemsError}=await db.from('menu_items')
    .select('id,price,is_market_price')
    .eq('menu_template_id',editingTemplateId);
  if(currentItemsError)return toast('讀取原本菜單價格失敗：'+currentItemsError.message);
  const currentItemMap=new Map((currentItems||[]).map(x=>[Number(x.id),x]));
  const priceChangedRows=cleaned.filter(x=>{
    if(!x.id)return false;
    const old=currentItemMap.get(Number(x.id));
    if(!old)return false;
    return Number(old.price||0)!==Number(x.price||0)||Boolean(old.is_market_price)!==Boolean(x.is_market_price);
  });

  const keptIds=new Set(cleaned.filter(x=>x.id).map(x=>Number(x.id)));
  const removedIds=originalMenuItemIds.filter(id=>!keptIds.has(Number(id)));

  if(removedIds.length){
    const{data:refs,error:refError}=await db.from('order_items').select('menu_item_id').in('menu_item_id',removedIds);
    if(refError)return toast('檢查歷史訂單失敗：'+refError.message);
    const referenced=new Set((refs||[]).map(x=>Number(x.menu_item_id)));
    const archiveIds=removedIds.filter(id=>referenced.has(Number(id)));
    const deleteIds=removedIds.filter(id=>!referenced.has(Number(id)));

    if(archiveIds.length){
      const r=await db.from('menu_items').update({active:false}).in('id',archiveIds);
      if(r.error)return toast('停用歷史品項失敗：'+r.error.message);
    }
    if(deleteIds.length){
      const r=await db.from('menu_items').delete().in('id',deleteIds);
      if(r.error)return toast('刪除品項失敗：'+r.error.message);
    }
  }

  for(const row of cleaned.filter(x=>x.id)){
    const{id,...patch}=row;
    const r=await db.from('menu_items').update(patch).eq('id',id).eq('menu_template_id',editingTemplateId);
    if(r.error)return toast('品項更新失敗：'+r.error.message);
  }

  const newRows=cleaned.filter(x=>!x.id).map(({id,...row})=>row);
  if(newRows.length){
    const r=await db.from('menu_items').insert(newRows);
    if(r.error)return toast('品項新增失敗：'+r.error.message);
  }

  let affectedOrders=0;
  if(priceChangedRows.length){
    try{
      affectedOrders=await syncMenuPriceChangesToOrders(editingTemplateId);
    }catch(error){
      return toast(error?.message||String(error));
    }
  }

  $('templateDialog').close();
  toast(affectedOrders?'菜單已更新，並重算 '+affectedOrders+' 張訂單':'菜單與品項已更新');
  await loadTemplates();renderTemplateSelect();await loadSessions();
});

$('sessionDate').addEventListener('change',()=>applyDefaultSessionCutoff(true));

$('editSessionDate').addEventListener('change',()=>{
  const newDate=$('editSessionDate').value,cutoff=$('editSessionCutoff');
  if(!newDate||!cutoff)return;
  const current=cutoff.value;
  if(!current){
    cutoff.value=defaultCutoffForDate(newDate);
  }else if(!editingSessionOriginalDate||current.startsWith(editingSessionOriginalDate+'T')){
    const time=current.slice(11)||'10:00';
    cutoff.value=newDate+'T'+time;
  }
  editingSessionOriginalDate=newDate;
});

$('sessionForm').addEventListener('submit',async e=>{
  e.preventDefault();const cutoff=$('sessionCutoff').value;
  const{error}=await db.from('meal_sessions').insert({menu_template_id:Number($('sessionTemplate').value),meal_date:$('sessionDate').value,cutoff_at:cutoff?new Date(cutoff+':00+08:00').toISOString():null,is_active:$('sessionActive').checked});
  if(error)return toast(error.message);toast('訂餐日期已新增');applyDefaultSessionCutoff(true);await loadSessions();
});
function localDatetime(v){if(!v)return'';const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(v));const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));return m.year+'-'+m.month+'-'+m.day+'T'+m.hour+':'+m.minute}
function openSessionDialog(id){const s=sessions.find(x=>x.id===id);if(!s)return;editingSessionId=id;editingSessionOriginalDate=s.meal_date;$('editSessionTemplate').value=String(s.menu_template_id);$('editSessionDate').value=s.meal_date;$('editSessionCutoff').value=localDatetime(s.cutoff_at)||defaultCutoffForDate(s.meal_date);$('editSessionActive').checked=s.is_active;$('sessionDialog').showModal()}
$('sessionEditForm').addEventListener('submit',async e=>{
  e.preventDefault();const cutoff=$('editSessionCutoff').value;
  const{error}=await db.from('meal_sessions').update({menu_template_id:Number($('editSessionTemplate').value),meal_date:$('editSessionDate').value,cutoff_at:cutoff?new Date(cutoff+':00+08:00').toISOString():null,is_active:$('editSessionActive').checked,updated_at:new Date().toISOString()}).eq('id',editingSessionId);
  if(error)return toast(error.message);$('sessionDialog').close();toast('訂餐日期已更新');await loadSessions();
});
$('archiveSessionBtn').addEventListener('click',async()=>{
  const s=sessions.find(x=>x.id===editingSessionId);if(!s)return;
  if(!confirm('確定封存 '+s.meal_date+'？封存後不再開放訂餐，但訂單與歷史資料都會保留。'))return;
  const{error}=await db.from('meal_sessions').update({is_active:false,updated_at:new Date().toISOString()}).eq('id',editingSessionId);
  if(error)return toast(error.message);
  $('sessionDialog').close();toast('訂餐日期已封存');await loadSessions();
});
$('deleteSessionBtn').addEventListener('click',async()=>{
  const s=sessions.find(x=>x.id===editingSessionId);if(!s)return;
  const{count,error:countError}=await db.from('orders').select('id',{count:'exact',head:true}).eq('meal_session_id',editingSessionId);
  if(countError)return toast('檢查訂單失敗：'+countError.message);
  if((count||0)>0)return toast('這個日期已有訂單，為避免資料遺失只能封存，不能永久刪除');
  if(!confirm('永久刪除 '+s.meal_date+'？此動作無法復原。'))return;
  const{error}=await db.from('meal_sessions').delete().eq('id',editingSessionId);
  if(error)return toast('刪除失敗：'+error.message);
  $('sessionDialog').close();toast('空白訂餐日期已永久刪除');await loadSessions();
});

function openStudentDialog(id){
  const s=students.find(x=>x.id===id);if(!s)return;
  const canEdit=s.role!=='system_admin'&&(currentAdminRole==='system_admin'||s.role!=='class_admin');
  if(!canEdit)return toast('此管理帳號不能修改這個帳號');
  editingStudentId=id;$('editStudentSeat').textContent=s.seat_number+'號';$('editStudentName').value=s.name||'';$('editStudentActive').checked=s.active;$('editStudentPassword').value='';$('studentDialog').showModal()
}
$('studentEditForm').addEventListener('submit',async e=>{
  e.preventDefault();const s=students.find(x=>x.id===editingStudentId);if(!s)return;
  const rawName=$('editStudentName').value.trim(),active=$('editStudentActive').checked,pw=$('editStudentPassword').value;
  const name=s.role==='teacher'?'老師':rawName;
  const u=await db.functions.invoke('class-lunch-students',{body:{action:'update',student_id:s.id,name,active}});
  if(u.error||u.data?.error)return toast('更新失敗：'+(u.data?.detail||u.data?.error||u.error?.message||'未知錯誤'));
  if(pw){
    if(!(s.role==='teacher'&&pw==='tch')&&pw.length<4)return toast('密碼至少 4 碼');
    const r=await db.functions.invoke('class-lunch-students',{body:{action:'reset_password',student_id:s.id,password:pw}});
    if(r.error||r.data?.error)return toast('資料已更新，但密碼重設失敗：'+(r.data?.detail||r.data?.error||r.error?.message||'未知錯誤'));
  }
  $('studentDialog').close();toast('學生資料已更新');await loadStudents();
});

function renderOverviewSelect(){
  const sel=$('overviewSession'),cur=sel.value;
  const current=sessions.filter(s=>s.meal_date>=today()).sort((a,b)=>a.meal_date.localeCompare(b.meal_date)||Number(a.id)-Number(b.id));
  sel.innerHTML=current.map(s=>'<option value="'+s.id+'">'+esc(s.meal_date+' '+(s.menu_templates?.name||'菜單'))+'</option>').join('');
  if(cur&&current.some(s=>String(s.id)===cur))sel.value=cur;
  else if(current.length)sel.value=String(current[0].id);
  sel.onchange=loadOverview;
  if(current.length)loadOverview();
  else{
    $('statOrders').textContent='0';$('statPaid').textContent='0';$('statUnpaidCount').textContent='0';$('statTotal').textContent='$0';
    $('itemStats').innerHTML='<div class="loading">今天起沒有訂餐日期</div>';
    $('unpaidSummary').innerHTML='';
    $('seatPayments').innerHTML='<div class="loading">今天起沒有訂餐日期</div>';
  }
}

async function loadHistoryOrders(){
  const box=$('historyOrderList'),count=$('historySessionCount');
  if(!box||!count)return;
  const past=sessions.filter(s=>s.meal_date<today()).sort((a,b)=>b.meal_date.localeCompare(a.meal_date)||Number(b.id)-Number(a.id));
  count.textContent=past.length+' 個日期';
  if(!past.length){box.innerHTML='<div class="loading">目前還沒有歷史訂單</div>';return}
  box.innerHTML='<div class="loading">整理歷史訂單…</div>';
  const packs=await Promise.all(past.map(async s=>{
    const legacy=s.legacy_menu_id||-1;
    const{data,error}=await db.from('orders')
      .select('id,student_id,student_name,item_name,unit_price,note,paid,quantity')
      .or('meal_session_id.eq.'+s.id+',menu_id.eq.'+legacy);
    return {session:s,orders:data||[],error};
  }));
  box.innerHTML=packs.map(pack=>{
    const s=pack.session;
    if(pack.error)return '<details class="history-pack"><summary><span><b>'+esc(s.meal_date+' '+(s.menu_templates?.name||'菜單'))+'</b><small>讀取失敗</small></span></summary><div class="loading">'+esc(pack.error.message||'讀取失敗')+'</div></details>';
    const rows=pack.orders;
    const paid=rows.filter(o=>o.paid).length;
    const total=rows.reduce((sum,o)=>sum+Number(o.unit_price||0)*Number(o.quantity||1),0);
    const body=rows.length?rows.slice().sort((a,b)=>{
      const aSeat=students.find(x=>x.id===a.student_id)?.seat_number;
      const bSeat=students.find(x=>x.id===b.student_id)?.seat_number;
      const sa=aSeat??(Number.isFinite(Number(a.student_name))?Number(a.student_name):999);
      const sb=bSeat??(Number.isFinite(Number(b.student_name))?Number(b.student_name):999);
      return Number(sa)-Number(sb);
    }).map(o=>{
      const st=students.find(x=>x.id===o.student_id);
      const seat=st?.seat_number??(Number.isFinite(Number(o.student_name))?Number(o.student_name):'？');
      const unresolved=String(o.item_name||'').includes('（時價）');
      const amount=Number(o.unit_price||0)*Number(o.quantity||1);
      return '<div class="history-pack-order"><span><b>'+esc(seat+'號'+(st?.name?' '+st.name:''))+'</b><small>'+esc(o.item_name||'未記錄品項')+(o.note?' · 備註：'+esc(o.note):'')+'</small></span><strong>'+money(amount)+(unresolved?' ＋ 時價':'')+' · '+(o.paid?'已付款':'未付款')+'</strong></div>';
    }).join(''):'<div class="loading">這個日期沒有訂單</div>';
    return '<details class="history-pack"><summary><span><b>'+esc(s.meal_date+' '+(s.menu_templates?.name||'菜單'))+'</b><small>'+rows.length+' 筆 · 已付款 '+paid+' · 未付款 '+(rows.length-paid)+'</small></span><strong>'+money(total)+'</strong></summary><div class="history-pack-orders">'+body+'</div></details>';
  }).join('');
}
async function loadUnpaidOrders(){
  const box=$('allUnpaidList'),summary=$('allUnpaidSummary'),refundBox=$('allRefundList');
  if(!box||!summary||!refundBox||!adminGatePassed)return;
  box.innerHTML='<div class="loading">載入中…</div>';
  refundBox.innerHTML='<div class="loading">載入中…</div>';
  const [unpaidRes,refundRes]=await Promise.all([
    db.rpc('class_lunch_admin_unpaid_orders'),
    db.rpc('class_lunch_admin_refund_due_orders')
  ]);
  if(unpaidRes.error){box.innerHTML='<div class="loading">讀取失敗</div>';return toast('讀取未付款名單失敗：'+unpaidRes.error.message)}
  if(refundRes.error){refundBox.innerHTML='<div class="loading">讀取失敗</div>';return toast('讀取待退款失敗：'+refundRes.error.message)}
  const rows=(unpaidRes.data||[]).slice().sort((a,b)=>
    String(a.meal_date||'9999-12-31').localeCompare(String(b.meal_date||'9999-12-31'))||
    Number(a.seat_number||99999)-Number(b.seat_number||99999)||
    Number(a.order_id||0)-Number(b.order_id||0)
  ),refunds=refundRes.data||[];
  const totalDue=rows.reduce((a,x)=>a+Number(x.amount_due||0),0);
  const totalRefund=refunds.reduce((a,x)=>a+Number(x.refund_due||0),0);
  summary.innerHTML=
    '<div class="stat"><small>未付款筆數</small><b>'+rows.length+'</b></div>'+
    '<div class="stat"><small>待收金額</small><b>'+money(totalDue)+'</b></div>'+
    '<div class="stat"><small>今天待退款</small><b>'+money(totalRefund)+'</b></div>';

  if(!rows.length){
    box.innerHTML='<div class="all-paid">✓ 目前沒有未付款訂單</div>';
    return;
  }

  const todayStr=today();
  const addDay=(date,days)=>{
    const d=new Date(date+'T12:00:00+08:00');
    d.setUTCDate(d.getUTCDate()+days);
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  };
  const tomorrow=addDay(todayStr,1);
  const grouped=new Map();
  for(const row of rows){
    const key=row.meal_date||'未指定日期';
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(row);
  }

  box.innerHTML=[...grouped.entries()].map(([date,items])=>{
    const label=date===todayStr?'今天 · '+date:date===tomorrow?'明天 · '+date:(date<todayStr?'逾期 · '+date:date);
    const dayTotal=items.reduce((a,x)=>a+Number(x.amount_due||0),0);
    return '<section class="unpaid-day-group">'+
      '<div class="item-stats-head"><h3>'+esc(label)+'</h3><span>'+items.length+' 筆 · '+money(dayTotal)+'</span></div>'+
      '<div class="unpaid-list">'+items.map(x=>
        '<article class="history-row">'+
          '<div class="history-main">'+
            '<div class="history-title"><b>'+esc(x.seat_number+'號 '+(x.name||''))+'</b><span>'+esc(x.menu_name||'')+'</span></div>'+
            '<div class="history-items">'+esc(x.item_name||'未記錄品項')+(x.note?' · 備註：'+esc(x.note):'')+'</div>'+
            '<small>訂單 '+money(x.order_total)+(Number(x.onsite_received||0)>0?' · 已收 '+money(x.onsite_received):'')+(x.unresolved_market_price?' · 尚有時價未定':'')+'</small>'+
          '</div>'+
          '<div class="actions"><strong class="history-price">'+money(x.amount_due)+(x.unresolved_market_price?' ＋ 時價':'')+'</strong> '+
            '<button class="small-btn" type="button" data-unpaid-pay="'+x.order_id+'">標記付款</button></div>'+
        '</article>'
      ).join('')+'</div>'+
    '</section>';
  }).join('');

  box.querySelectorAll('[data-unpaid-pay]').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;
    try{
      await window.togglePaid(Number(btn.dataset.unpaidPay),true);
      await loadUnpaidOrders();
    }finally{btn.disabled=false}
  }));

  refundBox.innerHTML=refunds.length?refunds.map(x=>
    '<article class="history-row">'+
      '<div class="history-main">'+
        '<div class="history-title"><b>'+esc(x.seat_number+'號 '+(x.name||''))+'</b><span>'+esc(x.order_date||'')+'</span></div>'+
        '<div class="history-items">'+esc(x.item_name||'未記錄品項')+(x.note?' · 備註：'+esc(x.note):'')+'</div>'+
        '<small>訂單 '+money(x.order_total)+' · 已收 '+money(x.onsite_received)+'</small>'+
      '</div>'+
      '<div class="actions"><strong class="history-price">應退 '+money(x.refund_due)+'</strong> '+
        '<button class="small-btn" type="button" data-refund-due="'+x.order_id+'">已退款</button></div>'+
    '</article>'
  ).join(''):'<div class="all-paid">✓ 今天沒有待退款差額</div>';

  refundBox.querySelectorAll('[data-refund-due]').forEach(btn=>btn.addEventListener('click',async()=>{
    if(!confirm('確定已實際把差額退還給學生？'))return;
    btn.disabled=true;
    try{
      const {error}=await db.rpc('class_lunch_admin_refund_onsite_difference',{p_order_id:Number(btn.dataset.refundDue)});
      if(error)throw error;
      toast('退款已記錄');
      await Promise.all([loadUnpaidOrders(),loadOverview()]);
    }catch(error){
      toast('退款失敗：'+error.message);
    }finally{btn.disabled=false}
  }));
}
window.loadUnpaidOrders=loadUnpaidOrders;
$('refreshUnpaidBtn')?.addEventListener('click',loadUnpaidOrders);

async function loadOverview(){
  const id=Number($('overviewSession').value);if(!id)return;
  const s=sessions.find(x=>x.id===id),legacy=s?.legacy_menu_id||-1;
  const{data:os,error}=await db.from('orders').select('id,student_id,student_name,item_name,unit_price,note,paid,quantity,payment_method,onsite_received,onsite_balance_due,paid_at').or('meal_session_id.eq.'+id+',menu_id.eq.'+legacy);
  if(error)return toast(error.message);
  const list=os||[],paid=list.filter(o=>o.paid).length,total=list.reduce((a,o)=>a+Number(o.unit_price||0)*Number(o.quantity||1),0);
  $('statOrders').textContent=list.length;$('statPaid').textContent=paid;$('statUnpaidCount').textContent=list.length-paid;

  const itemCounts=new Map(),variantCounts=new Map(),optionCounts=new Map(),normalizedOrders=new Set(),marketByOrder=new Map(),unresolvedOrders=new Set(),orderIds=list.map(o=>o.id);
  if(orderIds.length){
    const{data:oi,error:oie}=await db.from('order_items').select('id,order_id,quantity,unit_price,is_market_price,market_price_amount,variant_name,option_summary,configuration,item_name_snapshot,menu_items(name,is_market_price)').in('order_id',orderIds);
    if(oie)return toast('讀取品項統計失敗：'+oie.message);
    for(const row of (oi||[])){
      const name=row.menu_items?.name;
      if(!name)continue;
      const isMarket=!!(row.is_market_price||row.menu_items?.is_market_price);
      const displayName=name+(isMarket?'（時價）':'');
      normalizedOrders.add(row.order_id);
      if(isMarket){
        if(!marketByOrder.has(row.order_id))marketByOrder.set(row.order_id,[]);
        marketByOrder.get(row.order_id).push(row);
        if(row.market_price_amount==null)unresolvedOrders.add(row.order_id);
      }
      const qty=Number(row.quantity||1);
      itemCounts.set(displayName,(itemCounts.get(displayName)||0)+qty);

      if(row.variant_name){
        const key=name+'｜'+row.variant_name;
        variantCounts.set(key,(variantCounts.get(key)||0)+qty);
      }
      const configOptions=Array.isArray(row.configuration?.options)?row.configuration.options:[];
      for(const opt of configOptions){
        const groupName=String(opt?.group_name||'加購').trim()||'加購';
        const optionName=String(opt?.option_name||'').trim();
        if(!optionName)continue;
        if(!optionCounts.has(groupName))optionCounts.set(groupName,new Map());
        const gm=optionCounts.get(groupName);
        gm.set(optionName,(gm.get(optionName)||0)+qty);
      }
    }
  }
  for(const o of list){
    if(!normalizedOrders.has(o.id)){
      if(String(o.item_name||'').includes('（時價）'))unresolvedOrders.add(o.id);
      const parts=String(o.item_name||'').split(/[、,，]/).map(x=>x.trim()).filter(Boolean);
      for(const raw of parts){
        const m=raw.match(/^(.*?)(?:\s*[×xX]\s*(\d+))?$/);
        const name=(m?.[1]||raw).trim(),qty=Number(m?.[2]||1);
        if(name)itemCounts.set(name,(itemCounts.get(name)||0)+qty);
      }
    }
  }
  $('statTotal').textContent=money(total)+(unresolvedOrders.size?' ＋ 時價':'');
  const itemRows=[...itemCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-Hant'));
  const variantRows=[...variantCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-Hant'));
  const optionSections=[...optionCounts.entries()]
    .map(([group,counts])=>[group,[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-Hant'))])
    .sort((a,b)=>a[0].localeCompare(b[0],'zh-Hant'));
  const totalQty=itemRows.reduce((a,x)=>a+x[1],0);
  const comboCopyLines=[
    ...(variantRows.length?['────────','【點餐方式】',...variantRows.map(([name,qty])=>name+'：'+qty+'份')]:[]),
    ...optionSections.flatMap(([group,rows])=>rows.length?['────────','【'+group+'】',...rows.map(([name,qty])=>name+'：'+qty+'份')]:[])
  ];
  const noteRows=list
    .map(o=>{
      const note=String(o.note||'').trim();
      if(!note)return null;
      const st=students.find(x=>x.id===o.student_id);
      const seat=st?.seat_number||Number(o.student_name)||'？';
      const name=st?.name||'';
      return {seat,name,item:o.item_name||'未記錄品項',note};
    })
    .filter(Boolean)
    .sort((a,b)=>Number(a.seat||999)-Number(b.seat||999));
  const sessionLabel=[s?.meal_date,s?.menu_templates?.name||'菜單'].filter(Boolean).join(' ');
  const unpaidRows=list.filter(o=>!o.paid).map(o=>{
    const st=students.find(x=>x.id===o.student_id);
    const seat=st?.seat_number||Number(o.student_name)||'？';
    return {seat,name:st?.name||'',item:o.item_name||'未記錄品項',amount:Number(o.unit_price||0),market:unresolvedOrders.has(o.id)};
  }).sort((a,b)=>Number(a.seat||999)-Number(b.seat||999));
  latestUnpaidCopyText=unpaidRows.length?[
    '【'+sessionLabel+' 未付款名單】',
    ...unpaidRows.map(x=>x.seat+'號'+(x.name?' '+x.name:'')+'｜'+x.item+'｜'+money(x.amount)+(x.market?' ＋ 時價':'')),
    '────────',
    '共 '+unpaidRows.length+' 人未付款'
  ].join('\n'):'';
  $('unpaidSummary').innerHTML='<div class="item-stats-head"><h3>未付款名單</h3><div class="btnrow"><span>'+unpaidRows.length+' 人</span>'+(unpaidRows.length?'<button class="small-btn" type="button" onclick="copyUnpaidList()">一鍵複製 LINE</button>':'')+'</div></div>'+
    (unpaidRows.length?'<div class="unpaid-list">'+unpaidRows.map(x=>'<div class="item-stat-row"><span><b>'+esc(x.seat+'號'+(x.name?' '+x.name:''))+'</b><br><small>'+esc(x.item)+'</small></span><strong>'+money(x.amount)+(x.market?' ＋ 時價':'')+'</strong></div>').join('')+'</div>':'<div class="all-paid">✓ 目前全部已付款</div>');
  latestOverviewCopyText=[
    '【'+sessionLabel+' 訂餐統計】',
    ...(itemRows.length?itemRows.map(([name,qty])=>name+'：'+qty+'份'):['目前沒有品項']),
    ...comboCopyLines,
    ...(noteRows.length?[
      '────────',
      '【備註】',
      ...noteRows.map(x=>x.seat+'號'+(x.name?' '+x.name:'')+'｜'+x.item+'｜'+x.note)
    ]:[]),
    '────────',
    '總份數：'+totalQty+'份',
    '已訂：'+list.length+'人',
    '已付款：'+paid+'人｜未付款：'+(list.length-paid)+'人',
    '總金額：'+money(total)+(unresolvedOrders.size?' ＋ 時價':'')
  ].join('\n');
  const comboStatsHtml=
    (variantRows.length?'<div class="combo-stats-section"><h3>點餐方式</h3><div class="item-stats-table">'+variantRows.map(([name,qty])=>'<div class="item-stat-row"><span>'+esc(name)+'</span><b>'+qty+' 份</b></div>').join('')+'</div></div>':'')+
    optionSections.map(([group,rows])=>'<div class="combo-stats-section"><h3>'+esc(group)+'</h3><div class="item-stats-table">'+rows.map(([name,qty])=>'<div class="item-stat-row"><span>'+esc(name)+'</span><b>'+qty+' 份</b></div>').join('')+'</div></div>').join('');
  $('itemStats').innerHTML='<div class="item-stats-head"><h3>品項統計</h3><div class="btnrow"><span>'+totalQty+' 份</span><button class="small-btn" type="button" onclick="copyOverviewStats()">一鍵複製 LINE</button></div></div>'+
    (itemRows.length?'<div class="item-stats-table">'+itemRows.map(([name,qty])=>'<div class="item-stat-row"><span>'+esc(name)+(name.includes('（時價）')?' <em class="market-badge">時價</em>':'')+'</span><b>'+qty+' 份</b></div>').join('')+'</div>':'<div class="loading">目前沒有品項</div>')+
    comboStatsHtml+
    (noteRows.length?'<div class="order-notes-summary"><h3>備註</h3>'+noteRows.map(x=>'<div class="item-stat-row"><span><b>'+esc(x.seat+'號'+(x.name?' '+x.name:''))+'</b><br><small>'+esc(x.item)+'</small></span><strong>'+esc(x.note)+'</strong></div>').join('')+'</div>':'');

  const bySeat=new Map();for(const o of list){const st=students.find(s=>s.id===o.student_id),seat=st?.seat_number??Number(o.student_name);if(Number.isInteger(Number(seat)))bySeat.set(Number(seat),{...o,name:st?.name||''})}
  const rosterSeats=students
    .filter(s=>s.active&&['teacher','student'].includes(String(s.role||'')))
    .map(s=>Number(s.seat_number))
    .filter(Number.isInteger);
  const orderedExtraSeats=[...bySeat.keys()].filter(n=>!rosterSeats.includes(n));
  const seats=[...new Set([...rosterSeats,...orderedExtraSeats])].sort((a,b)=>{
    if(a===0)return -1;if(b===0)return 1;return a-b;
  });
  $('seatPayments').innerHTML='<div class="seat-grid">'+seats.map(n=>{
    const o=bySeat.get(n),st=students.find(s=>s.seat_number===n),hasMarket=o&&marketByOrder.has(o.id),unresolved=o&&unresolvedOrders.has(o.id);
    const refundDue=o&&o.payment_method==='onsite'&&Number(o.onsite_balance_due||0)<0?Math.abs(Number(o.onsite_balance_due||0)):0;
    const collectDue=o&&o.payment_method==='onsite'&&Number(o.onsite_balance_due||0)>0?Number(o.onsite_balance_due||0):0;
    return '<div class="seat-card '+(!o?'seat-empty':o.paid?'seat-paid':'seat-unpaid')+'"><b>'+n+'號'+(st?.name?' '+esc(st.name):'')+'</b><span>'+(!o?'未訂':refundDue?'應退款 '+money(refundDue):o.paid?'✓ 已付款':collectDue?'待收 '+money(collectDue):'未付款')+'</span>'+
      (o?'<strong>'+esc(o.item_name)+' · '+money(o.unit_price)+(unresolved?' ＋ 時價':'')+'</strong><small>'+esc(o.note||'')+'</small>'+(o.paid_at?'<small>實收時間 '+esc(fmtAdminTime(o.paid_at))+'</small>':'')+'<small class="easter-note">'+esc(adminPaymentEaster(!!o.paid,o.unit_price))+'</small><div>'+
      (hasMarket?'<button class="small-btn market-btn" onclick="openMarketPriceDialog('+o.id+','+n+')">設定時價</button> ':'')+
      (refundDue?'<button class="small-btn" onclick="refundOnsiteDifference('+o.id+')">退還差額</button> ':'<button class="small-btn" onclick="togglePaid('+o.id+','+(!o.paid)+')">'+(o.paid?'改未付':'標記付款')+'</button> ')+
      '<button class="small-btn danger" onclick="deleteOrder('+o.id+')">刪除</button></div>':'')+'</div>';
  }).join('')+'</div>';
}
async function copyOverviewStats(){
  if(!latestOverviewCopyText)return toast('目前沒有可複製的統計');
  try{
    await navigator.clipboard.writeText(latestOverviewCopyText);
    toast('統計已複製，可直接貼到 LINE');
  }catch{
    const ta=document.createElement('textarea');
    ta.value=latestOverviewCopyText;
    ta.setAttribute('readonly','');
    ta.style.position='fixed';ta.style.opacity='0';ta.style.pointerEvents='none';
    document.body.appendChild(ta);ta.select();
    const ok=document.execCommand('copy');
    ta.remove();
    toast(ok?'統計已複製，可直接貼到 LINE':'複製失敗，請再試一次');
  }
}
async function copyUnpaidList(){
  if(!latestUnpaidCopyText)return toast('目前沒有未付款名單');
  try{
    await navigator.clipboard.writeText(latestUnpaidCopyText);
    toast('未付款名單已複製，可直接貼到 LINE');
  }catch{
    const ta=document.createElement('textarea');
    ta.value=latestUnpaidCopyText;
    ta.setAttribute('readonly','');
    ta.style.position='fixed';ta.style.opacity='0';ta.style.pointerEvents='none';
    document.body.appendChild(ta);ta.select();
    const ok=document.execCommand('copy');
    ta.remove();
    toast(ok?'未付款名單已複製，可直接貼到 LINE':'複製失敗，請再試一次');
  }
}

async function openMarketPriceDialog(orderId,seat){
  editingMarketOrderId=orderId;
  $('marketPriceSeat').textContent=seat+'號訂單';
  const{data,error}=await db.from('order_items')
    .select('id,quantity,unit_price,is_market_price,market_price_amount,item_name_snapshot,menu_items(name)')
    .eq('order_id',orderId)
    .order('id');
  if(error)return toast('讀取時價品項失敗：'+error.message);
  const rows=data||[];
  marketOrderItems=rows.filter(x=>x.is_market_price);
  marketFixedTotal=rows.reduce((s,x)=>s+Number(x.unit_price||0)*Number(x.quantity||1),0);
  if(!marketOrderItems.length)return toast('這張訂單沒有時價品項');
  $('marketPriceRows').innerHTML=marketOrderItems.map(x=>
    '<label class="market-price-row"><span><b>'+esc(x.item_name_snapshot||x.menu_items?.name||'時價品項')+'</b><small>數量 '+Number(x.quantity||1)+' · 固定加價 '+money(x.unit_price||0)+'</small></span>'+
    '<input type="number" min="0" max="10000" step="1" data-market-id="'+x.id+'" value="'+(x.market_price_amount==null?'':Number(x.market_price_amount))+'" placeholder="每份實際金額"></label>'
  ).join('');
  $('marketPriceRows').querySelectorAll('input').forEach(el=>el.addEventListener('input',updateMarketPricePreview));
  updateMarketPricePreview();
  $('marketPriceDialog').showModal();
}
function updateMarketPricePreview(){
  let total=marketFixedTotal,hasBlank=false;
  for(const row of marketOrderItems){
    const input=$('marketPriceRows').querySelector('[data-market-id="'+row.id+'"]');
    const raw=input?.value?.trim()||'';
    if(!raw){hasBlank=true;continue}
    total+=Number(raw||0)*Number(row.quantity||1);
  }
  $('marketPricePreview').textContent=money(total)+(hasBlank?' ＋ 尚未設定時價':'');
}
$('marketPriceForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!editingMarketOrderId)return;
  const prices=marketOrderItems.map(row=>{
    const input=$('marketPriceRows').querySelector('[data-market-id="'+row.id+'"]');
    const raw=input?.value?.trim()||'';
    return {order_item_id:row.id,amount:raw===''?null:Number(raw)};
  });
  if(prices.some(x=>x.amount!=null&&(!Number.isInteger(x.amount)||x.amount<0||x.amount>10000)))return toast('時價金額格式不正確');
  const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;b.textContent='儲存中…';
  const{error}=await db.rpc('set_class_lunch_market_prices',{p_order_id:editingMarketOrderId,p_prices:prices});
  b.disabled=false;b.textContent='儲存時價';
  if(error)return toast('時價更新失敗：'+error.message);
  $('marketPriceDialog').close();toast('時價已更新');await loadOverview();
});

async function togglePaid(id,n){
  const fn=n?'class_lunch_wallet_admin_mark_onsite_paid':'class_lunch_wallet_admin_mark_unpaid';
  const {error}=await db.rpc(fn,{p_order_id:id});
  if(error)return toast((n?'付款失敗：':'改未付款失敗：')+error.message);
  toast(n?'已付款':'已改未付款');
  await loadOverview();
  if(!$('tab-unpaid')?.classList.contains('hidden'))await loadUnpaidOrders();
}
async function deleteOrder(id){
  if(!confirm('確定刪除這筆訂單？\n若有付款紀錄會先建立沖銷紀錄。'))return;
  const{error}=await db.rpc('class_lunch_wallet_admin_delete_order',{p_order_id:id});
  if(error)return toast('刪除失敗：'+error.message);
  toast('已刪除');
  await loadOverview();
  if(!$('tab-unpaid')?.classList.contains('hidden'))await loadUnpaidOrders();
}

function fmtAdminTime(v){
  return new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function orderActorLabel(l,row){
  if(l.actor_type==='admin')return '管理員';
  const st=students.find(s=>s.auth_user_id===l.actor_user_id);
  if(st)return st.seat_number+'號 '+(st.name||'');
  const seat=Number(row?.student_name);
  if(seat)return seat+'號';
  return l.actor_email||'系統';
}
function readableValue(v){
  if(v===null||v===undefined||v==='')return '空白';
  return String(v);
}
function describeOrderChange(l,itemNames){
  const old=l.detail?.old||{},now=l.detail?.new||{};
  if(l.entity_type==='orders'){
    const row=l.action==='delete'?old:now;
    if(l.action==='insert')return {row,title:'建立訂單',detail:(row.item_name||'未記錄品項')+' · '+money(row.unit_price)+(row.note?' · 備註：'+row.note:'')};
    if(l.action==='delete')return {row,title:'刪除訂單',detail:(row.item_name||'未記錄品項')+' · '+money(row.unit_price)+(row.note?' · 備註：'+row.note:'')};
    const diff=[];
    if(old.item_name!==now.item_name)diff.push('餐點：'+readableValue(old.item_name)+' → '+readableValue(now.item_name));
    if(Number(old.unit_price||0)!==Number(now.unit_price||0))diff.push('金額：'+money(old.unit_price)+' → '+money(now.unit_price));
    if(String(old.note||'')!==String(now.note||''))diff.push('備註：'+readableValue(old.note)+' → '+readableValue(now.note));
    if(Boolean(old.paid)!==Boolean(now.paid))diff.push('付款：'+(old.paid?'已付款':'未付款')+' → '+(now.paid?'已付款':'未付款'));
    if(Number(old.quantity||1)!==Number(now.quantity||1))diff.push('數量：'+Number(old.quantity||1)+' → '+Number(now.quantity||1));
    if(String(old.order_date||'')!==String(now.order_date||''))diff.push('日期：'+readableValue(old.order_date)+' → '+readableValue(now.order_date));
    if(!diff.length)return null;
    return {row:now,title:'修改訂單',detail:diff.join('；')};
  }
  const row=l.action==='delete'?old:now;
  const oldName=itemNames.get(Number(old.menu_item_id))||('品項 #'+readableValue(old.menu_item_id));
  const newName=itemNames.get(Number(now.menu_item_id))||('品項 #'+readableValue(now.menu_item_id));
  if(l.action==='insert')return {row,title:'新增訂單品項',detail:newName+' × '+Number(now.quantity||1)+' · '+money(now.unit_price)};
  if(l.action==='delete')return {row,title:'刪除訂單品項',detail:oldName+' × '+Number(old.quantity||1)+' · '+money(old.unit_price)};
  const diff=[];
  if(Number(old.menu_item_id)!==Number(now.menu_item_id))diff.push('品項：'+oldName+' → '+newName);
  if(Number(old.quantity||1)!==Number(now.quantity||1))diff.push('數量：'+Number(old.quantity||1)+' → '+Number(now.quantity||1));
  if(Number(old.unit_price||0)!==Number(now.unit_price||0))diff.push('單價：'+money(old.unit_price)+' → '+money(now.unit_price));
  if(old.market_price_amount!==now.market_price_amount)diff.push('時價：'+(old.market_price_amount==null?'未設定':money(old.market_price_amount))+' → '+(now.market_price_amount==null?'未設定':money(now.market_price_amount)));
  if(!diff.length)return null;
  return {row:now,title:'修改訂單品項',detail:diff.join('；')};
}
async function loadOrderChanges(){
  const box=$('orderChangeList');
  if(!box)return;
  box.innerHTML='<div class="loading">載入中…</div>';
  let q=db.from('class_lunch_audit_logs')
    .select('id,actor_user_id,actor_email,actor_type,action,entity_type,entity_id,detail,created_at')
    .in('entity_type',['orders','order_items']);
  q=scopeAdminClass(q);
  const{data,error}=await q.order('created_at',{ascending:false}).limit(300);
  if(error){box.innerHTML='<div class="loading">讀取失敗</div>';return toast(error.message)}
  const rows=data||[];
  const menuIds=[...new Set(rows.flatMap(l=>[l.detail?.old?.menu_item_id,l.detail?.new?.menu_item_id]).filter(Boolean).map(Number))];
  const itemNames=new Map();
  if(menuIds.length){
    const r=await db.from('menu_items').select('id,name').in('id',menuIds);
    for(const x of (r.data||[]))itemNames.set(Number(x.id),x.name);
  }
  const rendered=rows.map(l=>{
    const d=describeOrderChange(l,itemNames);
    if(!d)return '';
    const actor=orderActorLabel(l,d.row);
    const seat=d.row?.student_name?String(d.row.student_name)+'號':actor;
    return '<div class="change-row"><div class="change-main"><div class="change-title"><b>'+esc(d.title)+'</b><span>'+esc(seat)+'</span></div><p>'+esc(d.detail)+'</p><small>'+esc(actor)+'</small></div><time>'+esc(fmtAdminTime(l.created_at))+'</time></div>';
  }).filter(Boolean);
  box.innerHTML=rendered.length?rendered.join(''):'<div class="loading">目前沒有訂單異動紀錄</div>';
}
$('refreshChangesBtn')?.addEventListener('click',loadOrderChanges);

async function loadBackups(){
  const box=$('backupList');
  if(!box)return;
  box.innerHTML='<div class="loading">載入中…</div>';
  let q=db.from('class_lunch_backups')
    .select('id,backup_type,meal_date,summary,created_by_email,created_at');
  q=scopeAdminClass(q);
  const{data,error}=await q.order('created_at',{ascending:false});
  if(error){box.innerHTML='<div class="loading">讀取失敗</div>';return toast(error.message)}
  const rows=data||[];
  box.innerHTML=rows.length?rows.map(b=>{
    const s=b.summary||{};
    const type=b.backup_type==='daily'?'每日自動':'手動';
    return '<div class="backup-row"><div><div class="backup-title"><b>'+esc(b.meal_date)+'</b><span>'+type+'</span></div><small>訂單 '+Number(s.orders||0)+' 筆 · 已付 '+Number(s.paid||0)+' · 未付 '+Number(s.unpaid||0)+' · '+money(s.total||0)+'</small><small>'+esc(fmtAdminTime(b.created_at))+'</small></div><button class="small-btn" type="button" onclick="downloadBackup('+b.id+')">下載 JSON</button></div>';
  }).join(''):'<div class="loading">目前還沒有備份紀錄</div>';
}
$('refreshBackupsBtn')?.addEventListener('click',loadBackups);
$('createBackupBtn')?.addEventListener('click',async()=>{
  const date=$('backupDate').value||today(),btn=$('createBackupBtn');
  btn.disabled=true;btn.textContent='備份中…';
  const{data,error}=await db.functions.invoke('class-lunch-backup',{body:{meal_date:date}});
  btn.disabled=false;btn.textContent='立即備份';
  if(error||data?.error)return toast('備份失敗：'+(data?.detail||data?.error||error.message));
  toast('已建立 '+date+' 的備份 #'+data.backup_id);
  await loadBackups();
});
async function downloadBackup(id){
  let q=db.from('class_lunch_backups').select('id,backup_type,meal_date,summary,snapshot,created_at').eq('id',id);
  q=scopeAdminClass(q);
  const{data,error}=await q.single();
  if(error||!data)return toast('讀取備份失敗：'+(error?.message||'找不到資料'));
  const payload={backup_id:data.id,backup_type:data.backup_type,meal_date:data.meal_date,created_at:data.created_at,summary:data.summary,snapshot:data.snapshot};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='class-lunch-backup-'+data.meal_date+'-'+data.id+'.json';
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('備份 JSON 已產生');
}

function logLabel(l){
  const a=l.action,e=l.entity_type;
  if(e==='orders'&&a==='insert')return '建立訂單';
  if(e==='orders'&&a==='delete')return '刪除訂單';
  if(e==='orders'&&a==='update')return '修改訂單／付款狀態';
  if(e==='order_items'&&a==='insert')return '新增訂單品項';
  if(e==='order_items'&&a==='update')return '修改訂單品項';
  if(e==='order_items'&&a==='delete')return '刪除訂單品項';
  if(e==='meal_sessions'&&a==='insert')return '新增訂餐日期';
  if(e==='meal_sessions'&&a==='update')return '修改訂餐日期';
  if(e==='meal_sessions'&&a==='delete')return '刪除訂餐日期';
  if(e==='menu_templates'&&a==='insert')return '新增菜單';
  if(e==='menu_templates'&&a==='update')return '修改菜單';
  if(e==='students'&&a==='update')return '修改學生資料';
  return a+' '+e;
}
async function loadLogs(){
  $('auditList').innerHTML='<div class="loading">載入中…</div>';
  let q=db.from('class_lunch_audit_logs').select('id,actor_user_id,actor_email,actor_type,action,entity_type,entity_id,detail,created_at');
  q=scopeAdminClass(q);
  const{data,error}=await q.order('created_at',{ascending:false}).limit(100);
  if(error){$('auditList').innerHTML='<div class="loading">讀取失敗</div>';return toast(error.message)}
  const rows=data||[];
  $('auditList').innerHTML=rows.length?rows.map(l=>{
    const st=students.find(s=>s.auth_user_id===l.actor_user_id),actor=l.actor_type==='admin'?'管理員':st?(st.seat_number+'號 '+(st.name||'')):(l.actor_email||'系統');
    return '<div class="audit-row"><div><b>'+esc(logLabel(l))+'</b><span>'+esc(actor)+'</span></div><time>'+esc(new Date(l.created_at).toLocaleString('zh-TW'))+'</time></div>';
  }).join(''):'<div class="loading">目前沒有操作紀錄</div>';
}
$('refreshLogsBtn').addEventListener('click',loadLogs);

function scheduleAdminRealtimeRefresh(kind){
  clearTimeout(realtimeTimer);
  realtimeTimer=setTimeout(async()=>{
    if(kind==='sessions'){
      await loadSessions();
    }else{
      await loadOverview();
      if(!$('tab-unpaid')?.classList.contains('hidden'))await loadUnpaidOrders();
    }
  },350);
}
function startAdminRealtime(){
  if(realtimeChannel||!selectedAdminClassId||document.hidden||$('adminApp')?.classList.contains('hidden'))return;
  realtimeChannel=db.channel('class-lunch-admin-realtime-'+selectedAdminClassId)
    .on('postgres_changes',{
      event:'*',schema:'public',table:'orders',
      filter:'class_id=eq.'+selectedAdminClassId
    },()=>scheduleAdminRealtimeRefresh('orders'))
    .on('postgres_changes',{event:'*',schema:'public',table:'order_items'},()=>scheduleAdminRealtimeRefresh('orders'))
    .on('postgres_changes',{
      event:'*',schema:'public',table:'meal_sessions',
      filter:'class_id=eq.'+selectedAdminClassId
    },()=>scheduleAdminRealtimeRefresh('sessions'))
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_items'},()=>scheduleAdminRealtimeRefresh('orders'))
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_templates'},()=>scheduleAdminRealtimeRefresh('sessions'))
    .subscribe();
}
function stopAdminRealtime(){
  clearTimeout(realtimeTimer);
  if(realtimeChannel){db.removeChannel(realtimeChannel);realtimeChannel=null}
}
db.auth.onAuthStateChange(()=>setTimeout(()=>{if(Date.now()-lastAdminRefreshStartedAt>1500)refresh()},150));
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopAdminRealtime();return}
  if(!$('adminApp')?.classList.contains('hidden')){
    startAdminRealtime();
    Promise.all([loadSessions(),loadStudents()]).catch(()=>{});
  }
});
renderAdminNightEgg();setInterval(renderAdminNightEgg,60000);refresh();