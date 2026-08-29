# AI PPT Tutor

AI PPT Tutor is an evidence-grounded learning workspace for PDF and PowerPoint lecture materials. It extracts and indexes content by page or slide, then supports guided tutoring, in-depth explanations, document-based questions, practice generation, and revision summaries with verifiable citations to the source material.

## Live Demo

[https://ai-ppt-tutor.vercel.app/](https://ai-ppt-tutor.vercel.app/)

## Key Features

- Supports PDF and PPTX files up to 20 MB each.
- Provides three OCR modes: **Automatic (recommended)**, **No OCR**, and **Full-page OCR**. Automatic mode processes only pages without a usable text layer, while full-page OCR is designed for scanned materials.
- Uses a shared browser-side pipeline for PDF pages and PowerPoint slides: page rendering, Canvas processing, and Tesseract.js recognition.
- Merges native and OCR text while removing duplicates and weighting OCR evidence by confidence.
- Detects educationally useful charts, tables, diagrams, and code screenshots for analysis with `qwen3-vl-plus`.
- Preserves page or slide numbers, crop coordinates, visual summaries, and thumbnails for image-based evidence.
- Validates file extensions, MIME types, file signatures, parsing timeouts, and content limits.
- Builds structure-aware chunks for titles, definitions, lists, tables, code, pages, and slides.
- Combines BM25 retrieval, `text-embedding-v4`, multi-query expansion, Reciprocal Rank Fusion, and MMR deduplication.
- Uses `qwen3-rerank` with title, location, neighbouring-page, content-type, OCR-confidence, and visual-reliability signals.
- Uses ordered full-document coverage for broad requests such as document overviews, knowledge structures, and comprehensive explanations.
- Produces structured answers with claim-level citations, partial refusal, and complete refusal when the material does not support an answer.
- Includes five learning modes:
  - **Tutor** — diagnosis, intuitive explanation, step-by-step teaching, practice, mastery checks, and suggested next steps.
  - **Explain** — learning objectives, examples, common mistakes, and self-checks.
  - **Q&A** — answers grounded exclusively in the uploaded material.
  - **Quiz** — questions, separately revealed answers, explanations, and source evidence.
  - **Review** — key concepts, likely points of confusion, and a recommended revision sequence.
- Provides collapsible source panels, highlighted evidence, answer feedback, and upload retry controls.
- Reports progress across OCR, upload, parsing, chunking, visual analysis, and embedding stages.
- Supports pausing document processing, cancelling uploads, and stopping answer generation.
- Stores multiple workspaces, indexes, visual evidence, conversations, feedback, learning modes, and mastery status in IndexedDB.
- Reuses identical documents through SHA-256 fingerprints to avoid repeated OCR, visual analysis, and embedding calls.
- Persists source files, OCR manifests, and independently HMAC-signed processing checkpoints so interrupted jobs can resume.
- Provides a three-column desktop workspace and dedicated file, learning, and source tabs on mobile.

If semantic embedding or reranking is temporarily unavailable, the application falls back to local lexical retrieval so that the learning workflow remains usable.

## Local Development

### Requirements

- Node.js 22.13 or later
- A DashScope API key for AI generation and semantic retrieval

### Installation

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) after the development server starts.

### Environment Variables

Configure `.env.local` before using AI-powered features:

```dotenv
DASHSCOPE_API_KEY=your_dashscope_api_key
DASHSCOPE_VISION_MODEL=qwen3-vl-plus
CHECKPOINT_SIGNING_SECRET=a_different_long_random_secret

# Optional. When configured, users must enter this key before accessing the product workspace.
# When omitted, the standard product workspace is publicly accessible.
APP_ACCESS_KEY=a_long_random_access_key

# Required only for non-local or public access to research administration and consent controls.
# The localhost research workflow bypasses this gate.
EXPERIMENT_ADMIN_KEY=a_different_long_random_researcher_key
```

Never commit `.env.local` or any real credentials. `CHECKPOINT_SIGNING_SECRET` must be a high-entropy value that is different from the DashScope API key.

The standard product workspace is accessible without an application access key by default. For a restricted deployment, configure `APP_ACCESS_KEY` in Vercel. Public deployments consume model quota, so production environments should also use Vercel Firewall or a shared rate-limiting service and enforce appropriate daily spending limits.

## Product and Research Environments

The landing page separates the standard product from the controlled research environment:

- `/workspace` provides the full product experience for users and their own PDF or PPTX materials.
- `/study/setup` provides the local controlled-study workflow.

The research environment uses the repository's fixed `DBI_Relational_Model.pdf` material. It does not expose file upload, learning-mode selection, product progress controls, or other features unrelated to the registered experiment.

## Controlled 2×2 Research Study

### Running the Study Build

Use a production build bound to the loopback interface:

```bash
npm run build
npm run study
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and select **Research Study**.

On localhost, the researcher is taken directly to the setup page without an additional researcher-control key. The researcher must:

1. Enter a Study ID in the format `APTT-###`.
2. Set **Prior database experience** to **Novice** or **Experienced**.
3. Select condition A, B, C, or D.
4. Create the session and hand the computer to the participant.

Until the researcher explicitly starts the next participant from the completion page, using the browser's Back button or visiting `/study/setup` restores the active session without exposing its assigned condition.

Before learning begins, the participant reads and acknowledges the Participant Information Sheet, the researcher confirms receipt of separate written consent, and the participant completes Form 1 using the same Study ID. The **Start Learning** action becomes available only after these steps are complete. Non-local or future public access still requires `EXPERIMENT_ADMIN_KEY` to prevent condition disclosure.

Selecting **Start Learning** begins a maximum 25-minute session and enables learning-event recording. Participants may finish early after a confirmation step. Reaching the time limit or completing early immediately locks the learning interface. The independent, unassisted post-study flow becomes available only after the research record has been saved successfully.

Participants complete Form 3 Quiz followed by Form 2 Post-Learning Questionnaire, then return the computer to the researcher. Each step provides both a QR code and a direct Microsoft Forms link, and the server restores the saved procedure step after a refresh.

### Experimental Conditions

- **A:** no evidence constraint and no verifiable source attribution.
- **B:** evidence constrained, without verifiable source attribution.
- **C:** no evidence constraint, with verifiable source attribution.
- **D:** evidence constrained, with verifiable source attribution.

A and C share the same response core, while B and D share the same response core. Source attribution is the only presentation difference within each paired comparison.

For conditions B and D, dynamic responses use complete-claim evidence certification. Claims without full lecture support are removed, and certification results are written to the cache shared by the paired conditions. Conditions C and D apply a conservative local fallback for missing citations on highly overlapping direct definitions.

System-generated examples are explicitly labelled as hypothetical and use conditional language. Values, keys, domains, or constraints not stated directly in the lecture are never presented as lecture facts and do not receive lecture citations.

In attribution-enabled conditions, participants can select sentence-level markers to open the supporting PDF page and highlight the relevant source text. Follow-up questions remain subject to the session's fixed evidence and attribution rules.

### Research Data and Protocol Controls

- Each participant's data is written independently to `~/Desktop/research_record/APTT-###/`.
- `STUDY_RECORD_ROOT` can be used to change the root record directory.
- `STUDY_BUILD_COMMIT` can be used to record an explicit build identifier.
- Information Sheet acknowledgement, written-consent confirmation, and form-procedure timestamps are stored as session procedure metadata and are excluded from the 25-minute learning-event log.
- Information Sheet acknowledgement does not replace the institution's required written consent.
- Only normal time-limit completion or confirmed early completion enables Form 3 followed by Form 2.
- Technical interruption, participant withdrawal, or researcher termination does not expose the formal post-study assessment and instead instructs the participant to contact the researcher.
- The Form 3 page completely unmounts the explanation, lecture, and conversation interfaces to prevent access to study assistance during the unassisted assessment.
- Before a formal session begins, the application validates the fixed PDF hash, frozen response package, citation mappings, API key, and record-directory write access.
- The research environment is designed for localhost operation and should not be deployed to Vercel.
- Automated regression coverage includes overview generation, detailed explanation, illustrative examples, concept comparison, and multi-turn follow-up questions. It also verifies A=C and B=D response-core equivalence, citation visibility, evidence injection, and condition blinding.

Before every formal study session, run all validation commands below and confirm that they pass. Never reuse a Study ID that already has generated records.

## Validation

```bash
npm test
npm run lint
npm run build
npm run eval
```

## Evaluation

Evaluation documentation is available in [`evaluation/README.md`](evaluation/README.md).

Run the default joint evaluation fixtures with:

```bash
npm run eval
```

Generate candidate evaluation questions from real lecture files with:

```bash
node --env-file=.env.local scripts/generate-evaluation-dataset.mjs /path/to/lecture1.pdf /path/to/lecture2.pdf
```

Generated items are explicitly labelled `pending_human_review`. They must not be treated as formal evaluation results until a reviewer has verified the questions, reference answers, and relevant page locations.

## Known Limitations

- Automatic and full-page OCR consume client CPU, memory, and battery. Long lecture files may process slowly on mobile or low-powered devices.
- OCR currently uses Simplified Chinese and English language models. Recognition quality may decrease for complex formulae, low-resolution charts, and uncommon fonts.
- PDF.js Worker, Tesseract.js Worker, the WASM core, and the Chinese and English language models are self-hosted by the application and do not depend on third-party CDNs.
- OCR runs locally in the browser, but extracted page text is sent to the application server and the configured DashScope service for embedding generation.
- Candidate chart crops are sent to the configured vision model. Questions, limited conversation history, and retrieved lecture evidence are sent to the text-generation and reranking models.
- Before processing sensitive, confidential, or restricted materials, verify the Alibaba Cloud account region, data-retention policy, and applicable institutional requirements.
- Removing a lecture also removes its workspace, full-text and vector caches, and unfinished processing jobs from the current browser.
- Browser acceptance-test snapshots, evaluation materials, and local research documents are excluded from source control and deployment.
- Learning records and feedback are stored only in the current browser. They are not synchronised across devices and are not connected to an operational analytics backend.
- Clearing browser site data removes local workspaces, cached indexes, and resumable jobs. Important learning records should not rely on a single browser profile.
- The browser-stored vector index is suitable for individual multi-lecture workspaces. A large shared lecture collection would require a server-side vector database.
- The OCR, retrieval, and visual-evidence evaluation framework is implemented, but candidate questions generated from the ten real lecture files require human review before they can serve as a formal gold-standard dataset.
