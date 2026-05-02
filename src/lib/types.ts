export interface CardDefinition {
  id: string
  tcg_type: 'PTCG' | 'OPCG'
  series: string
  card_number: string
  name_jp: string
  name_en: string
  rarity: string
}

export interface WatchlistItem {
  id: string
  user_id: string
  card_id: string
  card?: CardDefinition
  created_at: string
}

export interface PriceRecord {
  id: string
  card_id: string
  condition: 'PSA10' | 'TAG10' | 'RAW_A'
  price: number
  buyers_count: number
  scraped_at: string
}

export interface Transaction {
  id: string
  user_id: string
  card_id: string
  card?: CardDefinition
  type: 'buy' | 'sell'
  condition: 'PSA10' | 'TAG10' | 'RAW_A'
  price: number
  quantity: number
  date: string
  notes: string
  created_at: string
}

export interface InventoryItem {
  card_id: string
  card?: CardDefinition
  condition: 'PSA10' | 'TAG10' | 'RAW_A'
  quantity: number
  avg_cost: number
  total_cost: number
  current_price: number | null
  price_change_pct: number | null
}

export const PTCG_SERIES = [
  's12a', 'sv1', 'sv1a', 'sv1s', 'sv2a', 'sv2D', 'sv2P',
  'sv3', 'sv3a', 'sv4', 'sv4a', 'sv4K', 'sv4M',
  'sv5a', 'sv5K', 'sv5M', 'sv6', 'sv6a', 'sv7', 'sv7a',
  'sv8', 'sv8a', 'sv9', 'sv9a',
  'm1', 'm1a', 'm2', 'm2a', 'm3', 'm3a', 'm4'
]

export const PTCG_RARITIES = ['AR', 'SR', 'UR', 'SAR', 'BWR', 'MUR']

export const OPCG_SERIES = [
  'op01', 'op02', 'op03', 'op04', 'op05', 'op06', 'op07', 'op08',
  'op09', 'op10', 'op11', 'op12', 'op13', 'op14', 'op15'
]

export const OPCG_RARITIES = ['P-L', 'SP', 'P-R', 'SR', 'P-SR', 'SEC', 'P-SEC', 'GOLD-DON']

export const CONDITIONS = ['PSA10', 'TAG10', 'RAW_A'] as const
