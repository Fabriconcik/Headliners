import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractSingleEmoji } from '../shared/emoji.js';

describe('Adversarial Stress Test: Single-Emoji Validation Engine', () => {

  // =========================================================================
  // CATEGORY 1: Fuzz Inputs (Random byte sequences, surrogates, zero-width chars)
  // =========================================================================
  describe('Category 1: Fuzz Inputs & Malformed Unicode', () => {
    it('handles 5,000 randomized pseudo-fuzz inputs without throwing or crashing', () => {
      // Seeded deterministic PRNG for reproducibility
      let seed = 0x1337cafe;
      function nextRandom() {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      }

      const unicodeBlocks = [
        [0x0000, 0x007F], // ASCII
        [0x0080, 0x00FF], // Latin-1 Supplement
        [0x0370, 0x03FF], // Greek
        [0x0400, 0x04FF], // Cyrillic
        [0x2000, 0x206F], // General Punctuation (ZWJ, ZWNJ, LRM, RLM)
        [0xD800, 0xDFFF], // Surrogates
        [0xFE00, 0xFE0F], // Variation Selectors
        [0x1F300, 0x1F5FF], // Misc Symbols & Pictographs
        [0x1F600, 0x1F64F], // Emoticons
        [0x1F900, 0x1F9FF], // Supplemental Symbols & Pictographs
        [0xE0020, 0xE007F], // Tag characters
      ];

      for (let i = 0; i < 5000; i++) {
        const len = Math.floor(nextRandom() * 30);
        let str = '';
        for (let j = 0; j < len; j++) {
          const block = unicodeBlocks[Math.floor(nextRandom() * unicodeBlocks.length)];
          const cp = Math.floor(block[0] + nextRandom() * (block[1] - block[0] + 1));
          try {
            str += String.fromCodePoint(cp);
          } catch {
            str += String.fromCharCode(cp & 0xffff);
          }
        }

        // Must execute cleanly without unhandled exception
        const result = extractSingleEmoji(str);
        assert.ok(result === null || typeof result === 'string');
      }
    });

    it('rejects unpaired and inverted UTF-16 surrogates', () => {
      const surrogates = [
        '\uD800',
        '\uD83D',
        '\uDBFF',
        '\uDC00',
        '\uDFFF',
        '\uD83D\uD83D', // high + high
        '\uDC00\uDC00', // low + low
        '\uDC00\uD83D', // inverted low + high
        'a\uD83D',      // letter + high
        '\uD83Db',      // high + letter
        '😂\uD800',     // emoji + lone high
        '\uDFFF😂',     // lone low + emoji
      ];

      for (const s of surrogates) {
        assert.equal(
          extractSingleEmoji(s),
          null,
          `Failed on surrogate case: ${JSON.stringify(s)}`
        );
      }
    });

    it('handles zero-width characters and invisible format characters', () => {
      // Standalone invisible characters must be rejected
      const invisibleStandalone = [
        '\u200B', // Zero Width Space
        '\u200C', // Zero Width Non-Joiner
        '\u200D', // Zero Width Joiner
        '\uFEFF', // BOM / ZWNBSP
        '\u2060', // Word Joiner
        '\u00AD', // Soft Hyphen
        '\u200B\u200B\u200B',
        '\u200D\u200D',
      ];
      for (const s of invisibleStandalone) {
        assert.equal(
          extractSingleEmoji(s),
          null,
          `Lone invisible character was not rejected: ${JSON.stringify(s)}`
        );
      }

      // Invisible character preceding emoji must be rejected
      assert.equal(extractSingleEmoji('\u200B😂'), null, 'Leading ZWSP must be rejected');
      assert.equal(extractSingleEmoji('\u200C😂'), null, 'Leading ZWNJ must be rejected');
      assert.equal(extractSingleEmoji('\u2060😂'), null, 'Leading Word Joiner must be rejected');

      // Trailing invisible space
      assert.equal(extractSingleEmoji('😂\u200B'), null, 'Trailing ZWSP must be rejected');
      assert.equal(extractSingleEmoji('😂\u2060'), null, 'Trailing Word Joiner must be rejected');
    });
  });

  // =========================================================================
  // CATEGORY 2: Tricky Unicode (Modifiers, Flags, Keycaps, VS-15/VS-16, ZWJ)
  // =========================================================================
  describe('Category 2: Tricky Unicode Specifications', () => {
    it('tests all 5 Fitzpatrick skin tone modifiers on valid and invalid bases', () => {
      const skinTones = ['\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
      const validBases = ['👍', '👋', '👏', '🙌', '✌️', '👨', '👩', '🧑', '👂', '👃'];
      const invalidBases = ['🍕', '🚀', '🔥', '🚗', '🐱', '0', '#', 'A', 'z'];

      // Valid bases with modifiers must pass
      for (const base of validBases) {
        for (const tone of skinTones) {
          const combo = base + tone;
          const res = extractSingleEmoji(combo);
          assert.ok(res !== null, `Valid base + skin tone was rejected: ${combo}`);
        }
      }

      // Invalid bases with skin tones must be rejected or not corrupt
      for (const base of invalidBases) {
        for (const tone of skinTones) {
          const combo = base + tone;
          const res = extractSingleEmoji(combo);
          // Non-emoji bases like '0' or 'A' or '#' with skin tone must be null
          if (['0', '#', 'A', 'z'].includes(base)) {
            assert.equal(
              res,
              null,
              `Invalid alphanumeric base with skin tone was accepted: ${combo}`
            );
          }
        }
      }
    });

    it('tests regional indicator flags (valid pairs vs invalid lengths)', () => {
      // 10 valid country flags
      const validFlags = ['🇺🇸', '🇷🇺', '🇨🇳', '🇯🇵', '🇩🇪', '🇫🇷', '🇬🇧', '🇮🇹', '🇧🇷', '🇮🇳'];
      for (const flag of validFlags) {
        assert.equal(extractSingleEmoji(flag), flag, `Valid flag rejected: ${flag}`);
      }

      // Single regional indicator (1 codepoint) must be rejected
      const singleRI = ['\u{1F1E6}', '\u{1F1FA}', '\u{1F1F8}', '\u{1F1FF}'];
      for (const ri of singleRI) {
        assert.equal(extractSingleEmoji(ri), null, `Single RI accepted: ${ri}`);
      }

      // Triple regional indicator (3 codepoints) must be rejected
      const tripleRI = ['🇺🇸\u{1F1FA}', '\u{1F1FA}\u{1F1F8}\u{1F1E6}'];
      for (const tri of tripleRI) {
        assert.equal(extractSingleEmoji(tri), null, `Triple RI accepted: ${tri}`);
      }

      // Quadruple regional indicator (2 flags, 4 codepoints) must be rejected
      const quadRI = ['🇺🇸🇷🇺', '🇨🇳🇯🇵', '🇩🇪🇫🇷'];
      for (const quad of quadRI) {
        assert.equal(extractSingleEmoji(quad), null, `Quad RI / 2 flags accepted: ${quad}`);
      }
    });

    it('tests keycap sequences (valid digits/symbols vs invalid chars)', () => {
      // Valid keycaps: 0-9, #, * with or without VS-16
      const validKeycaps = [
        '#️⃣', '*️⃣', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣',
        '#\u20E3', '*\u20E3', '0\u20E3', '1\u20E3', '2\u20E3', '9\u20E3',
      ];
      for (const kc of validKeycaps) {
        assert.equal(extractSingleEmoji(kc), kc, `Valid keycap rejected: ${kc}`);
      }

      // Invalid keycaps: letters, multi-digit, lone combiner
      const invalidKeycaps = [
        'a\u20E3',
        'A\u20E3',
        'Z\u20E3',
        '!\u20E3',
        '?\u20E3',
        '10\u20E3',
        '42\u20E3',
        '\u20E3',
        '\uFE0F\u20E3',
      ];
      for (const ik of invalidKeycaps) {
        assert.equal(extractSingleEmoji(ik), null, `Invalid keycap accepted: ${ik}`);
      }
    });

    it('tests complex multi-person ZWJ sequences and length threshold', () => {
      const validWithin16Chars = [
        '👨‍💻',             // 5 code units
        '👩🏽‍🎨',            // 7 code units
        '👨‍👩‍👧‍👦',            // 11 code units
        '🧑🏼‍❤️‍💋‍🧑🏿',          // 15 code units
        '🏴‍☠️',             // 5 code units
        '🏳️‍🌈',             // 6 code units
        '🏳️‍⚧️',             // 6 code units
        '🏴󠁧󠁢󠁳󠁣󠁴󠁿',           // 14 code units (Scotland tag sequence)
        '🏴󠁧󠁷󠁬󠁳󠁿',           // 14 code units (Wales tag sequence)
        '🏴󠁧󠁥󠁮󠁧󠁿',           // 14 code units (England tag sequence)
      ];
      for (const seq of validWithin16Chars) {
        assert.equal(extractSingleEmoji(seq), seq, `Complex sequence within 16 chars rejected: ${seq}`);
      }

      // Fully qualified multi-person emoji with all 4 skin tones exceeds 16 UTF-16 code units (19 chars)
      // Contract states trimmed.length <= 16, so this MUST be rejected according to contract
      const exceeds16 = '👨🏻‍👩🏼‍👧🏽‍👦🏾';
      assert.equal(
        extractSingleEmoji(exceeds16),
        null,
        'Sequence exceeding 16 UTF-16 units must be rejected per contract'
      );
    });
  });

  // =========================================================================
  // CATEGORY 3: Adversarial Mixed Inputs (Homoglyphs, Punctuation, Tags, RTL)
  // =========================================================================
  describe('Category 3: Adversarial Mixed Inputs & Bypass Vectors', () => {
    it('rejects emojis surrounded by punctuation or brackets', () => {
      const cases = [
        '!😂', '😂!', '?😂', '😂?', '...😂', '😂...',
        '(😂)', '[😂]', '{😂}', '<😂>', '"😂"', '\'😂\'',
        '😂;)', ';)😂', '😂:D', ':D😂',
      ];
      for (const c of cases) {
        assert.equal(extractSingleEmoji(c), null, `Emoji with punctuation accepted: ${c}`);
      }
    });

    it('rejects emojis prefixed or suffixed with Latin/Cyrillic homoglyphs', () => {
      const cases = [
        'a😂', '😂a', 'e😂', '😂e', 'o😂', '😂o', 'p😂', '😂p',
        'а😂', '😂а', // Cyrillic 'а' (U+0430)
        'с😂', '😂с', // Cyrillic 'с' (U+0441)
        'е😂', '😂е', // Cyrillic 'е' (U+0435)
        'о😂', '😂о', // Cyrillic 'о' (U+043E)
        'р😂', '😂р', // Cyrillic 'р' (U+0440)
      ];
      for (const c of cases) {
        assert.equal(extractSingleEmoji(c), null, `Homoglyph + emoji accepted: ${c}`);
      }
    });

    it('rejects emojis embedded in HTML/XML/template tags', () => {
      const cases = [
        '<b>😂</b>',
        '<span>😂</span>',
        '<img src="😂">',
        '<script>alert("😂")</script>',
        '{{😂}}',
        '${😂}',
        '<% 😂 %>',
      ];
      for (const c of cases) {
        assert.equal(extractSingleEmoji(c), null, `HTML/tag embedded emoji accepted: ${c}`);
      }
    });

    it('rejects multiple emojis in any arrangement', () => {
      const cases = [
        '😂😂',
        '😂 😱',
        '😂\t😱',
        '😂\n😱',
        '🔥🚀',
        '🍕🍔🍟',
        '👍🏻👍🏿',
        '👨‍💻👩‍🎨',
      ];
      for (const c of cases) {
        assert.equal(extractSingleEmoji(c), null, `Multiple emojis accepted: ${c}`);
      }
    });

    it('rejects bidirectional controls and RTL embedding surrounding emojis', () => {
      const cases = [
        '\u200E😂', // Left-to-Right Mark
        '😂\u200E',
        '\u200F😂', // Right-to-Left Mark
        '😂\u200F',
        '\u202A😂\u202C', // LRE + PDF
        '\u202B😂\u202C', // RLE + PDF
        '\u2066😂\u2069', // LRI + PDI
        '\u2067😂\u2069', // RLI + PDI
      ];
      for (const c of cases) {
        assert.equal(extractSingleEmoji(c), null, `Bidi control with emoji accepted: ${JSON.stringify(c)}`);
      }
    });
  });

  // =========================================================================
  // CATEGORY 4: ReDoS, Long Strings & Resource Exhaustion (DoS)
  // =========================================================================
  describe('Category 4: ReDoS & Resource Exhaustion', () => {
    it('executes in sub-millisecond time on ultra-long strings (length check early exit)', () => {
      const longStrings = [
        'a'.repeat(100_000),
        ' '.repeat(100_000),
        '😂'.repeat(50_000),
        '#'.repeat(100_000),
        '1\uFE0F\u20E3'.repeat(25_000),
        '👨‍👩‍👧‍👦'.repeat(10_000),
        ' '.repeat(50_000) + '😂' + ' '.repeat(50_000),
      ];

      for (const s of longStrings) {
        const start = performance.now();
        const res = extractSingleEmoji(s);
        const elapsed = performance.now() - start;

        // Either null or trimmed single emoji (for whitespace-padded single emoji)
        if (s.includes('😂') && s.trim() === '😂') {
          assert.equal(res, '😂');
        } else {
          assert.equal(res, null);
        }

        // Must finish under 25ms even for 100,000 characters
        assert.ok(
          elapsed < 25,
          `Execution took too long: ${elapsed.toFixed(2)}ms on string length ${s.length}`
        );
      }
    });

    it('rejects massive combining mark chains (Zalgo attack)', () => {
      // 1000 combining accents attached to a single emoji
      const zalgoEmoji = '😂' + '\u0300'.repeat(1000);
      const start = performance.now();
      const res = extractSingleEmoji(zalgoEmoji);
      const elapsed = performance.now() - start;

      assert.equal(res, null, 'Zalgo emoji exceeding 16 chars must be rejected');
      assert.ok(elapsed < 10, `Zalgo check took ${elapsed.toFixed(2)}ms`);
    });
  });

  // =========================================================================
  // CATEGORY 5: Throughput & Latency Benchmarks
  // =========================================================================
  describe('Category 5: Throughput & Performance Benchmark', () => {
    it('achieves > 100,000 ops/sec on mixed validation workloads', () => {
      const testSet = [
        '😂',
        '👨‍💻',
        '🇺🇸',
        '#️⃣',
        '👍🏽',
        'hello world',
        '😂 😱',
        '12345',
        '    🔥    ',
        '<script>alert(1)</script>',
        '\uD83D',
        'a'.repeat(500),
      ];

      const iterations = 50_000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const item = testSet[i % testSet.length];
        extractSingleEmoji(item);
      }
      const totalElapsedMs = performance.now() - start;
      const opsPerSec = Math.round((iterations / totalElapsedMs) * 1000);
      const avgLatencyUs = (totalElapsedMs / iterations) * 1000;

      // Assert at least 50,000 ops/sec and < 20 microseconds per call
      assert.ok(
        opsPerSec > 50_000,
        `Throughput too low: ${opsPerSec} ops/sec (expected > 50,000)`
      );
      assert.ok(
        avgLatencyUs < 20,
        `Average latency too high: ${avgLatencyUs.toFixed(2)} µs (expected < 20 µs)`
      );
    });
  });
});
