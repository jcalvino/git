# Database Schema — PostgreSQL 16 + pgvector (Hybrid-Fetch)

Prisma as ORM. All enums and numeric precisions chosen to make the
deterministic math reproducible to the cent (`Decimal(12,2)` for money).

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy dedup
CREATE EXTENSION IF NOT EXISTS unaccent;   -- freguesia match
CREATE EXTENSION IF NOT EXISTS postgis;    -- ARU polygons
```

---

## 1. Reference / seed tables (read-mostly)

### 1.1 `tax_brackets` — seeded from TAX_RULES_PT.md

```prisma
enum Use { HPP INVESTMENT }

model TaxBracket {
  id            Int      @id @default(autoincrement())
  use           Use
  ceilingEUR    Decimal  @db.Decimal(12, 2)
  ratePct       Decimal  @db.Decimal(6, 4)
  deductionEUR  Decimal  @db.Decimal(12, 2)
  isFlat        Boolean  @default(false)
  validFrom     DateTime
  validTo       DateTime?
  source        String                         // "OE2026"

  @@index([use, validFrom, validTo])
}
```

Seed rows exactly match [TAX_RULES_PT.md §1.1 / §1.2](TAX_RULES_PT.md).

### 1.2 `regions` — NUTS III → concelho → freguesia

```prisma
model Region {
  id              Int      @id @default(autoincrement())
  freguesia       String
  concelho        String
  distrito        String
  nutsIii         String
  imiRatePct      Decimal  @db.Decimal(6, 4)  // override, default 0.0038
  medianPriceM2   Decimal? @db.Decimal(10, 2)
  medianRentM2    Decimal? @db.Decimal(10, 2)
  p10PriceM2      Decimal? @db.Decimal(10, 2)
  p90PriceM2      Decimal? @db.Decimal(10, 2)
  escrituraM2     Decimal? @db.Decimal(10, 2) // AT "Valor de Escritura"
  lastRefresh     DateTime?

  @@unique([freguesia, concelho])
  @@index([concelho])
}
```

### 1.3 `aru_zones` — PostGIS polygons

```sql
CREATE TABLE aru_zones (
  id         SERIAL PRIMARY KEY,
  concelho   TEXT NOT NULL,
  freguesia  TEXT,
  label      TEXT,
  polygon    GEOMETRY(MultiPolygon, 4326) NOT NULL,
  source_url TEXT,
  valid_from DATE NOT NULL
);
CREATE INDEX aru_zones_poly_gix ON aru_zones USING GIST (polygon);
```

Property is "in ARU" if its point falls inside any polygon. Missing
geocode → `false` (worst case: 23% IVA).

### 1.4 `mortgage_rates`

```prisma
model MortgageRate {
  id          Int      @id @default(autoincrement())
  bank        String
  euriborTerm String                           // "6M" | "12M"
  euriborPct  Decimal  @db.Decimal(6, 4)
  spreadPct   Decimal  @db.Decimal(6, 4)
  totalPct    Decimal  @db.Decimal(6, 4)
  snapshotAt  DateTime @default(now())

  @@index([snapshotAt])
}
```

### 1.5 `source_policies` — **runtime fetch gate** (hybrid mode)

Every fetch call reads this table. See [LEGAL.md](LEGAL.md).

```prisma
enum Source    { IDEALISTA IMOVIRTUAL CASA_SAPO CASAYES QUATRU }
enum FetchMode { ON_DEMAND API AGGREGATOR }

model SourcePolicy {
  source               Source   @id
  host                 String   @unique              // "www.idealista.pt"
  fetchMode            FetchMode
  allowedRps           Float                         // e.g. 0.167 = 1 req / 6 s
  dailyCap             Int                           // for AGGREGATOR
  userAgent            String                        // honest, identifies tool
  robotsTxtLastChecked DateTime?
  tosReviewUrl         String?                       // required when AGGREGATOR
  partnerApiKey        String?                       // required when API
  disabledUntil        DateTime?                     // circuit breaker
  disabledReason       String?
  notes                String?
  updatedAt            DateTime @updatedAt

  @@index([fetchMode])
}
```

Seed (Phase 0):

| source | host | fetchMode | allowedRps | dailyCap |
|---|---|---|---|---|
| IDEALISTA | www.idealista.pt | ON_DEMAND | 0.1 | 0 |
| IMOVIRTUAL | www.imovirtual.com | ON_DEMAND | 0.1 | 0 |
| CASA_SAPO | casa.sapo.pt | ON_DEMAND | 0.167 | 0 |
| CASAYES | casayes.pt | ON_DEMAND | 0.167 | 0 |
| QUATRU | quatru.pt | ON_DEMAND | 0.167 | 0 |

`dailyCap = 0` means "no scheduled crawl"; only user-initiated fetches
are allowed.

---

## 2. Core tables

### 2.1 `properties`

```prisma
enum Cert     { APLUS A B BMINUS C D E F G UNKNOWN }
enum CondLevel { L1_COSMETIC L2_STANDARD L3_STRUCTURAL UNKNOWN }

model Property {
  id             String   @id @default(cuid())
  source         Source
  sourceId       String                         // from source or derived
  sourceUrl      String   @unique
  firstSeenAt    DateTime @default(now())
  lastSeenAt     DateTime @default(now())
  fetchMode      FetchMode                       // how it was fetched
  active         Boolean  @default(true)

  // canonical fields
  priceEUR       Decimal  @db.Decimal(12, 2)
  areaM2         Decimal  @db.Decimal(8, 2)
  typology       String                          // T0..T5+
  bedrooms       Int?
  bathrooms      Int?
  floor          String?
  yearBuilt      Int?
  condition      CondLevel @default(UNKNOWN)
  energyCert     Cert      @default(UNKNOWN)

  // location
  regionId       Int
  region         Region   @relation(fields: [regionId], references: [id])
  address        String?
  lat            Decimal? @db.Decimal(10, 7)
  lng            Decimal? @db.Decimal(10, 7)
  isInARU        Boolean  @default(false)

  // raw content (retention-bounded)
  rawTitle       String
  rawDescription String
  rawFeatures    Json
  rawImages      String[]
  rawHtmlKey     String?                         // MinIO/S3 key
  rawExpiresAt   DateTime                        // 30d ON_DEMAND / 90d AGGREGATOR

  // dedup
  fingerprint    String                          // hash(address, area, price-bucket)

  snapshots      PropertySnapshot[]
  analyses       Analysis[]
  embedding      PropertyEmbedding?

  @@index([regionId])
  @@index([fingerprint])
  @@index([source, sourceId])
  @@index([priceEUR])
  @@index([rawExpiresAt])                        // retention job scan
}
```

### 2.2 `property_snapshots`

```prisma
model PropertySnapshot {
  id          BigInt   @id @default(autoincrement())
  propertyId  String
  property    Property @relation(fields: [propertyId], references: [id])
  priceEUR    Decimal  @db.Decimal(12, 2)
  active      Boolean
  capturedAt  DateTime @default(now())

  @@index([propertyId, capturedAt])
}
```

### 2.3 `analyses`

```prisma
model Analysis {
  id             String   @id @default(cuid())
  propertyId     String
  property       Property @relation(fields: [propertyId], references: [id])
  use            Use
  ltv            Decimal  @db.Decimal(4, 2)
  annualRatePct  Decimal  @db.Decimal(6, 4)
  years          Int

  imtEUR         Decimal  @db.Decimal(12, 2)
  isAcquisition  Decimal  @db.Decimal(12, 2)
  isMortgage     Decimal  @db.Decimal(12, 2)
  capexEUR       Decimal  @db.Decimal(12, 2)
  realEntryCost  Decimal  @db.Decimal(12, 2)
  totalAcqCost   Decimal  @db.Decimal(12, 2)
  grossYieldPct  Decimal  @db.Decimal(6, 4)
  netYieldPct    Decimal  @db.Decimal(6, 4)
  cashOnCashPct  Decimal  @db.Decimal(6, 4)
  flipRisk       Int                              // 1–10
  rentRisk       Int                              // 1–10
  recommended    String                           // FLIP | RENT | AVOID
  confidence     Decimal  @db.Decimal(4, 3)
  redFlags       String[]
  reasoning      String
  summaryJson    Json

  financeHash    String                           // hash of inputs → cache key
  advisorDegraded Boolean @default(false)
  createdAt      DateTime @default(now())

  @@unique([propertyId, financeHash])
  @@index([propertyId])
}
```

---

## 3. Vector memory (pgvector)

### 3.1 `property_embeddings`

```sql
CREATE TABLE property_embeddings (
  property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,                   -- "voyage-3-large"
  vector      VECTOR(1024) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX property_embeddings_ivf
  ON property_embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);
```

### 3.2 `user_preferences`

```sql
CREATE TABLE user_preferences (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vector     VECTOR(1024) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Preference vector is recomputed on save/reject (EMA: +1 save, −1 reject).

### 3.3 `region_trends`

```prisma
model RegionTrend {
  id             BigInt   @id @default(autoincrement())
  regionId       Int
  weekStart      DateTime @db.Date
  medianPriceM2  Decimal  @db.Decimal(10, 2)
  medianRentM2   Decimal? @db.Decimal(10, 2)
  listingsCount  Int
  medianDom      Int?

  @@unique([regionId, weekStart])
  @@index([regionId, weekStart])
}
```

---

## 4. Users & watchlist

```prisma
model User {
  id          String   @id @default(cuid())
  email       String   @unique
  createdAt   DateTime @default(now())
  profileJson Json?
  watches     Watch[]
}

model Watch {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  propertyId String
  property   Property @relation(fields: [propertyId], references: [id])
  notifyOn   Json                                 // { priceDropPct: 5 }
  createdAt  DateTime @default(now())

  @@unique([userId, propertyId])
}
```

---

## 5. Operational tables

### 5.1 `fetch_runs` — every fetch attempt (ON_DEMAND, API, AGGREGATOR)

```prisma
model FetchRun {
  id            BigInt   @id @default(autoincrement())
  source        Source
  mode          FetchMode
  targetUrl     String
  startedAt     DateTime @default(now())
  finishedAt    DateTime?
  httpStatus    Int?
  bytesDownloaded Int?
  captchaSeen   Boolean  @default(false)
  error         String?
  userId        String?                           // when ON_DEMAND
  propertyId    String?

  @@index([source, startedAt])
  @@index([mode, startedAt])
}
```

### 5.2 `llm_calls` — cost telemetry

```prisma
model LlmCall {
  id            BigInt   @id @default(autoincrement())
  agent         String                            // "normalizer" | "advisor" | "benchmark"
  model         String
  inputTokens   Int
  cachedTokens  Int
  outputTokens  Int
  costEUR       Decimal  @db.Decimal(10, 4)
  latencyMs     Int
  analysisId    String?
  createdAt     DateTime @default(now())

  @@index([createdAt])
  @@index([agent, createdAt])
}
```

### 5.3 `api_request_log` — rate-limit & debug

```prisma
model ApiRequestLog {
  id         BigInt   @id @default(autoincrement())
  userId     String?
  path       String
  status     Int
  latencyMs  Int
  createdAt  DateTime @default(now())

  @@index([createdAt])
  @@index([userId, createdAt])
}
```

---

## 6. Invariants enforced at DB level

- `properties.fingerprint` is deterministic and unique per canonical
  identity (normalized address + area bucket + price bucket) → cross-source dedup.
- `analyses` keyed by `(propertyId, financeHash)` → deterministic cache.
- All money columns are `Decimal(12,2)` — never `float`.
- `tax_brackets.validFrom/validTo` means the engine picks the bracket set
  active **on the date of the analysis**, not today.
- **No row in `fetch_runs` exists without a matching `source_policies` row
  whose `fetchMode` permitted the call at that moment** (enforced by
  application code; `fetch_runs.mode` must equal `source_policies.fetchMode`
  at run-time).
- `properties.rawExpiresAt` drives the nightly retention job — expired
  raws are purged from MinIO and the `rawHtmlKey` set to `NULL`.
- `disabledUntil` on `source_policies` is the only way to pause a source;
  application reads it on every fetch.

---

## 7. Retention job (nightly)

```ts
// packages/db/src/retention.ts
await db.property.updateMany({
  where: { rawExpiresAt: { lt: new Date() }, rawHtmlKey: { not: null } },
  data:  { rawHtmlKey: null },
});
// then: MinIO lifecycle rule deletes the object after 1 day
```

`llm_calls` older than 12 months → hard delete (telemetry only, no payloads).
`api_request_log` older than 90 days → hard delete.
