export function normalizeSeriesForSearch(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\d+/g, digits => digits.replace(/^0+(?=\d)/, ''))
}

interface SearchableCard {
  card_series?: string | null
  card_index?: string | null
  card_name?: string | null
  card_rarity?: string | null
}

export function matchesDatabaseCardSearch(
  card: SearchableCard,
  query: string,
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true

  const series = (card.card_series ?? '').toLowerCase()
  const normalizedSeries = normalizeSeriesForSearch(series)
  const otherFields = [card.card_index, card.card_name, card.card_rarity].map(
    value => (value ?? '').toLowerCase(),
  )

  return terms.every(term => {
    const normalizedSeriesTerm = normalizeSeriesForSearch(term)
    return (
      series.includes(term) ||
      normalizedSeries.includes(normalizedSeriesTerm) ||
      otherFields.some(field => field.includes(term))
    )
  })
}