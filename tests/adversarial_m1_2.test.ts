import assert from 'node:assert/strict';
import {
  ABILITIES,
  SABOTEUR_ABILITIES,
  SABOTEUR_CLASSES,
  type AbilityId,
  type SaboteurAbilityId,
  type SaboteurClass,
} from '../shared/constants.js';
import { RoomManager } from '../server/roomManager.js';
import { TestHarness } from './e2e/harness.js';

console.log('================================================================');
console.log('--- STARTING ADVERSARIAL VERIFICATION SUITE (CHALLENGER 2) ---');
console.log('================================================================');

// =========================================================================
// SECTION 1: shared/constants.ts Verification
// =========================================================================
console.log('\n[Section 1] Verifying shared/constants.ts...');

// 1.1 Verify all 3 saboteur classes: vandal, hacker, director
const expectedClasses: SaboteurClass[] = ['vandal', 'hacker', 'director'];
assert.equal(
  Object.keys(SABOTEUR_CLASSES).length,
  3,
  `SABOTEUR_CLASSES must contain exactly 3 classes, found: ${Object.keys(SABOTEUR_CLASSES)}`,
);

const abilitySet = new Set<string>();

for (const cls of expectedClasses) {
  assert.ok(SABOTEUR_CLASSES[cls], `SABOTEUR_CLASSES must contain class '${cls}'`);
  const classDef = SABOTEUR_CLASSES[cls];
  assert.equal(classDef.id, cls, `Class '${cls}' id must match '${cls}'`);
  assert.equal(
    classDef.abilities.length,
    3,
    `Class '${cls}' must have exactly 3 abilities, found ${classDef.abilities.length}: ${JSON.stringify(classDef.abilities)}`,
  );
  assert.ok(classDef.name && classDef.name.length > 0, `Class '${cls}' must have non-empty name`);
  assert.ok(classDef.subtitle && classDef.subtitle.length > 0, `Class '${cls}' must have non-empty subtitle`);
  assert.ok(classDef.icon && classDef.icon.length > 0, `Class '${cls}' must have non-empty icon`);

  // Ensure all listed abilities exist in ABILITIES table and have matching saboteurClass
  for (const abId of classDef.abilities) {
    assert.ok(!abilitySet.has(abId), `Ability '${abId}' duplicated across classes!`);
    abilitySet.add(abId);

    const abConfig = ABILITIES[abId];
    assert.ok(abConfig, `Ability '${abId}' from class '${cls}' must exist in ABILITIES`);
    assert.equal(
      abConfig.saboteurClass,
      cls,
      `Ability '${abId}' saboteurClass must be '${cls}', got '${abConfig.saboteurClass}'`,
    );
  }
}
console.log('  ✔ All 3 saboteur classes exist, each has exactly 3 unique abilities, matching 9 total abilities.');

// 1.2 Inspect 'spotlight' ability specification
const spotlight = ABILITIES.spotlight;
assert.ok(spotlight, 'ABILITIES must contain "spotlight"');
assert.equal(spotlight.id, 'spotlight', 'spotlight.id must be "spotlight"');
assert.equal(spotlight.cost, 45, 'spotlight.cost must be 45');
assert.equal(spotlight.positional, true, 'spotlight.positional must be true');
assert.equal(spotlight.icon, '🔦', 'spotlight.icon must be "🔦"');
assert.equal(spotlight.saboteurClass, 'director', 'spotlight.saboteurClass must be "director"');
assert.equal(spotlight.name, 'Прожектор', 'spotlight.name must be "Прожектор"');
assert.ok(spotlight.shortDesc && spotlight.shortDesc.length > 0, 'spotlight must have a shortDesc');
console.log('  ✔ spotlight ability attributes verified (cost: 45, positional: true, icon: 🔦, saboteurClass: director, name: Прожектор).');

// 1.3 Verify compatibility aliases
assert.strictEqual(
  SABOTEUR_ABILITIES,
  ABILITIES,
  'SABOTEUR_ABILITIES must be an exact alias/reference to ABILITIES',
);
// Type check SaboteurAbilityId
const testAbilityId: SaboteurAbilityId = 'spotlight';
assert.equal(testAbilityId, 'spotlight');
console.log('  ✔ Compatibility aliases SaboteurAbilityId and SABOTEUR_ABILITIES confirmed.');

// =========================================================================
// SECTION 2: server/roomManager.ts handleUseAbility Simulation & Stress Testing
// =========================================================================
console.log('\n[Section 2] Verifying server/roomManager.ts handleUseAbility...');

class MockWebSocket {
  public sentMessages: any[] = [];
  public readyState = 1;
  public send(data: string) {
    this.sentMessages.push(JSON.parse(data));
  }
}

function createTestRoomSetup() {
  const rm = new RoomManager(9999) as any;
  const hostWs = new MockWebSocket();
  rm.createRoom(hostWs as any, 'HostUser');
  const room = Array.from(rm.rooms.values())[0] as any;
  assert.ok(room, 'Room must be created');

  // Add director saboteur
  const directorWs = new MockWebSocket();
  rm.joinRoom(directorWs as any, room.code, 'DirectorPlayer');
  const directorPlayer = room.players.find((p: any) => p.name === 'DirectorPlayer');
  assert.ok(directorPlayer, 'DirectorPlayer must join');
  directorPlayer.role = 'saboteur';
  directorPlayer.saboteurClass = 'director';
  directorPlayer.energy = 60;

  // Add vandal saboteur for cross-class testing
  const vandalWs = new MockWebSocket();
  rm.joinRoom(vandalWs as any, room.code, 'VandalPlayer');
  const vandalPlayer = room.players.find((p: any) => p.name === 'VandalPlayer');
  vandalPlayer.role = 'saboteur';
  vandalPlayer.saboteurClass = 'vandal';
  vandalPlayer.energy = 60;

  // Add artist player
  const artistWs = new MockWebSocket();
  rm.joinRoom(artistWs as any, room.code, 'ArtistPlayer');
  const artistPlayer = room.players.find((p: any) => p.name === 'ArtistPlayer');
  artistPlayer.role = 'artist';

  // Set room to BROADCAST and phase to LIVE
  room.screen = 'BROADCAST';
  const now = Date.now();
  room.segment = {
    index: 0,
    totalSegments: 3,
    leadWriterId: 'writer-1',
    leadWriterName: 'Writer 1',
    headline: 'TEST HEADLINE',
    phase: 'LIVE',
    phaseStartedAt: now,
    phaseEndsAt: now + 45000,
    liveStartedAt: now,
    splashStartedAt: now - 3000,
    events: [],
    pendingTickerHacks: 0,
  };

  return { rm, room, directorPlayer, directorWs, vandalPlayer, vandalWs, artistPlayer, artistWs, hostWs };
}

// 2.1 Test successful spotlight usage: energy deduction, visual placement, event logging, broadcast
{
  const { rm, room, directorPlayer, directorWs, hostWs } = createTestRoomSetup();
  directorPlayer.energy = 60;
  hostWs.sentMessages = [];
  directorWs.sentMessages = [];

  rm.handleUseAbility(room, directorPlayer, 'spotlight', 0.42, 0.77);

  // Energy deduction check
  assert.equal(directorPlayer.energy, 15, `Energy should be 60 - 45 = 15, got ${directorPlayer.energy}`);
  const energyMsg = directorWs.sentMessages.find((m: any) => m.type === 'ENERGY_UPDATE');
  assert.ok(energyMsg, 'Director must receive ENERGY_UPDATE message');
  assert.equal(energyMsg.energy, 15, 'ENERGY_UPDATE energy must be 15');

  // Visual item placement check
  assert.equal(room.sabotageItems.length, 1, 'room.sabotageItems should contain 1 item');
  const item = room.sabotageItems[0];
  assert.equal(item.type, 'spotlight', 'Item type must be "spotlight"');
  assert.equal(item.x, 0.42, 'Item x must match input coordinate 0.42');
  assert.equal(item.y, 0.77, 'Item y must match input coordinate 0.77');
  assert.ok(item.scale >= 1.25 && item.scale <= 1.60, `Spotlight scale must be in [1.25, 1.60], got ${item.scale}`);
  assert.equal(item.rotation, 0, `Spotlight rotation must be 0, got ${item.rotation}`);
  assert.equal(item.sticker, undefined, 'Spotlight sticker must be undefined');

  // Event logging check
  assert.equal(room.segment.events.length, 1, 'room.segment.events must record 1 event');
  const event = room.segment.events[0];
  assert.equal(event.type, 'SABOTAGE_VISUAL', 'Event type must be SABOTAGE_VISUAL');
  assert.deepEqual(event.item, item, 'Event item must match placed item');
  assert.ok(typeof event.t === 'number' && event.t >= 0, 'Event timestamp t must be non-negative');

  // Broadcast payload schema check
  const bcMsg = hostWs.sentMessages.find((m: any) => m.type === 'SABOTAGE_VISUAL_BC');
  assert.ok(bcMsg, 'Broadcast message SABOTAGE_VISUAL_BC must be sent to clients');
  assert.deepEqual(bcMsg.item, JSON.parse(JSON.stringify(item)), 'Broadcast message item must match serialized placed item');

  console.log('  ✔ handleUseAbility for spotlight: energy deduction (60 -> 15), visual item, event log, and broadcast verified.');
}

// 2.2 Test spotlight with omitted coordinates (random fallback within TV frame bounds)
{
  const { rm, room, directorPlayer } = createTestRoomSetup();
  directorPlayer.energy = 50;

  rm.handleUseAbility(room, directorPlayer, 'spotlight');

  assert.equal(room.sabotageItems.length, 1);
  const item = room.sabotageItems[0];
  assert.ok(item.x >= 0.18 && item.x <= 0.82, `Fallback x must be in range [0.18, 0.82], got ${item.x}`);
  assert.ok(item.y >= 0.20 && item.y <= 0.80, `Fallback y must be in range [0.20, 0.80], got ${item.y}`);
  console.log('  ✔ spotlight omitted coordinates produce bounded fallback (x in [0.18, 0.82], y in [0.20, 0.80]).');
}

// 2.3 Adversarial: Boundary energy check (exact cost 45 -> 0; 44 -> reject)
{
  const { rm, room, directorPlayer, hostWs } = createTestRoomSetup();

  // Test exact 45 energy
  directorPlayer.energy = 45;
  rm.handleUseAbility(room, directorPlayer, 'spotlight', 0.5, 0.5);
  assert.equal(directorPlayer.energy, 0, 'Director with exact 45 energy should decrement to 0');
  assert.equal(room.sabotageItems.length, 1, 'Ability should execute at exact 45 energy');

  // Test 44 energy (off by 1)
  directorPlayer.energy = 44;
  hostWs.sentMessages = [];
  rm.handleUseAbility(room, directorPlayer, 'spotlight', 0.5, 0.5);
  assert.equal(directorPlayer.energy, 44, 'Energy must not be deducted when energy is 44 (< 45)');
  assert.equal(room.sabotageItems.length, 1, 'No new item should be placed when energy is 44');
  console.log('  ✔ Boundary energy test passed: 45 allows cast (energy drops to 0); 44 rejects cast.');
}

// 2.4 Adversarial: Role and Class authorization check
{
  const { rm, room, vandalPlayer, artistPlayer, hostWs } = createTestRoomSetup();

  // Non-saboteur role (artist) attempts spotlight
  rm.handleUseAbility(room, artistPlayer, 'spotlight', 0.5, 0.5);
  assert.equal(room.sabotageItems.length, 0, 'Artist cannot cast saboteur ability');

  // Wrong saboteur class (vandal) attempts director's spotlight
  vandalPlayer.energy = 100;
  hostWs.sentMessages = [];
  rm.handleUseAbility(room, vandalPlayer, 'spotlight', 0.5, 0.5);
  assert.equal(vandalPlayer.energy, 100, 'Energy must not be deducted for wrong class');
  assert.equal(room.sabotageItems.length, 0, 'Item must not be placed for wrong class');
  assert.equal(hostWs.sentMessages.length, 0, 'No broadcast for wrong class');
  console.log('  ✔ Adversarial: Role authorization (artist rejected) and class authorization (vandal rejected) verified.');
}

// 2.5 Adversarial: Non-LIVE phase invocation
{
  const { rm, room, directorPlayer } = createTestRoomSetup();
  directorPlayer.energy = 100;

  const nonLivePhases: Array<'PREP' | 'SPLASH' | 'FREEZE'> = ['PREP', 'SPLASH', 'FREEZE'];
  for (const ph of nonLivePhases) {
    room.segment.phase = ph;
    rm.handleUseAbility(room, directorPlayer, 'spotlight', 0.5, 0.5);
    assert.equal(directorPlayer.energy, 100, `Energy must not be deducted in ${ph} phase`);
    assert.equal(room.sabotageItems.length, 0, `No item placed in ${ph} phase`);
  }
  console.log('  ✔ Adversarial: Ability cast blocked during PREP, SPLASH, and FREEZE phases.');
}

// 2.6 Adversarial: Out-of-bounds coordinates clamping
{
  const { rm, room, directorPlayer } = createTestRoomSetup();
  directorPlayer.energy = 100;

  rm.handleUseAbility(room, directorPlayer, 'spotlight', -999, 999);
  assert.equal(room.sabotageItems.length, 1);
  const clampedItem = room.sabotageItems[0];
  assert.equal(clampedItem.x, 0, `Negative coordinate -999 should clamp to 0, got ${clampedItem.x}`);
  assert.equal(clampedItem.y, 1, `Overflow coordinate 999 should clamp to 1, got ${clampedItem.y}`);

  directorPlayer.energy = 100;
  rm.handleUseAbility(room, directorPlayer, 'spotlight', NaN, Infinity);
  assert.equal(room.sabotageItems.length, 2);
  const nanItem = room.sabotageItems[1];
  assert.equal(nanItem.x, 0.5, `NaN coordinate should fallback to 0.5, got ${nanItem.x}`);
  assert.equal(nanItem.y, 0.5, `Infinity coordinate should fallback to 0.5 due to !Number.isFinite, got ${nanItem.y}`);
  console.log('  ✔ Adversarial: Extreme coordinates (-999, 999, NaN, Infinity) safely clamped.');
}

// =========================================================================
// SECTION 3: Sabotage Item Limit Clamping Stress Test (24 Items Max FIFO)
// =========================================================================
console.log('\n[Section 3] Stress-testing room sabotage items limit clamping (24 max FIFO)...');
{
  const { rm, room, directorPlayer } = createTestRoomSetup();

  // Cast 100 spotlight abilities in sequence
  for (let i = 1; i <= 100; i++) {
    directorPlayer.energy = 100; // Keep replenished
    rm.handleUseAbility(room, directorPlayer, 'spotlight', i / 100, i / 100);
    assert.ok(
      room.sabotageItems.length <= 24,
      `room.sabotageItems.length must never exceed 24, but reached ${room.sabotageItems.length} at iteration ${i}`,
    );
  }

  assert.equal(room.sabotageItems.length, 24, 'room.sabotageItems.length must be exactly 24 after 100 insertions');

  // Verify FIFO behavior: items 1..76 were dropped, remaining should be items 77..100
  const firstRemainingItem = room.sabotageItems[0];
  const lastRemainingItem = room.sabotageItems[23];
  assert.equal(firstRemainingItem.x, 77 / 100, `First remaining item should be item 77 (x=0.77), got ${firstRemainingItem.x}`);
  assert.equal(lastRemainingItem.x, 100 / 100, `Last remaining item should be item 100 (x=1.00), got ${lastRemainingItem.x}`);

  console.log('  ✔ Clamping stress test PASSED: strictly clamped to 24 items with FIFO eviction across 100 insertions.');
}

// =========================================================================
// SECTION 4: Bot AI Selection & Invocation Verification
// =========================================================================
console.log('\n[Section 4] Verifying Bot AI selection and invocation for spotlight...');
{
  const { rm, room } = createTestRoomSetup();

  // Create director bot
  const botPlayer = {
    id: 'bot-director-test',
    name: 'Режиссер-AI',
    isHost: false,
    isBot: true,
    connected: true,
    role: 'saboteur' as const,
    saboteurClass: 'director' as const,
    energy: 100,
    wipersCooldownUntil: 0,
    token: 'bot-token',
    ws: null,
    lastReactionAt: 0,
  };
  room.players.push(botPlayer);

  // Run 500 simulated bot ticks
  let spotlightTriggerCount = 0;
  let forcedBrushTriggerCount = 0;
  let censorTriggerCount = 0;

  for (let cycle = 0; cycle < 500; cycle++) {
    botPlayer.energy = 100; // Keep energy topped up
    room.lastBotActionAt[botPlayer.id] = 0; // Reset debounce timer
    const prevItemsCount = room.sabotageItems.length;
    const prevForcedBrushUntil = room.effects.forcedBrushUntil;

    rm.runBotTick(room);

    // Check if an ability was fired
    if (room.effects.forcedBrushUntil > prevForcedBrushUntil) {
      forcedBrushTriggerCount++;
    } else if (room.sabotageItems.length > prevItemsCount) {
      const latestItem = room.sabotageItems[room.sabotageItems.length - 1];
      if (latestItem.type === 'spotlight') {
        spotlightTriggerCount++;
      } else if (latestItem.type === 'censor') {
        censorTriggerCount++;
      }
    }
  }

  console.log(`  Bot AI casting distribution across 500 ticks:
    - spotlight: ${spotlightTriggerCount}
    - censor: ${censorTriggerCount}
    - forced_brush: ${forcedBrushTriggerCount}`);

  assert.ok(
    spotlightTriggerCount > 0,
    `Bot AI must be able to select and trigger spotlight! Found ${spotlightTriggerCount} triggers.`,
  );
  assert.ok(
    censorTriggerCount > 0,
    `Bot AI must be able to select and trigger censor! Found ${censorTriggerCount} triggers.`,
  );
  assert.ok(
    forcedBrushTriggerCount > 0,
    `Bot AI must be able to select and trigger forced_brush! Found ${forcedBrushTriggerCount} triggers.`,
  );

  // Test bot with insufficient energy (bot energy = 40): cannot cast spotlight (cost 45)
  let spotlightWhenEnergyLow = 0;
  for (let cycle = 0; cycle < 100; cycle++) {
    botPlayer.energy = 40;
    room.lastBotActionAt[botPlayer.id] = 0;
    const prevItemsCount = room.sabotageItems.length;

    rm.runBotTick(room);

    if (room.sabotageItems.length > prevItemsCount) {
      const latestItem = room.sabotageItems[room.sabotageItems.length - 1];
      if (latestItem.type === 'spotlight') {
        spotlightWhenEnergyLow++;
      }
    }
  }
  assert.equal(spotlightWhenEnergyLow, 0, 'Bot AI must never trigger spotlight when energy < 45');
  console.log('  ✔ Bot AI energy gate verified: bot triggers spotlight when energy >= 45, never when energy = 40.');
}

// =========================================================================
// SECTION 5: Real WebSocket End-to-End Network Test
// =========================================================================
console.log('\n[Section 5] Running Real WebSocket End-to-End Network Test for Spotlight...');
{
  const harness = new TestHarness({ mode: 'in-memory' });
  try {
    const { host, writers, saboteurs } = await harness.setupGameWithRoles({
      writers: 1,
      artists: 2,
      saboteurs: 1,
      saboteurClasses: ['director'],
      testMode: true,
    });

    const directorClient = saboteurs[0];

    // Wait for PREP phase
    await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

    // Writer submits headline to fast-advance to SPLASH
    writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'CHALLENGER SPOTLIGHT TEST' });
    await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');

    // Fast-forward or trigger transition to LIVE
    // In harness, we can trigger transition to LIVE by calling transitionToLive on room
    const rm = (harness as any).roomManager;
    const room = Array.from(rm.rooms.values())[0] as any;
    rm.transitionToLive(room);
    await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

    // Verify Director client has initial energy 60
    assert.equal(room.players.find((p: any) => p.id === directorClient.id).energy, 60);

    // Host drains past messages
    host.drainMessages();
    directorClient.drainMessages();

    // Director casts spotlight over WebSocket
    directorClient.send({
      type: 'USE_ABILITY',
      abilityId: 'spotlight',
      x: 0.35,
      y: 0.65,
    });

    // Verify Host receives SABOTAGE_VISUAL_BC over WebSocket
    const visualBc = await host.waitFor('SABOTAGE_VISUAL_BC');
    assert.equal(visualBc.type, 'SABOTAGE_VISUAL_BC');
    assert.equal(visualBc.item.type, 'spotlight');
    assert.equal(visualBc.item.x, 0.35);
    assert.equal(visualBc.item.y, 0.65);
    assert.equal(visualBc.item.rotation, 0);
    assert.ok(visualBc.item.scale >= 1.25 && visualBc.item.scale <= 1.60);

    // Verify Director receives ENERGY_UPDATE over WebSocket
    const energyUpdate = await directorClient.waitFor('ENERGY_UPDATE');
    assert.equal(energyUpdate.type, 'ENERGY_UPDATE');
    assert.equal(energyUpdate.energy, 15); // 60 - 45 = 15

    console.log('  ✔ WebSocket E2E verified: Director sent USE_ABILITY over socket, Host received SABOTAGE_VISUAL_BC, Director received ENERGY_UPDATE (15).');
  } finally {
    await harness.cleanup();
  }
}

console.log('\n================================================================');
console.log('--- ALL ADVERSARIAL VERIFICATIONS PASSED (CONFIRMED) ---');
console.log('================================================================');
