async function openAccountDialog(){
  stopStudentRealtime();
  $('passwordForm').reset();
  const locked=student?.role==='system_admin';
  const section=$('passwordChangeSection');
  if(section)section.classList.toggle('hidden',locked);
  const note=$('passwordLockedNote');
  if(note)note.classList.toggle('hidden',!locked);
  $('accountDialog').showModal();
  await refreshPushStatus();
}


$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  // A frontend sign-in can replace the Supabase auth session_id. Admin sessions are
  // bound to that id, so never carry an old admin gate/class selection across it.
  localStorage.removeItem('class-lunch-admin-gate');
  localStorage.removeItem('class-lunch-admin-class-selected');
  const classCode=String($('classLogin').value||'').trim();
  const account=String($('seatLogin').value||'').trim().toLowerCase();
  const raw=$('passwordLogin').value;

  if(account==='tch'){
    if(!classCode)return toast('請輸入班級');
    const{data,error}=await db.functions.invoke('class-lunch-teacher-login',{body:{class_code:classCode,account:'tch',password:raw}});
    if(error||data?.error)return toast('班級、帳號或密碼錯誤');
    if(!data?.access_token||!data?.refresh_token)return toast('老師登入失敗');
    const{error:setError}=await db.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
    if(setError)return toast('登入失敗：'+setError.message);
    localStorage.setItem('class-lunch-last-class',classCode);
    $('passwordLogin').value='';return refresh();
  }

  const seat=Number(account);
  if(!validSeat(seat))return toast('座號不正確');

  if(seat===99){
    if(raw!=='099')return toast('座號或密碼錯誤');
    const contextClass=classCode||'99';
    const{data:initData,error:initError}=await db.functions.invoke('class-lunch-init-login',{body:{class_code:contextClass,seat_number:seat,initial_code:raw}});
    if(initError||initData?.error)return toast('99 登入失敗，請確認密碼或重新整理後再試');
    if(!initData?.access_token||!initData?.refresh_token)return toast('99 登入失敗');
    const{error:setError}=await db.auth.setSession({access_token:initData.access_token,refresh_token:initData.refresh_token});
    if(setError)return toast('99 登入失敗，請重新整理後再試');
    localStorage.setItem('class-lunch-last-class',contextClass);
    $('passwordLogin').value='';return refresh();
  }

  if(!classCode)return toast('請輸入班級');

  let loginError=null;
  const email=internalEmail(classCode,seat);
  const direct=await db.auth.signInWithPassword({email,password:authPassword(raw)});
  loginError=direct.error;

  if(loginError){
    const initial3=String(seat).padStart(3,'0');
    const initial4=String(seat).padStart(4,'0');
    if(raw===initial3||raw===initial4){
      const{data:initData,error:initError}=await db.functions.invoke('class-lunch-init-login',{body:{class_code:classCode,seat_number:seat,initial_code:raw}});
      if(!initError&&!initData?.error&&initData?.access_token&&initData?.refresh_token){
        const{error:setError}=await db.auth.setSession({access_token:initData.access_token,refresh_token:initData.refresh_token});
        if(setError)return toast('登入失敗：'+setError.message);
        loginError=null;
      }else{
        return toast('班級、座號或密碼錯誤');
      }
    }
  }

  if(loginError)return toast('班級、座號或密碼錯誤');
  localStorage.setItem('class-lunch-last-class',classCode);
  $('passwordLogin').value='';
  await refresh();
});

$('setupForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const isTeacher=student?.seat_number===0;
  const name=$('setupName').value.trim(),p1=$('setupPassword').value,p2=$('setupPassword2').value;
  if(!isTeacher&&!name)return toast('請輸入姓名');
  if(p1.length<4)return toast('新密碼至少 4 碼');
  if(isTeacher&&p1==='tch')return toast('新密碼不能繼續使用初始密碼 tch');
  if(p1!==p2)return toast('兩次密碼不一致');
  const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;b.textContent='設定中…';
  const result=isTeacher
    ?await db.functions.invoke('class-lunch-teacher-password',{body:{password:p1}})
    :await db.functions.invoke('class-lunch-students',{body:{action:'self_setup',name,password:p1}});
  b.disabled=false;b.textContent='完成設定';
  const{data,error}=result;
  if(error||data?.error)return toast('設定失敗：'+(data?.detail||data?.error||error.message));
  $('setupForm').reset();toast('設定完成');await refresh();
});

$('logoutBtn').addEventListener('click',async()=>{localStorage.removeItem('class-lunch-admin-gate');localStorage.removeItem('class-lunch-admin-class-selected');await detachPushBeforeLogout();await db.auth.signOut({scope:'local'});student=null;studentViewClassId=null;loadedMenuTemplateKey='';refresh()});
$('accountBtn').addEventListener('click',openAccountDialog);
$('notifyBtn').addEventListener('click',openAccountDialog);
$('enablePushBtn').addEventListener('click',enablePushNotifications);
$('disablePushBtn').addEventListener('click',disablePushNotifications);
$('historyBtn').addEventListener('click',openHistory);
$('installAppBtn').addEventListener('click',async()=>{
  if(isStandalonePwa())return toast('已經是 App 模式');
  if(isAppleMobile()){
    $('iosInstallDialog').showModal();
    return;
  }
  if(!deferredInstallPrompt){
    refreshInstallStatus();
    return toast('Chrome 尚未提供安裝；請在頁面停留約 30 秒後再按一次');
  }
  deferredInstallPrompt.prompt();
  const choice=await deferredInstallPrompt.userChoice.catch(()=>null);
  deferredInstallPrompt=null;
  refreshInstallStatus();
  if(choice?.outcome==='accepted')toast('正在安裝班級訂飯');
});
$('copyInstallUrlBtn')?.addEventListener('click',async()=>{
  try{
    await navigator.clipboard.writeText(location.href);
    toast('網址已複製，可貼到 Safari 開啟');
  }catch{
    toast('複製失敗，請直接用 Safari 開啟目前網址');
  }
});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));

$('passwordForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(student?.role==='system_admin')return toast('99 號密碼固定為 099，不能修改');
  const p1=$('newPassword').value,p2=$('newPassword2').value;
  if(p1.length<4)return toast('密碼至少 4 碼');
  if(p1!==p2)return toast('兩次密碼不一致');
  const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;
  const{data,error}=await db.functions.invoke('class-lunch-students',{body:{action:'change_password',password:p1}});
  b.disabled=false;
  if(error||data?.error)return toast('修改失敗：'+(data?.detail||data?.error||error.message));
  $('accountDialog').close();$('passwordForm').reset();toast('密碼已更新');
});

