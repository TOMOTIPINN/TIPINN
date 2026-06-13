# echo データモデル（ERD）

> MVPの8テーブル。詳細な制約・RLS方針は CLAUDE.md を参照。

```mermaid
erDiagram
  CUSTOMERS ||--o{ EARNED_STAMPS : holds
  CUSTOMERS ||--o{ REVIEWS : sends
  CUSTOMERS ||--o{ RATING_PURCHASES : pays
  SALONS ||--o{ STAFF : employs
  SALONS ||--o{ EARNED_STAMPS : issues
  SALONS ||--o{ REVIEWS : receives
  SALONS ||--o{ RATING_PURCHASES : sells
  SALONS ||--o{ REWARDS : offers
  STAFF ||--o{ REVIEWS : about
  STAFF ||--o{ RATING_PURCHASES : credited
  REVIEWS ||--o| RATING_PURCHASES : may_attach
  CUSTOMERS {
    uuid id PK
    string line_user_id
    string display_name
    timestamp created_at
  }
  SALONS {
    uuid id PK
    string name
    string logo_url
    string stripe_account_id
  }
  STAFF {
    uuid id PK
    uuid salon_id FK
    string name
    string photo_url
  }
  REVIEWS {
    uuid id PK
    uuid customer_id FK
    uuid salon_id FK
    uuid staff_id FK
    text body
    timestamp created_at
  }
  RATING_PURCHASES {
    uuid id PK
    uuid customer_id FK
    uuid salon_id FK
    uuid staff_id FK
    uuid review_id FK
    string tier
    int amount
    string stripe_payment_id
    timestamp created_at
  }
  EARNED_STAMPS {
    uuid id PK
    uuid customer_id FK
    uuid salon_id FK
    int count
  }
  REWARDS {
    uuid id PK
    uuid salon_id FK
    int required_count
    string title
  }
```

## 注意（絶対原則の再掲・詳細はCLAUDE.md）
- RATING_PURCHASES（評価スタンプ・有償）と EARNED_STAMPS（貯まるスタンプ・無償）は別テーブル。統合しない。
- RATING_PURCHASES に残高・チャージ・繰越カラムを作らない（買い切りの記録のみ）。
- EARNED_STAMPS は count のみ。金額に換算しない。
- STAFF は評価対象であって金銭の受取人ではない。
