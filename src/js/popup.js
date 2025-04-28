function decodeHtml(html) {
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
}

document.addEventListener('DOMContentLoaded', async () => {
  const { lastSummary } = await chrome.storage.sync.get('lastSummary');
  
  if (lastSummary) {
    const decodedText = decodeHtml(lastSummary.text);
    document.getElementById('summary').textContent = decodedText;
    document.getElementById('videoTitle').textContent = lastSummary.title;
    document.getElementById('videoUrl').href = lastSummary.url;
  } else {
    document.getElementById('summary').textContent = 'No summary available. Open a YouTube video and use the context menu to generate a summary.';
  }
  
  document.getElementById('copy').addEventListener('click', () => {
    const summary = document.getElementById('summary').textContent;
    navigator.clipboard.writeText(summary);
    showNotification('Summary copied to clipboard!');
  });
});

function showNotification(message) {
  const notification = document.getElementById('notification');
  notification.textContent = message;
  notification.classList.add('show');
  setTimeout(() => notification.classList.remove('show'), 2000);
}