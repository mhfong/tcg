const SINGLE_CARD_NAME_OVERRIDES: Record<string, string> = {
  '/sell/opc/card/op11/10156': 'モンキー・D・ルフィ(パラレル)(銀パラレル)',
  '/sell/opc/card/promo-op10/10190':
    'マーシャル・Ｄ・ティーチ(パラレル)(English 2nd Anniversary set日本語版)',
}

export function getSingleCardNameOverride(url: string): string | undefined {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '')
    return SINGLE_CARD_NAME_OVERRIDES[path]
  } catch {
    return undefined
  }
}