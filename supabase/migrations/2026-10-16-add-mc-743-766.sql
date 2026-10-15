-- Add the 24 S-TD cards listed after the MC base set (743/742 through 766/742).
INSERT INTO public.master_table (
  id,
  tcg_type,
  card_series,
  card_index,
  card_name,
  card_rarity,
  url_yuyutei
)
VALUES
  ('ptcgmc743742s-td10863', 'PTCG', 'mc', '743/742', 'エリカのモンジャラ', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10863'),
  ('ptcgmc744742s-td10864', 'PTCG', 'mc', '744/742', 'エンニュート', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10864'),
  ('ptcgmc745742s-td10865', 'PTCG', 'mc', '745/742', 'ヒバニー', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10865'),
  ('ptcgmc746742s-td10866', 'PTCG', 'mc', '746/742', 'マニューラ', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10866'),
  ('ptcgmc747742s-td10867', 'PTCG', 'mc', '747/742', 'クワガノン', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10867'),
  ('ptcgmc748742s-td10868', 'PTCG', 'mc', '748/742', 'マリル', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10868'),
  ('ptcgmc749742s-td10869', 'PTCG', 'mc', '749/742', 'ジュペッタ', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10869'),
  ('ptcgmc750742s-td10870', 'PTCG', 'mc', '750/742', 'ペロリーム', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10870'),
  ('ptcgmc751742s-td10871', 'PTCG', 'mc', '751/742', 'カポエラー', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10871'),
  ('ptcgmc752742s-td10872', 'PTCG', 'mc', '752/742', 'メレシー', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10872'),
  ('ptcgmc753742s-td10873', 'PTCG', 'mc', '753/742', 'グラエナ', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10873'),
  ('ptcgmc754742s-td10874', 'PTCG', 'mc', '754/742', 'クチート', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10874'),
  ('ptcgmc755742s-td10875', 'PTCG', 'mc', '755/742', 'イーブイ', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10875'),
  ('ptcgmc756742s-td10876', 'PTCG', 'mc', '756/742', 'アオキのムクホーク', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10876'),
  ('ptcgmc757742s-td10877', 'PTCG', 'mc', '757/742', 'ニャオハex', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10877'),
  ('ptcgmc758742s-td10878', 'PTCG', 'mc', '758/742', 'マッギョex', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10878'),
  ('ptcgmc759742s-td10879', 'PTCG', 'mc', '759/742', 'メガタブンネex', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10879'),
  ('ptcgmc760742s-td10880', 'PTCG', 'mc', '760/742', 'ボスの指令[カラスバ]', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10880'),
  ('ptcgmc761742s-td10881', 'PTCG', 'mc', '761/742', 'メガメガニウムex', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10881'),
  ('ptcgmc762742s-td10882', 'PTCG', 'mc', '762/742', 'メガエンブオーex', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10882'),
  ('ptcgmc763742s-td10883', 'PTCG', 'mc', '763/742', 'メガオーダイルex', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10883'),
  ('ptcgmc764742s-td10884', 'PTCG', 'mc', '764/742', 'ピカチュウex', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10884'),
  ('ptcgmc765742s-td10885', 'PTCG', 'mc', '765/742', 'リーリエのピッピex', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10885'),
  ('ptcgmc766742s-td10886', 'PTCG', 'mc', '766/742', 'メガリザードンYex', 'S-TD', 'https://yuyu-tei.jp/sell/poc/card/mc/10886')
ON CONFLICT (id) DO NOTHING;
