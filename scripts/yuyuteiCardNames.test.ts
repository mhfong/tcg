import test from 'node:test'
import assert from 'node:assert/strict'
import { getSingleCardNameOverride } from '../src/lib/yuyuteiCardNames.ts'

test('uses the silver parallel name for the OP11 product URL', () => {
  assert.equal(
    getSingleCardNameOverride('https://yuyu-tei.jp/sell/opc/card/op11/10156'),
    'モンキー・D・ルフィ(パラレル)(銀パラレル)',
  )
})

test('uses the English second anniversary name for the promo OP10 product URL', () => {
  assert.equal(
    getSingleCardNameOverride('https://yuyu-tei.jp/sell/opc/card/promo-op10/10190'),
    'マーシャル・Ｄ・ティーチ(パラレル)(English 2nd Anniversary set日本語版)',
  )
})

test('does not override unrelated product URLs', () => {
  assert.equal(
    getSingleCardNameOverride('https://yuyu-tei.jp/sell/opc/card/op11/10155'),
    undefined,
  )
})