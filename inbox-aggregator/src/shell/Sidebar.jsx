import AskBar from '../features/assistant/AskBar';
import { askPlaceholders } from '../features/assistant/askPlaceholders';
import SyncStatus from '../features/email/SyncStatus';
import FolderSwitch from '../features/email/FolderSwitch';
import PaneBar from '../ui/PaneBar';
import ResultsBar from '../ui/ResultsBar';
import { resultsText } from '../format';
import AccountsPanel from '../features/accounts/AccountsPanel';
import PhoneAccountsBar from '../features/accounts/PhoneAccountsBar';
import MessageList from '../features/email/MessageList';
import ScheduledList from '../features/compose/ScheduledList';
import SidebarTabs from './SidebarTabs';
import NotesPanel from '../features/notes/NotesPanel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { PHONE_LAYOUT } from '../layout';

function Sidebar({
  onAsk,
  // desktop: folds the sidebar away (« at its top left)
  onCollapse,
  // the ask bar's AI | Search switch, and what empties its box (see AskBar)
  askMode,
  onAskModeChange,
  askResetKey,
  asking,
  lastSyncedAt,
  onSync,
  syncing,
  messages,
  // temp address -> its color, for the stripes of the emails it received
  tempColors,
  pinned = [],
  selectedId,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
  total,
  notice,
  onDismissNotice,
  accounts,
  onToggleAccount,
  onChangeAccountColor,
  onAccountConnected,
  userEmail,
  onSignOut,
  onOpenSettings,
  settingsOpen,
  search,
  onSearch,
  onClearSearch,
  onLoadMoreSearch,
  chatCount,
  onOpenChat,
  tab,
  onTabChange,
  dueCount,
  notes,
  now,
  selectedNoteId,
  onSelectNote,
  onCreateNote,
  onAiCreateNote,
  onMoveNote,
  onSuggestOrganizing,
  onApplyOrganizing,
  // a search on the Notes tab (null when none), and closing it
  noteQuery = null,
  onClearNoteQuery,
  // phone: opens the full-screen new note
  onStartNote,
  creditsBanner,
  focusAskBox = false,
  focusNoteBox = false,
  onNewEmail,
  // temp addresses, shown under the accounts: { temp, now, onCreate, onExtend, onDelete }
  tempAddresses = null,
  folder,
  onFolderChange,
  // Send later emails not sent yet, in their own group above Sent
  scheduled = [],
  selectedScheduledId = null,
  onOpenScheduled,
  // while an email is being written: { title, onBackToDraft, onDiscard, chat }.
  // The Inbox | Notes row becomes "Writing: ...", the list below becomes
  // the email's assistant, and the ask box at the top asks that assistant.
  drafting = null,
  // phone: an email being written while something else shows, { title, onShow }
  waitingDraft = null,
}) {
  // Desktop: sync status and accounts sit above the inbox list, sign-out below it.
  // Phone: all of that folds into one bar under the list, so the list screen opens uncluttered.
  const isPhone = useMediaQuery(PHONE_LAYOUT);

  const accountColors = new Map(accounts.map(a => [a.id, a.color]));

  const noticeBanner = notice && (
    <div className={`notice notice-${notice.type}`} role="status">
      <span>{notice.text}</span>
      <button className="notice-dismiss" onClick={onDismissNotice} aria-label="Dismiss">×</button>
    </div>
  );

  const searchList = search && (
    <>
      <ResultsBar
        backLabel={drafting ? 'Assistant' : 'Inbox'}
        onBack={onClearSearch}
        text={search.loading ? 'Searching...' : resultsText(search.results.length, search.query, search.hasMore)}
      />
      {search.error && <p className="search-empty">{search.error}</p>}
      {!search.loading && !search.error && search.results.length === 0 && (
        <p className="search-empty">No emails match.</p>
      )}
      <MessageList
        messages={search.results}
        accountColors={accountColors}
        tempColors={tempColors}
        selectedId={selectedId}
        onSelect={onSelect}
        hasMore={search.hasMore}
        loadingMore={search.loadingMore}
        onLoadMore={onLoadMoreSearch}
        total={null}
      />
    </>
  );

  // received or sent mail, whichever the switch above the list shows; pinned
  // emails sit in their own group above Received, scheduled ones above Sent
  const folderList = (
    <>
      {folder === 'sent' && scheduled.length > 0 && (
        <>
          <div className="list-group-label">Scheduled</div>
          <ScheduledList scheduled={scheduled} accountColors={accountColors} selectedId={selectedScheduledId} onSelect={onOpenScheduled} />
          <div className="list-group-label">Sent</div>
        </>
      )}
      {folder === 'inbox' && pinned.length > 0 && (
        <>
          <div className="list-group-label">Pinned</div>
          <MessageList messages={pinned} accountColors={accountColors} tempColors={tempColors} selectedId={selectedId} onSelect={onSelect} hasMore={false} />
          <div className="list-group-label">Received</div>
        </>
      )}
      <MessageList
        messages={messages}
        accountColors={accountColors}
        tempColors={tempColors}
        selectedId={selectedId}
        onSelect={onSelect}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        total={total}
        showRecipients={folder === 'sent'}
      />
    </>
  );

  return (
    <div className="sidebar">
      {creditsBanner}
      {/* Phone, while writing: this screen is the email's assistant. Its bar
          mirrors the writing screen's: the switch between them top left,
          Discard top right. */}
      {drafting && isPhone && (
        <PaneBar
          left={<button className="btn btn-ghost btn-small" onClick={drafting.onBackToDraft}>Back to email</button>}
          title="Assistant"
        >
          <button className="btn btn-ghost btn-small" onClick={drafting.onDiscard}>Discard</button>
        </PaneBar>
      )}
      {/* while writing, Discard is in the writing screen's own bar */}
      <AskBar
        mode={askMode}
        onModeChange={onAskModeChange}
        onAsk={onAsk}
        onSearch={onSearch}
        asking={asking}
        autoFocus={focusAskBox}
        placeholders={askPlaceholders({ drafting, tab })}
        resetKey={askResetKey}
        onCollapse={isPhone ? undefined : onCollapse}
        // New email; while writing it becomes Discard in the same spot (on a
        // phone, Discard is in this screen's bar above)
        topAction={!drafting
          ? { label: 'New email', onClick: onNewEmail }
          : isPhone ? undefined : { label: 'Discard', onClick: drafting.onDiscard, className: 'btn-ghost' }}
      />
      {/* phone layout only: on desktop the chat is always beside the list */}
      {waitingDraft && (
        <button className="phone-open-chat phone-only" onClick={waitingDraft.onShow}>
          Back to writing: {waitingDraft.title} →
        </button>
      )}
      {!drafting && chatCount > 0 && (
        <button className="phone-open-chat phone-only" onClick={onOpenChat}>
          View AI conversation ({chatCount}) →
        </button>
      )}
      {/* desktop, while writing: the main pane's bar has "Back to email" when needed */}
      {drafting ? (
        !isPhone && (
          <div className="draft-bar">
            <span className="draft-bar-title">Writing: {drafting.title}</span>
          </div>
        )
      ) : (
        <SidebarTabs tab={tab} onChange={onTabChange} dueCount={dueCount} />
      )}

      <div className="sidebar-scroll">
        {drafting ? (
          // searching still works while writing; otherwise this is the email's assistant
          searchList || drafting.chat
        ) : tab === 'notes' ? (
          <>
            {noticeBanner}
            <NotesPanel
              notes={notes}
              now={now}
              selectedNoteId={selectedNoteId}
              onSelect={onSelectNote}
              onCreate={onCreateNote}
              onAiCreate={onAiCreateNote}
              onMove={onMoveNote}
              onSuggestOrganizing={onSuggestOrganizing}
              onApplyOrganizing={onApplyOrganizing}
              autoFocusComposer={focusNoteBox && !isPhone}
              query={noteQuery}
              onClearQuery={onClearNoteQuery}
              onStartNote={isPhone ? onStartNote : undefined}
            />
          </>
        ) : search ? (
          // search results take the whole list's place, right under the bar
          <>
            {noticeBanner}
            {searchList}
          </>
        ) : (
          <>
            <div className="list-header">
              <FolderSwitch folder={folder} onChange={onFolderChange} />
              <SyncStatus lastSyncedAt={lastSyncedAt} onSync={onSync} syncing={syncing} />
            </div>
            {!isPhone && (
              <AccountsPanel
                accounts={accounts}
                onToggleAccount={onToggleAccount}
                onChangeColor={onChangeAccountColor}
                onAccountConnected={onAccountConnected}
                tempAddresses={tempAddresses}
              />
            )}
            {noticeBanner}
            {folderList}
          </>
        )}
      </div>

      {isPhone ? (
        <PhoneAccountsBar
          accounts={accounts}
          onToggleAccount={onToggleAccount}
          onChangeColor={onChangeAccountColor}
          onAccountConnected={onAccountConnected}
          userEmail={userEmail}
          onSignOut={onSignOut}
          onOpenSettings={onOpenSettings}
          tempAddresses={tempAddresses}
        />
      ) : (
        <div className="sidebar-footer">
          <span className="signed-in-as" title={userEmail}>{userEmail}</span>
          <span className="sidebar-footer-actions">
            <button
              className={`btn btn-ghost btn-small settings-button${settingsOpen ? ' active' : ''}`}
              onClick={onOpenSettings}
              aria-pressed={settingsOpen}
            >
              Settings
            </button>
            <button className="btn btn-ghost btn-small" onClick={onSignOut}>Sign out</button>
          </span>
        </div>
      )}
    </div>
  );
}

export default Sidebar;
