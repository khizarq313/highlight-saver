let box = null;

document.addEventListener("mouseup", (e) => {
  const text = window.getSelection().toString().trim();
  if (!text) return;

  if (box) box.remove();

  box = document.createElement("div");
  box.innerText = "Save Highlight?";
  Object.assign(box.style, {
    position: "absolute",
    top: e.pageY + "px",
    left: e.pageX + "px",
    background: "#333",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: "6px",
    cursor: "pointer",
    zIndex: 99999999
  });

  document.body.appendChild(box);

  box.onclick = () => {
    chrome.storage.local.get({ highlights: [] }, (res) => {
      const arr = res.highlights;
      arr.push({
        text,
        url: location.href,
        time: Date.now()
      });

      chrome.storage.local.set({ highlights: arr });
    });

    box.remove();
    box = null;
  };
});
