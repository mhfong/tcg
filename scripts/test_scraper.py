import unittest

from scraper import extract_rarity_and_name


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


if __name__ == '__main__':
    unittest.main()
