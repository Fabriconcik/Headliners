import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractSingleEmoji } from '../shared/emoji.js';

describe('extractSingleEmoji', () => {
  describe('Valid single emojis (Positive Equivalence Classes)', () => {
    it('accepts standard basic emojis (P1)', () => {
      const cases = ['😂', '😱', '🤦', '👏', '🚀', '🔥', '🎉', '🤡', '💩', '🍕', '✨'];
      for (const emoji of cases) {
        assert.equal(extractSingleEmoji(emoji), emoji, `Failed on basic emoji: ${emoji}`);
      }
    });

    it('trims leading and trailing whitespace around a single emoji (P2)', () => {
      assert.equal(extractSingleEmoji('  😂  '), '😂');
      assert.equal(extractSingleEmoji('\t🔥\n'), '🔥');
      assert.equal(extractSingleEmoji('\r\n👏\t'), '👏');
    });

    it('accepts emojis with variation selector 16 (U+FE0F) (P3)', () => {
      const cases = ['❤️', '♥️', '☠️', '⚡', '⭐', '☀️'];
      for (const emoji of cases) {
        assert.equal(extractSingleEmoji(emoji), emoji, `Failed on variation selector emoji: ${emoji}`);
      }
    });

    it('accepts emojis with Fitzpatrick skin tone modifiers (P4)', () => {
      const cases = ['👍🏽', '👋🏻', '👏🏿', '🙌🏼', '✌🏾'];
      for (const emoji of cases) {
        assert.equal(extractSingleEmoji(emoji), emoji, `Failed on skin tone emoji: ${emoji}`);
      }
    });

    it('accepts Zero-Width Joiner (ZWJ) sequences (P5)', () => {
      const cases = [
        '👨‍💻',
        '👩🏽‍🎨',
        '🤷‍♂️',
        '🧙‍♀️',
        '👨‍👩‍👧‍👦',
        '🏳️‍🌈',
        '🏳️‍⚧️',
        '🏴‍☠️',
        '🧑🏼‍❤️‍💋‍🧑🏿',
      ];
      for (const emoji of cases) {
        assert.equal(extractSingleEmoji(emoji), emoji, `Failed on ZWJ emoji: ${emoji}`);
      }
    });

    it('accepts regional indicator pairs / country flags (P6)', () => {
      const cases = ['🇺🇸', '🇷🇺', '🇯🇵', '🇪🇺', '🇬🇧'];
      for (const emoji of cases) {
        assert.equal(extractSingleEmoji(emoji), emoji, `Failed on flag emoji: ${emoji}`);
      }
    });

    it('accepts keycap sequences (P7)', () => {
      const cases = ['0️⃣', '1️⃣', '9️⃣', '#️⃣', '*️⃣', '1\u20E3'];
      for (const emoji of cases) {
        assert.equal(extractSingleEmoji(emoji), emoji, `Failed on keycap emoji: ${emoji}`);
      }
    });
  });

  describe('Invalid inputs (Negative Equivalence Classes / Rejection Criteria)', () => {
    it('rejects empty or whitespace-only strings (N1)', () => {
      assert.equal(extractSingleEmoji(''), null);
      assert.equal(extractSingleEmoji(' '), null);
      assert.equal(extractSingleEmoji('   '), null);
      assert.equal(extractSingleEmoji('\t\n\r'), null);
      assert.equal(extractSingleEmoji('\u3000'), null);
    });

    it('rejects plain text strings (N2)', () => {
      const cases = ['a', 'Z', 'hello', 'test', 'привет', 'мир', '你好', 'مرحبا'];
      for (const text of cases) {
        assert.equal(extractSingleEmoji(text), null, `Did not reject plain text: ${text}`);
      }
    });

    it('rejects plain numbers and symbols without keycap combiners (N3)', () => {
      const cases = ['0', '1', '9', '123', '42', '#', '*', '!', '?', '@', '$', '+'];
      for (const sym of cases) {
        assert.equal(extractSingleEmoji(sym), null, `Did not reject non-emoji symbol: ${sym}`);
      }
    });

    it('rejects mixed text and emoji (N4)', () => {
      const cases = [
        'hello 😂',
        '😂 hi',
        'a😂',
        '😂b',
        'hi 😂 bye',
        '😂!',
        '❤️?',
        '[😂]',
        '😂 123',
        'test 🚀 fire',
      ];
      for (const text of cases) {
        assert.equal(extractSingleEmoji(text), null, `Did not reject mixed text: ${text}`);
      }
    });

    it('rejects multiple emojis (N5)', () => {
      const cases = [
        '😂 😱',
        '😂😂',
        '😂😱',
        '🎉🎊🎈',
        '🇺🇸🇷🇺',
        '1️⃣2️⃣',
        '👨‍💻👩‍🎨',
        '🔥 🚀 👍',
      ];
      for (const multi of cases) {
        assert.equal(extractSingleEmoji(multi), null, `Did not reject multiple emojis: ${multi}`);
      }
    });

    it('rejects incomplete or isolated modifier sequences (N6)', () => {
      const cases = [
        '\u{1F3FD}', // standalone skin tone modifier
        '\u{1F1FA}', // single regional indicator
        '\u{1F1FA}\u{1F1F8}\u{1F1FA}', // three regional indicators
        '\uFE0F', // standalone variation selector
        '\u200D', // standalone ZWJ
        'a\u{1F3FD}', // letter + skin tone
        'a\u20E3', // letter + keycap
      ];
      for (const broken of cases) {
        assert.equal(extractSingleEmoji(broken), null, `Did not reject broken modifier: ${broken}`);
      }
    });

    it('rejects non-string inputs gracefully (N7)', () => {
      assert.equal(extractSingleEmoji(null as any), null);
      assert.equal(extractSingleEmoji(undefined as any), null);
      assert.equal(extractSingleEmoji(123 as any), null);
      assert.equal(extractSingleEmoji({} as any), null);
      assert.equal(extractSingleEmoji([] as any), null);
    });
  });
});
