# Gmail API Setup Guide

## 1. Google Cloud Consoleでプロジェクトを作成

1. [Google Cloud Console](https://console.cloud.google.com)にアクセス
2. 新しいプロジェクトを作成、または既存のプロジェクトを選択

## 2. Gmail APIを有効化

1. 左側メニューから「APIとサービス」→「ライブラリ」を選択
2. 「Gmail API」を検索
3. 「有効にする」をクリック

## 3. OAuth 2.0認証情報を作成

1. 「APIとサービス」→「認証情報」を選択
2. 「認証情報を作成」→「OAuth クライアント ID」を選択
3. 同意画面の設定（初回のみ）:
   - User Type: 「外部」を選択
   - アプリ名: 「Nexus Mail」
   - サポートメール: あなたのメールアドレス
   - スコープを追加:
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.modify`

4. OAuth クライアント IDの作成:
   - アプリケーションの種類: 「ウェブアプリケーション」
   - 名前: 「Nexus Mail Web Client」
   - 承認済みのJavaScript生成元:
     - `http://localhost:3002`
     - `http://localhost:3001`
   - 承認済みのリダイレクトURI:
     - `http://localhost:3001/auth/google/callback`

## 4. 認証情報を.envファイルに設定

作成されたクライアントIDとクライアントシークレットを、`.env`ファイルに設定:

```bash
GOOGLE_CLIENT_ID=your_actual_client_id_here
GOOGLE_CLIENT_SECRET=your_actual_client_secret_here
```

## 5. サーバーを起動

```bash
# Terminal 1: Backend
cd server
npm run dev

# Terminal 2: Frontend (既に起動済み)
cd client
PORT=3002 npm start
```

## 6. ブラウザでログイン

1. http://localhost:3002 にアクセス
2. 「Sign in with Google」をクリック
3. Googleアカウントでログイン
4. 権限を許可

## トラブルシューティング

### エラー: redirect_uri_mismatch
- Google Cloud ConsoleでリダイレクトURIが正しく設定されているか確認
- `http://localhost:3001/auth/google/callback` が追加されているか確認

### エラー: invalid_client
- クライアントIDとクライアントシークレットが正しくコピーされているか確認
- .envファイルが正しい場所にあるか確認