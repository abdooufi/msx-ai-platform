# MSX AI Platform

Production-ready AI chatbot for the Muscat Stock Exchange (www.msx.om) — RAG pipeline, Arabic/English, streaming chat, live market data, admin dashboard, embeddable widget, Telegram channel.

## Architecture

```
Browser ──► Nginx (:90) ──► Frontend (Next.js 14)
                        └──► Backend  (NestJS)  ──► PostgreSQL (companies, FAQs, knowledge, conversations)
                                                 ──► Qdrant    (vector search)
                                                 ──► Redis     (job queue + answer/API cache)
                                                 ──► Ollama    (LLM + embeddings, local)
                                                 ──► DeepSeek / Claude (optional cloud LLMs)
Telegram ──► /api/channels/telegram/webhook ─────┘
```

## Quick Start

### 1. Prerequisites
- Docker Desktop 24+
- 16 GB RAM recommended
- GPU optional (CPU works, slower)

### 2. Setup

```bash
git clone <repo>
cd msx-ai-platform
cp .env.example .env        # edit .env — JWT_SECRET is required
```

By default the backend expects PostgreSQL and Ollama on the **host machine**
(`host.docker.internal`). For a fully self-contained deployment use the
`postgres` and `ollama` containers from docker-compose.yml and set in `.env`:

```
CHATBOOT_PG_HOST=postgres
OLLAMA_URL=http://ollama:11434
```

### 3. Pull the models (once)

```bash
docker compose up ollama -d
docker compose exec ollama ollama pull qwen2.5:7b
docker compose exec ollama ollama pull nomic-embed-text
```

### 4. Start everything

```bash
docker compose up -d --build
```

Services (nginx listens on port **90**):
- **Chat UI**: http://localhost:90
- **Admin Panel**: http://localhost:90/admin  (admin@msx.om / ChangeMeNow123!)
- **API Docs**: http://localhost:90/docs  (dev mode only)
- **Qdrant UI**: http://localhost:6333/dashboard

### 5. Start initial training

1. Open **Admin → Training**
2. Click **Start Crawl** to index www.msx.om
3. Upload PDFs/DOCX in **Admin → Documents**
4. Index the PG tables (companies, FAQs, knowledge base) via **Admin → Training → Index All**

---

## Configuration (.env)

See [.env.example](.env.example) for the full annotated list. Key variables:

| Variable | Description | Default |
|---|---|---|
| `JWT_SECRET` | **Required.** Auth signing key | — |
| `AI_PROVIDER` | `ollama` \| `deepseek` \| `claude` \| `auto` | `ollama` |
| `LLM_MODEL` | Ollama model name | `qwen2.5:7b` |
| `EMBEDDING_MODEL` | Embedding model | `nomic-embed-text` |
| `QDRANT_COLLECTION_SIZE` | Vector dimensions (must match embedding model) | `768` |
| `RAG_TOP_K` | Retrieved chunks per query | `5` |
| `RAG_SCORE_THRESHOLD` | Minimum chunk similarity | `0.4` |
| `RAG_HARD_THRESHOLD` | Below this top score → refuse to answer | `0.55` |
| `ANSWER_CACHE_TTL` | Cache repeated static answers (seconds, 0 = off) | `600` |
| `CHATBOOT_PG_HOST` | PostgreSQL host | `host.docker.internal` |
| `SCRAPER_RECRAWL_HOURS` | Auto-recrawl interval | `24` |
| `TELEGRAM_BOT_TOKEN` | Enables the Telegram channel | — |

## Arabic retrieval quality (recommended)

The default `nomic-embed-text` model is English-focused. Since MSX users ask in
Arabic, a multilingual embedding model gives noticeably better retrieval:

```bash
docker compose exec ollama ollama pull bge-m3
```

Then in `.env`:

```
EMBEDDING_MODEL=bge-m3
QDRANT_COLLECTION_SIZE=1024
```

Restart the backend and **re-index everything** (Admin → Training → Index All +
re-crawl). Vectors from different models are not compatible — the backend logs a
warning if it detects mixed-model vectors.

## Changing the LLM Model

```bash
docker compose exec ollama ollama pull <model>
# .env: LLM_MODEL=<model>
docker compose restart backend
```

Or switch providers live from **Admin → Settings → AI Provider**
(Ollama / DeepSeek / Claude / Auto).

## Chat pipeline

Each message goes through, in order:

1. **Language detection** (Arabic / English / mixed)
2. **Human-handoff detection** — "talk to a person" → contact info + logged for the support team
3. **Off-topic guard** — non-finance questions are refused without an LLM call
4. **FAQ exact match** — answered straight from the `faqs` table, no LLM
5. **Answer cache** — repeated static questions are replayed from Redis
6. **RAG retrieval** (Qdrant) + **live market data** (MSX APIs) in parallel
7. **Confidence gates** — no data or low score → honest refusal, question logged to *Admin → Unanswered*
8. **Chart fast-path** — chart requests return structured data for the frontend renderer
9. **LLM streaming** over SSE, then persistence + analytics

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat` | Streaming chat (SSE) |
| `POST` | `/api/chat/feedback` | Thumbs up/down on a message |
| `GET`  | `/api/chat/suggestions` | Quick-start suggestions |
| `POST` | `/api/auth/login` | Admin login |
| `GET`  | `/api/admin/stats` | Dashboard stats |
| `GET`  | `/api/admin/pg/unanswered-questions` | Questions the bot could not answer |
| `POST` | `/api/documents` | Upload document |
| `POST` | `/api/scraper` | Start crawler |
| `GET`  | `/api/analytics` | Analytics summary |
| `POST` | `/api/channels/telegram/webhook/:secret` | Telegram webhook |
| `GET`  | `/api/health` | Liveness / readiness |

Full interactive docs at `/docs` in dev mode.

## Embedding the Widget on msx.om

Add to any webpage:

```html
<script src="https://YOUR_SERVER/widget.js"></script>
<script>
  MSXChat.init({
    serverUrl: 'https://YOUR_SERVER',   // required
    lang: 'ar',                          // 'en' | 'ar'
  })
</script>
```

## Telegram channel

1. Create a bot with [@BotFather](https://t.me/BotFather), put the token in `TELEGRAM_BOT_TOKEN`
2. Set `TELEGRAM_WEBHOOK_SECRET` to a random string (`openssl rand -hex 16`)
3. Register the webhook:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR_SERVER/api/channels/telegram/webhook/<SECRET>"
   ```

## Production Checklist

- [ ] Set `JWT_SECRET` to a 64-char random string (startup fails without it)
- [ ] Change `ADMIN_PASSWORD`
- [ ] Set strong `CHATBOOT_PG_PASS` and `REDIS_PASS`
- [ ] Set `FRONTEND_URL` (CORS is locked to it in production)
- [ ] Enable HTTPS — see the commented 443 block in [nginx/nginx.conf](nginx/nginx.conf)
- [ ] Switch to `bge-m3` embeddings for Arabic (see above)
- [ ] Run initial crawl + Index All
- [ ] Upload key documents (Annual Reports, FAQs, Regulations)
- [ ] Review *Admin → Unanswered* weekly and add missing FAQs

## Folder Structure

```
msx-ai-platform/
├── backend/          NestJS API
│   └── src/
│       ├── modules/
│       │   ├── auth/         JWT auth + user management
│       │   ├── chat/         Streaming chat, FAQ fast-path, answer cache
│       │   ├── channels/     Telegram webhook
│       │   ├── rag/          Embeddings + Qdrant + LLM providers
│       │   ├── scraper/      BullMQ web crawler (msx.om)
│       │   ├── documents/    PDF/DOCX/XLSX processor
│       │   ├── analytics/    Event tracking
│       │   ├── audit/        Admin action audit log
│       │   ├── admin/        Dashboard, PG CRUD, dynamic MSX APIs
│       │   └── database/     PostgreSQL access (app tables)
│       ├── schemas/          Enums + role permissions (persistence is PostgreSQL)
│       └── common/           Guards, filters, interceptors
├── frontend/         Next.js 14 + TypeScript + Tailwind
│   └── src/
│       ├── app/
│       │   ├── page.tsx      Chat homepage
│       │   ├── embed/        Bare iframe page for widget.js
│       │   └── admin/        Admin dashboard (15 pages)
│       ├── components/chat/  ChatWidget (voice input, TTS, charts, history)
│       └── lib/              API client, Zustand store
├── nginx/            Reverse proxy config (+ commented HTTPS block)
└── docker-compose.yml
```
