(()=>{'use strict';
const STORAGE_KEY='class-lunch-music-enabled-v1';
let enabled=true;try{enabled=localStorage.getItem(STORAGE_KEY)!=='false'}catch(_){}
const audio=new Audio('./lunch-background-music.mp3');
audio.loop=true;audio.preload='none';audio.volume=.35;
const button=document.getElementById('musicToggleButton');
const render=()=>{if(!button)return;button.textContent=enabled?'音樂：開啟':'音樂：關閉';button.setAttribute('aria-label',enabled?'關閉背景音樂':'開啟背景音樂');button.setAttribute('aria-pressed',String(enabled));};
const play=()=>{if(enabled&&audio.paused)audio.play().catch(()=>{});};
document.addEventListener('pointerdown',play,{capture:true});
document.addEventListener('keydown',play,{capture:true});
if(button)button.addEventListener('click',()=>{enabled=!enabled;try{localStorage.setItem(STORAGE_KEY,String(enabled))}catch(_){}if(enabled)play();else audio.pause();render()});
audio.addEventListener('error',()=>{if(button){button.disabled=true;button.textContent='音樂無法載入';}console.warn('Background music audio file unavailable')});
render();
})();