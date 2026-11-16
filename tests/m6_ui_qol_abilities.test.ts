import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './e2e/harness.js';
import {
  ABILITIES,
  TIMINGS,
} from '../shared/constants.js';
import { buildReplayPayload, type RecordedSegment } from '../server/replayAnalyzer.js';

async function flushAsync(count = 5): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

describe('Milestone 6: UI, QoL & New Role Abilities Suite', () => {
  describe('1. Artist Shield Ability (Защитный экран)', () => {
    it('activates shield, broadcasts SHIELD_BC, and enforces 12s cooldown', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

      try {
        const { host, artists, writers, saboteurs, roomCode } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          testMode: true,
        });

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        // Transition from ROLE_SELECT to PREP, then to LIVE
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'SHIELD TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const artist = artists[0];
        const artistPlayer = getRoom().players.find((p) => p.id === artist.id)!;
        assert.equal(artistPlayer.shieldCooldownUntil ?? 0, 0);

        // 1. Artist activates shield
        artist.send({ type: 'USE_SHIELD' });
        const shieldBc = await host.waitFor('SHIELD_BC');
        assert.equal(shieldBc.actorId, artist.id);
        assert.ok(shieldBc.shieldUntil > Date.now());
        assert.ok(shieldBc.cooldownUntil > Date.now());

        assert.equal(getRoom().effects.shieldUntil, shieldBc.shieldUntil);
        assert.equal(artistPlayer.shieldCooldownUntil, shieldBc.cooldownUntil);

        // Verify replay event logged
        const shieldEv = getRoom().segment!.events.find((e) => e.type === 'SHIELD');
        assert.ok(shieldEv, 'SHIELD event must be recorded in segment events');

        // 2. Reject premature reactivation during 12s cooldown
        artist.send({ type: 'USE_SHIELD' });
        await flushAsync();
        assert.equal(artistPlayer.shieldCooldownUntil, shieldBc.cooldownUntil, 'Cooldown must not be overwritten');

        // 3. Reject non-artist attempting to use shield
        writers[0].send({ type: 'USE_SHIELD' });
        saboteurs[0].send({ type: 'USE_SHIELD' });
        await flushAsync();
        // Cooldown remains artist's
        assert.equal(getRoom().players.find((p) => p.id === writers[0].id)!.shieldCooldownUntil ?? 0, 0);
        assert.equal(getRoom().players.find((p) => p.id === saboteurs[0].id)!.shieldCooldownUntil ?? 0, 0);
      } finally {
        await harness.cleanup();
      }
    });

    it('deflects saboteur visual attacks while shield is active', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

      try {
        const { host, artists, writers, saboteurs, roomCode } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          testMode: true,
        });

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        // Transition from ROLE_SELECT to PREP, then to LIVE
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'DEFLECTION TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const artist = artists[0];
        const saboteur = saboteurs[0];

        // 1. Artist activates shield
        artist.send({ type: 'USE_SHIELD' });
        await host.waitFor('SHIELD_BC');
        assert.ok(getRoom().effects.shieldUntil! > Date.now());

        // 2. Saboteur attempts visual sabotage (tomato) while shielded
        saboteur.send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        await flushAsync();

        // Sabotage MUST NOT land in sabotageItems (deflected by shield!)
        assert.equal(getRoom().sabotageItems.length, 0, 'Sabotage item must be blocked during active shield');

        // 3. Fast-forward past shield duration (4,000ms)
        t.mock.timers.tick(TIMINGS.SHIELD_DURATION_MS + 100);
        assert.ok(Date.now() > getRoom().effects.shieldUntil!);

        // 4. Saboteur uses another visual ability (censor or tomato) after shield expired
        // Saboteur vandal uses tomato
        saboteur.send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        await host.waitFor('SABOTAGE_VISUAL_BC');

        // Now it lands successfully!
        assert.equal(getRoom().sabotageItems.length, 1, 'Sabotage item must land after shield expires');
      } finally {
        await harness.cleanup();
      }
    });
  });

  describe('2. Writer Breaking News Flash (Молния в кадр)', () => {
    it('activates breaking news flash, broadcasts BREAKING_NEWS_BC, and enforces 12s cooldown', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

      try {
        const { host, artists, writers, saboteurs, roomCode } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          testMode: true,
        });

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        // Transition from ROLE_SELECT to PREP, then to LIVE
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'BREAKING NEWS TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const writer = writers[0];
        const writerPlayer = getRoom().players.find((p) => p.id === writer.id)!;
        assert.equal(writerPlayer.breakingNewsCooldownUntil ?? 0, 0);

        // 1. Writer triggers Breaking News
        writer.send({ type: 'USE_BREAKING_NEWS' });
        const bnBc = await host.waitFor('BREAKING_NEWS_BC');
        assert.equal(bnBc.actorId, writer.id);
        assert.equal(bnBc.authorName, writerPlayer.name);
        assert.ok(bnBc.until > Date.now());
        assert.ok(bnBc.cooldownUntil > Date.now());

        assert.equal(getRoom().effects.breakingNewsUntil, bnBc.until);
        assert.equal(getRoom().effects.breakingNewsAuthor, writerPlayer.name);

        // Replay event logged
        const bnEv = getRoom().segment!.events.find((e) => e.type === 'BREAKING_NEWS');
        assert.ok(bnEv, 'BREAKING_NEWS event must be logged');

        // 2. Cooldown rejection
        writer.send({ type: 'USE_BREAKING_NEWS' });
        await flushAsync();
        assert.equal(writerPlayer.breakingNewsCooldownUntil, bnBc.cooldownUntil);

        // 3. Non-writers rejected
        artists[0].send({ type: 'USE_BREAKING_NEWS' });
        saboteurs[0].send({ type: 'USE_BREAKING_NEWS' });
        await flushAsync();
        assert.equal(getRoom().players.find((p) => p.id === artists[0].id)!.breakingNewsCooldownUntil ?? 0, 0);
      } finally {
        await harness.cleanup();
      }
    });
  });

  describe('3. Writer Anti-Hack / Clean Ticker (Редактор / Анти-хак)', () => {
    it('instantly clears hacked scrambled text on ticker messages', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

      try {
        const { host, writers, saboteurs, roomCode } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          saboteurClasses: ['hacker'],
          testMode: true,
        });

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        // Transition from ROLE_SELECT to PREP, then to LIVE
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ANTI-HACK TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // 1. Writer adds a ticker message
        writers[0].send({ type: 'ADD_TICKER', text: 'Сенсационное заявление мэра' });
        await host.waitFor('TICKER_ADD_BC');
        assert.equal(getRoom().ticker.length, 1);
        const originalText = getRoom().ticker[0].text;

        // 2. Hacker hacks the ticker message
        const sab = saboteurs[0];
        sab.send({ type: 'USE_ABILITY', abilityId: 'ticker_hack' });
        await flushAsync();
        // Advance timer for delayed ticker hack (HACKER_TICKER_DELAY_MS)
        t.mock.timers.tick(TIMINGS.HACKER_TICKER_DELAY_MS + 500);
        await host.waitFor('TICKER_HACK_BC');

        // Message is now hacked
        assert.ok(getRoom().ticker[0].hackedText, 'Ticker message must have hackedText');
        assert.notEqual(getRoom().ticker[0].hackedText, originalText);

        // 3. Writer clicks Anti-Hack
        writers[0].send({ type: 'CLEAN_TICKER' });
        const cleanBc = await host.waitFor('TICKER_CLEAN_BC');
        assert.equal(cleanBc.actorId, writers[0].id);

        // Message hackedText is now completely removed!
        assert.equal(getRoom().ticker[0].hackedText, undefined);
        assert.equal(getRoom().ticker[0].text, originalText);

        // Replay event logged
        const cleanEv = getRoom().segment!.events.find((e) => e.type === 'TICKER_CLEAN');
        assert.ok(cleanEv, 'TICKER_CLEAN event must be logged');
      } finally {
        await harness.cleanup();
      }
    });
  });

  describe('4. Replay Analyzer Scoring of New Events', () => {
    it('scores SHIELD, BREAKING_NEWS, and TICKER_CLEAN as high-impact events', () => {
      const mockSegment: RecordedSegment = {
        index: 0,
        headline: 'REPLAY SCORE TEST',
        writerName: 'Автор',
        leadWriterId: 'w1',
        startedAt: 1000,
        endedAt: 52000,
        events: [
          { t: 0, type: 'SEGMENT_START', segmentIndex: 0, headline: 'TEST', writerName: 'Автор' },
          { t: 0, type: 'PHASE', phase: 'SPLASH' },
          { t: 3000, type: 'PHASE', phase: 'LIVE' },
          // Cluster of new events at t = 20,000ms
          { t: 20000, type: 'SHIELD' },
          { t: 21000, type: 'BREAKING_NEWS', authorName: 'Автор' },
          { t: 22000, type: 'TICKER_CLEAN' },
          { t: 48000, type: 'PHASE', phase: 'FREEZE' },
        ],
      };

      const payload = buildReplayPayload([mockSegment], 100000);
      assert.ok(payload.speedRanges.length > 0);

      // Verify that the cluster around 20,000-22,000ms is detected as a peak moment (speed = 1.0)
      const peakRange = payload.speedRanges.find((r) => r.isPeak && r.startMs <= 22000 && r.endMs >= 20000);
      assert.ok(peakRange, 'Peak detection must identify the cluster containing SHIELD and BREAKING_NEWS as a peak window');
      assert.equal(peakRange.speed, 1.0);
    });
  });

  describe('5. Edge Cases & Phase Locking', () => {
    it('strictly locks USE_SHIELD, USE_BREAKING_NEWS, and CLEAN_TICKER outside LIVE phase', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

      try {
        const { host, writers, artists, saboteurs, roomCode } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          testMode: true,
        });

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        // 1. In PREP phase
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        artists[0].send({ type: 'USE_SHIELD' });
        writers[0].send({ type: 'USE_BREAKING_NEWS' });
        writers[0].send({ type: 'CLEAN_TICKER' });
        await flushAsync();

        assert.equal(getRoom().effects.shieldUntil ?? 0, 0, 'No shield in PREP');
        assert.equal(getRoom().effects.breakingNewsUntil ?? 0, 0, 'No breaking news in PREP');

        // 2. In SPLASH phase
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TEST ACTIONS' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');

        artists[0].send({ type: 'USE_SHIELD' });
        writers[0].send({ type: 'USE_BREAKING_NEWS' });
        writers[0].send({ type: 'CLEAN_TICKER' });
        await flushAsync();

        assert.equal(getRoom().effects.shieldUntil ?? 0, 0, 'No shield in SPLASH');
        assert.equal(getRoom().effects.breakingNewsUntil ?? 0, 0, 'No breaking news in SPLASH');

        // 3. In FREEZE phase
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');

        artists[0].send({ type: 'USE_SHIELD' });
        writers[0].send({ type: 'USE_BREAKING_NEWS' });
        writers[0].send({ type: 'CLEAN_TICKER' });
        await flushAsync();

        assert.equal(getRoom().effects.shieldUntil ?? 0, 0, 'No shield in FREEZE');
        assert.equal(getRoom().effects.breakingNewsUntil ?? 0, 0, 'No breaking news in FREEZE');
      } finally {
        await harness.cleanup();
      }
    });

    it('CLEAN_TICKER is a no-op when no messages are hacked', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

      try {
        const { host, writers, roomCode } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          testMode: true,
        });

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'CLEAN NO-OP' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Ticker has no messages
        writers[0].send({ type: 'CLEAN_TICKER' });
        await flushAsync();

        // No event logged
        const cleanEv = getRoom().segment!.events.find((e) => e.type === 'TICKER_CLEAN');
        assert.equal(cleanEv, undefined, 'No TICKER_CLEAN event should be logged if no message was hacked');
      } finally {
        await harness.cleanup();
      }
    });
  });

  describe('6. Expanded Saboteur Toolkit Abilities', () => {
    it('executes ink_splat (vandal), static_noise (hacker), and camera_shake (director)', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

      try {
        const { host, writers, saboteurs, roomCode } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 3,
          saboteurClasses: ['vandal', 'hacker', 'director'],
          testMode: true,
        });

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'EXPANDED ABILITIES TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const [vandal, hacker, director] = saboteurs;

        // 1. Vandal casts ink_splat
        vandal.send({ type: 'USE_ABILITY', abilityId: 'ink_splat', x: 0.4, y: 0.6 });
        const visualBc = await host.waitFor('SABOTAGE_VISUAL_BC');
        assert.equal(visualBc.item.type, 'ink_splat');
        assert.equal(getRoom().sabotageItems.length, 1);
        assert.equal(getRoom().sabotageItems[0].type, 'ink_splat');

        // 2. Hacker casts static_noise
        hacker.send({ type: 'USE_ABILITY', abilityId: 'static_noise' });
        const staticBc = await host.waitFor('SABOTAGE_FX_BC');
        assert.equal(staticBc.fx, 'static');
        assert.ok(getRoom().effects.staticNoiseUntil > Date.now());

        // 3. Director casts camera_shake
        director.send({ type: 'USE_ABILITY', abilityId: 'camera_shake' });
        const shakeBc = await host.waitFor('SABOTAGE_FX_BC');
        assert.equal(shakeBc.fx, 'shake');
        assert.ok(getRoom().effects.shakeUntil > Date.now());
      } finally {
        await harness.cleanup();
      }
    });

    it('deflects ink_splat when Artist shield is active', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

      try {
        const { host, writers, artists, saboteurs, roomCode } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          saboteurClasses: ['vandal'],
          testMode: true,
        });

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'DEFLECT INK' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Artist activates shield
        artists[0].send({ type: 'USE_SHIELD' });
        await host.waitFor('SHIELD_BC');

        // Vandal tries ink_splat
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'ink_splat', x: 0.5, y: 0.5 });
        await flushAsync();

        // Must not land in sabotage items!
        assert.equal(getRoom().sabotageItems.length, 0, 'ink_splat must be blocked during shield');
      } finally {
        await harness.cleanup();
      }
    });
  });
});
