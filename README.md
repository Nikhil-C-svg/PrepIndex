# PrepIndex

Local-first PDF study assistant with page-cited answers, exam prep, and interview practice. Built with C++, SQLite, and Ollama.

Organize notes by subject and open any citation to see the original PDF page.

## Run on Windows

PrepIndex supports the portable build on x64 Windows. The first run fetches its compiler, SQLite sources, and PDF modules inside the project folder. Start Ollama before using PDF indexing or AI answers. [Install Ollama for Windows](https://ollama.com/download/windows)

```powershell
ollama pull nomic-embed-text
ollama pull llama3.2
```

In PowerShell, change to the folder containing `Start-PrepIndex.ps1` and run the launcher. Run the same command for later launches. Open [localhost:8080](http://localhost:8080) after the server starts.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-PrepIndex.ps1
```

The portable download is cached under `.build`. The launcher supports `-BuildOnly` to compile without starting the server and `-Rebuild` to recompile after editing the C++ files.

## Study workflow

- Upload a PDF with selectable text. Scans need OCR first.
- Select the subject and enter a question. Use **10-mark answer** for exam practice or **Interview practice** to answer a generated question and review your response.
- Open a citation to inspect the relevant page. PDF page numbers count the cover if present.
- Expand **Retrieval benchmark** to compare vector-only and hybrid search. Enter a JSON array with the subject, question, PDF filename, and expected page. Results show top-five page hits and median retrieval time, excluding model calls.

```json
[{"subject":"Embedded C","question":"What does volatile do?","filename":"notes.pdf","page":3}]
```

The **Vector Explorer** visualizes demo vectors and compares HNSW, KD-Tree, and brute-force search. **Text Documents** and **Ask AI** let you add pasted text and query it.

PDFs, passages, and embeddings are stored in `prepindex.sqlite3`. Keep it private if it contains personal notes. The server listens on loopback and connects to your local Ollama instance. See [open-source notices](THIRD_PARTY_NOTICES.md) for attribution and licenses.
