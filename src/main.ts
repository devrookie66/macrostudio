import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

const isPremium = import.meta.env.VITE_PREMIUM === 'true';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MacroEvent {
  event_type: any;
  delay: number;
  groupId?: string;
  groupText?: string;
  isHidden?: boolean;
}

interface LibraryItem {
  id: string;
  name: string;
  type: 'timeline' | 'script';
  events?: MacroEvent[];
  code?: string;
  triggerCombo: string[];
  loopEnabled?: boolean;
  holdEnabled?: boolean;
  createdAt: number;
}

// ─── App State ────────────────────────────────────────────────────────────────

let isRecording        = false;
let isPlaying          = false;
let loopEnabled        = false;
let holdEnabled        = false;
let shouldLoop         = false;
let macroActive        = false;  // master on/off switch default off
let blockTriggerInput  = false;
let emergencyFallback  = true;
let emergencyKey       = 'Escape';
let emergencyDuration  = 5000;
let recordMouseMovement = false;
let recordedEvents: MacroEvent[] = [];
let collapsedGroups: Set<string> = new Set();
let activeMacros: Map<string, LibraryItem> = new Map();
let currentPlayingMacroId: string | null = null;
let isScriptRunning        = false;

// ─── DOM Refs ─────────────────────────────────────────────────────────────────

const btnRecord     = document.getElementById('btn-record')!     as HTMLButtonElement;
const btnPlay       = document.getElementById('btn-play')!       as HTMLButtonElement;
const btnClear      = document.getElementById('btn-clear')!      as HTMLButtonElement;
const btnSaveMacro  = document.getElementById('btn-save-macro')! as HTMLButtonElement;
const btnLoadMacro  = document.getElementById('btn-load-macro')! as HTMLButtonElement;
const btnAddEvent   = document.getElementById('btn-add-event')!  as HTMLButtonElement;
const btnTriggerKey = document.getElementById('btn-trigger-key')!as HTMLButtonElement;

const toggleMouseRecord  = document.getElementById('toggle-mouse-record')!  as HTMLDivElement;
const toggleLoop         = document.getElementById('toggle-loop')!           as HTMLDivElement;
const toggleHold         = document.getElementById('toggle-hold')!           as HTMLDivElement;
const toggleMacroActive  = document.getElementById('toggle-macro-active')!  as HTMLDivElement;
const toggleBlockTrigger = document.getElementById('toggle-block-trigger')! as HTMLDivElement;
const mouseTrackBtn      = document.getElementById('btn-mouse-track-indicator')! as HTMLButtonElement;

const timelineList   = document.getElementById('timeline-list')!    as HTMLDivElement;
const timelineTracks = document.getElementById('timeline-tracks')!  as HTMLDivElement;
const eventCountEl   = document.getElementById('event-count-display')! as HTMLSpanElement;
const durationEl     = document.getElementById('duration-display')!    as HTMLSpanElement;
const readyDot       = document.getElementById('ready-dot')!           as HTMLSpanElement;
const readyText      = document.getElementById('ready-text')!          as HTMLSpanElement;
const globalDot      = document.getElementById('global-status-dot')  as HTMLSpanElement | null;
const globalText     = document.getElementById('global-status-text') as HTMLSpanElement | null;

const macroModal    = document.getElementById('macro-modal')!    as HTMLDivElement;
const macroClose    = document.getElementById('macro-modal-close')! as HTMLButtonElement;
const macroContent  = document.getElementById('macro-modal-content')! as HTMLDivElement;
const addEventModal = document.getElementById('add-event-modal')! as HTMLDivElement;
const addEventClose = document.getElementById('add-event-modal-close')! as HTMLButtonElement;

const btnSettings        = document.getElementById('btn-settings')!          as HTMLButtonElement;
const settingsModal      = document.getElementById('settings-modal')!        as HTMLDivElement;
const settingsClose      = document.getElementById('settings-modal-close')!  as HTMLButtonElement;
const toggleEmergencyFallback = document.getElementById('toggle-emergency-fallback')! as HTMLDivElement;
const btnEmergencyKey    = document.getElementById('btn-emergency-key')!     as HTMLButtonElement;
const inputEmergencyHold = document.getElementById('input-emergency-hold')!  as HTMLInputElement;

// ─── Scripting DOM Elements ───────────────────────────────────────────────────
const btnViewTimeline   = document.getElementById('btn-view-timeline')!   as HTMLButtonElement;
const btnViewScripting  = document.getElementById('btn-view-scripting')!  as HTMLButtonElement;
const timelineArea      = document.querySelector('.timeline-area')!       as HTMLElement;
const scriptingView     = document.getElementById('scripting-view')!      as HTMLDivElement;
const btnValidateScript = document.getElementById('btn-validate-script')! as HTMLButtonElement;
const luaCodeEditor     = document.getElementById('lua-code-editor')!     as HTMLTextAreaElement;
const luaHighlightOverlay = document.getElementById('lua-highlight-overlay')! as HTMLPreElement;
const luaHighlightCode    = luaHighlightOverlay.querySelector('code')!       as HTMLElement;
const btnClearConsole   = document.getElementById('btn-clear-console')!   as HTMLButtonElement;
const consoleLogs       = document.getElementById('console-logs')!        as HTMLDivElement;
const scriptStatusEl    = document.getElementById('script-engine-status')!as HTMLSpanElement;

// New validation DOM elements
const editorErrorBanner   = document.getElementById('editor-error-banner')!   as HTMLDivElement;
const errorBannerText     = document.getElementById('error-banner-text')!     as HTMLSpanElement;
const btnCloseErrorBanner = document.getElementById('btn-close-error-banner')! as HTMLButtonElement;

// Dynamic detected hotkeys DOM elements
const detectedKeysContainer = document.getElementById('detected-keys-container')! as HTMLDivElement;
const detectedKeysList      = document.getElementById('detected-keys-list')!      as HTMLDivElement;

const btnScriptTriggerKey = document.getElementById('btn-script-trigger-key')! as HTMLButtonElement;
const btnSaveScript       = document.getElementById('btn-save-script')!        as HTMLButtonElement;
const librarySearchInput  = document.getElementById('library-search-input')!   as HTMLInputElement;
const filterTabs          = document.querySelectorAll('.filter-tab')           as NodeListOf<HTMLButtonElement>;

// ─── Status ───────────────────────────────────────────────────────────────────

type State = 'idle' | 'recording' | 'playing';
const STATE_COLOR: Record<State, string> = {
  idle:      'var(--success)',
  recording: 'var(--danger)',
  playing:   'var(--primary)',
};
const STATE_LABEL: Record<State, string> = {
  idle: 'IDLE', recording: 'RECORDING', playing: 'PLAYING',
};

function setStatus(s: State) {
  const c = STATE_COLOR[s];
  readyDot.style.background = c;
  if (globalDot) globalDot.style.background = c;
  readyText.textContent  = STATE_LABEL[s];
  if (globalText) globalText.textContent = STATE_LABEL[s];
  
  if (s === 'recording') {
    readyDot.classList.add('recording');
    if (globalDot) globalDot.classList.add('recording');
  } else {
    readyDot.classList.remove('recording');
    if (globalDot) globalDot.classList.remove('recording');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ml = ms % 1000;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ml).padStart(3,'0')}`;
}

// ─── Custom Studio Dialog System ──────────────────────────────────────────────
interface CustomDialogOptions {
  title?: string;
  message: string;
  showInput?: boolean;
  inputValue?: string;
  showCancel?: boolean;
}

function showCustomDialog(options: CustomDialogOptions): Promise<{ confirmed: boolean; value?: string }> {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-dialog-modal')! as HTMLDivElement;
    const titleEl = document.getElementById('custom-dialog-title')! as HTMLSpanElement;
    const msgEl = document.getElementById('custom-dialog-message')! as HTMLParagraphElement;
    const inputContainer = document.getElementById('custom-dialog-input-container')! as HTMLDivElement;
    const inputEl = document.getElementById('custom-dialog-input')! as HTMLInputElement;
    const btnCancel = document.getElementById('btn-custom-dialog-cancel')! as HTMLButtonElement;
    const btnConfirm = document.getElementById('btn-custom-dialog-confirm')! as HTMLButtonElement;

    titleEl.textContent = options.title ?? 'STUDIO MESSAGE';
    msgEl.textContent = options.message;
    
    if (options.showInput) {
      inputContainer.style.display = 'flex';
      inputEl.value = options.inputValue ?? '';
      setTimeout(() => inputEl.focus(), 50);
    } else {
      inputContainer.style.display = 'none';
    }

    if (options.showCancel) {
      btnCancel.style.display = 'block';
    } else {
      btnCancel.style.display = 'none';
    }

    modal.style.display = 'flex';

    const cleanup = () => {
      modal.style.display = 'none';
      btnConfirm.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
      inputEl.removeEventListener('keydown', onInputKey);
    };

    const onConfirm = () => {
      cleanup();
      resolve({ confirmed: true, value: inputEl.value });
    };

    const onCancel = () => {
      cleanup();
      resolve({ confirmed: false });
    };

    const onInputKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    btnConfirm.addEventListener('click', onConfirm);
    btnCancel.addEventListener('click', onCancel);
    inputEl.addEventListener('keydown', onInputKey);
  });
}

async function studioAlert(message: string, title = 'STUDIO ALERT') {
  await showCustomDialog({ message, title, showCancel: false });
}

async function studioConfirm(message: string, title = 'CONFIRM ACTION'): Promise<boolean> {
  const res = await showCustomDialog({ message, title, showCancel: true });
  return res.confirmed;
}

async function studioPrompt(message: string, placeholder = '', title = 'INPUT REQUIRED'): Promise<string | null> {
  const res = await showCustomDialog({ message, title, showInput: true, inputValue: placeholder, showCancel: true });
  return res.confirmed ? (res.value ?? '') : null;
}

function getLabel(evt: MacroEvent): { name: string; detail: string; icon: string; color: string } {
  const et = evt.event_type;
  let key = typeof et === 'string' ? et : (et && typeof et === 'object' ? Object.keys(et)[0] : 'Unknown');
  let val = et && typeof et === 'object' ? et[key] : null;

  const map: Record<string, { name: string; detail: () => string; icon: string; color: string }> = {
    KeyPress:      { name: 'Key ↓',    detail: () => fmtKey(val), icon: kbd, color: '#a78bfa' },
    KeyRelease:    { name: 'Key ↑',    detail: () => fmtKey(val), icon: kbd, color: '#7c6fac' },
    ButtonPress:   { name: 'Click ↓',  detail: () => `${val}`, icon: mouse, color: '#60a5fa' },
    ButtonRelease: { name: 'Click ↑',  detail: () => `${val}`, icon: mouse, color: '#3b7ed4' },
    MouseMove:     { name: 'Move',     detail: () => `${Math.round(val?.x??0)},${Math.round(val?.y??0)}`, icon: cursor, color: '#94a3b8' },
    Wheel:         { name: 'Scroll',   detail: () => `dy:${val?.delta_y??0}`, icon: mouse, color: '#64748b' },
    Delay:         { name: 'Delay',    detail: () => `${evt.delay}ms`, icon: clock, color: '#fbbf24' },
  };

  const entry = map[key];
  if (!entry) return { name: key, detail: '', icon: circle, color: '#555' };
  return { name: entry.name, detail: entry.detail(), icon: entry.icon, color: entry.color };
}

function fmtKey(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val.replace('Key','').replace('Digit','');
  return JSON.stringify(val);
}

// SVG icons
const kbd    = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="7" y1="12" x2="17" y2="12"></line><line x1="7" y1="8" x2="17" y2="8"></line><line x1="7" y1="16" x2="13" y2="16"></line></svg>`;
const mouse  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="7"></rect><line x1="12" y1="6" x2="12" y2="10"></line></svg>`;
const cursor = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path></svg>`;
const clock  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
const circle = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>`;

// ─── Timeline ─────────────────────────────────────────────────────────────────

function updateTimeline() {
  const total = recordedEvents.reduce((s, e) => s + e.delay, 0);
  const maxView = Math.max(5000, total);

  eventCountEl.textContent = String(recordedEvents.length);
  durationEl.textContent   = fmtMs(total);
  // Optional visually dimming if empty
  if (recordedEvents.length === 0) {
    btnPlay.style.opacity = '0.4';
  } else if (macroActive) {
    btnPlay.style.opacity = '1';
  }

  timelineList.innerHTML   = '';
  timelineTracks.innerHTML = '';

  let cum = 0;
  let activeGroupId: string | null = null;

  recordedEvents.forEach((evt, idx) => {
    // Group Header Logic
    if (evt.groupId && evt.groupId !== activeGroupId) {
      activeGroupId = evt.groupId;
      const isCollapsed = collapsedGroups.has(evt.groupId);
      
      let groupDelay = 0;
      for (let i = idx; i < recordedEvents.length; i++) {
        if (recordedEvents[i].groupId === evt.groupId) groupDelay += recordedEvents[i].delay;
        else break;
      }
      
      const prevPct = (cum / maxView) * 100;
      const currPct = ((cum + groupDelay) / maxView) * 100;
      
      const row = document.createElement('div');
      row.className = 't-row t-group-header';
      row.dataset.group = evt.groupId;
      row.innerHTML = `
        <span class="t-drag-handle" title="Sürükle">⠿</span>
        <span class="t-idx">-</span>
        <span class="t-icon" style="color:#a78bfa;cursor:pointer;" title="Toggle Group">${isCollapsed ? '▶' : '▼'}</span>
        <span class="t-name">Text</span>
        <span class="t-detail">${evt.groupText}</span>
        <span class="t-delay">${groupDelay}ms</span>
        <button class="t-del" title="Delete Group">✕</button>
      `;
      
      row.querySelector('.t-icon')!.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isCollapsed) collapsedGroups.delete(evt.groupId!);
        else collapsedGroups.add(evt.groupId!);
        updateTimeline();
      });
      
      row.querySelector('.t-del')!.addEventListener('click', (e) => {
        e.stopPropagation();
        recordedEvents = recordedEvents.filter(e => e.groupId !== evt.groupId);
        updateTimeline();
      });
      
      timelineList.appendChild(row);
      
      // Group Track Row
      const trRow = document.createElement('div');
      trRow.className = 'track-row';
      trRow.innerHTML = `
        <div class="keyframe-line" style="left:${prevPct}%;width:${currPct-prevPct}%;border-top-style:solid;border-color:rgba(167,139,250,0.5);"></div>
        <div class="keyframe" style="left:${currPct}%;border-color:#a78bfa;"></div>
      `;
      timelineTracks.appendChild(trRow);
    } else if (!evt.groupId) {
      activeGroupId = null;
    }
    
    if (evt.groupId && collapsedGroups.has(evt.groupId)) {
      cum += evt.delay;
      return;
    }

    const prev = cum;
    cum += evt.delay;
    const prevPct = (prev / maxView) * 100;
    const currPct = (cum  / maxView) * 100;
    const { name, detail, icon, color } = getLabel(evt);
    const num = String(idx + 1).padStart(2, '0');

    // ── List Row ──────────────────────────────────────────────────────────────
    const row = document.createElement('div');
    row.className = 't-row';
    if (evt.groupId) row.classList.add('t-grouped');
    row.dataset.idx = String(idx);
    row.innerHTML = `
      <span class="t-drag-handle" title="Sürükle" style="${evt.groupId ? 'visibility:hidden' : ''}">⠿</span>
      <span class="t-idx">${num}</span>
      <span class="t-icon" style="color:${color}">${icon}</span>
      <span class="t-name">${name}</span>
      <span class="t-detail">${detail}</span>
      <span class="t-delay" title="Click to edit delay">${evt.delay}ms</span>
      <button class="t-del" title="Delete" style="${evt.groupId ? 'visibility:hidden' : ''}">✕</button>
    `;

    if (!evt.groupId) {
      const delayEl = row.querySelector('.t-delay') as HTMLSpanElement;
      delayEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        openDelayEditor(delayEl, idx);
      });

      row.querySelector('.t-del')!.addEventListener('click', (e) => {
        e.stopPropagation();
        recordedEvents.splice(idx, 1);
        updateTimeline();
      });

      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showCtxMenu(e.pageX, e.pageY, idx);
      });
    }

    timelineList.appendChild(row);

    // ── Track Row ─────────────────────────────────────────────────────────────
    const trRow = document.createElement('div');
    trRow.className = 'track-row';
    trRow.innerHTML = `
      <div class="keyframe-line" style="left:${prevPct}%;width:${currPct-prevPct}%;"></div>
      <div class="keyframe" style="left:${currPct}%;border-color:${color};"></div>
    `;
    timelineTracks.appendChild(trRow);
  });

  setupDrag();

  // Auto-scroll to bottom if we are recording
  if (isRecording) {
    const timelineBody = timelineList.parentElement;
    if (timelineBody) {
      timelineBody.scrollTop = timelineBody.scrollHeight;
    }
  }
}

// ─── Delay Inline Editor ──────────────────────────────────────────────────────

let activeDelayEditor: HTMLInputElement | null = null;

function openDelayEditor(spanEl: HTMLSpanElement, idx: number) {
  // Close any open editor
  if (activeDelayEditor) activeDelayEditor.blur();

  const input = document.createElement('input');
  input.type  = 'number';
  input.min   = '0';
  input.value = String(recordedEvents[idx].delay);
  input.className = 'delay-inline-input';
  spanEl.replaceWith(input);
  input.focus();
  input.select();
  activeDelayEditor = input;

  const commit = () => {
    const val = Math.max(0, parseInt(input.value) || 0);
    recordedEvents[idx].delay = val;
    activeDelayEditor = null;
    updateTimeline();
  };

  input.addEventListener('blur',  commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { activeDelayEditor = null; updateTimeline(); }
  });
}

// ─── Mouse-based Drag-to-Reorder ──────────────────────────────────────────────

let dragFromIdx = -1;
let ghostEl: HTMLDivElement | null = null;

function setupDrag() {
  const rows = Array.from(timelineList.querySelectorAll('.t-row')) as HTMLDivElement[];

  rows.forEach((row, idx) => {
    const handle = row.querySelector('.t-drag-handle') as HTMLSpanElement;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragFromIdx = idx;

      // Create ghost
      ghostEl = document.createElement('div');
      ghostEl.className = 'drag-ghost';
      ghostEl.textContent = row.querySelector('.t-name')!.textContent;
      ghostEl.style.left = `${e.pageX + 12}px`;
      ghostEl.style.top  = `${e.pageY - 12}px`;
      document.body.appendChild(ghostEl);

      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup',   onDragEnd);
    });
  });
}

function onDragMove(e: MouseEvent) {
  if (!ghostEl) return;
  ghostEl.style.left = `${e.pageX + 12}px`;
  ghostEl.style.top  = `${e.pageY - 12}px`;

  // Highlight target row
  document.querySelectorAll('.t-row').forEach(r => r.classList.remove('drag-target'));
  const target = getRowAtY(e.clientY);
  if (target && target.dataset.idx !== String(dragFromIdx)) {
    target.classList.add('drag-target');
  }
}

function onDragEnd(e: MouseEvent) {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup',   onDragEnd);

  ghostEl?.remove();
  ghostEl = null;
  document.querySelectorAll('.t-row').forEach(r => r.classList.remove('drag-target'));

  const target = getRowAtY(e.clientY);
  if (target) {
    const toIdx = parseInt(target.dataset.idx!);
    if (!isNaN(toIdx) && toIdx !== dragFromIdx && dragFromIdx >= 0) {
      const [item] = recordedEvents.splice(dragFromIdx, 1);
      recordedEvents.splice(toIdx, 0, item);
      updateTimeline();
    }
  }
  dragFromIdx = -1;
}

function getRowAtY(clientY: number): HTMLDivElement | null {
  const rows = Array.from(timelineList.querySelectorAll('.t-row')) as HTMLDivElement[];
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) return row;
  }
  return null;
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

let ctxEl: HTMLDivElement | null = null;

function showCtxMenu(x: number, y: number, idx: number) {
  ctxEl?.remove();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <div class="ctx-item" data-a="delay">
      ${clock} Edit Delay
    </div>
    <div class="ctx-item" data-a="dup">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      Duplicate
    </div>
    <div class="ctx-sep"></div>
    <div class="ctx-item danger" data-a="del">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      Delete
    </div>
  `;
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
  document.body.appendChild(menu);
  ctxEl = menu;

  menu.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
    if (action === 'delay') {
      const delaySpan = timelineList.querySelector(`.t-row[data-idx="${idx}"] .t-delay`) as HTMLSpanElement;
      if (delaySpan) openDelayEditor(delaySpan, idx);
    } else if (action === 'dup') {
      recordedEvents.splice(idx + 1, 0, { ...recordedEvents[idx] });
      updateTimeline();
    } else if (action === 'del') {
      recordedEvents.splice(idx, 1);
      updateTimeline();
    }
    ctxEl?.remove(); ctxEl = null;
  });

  requestAnimationFrame(() => {
    document.addEventListener('click', () => { ctxEl?.remove(); ctxEl = null; }, { once: true });
  });
}

// ─── Recording ────────────────────────────────────────────────────────────────

let lastRdevEventTime = 0;

listen('macro-event', (event) => {
  if (!isRecording) return;
  recordedEvents.push(event.payload as MacroEvent);
  lastRdevEventTime = Date.now();
  updateTimeline();
});

function mapJsCodeToRdevKey(code: string): string | null {
  if (code.startsWith('Key')) return code;
  if (code.startsWith('Digit')) return code.replace('Digit', 'Num');
  if (code.startsWith('Numpad')) return code;
  if (code.startsWith('F') && code.length <= 3) return code;
  
  const map: Record<string, string> = {
    'Space': 'Space',
    'Enter': 'Return',
    'Escape': 'Escape',
    'Backspace': 'Backspace',
    'Tab': 'Tab',
    'ShiftLeft': 'ShiftLeft',
    'ShiftRight': 'ShiftRight',
    'ControlLeft': 'ControlLeft',
    'ControlRight': 'ControlRight',
    'AltLeft': 'Alt',
    'AltRight': 'AltGr',
    'MetaLeft': 'MetaLeft',
    'MetaRight': 'MetaRight',
    'ArrowUp': 'UpArrow',
    'ArrowDown': 'DownArrow',
    'ArrowLeft': 'LeftArrow',
    'ArrowRight': 'RightArrow',
    'CapsLock': 'CapsLock',
    'Delete': 'Delete',
    'Insert': 'Insert',
    'Home': 'Home',
    'End': 'End',
    'PageUp': 'PageUp',
    'PageDown': 'PageDown',
  };
  return map[code] || null;
}

window.addEventListener('keydown', (e) => {
  if (!isRecording) return;
  if (e.repeat) return;
  // If rdev is working, it would have fired within the last 50ms.
  if (Date.now() - lastRdevEventTime < 50) return;
  
  const rdevKey = mapJsCodeToRdevKey(e.code);
  if (rdevKey) {
    e.preventDefault();
    invoke('inject_macro_event', { eventType: { KeyPress: rdevKey } });
  }
}, true);

window.addEventListener('keyup', (e) => {
  if (!isRecording) return;
  if (Date.now() - lastRdevEventTime < 50) return;
  
  const rdevKey = mapJsCodeToRdevKey(e.code);
  if (rdevKey) {
    e.preventDefault();
    invoke('inject_macro_event', { eventType: { KeyRelease: rdevKey } });
  }
}, true);

listen('recording-stopped', () => {
  if (!isRecording) return;
  isRecording = false;
  setStatus('idle');
  setRecordBtn(false);
});

btnRecord.addEventListener('click', async () => {
  if (isPlaying) return;
  isRecording = !isRecording;
  setRecordBtn(isRecording);
  setStatus(isRecording ? 'recording' : 'idle');
  if (isRecording) {
    recordedEvents = [];
    updateTimeline();
    await invoke('start_record_cmd');
  } else {
    await invoke('stop_record_cmd');
  }
});

function setRecordBtn(active: boolean) {
  btnRecord.classList.toggle('active', active);
  btnRecord.innerHTML = active
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg> STOP RECORDING`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"></circle></svg> START RECORDING`;
}

// ─── Playback ─────────────────────────────────────────────────────────────────

function updatePlayVisuals(playing: boolean) {
  const idle = btnPlay.querySelector('.idle') as HTMLElement;
  const play = btnPlay.querySelector('.playing') as HTMLElement;
  btnPlay.classList.toggle('active', playing);
  idle.style.display = playing ? 'none' : 'flex';
  play.style.display = playing ? 'flex' : 'none';
}

listen('playback-state', (event) => {
  isPlaying = event.payload as boolean;
  setStatus(isPlaying ? 'playing' : 'idle');
  updatePlayVisuals(isPlaying);

  if (!isPlaying && shouldLoop) {
    if (currentPlayingMacroId) {
      const m = activeMacros.get(currentPlayingMacroId);
      if (m) invoke('play_macro_cmd', { events: m.events });
    } else if (recordedEvents.length > 0) {
      invoke('play_macro_cmd', { events: recordedEvents });
    }
  }
});

listen('macro-triggered', async (event) => {
  if (isRecording || isPlaying) return;
  const id = event.payload as string;
  if (!id || id === 'legacy') return;
  
  const item = activeMacros.get(id);
  if (!item) return;

  if (item.type === 'script') {
    if (isScriptRunning) {
      appendLogLine('system', `-- Hotkey toggle: Stopping script "${item.name}"`);
      await invoke('stop_script_cmd');
    } else {
      appendLogLine('system', `-- Hotkey toggle: Starting script "${item.name}"`);
      try {
        await invoke('start_script_cmd', { code: item.code });
      } catch (err: any) {
        appendLogLine('error', `Start Failed: ${err}`);
      }
    }
  } else {
    currentPlayingMacroId = id;
    if (item.holdEnabled) shouldLoop = true;
    else shouldLoop = !!item.loopEnabled;
    
    invoke('play_macro_cmd', { events: item.events ?? [] });
  }
});

listen('macro-trigger-released', (event) => {
  const id = event.payload as string;
  if (!id || id === 'legacy') return;
  
  if (currentPlayingMacroId === id) {
    const item = activeMacros.get(id);
    if (item && item.type === 'timeline' && item.holdEnabled) {
      shouldLoop = false;
      invoke('stop_playback_cmd');
    }
  }
});

listen('emergency-disabled', () => {
  macroActive = false;
  toggleMacroActive.classList.remove('active');
  btnPlay.style.opacity = '0.4';
  
  activeMacros.clear();
  invoke('set_active_triggers', { triggers: {} });
  
  if (macroModal.style.display === 'flex') {
    renderMacroModal();
  }
  
  shouldLoop = false;
  currentPlayingMacroId = null;
  invoke('stop_playback_cmd');

  // Scripting emergency disarm integration
  appendLogLine('error', '-- EMERGENCY DISARM DETECTED: Script and macro disarmed!');
  isScriptRunning = false;
  scriptStatusEl.textContent = 'READY';
  scriptStatusEl.style.color = 'var(--success)';
});

btnPlay.addEventListener('click', async () => {
  if (isRecording) return;
  if (isPlaying) { 
    shouldLoop = false;
    await invoke('stop_playback_cmd'); 
    return; 
  }
  if (recordedEvents.length === 0) return;
  shouldLoop = loopEnabled && !holdEnabled; // manual play follows loop setting, but not hold
  await invoke('play_macro_cmd', { events: recordedEvents });
});

// ─── Controls ─────────────────────────────────────────────────────────────────

btnClear.addEventListener('click', async () => {
  if (isRecording || isPlaying) return;
  if (recordedEvents.length > 0) {
    const ok = await studioConfirm('Are you sure you want to clear the timeline?', 'CLEAR TIMELINE');
    if (!ok) return;
  }
  recordedEvents = [];
  updateTimeline();
});

toggleMouseRecord.addEventListener('click', () => {
  recordMouseMovement = !recordMouseMovement;
  toggleMouseRecord.classList.toggle('active', recordMouseMovement);
  mouseTrackBtn.classList.toggle('active-indicator', recordMouseMovement);
  invoke('set_record_mouse_movement', { enabled: recordMouseMovement });
});

toggleLoop.addEventListener('click', () => {
  loopEnabled = !loopEnabled;
  toggleLoop.classList.toggle('active', loopEnabled);
  if (loopEnabled) {
    holdEnabled = false;
    toggleHold.classList.remove('active');
  }
});

toggleHold.addEventListener('click', () => {
  holdEnabled = !holdEnabled;
  toggleHold.classList.toggle('active', holdEnabled);
  if (holdEnabled) {
    loopEnabled = false;
    toggleLoop.classList.remove('active');
  }
});

// Macro Active master switch
toggleMacroActive.addEventListener('click', () => {
  macroActive = !macroActive;
  toggleMacroActive.classList.toggle('active', macroActive);
  // Visual feedback: dim the play button when inactive
  btnPlay.style.opacity = macroActive ? '1' : '0.4';
  invoke('set_macro_active', { active: macroActive });
});

toggleBlockTrigger.addEventListener('click', () => {
  blockTriggerInput = !blockTriggerInput;
  toggleBlockTrigger.classList.toggle('active', blockTriggerInput);
  invoke('set_block_trigger_input', { enabled: blockTriggerInput });
  saveSettings();
});

// ─── Trigger Key ──────────────────────────────────────────────────────────────

function formatTriggerDisplay(key: string): string {
  if (key === 'MouseBtn1') return 'LClick';
  if (key === 'MouseBtn2') return 'RClick';
  if (key === 'MouseBtn3') return 'MClick';
  return key.replace('Key', '').replace('Digit', '');
}

function bindTriggerKey(btnEl: HTMLButtonElement, onComplete: (combo: string[]) => void) {
  let localBindingCombo: Set<string> = new Set();
  let localActiveKeys: Set<string> = new Set();
  
  btnEl.textContent = 'Hold keys...';
  btnEl.classList.add('listening');
  
  const handleKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    if (!e.repeat) {
      localActiveKeys.add(e.code);
      localBindingCombo.add(e.code);
      updateBtnUI();
    }
  };
  
  const handleKeyUp = (e: KeyboardEvent) => {
    e.preventDefault();
    localActiveKeys.delete(e.code);
    checkDone();
  };
  
  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    let code = '';
    if (e.button === 0) code = 'MouseBtn1';
    else if (e.button === 2) code = 'MouseBtn2';
    else if (e.button === 1) code = 'MouseBtn3';
    else code = `MouseBtn${e.button + 1}`;
    
    localActiveKeys.add(code);
    localBindingCombo.add(code);
    updateBtnUI();
  };
  
  const handleMouseUp = (e: MouseEvent) => {
    e.preventDefault();
    let code = '';
    if (e.button === 0) code = 'MouseBtn1';
    else if (e.button === 2) code = 'MouseBtn2';
    else if (e.button === 1) code = 'MouseBtn3';
    else code = `MouseBtn${e.button + 1}`;
    
    localActiveKeys.delete(code);
    checkDone();
  };
  
  const updateBtnUI = () => {
    const arr = Array.from(localBindingCombo);
    btnEl.textContent = arr.map(formatTriggerDisplay).join(' + ');
  };
  
  const checkDone = () => {
    if (localActiveKeys.size === 0 && localBindingCombo.size > 0) {
      cleanup();
      const arr = Array.from(localBindingCombo);
      btnEl.textContent = arr.map(formatTriggerDisplay).join(' + ');
      onComplete(arr);
    }
  };
  
  const cleanup = () => {
    btnEl.classList.remove('listening');
    window.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('keyup', handleKeyUp, true);
    window.removeEventListener('mousedown', handleMouseDown, true);
    window.removeEventListener('mouseup', handleMouseUp, true);
    window.removeEventListener('contextmenu', handleCtx, true);
  };

  const handleCtx = (e: Event) => e.preventDefault();

  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('keyup', handleKeyUp, true);
  window.addEventListener('mousedown', handleMouseDown, true);
  window.addEventListener('mouseup', handleMouseUp, true);
  window.addEventListener('contextmenu', handleCtx, true);
}

let bindingCombo: string[] = [];
btnTriggerKey.addEventListener('click', () => {
  bindTriggerKey(btnTriggerKey, (arr) => {
    bindingCombo = arr;
    invoke('set_trigger_combo', { combo: arr });
  });
});

let scriptTriggerCombo: string[] = [];
btnScriptTriggerKey.addEventListener('click', () => {
  bindTriggerKey(btnScriptTriggerKey, (arr) => {
    scriptTriggerCombo = arr;
  });
});

listen('macro-triggered', (event) => {
  const id = event.payload as string;
  if (id !== 'legacy') return;
  
  if (isRecording || recordedEvents.length === 0) return;
  
  if (isPlaying) {
    if (loopEnabled && !holdEnabled) {
      shouldLoop = false;
      invoke('stop_playback_cmd');
    }
    return;
  }
  
  shouldLoop = loopEnabled || holdEnabled;
  invoke('play_macro_cmd', { events: recordedEvents });
});

listen('macro-trigger-released', (event) => {
  const id = event.payload as string;
  if (id !== 'legacy') return;
  
  if (holdEnabled) {
    shouldLoop = false;
    invoke('stop_playback_cmd');
  }
});

// Removed duplicate emergency-disabled listener

// ─── Add Manual Event ─────────────────────────────────────────────────────────

let addType: string | null = null;
let capturedKeyCode: string | null = null;

btnAddEvent.addEventListener('click', () => {
  addType = null;
  capturedKeyCode = null;
  document.querySelectorAll('.add-event-type-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('add-event-form')!.style.display = 'none';
  addEventModal.style.display = 'flex';
});

addEventClose.addEventListener('click', () => { addEventModal.style.display = 'none'; });

document.querySelectorAll('.add-event-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.add-event-type-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    addType = btn.getAttribute('data-type');

    const form = document.getElementById('add-event-form')!;
    form.style.display = 'flex';

    const fKey   = document.getElementById('field-key')!;
    const fMouse = document.getElementById('field-mouse')!;
    const fText  = document.getElementById('field-text')!;
    fKey.style.display   = addType === 'key'   ? 'flex' : 'none';
    fMouse.style.display = addType === 'click' ? 'flex' : 'none';
    fText.style.display  = addType === 'text'  ? 'flex' : 'none';
  });
});

// Key capture: press a real key instead of typing
const keyCaptureBtnEl = document.getElementById('key-capture-btn')! as HTMLButtonElement;
const keyCaptureLabel = document.getElementById('key-capture-label')! as HTMLSpanElement;

keyCaptureBtnEl.addEventListener('click', () => {
  keyCaptureBtnEl.textContent = 'Press any key...';
  keyCaptureBtnEl.classList.add('listening');
  capturedKeyCode = null;
  keyCaptureLabel.textContent = '';

  const fn = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    capturedKeyCode = e.code;
    keyCaptureBtnEl.textContent = e.code;
    keyCaptureBtnEl.classList.remove('listening');
    keyCaptureLabel.textContent = `(${e.key})`;
    window.removeEventListener('keydown', fn, true);
  };
  window.addEventListener('keydown', fn, true);
});

// Segmented group for mouse button
document.querySelectorAll('#mouse-btn-group .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#mouse-btn-group .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.getElementById('btn-add-event-confirm')!.addEventListener('click', async () => {
  const delay = Math.max(0, parseInt((document.getElementById('input-delay') as HTMLInputElement).value) || 50);

  if (addType === 'key') {
    if (!capturedKeyCode) { await studioAlert('Please capture a key first!', 'ERROR'); return; }
    recordedEvents.push({ delay, event_type: { KeyPress: capturedKeyCode } });
    recordedEvents.push({ delay: 30, event_type: { KeyRelease: capturedKeyCode } });
  } else if (addType === 'click') {
    const btn = document.querySelector('#mouse-btn-group .seg-btn.active')?.getAttribute('data-val') ?? 'Left';
    recordedEvents.push({ delay, event_type: { ButtonPress: btn } });
    recordedEvents.push({ delay: 30, event_type: { ButtonRelease: btn } });
  } else if (addType === 'delay') {
    recordedEvents.push({ delay, event_type: 'Delay' });
  } else if (addType === 'text') {
    const txt = (document.getElementById('input-text') as HTMLInputElement).value;
    if (!txt) { await studioAlert('Please enter some text!', 'ERROR'); return; }
    const charMap: Record<string, string> = {
      ' ': 'Space', '\n': 'Return', '\t': 'Tab',
      '-': 'Minus', '=': 'Equal', '[': 'LeftBracket', ']': 'RightBracket',
      '\\': 'BackSlash', ';': 'SemiColon', '\'': 'Quote', ',': 'Comma', '.': 'Dot', '/': 'Slash',
      '`': 'BackQuote'
    };
    const shiftMap: Record<string, string> = {
      '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
      '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': '\'', '<': ',', '>': '.', '?': '/'
    };
    const groupId = 'group_' + Date.now();
    collapsedGroups.add(groupId);
    for (const char of txt) {
      let rdevKey: string | null = null;
      let needsShift = false;
      let c = char;
      if (shiftMap[c]) {
        needsShift = true;
        c = shiftMap[c];
      } else if (c >= 'A' && c <= 'Z') {
        needsShift = true;
        c = c.toLowerCase();
      }
      if (c >= 'a' && c <= 'z') rdevKey = `Key${c.toUpperCase()}`;
      else if (c >= '0' && c <= '9') rdevKey = `Num${c}`;
      else if (charMap[c]) rdevKey = charMap[c];
      
      if (rdevKey) {
        if (needsShift) recordedEvents.push({ delay, event_type: { KeyPress: 'ShiftLeft' }, groupId, groupText: txt });
        recordedEvents.push({ delay: needsShift ? 15 : delay, event_type: { KeyPress: rdevKey }, groupId, groupText: txt });
        recordedEvents.push({ delay: 15, event_type: { KeyRelease: rdevKey }, groupId, groupText: txt });
        if (needsShift) recordedEvents.push({ delay: 15, event_type: { KeyRelease: 'ShiftLeft' }, groupId, groupText: txt });
      }
    }
  } else { await studioAlert('Please select an event type first!', 'ERROR'); return; }

  updateTimeline();
  addEventModal.style.display = 'none';
});

// ─── Macro Save / Load ────────────────────────────────────────────────────────

function getLibraryItems(): LibraryItem[] {
  try {
    const raw = localStorage.getItem('macros') ?? '[]';
    const list = JSON.parse(raw);
    let migrated = false;
    const items = list.map((item: any) => {
      if (!item.type) {
        item.type = 'timeline';
        migrated = true;
      }
      return item as LibraryItem;
    });
    if (migrated) {
      localStorage.setItem('macros', JSON.stringify(items));
    }
    return items;
  } catch {
    return [];
  }
}

function saveLibraryItems(items: LibraryItem[]) {
  localStorage.setItem('macros', JSON.stringify(items));
}

btnSaveMacro.addEventListener('click', async () => {
  if (recordedEvents.length === 0) { await studioAlert('Timeline is empty!', 'ERROR'); return; }
  if (bindingCombo.length === 0) { await studioAlert('Please assign a trigger key before saving!', 'ERROR'); return; }
  const name = await studioPrompt('Please enter a name for the macro:', '', 'SAVE MACRO');
  if (!name) return;
  const list = getLibraryItems();
  list.push({ 
    id: Date.now().toString(), 
    name, 
    type: 'timeline',
    events: [...recordedEvents], 
    triggerCombo: [...bindingCombo],
    loopEnabled,
    holdEnabled,
    createdAt: Date.now() 
  });
  saveLibraryItems(list);
  await studioAlert(`"${name}" saved successfully.`, 'INFO');
});

btnSaveScript.addEventListener('click', async () => {
  const code = luaCodeEditor.value.trim();
  if (!code) {
    await studioAlert('Script editor is empty!', 'ERROR');
    return;
  }
  if (scriptTriggerCombo.length === 0) {
    await studioAlert('Please assign a trigger key before saving!', 'ERROR');
    return;
  }
  const name = await studioPrompt('Please enter a name for the script:', '', 'SAVE SCRIPT');
  if (!name) return;
  
  const list = getLibraryItems();
  list.push({
    id: Date.now().toString(),
    name,
    type: 'script',
    code,
    triggerCombo: [...scriptTriggerCombo],
    createdAt: Date.now()
  });
  saveLibraryItems(list);
  await studioAlert(`"${name}" saved to library successfully.`, 'INFO');
});

let currentFilterType: 'all' | 'timeline' | 'script' = 'all';
let currentSearchQuery = '';

btnLoadMacro.addEventListener('click', () => {
  currentSearchQuery = '';
  currentFilterType = 'all';
  librarySearchInput.value = '';
  filterTabs.forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-filter') === 'all');
  });
  macroModal.style.display = 'flex';
  renderMacroModal();
});
macroClose.addEventListener('click', () => { macroModal.style.display = 'none'; });

librarySearchInput.addEventListener('input', () => {
  currentSearchQuery = librarySearchInput.value.toLowerCase().trim();
  renderMacroModal();
});

filterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    filterTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilterType = tab.getAttribute('data-filter') as 'all' | 'timeline' | 'script';
    renderMacroModal();
  });
});

function syncActiveTriggers() {
  const triggers: Record<string, string[]> = {};
  for (const [id, macro] of activeMacros.entries()) {
    if (macro.triggerCombo && macro.triggerCombo.length > 0) {
      triggers[id] = macro.triggerCombo;
    }
  }
  invoke('set_active_triggers', { triggers });
}

function renderMacroModal() {
  const list = getLibraryItems();
  macroContent.innerHTML = '';
  
  const filtered = list.filter(item => {
    if (!isPremium && item.type === 'script') return false;
    if (currentFilterType !== 'all' && item.type !== currentFilterType) return false;
    if (currentSearchQuery) {
      const nameMatch = item.name.toLowerCase().includes(currentSearchQuery);
      const codeMatch = item.type === 'script' && item.code && item.code.toLowerCase().includes(currentSearchQuery);
      return nameMatch || codeMatch;
    }
    return true;
  });

  if (filtered.length === 0) {
    macroContent.innerHTML = '<p class="modal-empty" style="text-align:center; padding: 30px; color: var(--text-muted); font-size: 11px;">No matching macros or scripts found.</p>';
    return;
  }

  filtered.forEach(m => {
    const card = document.createElement('div');
    card.className = `macro-card type-${m.type}`;
    
    const triggerHtml = m.triggerCombo && m.triggerCombo.length > 0 
      ? m.triggerCombo.map(k => `<kbd class="macro-kbd" style="font-family: var(--font-mono); background: var(--bg-main); border: 1px solid var(--border); padding: 2px 4px; border-radius: 4px; font-size: 9px; color: var(--text-main);">${formatTriggerDisplay(k)}</kbd>`).join('<span class="kbd-separator" style="color: var(--text-muted); font-size: 9px;">+</span>') 
      : '<span style="color: var(--text-muted); font-size: 9px; font-style: italic;">Unassigned</span>';
    
    const isActive = activeMacros.has(m.id);
    if (isActive) {
      card.classList.add('is-active');
    }
    
    const typeLabel = m.type === 'script' ? 'Lua Script' : 'Timeline Macro';
    
    const typeIcon = m.type === 'script'
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6M12 4.5l4 15"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`;

    const detailsText = m.type === 'script'
      ? `${m.code ? m.code.split('\n').length : 0} lines`
      : `${m.events ? m.events.length : 0} events`;

    card.innerHTML = `
      <div class="macro-card-icon-container">${typeIcon}</div>
      <div class="macro-card-info" style="display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1;">
        <div class="macro-card-title-row" style="display: flex; align-items: center; gap: 6px;">
          <span class="macro-card-title" style="font-size: 12px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${m.name}</span>
          <span class="macro-type-badge ${m.type}">${typeLabel}</span>
        </div>
        <div class="macro-card-meta" style="font-size: 9px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <span>${new Date(m.createdAt).toLocaleString()}</span>
          <span>·</span>
          <span>${detailsText}</span>
          ${m.type === 'timeline' && m.loopEnabled ? '<span class="macro-badge active-badge">Loop</span>' : ''}
          ${m.type === 'timeline' && m.holdEnabled ? '<span class="macro-badge active-badge">Hold</span>' : ''}
        </div>
      </div>
      <div class="macro-card-operations" style="display: flex; align-items: center; gap: 12px;">
        <div class="macro-trigger-container" style="display: flex; align-items: center; margin-right: 8px;">
          <div class="macro-trigger-keys" style="display: flex; gap: 3px; align-items: center;">${triggerHtml}</div>
        </div>
        <div class="macro-card-actions" style="display: flex; gap: 4px;">
          <button class="seg-btn" data-load="${m.id}" style="height: 22px; font-size: 8px; padding: 0 6px; margin: 0;">${m.type === 'script' ? 'EDIT' : 'LOAD'}</button>
          <button class="seg-btn danger" data-del="${m.id}" style="height: 22px; font-size: 8px; padding: 0 6px; margin: 0;">DELETE</button>
        </div>
        <div class="macro-arm-toggle-container" style="display: flex; align-items: center; gap: 6px; border-left: 1px solid var(--border); padding-left: 10px;">
          <span class="arm-label" style="font-size: 8px; font-weight: 700; letter-spacing: 0.3px; color: var(--text-muted); text-transform: uppercase;">${isActive ? 'Armed' : 'Arm'}</span>
          <div class="toggle ${isActive ? 'active' : ''}" data-toggle="${m.id}" title="Toggle Activation">
            <div class="toggle-handle"></div>
          </div>
        </div>
      </div>
    `;
    
    card.querySelector('[data-load]')!.addEventListener('click', () => {
      if (m.type === 'script') {
        luaCodeEditor.value = m.code || '';
        updateHighlight();
        scriptTriggerCombo = [...m.triggerCombo];
        btnScriptTriggerKey.textContent = scriptTriggerCombo.map(formatTriggerDisplay).join(' + ');
        btnViewTimeline.classList.remove('active');
        btnViewScripting.classList.add('active');
        timelineArea.style.display = 'none';
        scriptingView.style.display = 'flex';
      } else {
        recordedEvents = JSON.parse(JSON.stringify(m.events ?? []));
        bindingCombo = [...m.triggerCombo];
        btnTriggerKey.textContent = bindingCombo.map(formatTriggerDisplay).join(' + ');
        updateTimeline();
        btnViewScripting.classList.remove('active');
        btnViewTimeline.classList.add('active');
        scriptingView.style.display = 'none';
        timelineArea.style.display = 'flex';
      }
      macroModal.style.display = 'none';
    });
    
    card.querySelector('[data-del]')!.addEventListener('click', async () => {
      const ok = await studioConfirm(`Delete "${m.name}"?`, 'DELETE CONFIRMATION');
      if (!ok) return;
      if (activeMacros.has(m.id)) {
        activeMacros.delete(m.id);
        syncActiveTriggers();
      }
      saveLibraryItems(getLibraryItems().filter(x => x.id !== m.id));
      renderMacroModal();
    });
    
    const toggle = card.querySelector('[data-toggle]') as HTMLDivElement;
    toggle.addEventListener('click', async () => {
      if (!m.triggerCombo || m.triggerCombo.length === 0) {
        await studioAlert('Cannot activate: No trigger key assigned.', 'WARNING');
        return;
      }
      if (activeMacros.has(m.id)) {
        activeMacros.delete(m.id);
        toggle.classList.remove('active');
        card.classList.remove('is-active');
        card.querySelector('.arm-label')!.textContent = 'Arm';
        syncActiveTriggers();
      } else {
        const comboStr = m.triggerCombo.join('+');
        let conflict = false;
        for (const [_, aMac] of activeMacros.entries()) {
           if (aMac.triggerCombo && aMac.triggerCombo.join('+') === comboStr) {
              await studioAlert(`Conflict: Trigger combination is already used by active configuration "${aMac.name}".`, 'CONFLICT WARNING');
              conflict = true;
              break;
           }
        }
        if (!conflict) {
          activeMacros.set(m.id, m);
          toggle.classList.add('active');
          card.classList.add('is-active');
          card.querySelector('.arm-label')!.textContent = 'Armed';
          syncActiveTriggers();
          if (!macroActive) {
             macroActive = true;
             toggleMacroActive.classList.add('active');
             btnPlay.style.opacity = '1';
             invoke('set_macro_active', { active: true });
          }
        }
      }
    });
    
    macroContent.appendChild(card);
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function saveSettings() {
  localStorage.setItem('settings', JSON.stringify({
    blockTriggerInput,
    emergencyFallback,
    emergencyKey,
    emergencyDuration
  }));
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('settings') || '{}');
    if (s.blockTriggerInput) {
      blockTriggerInput = true;
      toggleBlockTrigger.classList.add('active');
      invoke('set_block_trigger_input', { enabled: true });
    }
    if (s.emergencyFallback !== undefined) emergencyFallback = s.emergencyFallback;
    if (s.emergencyKey) emergencyKey = s.emergencyKey;
    if (s.emergencyDuration) emergencyDuration = s.emergencyDuration;
    
    toggleEmergencyFallback.classList.toggle('active', emergencyFallback);
    btnEmergencyKey.textContent = emergencyKey.replace('Key','').replace('Digit','');
    inputEmergencyHold.value = String(emergencyDuration);
    
    syncEmergencyConfig();
  } catch {}
}

function syncEmergencyConfig() {
  invoke('set_emergency_config', { 
    enabled: emergencyFallback, 
    key: emergencyKey, 
    duration: emergencyDuration 
  });
}

btnSettings.addEventListener('click', () => {
  settingsModal.style.display = 'flex';
});

settingsClose.addEventListener('click', () => {
  settingsModal.style.display = 'none';
});

toggleEmergencyFallback.addEventListener('click', () => {
  emergencyFallback = !emergencyFallback;
  toggleEmergencyFallback.classList.toggle('active', emergencyFallback);
  syncEmergencyConfig();
  saveSettings();
});

let isBindingEmergency = false;
btnEmergencyKey.addEventListener('click', () => {
  if (isBindingEmergency) return;
  isBindingEmergency = true;
  btnEmergencyKey.textContent = 'Press any key...';
  
  const handleKey = (e: KeyboardEvent) => {
    e.preventDefault();
    emergencyKey = e.code;
    btnEmergencyKey.textContent = emergencyKey.replace('Key','').replace('Digit','');
    isBindingEmergency = false;
    window.removeEventListener('keydown', handleKey, true);
    syncEmergencyConfig();
    saveSettings();
  };
  window.addEventListener('keydown', handleKey, true);
});

inputEmergencyHold.addEventListener('change', () => {
  const val = parseInt(inputEmergencyHold.value);
  if (!isNaN(val) && val >= 100) {
    emergencyDuration = val;
    syncEmergencyConfig();
    saveSettings();
  }
});

// ─── Window Controls ──────────────────────────────────────────────────────────

const appWin = getCurrentWindow();
document.getElementById('btn-minimize')!.addEventListener('click', () => appWin.minimize());
document.getElementById('btn-maximize')!.addEventListener('click', () => appWin.toggleMaximize());
document.getElementById('btn-close')!.addEventListener('click',    () => appWin.close());

// ─── Auto Updater ─────────────────────────────────────────────────────────────

(async () => {
  try {
    const u = await check();
    if (u) { await u.downloadAndInstall(); await relaunch(); }
  } catch {}
})();

// ─── Init ─────────────────────────────────────────────────────────────────────

setStatus('idle');
updateTimeline();
// Sync initial macroActive state
btnPlay.style.opacity = macroActive ? '1' : '0.4';
loadSettings();

// Premium UI exclusion
if (!isPremium) {
  const scriptingSection = btnViewScripting.closest('.panel-section') as HTMLElement;
  if (scriptingSection) {
    scriptingSection.style.display = 'none';
  }
  const luaFilterTab = document.querySelector('.filter-tab[data-filter="script"]') as HTMLElement;
  if (luaFilterTab) {
    luaFilterTab.style.display = 'none';
  }
}

// ─── Scripting Panel Integration ──────────────────────────────────────────────

// Helper to write console logs
function appendLogLine(level: string, message: string) {
  const line = document.createElement('div');
  line.className = `log-line ${level}`;
  line.textContent = message;
  consoleLogs.appendChild(line);
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// Tab view switching
btnViewTimeline.addEventListener('click', () => {
  btnViewScripting.classList.remove('active');
  btnViewTimeline.classList.add('active');
  scriptingView.style.display = 'none';
  timelineArea.style.display = 'flex';
});

btnViewScripting.addEventListener('click', () => {
  btnViewTimeline.classList.remove('active');
  btnViewScripting.classList.add('active');
  timelineArea.style.display = 'none';
  scriptingView.style.display = 'flex';
});

// Load saved script code from LocalStorage
const savedScript = localStorage.getItem('lua_script');
if (savedScript !== null) {
  luaCodeEditor.value = savedScript;
}

// Highlight script on initial load
updateHighlight();

// Auto-save & debounced auto-validation on typing
let validateTimeout: any = null;
luaCodeEditor.addEventListener('input', () => {
  localStorage.setItem('lua_script', luaCodeEditor.value);
  updateHighlight();
  
  clearTimeout(validateTimeout);
  validateTimeout = setTimeout(async () => {
    const code = luaCodeEditor.value.trim();
    if (!code) return;
    try {
      await invoke('validate_script_cmd', { code });
      // Silent auto-validation success
    } catch (err: any) {
      // Don't log syntax error on every keystroke, let them manually validate or check
    }
  }, 1000);
});

// Error Line Number Extractor
function extractErrorLineNumber(err: string): number | null {
  const match = err.match(/(?:\[string\s*"[^"]*"\]|chunk|line):(\d+):/i) || err.match(/:(\d+):/);
  return match ? parseInt(match[1], 10) : null;
}

// Focus and highlight specific line in the editor textarea
function highlightEditorLine(lineNum: number) {
  const text = luaCodeEditor.value;
  const lines = text.split('\n');
  if (lineNum < 1 || lineNum > lines.length) return;
  
  let start = 0;
  for (let i = 0; i < lineNum - 1; i++) {
    start += lines[i].length + 1; // +1 for newline character
  }
  const end = start + (lines[lineNum - 1] ? lines[lineNum - 1].length : 0);
  
  luaCodeEditor.focus();
  luaCodeEditor.setSelectionRange(start, end);
  
  // Smoothly scroll the textarea to center the error line
  const lineHeight = 17.6; // estimated line height in px
  luaCodeEditor.scrollTop = Math.max(0, (lineNum - 3) * lineHeight);
}

// Regex dynamic parser to find internal triggers mapped inside the code
function detectInternalTriggers(code: string): string[] {
  const keys: Set<string> = new Set();
  const regexes = [
    /arg\s*==\s*["']([^"']+)["']/g,
    /arg\s*==\s*\[\[([^\]]+)\]\]/g
  ];
  
  for (const regex of regexes) {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(code)) !== null) {
      const val = match[1].trim();
      const upperVal = val.toUpperCase();
      if (!["KEY_PRESSED", "KEY_RELEASE", "KEY_RELEASED", "MOUSE_PRESSED", "MOUSE_RELEASE", "PLAYBACK_START", "PLAYBACK_STOP", "M_PRESSED", "M_RELEASE"].includes(upperVal)) {
        keys.add(val);
      }
    }
  }
  return Array.from(keys);
}

// Update Console header keys container
function updateDetectedKeysDisplay(keys: string[]) {
  if (keys.length === 0) {
    detectedKeysContainer.style.display = 'none';
    detectedKeysList.innerHTML = '';
    return;
  }
  detectedKeysContainer.style.display = 'flex';
  detectedKeysList.innerHTML = keys.map(k => `<span class="detected-key-badge">${k}</span>`).join('');
}

// Close alert error banner listener
btnCloseErrorBanner.addEventListener('click', () => {
  editorErrorBanner.style.display = 'none';
});

// Manual Validate & Check Script button
btnValidateScript.addEventListener('click', async () => {
  const code = luaCodeEditor.value;
  appendLogLine('system', '-- Checking Lua Script & Analyzing triggers...');
  
  // Hide previous error banner
  editorErrorBanner.style.display = 'none';
  
  try {
    await invoke('validate_script_cmd', { code });
    appendLogLine('info', 'SUCCESS: Syntax validation passed!');
    
    // Scan for and display triggers
    const detected = detectInternalTriggers(code);
    updateDetectedKeysDisplay(detected);
    if (detected.length > 0) {
      appendLogLine('info', `ANALYZER: Detected ${detected.length} internal hotkeys: ${detected.join(', ')}`);
    } else {
      appendLogLine('system', 'ANALYZER: No internal event hotkeys detected in code.');
    }
  } catch (err: any) {
    appendLogLine('error', `SYNTAX ERROR: ${err}`);
    
    // Extract line number and select it
    const lineNum = extractErrorLineNumber(err);
    if (lineNum !== null) {
      highlightEditorLine(lineNum);
      showErrorBanner(`Syntax Error on Line ${lineNum}: ${err.replace(/\[string\s*"[^"]*"\]:\d+:\s*/gi, '')}`);
      appendLogLine('error', `ANALYZER: Focused on line ${lineNum} inside editor.`);
    } else {
      showErrorBanner(`Syntax Error: ${err}`);
    }
    
    // Clear detected keys display on error
    updateDetectedKeysDisplay([]);
  }
});

function showErrorBanner(msg: string) {
  errorBannerText.textContent = msg;
  editorErrorBanner.style.display = 'flex';
}

// Console Clear button
btnClearConsole.addEventListener('click', () => {
  consoleLogs.innerHTML = '';
  appendLogLine('system', '-- Console cleared.');
});

// Listen to backend log events
listen('script-log', (event: any) => {
  const { level, message } = event.payload as { level: string; message: string };
  appendLogLine(level, message);
});

// Listen to backend script running state changes
listen('script-state', (event: any) => {
  isScriptRunning = event.payload as boolean;
  
  if (isScriptRunning) {
    scriptStatusEl.textContent = 'RUNNING';
    scriptStatusEl.style.color = 'var(--primary)';
  } else {
    scriptStatusEl.textContent = 'READY';
    scriptStatusEl.style.color = 'var(--success)';
  }
});

// ─── Lua Syntax Highlighter Implementation ───────────────────────────────────
function highlightLua(code: string): string {
  let html = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const tokenRegex = /(--[^\n]*)|("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')|(\b(?:function|end|if|then|else|elseif|for|while|do|in|local|return|repeat|until|break|nil|true|false|and|or|not)\b)|(\b(?:MoveMouseRelative|PressKey|ReleaseKey|PressMouseButton|ReleaseMouseButton|Sleep|Random|print|OnEvent)\b)|(\b\d+(?:\.\d+)?\b)/g;

  html = html.replace(tokenRegex, (match, comment, str, keyword, api, num) => {
    if (comment) {
      return `<span class="hl-comment">${match}</span>`;
    } else if (str) {
      return `<span class="hl-string">${match}</span>`;
    } else if (keyword) {
      return `<span class="hl-keyword">${match}</span>`;
    } else if (api) {
      return `<span class="hl-api">${match}</span>`;
    } else if (num) {
      return `<span class="hl-number">${match}</span>`;
    }
    return match;
  });

  return html;
}

function updateHighlight() {
  const code = luaCodeEditor.value;
  luaHighlightCode.innerHTML = highlightLua(code);
}

// Scroll synchronization
luaCodeEditor.addEventListener('scroll', () => {
  luaHighlightOverlay.scrollTop = luaCodeEditor.scrollTop;
  luaHighlightOverlay.scrollLeft = luaCodeEditor.scrollLeft;
});
