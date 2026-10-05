import test from 'node:test'
import assert from 'node:assert/strict'
import { getSingleCardNameOverride } from '../src/lib/yuyuteiCardNames.ts'

test('uses the silver parallel name for the OP11 product URL', () => {
  assert.equal(
    getSingleCardNameOverride('https://yuyu-tei.jp/sell/opc/card/op11/10156'),
    'モンキー・D・ルフィ(パラレル)(銀パラレル)',
  )
})

test('does not override unrelated product URLs', () => {
  assert.equal(
    getSingleCardNameOverride('https://yuyu-tei.jp/sell/opc/card/op11/10155'),
    undefined,
  )
})