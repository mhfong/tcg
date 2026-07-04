/**
 * Deterministic card ID generation.
 *
 * Scheme:
 *   PTCG: 'ptcg' + series + digits(card_number) + lowercase(rarity) + yuyutei_slug
 *   OPCG: 'opcg' + digits(card_number) + letters-only-lowercase(rarity) + yuyutei_slug
 *   OPCG GOLD-DON: 'opcg' + series + 'golddon' + yuyutei_slug
 *     (uses card_series instead of card_index because GOLD-DON cards share
 *      the synthetic card_index "GOLD-DON" across all sets)
 *
 * Examples:
 *   PTCG: series=s12a, card_number="259/172", rarity="UR", slug="10348"
 *     -> "ptcgs12a259172ur10348"
 *   OPCG: card_number="OP15-119", rarity="P-SEC", slug="10146"
 *     -> "opcg15psec10146"
 *   OPCG GOLD-DON: series="op16", slug="10150"
 *     -> "opcgop16golddon10150"
 *
 * The yuyutei slug is the last segment of the yuyu-tei.jp product URL,
 * e.g. "https://yuyu-tei.jp/sell/poc/card/s12a/10348" -> "10348".
 *
 * This ID is unique because the yuyu-tei slug is unique per product.
 */

const DIGITS_ONLY = /\D/g
const NON_LETTERS = /[^a-z]/g

export function digitsOnly(s: string): string {
  return (s ?? '').replace(DIGITS_ONLY, '')
}

export function lettersOnlyLower(s: string): string {
  return (s ?? '').toLowerCase().replace(NON_LETTERS, '')
}

/**
 * Normalize the OPCG card_index so its letters + digits survive but all
 * non-alphanumeric characters (dashes, slashes, `!`, etc.) are removed
 * and the result is lowercased.
 *   "OP15-119" -> "op15119"
 *   "OP01-120" -> "op01120"
 *   "DON!!"    -> "don"
 */
export function opcgIndexSlug(s: string): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Extract the last non-empty path segment from a URL (yuyu-tei slug). */
export function yuyuteiSlugFromUrl(url: string): string {
  if (!url) return ''
  try {
    const parts = url.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? ''
  } catch {
    return ''
  }
}

export interface CardIdInputs {
  tcg_type: 'PTCG' | 'OPCG'
  card_series: string
  card_index: string
  card_rarity: string
  url_yuyutei: string
}

export function makeCardId(input: CardIdInputs): string {
  const slug = yuyuteiSlugFromUrl(input.url_yuyutei)
  if (input.tcg_type === 'PTCG') {
    return (
      'ptcg' +
      (input.card_series ?? '').toLowerCase() +
      digitsOnly(input.card_index) +
      (input.card_rarity ?? '').toLowerCase() +
      slug
    )
  }
  // OPCG GOLD-DON: all GOLD-DON cards share card_index "GOLD-DON", so we
  // use card_series to disambiguate (e.g. op14 vs op15 vs op16).
  if ((input.card_rarity ?? '').toUpperCase() === 'GOLD-DON') {
    return (
      'opcg' +
      (input.card_series ?? '').toLowerCase() +
      'golddon' +
      slug
    )
  }
  // OPCG: keep letters and digits from the card_index, lowercase, no dashes
  return (
    'opcg' +
    opcgIndexSlug(input.card_index) +
    lettersOnlyLower(input.card_rarity) +
    slug
  )
}
