/* Library tab: list saved clips, open one for practice, or delete. */
const Library = (() => {
  const listEl = () => document.getElementById("clip-list");

  async function refresh() {
    const res = await fetch("/api/clips");
    const clips = await res.json();
    const empty = document.getElementById("library-empty");
    empty.classList.toggle("hidden", clips.length > 0);
    listEl().innerHTML = "";
    for (const c of clips) {
      const card = document.createElement("div");
      card.className = "clip-card";
      card.innerHTML = `
        <h3></h3>
        <div class="meta">${c.duration}s · ${new Date(c.created).toLocaleString()}</div>
        <div class="actions">
          <button class="primary practice-btn">Practice</button>
          <button class="ghost del-btn">Delete</button>
        </div>`;
      card.querySelector("h3").textContent = c.title || "(untitled)";
      card.querySelector(".practice-btn").onclick = () => App.openPractice(c);
      card.querySelector(".del-btn").onclick = async () => {
        if (!confirm("Delete this clip?")) return;
        await fetch("/api/clips/" + c.id, { method: "DELETE" });
        refresh();
      };
      listEl().appendChild(card);
    }
  }

  return { init: refresh, refresh };
})();
