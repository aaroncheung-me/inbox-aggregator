import { useEffect, useState } from 'react';
import { PHONE_LAYOUT } from '../layout';

// What's on screen: the sidebar's tab, and the one thing the main pane shows
// (an email, a note, the email being written, Settings, a scheduled email, the
// assistant, or the phone's new-note page; with none of them, "Nothing open").
// On a phone, also which of the two screens is showing.
// (While an email is being written, its assistant can open emails and notes,
// and the draft waits behind a "Back to email" link.)
// startOnNewNote: the app was opened from the "New note" shortcut on a phone.
export function useNavigation(initialTab, { startOnNewNote = false } = {}) {
  const [tab, setTab] = useState(initialTab);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [draftVisible, setDraftVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [selectedScheduledId, setSelectedScheduledId] = useState(null); // a Send later email
  const [chatVisible, setChatVisible] = useState(false);
  const [newNoteVisible, setNewNoteVisible] = useState(startOnNewNote); // phone only
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

  // everything but the email being written, which waits in the background
  function closePages() {
    setDraftVisible(false);
    setSettingsVisible(false);
    setSelectedScheduledId(null);
    setSelectedNoteId(null);
    setSelectedMessageId(null);
    setChatVisible(false);
    setNewNoteVisible(false);
  }

  function openMessage(id) {
    closePages();
    setSelectedMessageId(id);
    showMainScreen();
  }

  function openNote(id) {
    closePages();
    setSelectedNoteId(id);
    setTab('notes');
    showMainScreen();
  }

  function openChat() {
    closePages();
    setChatVisible(true);
    showMainScreen();
  }

  function showDraft() {
    setDraftVisible(true);
    setSettingsVisible(false);
    setSelectedScheduledId(null);
    setNewNoteVisible(false);
    showMainScreen();
  }

  function openSettings() {
    closePages();
    setSettingsVisible(true);
    showMainScreen();
  }

  function openScheduled(id) {
    closePages();
    setSelectedScheduledId(id);
    showMainScreen();
  }

  function openNewNote() {
    closePages();
    setTab('notes');
    setNewNoteVisible(true);
    showMainScreen();
  }

  return {
    tab,
    setTab,
    selectedMessageId,
    selectedNoteId,
    draftVisible,
    settingsVisible,
    selectedScheduledId,
    chatVisible,
    newNoteVisible,
    phoneScreen,
    showMainScreen,
    showListScreen,
    openMessage,
    openNote,
    openChat,
    showDraft,
    openSettings,
    openScheduled,
    openNewNote,
    closeScheduled: () => setSelectedScheduledId(null),
    hideDraft: () => setDraftVisible(false),
    closeMessage: () => setSelectedMessageId(null),
    closeNote: () => setSelectedNoteId(null),
    closeNewNote: () => setNewNoteVisible(false),
  };
}
