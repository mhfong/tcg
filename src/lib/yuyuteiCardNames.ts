const SINGLE_CARD_NAME_OVERRIDES: Record<string, string> = {
  '/sell/opc/card/op11/10156': 'モンキー・D・ルフィ(パラレル)(銀パラレル)',
}

export function getSingleCardNameOverride(url: string): string | undefined {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '')
    return SINGLE_CARD_NAME_OVERRIDES[path]
  } catch {
    return undefined
  }
}