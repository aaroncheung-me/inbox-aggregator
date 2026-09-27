import ChatPanel from './ChatPanel';
import EmailDetail from './EmailDetail';

function MainPane({
  selectedMessageId,
  selectedMessage,
  selectedAccount,
  messageLoading,
  messageError,
  chatHistory,
  chatLoading,
  chatError,
  onOpenMessage,
  onCloseMessage,
  onBackToList,
}) {
  return (
    <div className="main-pane">
      {/* phone layout only: the list is a separate screen there */}
      <button className="phone-back phone-only" onClick={onBackToList}>← Inbox</button>
      {selectedMessageId != null ? (
        <>
          {chatHistory.length > 0 && (
            <button className="back-link" onClick={onCloseMessage}>← Back to assistant</button>
          )}
          <EmailDetail message={selectedMessage} account={selectedAccount} loading={messageLoading} error={messageError} />
        </>
      ) : (
        <ChatPanel history={chatHistory} loading={chatLoading} error={chatError} onOpenMessage={onOpenMessage} />
      )}
    </div>
  );
}

export default MainPane;