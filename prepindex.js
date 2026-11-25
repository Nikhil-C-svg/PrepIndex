"use strict";

const note = (id) => document.getElementById("prep-" + id);
function display(text, target = "status", error = false) {
  const element = note(target);
  element.textContent = text;
  element.hidden = !text;
  element.dataset.error = String(error);
}
let indexedNotes = [];
let interviewQuestion = "";
let droppedFile = null;

async function prepRequest(path, options) {
  const response = await fetch(path, options);
  if (response.status === 413) throw new Error("The upload is too large.");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}

function prepPost(path, data) {
  return prepRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

function pdfLink(id, filename, page) {
  const link = document.createElement("a");
  link.href = "/prep/pdf/" + id + (page ? "#page=" + page : "");
  link.target = "_blank";
  link.rel = "noopener";
  link.className = "ctx-chip";
  link.textContent = filename + (page ? " · p. " + page : "");
  return link;
}

function showNotes() {
  const notes = indexedNotes.filter((file) => file.subject === note("collection").value);
  const links = notes.map((file) => pdfLink(file.id, file.filename));
  if (!links.length) {
    const empty = document.createElement("span");
    empty.className = "empty-files";
    empty.textContent = "No PDFs indexed yet.";
    links.push(empty);
  }
  note("files").replaceChildren(...links);
  note("ask").disabled = !note("collection").value || note("style").disabled;
}

async function refreshNotes(preferred) {
  indexedNotes = await prepRequest("/prep/notes");
  const subjects = [...new Set(indexedNotes.map((file) => file.subject))];
  note("collection").replaceChildren(...subjects.map((name) => new Option(name, name)));
  if (subjects.includes(preferred)) note("collection").value = preferred;
  if (!subjects.length) note("collection").add(new Option("Upload a PDF first", ""));
  showNotes();
}

async function uploadNotes() {
  const file = droppedFile || note("file").files[0];
  const subject = note("subject").value.trim();
  if (!file || !subject) return display("Enter a subject and select a PDF.", "upload-status", true);
  if (file.size > 20 * 1024 * 1024) return display("Choose a PDF up to 20 MB.", "upload-status", true);
  if (!/\.pdf$/i.test(file.name)) return display("Choose a .pdf file.", "upload-status", true);
  note("upload").disabled = true;
  display("Extracting text from PDF…", "upload-status");
  let pdf;
  try {
    const pdfjs = await import("/prep-assets/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/prep-assets/pdf.worker.mjs";
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    if (pdf.numPages > 300) throw new Error("Choose a PDF with 300 pages or fewer.");
    const form = new FormData();
    form.append("subject", subject);
    form.append("pdf", file);
    let hasText = false;
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const text = content.items.map((item) => item.str || "").join(" ").trim();
      hasText ||= Boolean(text);
      form.append("page", text || " ");
    }
    if (!hasText) throw new Error("This file has no selectable text. Run OCR before uploading it.");
    display("Embedding and saving your notes…", "upload-status");
    const result = await prepRequest("/prep/upload", { method: "POST", body: form });
    await refreshNotes(note("style").disabled ? note("collection").value : subject);
    note("file").value = "";
    droppedFile = null;
    note("file").required = true;
    note("file-hint").textContent = "Choose or drop a text-based PDF · 20 MB max";
    if (!note("style").disabled) resetStudy();
    display("Saved " + result.passages + " passages in " + subject + ".", "upload-status");
  } catch (error) {
    display(error.message, "upload-status", true);
  } finally {
    if (pdf) {
      try { await pdf.destroy(); } catch (error) { console.warn(error); }
    }
    note("upload").disabled = false;
  }
}

function resetStudy() {
  clearInterview();
  note("results").hidden = true;
  note("answer").textContent = "";
  note("sources").replaceChildren();
  display("");
}

function clearInterview() {
  interviewQuestion = "";
  note("ask").textContent = note("style").value === "interview" ? "Generate question" : "Ask notes";
  note("question").placeholder = note("style").value === "interview"
    ? "Enter a topic to generate an interview question."
    : "Ask a question about your notes…";
}

async function askNotes() {
  const subject = note("collection").value;
  const input = note("question").value.trim();
  const style = note("style").value;
  if (!subject || !input) return display("Select a subject and enter a question, topic, or attempt.", "status", true);
  const generatingQuestion = style === "interview" && !interviewQuestion;
  const question = style === "interview" && interviewQuestion
    ? "Interview question: " + interviewQuestion + " | My attempt: " + input
    : input;
  note("ask").disabled = true;
  note("collection").disabled = true;
  note("style").disabled = true;
  note("mode").disabled = true;
  note("results").hidden = true;
  note("answer").textContent = "";
  note("sources").replaceChildren();
  display("Searching your subject notes…");
  try {
    const result = await prepPost("/prep/ask", {
      subject, question, style: generatingQuestion ? "interview-question" : style, mode: note("mode").value,
    });
    note("answer").textContent = result.answer;
    note("results").hidden = false;
    note("sources").replaceChildren(...result.sources.map((item) => pdfLink(item.id, item.filename, item.page)));
    if (result.sources.length && generatingQuestion) {
      interviewQuestion = result.answer.replace(/\s+/g, " ").replace(/\s*\[\d+\]/g, "").trim().slice(0, 350);
      note("question").value = "";
      note("question").placeholder = "Type your answer to the interview question above.";
      note("ask").textContent = "Review my answer";
    } else if (style === "interview" && result.sources.length) {
      clearInterview();
      note("question").value = "";
    }
    display("");
  } catch (error) {
    display(error.message, "status", true);
  } finally {
    note("ask").disabled = !note("collection").value;
    note("collection").disabled = false;
    note("style").disabled = false;
    note("mode").disabled = false;
  }
}

async function compareNotes() {
  let labels;
  try {
    labels = JSON.parse(note("labels").value);
    if (!Array.isArray(labels) || !labels.length || labels.length > 100) throw Error();
  } catch {
    return display("Enter 1–100 labeled questions as a JSON array.", "benchmark-status", true);
  }
  const modes = ["vector", "hybrid"];
  const stats = Object.fromEntries(modes.map((mode) => [mode, { correct: 0, ms: [] }]));
  const output = note("benchmark");
  note("compare").disabled = true;
  output.textContent = "";
  try {
    for (const [index, item] of labels.entries()) {
      const { subject, question, filename, page } = item ?? {};
      const matches = indexedNotes.filter((file) => file.subject === subject && file.filename === filename);
      if (typeof question !== "string" || !question.trim() || matches.length !== 1 || !Number.isInteger(page) || page < 1)
        throw new Error("Check the subject, filename, page, and question for label " + (index + 1) + ".");
      display("Benchmarking question " + (index + 1) + " of " + labels.length + "…", "benchmark-status");
      for (const mode of index % 2 ? ["hybrid", "vector"] : modes) {
        const result = await prepPost("/prep/search", { subject, question, mode });
        stats[mode].correct += Number(result.sources.some((source) => source.id === matches[0].id && source.page === page));
        stats[mode].ms.push(result.ms);
      }
    }
    output.textContent = modes.map((mode) => {
      const { correct, ms } = stats[mode];
      ms.sort((a, b) => a - b);
      const median = (ms[Math.floor((ms.length - 1) / 2)] + ms[Math.floor(ms.length / 2)]) / 2;
      return mode + ": " + correct + "/" + labels.length + " correct pages in top 5 · "
        + median.toFixed(2) + " ms median retrieval";
    }).join("\n");
    display("", "benchmark-status");
  } catch (error) {
    display(error.message, "benchmark-status", true);
  } finally {
    note("compare").disabled = false;
  }
}

note("upload-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!note("upload").disabled) uploadNotes();
});
note("ask-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!note("ask").disabled) askNotes();
});
note("file").addEventListener("change", () => {
  droppedFile = null;
  note("file").required = true;
  const file = note("file").files[0];
  note("file-hint").textContent = file ? file.name : "Choose or drop a text-based PDF · 20 MB max";
});
note("drop").addEventListener("dragover", (event) => {
  event.preventDefault();
  note("drop").classList.add("over");
});
note("drop").addEventListener("dragleave", () => note("drop").classList.remove("over"));
note("drop").addEventListener("drop", (event) => {
  event.preventDefault();
  note("drop").classList.remove("over");
  if (note("upload").disabled) return;
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (event.dataTransfer.files.length !== 1 || !/\.pdf$/i.test(file.name)) {
    display("Drop one .pdf file at a time.", "upload-status", true);
    return;
  }
  droppedFile = file;
  note("file").value = "";
  note("file").required = false;
  note("file-hint").textContent = file.name;
  display("", "upload-status");
});
note("compare").addEventListener("click", compareNotes);
note("style").addEventListener("change", resetStudy);
note("collection").addEventListener("change", () => {
  resetStudy();
  showNotes();
});
refreshNotes().catch((error) => display(error.message, "upload-status", true));
