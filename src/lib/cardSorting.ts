import type { CardDefinition } from './types'

export type SortDirection = 'asc' | 'desc'
export type SortState = SortDirection | null

const cardSortCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

function compareTcgTypes(a: CardDefinition['tcg_type'], b: CardDefinition['tcg_type']): number {
  if (a === b) return 0
  return a === 'PTCG' ? -1 : 1
}

export function compareCardsByColumn(
  a: CardDefinition,
  b: CardDefinition,
  tcgDirection: SortState,
  seriesDirection: SortState,
  cardIndexDirection: SortState,
  rarityDirection: SortState,
): number {
  const tcgOrder = compareTcgTypes(a.tcg_type, b.tcg_type)
  if (tcgDirection && tcgOrder !== 0) {
    return tcgDirection === 'asc' ? tcgOrder : -tcgOrder
  }

  const seriesOrder = cardSortCollator.compare(a.card_series, b.card_series)
  if (seriesDirection && seriesOrder !== 0) {
    return seriesDirection === 'asc' ? seriesOrder : -seriesOrder
  }

  const cardIndexOrder = cardSortCollator.compare(a.card_index, b.card_index)
  if (cardIndexDirection && cardIndexOrder !== 0) {
    return cardIndexDirection === 'asc' ? cardIndexOrder : -cardIndexOrder
  }

  const rarityOrder = cardSortCollator.compare(a.card_rarity, b.card_rarity)
  if (rarityDirection && rarityOrder !== 0) {
    return rarityDirection === 'asc' ? rarityOrder : -rarityOrder
  }

  return 0
}