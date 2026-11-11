#!/bin/bash
# AKB48 BOOKING ALERT：公開の残り（Cloudflare＋GitHub設定＋初回実行）を全部やるスクリプト
# 使い方：プロジェクトのフォルダで  bash scripts/setup.sh
# 前提：gh auth login と npx wrangler login が済んでいて、GitHubに push 済み
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DB=oshi-gekijo-alert
step() { printf '\n\033[1;31m▶ %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✘ %s\033[0m\n' "$1"; exit 1; }

step "準備チェック"
command -v node >/dev/null || die "Node.js が入ってないよ（https://nodejs.org）"
command -v gh >/dev/null || die "gh が入ってないよ（brew install gh）"
gh auth status >/dev/null 2>&1 || die "GitHubにログインしてないよ（gh auth login）"
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) || die "GitHubのリポジトリが見つからない（push済み？）"
OWNER=${REPO%%/*}
ORIGIN="https://$(echo "$OWNER" | tr 'A-Z' 'a-z').github.io"
echo "リポジトリ: $REPO"
echo "サイト: $ORIGIN/${REPO#*/}/"
[ -d node_modules/web-push ] || npm install --no-audit --no-fund
WR="npx --yes wrangler@4"
$WR whoami 2>/dev/null | grep -qi "logged in" || { echo "Cloudflareにログインするよ（ブラウザで Allow を押してね）"; $WR login; }

step "1/6 データベース（D1）"
ID=$($WR d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s.slice(s.indexOf("[")));const x=a.find(d=>d.name===process.argv[1]);process.stdout.write(x?x.uuid:"")}catch{}})' "$DB" || true)
if [ -z "$ID" ]; then
  $WR d1 create "$DB" </dev/null
  ID=$($WR d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s.slice(s.indexOf("[")));const x=a.find(d=>d.name===process.argv[1]);process.stdout.write(x?x.uuid:"")})' "$DB" || true)
fi
[ -n "$ID" ] || die "database_id が取れなかった"
echo "database_id: $ID"
node -e '
const fs=require("fs"),f="worker/wrangler.toml";let t=fs.readFileSync(f,"utf8");
t=t.replace(/^database_id = .*$/m,`database_id = "${process.argv[1]}"`).replace(/^ALLOWED_ORIGINS = .*$/m,`ALLOWED_ORIGINS = "${process.argv[2]}"`);
fs.writeFileSync(f,t);' "$ID" "$ORIGIN"
(cd worker && $WR d1 execute "$DB" --remote --file=schema.sql </dev/null)

step "2/6 購読サーバー（Worker）をデプロイ"
LOG=$(mktemp)
(cd worker && $WR deploy 2>&1 | tee "$LOG") || true
API=$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$LOG" | head -1 || true)
if [ -z "$API" ]; then
  echo
  echo "WorkerのURLが読み取れなかった。上にエラーが出てたら、それをClaudeに見せてね。"
  echo "workers.dev のサブドメインが未登録なら、https://dash.cloudflare.com の「Workers & Pages」を一度開いて登録してから、もう一回このスクリプトを実行してね。"
  read -r -p "URLが表示されてるなら貼ってEnter（https://〜.workers.dev）: " API
fi
API=${API%/}
[[ "$API" =~ ^https://.+\.workers\.dev$ ]] || die "WorkerのURLがおかしい: $API"
echo "Worker: $API"

step "3/6 合言葉（ADMIN_TOKEN）"
TOKEN=$(openssl rand -hex 24)
printf '%s' "$TOKEN" | (cd worker && $WR secret put ADMIN_TOKEN)
printf '%s' "$TOKEN" | gh secret set ADMIN_TOKEN -R "$REPO"

step "4/6 通知用の鍵（VAPID）"
PUB=$(gh variable get VAPID_PUBLIC_KEY -R "$REPO" 2>/dev/null || true)
if [ -n "$PUB" ] && gh secret list -R "$REPO" | grep -q '^VAPID_PRIVATE_KEY'; then
  echo "鍵はもう登録済みだから、そのまま使うよ"
else
  KEYS=$(npx --yes web-push generate-vapid-keys --json)
  PUB=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).publicKey)' "$KEYS")
  node -e 'process.stdout.write(JSON.parse(process.argv[1]).privateKey)' "$KEYS" | gh secret set VAPID_PRIVATE_KEY -R "$REPO"
  gh variable set VAPID_PUBLIC_KEY -R "$REPO" --body "$PUB"
fi
MAIL=$(git config user.email || true)
[ -n "$MAIL" ] || MAIL="$OWNER@users.noreply.github.com"
gh variable set VAPID_SUBJECT -R "$REPO" --body "mailto:$MAIL"
gh variable set API_BASE -R "$REPO" --body "$API"

step "5/6 設定をGitHubに保存"
git add worker/wrangler.toml scripts/setup.sh .github 2>/dev/null || true
git diff --cached --quiet || git commit -q -m "Worker設定"
git pull -q --rebase origin main || true
git push -q origin HEAD:main
echo "push OK"

step "6/6 初回チェックを実行"
last() { gh run list -R "$REPO" --workflow=check.yml --event workflow_dispatch --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true; }
BEFORE=$(last)
gh workflow run check.yml -R "$REPO" --ref main
RUN=""
for i in $(seq 1 30); do sleep 3; RUN=$(last); [ -n "$RUN" ] && [ "$RUN" != "$BEFORE" ] && break; RUN=""; done
[ -n "$RUN" ] || die "実行が始まらなかった。GitHubのActionsタブを見てみてね"
gh run watch "$RUN" -R "$REPO" --exit-status && OK=1 || OK=0
git pull -q --rebase origin main || true

echo
if [ "$OK" = 1 ]; then
  printf '\033[1;32m✔ 公開完了！\033[0m\n'
  echo "サイト: $ORIGIN/${REPO#*/}/"
  echo "（反映まで1〜2分かかることがあるよ）"
  echo "iPhoneのSafariで開いて → 共有 →「ホーム画面に追加」→ ホーム画面から開いて推しを選んで通知オン！"
  curl -fsS "$API/health" >/dev/null 2>&1 && echo "購読サーバー: OK" || echo "購読サーバー: 応答なし（少し待ってからもう一回見てね）"
else
  echo "初回チェックが失敗したみたい。gh run view $RUN -R $REPO --log-failed の出力をClaudeに見せてね。"
fi
