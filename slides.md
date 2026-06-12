---
theme: default
title: Rust for Civic Tech
favicon: ./favicon.ico
info: |
  ## Rust for Civic Tech
  Building a civic data platform in Rust: scrapers, pipelines, CLIs, and
  MCP tools for Kenya's parliamentary data.
highlighter: shiki
colorSchema: light
drawings:
  persist: false
transition: slide-left
mdc: true
fonts:
  sans: Inter
  serif: Newsreader
  mono: Fira Code
layout: center
class: text-center
---

<img src="./logo.png" class="w-20 h-20 rounded-full mx-auto mb-6" />

# Rust for Civic Tech

<p class="text-lg text-muted mt-2">
Scraping, structuring, and serving Kenya's parliamentary data, in Rust.
</p>

<div class="mt-12 text-sm text-muted">
<a href="https://collinsmuriuki.xyz">Collins Muriuki</a> ·
<a href="https://github.com/mwananchi-tech">Mwananchi Tech</a>
</div>

<!--
Welcome / housekeeping. Set expectations: this is a tour through three
real, open-source Rust projects that grew into one civic data platform.
-->

---
layout: default
---

# Who Am I

- Software engineer, 6 years of experience
- Backend / Distributed Systems / Developer Tooling focus
- Rustacean since 2020
- Currently building **Mwananchi Tech**, the umbrella org behind
  everything in this talk
- Also an Interview Engineer at **Karat**

<!--
Brief professional intro. Keep this tight, 1-2 minutes max.
-->

---
layout: default
---

# Outside of Work

<v-clicks>

- **Video games**: currently deep into Death Stranding 2: On the Beach
- **Travel**: new places, new people, and as much time outdoors as I
  can get
- **BJJ**: blue belt, occasional competitor

</v-clicks>

<!--
Quick personality slide, helps the room warm up before diving into code.
-->

---
layout: default
---

# What We'll Cover

This talk walks through building a full civic data platform in Rust:

- **Scraping** parliamentary records off live government and mirror websites
- **Structuring** that data through typed pipelines
- **Exposing** it via a CLI for ad-hoc queries
- **Wiring it up** as an MCP server, so AI assistants can reason over it directly

<br>

Every layer is production Rust: real HTML parsing, real async pipelines,
real tooling that runs against messy, inconsistent public data.

<!--
This is the "trailer" slide. Don't dwell, just set up the four acts.
-->

---
layout: default
---

# The Journey

<v-clicks>

1. **Bunge Bits**: transcribing parliament from YouTube livestreams
2. **odnelazm**: a unified scraper for official Hansard transcripts
3. **odnelazm-cli**: ad-hoc queries and exports from the terminal
4. **odnelazm-mcp**: the same data, exposed to AI assistants
5. **odnelazm-ingest**: structuring it all into a database, plus AI enrichment
6. **Bunge Hub**: putting it in front of citizens

</v-clicks>

<!--
Each of these is a separate crate / repo. They were built in this order,
each one solving a limitation of the last.
-->

---
layout: section
---

# Act 1

## Bunge Bits: Transcribing Parliament

---
layout: default
---

# The Problem

- Kenya's National Assembly and Senate livestream sittings on YouTube
- No official transcripts published in anything close to real time
- Goal: turn raw video into searchable summaries, automatically

<!--
Set the scene: before odnelazm existed, the only "live" data was video.
-->

---
layout: default
---

# Architecture: `stream_pulse`

```mermaid
graph LR
  A[YouTube livestream] -->|yt-dlp| B[Audio download]
  B --> C[Chunking config]
  C -->|Whisper| D[Transcription]
  D -->|LLM| E[Summarization]
  E --> F[(Postgres)]
```

A single pipeline: scrape, download, chunk, transcribe, summarize, store.

<!--
Walk through the diagram left to right. Each stage is a trait in the
LiveStreamProcessor we're about to look at.
-->

---
layout: default
class: text-sm
---

# `LiveStreamProcessor`

```rust
#[derive(Debug, Clone)]
pub struct LiveStreamProcessor<D, T, S, A, P>
where
    D: DataStore + Send + Sync + 'static,
    T: Transcriber + Send + Sync + 'static,
    S: Summarizer + Send + Sync + 'static,
    A: AudioHandler + Send + Sync + 'static,
    P: ChannelScraper + Send + Sync + 'static,
{
    workdir: PathBuf,   // local fs dir for audio and transcript artefacts
    store: D,           // data storage layer
    transcriber: T,     // LLM transcription layer
    summarizer: S,      // LLM summarizer layer
    audio_handler: A,   // audio processing layer
    channel_scraper: P, // web scraper layer
    max_streams: usize,
    chunking_config: Option<ChunkingConfig>,
}
```

Five generic traits, five swappable layers.

<!--
Point out: every dependency is a trait bound, not a concrete type. That
means the storage backend, the transcriber, the scraper can all be
swapped or mocked independently.
-->

---
layout: default
class: text-sm
---

# Running the Pipeline

```rust
impl<D, T, S, A, P> LiveStreamProcessor<D, T, S, A, P>
where
    D: DataStore + Send + Sync + 'static,
    T: Transcriber + Send + Sync + 'static,
    S: Summarizer + Send + Sync + 'static,
    A: AudioHandler + Send + Sync + 'static,
    P: ChannelScraper + Send + Sync + 'static,
{
    #[tracing::instrument(skip(self))]
    pub async fn run(self) -> anyhow::Result<()> {
        // scrape -> download audio
        // for each downloaded audio:
        //   use chunking config to decide whole-file vs chunked
        //   -> transcribe -> summarize -> store results to db
        Ok(())
    }
}
```

<v-click>

A `Drop` impl cleans up the working `audio/` directory when the
processor goes out of scope, win or lose.

</v-click>

<!--
Mention RAII cleanup as a nice example of Rust's Drop trait used for
operational hygiene, not just memory safety.
-->

---
layout: two-cols
class: text-xs
---

# Vendoring `yt-dlp`

```rust
// build.rs
fn main() -> Result<(), Box<dyn Error>> {
    let os = env::var("CARGO_CFG_TARGET_OS")?;
    let arch = env::var("CARGO_CFG_TARGET_ARCH")?;

    let filename = match (os.as_str(), arch.as_str()) {
        ("macos", "aarch64") => "yt-dlp_macos",
        ("linux", "x86_64") => "yt-dlp_linux",
        ("windows", _) => "yt-dlp.exe",
        // ...other platforms
        _ => return Err("unsupported".into()),
    };

    // download the binary to OUT_DIR/yt-dlp, then write
    // OUT_DIR/generated.rs:
    let mut f = File::create(out_dir.join("generated.rs"))?;
    writeln!(
        f,
        "pub const YTDLP_BINARY: &[u8] = \
         include_bytes!(\"yt-dlp\");"
    )?;
}
```

::right::

<div class="ml-4">

```rust
// ytdlp.rs
#[cfg(feature = "yt-dlp-vendored")]
include!(concat!(
    env!("OUT_DIR"), "/generated.rs"
));

fn resolve_yt_dlp_binary()
    -> Result<PathBuf, YtDlpError> {
    #[cfg(feature = "yt-dlp-vendored")]
    {
        // write YTDLP_BINARY to a temp
        // file, chmod +x, return path
    }

    #[cfg(not(feature = "yt-dlp-vendored"))]
    which::which("yt-dlp")
        .map_err(|_| YtDlpError::BinaryNotFound(
            "yt-dlp".into()
        ))
}
```

<p class="mt-4 text-muted">
Rationale: ship one binary. No separate
<code>yt-dlp</code> install on the host.
</p>

</div>

<!--
build.rs runs at compile time, picks the right yt-dlp release for the
target platform, and embeds it directly into the final binary via
include_bytes!. At runtime it's written to a temp file and exec'd.
-->

---
layout: default
class: text-sm
---

# CLI: `stream-pulse`

```rust
#[derive(Parser)]
#[command(name = "stream-pulse")]
struct Cli {
    #[arg(long, env = "DATABASE_URL")]
    database_url: String,

    // + openai_key, max_streams, ...

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Run,
    Cron {
        #[arg(long, env = "CRON_SCHEDULE", default_value = "0 0 */4 * * *")]
        schedule: String,
    },
}
```

<!--
Standard clap derive setup. Note env-backed args throughout, this binary
is designed to run unattended in a container.
-->

---
layout: default
class: text-sm
---

# Cron, via Apalis

```rust
async fn handle_tick(_tick: Tick, config: Data<Config>) -> anyhow::Result<()> {
    tracing::info!(max_streams = config.max_streams, "Running scheduled pipeline...");
    run_pipeline(&config).await
}

// in main():
Command::Cron { schedule } => {
    let schedule = Schedule::from_str(&schedule)?;

    let worker = WorkerBuilder::new("stream-pulse-cron")
        .backend(CronStream::new(schedule))
        .retry(RetryPolicy::retries(3))
        .layer(SentryLayer::new())
        .data(config)
        .build(handle_tick);

    worker.run().await?;
}
```

`Cron { .. }` and `Run` share the exact same `run_pipeline` function.

<!--
Apalis is a Rust background-job/cron framework by a fellow Kenyan
developer (Njuguna). Worth a shoutout to the local Rust community here.
-->

---
layout: default
---

# Limitations

<v-clicks>

**LLM layer**

- Whisper can't infer *who* is speaking
- Mangles Kenyan names
- Struggles with Swahili and mixed-language speech
- Costs add up fast, every minute of audio is billed

**Scaling**

- How do we handle more concurrent live streams without linearly
  scaling cost and compute?

</v-clicks>

<!--
This slide is the pivot point for the whole talk: these limitations are
exactly why odnelazm exists.
-->

---
layout: section
---

# Act 2

## odnelazm: From Transcripts to Data

---
layout: default
---

# The Next Chapter

Bunge Bits transcribes audio: lossy, costly, biased toward English.

What if we used the **official transcripts** instead?

<v-clicks>

- Kenya's Parliament publishes Hansards, official transcripts of every sitting
- Hansards go back to **2006**
- Published as PDFs on `.go.ke` sites... and scraping those felt risky
- **mzalendo.com** mirrors them as clean HTML, much easier than OCR on PDFs

</v-clicks>

<br>

<v-click>

Birth of `odnelazm`.

</v-click>

<!--
"odnelazm" is "mzalendo" backwards. The name is a nod to the data source.
-->

---
layout: default
---

# Two Sources, One Cutoff

| Source | Coverage | Format |
|---|---|---|
| `info.mzalendo.com` (archive) | 2006-03-21 → 2025-07-17 | HTML mirror of PDFs |
| `mzalendo.com` (current) | 2013-03-28 → present | Structured HTML |

<br>

Goal: **one unified scraper**, **one schema**, regardless of source.
Coverage overlaps, routing (next slides) treats 2013-03-28 as the
cutoff between them.

<div class="mt-4 text-sm text-muted">

Example sittings:
[current](https://mzalendo.com/democracy-tools/hansard/thursday-30th-april-2026-afternoon-sitting-2513/) ·
[archive](https://info.mzalendo.com/hansard/sitting/national_assembly/2014-08-28-14-30-00)

</div>

<!--
The two sources have completely different HTML structures. Everything
from here on is about hiding that difference behind one API.
-->

---
layout: default
class: text-sm
---

# A Unified Schema

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HansardSitting {
    pub house: House,
    pub date: NaiveDate,
    pub day_of_week: String,
    pub session_type: String,
    pub time: Option<NaiveTime>,
    pub summary: Option<String>,
    pub sentiment: Option<String>,
    pub pdf_url: Option<String>,
    pub sections: Vec<HansardSection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HansardSection {
    pub section_type: String,
    pub subsections: Vec<HansardSubsection>,
    pub contributions: Vec<Contribution>,
}
```

<!--
A sitting is a tree: sitting -> sections -> subsections -> contributions.
Both sources get mapped into this same shape.
-->

---
layout: default
class: text-sm
---

# Subsections, Contributions, Members

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HansardSubsection {
    pub title: String,
    pub contributions: Vec<Contribution>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Contribution {
    pub speaker_name: String,
    pub speaker_url: Option<String>,
    pub content: String,
    pub procedural_notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Member {
    pub name: String,
    pub url: String,
    pub house: House,
    pub role: Option<String>,
    pub constituency: Option<String>,
}
```

<!--
speaker_url is the load-bearing field for linking a Contribution back to
a Member later in the ingest pipeline.
-->

---
layout: default
class: text-sm
---

# Other Scraped Data: `MemberProfile`

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberProfile {
    pub name: String,
    pub slug: String,
    pub photo_url: Option<String>,
    pub biography: Option<String>,
    pub positions: Vec<String>,
    pub party: Option<String>,
    pub committees: Vec<String>,
    pub speeches_total: Option<u32>,
    pub bills: Vec<Bill>,
    pub voting_patterns: Vec<VoteRecord>,
    pub activity: Vec<ParliamentaryActivity>,
}
```

Plus pagination metadata for bills and activity (omitted here).

<!--
This is the data behind each MP's profile page on Bunge Hub: bio,
committees, voting record, sponsored bills.
-->

---
layout: default
class: text-sm
---

# Routing Between Sources

```rust
enum ListingRoute {
    /// Only the archive covers this range.
    Archive,
    /// Only the current source covers this range.
    Current,
    /// The range spans the cutoff: fetch from both and merge.
    Both,
}

impl ListingRoute {
    fn from_dates(start: Option<NaiveDate>, end: Option<NaiveDate>) -> Self {
        let cutoff = current_cutoff(); // 2013-03-28
        match (start, end) {
            (None, None) => ListingRoute::Current,
            (_, Some(end)) if end < cutoff => ListingRoute::Archive,
            (Some(start), _) if start >= cutoff => ListingRoute::Current,
            _ => ListingRoute::Both,
        }
    }
}
```

A plain `match` on an `Option` pair decides the whole routing strategy.

<!--
This little enum is the heart of the unified scraper. Everything else
branches on this.
-->

---
layout: default
class: text-sm
---

# `HansardScraper`: the Facade

```rust
pub struct HansardScraper {
    archive: ArchiveScraper,
    current: CurrentScraper,
}

impl HansardScraper {
    pub async fn list_sittings(&self, opts: SittingListOptions)
        -> Result<Vec<HansardListing>, ScraperError> {
        match ListingRoute::from_dates(opts.start_date, opts.end_date) {
            ListingRoute::Archive => self.fetch_archive_listings(opts).await,
            ListingRoute::Current => self.current.fetch_all_sittings(opts.house).await,
            ListingRoute::Both => {
                let (archive, current) = future::join(
                    self.fetch_archive_listings(opts),
                    self.current.fetch_all_sittings(opts.house),
                ).await;
                merge_and_sort(archive?, current?)
            }
        }
    }
}
```

`get_sitting` follows the same pattern: detect the source from the URL shape, then delegate.

<!--
future::join runs both fetches concurrently on one task, no extra
threads. This is the payoff of async Rust for I/O-bound scraping.
-->

---
layout: default
class: text-sm
---

# CLI: Exporting Data

```bash
# Recent sittings (current source, page 1)
odnelazm sittings

# Archive sittings from 2010
odnelazm sittings --start-date 2010-01-01 --end-date 2010-12-31

# Cross-era range: archive + current, merged
odnelazm sittings --start-date 2012-01-01 --end-date 2014-12-31 --limit 50

# Filter by house, all pages, JSON output
odnelazm sittings --house senate --all -o json

# Members
odnelazm all-members 12th-parliament -o json

# Member profile, with full activity and bills
odnelazm profile <member-url> --all-activity --all-bills -o json
```

Output as a table, JSON, Parquet, or CSV (Parquet/CSV for future
Hugging Face dataset exports).

<!--
Same clap setup as stream-pulse, but with more output format options.
-->

---
layout: default
---

# The Fun Part: an MCP Server

- Wrap the scraper API as **tools** an LLM can call directly
- Crate: [`rmcp`](https://github.com/modelcontextprotocol/rust-sdk),
  the official Rust MCP SDK
- Same `HansardScraper`, now driven by an AI client instead of a CLI

<br>

With this, an LLM can fetch sittings, members, and member profiles
straight from a prompt.

<!--
Bridge slide: everything we've built so far (scraper, schema, routing)
is reused as-is. MCP is just a new "frontend" for the same scraper.
-->

---
layout: default
class: text-xs
---

# `McpServer`

```rust
#[derive(Debug, Clone)]
pub struct McpServer {
    scraper: HansardScraper,
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl McpServer {
    #[tool(
        name = "get_sitting",
        description = "Fetch a sitting: sections, subsections, \
                        contributions, and procedural notes."
    )]
    pub async fn get_sitting(
        &self,
        Parameters(params): Parameters<GetSittingParams>,
    ) -> Result<String, McpError> { /* ... */ }

    // + list_sittings, list_members, get_all_members, get_member_profile
}
```

<!--
The #[tool_router] and #[tool] macros come from rmcp. Each tool's
description is itself sent to the LLM, so it doubles as documentation.
-->

---
layout: default
---

# MCP: Current Limitations

<v-clicks>

- **Scrapes on demand**: every MCP call hits the live site directly
- **Context overload**: a full sitting as JSON can be huge
- Querying a wide date range can blow past a model's context window

**Workarounds**

- Interact with 1-2 (at most 3) sittings at a time
- Use a model with a large context window (1M tokens)
- Once it's in Postgres (next section), MCP tools could query the
  database directly instead of re-scraping

</v-clicks>

<!--
Honest "what's not solved yet" slide. Sets up future work later in the
talk (issue #76 on bulk operations is related in spirit). The last
bullet is the natural segue into Act 3: the data this MCP server
scrapes live ends up in a database anyway.
-->

---
layout: section
---

# Act 3

## odnelazm-ingest: Storing It All

---
layout: default
---

# From Scraped Data to a Database

<v-clicks>

- Store member profiles
- Build associations:
  - Sitting ↔ Bills
  - Sitting ↔ Topics
  - Sitting ↔ Speakers
  - Speakers ↔ Member profiles
- Built around a storage **trait**: swap the backend without touching
  the pipeline

</v-clicks>

<!--
This is the layer that turns a stream of scraped JSON into a relational
graph that Bunge Hub can query.
-->

---
layout: default
---

# Data Associations

```mermaid
graph TD
  Sitting <--> Bills
  Sitting <--> Topics
  Sitting <--> Speakers
  Speakers <-->|URL + fuzzy name match| Members
  Bills <-->|sponsor link| Members
  Topics <--> Members
```

Every sitting becomes a node connected to bills, topics, and the people
who spoke, queryable from any direction.

<!--
This graph is what powers Bunge Hub's member profile pages: "show me
every bill this MP sponsored and every sitting they spoke in."
-->

---
layout: default
class: text-sm
---

# The `DataStore` Trait

```rust
pub trait DataStore: Send + Sync {
    async fn migrate(&self) -> Result<()>;

    // Sittings
    async fn upsert_sitting(&self, sitting: &HansardSitting) -> Result<Uuid>;
    async fn list_ingested_urls(&self) -> Result<Vec<String>>;

    // Speakers, bills, topics, and their associations
    async fn upsert_speaker(&self, speaker: &SpeakerRecord) -> Result<Uuid>;
    async fn link_speaker_to_sitting(&self, speaker_id: Uuid, sitting_id: Uuid, count: u32) -> Result<()>;
    async fn upsert_bill(&self, bill: &BillRecord) -> Result<Uuid>;
    async fn upsert_topic(&self, topic: &TopicRecord) -> Result<Uuid>;

    // Members
    async fn upsert_member(&self, member: &MemberRecord) -> Result<Uuid>;
    async fn link_speakers_to_members(&self, parliament: &str) -> Result<u64>;

    // ... + AI-generated summary storage for the enrich step
}
```

One implementation today: `PostgresStore`, using `sqlx`.

<!--
link_speakers_to_members is doing real work under the hood: trigram
fuzzy matching via Postgres pg_trgm to link a speaker name like "Hon.
Member (Constituency, Party)" back to a member record.
-->

---
layout: default
class: text-sm
---

# `IngestPipeline`

```rust
pub struct IngestPipeline<S: DataStore> {
    scraper: HansardScraper,
    store: S,
    embedder: Option<Arc<dyn Embedder>>,
    pub summarizer: Option<Arc<dyn Summarizer>>,
    pub metrics: Option<Arc<dyn MetricsSink>>,
}

impl<S: DataStore> IngestPipeline<S> {
    /// Ingest a single fully-fetched sitting. All other ingest methods
    /// funnel through here.
    async fn ingest_sitting(&self, sitting: HansardSitting) -> Result<IngestStats> {
        let sitting_id = self.store.upsert_sitting(&sitting).await?;

        for (speaker, count) in extract_speakers(&sitting) {
            let id = self.store.upsert_speaker(&speaker).await?;
            self.store.link_speaker_to_sitting(id, sitting_id, count).await?;
        }
        // ... bills and topics follow the same extract -> upsert -> link shape

        Ok(stats)
    }
}
```

`ingest_all_sittings`, `ingest_sittings_in_range`, and `ingest_members`
all call this one method.

<!--
Note this is currently one row at a time. There's an open issue to batch
these writes with UNNEST-based bulk upserts, good example of "it works,
here's the next optimization."
-->

---
layout: default
class: text-sm
---

# CLI: Running the Pipeline

```bash
# Ingest everything
odnelazm-pipeline ingest

# Ingest a date range, skip member import
odnelazm-pipeline ingest --start-date 2026-01-01 --end-date 2026-03-31 --skip-members

# Also enrich member profiles (bio, photo, committees, voting record)
odnelazm-pipeline ingest --enrich-members

# Custom database
odnelazm-pipeline --database-url postgres://user:pass@host/db ingest
```

Designed to run unattended, metrics pushed to Prometheus via
`--metrics-url`.

<!--
This is the binary that, in production, would run on a schedule (the
apalis-cron pattern from Act 1, coming back full circle).
-->

---
layout: section
---

# Act 4

## AI Enrichment, Sustainably

---
layout: default
---

# Bringing LLMs Back, Carefully

Bunge Bits ran on cloud LLMs for transcription and summarization.

<v-clicks>

- Cloud LLMs are expensive at scale: hours of audio, every day, billed
  per token
- No funding model meant the costs were unsustainable long term
- AI-generated transcripts as the *source of truth* proved fragile,
  official Hansards are a far better foundation
- But summarization itself, layered on top of real transcripts, is
  still genuinely useful

</v-clicks>

<!--
Direct callback to the "Limitations" slide in Act 1. The problem was
never "LLMs are bad", it was "LLMs as the source of truth, running
continuously on rented GPUs, is bad."
Reference: collinsmuriuki.xyz/from-bunge-bits-to-bunge-hub/
-->

---
layout: default
---

# A Sustainable Enrichment Strategy

<v-clicks>

- Run models **locally** via [LM Studio](https://lmstudio.ai), on
  consumer hardware
- No cloud API bills, no per-token meter running
- Trade-off accepted: throughput is slower
- Every summary records **which model** generated it, so re-enrichment
  later with a better model is just another batch job

</v-clicks>

<!--
Framing: enrichment is a background job, not a live request path. Slow
and local is fine when there's no deadline.
-->

---
layout: default
class: text-sm
---

# Enrichment Targets

```rust
#[derive(ValueEnum, Clone)]
enum EnrichTarget {
    BillMentions,  // a bill's appearance within one sitting
    BillJourneys,  // a bill's full journey across all sittings
    BillSpeakers,  // a member's remarks on a bill, in one sitting
    Topics,        // a topic's appearance within one sitting
    TopicSpeakers, // a member's remarks on a topic, in one sitting
    Sittings,      // a rich summary of the whole sitting
}
```

Six targets, one shape: find pending rows, prompt the model, store the
summary along with the model name.

<!--
This enum is the `target` argument to `odnelazm-pipeline enrich`.
-->

---
layout: default
class: text-sm
---

# One Target Up Close: Bill Mentions

```rust
/// A bill_mention row needing a node-level summary. Carries the full
/// sitting transcript as JSON for context.
pub struct PendingBillAppearanceSummary {
    pub bill_mention_id: Uuid,
    pub bill_name: String,
    pub bill_number: Option<String>,
    pub stage: Option<String>,
    pub section_title: String,
    pub date: NaiveDate,
    pub house: String,
    pub session_type: String,
    pub sitting_raw_json: serde_json::Value,
}
```

One row per bill, per sitting it appears in: "here's everything that
happened in this sitting, write up how this bill featured in it."

See it live: [a bill's journey on Bunge
Hub](https://bunge-hub.mwananchi.tech/bills/845fbb90-4d9f-45e0-bfb8-99186aeb32df),
built from these per-sitting summaries.

<!--
This is the foundational, per-sitting target. Bill journeys, topics, and
others build on top of this node-level work. Pull up the live page if
possible, point out the per-sitting summaries feeding the journey.
-->

---
layout: default
---

# Picking the Right Model per Target

<v-clicks>

- **`bill-mentions`** → `qwen3.5-9b`, a reasoning model
  - Context is the full sitting: a bigger context window, strong
    instruction-following, and more substantial summaries pay off here
- **`bill-speakers`** and **`topic-speakers`** → `google/gemma-4-e2b`
  - Context is scoped to just that bill's or topic's mentions, so a
    smaller, lighter-reasoning model handles it well
- Right-size the model to the target: reasoning where context is broad,
  fast and light where context is narrow

</v-clicks>

<!--
This is the cost/quality trade-off in practice: pay for a bigger model
and its bigger context window only where it earns its keep.
-->

---
layout: default
class: text-sm
---

# `Summarizer`: Another Trait Boundary

```rust
/// Generate a brief summary from a prompt. Implement this trait with
/// your preferred LLM provider.
#[async_trait]
pub trait Summarizer: Send + Sync {
    async fn summarize(&self, prompt: &str) -> Result<String>;
}
```

```rust
pub struct LmStudioSummarizer {
    client: Client,
    base_url: String, // e.g. http://127.0.0.1:1234
    model: String,    // e.g. "google/gemma-4-e4b"
    temperature: Option<f32>,
    metrics: Option<Arc<dyn MetricsSink>>,
}

#[async_trait]
impl Summarizer for LmStudioSummarizer {
    async fn summarize(&self, prompt: &str) -> Result<String> {
        self.complete(prompt).await // POST to LM Studio's /api/v1/chat
    }
}
```

Same trait-based pattern as `DataStore`: today it's LM Studio, tomorrow
it could be any local or hosted model.

---
layout: default
class: text-sm
---

# The Enrichment Loop

```rust
async fn run_bill_mentions(&self, store: &PostgresStore, summarizer: &dyn Summarizer) {
    loop {
        let pending = store.pending_bill_appearance_summaries(self.batch).await?;
        if pending.is_empty() {
            break;
        }

        for chunk in pending.chunks(self.concurrency) {
            let tasks = chunk.iter().map(|p| async move {
                let prompt = prompts::bill_appearance_prompt(p);
                (p.bill_mention_id, summarizer.summarize(&prompt).await)
            });

            for (id, result) in future::join_all(tasks).await {
                if let Ok(summary) = result {
                    store.store_bill_appearance_summary(id, &summary, &self.model).await.ok();
                }
            }
        }
    }
}
```

Fetch a batch, fan out `concurrency` requests to the local model,
persist, repeat until nothing is pending.

---
layout: default
class: text-sm
---

# CLI: Running Enrichment

```bash
# Summarize a bill's appearance in a sitting (full transcript context)
odnelazm-pipeline enrich bill-mentions --model qwen3.5-9b

# Summarize a member's remarks on a bill, one sitting at a time
odnelazm-pipeline enrich bill-speakers --model google/gemma-4-e2b

# Point at a local LM Studio server, tune batching and concurrency
odnelazm-pipeline enrich sittings \
  --llm-url http://127.0.0.1:1234 \
  --model qwen/qwen3-30b \
  --batch 5 \
  --concurrency 2
```

Same `odnelazm-pipeline` binary as ingestion, run as a separate,
unhurried batch job.

<!--
This is the full-circle moment: Act 1 ended with "LLMs don't scale for
this." Act 4 shows how they come back, on different terms.
-->

---
layout: section
---

# Act 5

## Bunge Hub: Putting It in Front of People

---
layout: default
---

# Bunge Hub

<img src="./logo.png" class="w-12 h-12 rounded-full float-right" />

The public face of all this data.

- Browse sittings, bills, topics, and members
- Search across sittings, bills, and topics
- Same data pipeline from Acts 2 and 3, now in front of citizens

<div class="mt-12 text-sm text-muted">
<a href="https://bunge-hub.mwananchi.tech">bunge-hub.mwananchi.tech</a>
</div>

<!--
Live demo time. Show a sitting page, a bill page, and a member profile
to tie everything back to the data structures from earlier slides.
-->

---
layout: default
---

# Closing the Loop: Bunge Bits, Locally

<v-clicks>

- Bunge Bits is still useful: it can surface summaries within hours,
  official Hansards take 1-2 weeks to publish
- Act 1 ended on the cost of cloud Whisper and cloud LLMs as the
  limiting factor
- Act 4 showed local models are good enough for enrichment, on
  consumer hardware
- Next: bring that back to Bunge Bits itself, local Whisper for
  transcription, local LLMs for summaries

</v-clicks>

<!--
The actual full-circle moment: take what Act 4 proved about local
models and apply it back to where the talk started.
-->

---
layout: default
---

# What's Next

<v-clicks>

- **Bulk writes** for ingest and enrich: fewer round trips, faster backfills
- **Scheduled ingestion** via apalis-cron: keep Bunge Hub fresh automatically
- Export to Hugging Face datasets (Parquet/CSV)
- **Enrichment is ongoing**: bill summaries and topic-mentions still have
  a backlog of pending rows
- **Bunge Bits revival**: local Whisper and local LLMs, as covered a
  moment ago

</v-clicks>

<v-click>

<div class="mt-8 text-sm text-muted">
Anyone can run <code>odnelazm-pipeline enrich</code>. Want to help chip
away at the backlog? Come talk to me and I'll share database access.
</div>

</v-click>

<!--
These map directly to open issues on the odnelazm and bunge-hub repos,
good "come contribute" pointer if the audience is interested. The
enrichment backlog is a low-friction way to contribute: no Rust
knowledge needed, just compute and a local LM Studio instance.
-->

---
layout: default
---

# Why Rust for Civic Tech?

<v-clicks>

- **Traits** decouple scraping, storage, and transcription, so any layer
  can be swapped or mocked
- **Async** lets us scrape, transcribe, and ingest concurrently
- **Type safety** tames messy, inconsistent government HTML
- **Single static binaries**: easy to deploy, easy to run as a cron job

</v-clicks>

<!--
This is the "thesis" of the talk, stated explicitly. Tie each bullet
back to a concrete slide from earlier (LiveStreamProcessor, ListingRoute,
the typed schema, build.rs).
-->

---
layout: center
class: text-center
---

# Thank You

<div class="mt-4 text-muted">

[github.com/mwananchi-tech](https://github.com/mwananchi-tech)

Bunge Bits · odnelazm · Bunge Hub

</div>

<div class="mt-12">
Questions?
</div>

<!--
Leave this slide up during Q&A.
-->
