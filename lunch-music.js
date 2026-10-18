(()=>{'use strict';
const STORAGE_KEY='class-lunch-music-enabled-v1';
let enabled=true;try{enabled=localStorage.getItem(STORAGE_KEY)!=='false'}catch(_){}
const DEFAULT_TRACK='./lunch-background-new.mp3';
const FALLBACK_TRACK='./lunch-background-music.mp3';
const SPECIAL_TRACK='./lunch-special-11216-9901.mp3';
let accountKey='';
const audio=new Audio(DEFAULT_TRACK);
window.classLunchSetMusicAccount=(student)=>{
 const klass=String(student?.classes?.code||'').trim();
 const seat=Number(student?.seat_number);
 const nextKey=klass+':'+seat;
 if(nextKey===accountKey)return;
 accountKey=nextKey;
 const special=(klass==='112'&&seat===16)||(klass==='99'&&seat===1);
 const target=special?SPECIAL_TRACK:DEFAULT_TRACK;
 if(audio.getAttribute('data-track')===target)return;
 const wasPlaying=!audio.paused;
 audio.pause();audio.src=target;audio.setAttribute('data-track',target);audio.load();
 if(enabled&&wasPlaying)audio.play().catch(()=>{});
};
audio.loop=true;audio.preload='none';audio.volume=1;
const button=document.getElementById('musicToggleButton');
const render=()=>{if(!button)return;button.textContent=enabled?'音樂：開啟':'音樂：關閉';button.setAttribute('aria-label',enabled?'關閉背景音樂':'開啟背景音樂');button.setAttribute('aria-pressed',String(enabled));};
const play=()=>{if(enabled&&audio.paused)audio.play().catch(()=>{});};
document.addEventListener('pointerdown',play,{capture:true});
document.addEventListener('keydown',play,{capture:true});
if(button)button.addEventListener('click',()=>{enabled=!enabled;try{localStorage.setItem(STORAGE_KEY,String(enabled))}catch(_){}if(enabled)play();else audio.pause();render()});
audio.addEventListener('error',()=>{
 if(audio.getAttribute('data-track')===SPECIAL_TRACK||audio.getAttribute('data-track')===DEFAULT_TRACK){
  audio.src=FALLBACK_TRACK;audio.setAttribute('data-track',FALLBACK_TRACK);audio.load();
  console.warn('Requested background track unavailable; using previous default');
  return;
 }
 if(button){button.disabled=true;button.textContent='音樂無法載入';}
 console.warn('Background music audio file unavailable');
});
render();
})();