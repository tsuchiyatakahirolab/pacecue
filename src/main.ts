import './style.css';
import {
  LIMITS, getPresetRoutines, validateRoutine, validateSnapshot,
  startSession, planSession, pauseSession, resumeSession, completeCurrentStep,
  skipCurrentStep, changeDeadline,
  type Routine, type Session, type SessionPlan, type Snapshot, type RoutineStep,
} from './core/index.ts';
import {
  createGlassesAdapter, MENU_PAUSE_RESUME, MENU_SKIP_OPTIONAL, MENU_UNDO,
  type GlassesFrame, type GlassesStatus,
} from './glasses.ts';
import { createPersistence, type PersistenceStatus } from './persistence.ts';
import { translate, type Language, type CopyKey } from './i18n.ts';

interface AppState {
  updatedAt:number;
  language:Language;
  selectedRoutineId:string;
  finishTimes:Record<string,string>;
  data:Snapshot;
}

const $ = <T extends HTMLElement=HTMLElement>(id:string):T => {
  const element=document.getElementById(id);
  if (!element) throw new Error('Missing UI element: '+id);
  return element as T;
};
const initialLanguage:Language = new URLSearchParams(location.search).get('lang') === 'ja'
  || (new URLSearchParams(location.search).get('lang') !== 'en' && navigator.language.startsWith('ja')) ? 'ja' : 'en';
const initialRoutines=getPresetRoutines(initialLanguage);
let state:AppState = {updatedAt:Date.now(),language:initialLanguage,selectedRoutineId:initialRoutines[0].id,finishTimes:{},
  data:{version:1,routines:initialRoutines,session:null}};
let ready=false;
let bridgeStatus:GlassesStatus['mode']='preview';
let storageStatus:PersistenceStatus['mode']='local';
let view=0;
let undoStack:Array<Session|null>=[];
let editorId:string|null=null;
let toastTimer:ReturnType<typeof setTimeout>|null=null;
let hudNotice='';
let lastPlanKey='';
let lastActionAt=0;
const t=(key:CopyKey):string=>translate(state.language,key);
const setText=(id:string,value:string):void=>{const element=$(id);if(element.textContent!==value)element.textContent=value;};
const short=(value:string,max=82):string=>{
  let width=0,output='';
  for(const character of Array.from(value)){
    const point=character.codePointAt(0)!;
    const units=(point>=0x1100 && (point<=0x115f || point>=0x2e80))?2:1;
    if(width+units>max-1)return output+'…';
    output+=character;width+=units;
  }
  return output;
};
const active=():boolean=>Boolean(state.data.session && state.data.session.status!=='completed');
const currentRoutine=():Routine=>state.data.routines.find(r=>r.id===state.selectedRoutineId)??state.data.routines[0];
const clock=(value:number):string=>{
  const seconds=Math.max(0,Math.ceil(value)),m=Math.floor(seconds/60),s=seconds%60;
  return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
};
const minutes=(seconds:number):string=>String(Math.ceil(Math.max(0,seconds)/6)/10)+' '+t('minutes');
const time=(ms:number):string=>new Intl.DateTimeFormat(state.language==='ja'?'ja-JP':'en-GB',{hour:'2-digit',minute:'2-digit',hour12:false}).format(ms);
const dateTime=(ms:number):string=>new Intl.DateTimeFormat(state.language==='ja'?'ja-JP':'en-GB',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(ms);
function inputDate(ms:number):string {
  const d=new Date(ms);
  const pad=(n:number):string=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
}
function makeId(prefix:string):string {return prefix+'-'+(crypto.randomUUID?.()??(Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12)));}
function validateApp(value:unknown):value is AppState {
  try {
    if(!value || typeof value!=='object')return false;
    const v=value as AppState;
    if(!Number.isSafeInteger(v.updatedAt)||v.updatedAt<0||(v.language!=='en'&&v.language!=='ja'))return false;
    const snapshot=validateSnapshot(v.data);
    if(typeof v.selectedRoutineId!=='string'||!snapshot.routines.some(r=>r.id===v.selectedRoutineId))return false;
    if(!v.finishTimes || typeof v.finishTimes!=='object'||Array.isArray(v.finishTimes)||Object.keys(v.finishTimes).length>LIMITS.maxRoutines)return false;
    return Object.values(v.finishTimes).every(x=>typeof x==='string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(x));
  } catch{return false;}
}
function toast(message:string):void {
  $('toast').textContent=message;$('toast').hidden=false;
  hudNotice=message;
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{$('toast').hidden=true;hudNotice='';render();},3500);
  render();
}
function error(id:string,message:string|null):void {const target=$(id);target.textContent=message??'';target.hidden=!message;}
function save():void {if(!ready)return;state.updatedAt=Date.now();void persistence.save();}
function errorText(cause:unknown):string {return cause instanceof Error ? cause.message : String(cause);}
function sessionAction(action:(session:Session,now:number)=>Session):void {
  if(!ready)return;
  const session=state.data.session;
  if(!session || session.status==='completed'){toast(t('startFirst'));return;}
  try {
    const next=action(session,Date.now());
    undoStack.push(structuredClone(session));undoStack=undoStack.slice(-20);
    state.data.session=next;view=0;save();render();
  } catch(cause){toast(errorText(cause));}
}
function complete():void {
  if(state.data.session?.status==='paused'){toast(t('resumeFirst'));return;}
  sessionAction(completeCurrentStep);
}
function pause():void {sessionAction((session,now)=>session.status==='paused'?resumeSession(session,now):pauseSession(session,now));}
function undo():void {
  if(!undoStack.length){toast(t('noUndo'));return;}
  state.data.session=undoStack.pop()??null;view=0;save();syncControls();render();
}
function onGlassesTap():void {
  if(!ready||!glasses.isDisplayCurrent())return;
  if(Date.now()-lastActionAt<400)return;
  lastActionAt=Date.now();
  if(!ready)return;
  if(state.data.session?.status==='completed'){state.data.session=null;save();syncControls();render();return;}
  if(!state.data.session){beginRoutine(readyDeadline(),false);return;}
  // A tap on an overview returns to the action first; it cannot accidentally
  // complete a step the wearer was not looking at.
  if(view!==0){view=0;render();return;}
  complete();
}
function onGlassesScroll(direction:number):void {
  if(!ready)return;
  if(!active()){
    if(state.data.session?.status==='completed')state.data.session=null;
    const routines=state.data.routines,index=routines.findIndex(r=>r.id===state.selectedRoutineId);
    state.selectedRoutineId=routines[(index+direction+routines.length)%routines.length].id;
    view=0;save();syncControls();render();return;
  }
  view=(view+direction+3)%3;render();
}
function skipOptional():void {
  const session=state.data.session;
  if(session&&session.status!=='completed'&&session.routine.steps[session.currentIndex]?.required){toast(t('protectedAdvice'));return;}
  sessionAction(skipCurrentStep);
}
const glasses=createGlassesAdapter({
  menuLabels:()=>state.language==='ja'
    ? {pauseResume:'一時停止／再開',skipOptional:'任意の手順を省略',undo:'取り消す'}
    : {pauseResume:'Pause / Resume',skipOptional:'Skip optional',undo:'Undo'},
  onClick:onGlassesTap,
  onScrollUp:()=>onGlassesScroll(-1),
  onScrollDown:()=>onGlassesScroll(1),
  onMenu:(id)=>{
    if(!ready)return;
    if(id===MENU_PAUSE_RESUME)pause();
    if(id===MENU_SKIP_OPTIONAL){
      if(view!==0){view=0;render();return;}
      if(glasses.isDisplayCurrent())skipOptional();
    }
    if(id===MENU_UNDO)undo();
  },
  onExit:()=>{void persistence.flush();},
  onStatus:(status)=>{bridgeStatus=status.mode;renderConnection();},
});
const persistence=createPersistence<AppState>({
  key:'pacecue.state.v1',getState:()=>state,validate:validateApp,
  restoreState:(next)=>{
    state=structuredClone(next);
    state.data=validateSnapshot(state.data);
    undoStack=[];view=0;applyLanguage();syncControls();render();
  },
  onStatus:(status)=>{
    storageStatus=status.mode;
    const key:CopyKey=status.mode==='device'?'savedDevice':status.mode==='saving'?'saving':status.mode==='error'?'saveError':'savedBrowser';
    setText('storage-state',t(key));
    $('storage-warning').hidden=status.mode!=='error';
    if(status.mode==='error')setText('storage-warning',t('saveError'));
  },
});
function renderConnection():void {
  const key:CopyKey=bridgeStatus==='connected'?'connected':bridgeStatus==='connecting'?'connecting':bridgeStatus==='error'?'connectionError':'preview';
  setText('bridge-state',t(key));
  $('reconnect').hidden=bridgeStatus==='connected';
}
function applyLanguage():void {
  document.documentElement.lang=state.language;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element=>{
    const key=element.dataset.i18n as CopyKey;element.textContent=t(key);
  });
  $<HTMLSelectElement>('language').value=state.language;
  const privacy=$('privacy-copy');privacy.replaceChildren();
  for(const key of ['privacyOne','privacyTwo','privacyThree','privacyFour'] as const){const p=document.createElement('p');p.textContent=t(key);privacy.append(p);}
  const key:CopyKey=storageStatus==='device'?'savedDevice':storageStatus==='error'?'saveError':storageStatus==='saving'?'saving':'savedBrowser';
  setText('storage-state',t(key));
  renderConnection();lastPlanKey='';
}
function suggestedDeadline(useSaved=true):number {
  const routine=currentRoutine(),now=Date.now(),saved=useSaved?state.finishTimes[routine.id]:undefined;
  if(saved){
    const [hour,minute]=saved.split(':').map(Number);const d=new Date(now);d.setHours(hour,minute,0,0);
    if(d.getTime()<=now)d.setDate(d.getDate()+1);
    return d.getTime();
  }
  const total=routine.steps.reduce((sum,step)=>sum+step.desiredSec,routine.bufferSec);
  return Math.ceil((now+total*1000)/60000)*60000;
}
function readyDeadline():number {
  const value=new Date($<HTMLInputElement>('deadline').value).getTime();
  return Number.isFinite(value)&&value>Date.now()?value:suggestedDeadline();
}
function beginRoutine(deadline:number,fromPhone:boolean):void {
  if(!ready)return;
  try {
    const now=Date.now();
    if(!Number.isFinite(deadline)||deadline<=now||deadline-now>LIMITS.maxDeadlineHorizonMs)throw new Error(t('validDeadline'));
    undoStack=[];state.data.session=startSession(currentRoutine(),deadline,now);
    state.finishTimes[currentRoutine().id]=inputDate(deadline).slice(11,16);view=0;
    save();error('start-error',null);syncControls();render();
    if(fromPhone&&matchMedia('(max-width:640px)').matches)$('session-controls').scrollIntoView({behavior:'smooth',block:'center'});
  } catch(cause){if(fromPhone)error('start-error',errorText(cause));else toast(errorText(cause));}
}
function syncControls():void {
  const select=$<HTMLSelectElement>('routine-select');
  select.replaceChildren();
  state.data.routines.forEach(routine=>{
    const option=document.createElement('option');option.value=routine.id;option.textContent=routine.title;select.append(option);
  });
  select.value=currentRoutine().id;
  $<HTMLInputElement>('deadline').value=inputDate(active()?state.data.session!.deadlineMs:suggestedDeadline());
  lastPlanKey='';
}
function frameFor(plan:SessionPlan|null):GlassesFrame {
  const session=state.data.session;
  if(session?.status==='completed')return {header:'PaceCue / '+t('finished'),title:t('completeTitle'),body:t('completeBody')+'\n'+time(session.updatedAtMs),footer:(state.language==='ja'?'タップ: 手順を選ぶ':'Tap: choose a routine')+'\n'+t('hudExit')};
  if(!session || !plan)return {header:'PaceCue / '+t('ready'),title:short(currentRoutine().title),
    body:t('finish')+' '+dateTime(readyDeadline())+'\n'+currentRoutine().steps.length+' '+t('steps')+' / '+t('bufferShort')+' '+minutes(currentRoutine().bufferSec),
    footer:(state.language==='ja'?'タップ: 開始 / スワイプ: 手順を選ぶ':'Tap: start / Swipe: choose routine')+'\n'+t('hudExit')};
  const current=plan.currentStep;
  const header=short(session.routine.title,27)+' / '+(session.currentIndex+1)+' / '+session.routine.steps.length;
  if(view===1){
    const next=plan.steps[1];
    return {header:t('next'),title:next?short(next.title):t('finish'),
      body:next?(next.required?t('essential'):t('optional'))+' / '+(next.recommendation==='skip'?t('suggestSkip'):clock(next.allocatedSec)):t('bufferShort')+' '+minutes(plan.bufferSec),
      footer:(state.language==='ja'?'タップ: 今の手順へ戻る':'Tap: return to current step')+'\n'+t('hudExit')};
  }
  if(view===2)return {header:t('overview'),title:t('finish')+' '+time(session.deadlineMs),
    body:(plan.feasible?t('projected'):t('earliest'))+' '+time(plan.finishWithBufferMs)+'\n'+(plan.feasible?t('bufferShort')+' '+minutes(plan.bufferSec):'+'+minutes(plan.minimumOverrunSec)),
    footer:(state.language==='ja'?'タップ: 今の手順へ戻る':'Tap: return to current step')+'\n'+t('hudExit')};
  if(session.status==='paused')return {header:header,title:t('paused'),body:t('pausedBody'),footer:t('hudTap')+'\n'+t('hudExit')};
  return {header,title:short(current?.title??t('finish')),
    body:clock(current?.allocatedSec??0)+' / '+t('stepTime')+'\n'+t('finish')+' '+time(session.deadlineMs)+' / '+(plan.feasible?t('bufferShort')+' '+minutes(plan.bufferSec):'+'+minutes(plan.minimumOverrunSec))+'\n'+(current?.recommendation==='skip'?t('suggestSkip'):(current?.allocatedSec??0)<=0?t('timeUp'):t('hudSwipe')),
    footer:t('hudTap')+'\n'+t('hudExit')};
}
function renderPlan(plan:SessionPlan|null):void {
  const list=$('plan-list'),summary=$('plan-summary');
  if(!plan){list.replaceChildren();summary.hidden=true;setText('step-count','');setText('buffer-value',minutes(currentRoutine().bufferSec));return;}
  summary.hidden=plan.completed;
  summary.className='plan-summary'+(!plan.feasible?' late':plan.desiredSlackSec<0?' tight':'');
  const status:CopyKey=!plan.feasible?'cannotFit':plan.desiredSlackSec<0?'adjusted':'fits';
  const description:CopyKey=!plan.feasible?'cannotFitDetail':plan.desiredSlackSec<0?'adjustedDetail':'fitsDetail';
  setText('plan-status',t(status)+(!plan.feasible?' (+'+minutes(plan.minimumOverrunSec)+')':''));
  setText('plan-explanation',(plan.paused?t('resumeNow')+' ':'')+t(description)+' '+t(plan.feasible?'projected':'earliest')+': '+dateTime(plan.finishWithBufferMs)+' ('+t('withMargin')+').');
  setText('step-count',String(plan.steps.length)+' '+t('steps'));
  setText('buffer-value',minutes(plan.bufferSec));
  const key=JSON.stringify([state.language,plan.steps.map(step=>[step.id,Math.ceil(step.allocatedSec/6),step.recommendation,step.title,step.required]),active()]);
  if(key===lastPlanKey)return;lastPlanKey=key;list.replaceChildren();
  plan.steps.forEach((step,index)=>{
    const item=document.createElement('li');item.className='plan-item'+(index===0&&active()?' active':'')+(step.recommendation==='skip'?' recommend-skip':'');
    const n=document.createElement('span');n.className='step-number';n.textContent=String(step.index+1);
    const text=document.createElement('div'),title=document.createElement('span'),detail=document.createElement('span');
    title.className='step-title';title.textContent=step.title;detail.className='step-detail';
    detail.textContent=t(step.required?'essential':'optional')+(step.allocatedSec<step.desiredRemainingSec && step.recommendation!=='skip'?' · '+t('shortened'):'');
    text.append(title,detail);const duration=document.createElement('span');duration.className='step-duration';duration.textContent=step.recommendation==='skip'?t('suggestSkip'):minutes(step.allocatedSec);
    item.append(n,text,duration);list.append(item);
  });
}
function render():void {
  const now=Date.now(),session=state.data.session;
  const routine=active()?session!.routine:currentRoutine();
  let plan:SessionPlan|null=null;
  try {
    if(session)plan=planSession(session,now);
    else {const deadline=new Date($<HTMLInputElement>('deadline').value).getTime();if(deadline>now&&deadline-now<=LIMITS.maxDeadlineHorizonMs)plan=planSession(startSession(routine,deadline,now),now);}
  } catch{plan=null;}
  const isActive=active(),isComplete=session?.status==='completed';
  $<HTMLSelectElement>('routine-select').disabled=isActive||!ready;
  $<HTMLInputElement>('deadline').disabled=isActive||!ready;
  $<HTMLButtonElement>('quick-deadline').disabled=isActive||!ready;
  $<HTMLButtonElement>('start').disabled=isActive||!ready;
  $<HTMLButtonElement>('edit-routine').disabled=isActive||!ready;
  $<HTMLButtonElement>('new-routine').disabled=isActive||!ready;
  for(const id of ['language','transfer','reset','export','export-backup','import-file','import-text','select-json','end']){
    ($(id) as HTMLInputElement|HTMLButtonElement|HTMLSelectElement).disabled=!ready;
  }
  $<HTMLButtonElement>('reconnect').disabled=!ready||bridgeStatus==='connecting';
  $('session-controls').hidden=!session;
  setText('routine-meta',routine.steps.length+' '+t('steps')+' · '+t('usualTotal')+' '+minutes(routine.steps.reduce((sum,step)=>sum+step.desiredSec,routine.bufferSec)));
  renderPlan(plan);
  const frame=frameFor(plan);
  frame.interactionKey=session
    ? 'session:'+session.startedAtMs+':'+session.currentIndex+':'+view+':'+session.status
    : 'home:'+currentRoutine().id+':'+readyDeadline();
  if(hudNotice)frame.footer=short(hudNotice,75);
  setText('hud-header',frame.header);setText('hud-title',frame.title);setText('hud-body',frame.body);setText('hud-footer',frame.footer);
  glasses.display(frame);
  if(session&&plan){
    const step=plan.currentStep;
    setText('session-state',t(isComplete?'finished':session.status==='paused'?'paused':'running'));
    setText('deadline-clock',t('finish')+' '+dateTime(session.deadlineMs));
    setText('current-clock',clock(step?.allocatedSec??0));
    const remaining=(session.deadlineMs-now)/1000;
    setText('remaining-clock',(remaining<0?'−':'')+clock(Math.abs(remaining)));
    const advice:CopyKey=isComplete?'completeBody':session.status==='paused'?'pausedAdvice':step?.recommendation==='skip'?'skipAdvice':(step?.allocatedSec??0)<=0?'timeUp':step?.required?'protectedAdvice':'optionalAdvice';
    setText('current-advice',t(advice));
    setText('pause',t(session.status==='paused'?'resume':'pause'));
    $<HTMLButtonElement>('complete').disabled=!ready||!isActive||session.status==='paused';
    $<HTMLButtonElement>('pause').disabled=!ready||!isActive;
    $<HTMLButtonElement>('skip').disabled=!ready||!isActive||Boolean(step?.required);
    $<HTMLButtonElement>('change-time').disabled=!isActive||!ready;
  }
  $<HTMLButtonElement>('undo').disabled=!ready||undoStack.length===0;
}

function stepInput(labelText:string,type:string,value:string,options:{min?:string;max?:string;step?:string;name:string}):HTMLLabelElement {
  const wrapper=document.createElement('label');wrapper.className='field';
  const label=document.createElement('span');label.textContent=labelText;
  const input=document.createElement('input');input.type=type;input.value=value;input.required=true;input.dataset.field=options.name;
  if(options.min)input.min=options.min;if(options.max)input.max=options.max;if(options.step)input.step=options.step;
  wrapper.append(label,input);return wrapper;
}
function appendEditorStep(step:RoutineStep):void {
  const row=document.createElement('div');row.className='editor-step';row.dataset.id=step.id;
  const top=document.createElement('div');top.className='editor-step-top';
  const number=document.createElement('span');number.className='editor-step-index';
  const title=document.createElement('input');title.value=step.title;title.required=true;title.maxLength=120;title.dataset.field='title';title.setAttribute('aria-label',t('stepName'));
  top.append(number,title);
  const options=document.createElement('div');options.className='editor-step-options';
  options.append(stepInput(t('usual'),'number',String(step.desiredSec/60),{min:'0.01',max:'240',step:'any',name:'desired'}),
    stepInput(t('minimum'),'number',String(step.minimumSec/60),{min:'0.01',max:'240',step:'any',name:'minimum'}));
  const required=document.createElement('label');required.className='required-label';
  const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=step.required;checkbox.dataset.field='required';
  required.append(checkbox,document.createTextNode(t('essential')));options.append(required);
  const actions=document.createElement('div');actions.className='row-actions';
  for(const [symbol,label,action] of [['↑','moveUp','up'],['↓','moveDown','down'],['×','removeStep','remove']] as const){
    const button=document.createElement('button');button.type='button';button.textContent=symbol;button.setAttribute('aria-label',t(label));
    button.addEventListener('click',()=>{
      if(action==='up'&&row.previousElementSibling)row.parentElement!.insertBefore(row,row.previousElementSibling);
      if(action==='down'&&row.nextElementSibling)row.parentElement!.insertBefore(row.nextElementSibling,row);
      if(action==='remove'&&$('editor-steps').children.length>1)row.remove();
      renumberEditor();
    });actions.append(button);
  }
  options.append(actions);row.append(top,options);$('editor-steps').append(row);renumberEditor();
}
function renumberEditor():void {
  $('editor-steps').querySelectorAll<HTMLElement>('.editor-step-index').forEach((el,i)=>{el.textContent=String(i+1).padStart(2,'0');});
  $<HTMLButtonElement>('add-step').disabled=$('editor-steps').children.length>=LIMITS.maxSteps;
}
function openEditor(isNew=false):void {
  if(!ready)return;
  if(isNew&&state.data.routines.length>=LIMITS.maxRoutines){toast(t('importLimit'));return;}
  const routine=isNew?{id:makeId('routine'),title:'',bufferSec:120,steps:[{id:makeId('step'),title:'',desiredSec:300,minimumSec:180,required:true}]}:structuredClone(currentRoutine());
  editorId=isNew?null:routine.id;
  $<HTMLInputElement>('routine-title').value=routine.title;$<HTMLInputElement>('buffer-min').value=String(routine.bufferSec/60);
  $('editor-steps').replaceChildren();routine.steps.forEach(appendEditorStep);
  $('delete-routine').hidden=isNew;error('editor-error',null);$<HTMLDialogElement>('editor-dialog').showModal();
}
function readEditor():Routine {
  const steps=Array.from($('editor-steps').children).map(element=>{
    const row=element as HTMLElement;
    const input=(field:string):HTMLInputElement=>row.querySelector('[data-field="'+field+'"]') as HTMLInputElement;
    return {id:row.dataset.id!,title:input('title').value,desiredSec:Math.round(Number(input('desired').value)*60),minimumSec:Math.round(Number(input('minimum').value)*60),required:input('required').checked};
  });
  return validateRoutine({id:editorId??makeId('routine'),title:$<HTMLInputElement>('routine-title').value,bufferSec:Math.round(Number($<HTMLInputElement>('buffer-min').value)*60),steps});
}
async function ask(title:CopyKey,copy:CopyKey):Promise<boolean> {
  const dialog=$<HTMLDialogElement>('confirm-dialog');setText('confirm-title',t(title));setText('confirm-copy',t(copy));dialog.returnValue='cancel';dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));
}
function exportRoutines():void {
  if(!ready)return;
  const output={format:'pacecue.routines',version:1,routines:state.data.routines};
  const json=JSON.stringify(output,null,2);
  $<HTMLTextAreaElement>('transfer-text').value=json;
  if(!$<HTMLDialogElement>('transfer-dialog').open)$<HTMLDialogElement>('transfer-dialog').showModal();
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='pacecue-routines.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importRoutines(file:File):Promise<void> {
  if(file.size>LIMITS.maxSnapshotBytes)throw new Error(t('fileTooLarge'));
  addRoutinesJSON(await file.text());
}
function addRoutinesJSON(json:string):void {
  if(!ready)return;
  if(new TextEncoder().encode(json).byteLength>LIMITS.maxSnapshotBytes)throw new Error(t('fileTooLarge'));
  const value:unknown=JSON.parse(json);
  if(!value||typeof value!=='object')throw new Error(t('invalidImport'));
  const raw=value as {format?:string;version?:number;routines?:unknown[]};
  if(raw.format!=='pacecue.routines'||raw.version!==1||!Array.isArray(raw.routines)||raw.routines.length===0)throw new Error(t('invalidImport'));
  if(state.data.routines.length+raw.routines.length>LIMITS.maxRoutines)throw new Error(t('importLimit'));
  const newRoutines=raw.routines.map(value=>{
    const routine=validateRoutine(value);routine.id=makeId('routine');routine.steps=routine.steps.map(step=>({...step,id:makeId('step')}));return routine;
  });
  state.data.routines.push(...newRoutines);if(!active())state.selectedRoutineId=newRoutines[0].id;save();syncControls();render();toast(t('imported'));
}

$<HTMLSelectElement>('language').addEventListener('change',()=>{
  if(!ready)return;
  state.language=$<HTMLSelectElement>('language').value==='ja'?'ja':'en';applyLanguage();save();render();
});
$<HTMLSelectElement>('routine-select').addEventListener('change',()=>{
  if(!ready)return;
  state.selectedRoutineId=$<HTMLSelectElement>('routine-select').value;
  if(state.data.session?.status==='completed')state.data.session=null;
  save();syncControls();render();
});
$('quick-deadline').addEventListener('click',()=>{$<HTMLInputElement>('deadline').value=inputDate(suggestedDeadline(false));error('start-error',null);render();});
$('deadline').addEventListener('change',()=>{if(state.data.session?.status==='completed')state.data.session=null;error('start-error',null);render();});
$('start').addEventListener('click',()=>{
  beginRoutine(new Date($<HTMLInputElement>('deadline').value).getTime(),true);
});
$('complete').addEventListener('click',complete);$('pause').addEventListener('click',pause);
$('skip').addEventListener('click',skipOptional);$('undo').addEventListener('click',undo);
$('end').addEventListener('click',async()=>{
  if(!state.data.session)return;
  if(state.data.session.status==='completed'||await ask('endQuestion','endCopy')){
    undoStack.push(structuredClone(state.data.session));state.data.session=null;view=0;save();syncControls();render();
  }
});
$('edit-routine').addEventListener('click',()=>openEditor());$('new-routine').addEventListener('click',()=>openEditor(true));
$('add-step').addEventListener('click',()=>{if($('editor-steps').children.length<LIMITS.maxSteps)appendEditorStep({id:makeId('step'),title:'',desiredSec:300,minimumSec:180,required:true});});
$('editor-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(!ready)return;
  try {
    const routine=readEditor(),index=state.data.routines.findIndex(r=>r.id===editorId);
    if(index>=0)state.data.routines[index]=routine;else state.data.routines.push(routine);
    if(!active())state.selectedRoutineId=routine.id;
    if(state.data.session?.status==='completed')state.data.session=null;
    save();syncControls();render();$<HTMLDialogElement>('editor-dialog').close();toast(t('saved'));
  }catch(cause){error('editor-error',errorText(cause));}
});
$('delete-routine').addEventListener('click',async()=>{
  if(!ready)return;
  if(state.data.routines.length<=1){error('editor-error',t('atLeastOne'));return;}
  if(await ask('removeQuestion','removeCopy')){
    state.data.routines=state.data.routines.filter(r=>r.id!==editorId);
    if(editorId)delete state.finishTimes[editorId];state.selectedRoutineId=state.data.routines[0].id;save();syncControls();render();$<HTMLDialogElement>('editor-dialog').close();
  }
});
$('transfer').addEventListener('click',()=>{error('transfer-error',null);$<HTMLDialogElement>('transfer-dialog').showModal();});
$('export').addEventListener('click',exportRoutines);$('export-backup').addEventListener('click',exportRoutines);
$('select-json').addEventListener('click',()=>{$<HTMLTextAreaElement>('transfer-text').focus();$<HTMLTextAreaElement>('transfer-text').select();});
$('import-text').addEventListener('click',()=>{
  try{addRoutinesJSON($<HTMLTextAreaElement>('transfer-text').value);error('transfer-error',null);}catch(cause){error('transfer-error',errorText(cause));}
});
$<HTMLInputElement>('import-file').addEventListener('change',async event=>{
  const input=event.target as HTMLInputElement;const file=input.files?.[0];if(!file)return;
  try{await importRoutines(file);error('transfer-error',null);}catch(cause){error('transfer-error',errorText(cause));}input.value='';
});
$('privacy').addEventListener('click',()=>$<HTMLDialogElement>('privacy-dialog').showModal());
$('reset').addEventListener('click',async()=>{
  if(!ready)return;
  if(await ask('resetQuestion','resetCopy')){
    const routines=getPresetRoutines(state.language);state={updatedAt:Date.now(),language:state.language,selectedRoutineId:routines[0].id,finishTimes:{},data:{version:1,routines,session:null}};
    undoStack=[];view=0;save();syncControls();render();$<HTMLDialogElement>('privacy-dialog').close();
  }
});
$('change-time').addEventListener('click',()=>{
  $<HTMLInputElement>('new-deadline').value=inputDate(Math.max(state.data.session?.deadlineMs??0,Date.now()+60000));
  error('time-error',null);$<HTMLDialogElement>('time-dialog').showModal();
});
$('time-form').addEventListener('submit',event=>{
  event.preventDefault();if(!ready||!state.data.session)return;
  try{
    const deadline=new Date($<HTMLInputElement>('new-deadline').value).getTime(),session=state.data.session;
    const next=changeDeadline(session,deadline,Date.now());undoStack.push(structuredClone(session));
    state.data.session=next;
    if(state.data.routines.some(r=>r.id===session.routine.id))state.finishTimes[session.routine.id]=$<HTMLInputElement>('new-deadline').value.slice(11,16);
    view=0;save();syncControls();render();$<HTMLDialogElement>('time-dialog').close();
  }catch(cause){error('time-error',errorText(cause));}
});
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button=>button.addEventListener('click',()=>$<HTMLDialogElement>(button.dataset.close!).close()));
$('reconnect').addEventListener('click',async()=>{
  if(!ready)return;
  ready=false;render();
  try{await glasses.connect();await persistence.load(glasses.getBridge());}
  finally{ready=true;render();}
});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')render();});
async function initialize():Promise<void> {
  applyLanguage();syncControls();render();
  await persistence.load();
  await glasses.connect();
  if(glasses.getBridge())await persistence.load(glasses.getBridge());
  ready=true;render();
  setInterval(render,1000);
}
void initialize();
