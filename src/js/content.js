console.log('Content script loaded');

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getSelectedText") {
    // Send extracted details back to background script
    chrome.runtime.sendMessage({
      action: "processSelectedText",
      selectedText: window.getSelection().toString() || '',
      eventDetails: extractEventDetailsFromDOM()
    });
  }
});

// Extract event details from DOM elements
function extractEventDetailsFromDOM() {
  console.log('Extracting event details from DOM');
  const eventDetails = { title: null, date: null, time: null, location: null };
  
  try {
    // Find all elements in the page
    const allElements = document.querySelectorAll('*');
    
    // Extract title - look for prominent text that could be an event title
    for (const element of allElements) {
      const text = element.textContent.trim();
      // Skip elements with promotional or irrelevant content
      if (shouldSkipElement(element, text)) continue;
      
      if (text.length > 5 && text.length < 100 && 
          !text.toLowerCase().includes('location') && 
          !text.match(/^\d+:\d+$/) && 
          !text.match(/^(mon|tue|wed|thu|fri|sat|sun)/i)) {
        eventDetails.title = text;
        console.log('Found title:', text);
        break;
      }
    }
    
    // Extract date and time by looking for weekday patterns
    for (const element of allElements) {
      const text = element.textContent.trim();
      // Skip elements with promotional or irrelevant content
      if (shouldSkipElement(element, text)) continue;
      
      // Look for patterns like "Wednesday at 15:00"
      const weekdayMatch = text.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+at\s+(\d{1,2}):(\d{2})\b/i);
      if (weekdayMatch) {
        // Set date to next occurrence of that day
        const dayNames = {
          'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 
          'friday': 5, 'saturday': 6, 'sunday': 0
        };
        const today = new Date();
        const targetDay = dayNames[weekdayMatch[1].toLowerCase()];
        const daysToAdd = (targetDay + 7 - today.getDay()) % 7;
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + daysToAdd);
        
        eventDetails.date = targetDate.toISOString().split('T')[0];
        eventDetails.time = `${weekdayMatch[2].padStart(2, '0')}:${weekdayMatch[3]}`;
        console.log('Extracted date and time from weekday pattern:', eventDetails.date, eventDetails.time);
        break;
      }
      
      // If no weekday pattern, look for time separately
      if (!eventDetails.time && text.match(/\d{1,2}:\d{2}/)) {
        const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          eventDetails.time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
          console.log('Extracted time:', eventDetails.time);
        }
      }
    }
    
    // Extract location by looking for text containing "location:"
    for (const element of allElements) {
      const text = element.textContent.trim();
      // Skip elements with promotional or irrelevant content
      if (shouldSkipElement(element, text)) continue;
      
      const textLower = text.toLowerCase();
      // Check if text includes "location:" or similar
      if (textLower.includes('location:') || textLower === 'location' || textLower.includes('venue:')) {
        // Get the text after "location:" or the parent element's text if it's just a label
        let locationText = '';
        
        if (textLower.includes('location:')) {
          locationText = text.split(/location:/i)[1]?.trim();
        } else if (textLower.includes('venue:')) {
          locationText = text.split(/venue:/i)[1]?.trim();
        } else if (textLower === 'location') {
          // If it's just a label, try to get the next element or parent's text
          const nextEl = element.nextElementSibling;
          const parentEl = element.parentElement;
          
          if (nextEl && nextEl.textContent.trim()) {
            locationText = nextEl.textContent.trim();
          } else if (parentEl && parentEl.textContent.includes('location')) {
            // Get parent's text excluding the "location" label
            locationText = parentEl.textContent.replace(/location:?/i, '').trim();
          }
        }
        
        if (locationText && locationText.length > 0) {
          eventDetails.location = locationText;
          console.log('Extracted location:', locationText);
          break;
        }
      }
    }
    
    console.log('Final extracted event details:', eventDetails);
  } catch (error) {
    console.error('Error extracting event details:', error);
  }
  
  return eventDetails;
}

// Helper function to determine if an element should be skipped
function shouldSkipElement(element, text) {
  // Skip empty text
  if (!text || text.length === 0) return true;
  
  // Skip common promotional texts
  const promoTexts = ['sales end soon', 'promoted', 'sold out', 'free', 'tickets', 'price', 'from £'];
  if (promoTexts.some(promo => text.toLowerCase().includes(promo))) return true;
  
  // Skip elements with certain classes
  const className = element.className || '';
  const skipClasses = ['urgency', 'promoted', 'price', 'sold', 'ticket', 'sale'];
  if (skipClasses.some(cls => className.toLowerCase().includes(cls))) return true;
  
  // Skip elements that are likely promotional
  const style = element.getAttribute('style') || '';
  if (style.includes('darkreader') || style.includes('--Typography')) return true;
  
  return false;
}

// Extract event details on page load
setTimeout(() => {
  const eventDetails = extractEventDetailsFromDOM();
  chrome.storage.local.set({ lastExtractedDetails: eventDetails });
}, 1000);