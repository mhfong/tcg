import unittest
from unittest.mock import AsyncMock, patch

from discover_snkrdunk_apparel_ids import discover_one, score_title, search_keywords


class DiscoverSnkrdunkScoringTests(unittest.TestCase):
    def test_sp_cards_try_spc_search_before_plain_index(self):
        card = {
            'id': 'opcgop17op12056sp10167',
            'tcg_type': 'OPCG',
            'card_index': 'OP12-056',
            'card_name': 'モンキー・D・ガープ',
            'card_rarity': 'SP',
        }

        async def run_discovery():
            with patch(
                'discover_snkrdunk_apparel_ids.search_snkrdunk',
                new=AsyncMock(return_value=[]),
            ) as search:
                await discover_one(None, card)
                return search.await_args_list

        calls = __import__('asyncio').run(run_discovery())

        self.assertEqual(calls[0].args[1], 'OP12-056 SPC')

    def test_discovery_retries_when_first_search_has_no_scored_candidates(self):
        card = {
            'id': 'opcgop17op17112psr10147',
            'tcg_type': 'OPCG',
            'card_index': 'OP17-112',
            'card_name': 'シャーロット・リンリン',
            'card_rarity': 'P-SR',
        }

        async def run_discovery():
            with patch(
                'discover_snkrdunk_apparel_ids.search_snkrdunk',
                new=AsyncMock(side_effect=[
                    [{'apparel_id': 'unrelated', 'name': 'unrelated'}],
                    [{'apparel_id': '871068', 'name': 'コミパラ [OP17-112]'}],
                ]),
            ) as search, patch(
                'discover_snkrdunk_apparel_ids.score_candidate',
                new=AsyncMock(side_effect=[0, 100]),
            ):
                result = await discover_one(None, card)
                return result, search.await_args_list

        result, calls = __import__('asyncio').run(run_discovery())

        self.assertEqual(result['apparel_id'], '871068')
        self.assertEqual(calls[1].args[1], 'OP17 112')

    def test_discovery_no_match_returns_an_empty_name(self):
        card = {
            'id': 'opcgprb02golddon10214',
            'tcg_type': 'OPCG',
            'card_index': 'PRB02-214',
            'card_name': 'ドン!!カード',
            'card_rarity': 'GOLD-DON',
        }

        async def run_discovery():
            with patch(
                'discover_snkrdunk_apparel_ids.search_snkrdunk',
                new=AsyncMock(return_value=[
                    {'apparel_id': 'wrong', 'name': 'wrong'}
                ]),
            ), patch(
                'discover_snkrdunk_apparel_ids.score_candidate',
                new=AsyncMock(return_value=0),
            ):
                return await discover_one(None, card)

        result = __import__('asyncio').run(run_discovery())

        self.assertEqual(result['name'], '')

    def test_gold_don_search_uses_specific_name_fragment(self):
        card = {
            'card_index': 'OP10-108',
            'card_name': 'ドン!!カード(シュガー)(パラレル)(スーパーパラレル)',
            'card_rarity': 'GOLD-DON',
        }

        self.assertEqual(search_keywords(card)[2], 'シュガー')

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

    def test_sp_cards_prefer_japanese_spc_titles_over_english_listings(self):
        card = {
            'tcg_type': 'OPCG',
            'card_index': 'OP12-056',
            'card_name': 'モンキー・D・ガープ',
            'card_rarity': 'SP',
        }

        japanese_title = 'モンキー・Ｄ・ガープ SR-SPC [OP12-056]'
        english_title = 'モンキー・D・ガープ SR-SPC [OP12-056]【英語版】'

        self.assertGreater(
            score_title(card, japanese_title),
            score_title(card, english_title),
        )


if __name__ == '__main__':
    unittest.main()