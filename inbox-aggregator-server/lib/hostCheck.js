const dns = require('dns').promises;
const net = require('net');
const { UserError } = require('./errors');

// Addresses a user-supplied mail server must never point at: this machine and
// private networks. Once the server is online, this stops someone from using
// the "connect a mail server" form to probe whatever sits next to it.
const blocked = new net.BlockList();
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addSubnet('10.0.0.0', 8, 'ipv4');
blocked.addSubnet('100.64.0.0', 10, 'ipv4');
blocked.addSubnet('127.0.0.0', 8, 'ipv4');
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('172.16.0.0', 12, 'ipv4');
blocked.addSubnet('192.168.0.0', 16, 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');

async function assertPublicHost(host) {
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new UserError(`Couldn't find a mail server at ${host}`);
  }

  for (const { address, family } of addresses) {
    // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as the IPv4 address it wraps
    const mapped = family === 6 && address.toLowerCase().startsWith('::ffff:') && net.isIPv4(address.slice(7));
    const isBlocked = mapped
      ? blocked.check(address.slice(7), 'ipv4')
      : blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
    if (isBlocked) throw new UserError(`${host} points to a private address, which isn't allowed`);
  }
}

module.exports = { assertPublicHost };
