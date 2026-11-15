import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreNetworkInterface, getLocalLanUrls, RoomManager } from '../server/roomManager.js';

test('Network Interface Scoring & Priority Engine', async (t) => {
  await t.test('prioritizes Wi-Fi and Wireless interfaces over Ethernet and VPNs', () => {
    const wifiScore = scoreNetworkInterface('Беспроводная сеть', {
      address: '192.168.1.105',
      netmask: '255.255.255.0',
    });
    const ethernetScore = scoreNetworkInterface('Ethernet', {
      address: '192.168.1.100',
      netmask: '255.255.255.0',
    });
    const radminScore = scoreNetworkInterface('Radmin VPN', {
      address: '26.122.31.190',
      netmask: '255.0.0.0',
    });
    const adguardVpnScore = scoreNetworkInterface('AdGuard VPN', {
      address: '172.16.219.2',
      netmask: '255.255.255.255',
    });

    assert.ok(
      wifiScore > ethernetScore,
      `Wi-Fi score (${wifiScore}) should exceed Ethernet score (${ethernetScore})`,
    );
    assert.ok(
      ethernetScore > radminScore,
      `Ethernet score (${ethernetScore}) should exceed Radmin score (${radminScore})`,
    );
    assert.ok(
      radminScore > adguardVpnScore,
      `Radmin score (${radminScore}) should exceed /32 VPN tunnel score (${adguardVpnScore})`,
    );
  });

  await t.test('heavily penalizes /32 point-to-point tunnel netmasks', () => {
    const normalSubnet = scoreNetworkInterface('Local LAN', {
      address: '192.168.0.50',
      netmask: '255.255.255.0',
    });
    const p2pTunnel = scoreNetworkInterface('Local LAN', {
      address: '192.168.0.50',
      netmask: '255.255.255.255',
    });

    assert.equal(normalSubnet - p2pTunnel, 100);
  });

  await t.test('penalizes container and virtual adapters (WSL, Docker, Hyper-V, Tailscale)', () => {
    const virtualAdapters = [
      'vEthernet (WSL)',
      'docker0',
      'Hyper-V Virtual Adapter',
      'Tailscale',
      'WireGuard Tunnel',
      'VirtualBox Host-Only Ethernet Adapter',
    ];

    for (const name of virtualAdapters) {
      const score = scoreNetworkInterface(name, {
        address: '192.168.1.20',
        netmask: '255.255.255.0',
      });
      // Base is 100, penalty is -120 -> score should be <= -20
      assert.ok(score <= 0, `Virtual adapter "${name}" should receive negative score, got ${score}`);
    }
  });

  await t.test('penalizes APIPA link-local addresses (169.254.x.x)', () => {
    const score = scoreNetworkInterface('Ethernet', {
      address: '169.254.120.3',
      netmask: '255.255.0.0',
    });
    assert.ok(score < 0, `APIPA address should have negative score, got ${score}`);
  });

  await t.test('getLocalLanUrls returns valid HTTP URLs with given port and no duplicates', () => {
    const port = 3000;
    const urls = getLocalLanUrls(port);

    assert.ok(Array.isArray(urls), 'urls should be an array');
    assert.ok(urls.length > 0, 'urls should not be empty');

    const seen = new Set<string>();
    for (const url of urls) {
      assert.ok(url.startsWith('http://'), `URL "${url}" should start with http://`);
      assert.ok(url.endsWith(`:${port}`), `URL "${url}" should end with port :${port}`);
      assert.ok(!seen.has(url), `Duplicate URL found: ${url}`);
      seen.add(url);
    }
  });

  await t.test('RoomManager initializes and snapshots include prioritized LAN URLs', () => {
    const rm = new RoomManager(3000);
    const mockWs: any = {
      readyState: 1,
      send: () => {},
    };
    (rm as any).createRoom(mockWs, 'Тест-Ведущий');

    const rooms = (rm as any).rooms;
    const room = Array.from(rooms.values())[0] as any;
    assert.ok(room, 'Room should exist');

    const snapshot = (rm as any).makeSnapshot(room);
    assert.ok(snapshot !== null, 'Room snapshot should exist');
    assert.ok(Array.isArray(snapshot?.lanUrls), 'snapshot.lanUrls should be an array');
    assert.ok((snapshot?.lanUrls.length ?? 0) > 0, 'snapshot.lanUrls should not be empty');

    // Refreshed LAN URLs match
    const refreshed = rm.refreshLanUrls();
    assert.deepEqual(refreshed, snapshot?.lanUrls);

    rm.dispose();
  });
});
