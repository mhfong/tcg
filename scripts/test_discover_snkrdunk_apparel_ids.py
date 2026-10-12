import unittest

from discover_snkrdunk_apparel_ids import score_title


class DiscoverSnkrdunkScoringTests(unittest.TestCase):
    def test_yuyutei_super_parallel_names_require_komipara_titles(self):
        card = {
            'tcg_type': 'OPCG',
            'card_index': 'OP05-119',
            'card_name': 'モンキー・D・ルフィ スーパーパラレル',
            'card_rarity': 'SEC',
        }

        self.assertGreater(
            score_title(card, 'モンキー・D・ルフィ コミパラ [OP05-119]'),
            0,
        )
        self.assertEqual(
            score_title(card, 'モンキー・D・ルフィ SEC [OP05-119]'),
            0,
        )

    def test_gold_don_titles_require_both_snkrdunk_markers(self):
        card = {
            'tcg_type': 'OPCG',
            'card_index': 'OP13-001',
            'card_name': 'ドン!!カード',
            'card_rarity': 'GOLD-DON',
        }

        self.assertGreater(
            score_title(card, 'ドン!!カード スーパーパラレル [OP13-001]'),
            0,
        )
        self.assertEqual(
            score_title(card, 'ドン!!カード [OP13-001]'),
            0,
        )
        self.assertEqual(
            score_title(card, 'スーパーパラレル [OP13-001]'),
            0,
        )

    def test_sp_cards_recognize_spc_titles_as_the_rarity_match(self):
        card = {
            'tcg_type': 'OPCG',
            'card_index': 'OP13-118',
            'card_name': 'Monkey.D.Luffy',
            'card_rarity': 'SP',
        }

        spc_title = 'Monkey.D.Luffy SR-SPC [OP13-118]'
        ordinary_title = 'Monkey.D.Luffy SR [OP13-118]'

        self.assertGreater(
            score_title(card, spc_title),
            score_title(card, ordinary_title),
        )


if __name__ == '__main__':
    unittest.main()