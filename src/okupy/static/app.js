async function loadModels() {
  const select = document.getElementById("model");
  const data = await fetch("/v1/models").then((r) => r.json());
  select.innerHTML = "";
  for (const profile of data.profiles) {
    const option = document.createElement("option");
    option.value = profile.name;
    option.textContent = `${profile.name} · ${profile.model_id}`;
    select.appendChild(option);
  }
}

function fileUrl(jobId, path) {
  const parts = path.split(/[/\\]/);
  const name = parts.at(-1);
  const kind = parts.at(-2);
  return `/v1/jobs/${jobId}/files/${kind}/${name}`;
}

document.getElementById("generate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("status");
  const result = document.getElementById("result");
  status.hidden = false;
  result.hidden = true;
  status.textContent = "Supervisor is routing the job…";

  const outputs = [];
  if (document.querySelector("[name=slideshow]").checked) outputs.push("slideshow");
  if (document.querySelector("[name=video]").checked) outputs.push("video");

  const response = await fetch("/v1/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: document.getElementById("title").value,
      tutorial: document.getElementById("tutorial").value,
      outputs,
      model: document.getElementById("model").value,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    status.textContent = data.detail || "Generate failed.";
    return;
  }

  status.textContent = `Job ${data.job_id} · agents ${data.agents_used.join(", ")}`;
  document.getElementById("result-title").textContent = data.title;
  document.getElementById("result-meta").textContent = data.model
    ? `Model: ${data.model.name} (${data.model.model_id})`
    : "";
  const gallery = document.getElementById("gallery");
  gallery.innerHTML = "";
  for (const slide of data.slides || []) {
    const img = document.createElement("img");
    img.src = fileUrl(data.job_id, slide);
    img.alt = "TikTok slide";
    gallery.appendChild(img);
  }
  const notes = document.getElementById("notes");
  notes.innerHTML = "";
  for (const note of data.notes || []) {
    const li = document.createElement("li");
    li.textContent = note;
    notes.appendChild(li);
  }
  result.hidden = false;
});

document.getElementById("gmail").addEventListener("click", async () => {
  const data = await fetch("/v1/auth/gmail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).then((r) => r.json());
  const status = document.getElementById("status");
  status.hidden = false;
  if (data.redirect_url) {
    window.location.href = data.redirect_url;
    return;
  }
  status.textContent = data.note || "Composio Gmail is not configured.";
});

loadModels();
