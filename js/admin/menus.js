function renderTemplateSelect(){
  const activeOptions=templates.filter(t=>t.active).map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('');
  $('sessionTemplate').innerHTML=activeOptions;
  if($('sessionBackupTemplate'))$('sessionBackupTemplate').innerHTML=activeOptions;
  $('editSessionTemplate').innerHTML=templates.map(t=>'<option value="'+t.id+'">'+esc(t.name)+(t.active?'':'（停用）')+'</option>').join('');
}
function restaurantStatusLabel(status){
  return ({pending:'尚未確認',awaiting:'等待餐廳確認',confirmed:'餐廳已接單',failed:'餐廳未接單',not_selected:'備用未採用'})[status]||status||'尚未確認';
}
function backupGroupStatusLabel(status){
  return ({collecting:'等待選擇採用菜單',awaiting_restaurant:'等待餐廳確認',confirmed:'已完成',cancelled:'兩邊皆未接單'})[status]||status||'';
}
function renderTemplateList(){$('templateList').innerHTML=templates.map(t=>'<div class="admin-item">'+(t.image_url?'<img src="'+esc(t.image_url)+'" alt="">':'<div></div>')+'<div><b>'+esc(t.name)+'</b><br><span class="hint">'+(t.active?'使用中':'已停用')+'</span></div><div class="actions"><button class="small-btn" onclick="openTemplateDialog('+t.id+')">編輯</button></div></div>').join('')||'<div class="loading">尚無菜單</div>'}
function renderSessionList(){
  const current=sessions.filter(s=>s.meal_date>=today()).sort((a,b)=>a.meal_date.localeCompare(b.meal_date)||Number(a.id)-Number(b.id));
  const grouped=new Map();
  for(const s of current){
    const key=s.backup_group_id?'g:'+s.backup_group_id:'s:'+s.id;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(s);
  }
  $('sessionCount').textContent=grouped.size+' 個';
  $('sessionList').innerHTML=[...grouped.values()].map(rows=>{
    const s=rows[0];
    if(s.backup_group_id){
      const sorted=rows.slice().sort((a,b)=>String(a.backup_slot||'').localeCompare(String(b.backup_slot||'')));
      const group=s.meal_session_groups||{};
      const optionHtml=sorted.map(x=>{
        const selected=Number(group.selected_session_id)===Number(x.id);
        return '<div class="history-pack-order"><span><b>'+esc((x.backup_slot||'?')+'｜'+(x.menu_templates?.name||'菜單'))+'</b><small>'+esc(restaurantStatusLabel(x.restaurant_status))+(selected?' · 本次採用':'')+'</small></span><div class="actions">'+
          (group.status==='collecting'&&x.restaurant_status!=='failed'?'<button class="small-btn" type="button" onclick="adminSelectBackup('+s.backup_group_id+','+x.id+')">採用 '+esc(x.backup_slot||'')+'</button>':'')+
          '</div></div>';
      }).join('');
      const action=group.status==='awaiting_restaurant'
        ?'<div class="btnrow"><button class="primary" type="button" onclick="adminConfirmBackup('+s.backup_group_id+')">餐廳接單成功</button><button class="small-btn danger" type="button" onclick="adminFailBackup('+s.backup_group_id+')">餐廳接單失敗</button></div>'
        :'';
      return '<div class="panel"><div class="section-head"><div><b>'+esc(s.meal_date+' 複選備用')+'</b><br><span class="hint">'+esc(backupGroupStatusLabel(group.status))+(s.cutoff_at?' · 截止 '+esc(new Date(s.cutoff_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):'')+'</span></div></div>'+optionHtml+action+'</div>';
    }
    const status=restaurantStatusLabel(s.restaurant_status);
    const actions=s.restaurant_status==='pending'
      ?'<button class="small-btn" onclick="openSessionDialog('+s.id+')">編輯</button> <button class="small-btn" onclick="adminSingleRestaurantResult('+s.id+',true)">接單成功</button> <button class="small-btn danger" onclick="adminSingleRestaurantResult('+s.id+',false)">接單失敗</button>'
      :'<button class="small-btn" onclick="openSessionDialog('+s.id+')">編輯</button>';
    return '<div class="admin-item">'+(s.menu_templates?.image_url?'<img src="'+esc(s.menu_templates.image_url)+'" alt="">':'<div></div>')+'<div><b>'+esc(s.menu_templates?.name||'菜單')+'</b><br>'+esc(s.meal_date)+(s.cutoff_at?' · 截止 '+esc(new Date(s.cutoff_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):'')+'<br><span class="hint">'+(s.is_active?'開放':'關閉')+' · '+esc(status)+'</span></div><div class="actions">'+actions+'</div></div>';
  }).join('')||'<div class="loading">今天起沒有訂餐日期</div>';
}
async function adminSelectBackup(groupId,sessionId){
  if(!confirm('確定採用這份菜單並開始跟餐廳確認？此時還不會扣學生錢包。'))return;
  const{error}=await db.rpc('class_lunch_admin_select_backup_session',{p_group_id:Number(groupId),p_session_id:Number(sessionId)});
  if(error)return toast('選擇失敗：'+error.message);
  toast('已選擇菜單，等待餐廳確認');await loadSessions();
}
async function adminConfirmBackup(groupId){
  if(!confirm('確認餐廳已接單？按下後才會正式成立訂單；選錢包的學生會在此刻扣款。'))return;
  const{data,error}=await db.rpc('class_lunch_admin_confirm_backup_group',{p_group_id:Number(groupId)});
  if(error)return toast('確認失敗：'+error.message);
  toast('餐廳接單成功，正式成立 '+Number(data?.wallet_charged||0)+' 筆錢包訂單');
  await Promise.all([loadSessions(),loadUnpaidOrders().catch(()=>{})]);
  window.loadWalletDebts?.().catch?.(()=>{});
}
async function adminFailBackup(groupId){
  if(!confirm('確認這家餐廳無法接單？這個選項會取消，不會產生債務；若另一份備用仍可用，可直接改採另一份。'))return;
  const{data,error}=await db.rpc('class_lunch_admin_fail_backup_selection',{p_group_id:Number(groupId)});
  if(error)return toast('標記失敗：'+error.message);
  toast(Number(data?.remaining_options||0)>0?'已取消失敗菜單，可改選備用菜單':'A、B 都已失敗，本次訂餐取消');
  await Promise.all([loadSessions(),loadUnpaidOrders().catch(()=>{})]);
}
async function adminSingleRestaurantResult(sessionId,success){
  const msg=success
    ?'確認餐廳已接單？'
    :'確認餐廳無法接單？這會取消本次所有債務；已用錢包付款的訂單會自動退款。';
  if(!confirm(msg))return;
  const{data,error}=await db.rpc('class_lunch_admin_set_single_restaurant_result',{p_session_id:Number(sessionId),p_success:!!success});
  if(error)return toast((success?'確認':'取消')+'失敗：'+error.message);
  toast(success?'已標記餐廳接單成功':'餐廳未接單，本次債務已取消'+(Number(data?.cancelled_orders||0)?'（'+Number(data.cancelled_orders)+' 筆）':''));
  await Promise.all([loadSessions(),loadUnpaidOrders().catch(()=>{})]);
}
window.adminSelectBackup=adminSelectBackup;
window.adminConfirmBackup=adminConfirmBackup;
window.adminFailBackup=adminFailBackup;
window.adminSingleRestaurantResult=adminSingleRestaurantResult;
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

