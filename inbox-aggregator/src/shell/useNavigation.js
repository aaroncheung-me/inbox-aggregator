import { useEffect, useState } from 'react';
import { PHONE_LAYOUT } from '../layout';

// Kinds of open tab. Emails, notes and scheduled emails open as a temporary
// tab (shown in italics) that the next one opened replaces, as in VS Code; it
// becomes kept once it's used (keep). The rest are always kept.
const TEMPORARY_KINDS = new Set(['email', 'note', 'scheduled']);
const tabKey = (kind, id = null) => `${kind}:${id ?? ''}`;

// The tabs with `added` shown: an open one is updated (it stays kept once
// kept); a temporary one takes the place of the temporary tab there is (if
// any); anything else goes after the tab showing.
function withTab({ tabs, activeKey }, added) {
  if (tabs.some(t => t.key === added.key)) {
    return tabs.map(t => (t.key === added.key ? { ...t, ...added, kept: t.kept || added.kept } : t));
  }
  const temporary = tabs.findIndex(t => !t.kept);
  if (!added.kept && temporary >= 0) return tabs.map((t, i) => (i === temporary ? added : t));
  const at = tabs.findIndex(t => t.key === activeKey);
  return [...tabs.slice(0, at + 1), added, ...tabs.slice(at + 1)];
}

// The tabs without `key`; if it was showing, the one to its right shows (else its left).
function withoutTab({ tabs, activeKey }, key) {
  const index = tabs.findIndex(t => t.key === key);
  if (index < 0) return { tabs, activeKey };
  const rest = tabs.filter(t => t.key !== key);
  return { tabs: rest, activeKey: key === activeKey ? (rest[index] || rest[index - 1])?.key ?? null : activeKey };
}

// What's on screen: the sidebar's tab (Inbox | Notes), and the open tabs of
// the main pane, one of them showing: an email, a note, the email being written
// ('draft', at most one), the assistant ('chat'), Settings, a scheduled email,
// or the phone's new-note page. No tabs means "Nothing open". On a phone, also
// which of the two screens is showing (the phone has no tab strip: one page at
// a time, closed with × or left with the tabs above it).
// Each tab: { key, kind, id, kept }, emails also { label, color } (their
// subject and account aren't always at hand later); the app names the rest.
// startOnNewNote: the app was opened from the "New note" shortcut on a phone.
export function useNavigation(initialTab, { startOnNewNote = false } = {}) {
  const [tab, setTab] = useState(initialTab);
  // the open tabs and which one shows, changed together and always from the
  // latest state (they often change from async callbacks)
  const [opened, setOpened] = useState(() => (startOnNewNote
    ? { tabs: [{ key: tabKey('newnote'), kind: 'newnote', id: null, kept: true }], activeKey: tabKey('newnote') }
    : { tabs: [], activeKey: null }));
  const { tabs, activeKey } = opened;
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
    if (phoneScreen === 'main' || !window.matchMedia(PHONE_LAYOUT).matches) return;
    window.history.pushState({ screen: 'main' }, '');
    setPhoneScreen('main');
  }

  function showListScreen() {
    // going back through history keeps it in step; popstate then switches the screen
    if (window.history.state?.screen === 'main') window.history.back();
    else setPhoneScreen('list');
  }

  // Shows a tab, opening it if needed (see withTab).
  function open(kind, id = null, { kept = !TEMPORARY_KINDS.has(kind), ...info } = {}) {
    const key = tabKey(kind, id);
    setOpened(prev => ({ tabs: withTab(prev, { key, kind, id, ...info, kept }), activeKey: key }));
    showMainScreen();
  }

  function close(key) {
    setOpened(prev => withoutTab(prev, key));
  }

  function keep(key) {
    if (tabs.some(t => t.key === key && !t.kept)) {
      setOpened(prev => ({ ...prev, tabs: prev.tabs.map(t => (t.key === key ? { ...t, kept: true } : t)) }));
    }
  }

  const active = tabs.find(t => t.key === activeKey) || null;
  const activeId = kind => (active?.kind === kind ? active.id : null);

  return {
    tab,
    setTab,
    tabs,
    active,
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
    keepTab: keep,
    // info: { label, color } for its tab
    openMessage: (id, info) => open('email', id, info),
    openNote: (id, { kept } = {}) => {
      open('note', id, { kept });
      setTab('notes');
    },
    openChat: () => open('chat'),
    showDraft: () => open('draft'),
    openSettings: () => open('settings'),
    openScheduled: id => open('scheduled', id),
    openNewNote: () => {
      open('newnote');
      setTab('notes');
    },
    hideDraft: () => close(tabKey('draft')),
    closeNote: id => close(tabKey('note', id)),
    closeScheduled: id => close(tabKey('scheduled', id)),
    closeNewNote: () => close(tabKey('newnote')),
  };
}
