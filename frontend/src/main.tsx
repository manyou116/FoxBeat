import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import PetCanvas from './PetCanvas';
import { PetGesture } from './petGesture';
import { invoke, isTauri, listen } from './bridge';
import { DEFAULT_SETTINGS, type AppState } from './types';
import './pet.css';

const isPet = new URLSearchParams(location.search).get('view') === 'pet';
document.documentElement.classList.toggle('pet-document',isPet);
document.body.classList.toggle('pet-document',isPet);

function Pet() {
  const [state,setState]=useState<AppState>({settings:DEFAULT_SETTINGS,status:{state:'starting',message:''},adjusting:false,paused:false,hidden:false});
  const [count,setCount]=useState(0);
  const [directClicks,setDirectClicks]=useState(0);
  const [petting,setPetting]=useState(0);
  const [error,setError]=useState('');
  const gesture=useRef(new PetGesture());
  const dragOffset=useRef({x:0,y:0});
  const moving=useRef(false);
  const counters=useRef({count,directClicks});
  counters.current={count,directClicks};
  useEffect(()=>{
    if(!isTauri())return;
    const timer=window.setInterval(()=>{
      const canvas=document.querySelector('canvas');
      void invoke('pet_diagnostics',{received:counters.current.count,directClicks:counters.current.directClicks,frames:Number(canvas?.dataset.frames ?? 0),dancingFrames:Number(canvas?.dataset.dancingFrames ?? 0),motion:canvas?.dataset.motion ?? 'none',hidden:document.hidden}).catch(()=>{});
    },1000);
    return()=>clearInterval(timer);
  },[]);
  useEffect(()=>{
    let active=true;const cleanup:(()=>void)[]=[];
    async function start(){
      try {
        const off=await listen<AppState>('foxbeat://state',e=>{if(active)setState(e.payload);});
        if(!active){off();return;}cleanup.push(off);
        const offPulse=await listen<{count:number}>('foxbeat://pulse',e=>{if(active)setCount(v=>v+e.payload.count);});
        if(!active){offPulse();return;}cleanup.push(offPulse);
        const current=await invoke<AppState>('get_state');if(!active)return;setState(current);
        await invoke('pet_ready');
      }catch(e){if(active)setError(String(e));}
    }
    void start();return()=>{active=false;cleanup.forEach(off=>off());};
  },[]);
  const finish=()=>void invoke<AppState>('set_adjusting',{value:false}).then(setState).catch(e=>setError(String(e)));
  useEffect(()=>{
    if(!state.adjusting)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')finish();};
    document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);
  },[state.adjusting]);
  const startDrag=(e:React.PointerEvent)=>{
    if(e.button!==0)return;
    e.preventDefault();
    if(isTauri())void getCurrentWindow().startDragging().catch(err=>setError(String(err)));
  };
  const interact=()=>{
    if(state.paused||state.hidden||!gesture.current.click())return;
    setPetting(v=>v+1);
    setDirectClicks(v=>v+1);
  };
  return <div className={`desktop-pet${state.adjusting?' is-adjusting':''}`}>
    {state.adjusting&&<div className="pet-toolbar"><button className="pet-drag-handle" aria-label="按住拖动小舞伴" onPointerDown={startDrag}>⠿ 按住这里拖动</button><button onClick={finish}>完成</button></div>}
    <button type="button" className="pet-body" aria-label="点击小舞伴互动，按住拖动位置" title="点一下跳舞 · 按住拖动" style={{opacity:state.settings.opacity}}
      onPointerDown={e=>{if(e.button!==0)return;gesture.current.down(e.pointerId,e.screenX,e.screenY);dragOffset.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{
        gesture.current.move(e.pointerId,e.screenX,e.screenY);
        if(gesture.current.isDragging()&&!moving.current&&isTauri()){
          moving.current=true;
          void invoke('move_pet_from_pointer',{offsetX:dragOffset.current.x,offsetY:dragOffset.current.y})
            .catch(err=>setError(String(err))).finally(()=>{moving.current=false;});
        }
      }}
      onPointerUp={()=>gesture.current.end()} onPointerCancel={()=>gesture.current.cancel()} onClick={interact}>
      <PetCanvas {...state.settings} autoPlay={false} inputCount={count+directClicks*4} petting={petting} paused={state.paused||state.hidden} runInBackground/>
    </button>
    {error&&<div className="pet-error" role="alert">{error}<button onClick={()=>setError('')}>关闭</button></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(isPet?<Pet/>:<App/>);
if(!isPet)void invoke('main_ready').catch(()=>{});
