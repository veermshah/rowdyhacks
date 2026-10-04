import { useEffect, useRef, useState } from 'react';
import { car } from '../car/state.js';
import { input } from '../input/input.js';
import { game, guidance } from '../game/runtime.js';
import { drivingMix } from './drivingMix.js';

function createAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return null;
  const ctx = new Audio();
  const master = ctx.createGain(), limiter = ctx.createDynamicsCompressor();
  master.gain.value = 0;
  master.connect(limiter).connect(ctx.destination);
  const music=new window.Audio('/audio/heist-chase.mp3');
  music.loop=true;music.preload='metadata';
  const musicGain=ctx.createGain();musicGain.gain.value=0;
  const musicSource=ctx.createMediaElementSource(music);
  musicSource.connect(musicGain).connect(limiter);
  let musicPending=false,musicBlocked=false;
  function playMusic(){
    if(!music.paused||musicPending||musicBlocked)return;
    musicPending=true;
    void music.play().catch(error=>{if(error.name!=='AbortError')musicBlocked=true;}).finally(()=>{musicPending=false;});
  }
  const sources=[];
  const noise=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
  const data=noise.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
  function voice(type, frequency, filterType='lowpass', cutoff=900) {
    const source=type==='noise'?ctx.createBufferSource():ctx.createOscillator();
    if(type==='noise'){source.buffer=noise;source.loop=true;}else{source.type=type;source.frequency.value=frequency;}
    const filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    filter.type=filterType;filter.frequency.value=cutoff;gain.gain.value=0;
    source.connect(filter).connect(gain).connect(master);source.start();sources.push(source);
    return {source,filter,gain};
  }
  const voices={engine:voice('sawtooth',50),harmonic:voice('triangle',100),exhaust:voice('noise',0,'bandpass',160),road:voice('noise',0,'lowpass',650),grass:voice('noise',0,'bandpass',420),wind:voice('noise',0,'lowpass',220),skid:voice('triangle',1100,'bandpass',1200),brake:voice('noise',0,'bandpass',2400),siren:voice('sine',700,'lowpass',1400),reverse:voice('sine',880),impact:voice('noise',0,'lowpass',220),cue:voice('sine',520)};
  // Uneven combustion harmonics give a throaty pulse instead of a buzzy saw.
  const real=new Float32Array(13),imag=new Float32Array([0,1,.55,.32,.45,.18,.24,.12,.16,.08,.09,.04,.03]);
  voices.engine.source.setPeriodicWave(ctx.createPeriodicWave(real,imag));
  voices.harmonic.filter.frequency.value=350;
  const pan=ctx.createStereoPanner();
  voices.siren.gain.disconnect();voices.siren.gain.connect(pan).connect(master);
  const smooth=(param,value)=>param.setTargetAtTime(value,ctx.currentTime,.065);
  function pulse(name,hz,level,duration){
    const v=voices[name],t=ctx.currentTime;
    if(v.source.frequency)v.source.frequency.setValueAtTime(hz,t);
    v.gain.gain.cancelScheduledValues(t);v.gain.gain.setValueAtTime(level,t);v.gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
  }
  return {ctx,master,pulse,
    unlock(){musicBlocked=false;playMusic();},
    pauseMusic(){music.pause();},
    update(m,volume,musicVolume){
      smooth(master.gain,m.active?volume:0);
      const musicActive=m.active&&musicVolume>0;
      smooth(musicGain.gain,musicActive?musicVolume:0);
      if(musicActive)playMusic();else if(!music.paused)music.pause();
      smooth(voices.engine.source.frequency,m.engineHz);
      smooth(voices.harmonic.source.frequency,m.engineHz*.501);
      smooth(voices.engine.filter.frequency,260+m.throttle*650+m.engineHz*2);
      smooth(voices.exhaust.filter.frequency,100+m.engineHz*1.2);
      smooth(voices.exhaust.gain.gain,.012+m.throttle*.035);
      for(const name of ['engine','road','grass','wind','skid','brake','siren'])smooth(voices[name].gain.gain,m[name]);
      smooth(voices.harmonic.gain.gain,m.engine*.55);
      smooth(voices.siren.source.frequency,740+300*Math.sin(ctx.currentTime*4.5));
      smooth(voices.skid.source.frequency,950+90*Math.sin(ctx.currentTime*19));
      smooth(voices.reverse.gain.gain,m.reverse && ctx.currentTime%1<.22?.035:0);
      smooth(pan.pan,m.pan*.8);
    },
    dispose(){music.pause();music.removeAttribute('src');music.load();musicSource.disconnect();sources.forEach(s=>s.stop());void ctx.close();},
  };
}

export default function DrivingAudio(){
  const [volume,setVolume]=useState(.65),[muted,setMuted]=useState(false),[unavailable,setUnavailable]=useState(false);
  const [musicVolume,setMusicVolume]=useState(.22);
  const level=useRef(.65);
  const musicLevel=useRef(.22);
  useEffect(()=>{level.current=muted?0:volume;},[muted,volume]);
  useEffect(()=>{musicLevel.current=muted?0:musicVolume;},[muted,musicVolume]);
  useEffect(()=>{
    let audio=null,failed=false,lastImpact=car.impactSerial||0,lastGear=input.reverse,lastArrived=guidance.arrived,epoch=game.epoch;
    const unlock=()=>{
      if(failed)return;
      try{audio??=createAudio();if(!audio){failed=true;setUnavailable(true);return;}if(!document.hidden){void audio.ctx.resume().catch(()=>{});audio.unlock();}}
      catch{failed=true;setUnavailable(true);}
    };
    const visibility=()=>{if(document.hidden){if(audio){audio.pauseMusic();void audio.ctx.suspend();}}else if(audio)void audio.ctx.resume().catch(()=>{});};
    window.addEventListener('pointerdown',unlock);window.addEventListener('keydown',unlock);
    document.addEventListener('visibilitychange',visibility);
    const timer=setInterval(()=>{
      if(!audio||document.hidden)return;
      const mix=drivingMix(car,input,game);
      if(epoch!==game.epoch){epoch=game.epoch;lastImpact=car.impactSerial||0;lastGear=input.reverse;lastArrived=guidance.arrived;}
      if(mix.active){
        if((car.impactSerial||0)!==lastImpact && car.impactSpeed>1)audio.pulse('impact',0,Math.min(.3,car.impactSpeed*.018),.22);
        if(input.reverse!==lastGear)audio.pulse('cue',input.reverse?330:490,.045,.1);
        if(guidance.arrived&&!lastArrived)audio.pulse('cue',1046,.075,.45);
      }
      lastImpact=car.impactSerial||0;lastGear=input.reverse;lastArrived=guidance.arrived;
      audio.update(mix,level.current,musicLevel.current);
    },50);
    return()=>{clearInterval(timer);window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock);document.removeEventListener('visibilitychange',visibility);audio?.dispose();};
  },[]);
  return <div className="driving-audio">
    <button type="button" disabled={unavailable} onClick={()=>setMuted(v=>!v)} aria-pressed={muted} aria-label={muted?'Unmute driving audio':'Mute driving audio'}>{unavailable?'Audio unavailable':muted?'Sound off':'Sound on'}</button>
    <div className="audio-sliders">
      <label>FX <input type="range" min="0" max="1" step=".05" value={volume} disabled={unavailable} aria-label="Driving audio volume" onChange={e=>setVolume(Number(e.target.value))}/></label>
      <label>Music <input type="range" min="0" max=".6" step=".02" value={musicVolume} disabled={unavailable} aria-label="Heist music volume" onChange={e=>setMusicVolume(Number(e.target.value))}/></label>
    </div>
  </div>;
}
