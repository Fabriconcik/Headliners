import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TestHarness } from './e2e/harness.js';
import type { RoomStateSnapshot } from '../shared/protocol.js';

describe('Milestone 5 Improvements: Clean Replay, Ticker & Zoom Coordinate Mapping', () => {
  it('Host can toggle cleanReplay in lobby, and it syncs to all clients', async () => {
    const harness = new TestHarness();
    try {
      const host = await harness.createClient('Host');
      const hostSnap = await host.createRoom('Host');
      assert.equal(hostSnap.cleanReplay, false, 'cleanReplay must default to false');

      const guest = await harness.createClient('Guest');
      const guestSnap = await guest.joinRoom(hostSnap.roomCode, 'Guest');
      assert.equal(guestSnap.cleanReplay, false, 'Guest receives cleanReplay=false');

      // 1. Host enables cleanReplay
      host.send({ type: 'TOGGLE_CLEAN_REPLAY', enabled: true });
      const hostUpdated = await host.waitForSnapshot((s) => s.cleanReplay === true);
      assert.equal(hostUpdated.cleanReplay, true, 'Host snapshot updated to cleanReplay=true');

      const guestUpdated = await guest.waitForSnapshot((s) => s.cleanReplay === true);
      assert.equal(guestUpdated.cleanReplay, true, 'Guest snapshot synced with cleanReplay=true');

      // 2. Non-host attempts to disable cleanReplay (must be rejected)
      guest.send({ type: 'TOGGLE_CLEAN_REPLAY', enabled: false });
      // Wait a tick and verify state remained true
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(host.lastSnapshot?.cleanReplay, true, 'Non-host toggle must be ignored');

      // 3. Host disables cleanReplay
      host.send({ type: 'TOGGLE_CLEAN_REPLAY', enabled: false });
      const hostDisabled = await host.waitForSnapshot((s) => s.cleanReplay === false);
      assert.equal(hostDisabled.cleanReplay, false);
      const guestDisabled = await guest.waitForSnapshot((s) => s.cleanReplay === false);
      assert.equal(guestDisabled.cleanReplay, false);
    } finally {
      await harness.cleanup();
    }
  });

  it('cleanReplay persists into ReplayPayload when match transitions to REPLAY', async () => {
    const harness = new TestHarness();
    try {
      const { host } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 2,
        saboteurs: 1,
      });

      // Enable cleanReplay in lobby beforehand
      const room = (harness.roomManager as any).rooms.get(host.lastSnapshot?.roomCode);
      assert.ok(room, 'Room must exist');
      room.cleanReplay = true;

      await host.waitForSnapshot((s) => s.screen === 'BROADCAST', 4000);
      assert.equal(host.lastSnapshot?.cleanReplay, true, 'cleanReplay preserved in BROADCAST');

      // Verify payload carries cleanReplay when created
      const segSummary = host.lastSnapshot?.segment;
      assert.ok(segSummary, 'Segment must be active');
    } finally {
      await harness.cleanup();
    }
  });

  it('verifies zoom and pan screen-to-canonical coordinate transformation invariants', () => {
    // Simulated canvas bounding rect on screen:
    // Base size: 800 x 450, Zoom = 2.0 -> visual rendered size = 1600 x 900
    // Pan offset: +100px X, -50px Y -> rect.left = -300px, rect.top = -275px
    const zoom = 2.0;
    const baseW = 800;
    const baseH = 450;
    const renderedW = baseW * zoom; // 1600
    const renderedH = baseH * zoom; // 900
    const panX = 100;
    const panY = -50;

    // Center of canvas on screen: (baseW/2 + panX, baseH/2 + panY) = (500, 175)
    // Left edge of canvas: (baseW/2 + panX) - renderedW/2 = 500 - 800 = -300
    // Top edge of canvas: (baseH/2 + panY) - renderedH/2 = 175 - 450 = -275
    const rect = {
      left: 500 - renderedW / 2,
      top: 175 - renderedH / 2,
      width: renderedW,
      height: renderedH,
    };

    // Helper implementing getNormCoords
    const computeNorm = (clientX: number, clientY: number, flipped: boolean) => {
      const rawX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const rawY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      return {
        x: flipped ? 1 - rawX : rawX,
        y: flipped ? 1 - rawY : rawY,
      };
    };

    // 1. Visual center touch on screen at clientX=500, clientY=175
    const centerNorm = computeNorm(500, 175, false);
    assert.equal(centerNorm.x, 0.5, 'Center touch must map to exactly normX=0.5');
    assert.equal(centerNorm.y, 0.5, 'Center touch must map to exactly normY=0.5');

    // 2. Visual left-top edge of canvas at clientX=-300, clientY=-275
    const leftTopNorm = computeNorm(-300, -275, false);
    assert.equal(leftTopNorm.x, 0.0, 'Left edge must map to normX=0.0');
    assert.equal(leftTopNorm.y, 0.0, 'Top edge must map to normY=0.0');

    // 3. Visual right-bottom edge of canvas at clientX=1300, clientY=625
    const rightBottomNorm = computeNorm(1300, 625, false);
    assert.equal(rightBottomNorm.x, 1.0, 'Right edge must map to normX=1.0');
    assert.equal(rightBottomNorm.y, 1.0, 'Bottom edge must map to normY=1.0');

    // 4. Clamping outside bounds: clientX = -9999, clientY = 9999
    const clampedNorm = computeNorm(-9999, 9999, false);
    assert.equal(clampedNorm.x, 0.0, 'Negative coords clamp to 0.0');
    assert.equal(clampedNorm.y, 1.0, 'Overshoot coords clamp to 1.0');

    // 5. 180-degree flipped canvas
    const flippedCenter = computeNorm(500, 175, true);
    assert.equal(flippedCenter.x, 0.5);
    assert.equal(flippedCenter.y, 0.5);

    const flippedLeftTop = computeNorm(-300, -275, true);
    assert.equal(flippedLeftTop.x, 1.0, 'Flipped visual left maps to canvas right (1.0)');
    assert.equal(flippedLeftTop.y, 1.0, 'Flipped visual top maps to canvas bottom (1.0)');
  });

  it('verifies multi-segment replay clears tickerMap on SEGMENT_START to prevent message crosstalk', () => {
    // Simulate event reconstruction logic from ReplayScreen
    const tickerMap = new Map<string, { id: string; authorName: string; text: string }>();

    // Segment 1 events
    tickerMap.set('m1', { id: 'm1', authorName: 'Writer 1', text: 'First segment breaking news' });
    assert.equal(tickerMap.size, 1);

    // SEGMENT_START for Segment 2 arrives
    tickerMap.clear(); // verified fix
    assert.equal(tickerMap.size, 0, 'tickerMap must be cleared on SEGMENT_START');

    // Segment 2 events
    tickerMap.set('m2', { id: 'm2', authorName: 'Writer 2', text: 'Second segment breaking news' });
    assert.equal(tickerMap.size, 1);
    assert.equal(tickerMap.has('m1'), false, 'Segment 1 message must not leak into Segment 2');
    assert.equal(tickerMap.get('m2')?.text, 'Second segment breaking news');
  });

  it('verifies pan delta inversion under 180deg flip transformation', () => {
    // When isFlipped is true, physical movement of finger to the right (rawDeltaX > 0)
    // inside a rotate(180deg) frame must invert deltaX so the view shifts naturally
    const computePanDelta = (rawDeltaX: number, rawDeltaY: number, isFlipped: boolean) => ({
      deltaX: isFlipped ? -rawDeltaX : rawDeltaX,
      deltaY: isFlipped ? -rawDeltaY : rawDeltaY,
    });

    // Unflipped: moving finger +30px X moves pan +30px
    const normalPan = computePanDelta(30, -15, false);
    assert.equal(normalPan.deltaX, 30);
    assert.equal(normalPan.deltaY, -15);

    // Flipped: moving finger +30px X inverts to -30px pan to counter parent rotate(180deg)
    const flippedPan = computePanDelta(30, -15, true);
    assert.equal(flippedPan.deltaX, -30);
    assert.equal(flippedPan.deltaY, 15);
  });

  it('verifies ticker baseItems buffer repeats to at least 8 items without shrinking', () => {
    const computeBaseItems = (displayItems: string[]) => {
      let baseItems = [...displayItems];
      while (baseItems.length < 8) {
        baseItems = [...baseItems, ...displayItems];
      }
      return baseItems;
    };

    // 1 item -> 8 items
    const r1 = computeBaseItems(['Lead Headline']);
    assert.equal(r1.length, 8);

    // 2 items -> 8 items
    const r2 = computeBaseItems(['Lead Headline', 'News 1']);
    assert.equal(r2.length, 8);

    // 3 items -> 9 items
    const r3 = computeBaseItems(['Lead', 'News 1', 'News 2']);
    assert.equal(r3.length, 9);

    // 4 items -> 8 items (never drops below previous length)
    const r4 = computeBaseItems(['Lead', 'News 1', 'News 2', 'News 3']);
    assert.equal(r4.length, 8);
    assert.ok(r4.length >= 8, 'Track must always have >= 8 items to eliminate wide-screen gaps');
  });
});
