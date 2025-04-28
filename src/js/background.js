var API_URL = 'http://localhost:3000/api/summarise';
// var API_URL = 'https://Calendify.vercel.app';

console.log('Background script loaded');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
  chrome.contextMenus.create({
    id: "addToCalendar",
    title: "Add to Calendar",
    contexts: ["page"],
    documentUrlPatterns: ["*://*/*"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log('Context menu clicked');
  if (info.menuItemId === "summariseTranscript") {
    console.log('Sending getTranscript message');
    chrome.tabs.sendMessage(tab.id, { action: "getTranscript" });
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  console.log('Received message:', message);
  if (message.action === "summarise") {
    console.log('Processing summarise action');
    fetchSummary(message.videoUrl, sender.tab);
  }
});

async function fetchSummary(videoUrl, tab) {
  console.log('Fetching summary for:', videoUrl);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl })
    });

    const data = await response.json();
    console.log('API response:', data);
    saveSummary(data.summary, tab);
  } catch (error) {
    console.error('Fetch error:', error);
    saveSummary(`Error: ${error.message}`, tab);
  }
}

function saveSummary(summary, tab) {
  console.log('Saving summary');
  chrome.storage.sync.set({ 
    lastSummary: {
      text: summary,
      url: tab.url,
      title: tab.title
    }
  });
  console.log('Summary saved');
}