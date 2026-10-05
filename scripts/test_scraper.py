import unittest

from scraper import extract_rarity_and_name, resolve_card_series


class ScraperTitleTests(unittest.TestCase):
    def test_opcg_name_is_all_text_after_rarity(self):
        rarity, name = extract_rarity_and_name(
            'L マーシャル・Ｄ・ティーチ(パラレル)(English 2nd Anniversary set日本語版) 販売 | [OP01]〜[OP10] | ONE PIECEカードゲーム',
            'OPCG',
        )

        self.assertEqual(rarity, 'L')
        self.assertEqual(
            name,
            'マーシャル・Ｄ・ティーチ(パラレル)(English 2nd Anniversary set日本語版)',
        )

    def test_ptcg_keeps_existing_parenthetical_cleanup(self):
        rarity, name = extract_rarity_and_name(
            'AR ヒスイビリリダマ(illustration) 販売 | [S12a] ハイクラスパック | ポケモンカードゲーム',
            'PTCG',
        )

        self.assertEqual(rarity, 'AR')
        self.assertEqual(name, 'ヒスイビリリダマ')

    def test_opcg_promo_url_uses_promo_series(self):
        self.assertEqual(
            resolve_card_series('promo-op10', 'op01', 'OPCG'),
            'promo',
        )

    def test_non_promo_series_keeps_title_series(self):
        self.assertEqual(
            resolve_card_series('op10', 'op10', 'OPCG'),
            'op10',
        )


if __name__ == '__main__':
    unittest.main()
