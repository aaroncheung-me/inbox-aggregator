function EmailDetail({ message, account, loading, error }) {
  if (loading) return <div className="email-detail">Loading...</div>;
  if (error) return <div className="email-detail">Error: {error}</div>;
  if (!message) return null;

  return (
    <div className="email-detail">
      {account && (
        <div className="received-by">
          <span className="account-dot" style={{ background: account.color }} aria-hidden="true" />
          {account.display_name || account.email_address}
        </div>
      )}
      <div className="subject">{message.subject || '(no subject)'}</div>
      <div className="meta">
        {message.sender} · {new Date(message.received_at).toLocaleString()}
      </div>
      {message.attachments?.length > 0 && (
        <ul className="attachments">
          {message.attachments.map(a => (
            <li key={a.id}>{a.filename || '(unnamed attachment)'}</li>
          ))}
        </ul>
      )}
      <div className="body">{message.body || message.snippet}</div>
    </div>
  );
}

export default EmailDetail;