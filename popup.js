const list = document.getElementById("list");

function loadHighlights() {
  chrome.storage.local.get({ highlights: [] }, (res) => {
    const arr = res.highlights;

    list.innerHTML = "";

    if (arr.length === 0) {
      list.textContent = "No highlights saved.";
      return;
    }

    arr.forEach((h, index) => {
      const row = document.createElement("div");
      row.className = "item";

      const textEl = document.createElement("span");
      textEl.textContent = h.text;

      const btn = document.createElement("button");
      btn.textContent = "Delete";
      btn.className = "del-btn";

      btn.onclick = () => {
        chrome.storage.local.get({ highlights: [] }, (res2) => {
          const newArr = res2.highlights;
          newArr.splice(index, 1);

          chrome.storage.local.set({ highlights: newArr }, () => {
            loadHighlights();
          });
        });
      };

      row.appendChild(textEl);
      row.appendChild(btn);
      list.appendChild(row);
    });
  });
}

loadHighlights();
