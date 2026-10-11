(()=>{'use strict';
const STORAGE_KEY='class-lunch-music-enabled-v1';
let enabled=true;try{enabled=localStorage.getItem(STORAGE_KEY)!=='false'}catch(_){}
const audio=new Audio('./lunch-background-music.mp3');
audio.loop=true;audio.preload='none';audio.volume=.35;
const button=document.createElement('button');button.type='button';button.id='musicToggleButton';
button.style.cssText='position:fixed;right:14px;bottom:58px;z-index:999;min-height:44px;min-width:44px;padding:10px 12px;border:1px solid #d6b98b;border-radius:24px;background:#fff8e8;color:#62411d;box-shadow:0 3px 12px #0002;font-size:14px;font-weight:700;cursor:pointer';
const render=()=>{button.textContent=enabled?'♫ 音樂開':'♪ 音樂關';button.setAttribute('aria-label',enabled?'關閉背景音樂':'開啟背景音樂');button.setAttribute('aria-pressed',String(enabled));};
const play=()=>{if(enabled&&audio.paused)audio.play().catch(()=>{});};
document.addEventListener('pointerdown',play,{capture:true});document.addEventListener('keydown',play,{capture:true});
button.addEventListener('click',()=>{enabled=!enabled;try{localStorage.setItem(STORAGE_KEY,String(enabled))}catch(_){}if(enabled)play();else audio.pause();render()});
audio.addEventListener('error',()=>{button.hidden=true;console.warn('Background music audio file unavailable')});
render();const mount=()=>document.body.appendChild(button);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();