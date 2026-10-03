import { useEffect, useRef } from 'react';
import ChatPanel from '../assistant/ChatPanel';

// The chat in the sidebar while an email is being written (asked through the
// ask box at the top). It can search the inbox and notes like the main
// assistant, and writes drafts only when asked. A draft shows with "Use this
// draft"; nothing goes into the email until that's pressed.
// chat: the draft's useChat.
function DraftAssistant({ chat, onUseDraft, onOpenMessage, onOpenNote }) {
  const chatEnd = useRef(null);
  const { history, loading, pending } = chat;

  // keeps the newest answer in view
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end' });
  }, [history.length, loading, pending?.steps.length, pending?.text.length]);

  return (
    <div className="draft-assistant-chat">
      <ChatPanel
        history={history}
        loading={loading}
        pending={pending}
        workingLabel="Working on it..."
        error={chat.error}
        onOpenMessage={onOpenMessage}
        onOpenNote={onOpenNote}
        onUndoCreatedNote={chat.undoCreatedNote}
        onUseDraft={onUseDraft}
        emptyContent={(
          <>
            <p>Ask the assistant above for help with this email, for example:</p>
            <p className="chat-example">"Draft a reply saying I can make Thursday"</p>
            <p className="chat-example">"Make it shorter and more friendly"</p>
            <p className="chat-example">"What did we agree on last time?"</p>
            <p className="chat-tip">It only changes your email when you press "Use this draft".</p>
          </>
        )}
      />
      <div ref={chatEnd} />
    </div>
  );
}

export default DraftAssistant;
