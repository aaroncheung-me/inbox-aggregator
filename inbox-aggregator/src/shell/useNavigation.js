import { useEffect, useState } from 'react';
import { PHONE_LAYOUT } from '../layout';

// What's on screen: the sidebar's tab, and the one thing the main pane shows
// (an email, a note, the email being written, or else the chat). On a phone,
// also which of the two screens is showing.
// (While an email is being written, its assistant can open emails and notes,
// and the draft waits behind a "Back to your email" link.)
export function useNavigation(initialTab) {
  const [tab, setTab] = useState(initialTab);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [draftVisible, setDraftVisible] = useState(false);
  // phone layout only: 'list' (sidebar) or 'main' (email or chat)
  const [phoneScreen, setPhoneScreen] = useState('list');

  // Opening the main screen adds a browser history entry, so the phone's back
  // gesture (or back button) returns to the list instead of leaving the app.
  useEffect(() => {
    function handlePopState() {
      setPhoneScreen(window.history.state?.screen === 'main' ? 'main' : 'list');
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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

  function openMessage(id) {
    setDraftVisible(false);
    setSelectedNoteId(null);
    setSelectedMessageId(id);
    showMainScreen();
  }

  function openNote(id) {
    setDraftVisible(false);
    setSelectedMessageId(null);
    setSelectedNoteId(id);
    setTab('notes');
    showMainScreen();
  }

  function openChat() {
    setDraftVisible(false);
    setSelectedNoteId(null);
    setSelectedMessageId(null);
    showMainScreen();
  }

  function showDraft() {
    setDraftVisible(true);
    showMainScreen();
  }

  return {
    tab,
    setTab,
    selectedMessageId,
    selectedNoteId,
    draftVisible,
    phoneScreen,
    showMainScreen,
    showListScreen,
    openMessage,
    openNote,
    openChat,
    showDraft,
    hideDraft: () => setDraftVisible(false),
    closeMessage: () => setSelectedMessageId(null),
    closeNote: () => setSelectedNoteId(null),
  };
}
