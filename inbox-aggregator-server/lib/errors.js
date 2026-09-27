// An error whose message is safe and useful to show the user as-is
// (e.g. "The server rejected that email/password"). Routes send these back
// as a 400; anything else stays a generic 500.
class UserError extends Error {}

module.exports = { UserError };
