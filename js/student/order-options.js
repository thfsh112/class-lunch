function getTestItemsForSession(){
  const s=sessions.find(x=>x.id===editingSessionId);
  return s?menuItems.filter(x=>x.menu_template_id===s.menu_template_id&&x.active!==false):[];
}
function variantsForItem(itemId){
  return menuVariants.filter(x=>Number(x.menu_item_id)===Number(itemId)&&x.active!==false)
    .sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||Number(a.id)-Number(b.id));
}
function groupsForSelection(sel){
  if(!sel?.menu_item_id)return [];
  return menuOptionGroups.filter(g=>
    Number(g.menu_item_id)===Number(sel.menu_item_id)&&
    g.active!==false&&
    (g.variant_id==null||Number(g.variant_id)===Number(sel.variant_id))
  ).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||Number(a.id)-Number(b.id));
}
function choicesForGroup(groupId){
  return menuOptionChoices.filter(x=>Number(x.group_id)===Number(groupId)&&x.active!==false)
    .sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||Number(a.id)-Number(b.id));
}
function applyConfiguredDefaults(sel){
  if(!sel?.menu_item_id)return sel;
  const ids=[];
  for(const g of groupsForSelection(sel)){
    const defaults=choicesForGroup(g.id).filter(x=>x.is_default).slice(0,Number(g.max_select||1));
    ids.push(...defaults.map(x=>Number(x.id)));
  }
  sel.option_ids=[...new Set(ids)];
  return sel;
}
function newConfiguredSelection(itemId=''){
  const id=Number(itemId)||null;
  if(!id)return {menu_item_id:null,variant_id:null,option_ids:[]};
  const variants=variantsForItem(id);
  const preferred=variants.find(x=>x.is_default)||variants[0]||null;
  return applyConfiguredDefaults({menu_item_id:id,variant_id:preferred?.id||null,option_ids:[]});
}
function sanitizeConfiguredSelection(sel){
  if(!sel?.menu_item_id)return newConfiguredSelection();
  const item=getTestItemsForSession().find(x=>Number(x.id)===Number(sel.menu_item_id));
  if(!item)return newConfiguredSelection();
  const variants=variantsForItem(item.id);
  let variantId=sel.variant_id==null?null:Number(sel.variant_id);
  if(variants.length&&!variants.some(v=>Number(v.id)===variantId)){
    variantId=(variants.find(v=>v.is_default)||variants[0])?.id||null;
  }
  if(!variants.length)variantId=null;
  const next={menu_item_id:Number(item.id),variant_id:variantId,option_ids:(sel.option_ids||[]).map(Number).filter(Number.isFinite)};
  const allowedGroups=groupsForSelection(next);
  const allowedChoices=new Set(allowedGroups.flatMap(g=>choicesForGroup(g.id).map(x=>Number(x.id))));
  next.option_ids=[...new Set(next.option_ids.filter(id=>allowedChoices.has(Number(id))))];
  return next;
}
function configDeltaLabel(n){
  const v=Number(n||0);
  return v===0?'':v>0?' ＋'+money(v):' −'+money(Math.abs(v));
}
function configuredSelectionQuote(raw){
  const sel=sanitizeConfiguredSelection(raw);
  const item=getTestItemsForSession().find(x=>Number(x.id)===Number(sel.menu_item_id));
  if(!item)return {amount:0,unresolvedMarket:false,error:'請選擇餐點'};
  const variants=variantsForItem(item.id);
  const variant=variants.find(v=>Number(v.id)===Number(sel.variant_id))||null;
  if(variants.length&&!variant)return {amount:0,unresolvedMarket:!!item.is_market_price,error:item.name+'：請選擇點餐方式'};
  let amount=item.is_market_price?0:Number(item.price||0);
  amount+=Number(variant?.price_delta||0);
  const groups=groupsForSelection(sel);
  for(const g of groups){
    const allowed=choicesForGroup(g.id);
    const allowedIds=new Set(allowed.map(x=>Number(x.id)));
    const selected=(sel.option_ids||[]).filter(id=>allowedIds.has(Number(id)));
    if(selected.length<Number(g.min_select||0)||selected.length>Number(g.max_select||1)){
      const need=Number(g.min_select)===Number(g.max_select)
        ?'必須選 '+Number(g.min_select)+' 個'
        :'需選 '+Number(g.min_select)+'～'+Number(g.max_select)+' 個';
      return {amount,unresolvedMarket:!!item.is_market_price,error:item.name+'：'+g.name+' '+need};
    }
    amount+=selected.reduce((sum,id)=>sum+Number(allowed.find(x=>Number(x.id)===Number(id))?.price_delta||0),0);
  }
  return {amount,unresolvedMarket:!!item.is_market_price,error:''};
}
function currentConfiguredQuote(){
  let amount=0,unresolvedMarket=false,error='';
  for(const raw of testSelections.filter(x=>x?.menu_item_id)){
    const q=configuredSelectionQuote(raw);
    amount+=Number(q.amount||0);
    unresolvedMarket=unresolvedMarket||q.unresolvedMarket;
    if(!error&&q.error)error=q.error;
  }
  return {amount,unresolvedMarket,error};
}
function buildStructuredOrderPayload(validate=true){
  const rows=testSelections.filter(x=>x?.menu_item_id).map(sanitizeConfiguredSelection);
  if(!rows.length){if(validate)throw new Error('至少選一個品項');return []}
  if(validate){
    for(const row of rows){
      const q=configuredSelectionQuote(row);
      if(q.error)throw new Error(q.error);
    }
  }
  const grouped=new Map();
  for(const row of rows){
    const normalized={menu_item_id:Number(row.menu_item_id),variant_id:row.variant_id==null?null:Number(row.variant_id),option_ids:[...(row.option_ids||[])].map(Number).sort((a,b)=>a-b)};
    const key=JSON.stringify(normalized);
    const old=grouped.get(key);
    if(old)old.qty+=1;
    else grouped.set(key,{...normalized,qty:1});
  }
  return [...grouped.values()];
}
