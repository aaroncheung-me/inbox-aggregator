import AskBar from './AskBar';
import SyncStatus from './SyncStatus';
import AccountsPanel from './AccountsPanel';
import PhoneAccountsBar from './PhoneAccountsBar';
import MessageList from './MessageList';
import SidebarTabs from './SidebarTabs';
import NotesPanel from './NotesPanel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { PHONE_LAYOUT } from '../layout';

function Sidebar({
  onAsk,
  onFocusChat,
  asking,
  lastSyncedAt,
  onSync,
  syncing,
  messages,
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
  onMoveNote,
}) {
  const accountColors = new Map(accounts.map(a => [a.id, a.color]));
  // Desktop: sync status and accounts sit above the inbox list, sign-out below it.
  // Phone: all of that folds into one bar under the list, so the list screen opens uncluttered.
  const isPhone = useMediaQuery(PHONE_LAYOUT);

  const noticeBanner = notice && (
    <div className={`notice notice-${notice.type}`} role="status">
      <span>{notice.text}</span>
      <button className="notice-dismiss" onClick={onDismissNotice} aria-label="Dismiss">×</button>
    </div>
  );

  const inboxList = search ? (
    <>
      <div className="search-header">
        <span>
          {search.loading
            ? 'Searching...'
            : `${search.results.length}${search.hasMore ? '+' : ''} result${search.results.length === 1 ? '' : 's'} for "${search.query}"`}
        </span>
        <button className="btn btn-ghost btn-small" onClick={onClearSearch}>Back to inbox</button>
      </div>
      {search.error && <p className="search-empty">{search.error}</p>}
      {!search.loading && !search.error && search.results.length === 0 && (
        <p className="search-empty">No emails match.</p>
      )}
      <MessageList
        messages={search.results}
        accountColors={accountColors}
        selectedId={selectedId}
        onSelect={onSelect}
        hasMore={search.hasMore}
        loadingMore={search.loadingMore}
        onLoadMore={onLoadMoreSearch}
        total={null}
      />
    </>
  ) : (
    <MessageList
      messages={messages}
      accountColors={accountColors}
      selectedId={selectedId}
      onSelect={onSelect}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
      total={total}
    />
  );

  return (
    <div className="sidebar">
      <AskBar onAsk={onAsk} onSearch={onSearch} onFocusChat={onFocusChat} asking={asking} />
      {/* phone layout only: on desktop the chat is always beside the list */}
      {chatCount > 0 && (
        <button className="phone-open-chat phone-only" onClick={onOpenChat}>
          View AI conversation ({chatCount}) →
        </button>
      )}
      <SidebarTabs tab={tab} onChange={onTabChange} dueCount={dueCount} />

      <div className="sidebar-scroll">
        {tab === 'notes' ? (
          <>
            {noticeBanner}
            <NotesPanel
              notes={notes}
              now={now}
              selectedNoteId={selectedNoteId}
              onSelect={onSelectNote}
              onCreate={onCreateNote}
              onMove={onMoveNote}
            />
          </>
        ) : (
          <>
            {!isPhone && (
              <>
                <SyncStatus lastSyncedAt={lastSyncedAt} onSync={onSync} syncing={syncing} />
                <AccountsPanel
                  accounts={accounts}
                  onToggleAccount={onToggleAccount}
                  onChangeColor={onChangeAccountColor}
                  onAccountConnected={onAccountConnected}
                />
              </>
            )}
            {noticeBanner}
            {inboxList}
          </>
        )}
      </div>

      {isPhone ? (
        <PhoneAccountsBar
          accounts={accounts}
          onToggleAccount={onToggleAccount}
          onChangeColor={onChangeAccountColor}
          onAccountConnected={onAccountConnected}
          lastSyncedAt={lastSyncedAt}
          onSync={onSync}
          syncing={syncing}
          userEmail={userEmail}
          onSignOut={onSignOut}
        />
      ) : (
        <div className="sidebar-footer">
          <span className="signed-in-as" title={userEmail}>{userEmail}</span>
          <button className="btn btn-ghost btn-small" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export default Sidebar;
