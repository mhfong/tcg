import test from 'node:test'
import assert from 'node:assert/strict'
import { compareCardsByColumn } from '../src/lib/cardSorting.ts'

const card = (id: string, tcg_type: 'PTCG' | 'OPCG', card_series: string) => ({
  id,
  tcg_type,
  card_series,
  card_index: '1',
  card_name: id,
  card_rarity: 'SR',
})

test('sorts PTCG before OPCG in ascending TCG order', () => {
  assert.ok(
    compareCardsByColumn(
      card('ptcg-card', 'PTCG', 'sv1'),
      card('opcg-card', 'OPCG', 'op01'),
      'asc',
      null,
      null,
      null,
    ) < 0,
  )
})

test('sorts OPCG before PTCG in descending TCG order', () => {
  assert.ok(
    compareCardsByColumn(
      card('ptcg-card', 'PTCG', 'sv1'),
      card('opcg-card', 'OPCG', 'op01'),
      'desc',
      null,
      null,
      null,
    ) > 0,
  )
})

test('uses series as a tie-breaker within the same TCG', () => {
  assert.ok(
    compareCardsByColumn(
      card('opcg-op01', 'OPCG', 'op01'),
      card('opcg-op02', 'OPCG', 'op02'),
      'asc',
      'asc',
      null,
      null,
    ) < 0,
  )
})
