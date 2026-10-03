let latestOverviewCopyText='';
const{createClient}=supabase;
const db=createClient(APP_CONFIG.supabaseUrl,APP_CONFIG.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'class-lunch-admin-auth'}});
const legacyDb=createClient(APP_CONFIG.supabaseUrl,APP_CONFIG.publishableKey,{auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}});
const ADMIN_USERNAME='tnfsh112';
let legacyAdminChecked=false;
const $=id=>document.getElementById(id),money=n=>'$'+Number(n||0).toLocaleString('zh-TW');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const today=()=>new Date().toLocaleDateString('en-CA');
let templates=[],sessions=[],students=[],editingTemplateId=null,editingSessionId=null,editingStudentId=null,menuEditorItems=[],editingMarketOrderId=null,marketOrderItems=[],marketFixedTotal=0,realtimeChannel=null,realtimeTimer=null;
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600)}
async function isAdmin(){const{data:{user}}=await db.auth.getUser();if(!user)return false;const{data}=await db.from('admin_users').select('email').eq('email',user.email).maybeSingle();return!!data}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const username=$('adminUsername').value.trim(),password=$('password').value;
  if(username!==ADMIN_USERNAME||password!==ADMIN_USERNAME)return toast('帳號或密碼錯誤');

  const{data:{session}}=await legacyDb.auth.getSession();
  if(!session)return toast('請先回首頁登入 99 號，再進管理頁');

  const{data:self,error:selfError}=await legacyDb.from('students')
    .select('seat_number,active')
    .eq('auth_user_id',session.user.id)
    .maybeSingle();
  if(selfError||!self||!self.active||self.seat_number!==99)return toast('管理頁只開放 99 號');

  localStorage.removeItem('class-lunch-admin-no-legacy-migrate');
  const{error:setError}=await db.auth.setSession({
    access_token:session.access_token,
    refresh_token:session.refresh_token
  });
  if(setError)return toast('管理登入失敗：'+setError.message);

  $('password').value='';
  await refresh();
});
$('logoutBtn').addEventListener('click',async()=>{
  localStorage.setItem('class-lunch-admin-no-legacy-migrate','1');
  await db.auth.signOut();
  refresh();
});
$('adminAccountBtn').addEventListener('click',()=>toast('管理登入固定使用 tnfsh112 / tnfsh112'));
$('adminAccountForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const p1=$('adminNewPassword').value,p2=$('adminNewPassword2').value;
  if(p1.length<6)return toast('管理密碼至少 6 碼');
  if(p1!==p2)return toast('兩次密碼不一致');
  const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;b.textContent='更新中…';
  const{error}=await db.auth.updateUser({password:p1});
  b.disabled=false;b.textContent='更新密碼';
  if(error)return toast('密碼更新失敗：'+error.message);
  $('adminAccountDialog').close();$('adminAccountForm').reset();toast('管理密碼已更新');
});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
document.querySelectorAll('.tab[data-tab]').forEach(b=>b.addEventListener('click',async()=>{document.querySelectorAll('.tab[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.tab-page').forEach(p=>p.classList.add('hidden'));$('tab-'+b.dataset.tab).classList.remove('hidden');if(b.dataset.tab==='logs')await loadLogs()}));

async function migrateLegacyAdminSession(){
  if(legacyAdminChecked)return;
  legacyAdminChecked=true;
  if(localStorage.getItem('class-lunch-admin-no-legacy-migrate')==='1')return;
  const{data:{session:current}}=await db.auth.getSession();
  if(current)return;
  const{data:{session:legacy}}=await legacyDb.auth.getSession();
  if(!legacy?.user?.email)return;
  const{data:legacyAdmin}=await legacyDb.from('admin_users').select('email').eq('email',legacy.user.email).maybeSingle();
  if(!legacyAdmin)return;
  await db.auth.setSession({access_token:legacy.access_token,refresh_token:legacy.refresh_token});
}
async function refresh(){
  await migrateLegacyAdminSession();
  const ok=await isAdmin();$('loginBox').classList.toggle('hidden',ok);$('adminApp').classList.toggle('hidden',!ok);$('loginStatus').textContent=ok?'已登入管理者':'登入後管理菜單、日期、學生與付款。';
  if(!ok){stopAdminRealtime();return}
  startAdminRealtime();
  $('sessionDate').value=today();
  await Promise.all([loadTemplates(),loadSessions(),loadStudents()]);
  renderTemplateSelect();renderSessionList();renderStudentList();renderOverviewSelect();renderInitStatus();
}
async function loadTemplates(){const{data,error}=await db.from('menu_templates').select('*').order('created_at',{ascending:false});if(error)return toast(error.message);templates=data||[];$('templateCount').textContent=templates.length+' 份';renderTemplateList()}
async function loadSessions(){const{data,error}=await db.from('meal_sessions').select('*,menu_templates(name,image_url)').order('meal_date',{ascending:false}).order('created_at',{ascending:false});if(error)return toast(error.message);sessions=data||[];$('sessionCount').textContent=sessions.length+' 個';renderSessionList();renderOverviewSelect()}
async function loadStudents(){const{data,error}=await db.from('students').select('id,auth_user_id,seat_number,name,active,must_setup,created_at').order('seat_number');if(error)return toast(error.message);students=data||[];$('studentCount').textContent=students.length+' 人';renderStudentList();renderInitStatus()}

function renderTemplateSelect(){
  $('sessionTemplate').innerHTML=templates.filter(t=>t.active).map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('');
  $('editSessionTemplate').innerHTML=templates.map(t=>'<option value="'+t.id+'">'+esc(t.name)+(t.active?'':'（停用）')+'</option>').join('');
}
function renderTemplateList(){$('templateList').innerHTML=templates.map(t=>'<div class="admin-item">'+(t.image_url?'<img src="'+esc(t.image_url)+'" alt="">':'<div></div>')+'<div><b>'+esc(t.name)+'</b><br><span class="hint">'+(t.active?'使用中':'已停用')+'</span></div><div class="actions"><button class="small-btn" onclick="openTemplateDialog('+t.id+')">編輯</button></div></div>').join('')||'<div class="loading">尚無菜單</div>'}
function renderSessionList(){$('sessionList').innerHTML=sessions.map(s=>'<div class="admin-item">'+(s.menu_templates?.image_url?'<img src="'+esc(s.menu_templates.image_url)+'" alt="">':'<div></div>')+'<div><b>'+esc(s.menu_templates?.name||'菜單')+'</b><br>'+esc(s.meal_date)+(s.cutoff_at?' · 截止 '+esc(new Date(s.cutoff_at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):'')+'<br><span class="hint">'+(s.is_active?'開放':'關閉')+'</span></div><div class="actions"><button class="small-btn" onclick="openSessionDialog('+s.id+')">編輯</button></div></div>').join('')||'<div class="loading">尚無日期</div>'}
function renderStudentList(){$('studentList').innerHTML=students.map(s=>'<div class="student-row"><span class="seat-badge">'+s.seat_number+'號</span><div><b>'+esc(s.name||'尚未設定姓名')+'</b><br><span class="hint">'+(s.auth_user_id?'帳號已建立':'尚未初始化')+' · '+(s.active?'啟用中':'已停用')+(s.must_setup?' · 待首次設定':'')+'</span></div><div class="actions"><button class="small-btn" onclick="openStudentDialog(\''+s.id+'\')">編輯</button></div></div>').join('')||'<div class="loading">尚無學生</div>'}
function renderInitStatus(){if(!$('initStatus'))return;const linked=students.filter(s=>s.auth_user_id).length;$('initStatus').textContent='Auth 帳號 '+linked+' / '+students.length+' 已建立';$('initStudentsBtn').disabled=students.length>0&&linked===students.length;$('initStudentsBtn').textContent=linked===students.length?'學生帳號已完成':'初始化學生帳號'}

$('initStudentsBtn').addEventListener('click',async()=>{
  if(!confirm('確定建立／補齊 1～35 與 99 的學生登入帳號？此動作只需執行一次。'))return;
  const b=$('initStudentsBtn');b.disabled=true;b.textContent='初始化中…';
  const{data,error}=await db.functions.invoke('class-lunch-students',{body:{action:'seed_defaults'}});
  if(error||data?.error){b.disabled=false;b.textContent='重新初始化';return toast('初始化失敗：'+(data?.detail||data?.error||error.message))}
  const failed=(data?.results||[]).filter(x=>!x.ok);
  if(failed.length){b.disabled=false;b.textContent='重新初始化';toast('仍有 '+failed.length+' 個帳號未完成')}else toast('學生帳號初始化完成');
  await loadStudents();
});

$('templateForm').addEventListener('submit',async e=>{
  e.preventDefault();const f=$('templateImage').files[0],name=$('templateName').value.trim();if(!f||!name)return;if(f.size>6*1024*1024)return toast('圖片請小於 6MB');
  const url=await uploadMenuImage(f);if(!url)return;const{error}=await db.from('menu_templates').insert({name,image_url:url,active:true});if(error)return toast(error.message);
  e.target.reset();toast('菜單已存入');await loadTemplates();renderTemplateSelect();
});
async function uploadMenuImage(f){const ext=(f.name.split('.').pop()||'jpg').toLowerCase(),path='templates/'+crypto.randomUUID()+'.'+ext;const{error}=await db.storage.from('menu-images').upload(path,f,{contentType:f.type,upsert:false});if(error){toast('圖片上傳失敗：'+error.message);return null}return db.storage.from('menu-images').getPublicUrl(path).data.publicUrl}
async function openTemplateDialog(id){
  const t=templates.find(x=>x.id===id);if(!t)return;
  editingTemplateId=id;
  $('editTemplateName').value=t.name;$('editTemplateActive').checked=t.active;$('editTemplateImage').value='';$('ocrRawText').value='';$('ocrProgress').textContent='';
  const{data,error}=await db.from('menu_items').select('id,category,name,price,is_market_price,active,sort_order').eq('menu_template_id',id).order('sort_order').order('id');
  if(error)return toast('讀取品項失敗：'+error.message);
  menuEditorItems=(data||[]).map(x=>({...x}));
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
$('templateEditForm').addEventListener('submit',async e=>{
  e.preventDefault();const t=templates.find(x=>x.id===editingTemplateId);if(!t)return;
  const name=$('editTemplateName').value.trim();if(!name)return toast('菜單名稱不能空白');
  const patch={name,active:$('editTemplateActive').checked,updated_at:new Date().toISOString()},f=$('editTemplateImage').files[0];
  if(f){if(f.size>6*1024*1024)return toast('圖片請小於 6MB');const url=await uploadMenuImage(f);if(!url)return;patch.image_url=url}
  const{error}=await db.from('menu_templates').update(patch).eq('id',editingTemplateId);if(error)return toast(error.message);
  const cleaned=menuEditorItems.map((x,i)=>({menu_template_id:editingTemplateId,category:String(x.category||'').trim(),name:String(x.name||'').trim(),price:x.is_market_price?0:Number(x.price||0),is_market_price:!!x.is_market_price,active:x.active!==false,sort_order:i})).filter(x=>x.name);
  if(cleaned.some(x=>!Number.isInteger(x.price)||x.price<0||x.price>10000))return toast('品項價格格式不正確');
  const del=await db.from('menu_items').delete().eq('menu_template_id',editingTemplateId);if(del.error)return toast('品項更新失敗：'+del.error.message);
  if(cleaned.length){const ins=await db.from('menu_items').insert(cleaned);if(ins.error)return toast('品項儲存失敗：'+ins.error.message)}
  $('templateDialog').close();toast('菜單與品項已更新');await loadTemplates();renderTemplateSelect();await loadSessions();
});

$('sessionForm').addEventListener('submit',async e=>{
  e.preventDefault();const cutoff=$('sessionCutoff').value;
  const{error}=await db.from('meal_sessions').insert({menu_template_id:Number($('sessionTemplate').value),meal_date:$('sessionDate').value,cutoff_at:cutoff?new Date(cutoff).toISOString():null,is_active:$('sessionActive').checked});
  if(error)return toast(error.message);toast('訂餐日期已新增');$('sessionCutoff').value='';await loadSessions();
});
function localDatetime(v){if(!v)return'';const d=new Date(v),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())}
function openSessionDialog(id){const s=sessions.find(x=>x.id===id);if(!s)return;editingSessionId=id;$('editSessionTemplate').value=String(s.menu_template_id);$('editSessionDate').value=s.meal_date;$('editSessionCutoff').value=localDatetime(s.cutoff_at);$('editSessionActive').checked=s.is_active;$('sessionDialog').showModal()}
$('sessionEditForm').addEventListener('submit',async e=>{
  e.preventDefault();const cutoff=$('editSessionCutoff').value;
  const{error}=await db.from('meal_sessions').update({menu_template_id:Number($('editSessionTemplate').value),meal_date:$('editSessionDate').value,cutoff_at:cutoff?new Date(cutoff).toISOString():null,is_active:$('editSessionActive').checked,updated_at:new Date().toISOString()}).eq('id',editingSessionId);
  if(error)return toast(error.message);$('sessionDialog').close();toast('訂餐日期已更新');await loadSessions();
});
$('deleteSessionBtn').addEventListener('click',async()=>{
  const s=sessions.find(x=>x.id===editingSessionId);if(!s)return;
  if(!confirm('確定刪除 '+s.meal_date+' 的訂餐日期？若已有訂單，相關訂單也會一起刪除。'))return;
  const{error}=await db.from('meal_sessions').delete().eq('id',editingSessionId);if(error)return toast(error.message);
  $('sessionDialog').close();toast('訂餐日期已刪除');await loadSessions();
});

function openStudentDialog(id){const s=students.find(x=>x.id===id);if(!s)return;editingStudentId=id;$('editStudentSeat').textContent=s.seat_number+'號';$('editStudentName').value=s.name||'';$('editStudentActive').checked=s.active;$('editStudentPassword').value='';$('studentDialog').showModal()}
$('studentEditForm').addEventListener('submit',async e=>{
  e.preventDefault();const s=students.find(x=>x.id===editingStudentId);if(!s)return;
  const name=$('editStudentName').value.trim(),active=$('editStudentActive').checked,pw=$('editStudentPassword').value;
  const{data,error}=await db.functions.invoke('class-lunch-students',{body:{action:'update',student_id:s.id,name,active}});
  if(error||data?.error)return toast('更新失敗：'+(data?.detail||data?.error||error.message));
  if(pw){
    if(!(s.seat_number===99&&pw==='099')&&pw.length<4)return toast('密碼至少 4 碼');
    const r=await db.functions.invoke('class-lunch-students',{body:{action:'reset_password',student_id:s.id,password:pw}});
    if(r.error||r.data?.error)return toast('資料已更新，但密碼重設失敗');
  }
  $('studentDialog').close();toast('學生資料已更新');await loadStudents();
});

function renderOverviewSelect(){const cur=$('overviewSession').value;$('overviewSession').innerHTML=sessions.map(s=>'<option value="'+s.id+'">'+esc(s.meal_date+' '+(s.menu_templates?.name||'菜單'))+'</option>').join('');if(cur&&sessions.some(s=>String(s.id)===cur))$('overviewSession').value=cur;$('overviewSession').onchange=loadOverview;if(sessions.length)loadOverview();else $('seatPayments').innerHTML='<div class="loading">尚無訂餐日期</div>'}
async function loadOverview(){
  const id=Number($('overviewSession').value);if(!id)return;
  const s=sessions.find(x=>x.id===id),legacy=s?.legacy_menu_id||-1;
  const{data:os,error}=await db.from('orders').select('id,student_id,student_name,item_name,unit_price,note,paid,quantity').or('meal_session_id.eq.'+id+',menu_id.eq.'+legacy);
  if(error)return toast(error.message);
  const list=os||[],paid=list.filter(o=>o.paid).length,total=list.reduce((a,o)=>a+Number(o.unit_price||0)*Number(o.quantity||1),0);
  $('statOrders').textContent=list.length;$('statPaid').textContent=paid;$('statUnpaidCount').textContent=list.length-paid;

  const itemCounts=new Map(),normalizedOrders=new Set(),marketByOrder=new Map(),unresolvedOrders=new Set(),orderIds=list.map(o=>o.id);
  if(orderIds.length){
    const{data:oi,error:oie}=await db.from('order_items').select('id,order_id,quantity,unit_price,is_market_price,market_price_amount,menu_items(name,is_market_price)').in('order_id',orderIds);
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
      itemCounts.set(displayName,(itemCounts.get(displayName)||0)+Number(row.quantity||1));
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
  const totalQty=itemRows.reduce((a,x)=>a+x[1],0);
  const sessionLabel=[s?.meal_date,s?.menu_templates?.name||'菜單'].filter(Boolean).join(' ');
  latestOverviewCopyText=[
    '【'+sessionLabel+' 訂餐統計】',
    ...(itemRows.length?itemRows.map(([name,qty])=>name+'：'+qty+'份'):['目前沒有品項']),
    '────────',
    '總份數：'+totalQty+'份',
    '已訂：'+list.length+'人',
    '已付款：'+paid+'人｜未付款：'+(list.length-paid)+'人',
    '總金額：'+money(total)+(unresolvedOrders.size?' ＋ 時價':'')
  ].join('\n');
  $('itemStats').innerHTML='<div class="item-stats-head"><h3>品項統計</h3><div class="btnrow"><span>'+totalQty+' 份</span><button class="small-btn" type="button" onclick="copyOverviewStats()">一鍵複製 LINE</button></div></div>'+
    (itemRows.length?'<div class="item-stats-table">'+itemRows.map(([name,qty])=>'<div class="item-stat-row"><span>'+esc(name)+(name.includes('（時價）')?' <em class="market-badge">時價</em>':'')+'</span><b>'+qty+' 份</b></div>').join('')+'</div>':'<div class="loading">目前沒有品項</div>');

  const bySeat=new Map();for(const o of list){const st=students.find(s=>s.id===o.student_id),seat=st?.seat_number||Number(o.student_name);if(seat)bySeat.set(seat,{...o,name:st?.name||''})}
  const seats=[...Array.from({length:35},(_,i)=>i+1),99];
  $('seatPayments').innerHTML='<div class="seat-grid">'+seats.map(n=>{
    const o=bySeat.get(n),st=students.find(s=>s.seat_number===n),hasMarket=o&&marketByOrder.has(o.id),unresolved=o&&unresolvedOrders.has(o.id);
    return '<div class="seat-card '+(!o?'seat-empty':o.paid?'seat-paid':'seat-unpaid')+'"><b>'+n+'號'+(st?.name?' '+esc(st.name):'')+'</b><span>'+(!o?'未訂':o.paid?'✓ 已付款':'未付款')+'</span>'+
      (o?'<strong>'+esc(o.item_name)+' · '+money(o.unit_price)+(unresolved?' ＋ 時價':'')+'</strong><small>'+esc(o.note||'')+'</small><div>'+
      (hasMarket?'<button class="small-btn market-btn" onclick="openMarketPriceDialog('+o.id+','+n+')">設定時價</button> ':'')+
      '<button class="small-btn" onclick="togglePaid('+o.id+','+(!o.paid)+')">'+(o.paid?'改未付':'標記付款')+'</button> <button class="small-btn danger" onclick="deleteOrder('+o.id+')">刪除</button></div>':'')+'</div>';
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
async function openMarketPriceDialog(orderId,seat){
  editingMarketOrderId=orderId;
  $('marketPriceSeat').textContent=seat+'號訂單';
  const{data,error}=await db.from('order_items')
    .select('id,quantity,unit_price,is_market_price,market_price_amount,menu_items(name)')
    .eq('order_id',orderId)
    .order('id');
  if(error)return toast('讀取時價品項失敗：'+error.message);
  const rows=data||[];
  marketOrderItems=rows.filter(x=>x.is_market_price);
  marketFixedTotal=rows.filter(x=>!x.is_market_price).reduce((s,x)=>s+Number(x.unit_price||0)*Number(x.quantity||1),0);
  if(!marketOrderItems.length)return toast('這張訂單沒有時價品項');
  $('marketPriceRows').innerHTML=marketOrderItems.map(x=>
    '<label class="market-price-row"><span><b>'+esc(x.menu_items?.name||'時價品項')+'</b><small>數量 '+Number(x.quantity||1)+'</small></span>'+
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

async function togglePaid(id,n){const{error}=await db.from('orders').update({paid:n}).eq('id',id);if(error)return toast(error.message);toast(n?'已付款':'已改未付款');loadOverview()}
async function deleteOrder(id){if(!confirm('確定刪除這筆訂單？'))return;const{error}=await db.from('orders').delete().eq('id',id);if(error)return toast(error.message);toast('已刪除');loadOverview()}

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
  const{data,error}=await db.from('class_lunch_audit_logs').select('id,actor_user_id,actor_email,actor_type,action,entity_type,entity_id,detail,created_at').order('created_at',{ascending:false}).limit(100);
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
    }
  },350);
}
function startAdminRealtime(){
  if(realtimeChannel)return;
  realtimeChannel=db.channel('class-lunch-admin-realtime')
    .on('postgres_changes',{event:'*',schema:'public',table:'orders'},()=>scheduleAdminRealtimeRefresh('orders'))
    .on('postgres_changes',{event:'*',schema:'public',table:'order_items'},()=>scheduleAdminRealtimeRefresh('orders'))
    .on('postgres_changes',{event:'*',schema:'public',table:'meal_sessions'},()=>scheduleAdminRealtimeRefresh('sessions'))
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_items'},()=>scheduleAdminRealtimeRefresh('orders'))
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_templates'},()=>scheduleAdminRealtimeRefresh('sessions'))
    .subscribe();
}
function stopAdminRealtime(){
  clearTimeout(realtimeTimer);
  if(realtimeChannel){db.removeChannel(realtimeChannel);realtimeChannel=null}
}
db.auth.onAuthStateChange(()=>setTimeout(refresh,0));refresh();