# Nexus Mail - 個人事業主向けスマートメールクライアント

個人事業主専用に設計されたスマートメールクライアント。購入履歴管理、重要メール識別、カレンダー統合を一つのアプリケーションで実現。

## 🌟 主な機能

### 📧 スマートメール管理
- **自動メール分類** (通常メール / メルマガ / サービス通知)
- **メルマガ自動識別** - 営業メールを自動で振り分け
- **サービス通知管理** - GitHub、各種ツールからの通知を整理
- **スレッド表示** - 会話履歴を時系列で表示
- **Gmail API完全統合** - 実際のGmailデータをリアルタイム同期

### ✉️ メール操作機能
- **メール返信機能** - アプリ内から直接返信
- **未読カウント表示**
- **添付ファイル検出**
- **スター機能** (実装予定)

### 🎨 デザイン特徴
- **近未来的UI** - グラスモーフィズム効果
- **ネオングロー効果** - 洗練された光彩エフェクト
- **カラーコーディング** - ページごとに色分けされたナビゲーション
- **レスポンシブデザイン** - あらゆる画面サイズに対応

## 🚧 実装予定機能

### 📇 連絡先自動抽出機能
- メール署名から自動で連絡先情報を抽出
- 氏名、会社名、部署、電話番号、住所を管理
- 最新情報への自動更新

### 💰 購入履歴管理
- レシートメールの自動解析
- Amazon、楽天などの注文確認メール対応
- 月別支出集計とレポート生成

### 📁 メールボックス階層管理
- カスタムフォルダー作成
- ドラッグ&ドロップでの整理
- 自動振り分けルール設定

### 📅 カレンダー連携
- メールからイベント自動検出
- Google Calendar同期
- スケジュール提案機能

## 🚀 技術スタック

### フロントエンド
- **React 18** + TypeScript
- **Tailwind CSS** - スタイリング
- **React Router** - ルーティング
- **React Query** - データフェッチング

### バックエンド
- **Node.js** + Express
- **TypeScript** - 型安全性
- **Passport.js** - 認証管理
- **Google APIs** (Gmail, OAuth)

### 認証
- **Google OAuth 2.0**
- **セッション管理**
- **セキュアなトークン処理**

## 📋 必要要件

- Node.js v18以上
- Google Cloud Platformアカウント
- Gmail API有効化
- OAuth 2.0認証情報

## 🛠️ インストール方法

### 1. リポジトリをクローン
```bash
git clone https://github.com/SR-YUKITAKAGI/-Nexus-Mail.git
cd -Nexus-Mail
```

### 2. 依存関係をインストール
```bash
# ルートディレクトリで
npm install

# クライアント側
cd client && npm install

# サーバー側
cd ../server && npm install
```

### 3. 環境変数を設定
```bash
# .envファイルを作成
cp .env.example .env
```

以下の情報を`.env`に設定：
```
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
SESSION_SECRET=your_session_secret
CORS_ORIGIN=http://localhost:3002
```

### 4. 開発サーバーを起動
```bash
# サーバー側（ターミナル1）
cd server
npm run dev

# クライアント側（ターミナル2）
cd client
PORT=3002 npm start
```

アプリケーションは以下のURLでアクセス可能：
- フロントエンド: http://localhost:3002
- バックエンドAPI: http://localhost:3001

## 📁 プロジェクト構造

```
nexus-mail/
├── client/                 # Reactフロントエンド
│   ├── src/
│   │   ├── components/    # 再利用可能なUIコンポーネント
│   │   ├── pages/        # ページコンポーネント
│   │   │   ├── Dashboard.tsx    # ダッシュボード
│   │   │   ├── EmailsNew.tsx    # メール画面（Gmail連携）
│   │   │   ├── Purchases.tsx    # 購入管理
│   │   │   ├── Calendar.tsx     # カレンダー
│   │   │   └── Settings.tsx     # 設定
│   │   ├── context/      # 認証コンテキスト
│   │   └── index.css     # カスタムCSS（ネオン効果など）
│   └── package.json
├── server/                # Expressバックエンド
│   ├── src/
│   │   ├── routes/       # APIルート
│   │   │   ├── auth.ts   # 認証エンドポイント
│   │   │   └── emails.ts # メールAPI
│   │   ├── services/     # ビジネスロジック
│   │   │   ├── gmailService.ts      # Gmail API統合
│   │   │   └── newsletterDetector.ts # メルマガ判定
│   │   ├── middleware/   # ミドルウェア
│   │   └── config/       # 設定ファイル
│   └── package.json
└── README.md
```

## 🔒 セキュリティ機能

- **OAuth 2.0認証** - Googleアカウントで安全にログイン
- **セッション管理** - セキュアなクッキー処理
- **環境変数保護** - 認証情報の分離
- **CORS設定** - クロスオリジン攻撃防止

## 📊 実装済みAPI

### 認証
- `GET /auth/google` - Google OAuth開始
- `GET /auth/google/callback` - OAuth コールバック
- `POST /auth/logout` - ログアウト
- `GET /auth/me` - 現在のユーザー情報

### メール操作
- `GET /api/emails/threads` - メールスレッド取得
- `GET /api/emails/threads/:id` - 特定スレッド詳細
- `POST /api/emails/send` - メール送信（返信）

## 🧪 テスト方法

```bash
# Gmail連携テスト
1. http://localhost:3002 にアクセス
2. "Sign in with Google" をクリック
3. Googleアカウントでログイン
4. メールが表示されることを確認
```

## 📝 使い方

### メール分類
- **All** - すべてのメール
- **Primary** - 通常のメール
- **Newsletter** - メルマガ・営業メール
- **Service** - サービス通知

### メール返信
1. メールスレッドを選択
2. 最後のメッセージで「Reply」をクリック
3. 返信内容を入力
4. 「Send Reply」で送信

## 🤝 コントリビューション

1. このリポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/AmazingFeature`)
3. 変更をコミット (`git commit -m '素晴らしい機能を追加'`)
4. ブランチにプッシュ (`git push origin feature/AmazingFeature`)
5. プルリクエストを作成

## 📄 ライセンス

このプロジェクトはMITライセンスの下で公開されています。

## 🙏 謝辞

- Google APIs (Gmail, OAuth)
- React / Node.jsコミュニティ
- Tailwind CSS
- すべての貢献者とテスター

## 📞 サポート

問題が発生した場合は、GitHubのIssueを作成してください。

---

**注意**: これは開発版です。本番環境での使用前に、すべてのセキュリティ設定を適切に構成してテストしてください。

🤖 Generated with [Claude Code](https://claude.ai/code)