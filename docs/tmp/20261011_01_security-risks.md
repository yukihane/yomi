# セキュリティ・個人情報漏洩リスクの調査結果

- 調査日: 2026-10-11
- 対象コミット: `7a6ff1a7d0b228166db1e5f1b15b3681e7281df6`
- 対象: この作業ツリーの製品ソース、設定、ロックファイル、生成した Chrome MV3 ビルド
- 参考: `E:\repos\yomi\docs\tmp\security-risks.md`（別ブランチ、対象コミット `2a916440994fb9b631d426c68493ef688ff85efb`）
- 方法: 静的なデータフロー・権限確認、差分確認、隔離した Chromium 153.0.8010.12 でのダミーデータによる再現、`pnpm audit --json`

## 結論

確認したアプリケーションコードでは、作者のサーバーへの隠れた送信や、認証情報を第三者へ転送する実装は見つからなかった。一方、意図しない文章の外部送信と、認証情報・保存済み訳文の保護に問題がある。以前の報告の主要3点は、このブランチでも再現した。さらに、キャッシュ API の呼び出し元の分離不足を確認した。

| ID | 修正優先度 | 指摘 | 今回の確認 |
| --- | --- | --- | --- |
| S1 | 高 | 非表示文と翻訳除外領域内の動的追加が送信対象になる | 現在のビルドで再現 |
| S2 | 中 | content script から更新用トークンを読める | ダミートークンで再現 |
| S3 | 中 | 訳文の保存期限がなく、サインアウト後にも残る | 7件中7件が残存 |
| S4 | 中 | 別サイトのキャッシュを content script から参照できる | 既知のキーを使って再現 |

優先度は今回の修正順の目安であり、CVSS 評価ではない。実際の情報漏洩が起きたことを示す調査ではない。S2・S4 の検証は content script の権限を調べたもので、通常の Web ページからその権限を奪う攻撃を再現したものではない。

S1 の修正までは、機密情報のあるページでページ全体の翻訳を避ける運用が妥当。選択翻訳でも、選択した文章そのものは外部送信される。

## データの送信先・保存先

| データ | 扱いと根拠 |
| --- | --- |
| ページ本文 | 翻訳開始後、OpenAI Responses API に送信。[page-translator.ts](../../src/usecases/content/page-translator.ts) 277–305行、[client.ts](../../src/infra/openai/client.ts) 39行以降 |
| タイトル・説明文 | ページ翻訳時に文脈として最大200文字・300文字を送信。本文の除外指定とは別に取得。[prompts.ts](../../src/domain/prompts.ts) 9–31行 |
| 画面外・追加された文章 | 画面内を優先するが画面外も処理する。翻訳開始後は DOM 変更を監視し、停止するまで追加分も対象になる。[page-translator.ts](../../src/usecases/content/page-translator.ts) の `start`、`takeBatch`、`scan` |
| 選択翻訳 | 最大8,000文字を送信。この処理では永続キャッシュへ保存しない。[selection-translator.ts](../../src/usecases/content/selection-translator.ts) 72行以降 |
| OAuth 情報 | `auth.openai.com` と認可・トークン取得・失効を通信。アクセストークン、更新用トークン、ID トークン、メールアドレスを `storage.local` に保存。[auth.ts](../../src/infra/storage/auth.ts) 5–20行 |
| インストール識別子 | UUID をローカル保存し、認可時に `ext_agent_host_id` として送信。[oauth.ts](../../src/domain/oauth.ts) 28–43行 |
| 訳文 | 拡張の IndexedDB に平文相当で保存。キーだけ SHA-256 化し、最大50,000件を保持。[translation-cache.ts](../../src/infra/storage/translation-cache.ts) 40–81行 |
| 設定 | モデル・言語・表示設定を `storage.sync` に保存。[settings.ts](../../src/infra/storage/settings.ts) 9行 |
| ページ URL | キャッシュキー生成に origin と pathname を使う。独立した項目として翻訳 API に送る実装はない。本文などに含まれれば送信される。[translation-cache.ts](../../src/domain/translation-cache.ts) 14–18行 |

アプリケーションの主な外部通信先は `auth.openai.com` と `api.openai.com`。使用量画面として `chatgpt.com/settings/usage` を開く。`127.0.0.1:1455/callback` は OAuth の loopback リダイレクト先。設定で任意の API 送信先へ切り替える実装は見つからなかった。

翻訳リクエストには `store: false` を指定している。ただし送信自体は行われる。送信先の保持・利用条件は今回検証しておらず、このフラグから「一切保存されない」とは結論しない。

## S1: 非表示・除外領域の文章が送信される

**優先度: 高。通常のページ翻訳操作だけで発生する。**

今回のモック API が受け取った `input` には、`visibility:hidden` の `AUDIT_VISIBILITY_HIDDEN`、`opacity:0` の `AUDIT_OPACITY_ZERO`、インラインの非表示要素内の `AUDIT_INLINE_HIDDEN` が含まれた。初回は除外された `notranslate` 領域にも、翻訳開始後に `<p>` を追加すると `AUDIT_DYNAMIC_EXCLUDED_CHILD` が別リクエストで送られた。

原因は次の組み合わせ。

- [segmenter.ts](../../src/infra/dom/segmenter.ts) 107–108行: `checkVisibility()` を追加オプションなしで呼ぶ。`visibility` と `opacity` を確認するオプションは既定で無効。[MDN の仕様説明](https://developer.mozilla.org/en-US/docs/Web/API/Element/checkVisibility)
- 同79–87行・140–174行: 除外は要素自身について判定する。追加されたブロック要素を root として走査すると、祖先の除外指定を見ない。
- 同163行および [markup.ts](../../src/infra/dom/markup.ts) 46–68行: インライン要素をまとめて直列化する経路で、可視性の除外を統一して適用していない。
- [dom-watcher.ts](../../src/infra/dom/dom-watcher.ts) 48–53行・67–70行: 追加ノードのブロック祖先を再走査対象にする。

画面上に見えない個人情報や、ページ側が翻訳対象外に指定した内容も OpenAI に送信され得る。CSS による非表示はページ自身の機密保護手段ではないが、この拡張の外部送信範囲の誤りとして対応が必要。

対策は、初回走査・再走査・直列化・送信直前で除外規則を共通化し、祖先も確認すること。`visibility` の子要素による上書きや `display:contents` も考慮する。回帰テストには非表示インライン、`notranslate`・`translate=no` 配下の動的追加、待機中の除外属性変更を含める。後二者の全組み合わせは今回未再現。

## S2: 認証トークンの content script への公開範囲が広い

**優先度: 中。content script の侵害など、追加の前提が必要。**

`local:credentials` に更新用トークンを含めて保存し、`storage.local.setAccessLevel` で制限する処理は製品ソースにない。今回、既存の content script の隔離実行環境を DevTools Protocol で指定し、`chrome.storage.local.get('credentials')` からダミー更新用トークンを取得できた。

Chrome の `storage.local` は既定で content script に公開される。認証情報の領域は `TRUSTED_CONTEXTS` に制限し、content script には必要な状態だけをメッセージ経由で渡す設計が適切。[Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)

根拠: [auth.ts](../../src/infra/storage/auth.ts) 5–20行、[item.ts](../../src/infra/storage/item.ts) 15–29行、[background/index.ts](../../src/entrypoints/background/index.ts)。制限は非同期なので、読み書きやリクエスト処理が始まる前に適用する必要がある。

通常のページの JavaScript が直接読めたという結果ではない。トークンを持つ content script が侵害された場合の影響を増やす問題であり、この調査では侵害の入口や実トークンの悪用は検証していない。ローカルプロファイルの取得に対する保護は別途必要。

## S3: 訳文がサインアウト後も端末に残る

**優先度: 中。共有端末、プロファイルの取得、端末内の過去データの扱いに影響。**

[translation-cache.ts](../../src/infra/storage/translation-cache.ts) 52–81行は保存期限ではなく件数と利用時刻による削除を行う。[auth.ts](../../src/usecases/background/auth.ts) 179–191行の `signOut` は資格情報を削除するが訳文を削除しない。

今回、翻訳から保存された6件と、S4 の検証用に保存した1件の計7件が、サインアウト後もすべて残った。資格情報は削除され、サインアウト API は成功した。キーのハッシュ化は訳文本文を秘匿しない。

対策は、キャッシュ無効化・保存期限・サインアウト時の消去を設けること。消去と進行中の翻訳の保存が競合しないよう、実行中の処理も停止・世代管理する。設定画面の [CacheSection.tsx](../../src/ui/options/CacheSection.tsx) には手動消去がある。今回、プライベートウィンドウでの保存は検証していない。

## S4: キャッシュ API がサイト境界を検証しない

**優先度: 中。content script の侵害と、キーの知識または推測可能性が前提。今回の追加指摘。**

[background-server.ts](../../src/infra/messaging/background-server.ts) 31–49行は `_sender` を使わず、メッセージの形式だけを検証する。[protocol.ts](../../src/infra/messaging/protocol.ts) 44–48行のキャッシュ API は任意のキー文字列を受け付ける。バックグラウンドではそのまま共通 DB の参照・保存へ渡す。

今回、拡張画面から `ja\nhttps://other.example/private\nAUDIT_OTHER_SOURCE` をキーとして訳文を保存した。続いて `https://audit.example/page` の content script の実行環境から同じキーで `cache:lookup` を呼ぶと、`AUDIT_OTHER_PRIVATE_TRANSLATION` が返った。別サイトの既知のキーへのアクセス制限がないことを確認した。

これはキャッシュ全件を列挙できたという結果ではない。キーには原文も含まれるため、未知の原文を自由に取得できるとは限らない。ただし、推測可能な原文に対する翻訳履歴の有無や、モデルが文脈を混入した訳文などが取得対象になり得る。また `cache:store` も同じ境界なので、既知の他サイトのキーへの訳文汚染が可能な構造である（書き換え攻撃の再現は未実施）。

対策は、バックグラウンドでブラウザ由来の `sender` の origin・文書情報を検証し、キーのサイト部分を送信側の自己申告にしないこと。保存と参照の両方に適用する。拡張画面だけが使う認証操作も content script と権限を分ける。スキーマ検証は認可の代わりにならない。[Chrome の content script の信頼境界](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#content-scripts-are-less-trustworthy)

## その他の確認・改善候補

- **開始前の送信:** 検証ページを開いて content script が用意された時点の翻訳リクエスト数は0件。あらゆる起動経路の自動送信を否定する網羅検証ではない。
- **広い対象範囲:** 生成 manifest の content script は `<all_urls>`。サイト別の許可・除外設定はない。画面外の文章とタイトル・説明文の送信も利用者に説明し、機密サイトの除外を検討する。
- **モデル出力:** テキストノードと既存要素の複製で反映し、モデル出力を `innerHTML` に代入する実装はない。ただしページ由来の既存属性は複製するため、HTML を一般に無害化する関数ではない。本文やタイトルからのプロンプト注入による誤訳・文脈混入は残り得る。ツール呼び出しや任意 URL の取得をモデルに許可する実装は見つからなかった。
- **OAuth:** 暗号学的乱数、PKCE S256、state、nonce、認可タブ ID の照合がある。一方、[oauth.ts](../../src/domain/oauth.ts) 46–48行のコールバック判定は `startsWith` のため `/callback-extra` も受理する。URL の origin・pathname を完全一致で検証する方がよい。これだけで state/PKCE を回避できることは示していない。
- **ID トークン:** [oauth.ts](../../src/domain/oauth.ts) 127行以降は payload をデコードするだけで、署名・issuer・audience・期限を検証しない。TLS で直接取得した結果を nonce と表示用メールに使う設計。単独のアカウント乗っ取り経路は確認していないが、用途を拡張する前に検証方針を見直す必要がある。
- **サーバー側失効:** [token-endpoint.ts](../../src/infra/oauth/token-endpoint.ts) 16–25行は revoke の HTTP 成否を確認せず、`signOut` も通信例外を握りつぶす。ローカルでのサインアウト成功は、既に流出したトークンのサーバー側失効成功を保証しない。HTTP エラーの扱いと失効失敗時の通知・再試行を検討する。実トークンの失効は未検証。
- **負荷上限:** メッセージの文字列・配列にサイズ上限がなく、翻訳ポートはメッセージごとに処理を始める。侵害された content script の大量要求を制限するバックグラウンド側の上限がない。CPU・保存容量・利用枠消費の防御として件数、サイズ、同時実行数を制限する。通常のページからの直接攻撃は再現していない。
- **静的検索:** 製品ソースの通信、ログ、HTML 挿入経路を確認した。秘密鍵・代表的な API キーのパターン検索では該当なし。全履歴や全種類の秘密を検査した結果ではない。
- **供給網:** 依存はロックファイルで固定され、導入待機期間と build script 制限が設定されている。Actions のロックファイルと CI・配布の権限設定も確認した。ただし外部 Actions 全体のコードと実サービス上のロック適用は検証していない。

## 依存関係と前回調査との比較

今回の `pnpm audit --json` は critical / high / moderate / low / info がすべて0件。API が返した `totalDependencies` は316。開発用依存も照合対象。依存パッケージ情報を監査 API に送ったが、ソースコードや認証情報は送っていない。既知の脆弱性の照合結果であり、未知の欠陥や悪意あるコードがない保証ではない。

前回は Firefox を含む別ブランチのビルドを対象としている。今回は Chrome 向け manifest のみを確認し、Firefox の再現結果や前回の監査件数346を流用していない。空白差分を除いた比較では、S1 の `segmenter.ts`・`dom-watcher.ts`、S2 の `storage/auth.ts` に変更はなく、キャッシュ保存処理も import 整理のみ。今回の実行結果でも主要3点を確認した。

## 再現方法と証跡

- [再現スクリプト](20261011_02_security-probe.mjs)
- [今回の再現結果 JSON](20261011_03_security-probe-result.json)

PowerShell でリポジトリー直下から次を実行する。スクリプトは新しい専用プロファイルを `.output/security-profile-*` に作る。ブラウザと拡張以外の実アカウント・既存プロファイルは使用しない。翻訳・モデル・失効 API は service worker 内でモックし、それ以外の同 worker の fetch は例外にする。テストページは Playwright の route で供給する。

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright-core install --no-shell chromium
pnpm build
pnpm exec node docs/tmp/20261011_02_security-probe.mjs
```

再実行の JSON は `.output/security-probe-result.json` に出力される。同梱の証跡を自動で上書きしない。DOM 更新は条件が成立するまで待ち、固定時間後の状態には依存しない。content script の権限検証には CDP を使うため、通常の Web ページ JavaScript の攻撃手順ではない。

今回の初回入力に含まれなかったものは `display:none`、`hidden` 属性、入力欄の値、`contenteditable`、初期の `notranslate` 子要素。すべての DOM/CSS 構造での除外を保証するものではない。

## 限界と変更内容

公開 Releases の zip との一致、全依存コード、実アカウントの OAuth、送信先のデータ保持、プライベートウィンドウ、あらゆるページ構造は未検証。製品ソースは変更しておらず、指摘は未修正。追加ファイルは調査報告と再現資料のみ。対応完了後はリポジトリーの規約に従い `docs/tmp` の資料を削除する。
