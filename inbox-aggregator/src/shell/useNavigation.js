import { useEffect, useState } from 'react';
import { PHONE_LAYOUT } from '../layout';

// Reading tabs (an email, a note, a scheduled email, or a new empty tab) work
// like a browser's: opening something to read replaces what the current tab
// shows, if that tab is also for reading. Work tabs (the email being written,
// the assistant, Settings, the phone's new note) are one each and never
// replaced, so reading opens next to them instead.
const READING = new Set(['email', 'note', 'scheduled', 'empty']);
let tabCount = 0;
const newKey = () => `tab${++tabCount}`;
const isPhone = () => window.matchMedia(PHONE_LAYOUT).matches;

// Puts `tab` after the one showing (or at `at`).
function insert(tabs, tab, activeKey, at = null) {
  const index = at ?? tabs.findIndex(t => t.key === activeKey) + 1;
  return [...tabs.slice(0, index), tab, ...tabs.slice(index)];
}

function without({ tabs, activeKey, besideKey }, key) {
  const index = tabs.findIndex(t => t.key === key);
  if (index < 0) return { tabs, activeKey, besideKey };
  const rest = tabs.filter(t => t.key !== key);
  return {
    tabs: rest,
    // the tab to its right shows next (else its left)
    activeKey: key === activeKey ? (rest[index] || rest[index - 1])?.key ?? null : activeKey,
    // closing the email being written, or the tab beside it, ends the split
    besideKey: key === besideKey || key === 'draft' ? null : besideKey,
  };
}

// What's on screen: the sidebar's tab (Inbox | Notes), and the main pane's
// open tabs, one of them showing. No tabs means "Nothing open". While the
// email being written shows, one reading tab can show beside it (besideKey;
// desktop only). On a phone, also which of the two screens is showing (the
// phone has no tab strip: one page at a time, closed with ×).
// Each tab: { key, kind, id }, emails also { label, color } (their subject
// and account aren't always at hand later); the app names the rest. Work
// tabs' keys are their kind.
// startOnNewNote: the app was opened from the "New note" shortcut on a phone.
export function useNavigation(initialTab, { startOnNewNote = false } = {}) {
  const [tab, setTab] = useState(initialTab);
  // the tabs, which one shows and which one sits beside the email being
  // written: changed together, always from the latest state (often from
  // async callbacks)
  const [opened, setOpened] = useState(() => (startOnNewNote
    ? { tabs: [{ key: 'newnote', kind: 'newnote', id: null }], activeKey: 'newnote', besideKey: null }
    : { tabs: [], activeKey: null, besideKey: null }));
  const { tabs, activeKey, besideKey } = opened;
  // phone layout only: 'list' (sidebar) or 'main' (email, note, chat...)
  const [phoneScreen, setPhoneScreen] = useState(startOnNewNote ? 'main' : 'list');

  // Opening the main screen adds a browser history entry, so the phone's back
  // gesture (or back button) returns to the list instead of leaving the app.
  useEffect(() => {
    function handlePopState() {
      setPhoneScreen(window.history.state?.screen === 'main' ? 'main' : 'list');
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // started on the main screen: give it its history entry too
  useEffect(() => {
    if (startOnNewNote && window.history.state?.screen !== 'main') window.history.pushState({ screen: 'main' }, '');
  }, [startOnNewNote]);

  function showMainScreen() {
    if (phoneScreen === 'main' || !isPhone()) return;
    window.history.pushState({ screen: 'main' }, '');
    setPhoneScreen('main');
  }

  function showListScreen() {
    // going back through history keeps it in step; popstate then switches the screen
    if (window.history.state?.screen === 'main') window.history.back();
    else setPhoneScreen('list');
  }

  // Opens something to read. Already open: its tab shows. Otherwise:
  // newTab false: in the tab showing, if it's a reading tab; while writing
  //   (desktop), beside the email being written; else in a new tab after it.
  // newTab true: a new tab (at `at`, else after the one showing), shown if focus.
  // info: { label, color } for an email's tab.
  function openReading(kind, id, info = {}, { newTab = false, at = null, focus = true } = {}) {
    const phone = isPhone();
    setOpened(prev => {
      const open = prev.tabs.find(t => t.kind === kind && t.id === id);
      const active = prev.tabs.find(t => t.key === prev.activeKey);
      if (open) {
        if (!newTab && active?.kind === 'draft' && !phone) return { ...prev, besideKey: open.key };
        return focus ? { ...prev, activeKey: open.key } : prev;
      }
      const content = { kind, id, ...info };
      if (!newTab && active && READING.has(active.kind)) {
        return { ...prev, tabs: prev.tabs.map(t => (t.key === active.key ? { key: t.key, ...content } : t)) };
      }
      const added = { key: newKey(), ...content };
      const tabs = insert(prev.tabs, added, prev.activeKey, at);
      if (!newTab && active?.kind === 'draft' && !phone) return { ...prev, tabs, besideKey: added.key };
      return { ...prev, tabs, activeKey: focus ? added.key : prev.activeKey };
    });
    if (focus) showMainScreen();
  }

  // Opens a work tab (one of each), or shows it. A new empty tab becomes it.
  function openWork(kind) {
    setOpened(prev => {
      if (prev.tabs.some(t => t.key === kind)) return { ...prev, activeKey: kind };
      const active = prev.tabs.find(t => t.key === prev.activeKey);
      const added = { key: kind, kind, id: null };
      const tabs = active?.kind === 'empty'
        ? prev.tabs.map(t => (t.key === active.key ? added : t))
        : insert(prev.tabs, added, prev.activeKey);
      return { ...prev, tabs, activeKey: kind };
    });
    showMainScreen();
  }

  function close(key) {
    setOpened(prev => without(prev, key));
  }

  // closes the tab showing this note or scheduled email, if any
  function closeShowing(kind, id) {
    setOpened(prev => {
      const open = prev.tabs.find(t => t.kind === kind && t.id === id);
      return open ? without(prev, open.key) : prev;
    });
  }

  const active = tabs.find(t => t.key === activeKey) || null;
  const activeId = kind => (active?.kind === kind ? active.id : null);
  const beside = active?.kind === 'draft' ? tabs.find(t => t.key === besideKey) || null : null;

  return {
    tab,
    setTab,
    tabs,
    active,
    beside,
    besideKey,
    selectedMessageId: activeId('email'),
    selectedNoteId: activeId('note'),
    selectedScheduledId: activeId('scheduled'),
    draftVisible: active?.kind === 'draft',
    settingsVisible: active?.kind === 'settings',
    chatVisible: active?.kind === 'chat',
    newNoteVisible: active?.kind === 'newnote',
    phoneScreen,
    showMainScreen,
    showListScreen,
    showTab: key => {
      setOpened(prev => ({ ...prev, activeKey: key }));
      showMainScreen();
    },
    closeTab: close,
    // "+": a new tab showing nothing, for the next thing opened
    newTab: () => {
      setOpened(prev => {
        const added = { key: newKey(), kind: 'empty', id: null };
        return { ...prev, tabs: insert(prev.tabs, added, prev.activeKey), activeKey: added.key };
      });
    },
    // opts: { newTab, at, focus } (see openReading)
    openMessage: (id, info, opts) => openReading('email', id, info, opts),
    openNote: (id, opts) => {
      openReading('note', id, {}, opts);
      if (opts?.focus !== false) setTab('notes');
    },
    openScheduled: (id, opts) => openReading('scheduled', id, {}, opts),
    openChat: () => openWork('chat'),
    showDraft: () => openWork('draft'),
    openSettings: () => openWork('settings'),
    openNewNote: () => {
      openWork('newnote');
      setTab('notes');
    },
    // a reading tab beside the email being written, which shows
    showBeside: key => setOpened(prev => ({ ...prev, activeKey: 'draft', besideKey: key })),
    closeBeside: () => setOpened(prev => ({ ...prev, besideKey: null })),
    hideDraft: () => close('draft'),
    closeNote: id => closeShowing('note', id),
    closeScheduled: id => closeShowing('scheduled', id),
    closeNewNote: () => close('newnote'),
  };
}
