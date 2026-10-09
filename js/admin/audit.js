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

