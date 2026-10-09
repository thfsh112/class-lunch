function closePrettySelects(except=null){
  document.querySelectorAll('.pretty-select.open').forEach(root=>{
    if(root===except)return;
    root.classList.remove('open');
    root.querySelector('.pretty-select-trigger')?.setAttribute('aria-expanded','false');
  });
}
function togglePrettySelect(event,button){
  event.preventDefault();
  event.stopPropagation();
  const root=button.closest('.pretty-select');
  if(!root)return;
  const opening=!root.classList.contains('open');
  closePrettySelects(root);
  root.classList.toggle('open',opening);
  button.setAttribute('aria-expanded',opening?'true':'false');
  if(opening){
    requestAnimationFrame(()=>{
      root.querySelector('.pretty-select-option.selected')?.scrollIntoView({block:'nearest'});
    });
  }
}
function closePrettySelectMenu(event,el){
  event?.preventDefault();
  event?.stopPropagation();
  const root=el?.closest?.('.pretty-select');
  if(!root)return;
  root.classList.remove('open');
  root.querySelector('.pretty-select-trigger')?.setAttribute('aria-expanded','false');
}
document.addEventListener('click',event=>{
  if(!event.target.closest('.pretty-select'))closePrettySelects();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape')closePrettySelects();
});
function prettySelectMarkup({label,valueText,placeholder='請選擇',menuHtml,className=''}) {
  const hasValue=!!String(valueText||'').trim();
  return '<div class="pretty-select '+className+'">'+
    '<button type="button" class="pretty-select-trigger '+(hasValue?'has-value':'')+'" role="combobox" aria-haspopup="listbox" aria-expanded="false" onclick="togglePrettySelect(event,this)">'+
      (label?'<span class="pretty-select-kicker">'+esc(label)+'</span>':'')+
      '<span class="pretty-select-value">'+esc(hasValue?valueText:placeholder)+'</span>'+
      '<span class="pretty-select-chevron" aria-hidden="true"></span>'+
    '</button>'+
    '<button type="button" class="pretty-select-backdrop" tabindex="-1" aria-label="關閉選單" onclick="closePrettySelectMenu(event,this)"></button>'+
    '<div class="pretty-select-menu" role="listbox">'+menuHtml+'</div>'+
  '</div>';
}
function itemPickerMarkup(items,selected,rowIndex){
  const groups=new Map();
  for(const item of items){
    const cat=String(item.category||'其他').trim()||'其他';
    if(!groups.has(cat))groups.set(cat,[]);
    groups.get(cat).push(item);
  }
  const current=items.find(x=>Number(x.id)===Number(selected));
  let menu='<button type="button" class="pretty-select-option '+(!selected?'selected':'')+'" role="option" aria-selected="'+(!selected)+'" onclick="updateTestOrderItem('+rowIndex+',\'\')"><span>請選擇餐點</span></button>';
  for(const [cat,rows] of groups){
    menu+='<div class="pretty-select-section"><div class="pretty-select-section-title">'+esc(cat)+'</div>'+
      rows.map(x=>{
        const selectedNow=Number(x.id)===Number(selected);
        return '<button type="button" class="pretty-select-option '+(selectedNow?'selected':'')+'" role="option" aria-selected="'+selectedNow+'" onclick="updateTestOrderItem('+rowIndex+','+x.id+')">'+
          '<span class="pretty-select-option-main"><b>'+esc(x.name)+'</b></span>'+
          '<span class="pretty-select-option-price '+(x.is_market_price?'market':'')+'">'+esc(x.is_market_price?'時價':money(x.price))+'</span>'+
        '</button>';
      }).join('')+'</div>';
  }
  return prettySelectMarkup({
    label:'餐點',
    valueText:current?(current.name+' · '+(current.is_market_price?'時價':money(current.price))):'',
    placeholder:'選擇餐點',
    menuHtml:menu,
    className:'pretty-select-main'
  });
}
function variantPickerMarkup(variants,selectedId,rowIndex){
  const current=variants.find(v=>Number(v.id)===Number(selectedId))||variants[0]||null;
  const menu=variants.map(v=>{
    const selectedNow=Number(v.id)===Number(selectedId);
    return '<button type="button" class="pretty-select-option '+(selectedNow?'selected':'')+'" role="option" aria-selected="'+selectedNow+'" onclick="updateTestOrderVariant('+rowIndex+','+v.id+')">'+
      '<span class="pretty-select-option-main"><b>'+esc(v.name)+'</b></span>'+
      (Number(v.price_delta||0)!==0?'<span class="pretty-select-option-price">'+esc(configDeltaLabel(v.price_delta).trim())+'</span>':'<span class="pretty-select-option-price included">原價</span>')+
    '</button>';
  }).join('');
  return prettySelectMarkup({
    label:'點餐方式',
    valueText:current?(current.name+configDeltaLabel(current.price_delta)):'',
    placeholder:'選擇點餐方式',
    menuHtml:menu
  });
}
function singleOptionPickerMarkup(group,choices,selectedIds,rowIndex){
  const selectedSet=new Set((selectedIds||[]).map(Number));
  const current=choices.find(ch=>selectedSet.has(Number(ch.id)))||null;
  const required=Number(group.min_select||0)>0;
  const menu=
    (!required?'<button type="button" class="pretty-select-option '+(!current?'selected':'')+'" role="option" aria-selected="'+(!current)+'" onclick="updateTestOrderSingleOption('+rowIndex+','+group.id+',\'\')"><span>不選</span></button>':'')+
    choices.map(ch=>{
      const selectedNow=selectedSet.has(Number(ch.id));
      const delta=Number(ch.price_delta||0);
      return '<button type="button" class="pretty-select-option '+(selectedNow?'selected':'')+'" role="option" aria-selected="'+selectedNow+'" onclick="updateTestOrderSingleOption('+rowIndex+','+group.id+','+ch.id+')">'+
        '<span class="pretty-select-option-main"><b>'+esc(ch.name)+'</b></span>'+
        '<span class="pretty-select-option-price '+(delta===0?'included':'')+'">'+esc(delta===0?'不加價':configDeltaLabel(delta).trim())+'</span>'+
      '</button>';
    }).join('');
  return '<div class="combo-field pretty-combo-field">'+
    '<div class="combo-field-head"><span>'+esc(group.name)+'</span><small class="'+(required?'required':'optional')+'">'+(required?'必選':'選填')+'</small></div>'+
    prettySelectMarkup({
      valueText:current?(current.name+configDeltaLabel(current.price_delta)):'',
      placeholder:'選擇'+group.name,
      menuHtml:menu
    })+
  '</div>';
}
function renderConfiguredControls(sel,i){
  if(!sel?.menu_item_id)return '';
  const item=getTestItemsForSession().find(x=>Number(x.id)===Number(sel.menu_item_id));
  if(!item)return '';
  const variants=variantsForItem(item.id);
  let html='';
  if(variants.length){
    html+='<div class="combo-field pretty-combo-field">'+variantPickerMarkup(variants,sel.variant_id,i)+'</div>';
  }
  for(const g of groupsForSelection(sel)){
    const choices=choicesForGroup(g.id);
    const selected=new Set((sel.option_ids||[]).map(Number));
    const req=Number(g.min_select||0)>0?'必選':'選填';
    const limit=Number(g.max_select||1)>1?' · 最多 '+g.max_select+' 個':'';
    if(Number(g.max_select||1)===1){
      html+=singleOptionPickerMarkup(g,choices,[...selected],i);
    }else{
      html+='<div class="combo-field"><div class="combo-field-head"><span>'+esc(g.name)+'</span><small class="'+(Number(g.min_select||0)>0?'required':'optional')+'">'+req+limit+'</small></div><div class="combo-choice-grid">'+
        choices.map(ch=>'<label class="combo-choice"><input type="checkbox" '+(selected.has(Number(ch.id))?'checked':'')+' onchange="toggleTestOrderOption('+i+','+g.id+','+ch.id+',this.checked)"><span>'+esc(ch.name)+'</span><b>'+esc(Number(ch.price_delta||0)===0?'':configDeltaLabel(ch.price_delta).trim())+'</b></label>').join('')+
        '</div></div>';
    }
  }
  return html;
}
function renderTestOrderRows(){
  const items=getTestItemsForSession();
  if(!testSelections.length)testSelections=[newConfiguredSelection()];
  testSelections=testSelections.map(sanitizeConfiguredSelection);
  while(testSelections.length>1&&!testSelections.at(-1)?.menu_item_id&&!testSelections.at(-2)?.menu_item_id)testSelections.pop();
  if(testSelections.at(-1)?.menu_item_id&&testSelections.length<20)testSelections.push(newConfiguredSelection());

  $('testOrderRows').innerHTML=testSelections.map((sel,i)=>{
    const removable=sel?.menu_item_id?'<button type="button" class="small-btn danger" onclick="removeTestOrderSelection('+i+')">移除</button>':'';
    const quote=sel?.menu_item_id?configuredSelectionQuote(sel):null;
    return '<div class="test-order-row combo-order-row">'+
      '<div class="combo-order-main">'+itemPickerMarkup(items,sel?.menu_item_id,i)+
      renderConfiguredControls(sel,i)+
      (sel?.menu_item_id?'<div class="combo-line-price">'+(quote?.error?'<span class="combo-error">'+esc(quote.error)+'</span>':'<span>'+money(quote.amount)+(quote.unresolvedMarket?' ＋ 時價':'')+'</span>')+'</div>':'')+
      '</div>'+removable+'</div>';
  }).join('');

  const quote=currentConfiguredQuote();
  $('selectedItemPrice').textContent=money(quote.amount)+(quote.unresolvedMarket?' ＋ 時價':'');
}
function updateTestOrderItem(i,value){
  testSelections[i]=newConfiguredSelection(value);
  renderTestOrderRows();
}
function updateTestOrderVariant(i,value){
  const current=sanitizeConfiguredSelection(testSelections[i]);
  current.variant_id=value?Number(value):null;
  current.option_ids=[];
  testSelections[i]=sanitizeConfiguredSelection(applyConfiguredDefaults(current));
  renderTestOrderRows();
}
function updateTestOrderSingleOption(i,groupId,value){
  const current=sanitizeConfiguredSelection(testSelections[i]);
  const groupChoiceIds=new Set(choicesForGroup(groupId).map(x=>Number(x.id)));
  current.option_ids=(current.option_ids||[]).filter(id=>!groupChoiceIds.has(Number(id)));
  if(value)current.option_ids.push(Number(value));
  testSelections[i]=current;
  renderTestOrderRows();
}
function toggleTestOrderOption(i,groupId,choiceId,checked){
  const current=sanitizeConfiguredSelection(testSelections[i]);
  const group=menuOptionGroups.find(g=>Number(g.id)===Number(groupId));
  let ids=new Set((current.option_ids||[]).map(Number));
  if(checked){
    const inGroup=[...ids].filter(id=>choicesForGroup(groupId).some(x=>Number(x.id)===id));
    if(inGroup.length>=Number(group?.max_select||1)){
      toast('「'+(group?.name||'此選項')+'」最多選 '+Number(group?.max_select||1)+' 個');
      return renderTestOrderRows();
    }
    ids.add(Number(choiceId));
  }else ids.delete(Number(choiceId));
  current.option_ids=[...ids];
  testSelections[i]=current;
  renderTestOrderRows();
}
function removeTestOrderSelection(i){
  testSelections.splice(i,1);
  renderTestOrderRows();
}
