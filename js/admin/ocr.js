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

$('sessionMode')?.addEventListener('change',()=>{
  const backup=$('sessionMode').value==='backup';
  $('sessionBackupTemplateLabel')?.classList.toggle('hidden',!backup);
  if($('sessionBackupTemplate'))$('sessionBackupTemplate').required=backup;
});
$('sessionForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const cutoff=$('sessionCutoff').value;
  const mode=$('sessionMode')?.value||'single';
  let error=null;
  if(mode==='backup'){
    const a=Number($('sessionTemplate').value),b=Number($('sessionBackupTemplate').value);
    if(!a||!b)return toast('請選擇 A、B 兩份菜單');
    if(a===b)return toast('A、B 必須選不同菜單');
    const r=await db.rpc('class_lunch_admin_create_backup_group',{
      p_menu_a:a,p_menu_b:b,p_meal_date:$('sessionDate').value,
      p_cutoff_at:cutoff?new Date(cutoff+':00+08:00').toISOString():null,
      p_is_active:$('sessionActive').checked
    });
    error=r.error;
  }else{
    const r=await db.from('meal_sessions').insert({
      menu_template_id:Number($('sessionTemplate').value),meal_date:$('sessionDate').value,
      cutoff_at:cutoff?new Date(cutoff+':00+08:00').toISOString():null,is_active:$('sessionActive').checked
    });
    error=r.error;
  }
  if(error)return toast(error.message);
  toast(mode==='backup'?'A／B 備用訂餐已新增':'訂餐日期已新增');
  applyDefaultSessionCutoff(true);await loadSessions();
});
