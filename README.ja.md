# Open Artifact

[English](README.md) · [简体中文](README.zh-CN.md) · 日本語

> **旧名は `baoyu-design` です。** このプロジェクトは
> [baoyu-design](https://github.com/JimLiu/baoyu-design)（旧 URL はここにリダイレクトされます）から始まりました。baoyu-design は、claude.ai 風の
> Artifact タイプを、タイプごとに 1 つの skill としてローカルのコーディングエージェントに持ち込みました。Open Artifact はそれらを、特定のエージェントに依存しないオープンな
> 形式として作り直したものです。1 つのローカルデーモン、1 つのページフレーム、1 つの `/open-artifact` skill、そしてエージェントアプリごとのプラグインで構成されます。

**Open Artifact を使うと、どんなコーディングエージェントでも、ただのファイルではなく、人が開いて編集し、コメントできるものを作れます。** エージェントに、
スライドデッキ、UI デザイン、デザインシステム、ホワイトボード、スプレッドシート、データダッシュボード、ドキュメント、短いアニメーション映像を頼むと、エージェントはファイルの入ったプレーンなフォルダーを書き出します。
ローカルのページがそれを本物のエディターで開き、タイトルを直したり、付箋を動かしたり、コメントを残したり、エクスポートしたりできます。そして
「Send to agent」で、コメントがエージェントのセッションに送り返されます。

https://github.com/user-attachments/assets/9f34dc69-2e90-4118-92fd-63f36d7bc5f9

すべてはあなたのコンピューター上で動きます。アカウントもアップロードも不要で、特定のモデルやベンダーにも依存しません。

```
  you ──"/open-artifact slides a 6-slide pitch"──▶ agent (Claude Code, Codex, Cursor, Copilot, …)
                                                     │ writes files
                                                     ▼
                                           ./my-deck/project/deck.json + slides/*.html
                                                     │ served by the local daemon
                                                     ▼
  you ◀── edit · comment · export (PDF/PPTX/PNG/HTML) ── http://127.0.0.1:<port>/a/<id>
   └──────────────── "Send to agent" ──────────────▶ comments arrive back in the agent's session
```

## ドキュメント

ユーザーと AI エージェントの両方に向けた、英語と中国語の完全なガイドは [docs/](docs/README.md) から始まります。

- [Open Artifact とは](docs/overview.md) — 基本的な考え方、主な利点、クイックスタート。
- [Artifact タイプの概要](docs/artifact-types.md) — 9 つのタイプの比較、選び方、保存モデル。
- [エージェントによる Open Artifact の使い方](docs/agent-guide.md) — MCP ツール、CLI でのフォールバック、ワークフローのライフサイクル、コメント、安全上のルール。

### エージェント製品を作っていますか？

エージェントアプリ（デスクトップ、IDE 拡張機能、コマンドライン、またはローカルのヘルパーを持つ Web アプリ）を提供しているなら、Open
Artifact をその一部にできます。エージェントは自身のツールで Artifact を作り、ページはあなたの UI に表示され、
ページから送られたコメントは正しいセッションに届きます。まずは
[エージェント製品への Open Artifact の統合](docs/integrating.md)をご覧ください。Node SDK は
[`@open-artifact/harness-kit`](packages/harness-kit/README.md) で、[examples/](examples/README.md) には実行できる
アダプターがあります。JavaScript で書かれていないアプリは、stdio ブリッジ（`open-artifact harness --stdio`）を使います。

## Artifact タイプ

| タイプ | 得られるもの | フォルダーの目印 | エクスポート | ガイド |
|---|---|---|---|---|
| **Slides** | 1920×1080（または 4:3）のデッキ：スライドレール、一覧表示、スピーカーノート、ビルド、トランジション、プレゼンターモード | `project/deck.json` | PDF, PPTX, HTML, PNG | [ガイド](docs/types/slides.md) · [SKILL](artifact-types/slides/SKILL.md) |
| **Design** | ライブな `.dc.html` アートボードを並べた無限キャンバス：画面、コンポーネント、クリックで遷移するプロトタイプ、メモ、ページ | `project/canvas.json` | PNG, JPEG, PDF, HTML | [ガイド](docs/types/design.md) · [SKILL](artifact-types/design/SKILL.md) |
| **Design System** | ブランドブック：トークン、コントラストチェック付きの色、書体見本、ライブなコンポーネントプレビュー、アセット。デザイン、デッキ、ダッシュボード、映像にインストールできます | `project/design-system.json` | — | [ガイド](docs/types/design-system.md) · [SKILL](artifact-types/design-system/SKILL.md) |
| **Whiteboard** | 共有の無限ボード：付箋、図形、矢印、手書き、画像、表、埋め込み、ライブカーソル、タイマー | `db/board/meta.json` | PNG | [ガイド](docs/types/whiteboard.md) · [SKILL](artifact-types/whiteboard/SKILL.md) |
| **Sheets** | 共有のスプレッドシート：複数のシート、本格的な数式エンジン、数値の書式、罫線、セルの結合、フィルター付きのテーブル、ドロップダウン、チェックボックス、条件付き書式、行の固定とグループ化、セルからのグラフ、CSV のインポート、セルの履歴 | `sheet/sheet.json` | XLSX, CSV | [ガイド](docs/types/sheets.md) · [SKILL](artifact-types/sheets/SKILL.md) |
| **Data** | ライブなダッシュボードやレポート：CSV/JSON/テキストのアップロード、ライブな MCP コネクターのクエリ、計算から作るデータセットを、プレーンな HTML/CSS/d3 のページで描画します。Sources で各数値の出どころを確認でき、フィルター、手動での編集、リミックスの下書きにも対応しています | `db/dash/meta.json` | PDF, HTML, JSON | [ガイド](docs/types/data.md) · [SKILL](artifact-types/data/SKILL.md) |
| **Docs** | タブで構成されるリビングドキュメント：見出し、リスト、表、画像、日付、メンション、ドロップダウン。承認または却下できる編集の提案、コメント、タブごとのバージョン履歴。Markdown、Word、PDF をインポートできます | `doc/doc.json` | Markdown, Word, PDF, HTML | [ガイド](docs/types/docs.md) · [SKILL](artifact-types/docs/SKILL.md) |
| **Motion** | 短いアニメーション映像：時間から描画される HTML/CSS/JS のシーン、生成された音楽、粗編集から完成版まで、字幕とナレーション。文字、色、フォント、カット、スタイルを手で変更でき、コメントは特定の瞬間やフレーム内の位置に固定できます | `db/film/meta.json` | MP4, GIF, HTML, ZIP | [ガイド](docs/types/motion.md) · [SKILL](artifact-types/motion/SKILL.md) |
| **Page** | エージェントがまるごと書く自由な HTML ページ：ウィジェット、ツール、ミニゲーム、解説ページ。宣言したランタイム機能（共有データベース、アップロード、コメント、ライブメッセージ）を使えます。セルフホストの Node サイトや Cloudflare サイトにも公開できます | `index.html` | — | [ガイド](docs/types/page.md) · [SKILL](artifact-types/page/SKILL.md) |

各タイプのフォルダーは自己完結した skill です。`SKILL.md` はエージェントにその書き方を伝え、`reference/` は
ファイル形式を説明し、`artifact-type.json` はホストに向けてタイプを記述し、`scripts/`（ビルド後）には CLI とエディターが入っています。

## クイックスタート

### 1. エージェントアプリのプラグインとして使う（推奨）

**Node.js 22.18+** をインストールしてから、
[GitHub Release](https://github.com/JimLiu/open-artifact/releases) の **Assets** セクションから `open-artifact-plugins.zip` をダウンロードします。恒久的な場所に展開し、
以下の手順では展開した `open-artifact-plugins/` フォルダーを使ってください。プラグインには skill、デーモン、エディターが含まれています。
DeepSeek Harness は、ビルド済みのパッケージを npm から直接インストールします。

| エージェントアプリ | インストール |
|---|---|
| [Claude Code](plugins/claude-code/README.md)（CLI、デスクトップ、IDE） | 展開したルートをマーケットプレイスとして追加し、`open-artifact@open-artifact` をインストールします。 |
| [Codex](plugins/codex/README.md)（CLI、アプリ）と ChatGPT デスクトップ | `codex plugin marketplace add` で展開したルートを追加し、Plugins で **Open Artifact** をインストールします。 |
| [Cursor](plugins/cursor/README.md) | 展開した `cursor/` フォルダーを `~/.cursor/plugins/local/open-artifact` にコピーし、**Developer: Reload Window** を実行します。 |
| [GitHub Copilot](plugins/copilot/README.md) CLI | 展開したルートをマーケットプレイスとして追加し、`open-artifact@open-artifact` をインストールします。 |
| VS Code の [GitHub Copilot](plugins/copilot/README.md) | **Chat: Install Plugin from Source** を実行し、展開した `copilot/` フォルダーを選びます。 |
| [Antigravity](plugins/antigravity/README.md) | 展開した `antigravity/` フォルダーを `agy plugin install` でインストールするか、`~/.gemini/config/plugins/open-artifact` にコピーしてから、アプリを再起動します。 |
| [ZCode](plugins/zcode/README.md) | Plugin Marketplace で、展開した `zcode/` フォルダーをプラグインマーケットプレイスとして追加し、一覧から **Open Artifact** をインストールします。 |
| [Web 版の ChatGPT](plugins/chatgpt/README.md) | 展開した `chatgpt/` フォルダーにあるビルド済みのコネクターを実行し、HTTPS で接続します。 |
| [DeepSeek Harness](https://www.npmjs.com/package/dsh-open-artifact) | Plugins で **Add plugin** を選び、npm パッケージとして `dsh-open-artifact` を入力します。CLI では、Web プロファイル向けに `dsh plugin --profile web add dsh-open-artifact` を実行します。 |

アップグレードするには、新しい ZIP をダウンロードして、展開済みのフォルダーを同じパスで置き換え、リンク先のガイドにある
アプリごとの更新手順に従ってください。マーケットプレイスがまだソースのチェックアウトを指している場合は、アプリのガイドにある移行手順で
展開したフォルダーを登録してください。

DeepSeek Harness では、新しいバージョンが提供されたら、Open Artifact のページで **Update** を使います。以前に
ローカルのチェックアウトをリンクしていた場合は、Plugins でリンクしたプラグインを削除し、npm から `dsh-open-artifact` を追加してください。

新しいセッションで、次のプロンプトのどれかを試してみてください。

```text
/open-artifact slides a 6-slide pitch for this repo
/open-artifact design three landing page options for a coffee shop
/open-artifact whiteboard a retro board for last sprint
/open-artifact sheets a monthly budget with categories and totals
/open-artifact data a dashboard of signups by month from signups.csv
/open-artifact docs a hiring plan for 2027 with roles, budget and timeline
/open-artifact motion a 20-second launch animation for this app
/open-artifact page a team lunch poll that remembers every vote
```

プラグインは、`Artifact`、`ArtifactData`、`ArtifactComments` の MCP ツール、skill、そして
ページのコメントをセッションに戻すフックを追加します。各アプリがどのようにコメントを受け取るか、そしてそれぞれで何をテストしたかは、
[plugins/README.md](plugins/README.md) に書かれています。

[MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) を表示できるアプリでは、エージェントは
`ShowArtifact` ツールも使えます。このツールは Artifact のライブなページを会話の中に表示し、チャットを離れずに編集やコメントをしたり、
全画面にしたり、ブラウザで開いたり、コメントをエージェントに送ったりできます。MCP Apps を表示しないアプリには、このツールは表示されません。Codex はこのカードに https のページしか表示しないため、Codex ではカードに「Open in browser」ボタンとページのアドレスが表示されます。

### 2. ほかのエージェント向けの skill として使う

展開したプラグインバンドルから `codex/skills/open-artifact/` を、エージェントの skill ディレクトリにコピーします。これには
デーモンが含まれており、エージェントはコマンドラインからデーモンを操作します。展開したバンドルのルートで、次を試せます。

```bash
node codex/skills/open-artifact/scripts/open-artifact.mjs artifact '{"action":"list","scope":"types"}'
```

### 3. 1 つのタイプを単独で使う

[ソースからビルド](#ソースからビルド)した後は、ビルドした各タイプのフォルダーを、デーモンなしで単独で実行できます。

```bash
node artifact-types/design/scripts/cli.mjs open ./my-design --type design   # starts a local server, prints the URL
node artifact-types/design/scripts/cli.mjs wait ./my-design                 # blocks until someone presses "Send to agent"
```

ほかのコマンド: `check`、`generate`、`upload`、`context`、`comments`、`history`、`share`、`status`、`stop`、… 引数なしで
CLI を実行すると、一覧がすべて表示されます。

## 自分のサーバーにデプロイする

サイトがあれば、コンピューターの電源が切れていてもアクセスできる Web アドレスを Artifact に持たせられます。ユーザーはサインインして、共有されたものを開き、
一緒に編集やコメントができ、エージェントはそこに公開できます。ガイドは [docs/](docs/README.md) にあります。

- [サイトに Artifact を置く](docs/hosting.md): サイトの仕組みと、どの種類を運用するか。まずはここから。
- [自宅やオフィスのネットワークで](docs/hosting-lan.md): ドメインなし、プレーンな http。
- [ドメイン付きの自分のサーバーで](docs/hosting-server.md): Caddy を使った Docker Compose、サインインのプロバイダー、AWS。
- [Cloudflare で](docs/hosting-cloudflare.md): D1 と Durable Objects を使う Worker。
- [コンピューターとエージェントをつなぐ](docs/connecting-agents.md): `open-artifact remote add`、公開、
  新しい Artifact の自動公開、インストール時のプリセット、リモート MCP、ダッシュボードのデータ。
- [プラグイン](docs/plugins.md): 会社のサインイン、独自のサービスからの権限、ルール、イベント、
  招待メール。プラグインの使い方と書き方。

## 開発

### ソースからビルド

ソースのチェックアウトから、依存関係をインストールし、ワークスペースとプラグインのフォルダーをビルドします。

```bash
npm ci
npm run build
node scripts/build-plugins.mjs
```

ローカルでプラグインを開発するときは、インストールガイドで展開したフォルダーを使う箇所で `dist/plugins/` を使ってください。

```bash
npm run typecheck
npm test             # unit tests (node --test)
npm run e2e          # end-to-end: drives the built types with the CLI and Chrome, see e2e/README.md
```

`crates/` の Rust クレートは WebAssembly にコンパイルされます。その出力は `packages/wasm-*/generated/` にコミットされているため、
Rust が必要になるのはクレートを変更するときだけです。

```bash
node scripts/build-wasm.mjs   # needs cargo + wasm32-unknown-unknown, wasm-bindgen, wasm-opt
```

### リリース

`node scripts/build-npm.mjs` は、npm パッケージを `dist/npm/` に用意します。`@open-artifact/*` のライブラリ（型宣言付きで
JavaScript にコンパイル）、`@open-artifact/cli`（デーモンを同梱した `open-artifact` コマンド）、そして
`dsh-open-artifact` です。リリースの手順は次のとおりです。

1. バージョンを上げます（すべてのパッケージとプラグインのマニフェストで同じバージョンを共有します）。
2. `node scripts/changelog.mjs` を実行して前回のタグ以降のコミットを確認し、[CHANGELOG.md](CHANGELOG.md) の先頭に
   使う人にとって何が変わったか（Added / Changed / Fixed）を書いた `## [x.y.z] - date` のエントリーと、
   末尾にその比較リンクを追加します。
3. コミットしてから、タグ（`v0.9.0`）をプッシュします。[Publish to npm](.github/workflows/publish-npm.yml) ワークフローは、
   そのタグの変更履歴のエントリーを必須とします。npm の trusted publishing で新しいバージョンのパッケージを公開し、
   タグの GitHub リリースに `open-artifact-plugins.zip` を添付して、変更履歴のエントリーをリリースノートとして使います。

npm にまだ存在しないパッケージは、最初のリリースの前に一度だけコンピューターから名前を確保します。
`node scripts/publish-npm.mjs --claim` は、用意したバージョンを公開し、ワークフローを trusted publisher として設定します。
`node scripts/publish-npm.mjs` でもコンピューターから公開できます（`--dry-run` で事前に確認できます）。

## リポジトリの構成

| パス | 内容 |
|---|---|
| `artifact-types/` | skill としての 9 つのタイプ: `SKILL.md`、`reference/`、`artifact-type.json`（`page` には専用のエディターと CLI がありません）。 |
| `skills/open-artifact/` | 1 つの `/open-artifact <type>` skill。`vendor/`（ビルド後）にはデーモンが入っています。 |
| `plugins/` | エージェントアプリごとにパッケージした skill。フックと MCP の設定付き（[README](plugins/README.md)）。 |
| **プラットフォーム** | |
| `packages/daemon` | `open-artifact` デーモン: タイプのレジストリ、Artifact のライブラリ、エージェントのツール、MCP、wake のルーティング、Harness API。 |
| `packages/shell` | デーモンのページ: すべての Artifact を囲む Shell フレームと、ホームページ。 |
| `packages/protocol` | デーモン、ハーネスのアダプター、タイプサーバー、Shell、ページが共有する型付きの契約。 |
| `packages/harness-kit` | エージェントアプリがデーモンに接続し、ページを表示し、wake を受け取るための SDK（[README](packages/harness-kit/README.md)）。 |
| `packages/runtime` | `window.openartifact`。ページが使う機能の API（ファイル、アップロード、ユーザー、エージェント、プレゼンス、ダウンロード）。 |
| `packages/type-server`, `packages/server-sdk` | タイプごとのローカルサーバーと `cli.mjs`。共有のサーバーコード。 |
| **タイプ** | |
| `packages/slides-core`, `slides-editor` | Slides のモデル（HTML のサブセット、`deck.json`）とエディター。 |
| `packages/design-core`, `design-editor`, `dc` | Design のモデル（`canvas.json`）、エディター、`.dc.html` のアートボード形式。 |
| `packages/design-system-core`, `design-system-editor` | Design System のモデル（トークンの文法、CSS コンパイラー）とエディター。 |
| `packages/whiteboard-core`, `whiteboard-editor` | Whiteboard のモデル（スキーマ、ライブ同期、ジオメトリ）とエディター。 |
| `packages/sheets-core`, `sheets-editor` | Sheets のモデル（ワークブック、セル、スタイル、テーブル、グラフ）とエディター。 |
| `packages/data-core`, `data-editor` | Data のモデル（データセット、クエリ、ルール、ダッシュボードのページ）とエディター。 |
| `packages/docs-core`, `docs-editor` | Docs のモデル（ID 付きのブロックと文字、操作、提案、Markdown）とエディター。 |
| `packages/motion-core`, `motion-stage`, `motion-audio`, `motion-export`, `motion-editor` | Motion のモデル（映像のストア、シーン、手作業の記録）、サンドボックス化されたステージとその `kit`、音楽の合成、MP4/GIF/HTML/ZIP のエクスポート、プレーヤー。 |
| **共有** | |
| `packages/live-store` | Whiteboard、Data、Motion が共有するライブなドキュメント同期。 |
| `packages/ui`, `editor-kit`, `export-kit` | UI キット（Base UI + Tailwind）、エディター間で共有するもの（コメント、履歴、プレゼンスなど）、ブラウザ側のエクスポート。 |
| `packages/canvas-engine`, `wasm-*`, `crates/` | WebGL2 のキャンバスエンジンと、その背後にある Rust/WebAssembly のクレート。エクスポート、ホワイトボードのジオメトリ、データのルール、シートの数式エンジン、モーション（GIF/MOV のエンコード、フラッシュの解析）。 |
| `examples/` | エージェントアプリの実行できる統合例（[README](examples/README.md)）。 |
| `e2e/` | エンドツーエンドテスト。 |
| `scripts/` | `build.mjs`、`build-plugins.mjs`、`build-skill.mjs`、`build-wasm.mjs`。 |

## ライセンス

[Apache License 2.0](LICENSE)。Copyright 2026 Jim Liu 宝玉。[NOTICE](NOTICE) を参照してください。
