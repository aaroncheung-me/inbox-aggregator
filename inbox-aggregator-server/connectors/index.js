// Each connector turns one provider's messages into the same normalized shape,
// so sync, storage and search never need to know where a message came from.
//
// A connector exports:
//   provider                                        matches accounts.provider
//   fetchNew({ credentials, syncState, filterUnknown })
//     -> { messages, labelUpdates, syncState }
//   fetchPage({ credentials, pageToken })           one page of older history
//     -> { messages, nextPageToken }
//   downloadAttachment({ credentials, messageExternalId, attachmentExternalId, maxBytes })
//     -> Buffer
//   getReplyHeaders({ credentials, messageExternalId })
//     -> { messageId, references, replyTo }         what a reply to that message needs
//   send({ credentials, mail, threadId })           mail: nodemailer message options
//   isRateLimitError(err)
const gmail = require('./gmail');
const imap = require('./imap');

const connectors = { [gmail.provider]: gmail, [imap.provider]: imap };

function connectorFor(provider) {
  const connector = connectors[provider];
  if (!connector) throw new Error(`No connector for provider "${provider}"`);
  return connector;
}

module.exports = { connectorFor };
