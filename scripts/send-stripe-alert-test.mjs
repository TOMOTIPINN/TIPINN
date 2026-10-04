/**
 * Stripe の連結アカウントの異常の通知（2026-10-04・`40_decisions.md` §7.2）を、本番で1回試すための台本。
 * 署名付きの試験イベントを本番の Connect webhook に送る。**Stripe の API も stripe コマンドも使わない**
 * （署名は stripe ライブラリのテスト用ヘッダー生成で作る）。
 *
 * ★本番の DB に書き込まれる★（salons の上書き・stripe_events・login_attempts）。運営者の LINE にも届く。
 *   準備・確認・後片付けの SQL とセットで使う。実在しない連結アカウント ID（TEST_ACCOUNT）だけを使う。
 *
 * 実行（原が手元で・zsh）:
 *   シークレットはコマンドの行に書かない（シェルの履歴に残るため）。入力を表示しない read で受け取る:
 *     read -s "ECHO_CONNECT_WEBHOOK_SECRET_PROD?secret: " && export ECHO_CONNECT_WEBHOOK_SECRET_PROD
 *     node scripts/send-stripe-alert-test.mjs payout    # ア. payout.failed
 *     node scripts/send-stripe-alert-test.mjs account   # イ. account.updated（true → false）
 *     unset ECHO_CONNECT_WEBHOOK_SECRET_PROD           # 実行後は必ず unset する
 *   シークレットは Stripe ダッシュボードの echo-connect（連結アカウント）の送信先の署名シークレット
 *   （本番の STRIPE_CONNECT_WEBHOOK_SECRET と同じ値）。**台本にもログにも値を出さない。**
 *
 * 注意:
 *   - 署名の時刻は「今」。route の検証は5分（stripe ライブラリの既定 300 秒）まで。作ったらすぐ送る。
 *   - 同じ連結アカウント・同じ種類の通知は24時間に1回まで。24時間以内に流し直すと LINE は届かない
 *     （login_attempts の行を消せば届く）。
 *   - account は、準備の SQL で3つのフラグを true にしてから送る（false のままだと通知されない）。
 */
import Stripe from "stripe";

const ENDPOINT = "https://echo-thanks.jp/api/stripe/webhook/connect";
/** 実在しない試験用の連結アカウント ID（準備の SQL と同じ値にする）。 */
const TEST_ACCOUNT = "acct_TEST_ALERT_20261004";
const SECRET_ENV = "ECHO_CONNECT_WEBHOOK_SECRET_PROD";

const kind = process.argv[2];
if (kind !== "payout" && kind !== "account") {
  console.error("使い方: node scripts/send-stripe-alert-test.mjs <payout|account>");
  process.exit(1);
}

const secret = process.env[SECRET_ENV];
if (!secret) {
  console.error(`環境変数 ${SECRET_ENV} が未設定です（値は表示しません）`);
  process.exit(1);
}

// 試験と分かる一意な ID（日時入り・2回流しても衝突しない）。
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17); // YYYYMMDDHHMMSSmmm
const eventId = `evt_TEST_ALERT_${kind}_${stamp}`;
const created = Math.floor(Date.now() / 1000);

/**
 * route（src/app/api/stripe/webhook/connect/route.ts）が読む項目だけを入れる。
 *   共通: id・type・account（salon_id の解決）・data.object・created／livemode（stripe_events.payload に残すだけ）
 *   payout.failed: data.object.failure_code（金額・口座の情報は route が読まないので入れない）
 *   account.updated: data.object.id・charges_enabled・payouts_enabled・details_submitted・requirements、
 *                    data.previous_attributes.requirements（今回は入れない＝ウは発火しない）
 * livemode は route が判定に使っていない。false にして stripe_events 上で試験と見分けられるようにする。
 */
const event =
  kind === "payout"
    ? {
        id: eventId,
        object: "event",
        type: "payout.failed",
        created,
        livemode: false,
        account: TEST_ACCOUNT,
        data: {
          object: {
            id: `po_TEST_ALERT_${stamp}`,
            object: "payout",
            status: "failed",
            failure_code: "account_closed", // Stripe の実在する payout の失敗コード
          },
        },
      }
    : {
        id: eventId,
        object: "event",
        type: "account.updated",
        created,
        livemode: false,
        account: TEST_ACCOUNT,
        data: {
          object: {
            id: TEST_ACCOUNT,
            object: "account",
            details_submitted: true, // syncAccountFromStripe が上書きする（無いと false になる）
            charges_enabled: false,
            payouts_enabled: false,
            requirements: { currently_due: [], past_due: [], disabled_reason: null },
          },
          previous_attributes: { charges_enabled: true, payouts_enabled: true },
        },
      };

const payload = JSON.stringify(event);
const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });

console.log(`送信: ${event.type} id=${eventId} account=${TEST_ACCOUNT}`);
const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json", "stripe-signature": header },
  body: payload,
});
const body = await res.text();
console.log(`応答: ${res.status}`);
console.log(body);
// 期待: payout → {"received":true,"outcome":"payout_failed_checked"}
//       account → {"received":true,"outcome":"account_synced"}
//       400 invalid_signature はシークレットの取り違えか、署名から5分以上たった。
