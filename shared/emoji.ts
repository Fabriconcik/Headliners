const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const EMOJI_TEST_REGEX = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/u;

/**
 * Extracts and validates a single emoji grapheme from user input.
 * Returns the single emoji string if the trimmed input contains strictly
 * 1 valid emoji grapheme cluster matching Unicode emoji specifications.
 * Returns null if the input is empty, plain text, mixed text with emoji,
 * contains multiple emojis, or is non-string.
 */
export function extractSingleEmoji(raw: string): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 16) return null;

  const graphemes: string[] = segmenter
    ? Array.from(segmenter.segment(trimmed), (s) => s.segment)
    : Array.from(trimmed);

  if (graphemes.length !== 1) {
    return null;
  }

  const g = graphemes[0];
  if (EMOJI_TEST_REGEX.test(g) && g.length <= 16) {
    return g;
  }

  return null;
}
