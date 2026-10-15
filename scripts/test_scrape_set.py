import unittest

from scrape_set import _fetch_gold_don_cards


class GoldDonScraperTests(unittest.TestCase):
    def test_gold_don_cards_have_no_card_index(self):
        html = '''
        <span>-</span> Card List
        <div class="card-product">
          <a href="https://yuyu-tei.jp/sell/opc/card/prb02/10271">
            <img alt="- - ドン!!カード(ロブ・ルッチ)(パラレル)(スーパーパラレル)">
          </a>
        </div>
        <span>SP</span> Card List
        '''

        cards = _fetch_gold_don_cards('opc', 'prb02', html)

        self.assertEqual(cards[0]['card_index'], None)


if __name__ == '__main__':
    unittest.main()