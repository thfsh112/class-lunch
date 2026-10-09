async function loadTemplates(){
  const{data,error}=await db.from('menu_templates').select('*').order('created_at',{ascending:false});
  if(error)return toast(error.message);
  templates=data||[];$('templateCount').textContent=templates.length+' 份';renderTemplateList();
}
async function loadSessions(){
  let q=db.from('meal_sessions').select('*,menu_templates(name,image_url),meal_session_groups!meal_sessions_backup_group_id_fkey(id,status,selected_session_id,meal_date)');
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

