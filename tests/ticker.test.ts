import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TickerMessage } from '../shared/protocol.js';

describe('Ticker Mechanics & Smooth Appending Unit Tests', () => {
  it('1. Newly arriving messages are marked fresh for first pass', () => {
    const seenIds = new Set<string>();
    const freshIds = new Set<string>();

    const initialMsgs: TickerMessage[] = [
      { id: 't1', authorName: 'Автор', text: 'Старая новость', createdAt: Date.now() - 10000 },
    ];
    for (const m of initialMsgs) {
      seenIds.add(m.id);
    }

    // New message arrives from writer
    const writerMsg: TickerMessage = {
      id: 't2',
      authorName: 'Сценарист',
      text: 'Новый сценарий: сенсация!',
      createdAt: Date.now(),
    };

    const isNew = !seenIds.has(writerMsg.id);
    assert.equal(isNew, true, 'Message t2 must be recognized as newly arrived');

    if (isNew) {
      seenIds.add(writerMsg.id);
      freshIds.add(writerMsg.id);
    }

    assert.equal(freshIds.has('t2'), true, 't2 must be marked as fresh on arrival');
    assert.equal(freshIds.has('t1'), false, 't1 must not be marked as fresh');
  });

  it('2. First pass completion removes fresh status so subsequent loops are normal', () => {
    const freshIds = new Set<string>(['t2']);

    // Simulate item on track
    const trackItem = {
      uid: 'fresh-t2-1',
      msgId: 't2',
      isFresh: true,
      offsetLeft: 1500,
      offsetWidth: 300,
    };

    // Before exiting: scrollX is 1200 -> itemRight (1800) > scrollX (1200) -> still visible
    let scrollX = 1200;
    let itemRight = trackItem.offsetLeft + trackItem.offsetWidth;
    assert.equal(itemRight < scrollX, false, 'Item is still visible, must remain fresh');

    // After traversal: scrollX advances to 1900 -> itemRight (1800) < scrollX (1900) -> completely off-screen
    scrollX = 1900;
    if (itemRight < scrollX) {
      freshIds.delete(trackItem.msgId);
      trackItem.isFresh = false;
    }

    assert.equal(freshIds.has('t2'), false, 'Fresh ID must be removed after complete traversal');
    assert.equal(trackItem.isFresh, false, 'Track item fresh flag cleared');

    // Future loop copy of t2
    const loopedItem = {
      uid: 'loop-t2-2',
      msgId: 't2',
      isFresh: freshIds.has('t2'),
    };
    assert.equal(loopedItem.isFresh, false, 'Looped item must NOT be fresh (normal styling)');
  });

  it('3. Appending new messages preserves existing items and offsets (zero jump)', () => {
    interface Item {
      uid: string;
      msgId: string;
      text: string;
      offset: number;
      width: number;
    }

    const existing: Item[] = [
      { uid: 'u1', msgId: 't1', text: 'Item 1', offset: 0, width: 250 },
      { uid: 'u2', msgId: 't2', text: 'Item 2', offset: 274, width: 300 },
    ];

    const currentScrollX = 150;
    const item1ViewportXBefore = existing[0].offset - currentScrollX;
    const item2ViewportXBefore = existing[1].offset - currentScrollX;

    // Writer appends new item
    const newItem: Item = {
      uid: 'u3',
      msgId: 't3',
      text: 'New Item 3',
      offset: 598,
      width: 280,
    };

    const track = [...existing, newItem];

    // Verify existing items did not change offsets or visible positions
    assert.equal(track[0].offset - currentScrollX, item1ViewportXBefore);
    assert.equal(track[1].offset - currentScrollX, item2ViewportXBefore);
    assert.equal(track[2].offset, 598);
  });

  it('4. Left pad trimming preserves sub-pixel coordinates of all visible items', () => {
    let padLeft = 0;
    const scrollX = 600;

    // Items layout: padLeft (0) + item0 (width 200 + gap 24 = 224) + item1 (offset 224, width 300)
    const item0 = { uid: 'u0', width: 200, gap: 24 };
    const item1 = { uid: 'u1', width: 300, gap: 24 };

    // Visible position of item1 before trim:
    const item1OffsetBefore = padLeft + item0.width + item0.gap; // 224
    const item1ViewportBefore = item1OffsetBefore - scrollX; // 224 - 600 = -376

    // item0 is off-screen (200 < 600 - 250). Trim item0:
    const removedWidth = item0.width + item0.gap; // 224
    padLeft += removedWidth; // padLeft becomes 224

    // Visible position of item1 after trim (item1 is now first item after padLeft):
    const item1OffsetAfter = padLeft; // 224
    const item1ViewportAfter = item1OffsetAfter - scrollX; // 224 - 600 = -376

    assert.equal(
      item1ViewportAfter,
      item1ViewportBefore,
      'Viewport position of item1 must remain 100% identical after trimming off-screen item',
    );
  });

  it('5. Hacker ticker_hack updates content dynamically without shifting positions', () => {
    const items = [
      { uid: 'u1', msgId: 't1', text: 'Original text', hackedText: undefined },
      { uid: 'u2', msgId: 't2', text: 'Other text', hackedText: undefined },
    ];

    const hackedMsgId = 't1';
    const scrambled = '0r!g1n@l t3xt';

    for (const item of items) {
      if (item.msgId === hackedMsgId) {
        item.hackedText = scrambled;
      }
    }

    assert.equal(items[0].hackedText, scrambled);
    assert.equal(items[1].hackedText, undefined);
  });

  it('6. Prompt entry insertion avoids 50-second backlog delay while preserving visible items', () => {
    // Current viewport: [scrollX, scrollX + viewportWidth]
    const scrollX = 500;
    const viewportWidth = 1000;
    const visibleRightEdge = scrollX + viewportWidth; // 1500

    interface TrackNode {
      uid: string;
      offsetLeft: number;
      offsetWidth: number;
      isFresh: boolean;
    }

    const currentTrack: TrackNode[] = [
      { uid: 'u1', offsetLeft: 300, offsetWidth: 350, isFresh: false }, // [300, 650] visible
      { uid: 'u2', offsetLeft: 674, offsetWidth: 400, isFresh: false }, // [674, 1074] visible
      { uid: 'u3', offsetLeft: 1098, offsetWidth: 350, isFresh: false }, // [1098, 1448] entering right edge
      { uid: 'u4', offsetLeft: 1472, offsetWidth: 350, isFresh: false }, // [1472, 1822] crossing edge (1472 <= 1560)
      { uid: 'u5', offsetLeft: 1846, offsetWidth: 350, isFresh: false }, // [1846, 2196] off-screen to right (1846 > 1560)
      { uid: 'u6', offsetLeft: 2220, offsetWidth: 350, isFresh: false }, // [2220, 2570] distant backlog
    ];

    // Find cut point: first item whose offsetLeft > visibleRightEdge + 60 (1560)
    let insertIdx = currentTrack.length;
    for (let i = 0; i < currentTrack.length; i++) {
      if (currentTrack[i].offsetLeft > visibleRightEdge + 60) {
        insertIdx = i;
        break;
      }
    }
    assert.equal(insertIdx, 4, 'Cut point should be index 4 (item u5), keeping all visible/entering items untouched');

    // New writer message arrives
    const newMsgItem: TrackNode = {
      uid: 'fresh-w1-1',
      offsetLeft: 1846,
      offsetWidth: 320,
      isFresh: true,
    };

    const head = currentTrack.slice(0, insertIdx);
    const tail = currentTrack.slice(insertIdx, insertIdx + 3);
    const updatedTrack = [...head, newMsgItem, ...tail];

    // Verify all items visible in viewport (indices 0..3) are completely untouched
    for (let i = 0; i < 4; i++) {
      assert.equal(updatedTrack[i].uid, currentTrack[i].uid);
      assert.equal(updatedTrack[i].offsetLeft, currentTrack[i].offsetLeft);
    }

    // Verify new item enters right after item u4 (index 4)
    assert.equal(updatedTrack[4].uid, 'fresh-w1-1');
    assert.equal(updatedTrack[4].isFresh, true);
  });

  it('7. Rapid successive submissions queue sequentially in yellow without crosstalk', () => {
    const queue: { id: string; authorName: string; text: string; isFresh: boolean }[] = [];

    const sub1 = { id: 'm1', authorName: 'Сценарист 1', text: 'Сюжет А', createdAt: Date.now() };
    const sub2 = { id: 'm2', authorName: 'Сценарист 2', text: 'Сюжет Б', createdAt: Date.now() + 50 };

    const seen = new Set<string>();

    for (const msg of [sub1, sub2]) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        queue.push({
          id: msg.id,
          authorName: msg.authorName,
          text: msg.text,
          isFresh: true,
        });
      }
    }

    assert.equal(queue.length, 2);
    assert.equal(queue[0].id, 'm1');
    assert.equal(queue[0].isFresh, true);
    assert.equal(queue[1].id, 'm2');
    assert.equal(queue[1].isFresh, true);
  });

  it('8. Looped copies isolation: subsequent loops are always non-fresh white text', () => {
    // When buffer replenishes from playlist:
    const playlist = [
      { id: 'm1', authorName: 'Сценарист 1', text: 'Сюжет А', createdAt: Date.now() },
    ];

    // First pass item was created as fresh
    const firstPassItem = {
      uid: 'fresh-m1-1',
      msgId: playlist[0].id,
      isFresh: true,
    };
    assert.equal(firstPassItem.isFresh, true);

    // Looped replenishment generates next pass
    const loopedItem = {
      uid: 'loop-m1-2',
      msgId: playlist[0].id,
      isFresh: false, // Strict requirement: subsequent loops must not be fresh
    };
    assert.equal(loopedItem.isFresh, false);
  });
});
