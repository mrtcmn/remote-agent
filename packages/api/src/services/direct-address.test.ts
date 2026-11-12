import { expect, test } from 'bun:test';
import { detect, effective } from './direct-address';

const ifaces = (addrs: string[]) => ({ x: addrs.map((address) => ({ address, family: 'IPv4', internal: false })) });

test('picks the Tailscale address (100.64.0.0/10)', () => {
  expect(detect(ifaces(['192.168.1.5', '100.69.173.3']), 5100, {})).toBe('http://100.69.173.3:5100');
});
test('ignores 100.x outside the CGNAT range and Docker bridges', () => {
  expect(detect(ifaces(['100.128.0.1', '172.18.0.2']), 5100, {})).toBeNull();
});
test('Docker: TAILSCALE_IP seeds the value', () => {
  expect(detect(ifaces(['172.18.0.2']), 5100, { TAILSCALE_IP: '100.69.173.3', PORT: '5100' })).toBe('http://100.69.173.3:5100');
});
test('a user value wins; clearing it returns to auto', () => {
  expect(effective({ url: 'http://10.0.0.9:5100', source: 'user' }, 'http://100.1.1.1:5100')).toBe('http://10.0.0.9:5100');
  expect(effective(null, 'http://100.1.1.1:5100')).toBe('http://100.1.1.1:5100');
});
