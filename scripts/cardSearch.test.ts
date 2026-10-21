import test from 'node:test'
import assert from 'node:assert/strict'
import {
  matchesDatabaseCardSearch,
  normalizeSeriesForSearch,
} from '../src/lib/cardSearch.ts'

test('normalizes zero-padded series numbers for search', () => {
  assert.equal(normalizeSeriesForSearch('sv5k'), 'sv5k')
  assert.equal(normalizeSeriesForSearch('sv05k'), 'sv5k')
  assert.equal(normalizeSeriesForSearch('SV005K'), 'sv5k')
})

test('requires each search term to match some card field', () => {
  const card = {
    card_series: 'm1l',
    card_index: '001/086',
    card_name: 'Pikachu',
    card_rarity: 'AR',
  }

  assert.equal(matchesDatabaseCardSearch(card, 'm1l ar'), true)
  assert.equal(matchesDatabaseCardSearch(card, 'm1l sr'), false)
})

test('combines AND terms with zero-padded series matching', () => {
  const card = {
    card_series: 'sv05k',
    card_index: '001/086',
    card_name: 'Pikachu',
    card_rarity: 'AR',
  }

  assert.equal(matchesDatabaseCardSearch(card, 'sv5k ar'), true)
})