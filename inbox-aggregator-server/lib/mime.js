const MailComposer = require('nodemailer/lib/mail-composer');

// Builds the raw email (RFC 822) from nodemailer message options.
// keepBcc leaves the Bcc header in: Gmail's API needs it to know where to
// deliver, and the copy saved to a Sent folder should show it. Mail handed to
// an SMTP server must leave it out, or every recipient would see it.
async function buildRawEmail(mail, { keepBcc = false } = {}) {
  const message = new MailComposer(mail).compile();
  message.keepBcc = keepBcc;
  return message.build();
}

// "<a@b> <c@d>" -> ['<a@b>', '<c@d>']
function messageIds(headerValue) {
  return String(headerValue || '').match(/<[^<>\s]+>/g) || [];
}

module.exports = { buildRawEmail, messageIds };
