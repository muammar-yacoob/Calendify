const VIDEO_LENGTH_LIMIT = 10 * 60; // 10 minutes in seconds

async function getTranscript() {
    try {
      const transcriptButton = document.querySelector('[aria-label="Show transcript"]');
      if (!transcriptButton) {
        alert('Transcript not available for this video');
        return;
      }
      
      transcriptButton.click();
      await new Promise(r => setTimeout(r, 1000));
      
      const transcriptItems = Array.from(document.querySelectorAll('yt-formatted-string.segment-text'));
      const fullText = transcriptItems.map(item => item.textContent.trim()).join(' ');
      
      const summary = await summarizeText(fullText);
      chrome.runtime.sendMessage({ 
        action: "showSummary", 
        summary: summary 
      });
      
    } catch (error) {
      console.error('Error getting transcript:', error);
      alert('Error getting video transcript');
    }
  }
  
  async function summarizeText(text) {
    // Split into sentences and select key ones based on length and content
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    const summary = sentences
      .filter(s => s.length > 30 && !s.includes('subscribe') && !s.includes('like'))
      .slice(0, 5)
      .join(' ');
    return summary;
  }
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getTranscript") {
      getTranscript();
    }
  });